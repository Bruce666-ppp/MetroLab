import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Check, MapPinPlus, Route, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { applyAction } from '../engine/actions.ts'
import type { Action } from '../engine/actions.ts'
import { gameMetrics, networkReach } from '../engine/analytics.ts'
import { TRAIN_REFUND } from '../engine/economy.ts'
import { exampleGame } from '../engine/example.ts'
import { distance } from '../engine/geometry.ts'
import { LINE_COLORS, MIN_STATION_GAP } from '../engine/network.ts'
import { clearGame, loadGame, saveGame, saveSettings } from '../engine/save.ts'
import type { Settings } from '../engine/save.ts'
import { advanceGame, newGame, TICK } from '../engine/simulation.ts'
import type { GameState, Line, Mode, Speed } from '../engine/types.ts'
import { CityMap } from './CityMap.tsx'
import { Footer, Header, Indicators, ModeMenu, Tools } from './Chrome.tsx'
import { ConfirmDialog, HelpDialog, SettingsDialog } from './Dialogs.tsx'
import { money } from './format.ts'
import type { LineDraft, MapTarget, Selection, Tool } from './interaction.ts'
import { AnalyticsPanel, DistrictPanel, LineEditor, LinePanel, NetworkOverview, StationPanel, TrainPanel } from './Panels.tsx'

type StorageIO = Parameters<typeof loadGame>[0]
type Confirmation = { title: string; body: string; action: () => void; destructive?: boolean }
type Notice = { text: string; error?: boolean }

const suggested = [{ x: 295, y: 416 }, { x: 747, y: 505 }]

