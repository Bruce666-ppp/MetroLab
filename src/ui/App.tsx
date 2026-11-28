import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Check, MapPinPlus, Route, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { applyAction, relocationQuote } from '../engine/actions.ts'
import type { Action } from '../engine/actions.ts'
import { gameMetrics, networkReach } from '../engine/analytics.ts'
import { sectionKey } from '../engine/alignment.ts'
import { getCity } from '../engine/city.ts'
import { canAfford, trainRefund } from '../engine/economy.ts'
import { distance } from '../engine/geometry.ts'
import { HONG_KONG, surfaceAt } from '../engine/hongKong.ts'
import { stationGap, stationPreview, stationSiteError } from '../engine/network.ts'
import { quoteInsertion, quoteLine, roundPoint } from '../engine/planning.ts'
import { clearGame, loadGame, saveGame, saveSettings } from '../engine/save.ts'
import type { Settings } from '../engine/save.ts'
import { advanceGame, newGame, TICK } from '../engine/simulation.ts'
import type { GameState, Line, Mode, Speed, TrackMethod } from '../engine/types.ts'
import { CityMap } from './CityMap.tsx'
import { Footer, Header, Indicators, ModeMenu, Tools } from './Chrome.tsx'
import { ConfirmDialog, HelpDialog, SettingsDialog } from './Dialogs.tsx'
import { gameMoney } from './format.ts'
import { addGeometryControl, appendDraftStop, appendHongKongStop, availableLineColor, draftDesign, editControl, extensionChoices, makeDraft, smoothDraft } from './interaction.ts'
import type { LineDraft, MapTarget, Selection, Tool } from './interaction.ts'
import { AnalyticsPanel, DistrictPanel, InsertionPanel, LineEditor, LinePanel, NetworkOverview, StationPanel, TrainPanel } from './Panels.tsx'

type StorageIO = Parameters<typeof loadGame>[0]
type Confirmation = { title: string; body: string; action: () => void; destructive?: boolean }
type Notice = { key: string; error?: boolean; milestone?: string }
type Insertion = { point: MapTarget['point']; available: string[]; chosen: string[] }

