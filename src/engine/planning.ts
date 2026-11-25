import { alignTrack, legacyRestricted, sectionKey, trackHits } from './alignment.ts'
import { getCity } from './city.ts'
import { canAfford, INTERCHANGE_PRICE, measurePieces } from './economy.ts'
import { distance } from './geometry.ts'
import { DWELL, pairsOf, stationPreview, TRAIN_SPEED } from './network.ts'
import { curveSpeedKmh, ENGINEERING, radiusStatus, trackLength, trackProfile } from './track.ts'
import type { City, GameState, Line, LineDesign, Point, Station } from './types.ts'

export type PlanningError = 'outOfBounds' | 'water' | 'tooClose' | 'invalidStops' | 'needsStops' |
  'invalidColor' | 'curve' | 'controlPoint' | 'noTrack' | 'differentTrack' | 'funds'

export const maxNameLength = 36
export const colorPattern = /^#[a-f\d]{6}$/i
export const roundPoint = (point: Point) => ({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 })

export function newStation(city: City, game: GameState, point: Point, id: string, number: number): Station | PlanningError {
  const preview = stationPreview(city, game, point)
  if (preview.error) return preview.error
  return { id, number, name: '', position: point, district: preview.district, level: 1, interchange: false, builtCost: preview.cost }
}

export function selectableInsertions(game: GameState, point: Point, tolerance: number) {
  const primary = trackHits(game.lines, point, tolerance)[0]
  if (!primary) return []
  return trackHits(game.lines, primary.point, 0.012)
}

export function quoteInsertion(game: GameState, point: Point, lineIds: string[]) {
  const city = getCity(game.cityId)
  const selected = game.lines.filter((line) => lineIds.includes(line.id))
  const hits = trackHits(selected, point, 0.025)
  if (!hits.length) return { error: 'noTrack' as const }
  if (hits.length !== lineIds.length || hits.some((hit) => distance(hit.point, hits[0].point) > 0.012 ||
      hit.offset < 0.01 || hit.offset > trackLength(hit.section.pieces) - 0.01)) {
    return { error: 'differentTrack' as const }
  }
  const station = newStation(city, game, hits[0].point, 'station-' + game.nextId, game.nextId)
  if (typeof station === 'string') return { error: station }
  const interchange = hits.length > 1
  const cost = station.builtCost + (interchange ? INTERCHANGE_PRICE : 0)
  return { station: { ...station, interchange }, hits, cost, error: canAfford(game, cost) ? undefined : 'funds' as const }
}

export function quoteLine(game: GameState, design: LineDesign, existing?: Line) {
  const city = getCity(game.cityId)
  const newStations: Station[] = []
  const positions = new Map(game.stations.map((station) => [station.id, station.position]))
  let error: PlanningError | undefined
  const invalid = (reason: PlanningError) => { error ??= reason }
  const seen = new Set<string>()
  for (const stop of design.stops) {
    if (seen.has(stop)) invalid('invalidStops')
    seen.add(stop)
    if (positions.has(stop)) continue
    const proposed = design.proposed?.[stop]
    if (!proposed) {
      invalid('invalidStops')
      continue
    }
    const point = roundPoint(proposed)
    positions.set(stop, point)
    const station = newStation(city, { ...game, stations: game.stations.concat(newStations) }, point, stop, game.nextId + newStations.length)
    if (typeof station === 'string') invalid(station)
    else newStations.push(station)
  }
  if (design.stops.length < (design.circular ? 3 : 2)) invalid('needsStops')
  if (!colorPattern.test(design.color)) invalid('invalidColor')
  const controls = pairsOf(design.stops, design.circular).flatMap(([from, to]) =>
    design.controls?.[sectionKey(from, to)] ?? design.controls?.[sectionKey(to, from)] ?? [])
  const goodControls = controls.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= city.width && point.y >= 0 && point.y <= city.height)
  if (!goodControls) invalid('controlPoint')
  const rows = goodControls && design.stops.every((stop) => positions.has(stop) &&
    Number.isFinite(positions.get(stop)!.x) && Number.isFinite(positions.get(stop)!.y))
    ? alignTrack(positions, design, existing) : []
  if (rows.some((row) => row.added && radiusStatus(row.radius) === 'invalid')) invalid('curve')
  const interchanges = design.autoInterchanges ? game.stations.filter((station) =>
    !station.interchange && seen.has(station.id) && !existing?.stops.includes(station.id) &&
    game.lines.some((line) => line.id !== existing?.id && line.stops.includes(station.id))) : []
  const cost = rows.reduce((sum, row) => sum + (row.added ? measurePieces(city, row.section.pieces).price : 0), 0) +
    newStations.reduce((sum, station) => sum + station.builtCost, 0) + interchanges.length * INTERCHANGE_PRICE
  if (!canAfford(game, cost)) invalid('funds')
  const radii = rows.flatMap((row) => row.added && row.radius !== null ? [row.radius] : [])
  const allRadii = rows.flatMap((row) => row.junction ? [0] : row.radius !== null ? [row.radius] : [])
  const radius = radii.length ? Math.min(...radii) : null
  const length = rows.reduce((total, row) => total + trackLength(row.section.pieces), 0)
  const curvedSpeeds = rows.flatMap((row) => row.radius !== null && row.radius > 0 ? [curveSpeedKmh(row.radius)] : [])
  const travel = rows.reduce((total, row) => row.radius === 0 && row.added ? total :
    total + trackProfile(row.section, TRAIN_SPEED, 1).duration + DWELL, 0)
  return { rows, newStations, interchanges, cost, radius, totalRadius: allRadii.length ? Math.min(...allRadii) : null,
    length, limit: Math.min(ENGINEERING.designSpeedKmh, ...curvedSpeeds), travel,
    legacy: Boolean(existing && legacyRestricted(existing) && rows.some((row) => row.section.legacy)), error }
}
