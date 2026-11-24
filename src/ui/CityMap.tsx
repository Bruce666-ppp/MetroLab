import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Compass, Hand, Layers3, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCity, districtAt, minuteOfDay, populationOf } from '../engine/city.ts'
import { relocationCost } from '../engine/actions.ts'
import { canAfford } from '../engine/economy.ts'
import { clamp, distance, interpolate, octilinear, pathString } from '../engine/geometry.ts'
import { pairsOf, stationCapacity, stationPreview, stationRadius, waitingAt } from '../engine/network.ts'
import { layers } from '../engine/save.ts'
import { trainPosition } from '../engine/trains.ts'
import type { GameState, Layer, Point, Station } from '../engine/types.ts'
import type { networkReach } from '../engine/analytics.ts'
import { BaseMap, layerColors } from './BaseMap.tsx'
import { cartography } from './cartography.ts'
import { lineCode, money, number, stationLabel, trainCode } from './format.ts'
import type { LineDraft, MapTarget, Selection, Tool } from './interaction.ts'

interface Props {
  game: GameState
  reach: ReturnType<typeof networkReach>
  layer: Layer
  setLayer: (layer: Layer) => void
  tool: Tool
  selected: Selection
  draft?: LineDraft
  suggestions: Point[]
  clickMap: (target: MapTarget) => void
  addStop: (id: string) => void
}

interface Camera extends Point { zoom: number }
type Gesture = { x: number; y: number; camera: Camera; pointer: number; kind: 'pan' | 'draw'; last?: string }
const extent = (city: { width: number; height: number }): Camera => ({ x: city.width * 0.5, y: city.height * 0.5, zoom: 1 })

function segmentDistance(point: Point, a: Point, b: Point) {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  const fraction = lengthSquared ? ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared : 0
  return distance(point, interpolate(a, b, clamp(fraction, 0, 1)))
}

