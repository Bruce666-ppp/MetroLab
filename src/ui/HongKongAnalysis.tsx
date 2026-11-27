import { memo, useMemo } from 'react'
import { hongKong, walkCells } from '../engine/hongKong.ts'
import { demandDirections, demandSurface } from '../engine/hongKongDemand.ts'
import { coveredCells } from '../engine/network.ts'
import type { Layer, Point, Station } from '../engine/types.ts'
import { layerColors } from './BaseMap.tsx'
import { mapPath } from './HongKongMap.tsx'

const areas = hongKong.zones.map((zone) => mapPath(zone.shape))
const land = mapPath(hongKong.map.land)
const size = hongKong.map.cellSize
const zonesById = new Map(hongKong.zones.map((zone, index) => [zone.id, index]))

export const HongKongAnalysis = memo(function HongKongAnalysis({ layer, hour, stations, served, zone, station, preview }: {
  layer: Layer; hour: number; stations: Station[]; served: Set<string>; zone?: string; station?: Station; preview?: Point
}) {
  const model = useMemo(() => layer === 'demand' ? demandSurface(hour * 60) : [], [layer, hour])
  const coverageLayer = layer === 'coverage' || layer === 'accessibility'
  const shaded = layer === 'population' || layer === 'employment' || coverageLayer
  const covered = useMemo(() => coverageLayer ? coveredCells(layer === 'coverage' ? stations : stations.filter((stop) => served.has(stop.id))) :
    station ? coveredCells([station]) : new Map(), [coverageLayer, layer, station, stations, served])
  const prospective = useMemo(() => preview ? walkCells(preview, station?.level ?? 1) : undefined, [preview, station?.level])
  const grid = new Map<string, { value: number; x: number; y: number }>()
  if (shaded || station || prospective) for (const [index, cell] of hongKong.cells.entries()) {
    const colorValue = layer === 'population' ? cell.residents / 2900 : layer === 'employment' ? cell.jobs / 4300 : 0
    const accessValue = prospective?.has(index) || covered.has(index) ? .84 : 0
    const value = Math.max(colorValue, accessValue)
    if (!value) continue
    const key = cell.column + ',' + cell.row
    const existing = grid.get(key)
    if (existing) existing.value = Math.min(1, existing.value + value)
    else grid.set(key, { value, x: cell.column * size, y: cell.row * size })
  }
  const selected = zone && zonesById.get(zone)
  const region = typeof selected === 'number' ? hongKong.zones[selected] : undefined
  const preferred = layer === 'demand' && region ? demandDirections(region.id, hour * 60).destinations : []
  const maximum = preferred[0]?.trips ?? 1
  return <g pointerEvents="none" className="hk-analysis" aria-hidden="true">
    {(grid.size > 0 || model.length > 0) && <defs><clipPath id="hk-analysis-land"><path d={land} fillRule="evenodd"/></clipPath></defs>}
    {grid.size > 0 && <g clipPath="url(#hk-analysis-land)">{Array.from(grid, ([key, { value, x, y }]) =>
      <rect key={key} x={x} y={y} width={size} height={size} fill={shaded ? layerColors[layer] : layerColors.coverage}
        opacity={Math.min(.73, .11 + value * .62)} stroke="#faf5e5" strokeWidth=".35"/>)}</g>}
    {model.length > 0 && <g clipPath="url(#hk-analysis-land)">{model.map((value, index) => value >= 1 &&
      <path key={index} d={areas[index]} fill={layerColors.demand} fillRule="evenodd"
        fillOpacity={Math.min(.69, .12 + value / 1700)} stroke="#b77842" strokeWidth=".75"/>)}</g>}
    {typeof selected === 'number' && <path d={areas[selected]} fill="#23856b" fillRule="evenodd" fillOpacity=".14"
      stroke="#267963" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>}
    {region && preferred.length > 0 && <g data-testid="hk-demand-directions">
      <defs><marker id="hk-demand-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.8" markerHeight="3.8" orient="auto">
        <path d="M0 0L10 5L0 10Z" fill="#905627"/>
      </marker></defs>
      {preferred.map(({ id, trips, point }) => {
        const x = region.center.x, y = region.center.y
        const bend = Math.min(45, Math.hypot(point.x - x, point.y - y) / 7)
        return <path key={id} d={`M${x},${y}Q${(x + point.x) / 2 + bend},${(y + point.y) / 2 - bend} ${point.x},${point.y}`}
          stroke="#a3632e" strokeWidth={1.45 + trips / maximum * 2.8} fill="none" strokeOpacity={.85}
          markerEnd="url(#hk-demand-arrow)" vectorEffect="non-scaling-stroke"/>
      })}
    </g>}
  </g>
})