export function App({ storage, initialSettings }: { storage: StorageIO; initialSettings: Settings }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [example] = useState(exampleGame)
  const [game, setGame] = useState(example)
  const current = useRef(game)
  const [playing, setPlaying] = useState(false)
  const [save, setSave] = useState(() => loadGame(storage))
  const [settings, setSettings] = useState(initialSettings)
  const [speed, setSpeed] = useState<Speed>(0)
  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Selection>()
  const [tab, setTab] = useState<'network' | 'analytics'>('network')
  const [dialog, setDialog] = useState<'settings' | 'help'>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [notice, setNotice] = useState<Notice>()
  const [draft, setDraft] = useState<LineDraft>()
  const draftCurrent = useRef<LineDraft | undefined>(undefined)
  const draftUndo = useRef<LineDraft[]>([])
  const pausedUndo = useRef<GameState[]>([])
  const [undoSize, setUndoSize] = useState(0)
  const [session, setSession] = useState(0)
  const reachedMilestones = useRef(game.milestones.length)

  const activeLines = game.trains.filter((train) => train.active).map((train) => train.lineId).join('|')
  const reach = useMemo(() => networkReach(game), [game.stations, activeLines, game.revision])
  const metrics = gameMetrics(game, reach)
  const defaultLine = Math.max(0, ...game.lines.map((line) => line.number)) + 1

  function replaceGame(next: GameState) {
    current.current = next
    setGame(next)
  }

  useEffect(() => {
    void i18n.changeLanguage(settings.language)
    document.documentElement.lang = settings.language
    saveSettings(storage, settings)
  }, [i18n, settings, storage])

  useEffect(() => {
    if (!playing || speed === 0) return
    const timer = window.setInterval(() => {
      if (!document.hidden) replaceGame(advanceGame(current.current, TICK * speed))
    }, 125)
    return () => window.clearInterval(timer)
  }, [speed, playing])

  useEffect(() => {
    if (!playing) return
    const autosave = () => {
      const written = saveGame(storage, current.current)
      if (written) setSave(written)
    }
    const timer = window.setInterval(autosave, 9000)
    window.addEventListener('pagehide', autosave)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', autosave)
    }
  }, [playing, storage, session])

  useEffect(() => {
    if (!playing || reachedMilestones.current >= game.milestones.length) return
    const milestone = game.milestones.at(-1)
    reachedMilestones.current = game.milestones.length
    if (milestone) setNotice({ text: t('notice.milestone', { name: t('milestone.' + milestone) }) })
  }, [game.milestones, playing, t])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(undefined), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  function saveCurrent(show = false) {
    const written = saveGame(storage, current.current)
    if (written) {
      setSave(written)
      if (show) setNotice({ text: t('settings.saved') })
    } else {
      setNotice({ text: t('settings.saveError'), error: true })
    }
  }

  function resetDraft() {
    draftUndo.current = []
    draftCurrent.current = undefined
    setDraft(undefined)
  }

  function cancel() {
    resetDraft()
    setTool('select')
  }

  function setRate(rate: Speed) {
    if (!playing) return
    if (rate) {
      pausedUndo.current = []
      setUndoSize(0)
    }
    setSpeed(rate)
  }

  function action(command: Action, message?: string) {
    if (!playing) return undefined
    const previous = current.current
    const result = applyAction(previous, command)
    if (result.error || !result.game) {
      setNotice({ text: t('error.' + result.error), error: true })
      return undefined
    }
    if (speed === 0) {
      pausedUndo.current = [...pausedUndo.current.slice(-14), previous]
      setUndoSize(pausedUndo.current.length)
    }
    replaceGame(result.game)
    if (message) setNotice({ text: t(message) })
    return result
  }

  function undo() {
    if (draftCurrent.current) {
      const previous = draftUndo.current.pop()
      if (!previous) return
      draftCurrent.current = previous
      setDraft(previous)
      return
    }
    const previous = speed === 0 ? pausedUndo.current.pop() : undefined
    if (!previous) return
    setUndoSize(pausedUndo.current.length)
    replaceGame(previous)
    setSelection(undefined)
    setNotice({ text: t('notice.undone') })
  }

  function editDraft(next: LineDraft, trackUndo = true) {
    const previous = draftCurrent.current
    if (previous && trackUndo) draftUndo.current = [...draftUndo.current.slice(-39), previous]
    draftCurrent.current = next
    setDraft(next)
  }

  function beginLine(line?: Line) {
    if (!playing) return
    if (!line && current.current.stations.length < 2) {
      setNotice({ text: t('panel.noLines'), error: true })
      return
    }
    draftUndo.current = []
    const color = LINE_COLORS.find((candidate) => !game.lines.some((entry) => entry.color === candidate)) ?? LINE_COLORS[0]
    editDraft(line ? { id: line.id, stops: [...line.stops], circular: line.circular, name: line.name, color: line.color }
      : { name: '', color, stops: [], circular: false }, false)
    setTool('line')
    setTab('network')
  }

  function changeTool(next: Tool) {
    if (next === 'line') {
      if (!draftCurrent.current) beginLine(selection?.type === 'line' ? game.lines.find((line) => line.id === selection.id) : undefined)
      return
    }
    if (!playing && next !== 'select') return
    cancel()
    setTool(next)
    if (next === 'station') { setTab('network'); setSelection(undefined) }
  }

  function addStop(id: string) {
    const currentDraft = draftCurrent.current
    if (!currentDraft || currentDraft.stops.includes(id)) return
    const stops = [...currentDraft.stops]
    stops.splice(currentDraft.insertion === undefined ? stops.length : currentDraft.insertion + 1, 0, id)
    editDraft({ ...currentDraft, stops, insertion: undefined })
  }

  function commitLine() {
    const editing = draftCurrent.current
    if (!editing) return
    const result = action({ type: 'saveLine', id: editing.id, design: editing }, 'notice.lineBuilt')
    if (result?.id) {
      cancel()
      setSelection({ type: 'line', id: result.id })
    }
  }

  function pick(target: Selection) {
    cancel()
    setTab('network')
    setSelection(target)
  }

  function clickMap(target: MapTarget) {
    if (tool === 'station') {
      const result = action({ type: 'buildStation', point: target.point }, 'notice.built')
      if (result?.id) setSelection({ type: 'station', id: result.id })
    } else if (tool === 'move' && selection?.type === 'station') {
      const result = action({ type: 'moveStation', id: selection.id, point: target.point }, 'notice.moved')
      if (result?.id) cancel()
    } else if (tool === 'line' && target.selection?.type === 'station') {
      addStop(target.selection.id)
    } else if (tool === 'select') {
      pick(target.selection)
    }
  }

  function resetWorkspace(next: GameState, active: boolean) {
    setDialog(undefined)
    setConfirmation(undefined)
    setNotice(undefined)
    setSpeed(0)
    setPlaying(active)
    setSelection(undefined)
    setTab('network')
    pausedUndo.current = []
    setUndoSize(0)
    reachedMilestones.current = next.milestones.length
    cancel()
    replaceGame(next)
    setSession((value) => value + 1)
  }

  function mainMenu() {
    if (playing) saveCurrent()
    resetWorkspace(example, false)
  }

  function startGame(mode: Mode) {
    resetWorkspace(newGame(mode), true)
    saveCurrent()
  }

  function choose(mode: Mode) {
    if (save) setConfirmation({ title: t('menu.replaceTitle'), body: t('menu.replaceBody'), action: () => startGame(mode), destructive: true })
    else startGame(mode)
  }

  function resume() {
    const slot = loadGame(storage)
    if (!slot) {
      setNotice({ text: t('settings.noSave'), error: true })
      return
    }
    resetWorkspace(slot.game, true)
    setSave(slot)
    setNotice({ text: t('settings.loaded') })
  }

  function requestReset() {
    setDialog(undefined)
    setConfirmation({
      title: t('settings.resetTitle'), body: t('settings.resetBody'), destructive: true,
      action: () => {
        if (!clearGame(storage)) { setNotice({ text: t('settings.saveError'), error: true }); return }
        setSave(undefined)
        resetWorkspace(example, false)
        setNotice({ text: t('settings.resetDone') })
      },
    })
  }

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (dialog || confirmation || event.target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable)) return
      const key = event.key.toLowerCase()
      if (key === '?' && !event.repeat) { setDialog('help'); return }
      if (!playing || event.repeat) return
      if (event.key === 'Escape') {
        cancel()
        setSelection(undefined)
      } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        undo()
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === 'v') changeTool('select')
        if (key === 's') changeTool('station')
        if (key === 'l') changeTool('line')
        if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
          event.preventDefault()
          setRate(speed ? 0 : 1)
        }
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  const act = (command: Action) => Boolean(action(command, command.type === 'buyTrain' ? 'notice.bought' : undefined))
  const selectLine = (id: string) => pick({ type: 'line', id })
  const selectStation = (id: string) => pick({ type: 'station', id })
  const selectTrain = (id: string) => pick({ type: 'train', id })
  const back = () => pick(undefined)
  const changeLanguage = (language: Settings['language']) => setSettings((value) => ({ ...value, language }))
  const hoveredSites = playing && settings.guides && game.stations.length < 2
    ? suggested.filter((point) => game.stations.every((station) => distance(point, station.position) >= MIN_STATION_GAP)) : []
  const line = selection?.type === 'line' ? game.lines.find((entry) => entry.id === selection.id) : undefined
  const station = selection?.type === 'station' ? game.stations.find((entry) => entry.id === selection.id) : undefined
  const train = selection?.type === 'train' ? game.trains.find((entry) => entry.id === selection.id) : undefined
  const showTabs = playing || Boolean(selection)
  const showHint = playing && tool !== 'select'
  const hint = tool === 'station' ? 'buildHint' : tool === 'move' ? 'moveHint' : 'lineHint'

  return <div className="app-shell">
    <Header game={game} playing={playing} language={settings.language} change={changeLanguage}
      menu={mainMenu} settings={() => setDialog('settings')} help={() => setDialog('help')}/>
    <Indicators game={game} metrics={metrics}/>
    <main className="workspace" aria-label={t('app.board')}>
      <Tools tool={tool} playing={playing} select={changeTool} undo={undo}
        canUndo={draft ? draftUndo.current.length > 0 : speed === 0 && undoSize > 0} canCancel={showHint} cancel={cancel}/>
      <section className="map-panel" aria-label={t('map.name')}>
        <CityMap key={session} game={game} reach={reach} layer={settings.layer} tool={tool}
          setLayer={(layer) => setSettings((value) => ({ ...value, layer }))} selected={selection}
          draft={draft} suggestions={hoveredSites} clickMap={clickMap} addStop={addStop}/>
        {showHint && <div className="map-mode-hint">
          {tool === 'line' ? <Route size={16}/> : <MapPinPlus size={16}/>}
          <span>{t('tool.' + hint)}</span><button type="button" onClick={cancel} aria-label={t('common.cancel')} title={t('common.cancel')}><kbd>Esc</kbd></button>
        </div>}
        {notice && <div className={'game-toast' + (notice.error ? ' error' : '')} role="status">
          {notice.error ? <TriangleAlert size={17}/> : <Check size={17}/>}<span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(undefined)} title={t('common.close')} aria-label={t('common.close')}><X size={15}/></button>
        </div>}
      </section>
      <aside className="inspector">
        {showTabs && <div className="inspector-tabs">
          <button type="button" aria-pressed={tab === 'network'} onClick={() => { setTab('network'); setSelection(undefined) }}><Route size={16}/>{t('panel.network')}</button>
          <button type="button" aria-pressed={tab === 'analytics'} onClick={() => setTab('analytics')}><BarChart3 size={16}/>{t('panel.analytics')}</button>
        </div>}
        <div className="inspector-body">
          {tab === 'analytics' && showTabs ? <AnalyticsPanel game={game} metrics={metrics}/>
            : draft ? <LineEditor game={game} draft={draft} defaultName={t('line.defaultName', { number: line?.number ?? defaultLine })}
              change={(next) => editDraft(next)} cancel={cancel} commit={commitLine}/>
            : station ? <StationPanel key={station.id} game={game} station={station} reach={reach} playing={playing} act={act}
              back={back} pickLine={selectLine} move={() => setTool('move')} remove={(cost) => setConfirmation({
                title: t('station.removeTitle'), body: t('station.removeBody') + (cost ? ' ' + t('station.reconnect', { cost: money(cost, locale) }) : ''),
                destructive: true, action: () => { if (act({ type: 'removeStation', id: station.id })) back() },
              })}/>
            : line ? <LinePanel game={game} line={line} playing={playing} back={back} station={selectStation}
              edit={() => beginLine(line)} act={act} pickTrain={selectTrain} remove={() => setConfirmation({
                title: t('line.removeTitle'), body: t('line.removeBody'), destructive: true,
                action: () => { if (act({ type: 'removeLine', id: line.id })) back() },
              })}/>
            : train ? <TrainPanel game={game} train={train} playing={playing} back={() => selectLine(train.lineId)} act={act}
              pickLine={() => selectLine(train.lineId)} sell={() => setConfirmation({
                title: t('train.sellTitle'), body: t('train.sellBody', { cost: money(TRAIN_REFUND, locale) }), destructive: true,
                action: () => { if (act({ type: 'sellTrain', id: train.id })) selectLine(train.lineId) },
              })}/>
            : selection?.type === 'district' ? <DistrictPanel game={game} reach={reach} id={selection.id} back={back}/>
            : playing ? <NetworkOverview game={game} metrics={metrics} guidance={settings.guides}
              build={() => changeTool('station')} create={() => beginLine()} pickLine={selectLine} pickStation={selectStation} start={() => setRate(1)}/>
            : <ModeMenu save={save} choose={choose} resume={resume} game={game} selectLine={(entry) => selectLine(entry.id)}/>}
        </div>
      </aside>
    </main>
    <Footer playing={playing} speed={speed} setSpeed={setRate} game={game} selectLine={selectLine}/>
    {dialog === 'settings' && <SettingsDialog settings={settings} canSave={playing} canLoad={Boolean(save)}
      language={changeLanguage} hints={() => setSettings((value) => ({ ...value, guides: !value.guides }))}
      save={() => { saveCurrent(true); setDialog(undefined) }} load={resume} reset={requestReset} menu={mainMenu}
      close={() => setDialog(undefined)}/>}
    {dialog === 'help' && <HelpDialog close={() => setDialog(undefined)}/>}
    {confirmation && <ConfirmDialog title={confirmation.title} body={confirmation.body} destructive={confirmation.destructive}
      close={() => setConfirmation(undefined)} onConfirm={() => { setConfirmation(undefined); confirmation.action() }}/>}
  </div>
}