export function CityMap({ game, reach, layer, setLayer, tool, selected, draft, suggestions, clickMap, addStop }: Props) {
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
    let closest = 8.5 / scale
    let picked: Selection
    for (const line of game.lines) {
      for (const [a, b] of pairsOf(line.stops, line.circular)) {
        const points = octilinear(stations.get(a)!.position, stations.get(b)!.position)
        for (let i = 1; i < points.length; i++) {
          const distanceToLine = segmentDistance(point, points[i - 1], points[i])
          if (distanceToLine < closest) {
            picked = { type: 'line', id: line.id }
            closest = distanceToLine
          }
        }
      }
    }
    if (picked) return picked
    const district = districtAt(city, point)
    return district.score < 1.23 ? { type: 'district', id: district.area.id } : undefined
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button > 2 || gesture.current) return
    const marker = tool === 'line' && event.button === 0 ? nearestStation(coordinates(event).world) : undefined
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
    clickMap({ point: world, selection: targetAt(world) })
  }

  const preview = hover && (tool === 'station' || tool === 'move')
    ? stationPreview(city, game, hover.world, tool === 'move' ? selectedStation?.id : undefined) : undefined
  const previewCost = preview && hover && tool === 'move' && selectedStation
    ? relocationCost(game, selectedStation.id, hover.world) : preview?.cost ?? 0
  const previewError = preview?.error ?? (preview && !canAfford(game, previewCost) ? 'funds' : undefined)
  const hoveredStation = hover ? nearestStation(hover.world) : undefined
  const draftEnd = draft && stations.get(draft.stops.at(-1) ?? '')
  const draftHover = draft && hoveredStation && !draft.stops.includes(hoveredStation.id) ? hoveredStation : undefined
  const roadVisible = scale >= 0.49
  const markerSize = Math.max(6.5, 7.2 / scale)
  const districts = cartography(city).districtDrawings
  const hour = minuteOfDay(game.minute) / 60
  const night = hour < 5 || hour >= 21 ? 0.16 : hour < 7 || hour >= 19 ? 0.07 : 0
  const chartColor = layerColors[layer]
  const scaleDistance = scale < 0.65 ? 100 : 50

  return <div className={'city-map tool-' + tool + (panning ? ' is-panning' : '')} ref={viewport}>
    <svg ref={svg} className="city-map-svg" data-testid="city-map" aria-label={t('map.name')} role="group"
      viewBox={[left, top, size.width / scale, size.height / scale].join(' ')}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={(event) => pointerUp(event, true)} onPointerLeave={() => setHover(undefined)}
      onContextMenu={(event) => event.preventDefault()}>
      <BaseMap city={city} development={game.growth} detail={roadVisible} labels={scale >= 0.36} t={t} />
      {night > 0 && <rect x={left} y={top} width={size.width / scale} height={size.height / scale} fill="#344c6b" opacity={night} pointerEvents="none" />}
      {layer !== 'standard' && layer !== 'congestion' && <g pointerEvents="none">
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
          const path = pairsOf(line.stops, line.circular).map(([a, b]) => pathString(octilinear(stations.get(a)!.position, stations.get(b)!.position))).join('')
          const highlight = selected?.type === 'line' && selected.id === line.id
          const dim = draft ? draft.id === line.id ? 0.24 : 0.56 : 1
          return <g key={line.id} opacity={dim} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d={path} stroke="#f9fcf5" strokeWidth={highlight ? 12 : 9.5} vectorEffect="non-scaling-stroke" />
            <path d={path} stroke={line.color} strokeWidth={highlight ? 7.5 : 5.6} vectorEffect="non-scaling-stroke" />
          </g>
        })}
        {draft && <g fill="none" stroke={draft.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="6">
          {pairsOf(draft.stops, draft.circular).map(([a, b]) => <path key={a + b}
            d={pathString(octilinear(stations.get(a)!.position, stations.get(b)!.position))}
            strokeDasharray="9 6" vectorEffect="non-scaling-stroke" />)}
          {draftEnd && draftHover && <path d={pathString(octilinear(draftEnd.position, draftHover.position))}
            strokeDasharray="5 5" opacity="0.55" vectorEffect="non-scaling-stroke" />}
        </g>}
        {trains.map(({ train, line, point }) => <g key={train.id} data-testid="map-train" data-train={train.id}
          style={{ transform: 'translate(' + point.x + 'px,' + point.y + 'px)', transformOrigin: '0 0' }} className="train-dot">
          <rect transform={'rotate(' + point.angle + ')'} x={-11 / scale} y={-4 / scale} width={22 / scale}
            height={8 / scale} rx={3.5 / scale} stroke="#f7fff5" fill={line.color} strokeWidth="1.65" vectorEffect="non-scaling-stroke" />
        </g>)}
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
      {hover && preview && <g pointerEvents="none" transform={'translate(' + hover.world.x + ' ' + hover.world.y + ')'}>
        <circle r={preview.radius} className={'coverage-ring ' + (previewError ? 'invalid' : 'preview')} vectorEffect="non-scaling-stroke" />
        <circle r={markerSize} className={previewError ? 'ghost-station invalid' : 'ghost-station'} vectorEffect="non-scaling-stroke" />
      </g>}
    </svg>

    <div className="map-layer-control">
      <Layers3 size={16} aria-hidden="true" />
      <select aria-label={t('map.layers')} value={layer} onChange={(event) => setLayer(event.target.value as Layer)}>
        {layers.map((item) => <option key={item} value={item}>{t('layer.' + item)}</option>)}
      </select>
    </div>
    <div className="map-mapkey">
      {layer === 'standard' ? <div className="map-scale" aria-hidden="true">
        <span style={{ width: scaleDistance * scale }}>{t('map.meters', { value: scaleDistance * 10 })}</span>
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

    {hover && preview && !panning && <div className={'map-build-tip' + (previewError ? ' invalid' : '')}
      style={{ left: clamp(hover.screen.x + 20, 8, Math.max(8, size.width - 218)),
        top: clamp(hover.screen.y + 20, 8, Math.max(8, size.height - 126)) }}>
      <strong>{t('district.' + preview.district)}</strong>
      {previewError ? <span>{t('error.' + previewError)}</span> : <>
        <span>{t('station.servedEstimate', { population: number(preview.population, locale), jobs: number(preview.jobs, locale) })}</span>
        <b>{money(previewCost, locale)}</b>
      </>}
    </div>}
    {tool === 'select' && !panning && hover && hoveredStation && <div className="map-hover-label"
      style={{ left: clamp(hover.screen.x + 12, 8, Math.max(8, size.width - 155)), top: Math.min(hover.screen.y + 15, size.height - 44) }}>
      {linesAt.get(hoveredStation.id)?.map((line) => <span style={{ color: line.color }} key={line.id}>{lineCode(line)}</span>)}
      {t('station.waitingShort', { count: waitingAt(game, hoveredStation.id) })}
    </div>}
    {selected?.type === 'train' && trains.filter(({ train }) => train.id === selected.id).map(({ train, point }) =>
      <div key={train.id} className="map-train-label" style={{ left: (point.x - left) * scale, top: (point.y - top) * scale }}>{trainCode(train)}</div>)}
  </div>
}