export function App({ storage, initialSettings }: { storage: StorageIO; initialSettings: Settings }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [example] = useState(() => newGame('career', HONG_KONG))
  const [game, setGame] = useState(example)
  const current = useRef(game)
  const [playing, setPlaying] = useState(false)
  const [save, setSave] = useState(() => loadGame(storage))
  const [settings, setSettings] = useState(initialSettings)
  const [speed, setSpeed] = useState<Speed>(0)
  const [tool, setTool] = useState<Tool>('select')
  const [stationMethod, setStationMethod] = useState<TrackMethod>('underground')
  const [selection, setSelection] = useState<Selection>()
  const [tab, setTab] = useState<'network' | 'analytics'>('network')
  const [dialog, setDialog] = useState<'settings' | 'help'>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [notice, setNotice] = useState<Notice>()
  const [draft, setDraft] = useState<LineDraft>()
  const [insertion, setInsertion] = useState<Insertion>()
  const draftCurrent = useRef<LineDraft | undefined>(undefined)
  const nextDraftId = useRef(0)
  const draftUndo = useRef<LineDraft[]>([])
  const pausedUndo = useRef<GameState[]>([])
  const [undoSize, setUndoSize] = useState(0)
  const [session, setSession] = useState(0)
  const reachedMilestones = useRef(game.milestones.length)

  const activeLines = game.trains.filter((train) => train.active).map((train) => train.lineId).join('|')
  const reach = useMemo(() => networkReach(game), [game.stations, activeLines, game.revision])
  const metrics = gameMetrics(game, reach)
  const defaultLine = Math.max(0, ...game.lines.map((line) => line.number)) + 1
  const editedLine = draft && game.lines.find((line) => line.id === draft.id)
  const draftQuote = draft && quoteLine(game, draftDesign(game, draft), editedLine)

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
    let worker: Worker | undefined
    let waiting: GameState | undefined
    let ready = false
    if (game.hongKong && typeof Worker !== 'undefined') {
      worker = new Worker(new URL('../engine/simulation.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<GameState | 'ready'>) => {
        if (event.data === 'ready') { ready = true; return }
        if (waiting && waiting === current.current) {
          // Clock updates leave geography fixed. Keep those references stable across the worker boundary.
          replaceGame({ ...event.data, stations: waiting.stations, growth: waiting.growth })
        }
        waiting = undefined
      }
      worker.onerror = () => { worker?.terminate(); worker = undefined; waiting = undefined }
    }
    const timer = window.setInterval(() => {
      if (document.hidden || waiting) return
      if (worker && ready) {
        waiting = current.current
        worker.postMessage({ game: waiting, minutes: TICK * speed })
      } else if (!worker) replaceGame(advanceGame(current.current, TICK * speed))
    }, 125)
    return () => { window.clearInterval(timer); worker?.terminate() }
  }, [speed, playing, game.cityId])

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
    if (milestone) setNotice({ key: 'notice.milestone', milestone })
  }, [game.milestones, playing])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(undefined), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  function saveCurrent(show = false) {
    const written = saveGame(storage, current.current)
    if (written) {
      setSave(written)
      if (show) setNotice({ key: 'settings.saved' })
    } else {
      setNotice({ key: 'settings.saveError', error: true })
    }
  }

  function resetDraft() {
    draftUndo.current = []
    draftCurrent.current = undefined
    setDraft(undefined)
  }

  function cancel() {
    resetDraft()
    setInsertion(undefined)
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
      setNotice({ key: 'error.' + result.error, error: true })
      return undefined
    }
    if (speed === 0) {
      pausedUndo.current = [...pausedUndo.current.slice(-14), previous]
      setUndoSize(pausedUndo.current.length)
    }
    replaceGame(result.game)
    if (message) setNotice({ key: message })
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
    setNotice({ key: 'notice.undone' })
  }

  function editDraft(next: LineDraft, trackUndo = true) {
    const previous = draftCurrent.current
    if (previous && trackUndo) draftUndo.current = [...draftUndo.current.slice(-39), previous]
    draftCurrent.current = next
    setDraft(next)
  }

  function beginLine(line?: Line) {
    if (!playing) return
    draftUndo.current = []
    nextDraftId.current = 0
    setInsertion(undefined)
    editDraft(makeDraft(current.current, line), false)
    setTool('line')
    setTab('network')
  }

  function changeTool(next: Tool) {
    if (next === 'line') {
      if (!draftCurrent.current) beginLine()
      return
    }
    if (!playing && next !== 'select') return
    cancel()
    setTool(next)
    if (next === 'station') { setTab('network'); setSelection(undefined) }
  }

  function chooseDraftLine(id: string) {
    const active = draftCurrent.current
    if (!active || active.kind !== 'draw') return
    const line = extensionChoices(current.current, active.anchor).find((entry) => entry.id === id)
    editDraft({ ...active, id: line?.id, name: line?.name ?? '', circular: false,
      color: line?.color ?? availableLineColor(current.current), automaticName: line ? line.automaticName : true })
  }

  function addStop(id: string, point?: MapTarget['point'], tolerance = 0) {
    const active = draftCurrent.current
    if (!active || active.stops.includes(id)) return
    const state = current.current
    if (active.kind === 'draw' && active.id && state.lines.find((line) => line.id === active.id)?.stops.includes(id)) {
      setNotice({ key: 'error.invalidStops', error: true })
      return
    }
    let next = state.hongKong ? appendHongKongStop(state, active, id, point, tolerance) : appendDraftStop(active, id, point)
    if (state.hongKong && point) {
      const city = getCity(state.cityId)
      const siteError = stationSiteError(city, point)
        ?? stationPreview(city, state, roundPoint(next.proposed[id]), undefined, active.method).error
      if (siteError) { setNotice({ key: 'error.' + siteError, error: true }); return }
    }
    if (active.kind === 'draw' && !active.stops.length && !point && !active.pending.length) {
      const line = extensionChoices(state, id)[0]
      next = { ...next, anchor: id, id: line?.id, name: line?.name ?? '',
        color: line?.color ?? active.color, automaticName: line ? line.automaticName : true }
    }
    editDraft(next)
  }

  function setDraftMethod(method: TrackMethod) {
    const active = draftCurrent.current
    if (!active) return
    const last = active.stops.at(-1), before = active.stops.at(-2)
    if (active.kind !== 'draw' || active.pending.length || !last || !before) {
      editDraft({ ...active, method })
      return
    }
    const stationMethods = { ...active.stationMethods }
    if (active.proposed[last]) stationMethods[last] = method
    if (active.stops.length === 2 && active.proposed[before]) stationMethods[before] = method
    editDraft({ ...active, method, stationMethods, methods: { ...active.methods, [sectionKey(before, last)]: method } })
  }

  function commitLine() {
    const editing = draftCurrent.current
    if (!editing) return
    if ((!current.current.hongKong && editing.pending.length) || editing.control) {
      setNotice({ key: editing.control ? 'engineering.moveControl' : 'engineering.finishControl', error: true })
      return
    }
    const result = action({ type: 'saveLine', id: editing.id, design: draftDesign(current.current, editing) }, 'notice.lineBuilt')
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
    const state = current.current
    const city = getCity(state.cityId)
    const confirmCost = (cost: number, run: () => void) => {
      if (!canAfford(state, cost)) { setNotice({ key: 'error.funds', error: true }); return }
      if (city.hongKong) setConfirmation({ title: t('hk.confirmConstruction'), body: t('hk.confirmCost', {
        cost: gameMoney(state, cost, locale, false), balance: state.mode === 'sandbox' ? t('common.infinity') : gameMoney(state, state.funds - cost, locale, false),
      }), action: run })
      else run()
    }
    if (tool === 'station') {
      if (target.selection?.type === 'station') { pick(target.selection); return }
      const siteError = city.hongKong && (stationSiteError(city, target.point) ??
        (target.trackPoint && stationSiteError(city, target.trackPoint)))
      if (siteError) {
        setInsertion(undefined)
        setNotice({ key: 'error.' + siteError, error: true })
        return
      }
      if (target.trackPoint && target.trackLines?.length) {
        const { trackPoint: point, trackLines: available } = target
        if (available.length > 1 || city.hongKong) setInsertion({ point, available, chosen: [available[0]] })
        else insertStation(point, available)
        return
      }
      setInsertion(undefined)
      const point = roundPoint(target.point)
      const quote = stationPreview(city, state, point, undefined, stationMethod)
      if (quote.error) { setNotice({ key: 'error.' + quote.error, error: true }); return }
      confirmCost(quote.cost, () => {
        const result = action({ type: 'buildStation', point, method: stationMethod }, 'notice.built')
        if (result?.id) setSelection({ type: 'station', id: result.id })
      })
    } else if (tool === 'move' && selection?.type === 'station') {
      const quote = relocationQuote(state, selection.id, target.point)
      if (quote.error) { setNotice({ key: 'error.' + quote.error, error: true }); return }
      confirmCost(quote.cost, () => {
        const result = action({ type: 'moveStation', id: selection.id, point: target.point }, 'notice.moved')
        if (result?.id) cancel()
      })
    } else if (tool === 'line') {
      const active = draftCurrent.current
      if (!active) return
      if (active.control) {
        editDraft(editControl(active, active.control, target.point))
      } else if (target.control && !target.shift && !active.placingStation) {
        editDraft({ ...active, control: target.control }, false)
      } else if (city.hongKong) {
        if (target.selection?.type === 'station' && !active.placingControl) addStop(target.selection.id)
        else if (target.shift || active.placingStation) {
          addStop('draft-' + nextDraftId.current++, target.point, target.surveyTolerance)
        } else if (surfaceAt(target.point) === 'outside') setNotice({ key: 'error.outsideArea', error: true })
        else if (active.kind === 'edit' && active.insertion === undefined && active.stops.length >= 2 && !active.alignmentEnds?.head && !active.alignmentEnds?.tail) {
          editDraft(addGeometryControl(state, active, target.point))
        } else {
          const previous = active.pending.at(-1)
          if (!previous || distance(previous, target.point) >= .45) editDraft({ ...active, pending: [...active.pending, target.point], placingControl: false })
        }
      } else if (target.shift || active.placingControl) {
        if (!active.stops.length) setNotice({ key: 'engineering.startAtStation', error: true })
        else if (active.kind === 'edit' && active.insertion === undefined) {
          editDraft({ ...addGeometryControl(current.current, active, target.point), placingControl: false })
        } else editDraft({ ...active, pending: [...active.pending, target.point], placingControl: false })
      } else if (target.selection?.type === 'station') {
        addStop(target.selection.id)
      } else {
        const preview = stationPreview(city, state, target.point)
        const close = Object.entries(active.proposed).some(([id, point]) =>
          active.stops.includes(id) && distance(point, target.point) < stationGap(city))
        const error = preview.error ?? (close ? 'tooClose' : undefined)
        if (error) setNotice({ key: 'error.' + error, error: true })
        else addStop('draft-' + nextDraftId.current++, target.point)
      }
    } else if (tool === 'select') {
      pick(target.selection)
    }
  }

  function insertStation(point: MapTarget['point'], lineIds: string[]) {
    const result = action({ type: 'insertStation', point, lineIds }, 'notice.inserted')
    if (!result?.id) return
    setInsertion(undefined)
    setSelection({ type: 'station', id: result.id })
  }

  function smooth() {
    const active = draftCurrent.current
    if (!active) return
    const next = smoothDraft(current.current, active)
    if (next) editDraft(next)
    else setNotice({ key: 'engineering.smoothingUnavailable', error: true })
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
    resetWorkspace(newGame(mode, HONG_KONG), true)
    saveCurrent()
  }

  function choose(mode: Mode) {
    if (save) setConfirmation({ title: t('menu.replaceTitle'), body: t('menu.replaceBody'), action: () => startGame(mode), destructive: true })
    else startGame(mode)
  }

  function resume() {
    const slot = loadGame(storage)
    if (!slot) {
      setNotice({ key: 'settings.noSave', error: true })
      return
    }
    resetWorkspace(slot.game, true)
    setSave(slot)
    setNotice({ key: 'settings.loaded' })
  }

  function requestReset() {
    setDialog(undefined)
    setConfirmation({
      title: t('settings.resetTitle'), body: t('settings.resetBody'), destructive: true,
      action: () => {
        if (!clearGame(storage)) { setNotice({ key: 'settings.saveError', error: true }); return }
        setSave(undefined)
        resetWorkspace(example, false)
        setNotice({ key: 'settings.resetDone' })
      },
    })
  }

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (dialog || confirmation) return
      if (playing && event.key === 'Escape') { cancel(); setSelection(undefined); return }
      if (event.target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable)) return
      const key = event.key.toLowerCase()
      if (key === '?' && !event.repeat) { setDialog('help'); return }
      if (!playing || event.repeat) return
      if (event.key === 'Enter' && draftCurrent.current && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        commitLine()
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
          flat={settings.view === 'plan'} toggleView={() => setSettings((value) =>
            ({ ...value, view: value.view === 'plan' ? 'city' : 'plan' }))}
          draft={draft} draftQuote={draftQuote} insertionPoint={insertion?.point}
          clickMap={clickMap} addStop={addStop} stationMethod={stationMethod} setStationMethod={setStationMethod}
          chooseDraftLine={chooseDraftLine} commitLine={commitLine} cancelDraft={cancel} smooth={smooth}
          draftMethod={setDraftMethod}
          toggleControl={() => {
            const active = draftCurrent.current
            if (active) editDraft(game.hongKong ? { ...active, placingStation: !active.placingStation } :
              { ...active, placingControl: !active.placingControl }, false)
          }}/>
        {showHint && tool !== 'line' && <div className="map-mode-hint">
          <MapPinPlus size={16}/>
          <span>{t(game.hongKong && tool === 'station' ? 'hk.stationHint' : 'tool.' + hint)}</span>
          <button type="button" onClick={cancel} aria-label={t('common.cancel')} title={t('common.cancel')}><kbd>Esc</kbd></button>
        </div>}
        {notice && <div className={'game-toast' + (notice.error ? ' error' : '')} role="status">
          {notice.error ? <TriangleAlert size={17}/> : <Check size={17}/>}
          <span>{notice.milestone ? t(notice.key, { name: t('milestone.' + notice.milestone) }) : t(notice.key)}</span>
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
            : draft && draftQuote ? <LineEditor game={game} draft={draft} quote={draftQuote}
              defaultName={t('line.defaultName', { number: editedLine?.number ?? defaultLine })}
              change={(next) => editDraft(next)} cancel={cancel} commit={commitLine}/>
            : insertion ? <InsertionPanel game={game} available={insertion.available} chosen={insertion.chosen}
              quote={quoteInsertion(game, insertion.point, insertion.chosen)}
              toggle={(id) => setInsertion({ ...insertion, chosen: insertion.chosen.includes(id)
                ? insertion.chosen.filter((entry) => entry !== id) : [...insertion.chosen, id] })}
              cancel={() => setInsertion(undefined)} commit={() => insertStation(insertion.point, insertion.chosen)}/>
            : station ? <StationPanel key={station.id} game={game} station={station} reach={reach} playing={playing} act={act}
              back={back} pickLine={selectLine} move={() => setTool('move')} remove={() => setConfirmation({
                title: t('station.removeTitle'), body: t('station.removeBody'),
                destructive: true, action: () => { if (act({ type: 'removeStation', id: station.id })) back() },
              })}/>
            : line ? <LinePanel key={line.id} game={game} line={line} playing={playing} back={back} station={selectStation}
              removeSection={(index) => setConfirmation({ title: t('hk.removeSection'), body: t('hk.removeSectionBody'), destructive: true,
                action: () => { const result = action({ type: 'removeSection', id: line.id, index }); if (result && !result.id) back() } })}
              edit={() => beginLine(line)} act={act} pickTrain={selectTrain} remove={() => setConfirmation({
                title: t('line.removeTitle'), body: t('line.removeBody'), destructive: true,
                action: () => { if (act({ type: 'removeLine', id: line.id })) back() },
              })}/>
            : train ? <TrainPanel game={game} train={train} playing={playing} back={() => selectLine(train.lineId)} act={act}
              pickLine={() => selectLine(train.lineId)} sell={() => setConfirmation({
                title: t('train.sellTitle'), body: t('train.sellBody', { cost: gameMoney(game, trainRefund(game), locale) }), destructive: true,
                action: () => { if (act({ type: 'sellTrain', id: train.id })) selectLine(train.lineId) },
              })}/>
            : selection?.type === 'district' ? <DistrictPanel game={game} reach={reach} id={selection.id} back={back}/>
            : playing ? <NetworkOverview game={game} metrics={metrics} guidance={settings.guides}
              create={() => beginLine()} pickLine={selectLine} pickStation={selectStation} start={() => setRate(1)}/>
            : <ModeMenu save={save} choose={choose} resume={resume} game={game} selectLine={(entry) => selectLine(entry.id)}/>}
        </div>
      </aside>
    </main>
    <Footer playing={playing} speed={speed} setSpeed={setRate} game={game} selectLine={selectLine}/>
    {dialog === 'settings' && <SettingsDialog settings={settings} canSave={playing} canLoad={Boolean(save)}
      language={changeLanguage} hints={() => setSettings((value) => ({ ...value, guides: !value.guides }))}
      save={() => { saveCurrent(true); setDialog(undefined) }} load={resume} reset={requestReset} menu={mainMenu}
      close={() => setDialog(undefined)}/>}
    {dialog === 'help' && <HelpDialog close={() => setDialog(undefined)} hongKong={Boolean(game.hongKong)}/>}
    {confirmation && <ConfirmDialog title={confirmation.title} body={confirmation.body} destructive={confirmation.destructive}
      close={() => setConfirmation(undefined)} onConfirm={() => { setConfirmation(undefined); confirmation.action() }}/>}
  </div>
}
