import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, CirclePlus, Flag, MapPin, MapPinPlus, Pencil,
  Play, Plus, Route, TrainFront, Trash2, X } from 'lucide-react'
import { demolitionCost, HEADWAYS, maxNameLength } from '../engine/actions.ts'
import type { Action } from '../engine/actions.ts'
import { districtDetails, gameMetrics, lineDetails, networkReach } from '../engine/analytics.ts'
import { getCity } from '../engine/city.ts'
import { canAfford, INTERCHANGE_PRICE, milestoneValue, milestones, TRAIN_PRICE, TRAIN_REFUND, upgradePrice } from '../engine/economy.ts'
import { LINE_COLORS, nextStop, stationCapacity, stationPreview, stationRadius, trackCost, trainLoad, waitingAt } from '../engine/network.ts'
import type { GameState, Line, Station, Train } from '../engine/types.ts'
import { LineBadge } from './Chrome.tsx'
import { lineLabel, money, number, percent, stationLabel, timeLabel, trainCode } from './format.ts'
import type { LineDraft } from './interaction.ts'

export function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return <button type="button" className="back-button" onClick={onClick}><ArrowLeft size={15}/>{t('common.back')}</button>
}

function DataGrid({ values }: { values: [string, ReactNode][] }) {
  return <dl className="data-grid">{values.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function ActionButton({ children, onClick, disabled, kind }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; kind?: 'primary' | 'danger'
}) {
  return <button type="button" className={'action-button' + (kind ? ' ' + kind : '')} onClick={onClick} disabled={disabled}>{children}</button>
}

export function Rows({ entries }: { entries: [ReactNode, ReactNode][] }) {
  return <dl className="data-rows">{entries.map(([label, value], i) =>
    <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

export function NetworkOverview({ game, metrics, guidance, build, create, pickLine, pickStation, start }: {
  game: GameState; metrics: ReturnType<typeof gameMetrics>; guidance: boolean
  build: () => void; create: () => void; pickLine: (id: string) => void; pickStation: (id: string) => void; start: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const step = game.stations.length < 2 ? 0 : !game.lines.length ? 1 : !metrics.fleet ? 2 : game.lifetime.arrived === 0 ? 3 : 4
  const guide = [
    { key: 'station', action: build, icon: MapPinPlus },
    { key: 'line', action: create, icon: Route },
    { key: 'fleet', action: () => pickLine(game.lines[0].id), icon: TrainFront },
    { key: 'run', action: start, icon: Play },
  ][step]
  return <div className="network-panel">
    <div className="panel-heading">
      <h2>{t('panel.networkTitle')}</h2>
      <div className="network-totals">
        <span>{t('panel.totalStops', { count: game.stations.length })}</span>
        <span>{t('panel.totalLines', { count: game.lines.length })}</span>
        <span>{t('panel.totalTrains', { count: metrics.fleet })}</span>
      </div>
    </div>
    {guidance && guide && <section className="guide-card">
      <div className="guide-top"><span><Flag size={14}/>{t('guide.heading')}</span><span>{t('guide.progress', { step: step + 1 })}</span></div>
      <div className="guide-progress" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} className={i <= step ? 'complete' : ''}/>)}</div>
      <h3>{t('guide.' + guide.key + 'Title')}</h3><p>{t('guide.' + guide.key + 'Text')}</p>
      <ActionButton onClick={guide.action}><guide.icon size={15}/>{t('guide.' + guide.key + 'Action')}</ActionButton>
    </section>}
    {game.funds < 0 && game.mode === 'career' && <p className="inline-warning">{t('panel.budgetWarning')}</p>}
    <section className="panel-section">
      <div className="section-heading"><h3>{t('panel.lines')}</h3>
        <button type="button" className="text-button" onClick={create}><Plus size={16}/>{t('panel.newLine')}</button>
      </div>
      {game.lines.length ? game.lines.map((line) => <button type="button" className="entity-row" key={line.id} onClick={() => pickLine(line.id)}>
        <LineBadge line={line}/><span><strong>{lineLabel(line, t)}</strong><small>
          {t('panel.lineSummary', { stops: line.stops.length, trains: game.trains.filter((train) => train.active && train.lineId === line.id).length })}
        </small></span><ChevronRight size={15}/>
      </button>) : <p className="section-empty">{t('panel.noLines')}</p>}
    </section>
    <section className="panel-section">
      <div className="section-heading"><h3>{t('panel.stations')}</h3></div>
      {game.stations.length ? game.stations.map((station) => <button type="button" className="entity-row compact-row" key={station.id} onClick={() => pickStation(station.id)}>
        <span className={'station-list-mark' + (station.interchange ? ' transfer' : '')}/><span>{stationLabel(game, station, t)}</span><ChevronRight size={15}/>
      </button>) : <p className="section-empty">{t('panel.noStations')}</p>}
    </section>
    {game.mode === 'career' && <section className="panel-section goals">
      <div className="section-heading"><h3>{t('panel.goals')}</h3></div>
      {milestones.map((milestone) => {
        const complete = game.milestones.includes(milestone.id)
        const value = milestoneValue(game, metrics.coverage, milestone.metric)
        return <div className="goal-item" key={milestone.id}>
          <div><span>{complete && <Check size={13}/>} {t('milestone.' + milestone.id)}</span><strong>{money(milestone.reward, locale)}</strong></div>
          <progress max={milestone.target} value={complete ? milestone.target : Math.min(value, milestone.target)} aria-label={t('milestone.' + milestone.id)} />
        </div>
      })}
    </section>}
  </div>
}

export function StationPanel({ game, station, reach, playing, back, act, pickLine, move, remove }: {
  game: GameState; station: Station; reach: ReturnType<typeof networkReach>; playing: boolean; back: () => void
  act: (action: Action) => boolean; pickLine: (id: string) => void; move: () => void; remove: (cost: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const name = stationLabel(game, station, t)
  const [rename, setRename] = useState(station.name)
  const preview = stationPreview(getCity(game.cityId), game, station.position, station.id)
  const lines = game.lines.filter((line) => line.stops.includes(station.id))
  const transfer = lines.length >= 2 && station.interchange
  const shared = lines.length >= 2 && !transfer
  const activity = game.stationActivity[station.id]
  return <div className="detail-panel">
    <BackButton onClick={back}/>
    <div className="detail-heading">
      <span className="detail-icon"><MapPin size={22}/></span>
      <div><p className="section-label">{t('station.title')} · {t('station.level', { level: station.level })}</p><h2>{name}</h2></div>
    </div>
    <div className="status-label"><span className={reach.served.has(station.id) ? 'active-dot' : 'paused-dot'}/>
      {t(reach.served.has(station.id) ? 'station.active' : 'station.planned')}
      {transfer && <span className="secondary-status">{t('station.transfer')}</span>}
      {shared && <span className="secondary-status">{t('station.shared')}</span>}
    </div>
    {playing && <form className="rename-form" onSubmit={(event) => {
      event.preventDefault()
      act({ type: 'renameStation', id: station.id, name: rename })
    }}>
      <input aria-label={t('station.name')} placeholder={name} value={rename} maxLength={maxNameLength} onChange={(event) => setRename(event.target.value)} />
      <button type="submit" title={t('station.rename')} aria-label={t('station.rename')} disabled={rename === station.name}><Check size={17}/></button>
    </form>}
    <DataGrid values={[
      [t('station.population'), number(preview.population, locale)],
      [t('station.jobs'), number(preview.jobs, locale)],
      [t('station.waiting'), number(waitingAt(game, station.id), locale)],
      [t('station.capacity'), number(stationCapacity(station), locale)],
      [t('station.catchment'), t('map.meters', { value: number(stationRadius(station.level) * 10, locale) })],
      [t('station.demand'), number(activity?.requested ?? 0, locale)],
    ]} />
    <Rows entries={[[t('station.boarded'), number(activity?.boarded ?? 0, locale)],
      [t('station.alighted'), number(activity?.alighted ?? 0, locale)]]}/>
    {lines.length > 0 && <div className="chip-list" aria-label={t('panel.lines')}>{lines.map((line) =>
      <button type="button" key={line.id} onClick={() => pickLine(line.id)} title={lineLabel(line, t, !playing)}><LineBadge line={line}/></button>)}</div>}
    {playing && <div className="detail-actions">
      {shared && <><ActionButton kind="primary" disabled={!canAfford(game, INTERCHANGE_PRICE)}
        onClick={() => act({ type: 'interchange', id: station.id })}>
        <Route size={16}/>{t('station.buildTransfer')}<small>{money(INTERCHANGE_PRICE, locale)}</small>
      </ActionButton><p className="small-hint">{t('station.transferNote')}</p></>}
      {station.level < 3 && <ActionButton disabled={!canAfford(game, upgradePrice(station))}
        onClick={() => act({ type: 'upgradeStation', id: station.id })}>
        <CirclePlus size={17}/>{t('station.upgrade')}<small>{money(upgradePrice(station), locale)}</small>
      </ActionButton>}
      <ActionButton onClick={move}><MapPinPlus size={16}/>{t('station.move')}</ActionButton>
      <ActionButton kind="danger" onClick={() => remove(demolitionCost(game, station.id))}><Trash2 size={16}/>{t('station.demolish')}</ActionButton>
    </div>}
  </div>
}

export function LinePanel({ game, line, playing, back, station, edit, act, pickTrain, remove }: {
  game: GameState; line: Line; playing: boolean; back: () => void; station: (id: string) => void; edit: () => void
  act: (action: Action) => boolean; pickTrain: (id: string) => void; remove: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { distance, trains, active } = lineDetails(getCity(game.cityId), game, line)
  return <div className="detail-panel">
    <BackButton onClick={back}/>
    <div className="detail-heading"><LineBadge line={line}/><div>
      <p className="section-label">{t('line.title')}{line.circular ? ' · ' + t('line.loop') : ''}</p><h2>{lineLabel(line, t, !playing)}</h2>
    </div></div>
    <div className="status-label"><span className={active ? 'active-dot' : 'paused-dot'}/>{t(active ? 'line.active' : 'line.planned')}</div>
    <DataGrid values={[
      [t('line.distance'), t('common.metros', { value: number(distance * 0.01, locale) })],
      [t('metric.activeFleet'), active + ' / ' + trains.length],
    ]} />
    {playing && <ActionButton onClick={edit}><Pencil size={16}/>{t('line.edit')}</ActionButton>}
    <section className="detail-section">
      <div className="section-heading"><h3>{t('line.fleet')}</h3></div>
      {playing && <label className="select-field">{t('line.headway')}
        <select value={line.headway} onChange={(event) => act({ type: 'headway', id: line.id, headway: Number(event.target.value) })}>
          {HEADWAYS.map((headway) => <option key={headway} value={headway}>{t('common.minutes', { value: number(headway, locale) })}</option>)}
        </select>
      </label>}
      {playing && <p className="small-hint">{t('line.headwayHint')}</p>}
      {trains.map((train) => <button type="button" className="entity-row compact-row" onClick={() => pickTrain(train.id)} key={train.id}>
        <TrainFront size={17}/><span><strong>{trainCode(train)}</strong><small>
          {train.active ? trainLoad(train) + ' / ' + train.capacity : t('train.waiting')}
        </small></span><ChevronRight size={15}/>
      </button>)}
      {!trains.length && <p className="section-empty">{t('line.noTrains')}</p>}
      {playing && <ActionButton kind="primary" onClick={() => act({ type: 'buyTrain', id: line.id })} disabled={!canAfford(game, TRAIN_PRICE)}>
        <Plus size={17}/>{t('line.buy')}<small>{money(TRAIN_PRICE, locale)}</small>
      </ActionButton>}
    </section>
    <section className="detail-section">
      <div className="section-heading"><h3>{t('line.stopOrder')}</h3></div>
      <ol className="route-order" style={{ '--line-color': line.color } as React.CSSProperties}>
        {line.stops.map((id) => <li key={id}><button type="button" onClick={() => station(id)}>{stationLabel(game, game.stations.find((stop) => stop.id === id)!, t)}</button></li>)}
      </ol>
    </section>
    {playing && <ActionButton kind="danger" onClick={remove}><Trash2 size={16}/>{t('line.remove')}</ActionButton>}
  </div>
}

export function LineEditor({ game, draft, defaultName, change, cancel, commit }: {
  game: GameState; draft: LineDraft; defaultName: string
  change: (next: LineDraft) => void; cancel: () => void; commit: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const old = game.lines.find((line) => line.id === draft.id)
  const cost = trackCost(getCity(game.cityId), game.stations, draft.stops, draft.circular, old)
  function move(index: number, offset: number) {
    const stops = [...draft.stops]
    const [id] = stops.splice(index, 1)
    stops.splice(index + offset, 0, id)
    change({ ...draft, stops, insertion: undefined })
  }
  const insertAt = draft.insertion !== undefined ? game.stations.find((station) => station.id === draft.stops[draft.insertion!]) : undefined
  return <div className="detail-panel line-editor">
    <BackButton onClick={cancel}/>
    <div className="detail-heading"><span className="detail-icon"><Route size={22}/></span><div>
      <p className="section-label">{t('line.title')}</p><h2>{t(old ? 'line.edit' : 'line.new')}</h2>
    </div></div>
    <label className="input-field">{t('line.lineName')}
      <input value={draft.name} maxLength={maxNameLength} placeholder={defaultName}
        onChange={(event) => change({ ...draft, name: event.target.value })} />
    </label>
    <div className="color-field">
      <span>{t('line.color')}</span>
      <div className="swatches">
        {LINE_COLORS.map((color) => <button type="button" key={color} title={t('line.colorOption', { value: color })}
          aria-label={t('line.colorOption', { value: color })} aria-pressed={draft.color === color} style={{ background: color }}
          onClick={() => change({ ...draft, color })}>{draft.color === color && <Check size={12}/>}</button>)}
        <input type="color" value={draft.color} title={t('line.customColor')} aria-label={t('line.customColor')}
          onChange={(event) => change({ ...draft, color: event.target.value })} />
      </div>
    </div>
    <div className="section-heading editor-stops"><h3>{t('line.stopOrder')}</h3><span>{draft.stops.length}</span></div>
    <p className="small-hint">{insertAt ? t('line.inserting', { station: stationLabel(game, insertAt, t) }) : t('line.stopHint')}</p>
    <ol className="draft-stops" style={{ '--line-color': draft.color } as React.CSSProperties}>
      {draft.stops.map((id, index) => {
        const station = game.stations.find((stop) => stop.id === id)!
        return <li key={id} className={draft.insertion === index ? 'insertion' : ''}>
          <span className="draft-index">{index + 1}</span><span className="draft-name">{stationLabel(game, station, t)}</span>
          <button type="button" aria-label={t('line.moveUp')} title={t('line.moveUp')} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14}/></button>
          <button type="button" aria-label={t('line.moveDown')} title={t('line.moveDown')} disabled={index === draft.stops.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14}/></button>
          <button type="button" aria-label={t('line.insert')} title={t('line.insert')} aria-pressed={draft.insertion === index}
            onClick={() => change({ ...draft, insertion: draft.insertion === index ? undefined : index })}><Plus size={14}/></button>
          <button type="button" aria-label={t('line.removeStop')} title={t('line.removeStop')}
            onClick={() => change({ ...draft, stops: draft.stops.filter((stop) => stop !== id), insertion: undefined })}><X size={14}/></button>
        </li>
      })}
    </ol>
    <label className="check-field">
      <input type="checkbox" checked={draft.circular} onChange={(event) => change({ ...draft, circular: event.target.checked })}/>
      <span>{t('line.loop')} <small>{t('line.loopHint')}</small></span>
    </label>
    <div className="build-total"><span>{t('line.cost')}</span><strong>{money(cost, locale)}</strong></div>
    {!canAfford(game, cost) && <p className="inline-warning">{t('error.funds')}</p>}
    {old && (old.stops.join('|') !== draft.stops.join('|') || old.circular !== draft.circular) &&
      <p className="small-hint">{t('line.topologyNotice')}</p>}
    <ActionButton kind="primary" onClick={commit} disabled={draft.stops.length < (draft.circular ? 3 : 2) || !canAfford(game, cost)}>
      <Route size={17}/>{t(old ? 'line.apply' : 'line.save')}
    </ActionButton>
  </div>
}

export function TrainPanel({ game, train, playing, act, back, sell, pickLine }: {
  game: GameState; train: Train; playing: boolean; act: (action: Action) => boolean; back: () => void; sell: () => void; pickLine: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const line = game.lines.find((entry) => entry.id === train.lineId)!
  const index = train.phase === 'travel' ? nextStop(line, train.at, train.direction) : train.at
  const station = game.stations.find((entry) => entry.id === line.stops[index])!
  const position = stationLabel(game, station, t)
  return <div className="detail-panel">
    <BackButton onClick={back}/>
    <div className="detail-heading"><span className="detail-icon"><TrainFront size={22}/></span>
      <div><p className="section-label">{t('train.title')}</p><h2>{trainCode(train)}</h2></div>
    </div>
    <div className="status-label"><span className={train.active ? 'active-dot' : 'paused-dot'}/>
      {t(train.active ? train.phase === 'travel' ? 'train.heading' : 'train.dwell' : 'train.waiting', { station: position })}
    </div>
    <DataGrid values={[
      [t('train.load'), trainLoad(train) + ' / ' + train.capacity],
      [t('train.speed'), t('train.kmh', { value: number(train.speed * 0.6, locale) })],
      [t('train.cost'), t('train.perMinute', { cost: money(train.active ? train.operatingCost : 12, locale) })],
      [t('train.dwellTime'), train.active && train.phase === 'dwell' ? t('common.minutes', { value: number(train.duration, locale) }) : '—'],
      [t('line.title'), <button type="button" className="chip-button" onClick={pickLine}><LineBadge line={line}/></button>],
    ]} />
    {playing && <div className="detail-actions">
      <ActionButton onClick={() => act({ type: 'setTrainActive', id: train.id, active: !train.active })}>
        <TrainFront size={16}/>{t(train.active ? 'train.hold' : 'train.dispatch')}
      </ActionButton>
      <ActionButton kind="danger" onClick={sell}><Trash2 size={16}/>{t('train.sell')}<small>{money(TRAIN_REFUND, locale)}</small></ActionButton>
    </div>}
  </div>
}

export function DistrictPanel({ game, reach, id, back }: {
  game: GameState; reach: ReturnType<typeof networkReach>; id: string; back: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const details = districtDetails(getCity(game.cityId), game, id)
  if (!details) return null
  const { district, population, jobs, demand } = details
  return <div className="detail-panel">
    <BackButton onClick={back}/>
    <div className="detail-heading"><span className="detail-icon"><MapPin size={22}/></span>
      <div><p className="section-label">{t('districtPanel.title')}</p><h2>{t('district.' + id)}</h2></div>
    </div>
    {!game.growth[id] && <p className="inline-warning">{t('districtPanel.opening', { day: district.opens })}</p>}
    <DataGrid values={[
      [t('districtPanel.zone'), t('zone.' + district.zone)],
      [t('districtPanel.population'), number(population, locale)],
      [t('districtPanel.jobs'), number(jobs, locale)],
      [t('districtPanel.demand'), number(demand, locale)],
      [t('districtPanel.coverage'), percent(reach.planned[id].fraction, locale)],
      [t('districtPanel.access'), percent(reach.active[id].fraction, locale)],
    ]} />
  </div>
}

type Chart = 'arrivals' | 'coverage' | 'balance'

export function AnalyticsPanel({ game, metrics }: { game: GameState; metrics: ReturnType<typeof gameMetrics> }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [chart, setChart] = useState<Chart>('arrivals')
  const history = game.history.slice(-24)
  const bounds = Math.max(1, ...history.map((point) => Math.abs(point[chart])))
  const format = (value: number) => chart === 'coverage' ? percent(value, locale) : chart === 'balance' ? money(value, locale) : number(value, locale)
  return <div className="analytics-panel">
    <div className="panel-heading"><h2>{t('panel.analysisTitle')}</h2></div>
    <section className="trend-panel">
      <div className="section-heading"><h3>{t('analysis.chart')}</h3></div>
      <div className="trend-tabs">{(['arrivals', 'coverage', 'balance'] as const).map((key) =>
        <button type="button" key={key} aria-pressed={chart === key} onClick={() => setChart(key)}>{t('analysis.' + key)}</button>)}</div>
      {history.length ? <>
        <div className={'trend-chart' + (chart === 'balance' ? ' signed' : '')} aria-label={t('analysis.' + chart)}>
          {history.map((entry) => <div key={entry.minute} className="trend-column">
            <div className={'trend-bar' + (entry[chart] < 0 ? ' negative-bar' : '')}
              style={{ height: Math.max(2, Math.abs(entry[chart]) / bounds * (chart === 'balance' ? 45 : 95)) + '%' }}
              title={t('analysis.hourValue', { time: timeLabel(entry.minute), value: format(entry[chart]) })} />
          </div>)}
        </div>
        <div className="chart-axes"><time>{timeLabel(history[0].minute)}</time><strong>{format(history.at(-1)![chart])}</strong><time>{timeLabel(history.at(-1)!.minute)}</time></div>
      </> : <p className="chart-empty">{t('analysis.insufficient')}</p>}
    </section>
    <section className="panel-section">
      <div className="section-heading"><h3>{t('analysis.service')}</h3></div>
      <Rows entries={[
        [t('metric.travelTime'), metrics.travelTime === undefined ? '—' : t('common.minutes', { value: number(metrics.travelTime, locale) })],
        [t('metric.unmet'), number(metrics.unmet, locale)], [t('metric.congestion'), percent(metrics.congestion, locale)],
        [t('metric.waiting'), number(metrics.waiting, locale)], [t('metric.onboard'), number(metrics.onboard, locale)],
      ]}/>
      <p className="small-hint">{t('analysis.servedInfo')}</p>
      <p className="small-hint">{t('analysis.unmetInfo')}</p>
    </section>
    <section className="panel-section">
      <div className="section-heading"><h3>{t('analysis.finance')}</h3></div>
      <Rows entries={[
        [t('analysis.fares'), money(game.today.fares, locale)], [t('analysis.subsidy'), money(game.today.subsidy, locale)],
        [t('analysis.expenses'), money(-game.today.expenses, locale)], [t('metric.operatingToday'), money(metrics.operating, locale)],
        [t('analysis.capital'), money(-game.today.construction, locale)], [t('analysis.rewards'), money(game.today.rewards, locale)],
        [t('analysis.salvage'), money(game.today.salvage, locale)],
      ]}/>
    </section>
  </div>
}
