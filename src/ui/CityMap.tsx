import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Building2, Compass, Hand, Layers3, Map as MapIcon, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCity, districtAt, minuteOfDay, populationOf } from '../engine/city.ts'
import { relocationQuote } from '../engine/actions.ts'
import { sectionKey, trackHits } from '../engine/alignment.ts'
import { canAfford } from '../engine/economy.ts'
import { clamp, distance, pathString } from '../engine/geometry.ts'
import { stationCapacity, stationPreview, stationRadius, waitingAt } from '../engine/network.ts'
import { quoteInsertion, quoteLine, selectableInsertions } from '../engine/planning.ts'
import { layers } from '../engine/save.ts'
import { curveSpeedKmh, ENGINEERING, minimumRadius, pieceTangent, radiusStatus, tangentsAgree, trackColors, trackLength, trackPath, unitsToMeters } from '../engine/track.ts'
import { trainPosition } from '../engine/trains.ts'
import type { GameState, Layer, Point, Station } from '../engine/types.ts'
import type { networkReach } from '../engine/analytics.ts'
import { AnimatedTrain } from './AnimatedTrain.tsx'
import { BaseMap, layerColors } from './BaseMap.tsx'
import { cartography } from './cartography.ts'
import { DrawControls, EngineeringLegend } from './Engineering.tsx'
import { lineCode, lineLabel, money, number, stationLabel, stationNameAt, trainCode } from './format.ts'
import { appendDraftStop, draftDesign, draftPosition, editControl } from './interaction.ts'
import type { LineDraft, MapTarget, Selection, Tool } from './interaction.ts'

interface Props {
  game: GameState
  reach: ReturnType<typeof networkReach>
  layer: Layer
  setLayer: (layer: Layer) => void
  flat: boolean
  toggleView: () => void
  tool: Tool
  selected: Selection
  draft?: LineDraft
  draftQuote?: ReturnType<typeof quoteLine>
  insertionPoint?: Point
  suggestions: Point[]
  clickMap: (target: MapTarget) => void
  addStop: (id: string) => void
  chooseDraftLine: (id: string) => void
  commitLine: () => void
  cancelDraft: () => void
  smooth: () => void
  toggleControl: () => void
}

interface Camera extends Point { zoom: number }
type Gesture = { x: number; y: number; camera: Camera; pointer: number; kind: 'pan' | 'draw'; last?: string }
const extent = (city: { width: number; height: number }): Camera => ({ x: city.width * 0.5, y: city.height * 0.5, zoom: 1 })

export function CityMap({ game, reach, layer, setLayer, flat, toggleView, tool, selected, draft, draftQuote, insertionPoint,
  suggestions, clickMap, addStop, chooseDraftLine, commitLine, cancelDraft, smooth, toggleControl }: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const city = getCity(game.cityId)
  const viewport = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | undefined>(undefined)
  const [size, setSize] = useState({ width: 1100, height: 660 })
  const [camera, setCamera] = useState<Camera>(() => extent(city))
  const [hover, setHover] = useState<{ world: Point; screen: Point }>()
  const [panning, setPanning] = useState(false)
  const baseScale = Math.max(size.width / (city.width + 18), size.height / (city.height + 18))
  const scale = baseScale * camera.zoom
  const left = camera.x - size.width / scale / 2
  const top = camera.y - size.height / scale / 2
  const screenTransform = useRef({ scale, left, top, width: size.width, height: size.height })
  screenTransform.current = { scale, left, top, width: size.width, height: size.height }

  useEffect(() => {
    const view = viewport.current
    if (!view) return
    const resize = new ResizeObserver(([entry]) => setSize({
      width: entry.contentRect.width || 1, height: entry.contentRect.height || 1,
    }))
    resize.observe(view)
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    const map = svg.current
    if (!map) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = map.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const transform = screenTransform.current
      setCamera((current) => {
        const zoom = clamp(current.zoom * Math.exp(-clamp(event.deltaY, -85, 85) * 0.0038), 0.47, 3.8)
        const delta = 1 - current.zoom / zoom
        return { x: current.x + (x - transform.width / 2) / transform.scale * delta,
          y: current.y + (y - transform.height / 2) / transform.scale * delta, zoom }
      })
      setHover(undefined)
    }
    map.addEventListener('wheel', wheel, { passive: false })
    return () => map.removeEventListener('wheel', wheel)
  }, [])

  const zoomBy = (factor: number) => {
    setCamera((current) => ({ ...current, zoom: clamp(current.zoom * factor, 0.47, 3.8) }))
    setHover(undefined)
  }
  const reset = () => { setCamera(extent(city)); setHover(undefined) }
  const stations = new Map(game.stations.map((station) => [station.id, station]))
  const lineById = new Map(game.lines.map((line) => [line.id, line]))
  const linesAt = new Map<string, GameState['lines']>()
  for (const line of game.lines) for (const id of line.stops) {
    const list = linesAt.get(id) ?? []
    list.push(line)
    linesAt.set(id, list)
  }
  const trains = game.trains.flatMap((train) => {
    const line = lineById.get(train.lineId)
    const point = line && train.active ? trainPosition(train, line, stations) : undefined
    return line && point ? [{ train, line, point }] : []
  })
  const selectedStation = selected?.type === 'station' ? stations.get(selected.id) : undefined
  const handles = draft?.kind === 'edit' ? (draftQuote?.rows ?? []).flatMap(({ section }) =>
    section.controls.map((point, index) => ({ point, key: sectionKey(section.from, section.to), index }))) : []
  const selectableControl = (point: Point) => handles.find((handle) => distance(handle.point, point) <= 12 / scale)

  function coordinates(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    return { screen, world: { x: left + screen.x / scale, y: top + screen.y / scale } }
  }

  function nearestStation(point: Point, px = 14) {
    let near: Station | undefined
    let closest = px / scale
    for (const station of game.stations) {
      const gap = distance(station.position, point)
      if (gap < closest) { near = station; closest = gap }
    }
    return near
  }

  function targetAt(point: Point): Selection {
    const station = nearestStation(point)
    if (station) return { type: 'station', id: station.id }
    const train = trains.find((entry) => distance(point, entry.point) <= 12 / scale)
    if (train) return { type: 'train', id: train.train.id }
    const hit = trackHits(game.lines, point, 9 / scale)[0]
    if (hit) return { type: 'line', id: hit.lineId }
    const district = districtAt(city, point)
    return district.score < 1.23 ? { type: 'district', id: district.area.id } : undefined
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button > 2 || gesture.current) return
    const point = coordinates(event).world
    const marker = tool === 'line' && !event.shiftKey && !draft?.control && !draft?.placingControl && event.button === 0 && !selectableControl(point)
      ? nearestStation(point) : undefined
    event.currentTarget.focus({ preventScroll: true })
    gesture.current = { x: event.clientX, y: event.clientY, camera, pointer: event.pointerId, kind: marker ? 'draw' : 'pan', last: marker?.id }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (marker) addStop(marker.id)
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const location = coordinates(event)
    const current = gesture.current
    if (!current) {
      setHover(location)
      return
    }
    if (current.pointer !== event.pointerId) return
    if (current.kind === 'draw') {
      setHover(location)
      const station = nearestStation(location.world, 18)
      if (station && station.id !== current.last) {
        current.last = station.id
        addStop(station.id)
      }
      return
    }
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (!panning && Math.hypot(dx, dy) < 5) return
    setPanning(true)
    setHover(undefined)
    setCamera({ ...current.camera,
      x: clamp(current.camera.x - dx / scale, -city.width * 0.2, city.width * 1.2),
      y: clamp(current.camera.y - dy / scale, -city.height * 0.2, city.height * 1.2),
    })
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>, cancelled = false) {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    gesture.current = undefined
    setPanning(false)
    if (cancelled || current.kind === 'draw' || event.button !== 0 ||
        Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 5) return
    const { world } = coordinates(event)
    const selection = targetAt(world)
    const hits = tool === 'station' && selection?.type !== 'station' ? selectableInsertions(game, world, 11 / scale) : []
    clickMap({ point: world, selection, shift: event.shiftKey, control: selectableControl(world),
      trackPoint: hits[0]?.point, trackLines: hits.map((hit) => hit.lineId) })
  }

  const hoveredStation = hover ? nearestStation(hover.world) : undefined
  const trackInsertion = hover && tool === 'station' && !hoveredStation ? selectableInsertions(game, hover.world, 11 / scale) : []
  const previewPoint = insertionPoint ?? trackInsertion[0]?.point ?? hover?.world
  const preview = previewPoint && (tool === 'move' || tool === 'station' && !hoveredStation)
    ? stationPreview(city, game, previewPoint, tool === 'move' ? selectedStation?.id : undefined) : undefined
  const moveQuote = preview && previewPoint && tool === 'move' && selectedStation
    ? relocationQuote(game, selectedStation.id, previewPoint) : undefined
  const stationQuote = trackInsertion[0] && quoteInsertion(game, trackInsertion[0].point, [trackInsertion[0].lineId])
  const previewCost = moveQuote?.cost ?? stationQuote?.cost ?? preview?.cost ?? 0
  const previewError = preview?.error ?? moveQuote?.error ?? stationQuote?.error ??
    (preview && !canAfford(game, previewCost) ? 'funds' : undefined)
  const oldDraftLine = draft && lineById.get(draft.id ?? '')
  const ghostId = 'hover-preview'
  let hoverDraft: LineDraft | undefined
  if (draft && hover && !panning && draft.stops.length) {
    const last = draft.pending.at(-1) ?? draftPosition(game, draft, draft.stops.at(-1)!)
    if (draft.control) hoverDraft = editControl(draft, draft.control, hover.world)
    else if ((!last || distance(last, hover.world) > 13 / scale) && (draft.kind === 'draw' || draft.insertion !== undefined) &&
        (!hoveredStation || !draft.stops.includes(hoveredStation.id) && !oldDraftLine?.stops.includes(hoveredStation.id))) {
      hoverDraft = appendDraftStop(draft, hoveredStation?.id ?? ghostId, hoveredStation ? undefined : hover.world)
    }
  }
  const hoverQuote = hoverDraft ? quoteLine(game, draftDesign(game, hoverDraft), oldDraftLine) : undefined
  const drawnQuote = hoverQuote ?? draftQuote
  const engineeringHit = hover && layer === 'engineering' && tool === 'select'
    ? trackHits(game.lines, hover.world, 12 / scale)[0] : undefined
  const roadVisible = scale >= 0.49
  const markerSize = Math.max(6.5, 7.2 / scale)
  const districts = cartography(city).districtDrawings
  const hour = minuteOfDay(game.minute) / 60
  const night = hour < 5 || hour >= 21 ? 0.16 : hour < 7 || hour >= 19 ? 0.07 : 0
  const chartColor = layerColors[layer]
  const scaleDistance = scale < 0.65 ? 100 : 50

  return <div className={'city-map tool-' + tool + (panning ? ' is-panning' : '')} ref={viewport}>
    <svg ref={svg} className="city-map-svg" data-testid="city-map" aria-label={t('map.name')} role="group" tabIndex={0}
      viewBox={[left, top, size.width / scale, size.height / scale].join(' ')}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={(event) => pointerUp(event, true)} onPointerLeave={() => setHover(undefined)}
      onContextMenu={(event) => event.preventDefault()}>
      <BaseMap city={city} development={game.growth} detail={roadVisible} labels={scale >= 0.36}
        flat={flat} landmarks={scale >= 1.03} t={t} />
      {night > 0 && <rect x={left} y={top} width={size.width / scale} height={size.height / scale} fill="#344c6b" opacity={night} pointerEvents="none" />}
      {layer !== 'standard' && layer !== 'congestion' && layer !== 'engineering' && <g pointerEvents="none">
        {city.districts.map((area, i) => {
          const density = populationOf(area, game) / (area.radius[0] * area.radius[1]) * 0.92
          const values = {
            population: density,
            demand: (game.districtDemand[area.id] ?? 0) / 130,
            coverage: reach.planned[area.id].fraction,
            accessibility: reach.active[area.id].fraction,
          }
          const value = values[layer]
          return value > 0 && <path key={area.id} d={districts[i].land}
            fill={chartColor} fillOpacity={0.09 + 0.53 * clamp(value, 0, 1)}
            stroke={chartColor} strokeWidth="1.3" strokeOpacity="0.35" />
        })}
      </g>}
      {(layer === 'coverage' || selectedStation) && <g pointerEvents="none">
        {(layer === 'coverage' ? game.stations : [selectedStation!]).map((station) => <circle key={station.id}
          cx={station.position.x} cy={station.position.y} r={stationRadius(station.level)}
          className="coverage-ring" vectorEffect="non-scaling-stroke" />)}
      </g>}
      {selected?.type === 'district' && <path pointerEvents="none" d={districts.find((area) => area.id === selected.id)?.land}
        fill="#2c8c76" fillOpacity="0.09" stroke="#2b7c6d" strokeDasharray="6 4" strokeWidth="2" />}
      <g className="rail-overlay" pointerEvents="none">
        {game.lines.map((line) => {
          const path = line.track.map((section) => trackPath(section.pieces)).join('')
          const highlight = selected?.type === 'line' && selected.id === line.id
          const dim = draft ? draft.id === line.id ? 0.24 : 0.56 : 1
          return <g key={line.id} opacity={dim} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d={path} stroke="#f9fcf5" strokeWidth={highlight ? 12 : 9.5} vectorEffect="non-scaling-stroke" />
            {layer !== 'engineering' ? <path data-testid="committed-track" data-line={line.id} d={path}
              stroke={line.color} strokeWidth={highlight ? 7.5 : 5.6} vectorEffect="non-scaling-stroke" /> :
              line.track.map((section, index) => {
                const following = line.track[index + 1] ?? (line.circular ? line.track[0] : undefined)
                const junction = following && !tangentsAgree(pieceTangent(section.pieces.at(-1)!, true), pieceTangent(following.pieces[0]))
                const legacyCurve = section.legacy && minimumRadius(section.pieces) === 0
                return <g key={sectionKey(section.from, section.to)}>
                  {section.pieces.map((piece, position) => <path key={position} d={trackPath([piece])}
                    stroke={trackColors[radiusStatus(legacyCurve ? 0 : minimumRadius([piece]))]}
                    strokeWidth={highlight ? 7.5 : 5.6} vectorEffect="non-scaling-stroke" />)}
                  {junction && <circle cx={section.pieces.at(-1)!.to.x} cy={section.pieces.at(-1)!.to.y}
                    r={11 / scale} stroke={trackColors.invalid} strokeWidth="3.3" vectorEffect="non-scaling-stroke"/>}
                </g>
              })}
          </g>
        })}
        {draft && <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5.5">
          {drawnQuote?.rows.map(({ section, radius, added }) => <path key={sectionKey(section.from, section.to)}
            data-testid={added ? 'planned-track' : undefined} d={trackPath(section.pieces)}
            stroke={added && radiusStatus(radius) === 'invalid' ? trackColors.invalid : draft.color}
            strokeDasharray={added ? '10 5' : undefined} opacity={added ? 1 : 0.65} vectorEffect="non-scaling-stroke" />)}
          {handles.map(({ point, key, index }) => <rect key={key + index} data-testid="track-control"
            x={point.x - 4.5 / scale} y={point.y - 4.5 / scale} width={9 / scale} height={9 / scale}
            transform={'rotate(45 ' + point.x + ' ' + point.y + ')'} fill={draft.control?.key === key && draft.control.index === index ? draft.color : '#fffef5'}
            stroke={draft.color} strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>)}
          {Object.values(draft.controls).flat().concat(draft.pending).map((point, index) => draft.kind === 'draw' &&
            <rect key={index} data-testid="track-control" x={point.x - 4 / scale} y={point.y - 4 / scale}
              width={8 / scale} height={8 / scale} transform={'rotate(45 ' + point.x + ' ' + point.y + ')'}
              fill="#fffdf6" stroke={draft.color} strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>)}
          {draft.stops.map((id, index) => {
            const point = draft.proposed[id]
            return point && <g key={id} data-testid="proposed-station" transform={'translate(' + point.x + ' ' + point.y + ')'}>
              <circle r={markerSize} fill="#fffff8" stroke={draft.color} strokeWidth="2.3" vectorEffect="non-scaling-stroke"/>
              <text y={0.55 / scale} textAnchor="middle" dominantBaseline="central" fontSize={9.5 / scale}
                fill={draft.color} className="station-order">{index + 1}</text>
            </g>
          })}
          {hoverDraft?.proposed[ghostId] && <circle cx={hoverDraft.proposed[ghostId].x} cy={hoverDraft.proposed[ghostId].y}
            r={markerSize} className={hoverQuote && hoverQuote.error && hoverQuote.error !== 'needsStops' ? 'ghost-station invalid' : 'ghost-station'}
            vectorEffect="non-scaling-stroke" />}
        </g>}
        {trains.map(({ train, line }) =>
          <AnimatedTrain key={train.id} train={train} line={line} station={stations.get(line.stops[train.at])!} scale={scale}/>)}
      </g>
      {suggestions.map((point, index) => <g key={index} pointerEvents="none" transform={'translate(' + point.x + ' ' + point.y + ')'}>
        <circle r={21 / scale} className="suggested-ring" vectorEffect="non-scaling-stroke" />
        <path d={pathString([{ x: -7 / scale, y: 0 }, { x: 7 / scale, y: 0 }]) +
          pathString([{ x: 0, y: -7 / scale }, { x: 0, y: 7 / scale }])} fill="none" stroke="#147e6c" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </g>)}
      {game.stations.map((station) => {
        const lines = linesAt.get(station.id) ?? []
        const shared = lines.length > 1
        const transfer = shared && station.interchange
        const order = draft?.stops.indexOf(station.id) ?? -1
        const active = selectedStation?.id === station.id
        const color = order >= 0 ? draft!.color : shared ? '#264b49' : lines[0]?.color ?? '#44736c'
        const pressure = waitingAt(game, station.id) / stationCapacity(station)
        const label = stationLabel(game, station, t)
        const { x, y } = station.position
        return <g key={station.id} role="button" tabIndex={0} aria-label={label} data-testid="map-station"
          data-id={station.id} transform={'translate(' + x + ' ' + y + ')'} className="map-station"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            if (tool === 'line') addStop(station.id)
            else clickMap({ point: station.position, selection: { type: 'station', id: station.id } })
          }}>
          <circle r={Math.max(14, 14 / scale)} fill="transparent" />
          {layer === 'congestion' && pressure > 0 && <circle r={(22 + pressure * 36) / scale}
            fill={chartColor} opacity={0.18 + pressure * 0.33} stroke={chartColor} strokeWidth="1.6" />}
          {(active || hoveredStation?.id === station.id) && <circle r={markerSize + 6 / scale} fill="#b5e4d1"
            stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
          <circle r={markerSize} fill="#fffff9" stroke={color} strokeWidth={transfer ? 3 : 2.4} vectorEffect="non-scaling-stroke" />
          {shared && !transfer && <circle r={markerSize * 0.49} fill={lines[0].color} />}
          {transfer && <circle r={markerSize * 0.5} fill="none" stroke={color} strokeWidth="1.35" vectorEffect="non-scaling-stroke" />}
          {order >= 0 && <text y={0.55 / scale} textAnchor="middle" dominantBaseline="central"
            fontSize={9.5 / scale} fill={draft!.color} className="station-order">{order + 1}</text>}
          {pressure >= 0.83 && <circle cx={markerSize * 0.92} cy={-markerSize * 0.92} r={3.2 / scale}
            fill="#cc5d43" stroke="#fcfff7" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />}
          {(active || hoveredStation?.id === station.id || (scale > 0.94 && !draft)) && <text x={0} y={-markerSize - 9 / scale} textAnchor="middle"
            className="station-name" fontSize={12 / scale}>{label}</text>}
        </g>
      })}
      {previewPoint && preview && <g pointerEvents="none" transform={'translate(' + previewPoint.x + ' ' + previewPoint.y + ')'}>
        <circle r={preview.radius} className={'coverage-ring ' + (previewError ? 'invalid' : 'preview')} vectorEffect="non-scaling-stroke" />
        <circle r={markerSize} className={previewError ? 'ghost-station invalid' : 'ghost-station'} vectorEffect="non-scaling-stroke" />
      </g>}
    </svg>

    <div className="map-layer-control">
      <Layers3 size={16} aria-hidden="true" />
      <select aria-label={t('map.layers')} value={layer} onChange={(event) => setLayer(event.target.value as Layer)}>
        {layers.map((item) => <option key={item} value={item}>{t('layer.' + item)}</option>)}
      </select>
      <button type="button" className="view-switch" aria-label={t(flat ? 'map.showCity' : 'map.showPlan')}
        title={t(flat ? 'map.showCity' : 'map.showPlan')} aria-pressed={!flat} onClick={toggleView}>
        {flat ? <MapIcon size={16}/> : <Building2 size={16}/>}<span>{t(flat ? 'map.planView' : 'map.cityView')}</span>
      </button>
    </div>
    <div className="map-mapkey">
      {layer === 'engineering' ? <EngineeringLegend/> : layer === 'standard' ? <div className="map-scale" aria-hidden="true">
        <span style={{ width: scaleDistance * scale }}>{t('map.meters', { value: unitsToMeters(scaleDistance) })}</span>
      </div> : <div className="layer-key" style={{ '--layer-color': chartColor } as React.CSSProperties}>
        <span>{t('map.low')}</span><i /><span>{t('map.high')}</span>
      </div>}
      <span className="pan-tip"><Hand size={13} />{t('map.panTip')}</span>
    </div>
    <div className="map-navigation">
      <button type="button" className="compass-button" title={t('map.reset')} aria-label={t('map.reset')} onClick={reset}>
        <Compass size={21} />
      </button>
      <div className="zoom-stack">
        <button type="button" title={t('map.zoomIn')} aria-label={t('map.zoomIn')} onClick={() => zoomBy(1.25)}><Plus size={18}/></button>
        <button type="button" title={t('map.zoomOut')} aria-label={t('map.zoomOut')} onClick={() => zoomBy(0.8)}><Minus size={18}/></button>
      </div>
    </div>

    {hover && preview && !panning && !insertionPoint && <div className={'map-build-tip' + (previewError ? ' invalid' : '')}
      style={{ left: clamp(hover.screen.x + 20, 8, Math.max(8, size.width - 218)),
        top: clamp(hover.screen.y + 20, 8, Math.max(8, size.height - 126)) }}>
      <strong>{trackInsertion.length ? t('engineering.insertStation') : stationNameAt(game, previewPoint!, t)}</strong>
      {previewError ? <span>{t('error.' + previewError)}</span> : <>
        <span>{t('station.servedEstimate', { population: number(preview.population, locale), jobs: number(preview.jobs, locale) })}</span>
        <b>{money(previewCost, locale)}</b>
      </>}
    </div>}
    {tool === 'select' && !panning && hover && hoveredStation && layer !== 'engineering' && <div className="map-hover-label"
      style={{ left: clamp(hover.screen.x + 12, 8, Math.max(8, size.width - 155)), top: Math.min(hover.screen.y + 15, size.height - 44) }}>
      {linesAt.get(hoveredStation.id)?.map((line) => <span style={{ color: line.color }} key={line.id}>{lineCode(line)}</span>)}
      {t('station.waitingShort', { count: waitingAt(game, hoveredStation.id) })}
    </div>}
    {hover && engineeringHit && !panning && <div className="map-build-tip engineering-inspection" style={{
      left: clamp(hover.screen.x + 16, 8, Math.max(8, size.width - 224)),
      top: clamp(hover.screen.y + 16, 8, size.height - 125),
    }}>
      <strong>{lineLabel(lineById.get(engineeringHit.lineId)!, t, false, game)}</strong>
      <span>{t('engineering.radius')} {minimumRadius(engineeringHit.section.pieces) === null ? t('engineering.straight') :
        t('map.meters', { value: number(minimumRadius(engineeringHit.section.pieces)!, locale) })}</span>
      <span>{t('engineering.length')} {t('common.metros', { value: number(unitsToMeters(trackLength(engineeringHit.section.pieces)) / 1000, locale) })}</span>
      <span>{t('engineering.design')} {t('train.kmh', { value: ENGINEERING.designSpeedKmh })}</span>
      <span>{engineeringHit.section.legacy && minimumRadius(engineeringHit.section.pieces) === 0 ? t('engineering.legacy') :
        t('engineering.limit') + ' ' + t('train.kmh', { value: number(curveSpeedKmh(minimumRadius(engineeringHit.section.pieces)), locale) })}</span>
    </div>}
    {draft && draftQuote && <DrawControls game={game} draft={draft} quote={draftQuote} preview={hoverQuote}
      choose={chooseDraftLine} commit={commitLine} cancel={cancelDraft} smooth={smooth} toggleControl={toggleControl}/>}
    {selected?.type === 'train' && trains.filter(({ train }) => train.id === selected.id).map(({ train, point }) =>
      <div key={train.id} className="map-train-label" style={{ left: (point.x - left) * scale, top: (point.y - top) * scale }}>{trainCode(train)}</div>)}
  </div>
}
