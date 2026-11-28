import { alignTrack, allTrack, headAnchor, legacyRestricted, openEndOf, sectionKey, tailAnchor, trackHits } from './alignment.ts'
import { getCity } from './city.ts'
import { canAfford, HKD, interchangePrice, measurePieces, trackMethods } from './economy.ts'
import type { EngineeringError } from './economy.ts'
import { distance } from './geometry.ts'
import { hongKongName, hongKongSiteSurface } from './hongKong.ts'
import { DWELL, pairsOf, stationPreview, stationSiteError, TRAIN_SPEED } from './network.ts'
import type { StationSiteError } from './network.ts'
import { curveSpeedKmh, ENGINEERING, pieceLength, radiusStatus, trackLength, trackProfile } from './track.ts'
import type { City, GameState, Line, LineDesign, Point, Station, TrackMethod, TrackSection } from './types.ts'

export type PlanningError = StationSiteError | 'tooClose' | 'invalidStops' | 'needsStops' |
  'invalidColor' | 'curve' | 'controlPoint' | 'noTrack' | 'differentTrack' | 'funds' | 'invalidMethod' | 'openLoop' | 'waterAlignmentEnd' |
  EngineeringError

export const maxNameLength = 36
export const colorPattern = /^#[a-f\d]{6}$/i
export const roundPoint = (point: Point) => ({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 })

export function openEndPoints(line?: Line) {
  const head = line?.openEnds?.head, tail = line?.openEnds?.tail
  return { head: head ? [head.pieces[0].from, ...head.controls, ...(line?.stops.length ? [] : [head.pieces.at(-1)!.to])] : undefined,
    tail: tail ? [...tail.controls, tail.pieces.at(-1)!.to] : undefined }
}

export function waterTrackEnds(section: TrackSection) {
  const ends: { side: 'head' | 'tail'; point: Point }[] = []
  if (section.from === headAnchor) ends.push({ side: 'head', point: section.pieces[0].from })
  if (section.to === tailAnchor) ends.push({ side: 'tail', point: section.pieces.at(-1)!.to })
  return ends.filter(({ point }) => hongKongSiteSurface(point) === 'water')
}

export function newStation(city: City, game: GameState, point: Point, id: string, number: number, method: TrackMethod = 'underground'): Station | PlanningError {
  if (!trackMethods.includes(method)) return 'invalidMethod'
  const preview = stationPreview(city, game, point, undefined, method)
  if (preview.error) return preview.error
  return { id, number, name: '', position: point, district: preview.district, level: 1, interchange: false, builtCost: preview.cost,
    ...(city.hongKong ? { method, names: hongKongName(point, game.stations) } : {}) }
}

export function selectableInsertions(game: GameState, point: Point, tolerance: number) {
  const primary = trackHits(game.lines, point, tolerance)[0]
  if (!primary) return []
  return trackHits(game.lines, primary.point, 0.012)
}

export function quoteInsertion(game: GameState, point: Point, lineIds: string[]) {
  const city = getCity(game.cityId)
  const siteError = city.hongKong && stationSiteError(city, point)
  if (siteError) return { error: siteError }
  const selected = game.lines.filter((line) => lineIds.includes(line.id))
  const hits = trackHits(selected, point, 0.025)
  if (!hits.length) return { error: 'noTrack' as const }
  if (hits.length !== lineIds.length || hits.some((hit) => distance(hit.point, hits[0].point) > 0.012 ||
      hit.offset < 0.01 || hit.offset > trackLength(hit.section.pieces) - 0.01)) {
    return { error: 'differentTrack' as const }
  }
  const methods = hits.map((hit) => {
    let end = 0
    const piece = hit.section.pieces.find((piece) => {
      end += pieceLength(piece)
      return end >= hit.offset
    })
    return piece?.method ?? hit.section.method ?? 'underground'
  })
  const method = trackMethods.find((method) => methods.includes(method)) ?? 'underground'
  const station = newStation(city, game, hits[0].point, 'station-' + game.nextId, game.nextId, method)
  if (typeof station === 'string') return { error: station }
  const interchange = hits.length > 1
  const cost = station.builtCost + (interchange ? interchangePrice(game) : 0)
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
    const siteError = city.hongKong && stationSiteError(city, proposed)
    const station = siteError || newStation(city, { ...game, stations: game.stations.concat(newStations) }, point, stop,
      game.nextId + newStations.length, design.stationMethods?.[stop] ?? design.method)
    if (typeof station === 'string') invalid(station)
    else newStations.push(station)
  }
  const open = city.hongKong ? design.alignmentEnds ?? openEndPoints(existing) : {}
  const heads = open.head?.map(roundPoint) ?? []
  const tails = open.tail?.map(roundPoint) ?? []
  const hasOpen = heads.length > 0 || tails.length > 0
  const openOnly = !design.stops.length && heads.length >= 2
  if (design.circular && hasOpen) invalid('openLoop')
  if (design.stops.length < (design.circular ? 3 : 2) && !(city.hongKong && (openOnly || design.stops.length === 1 && hasOpen))) invalid('needsStops')
  if (!colorPattern.test(design.color)) invalid('invalidColor')
  const route = design.stops.slice()
  const handles = { ...design.controls }
  if (openOnly) {
    positions.set(headAnchor, heads[0])
    positions.set(tailAnchor, heads.at(-1)!)
    route.push(headAnchor, tailAnchor)
    handles[sectionKey(headAnchor, tailAnchor)] = heads.slice(1, -1)
  } else if (route.length) {
    if (heads.length) {
      positions.set(headAnchor, heads[0])
      handles[sectionKey(headAnchor, route[0])] = heads.slice(1)
      route.unshift(headAnchor)
    }
    if (tails.length) {
      positions.set(tailAnchor, tails.at(-1)!)
      handles[sectionKey(route.at(-1)!, tailAnchor)] = tails.slice(0, -1)
      route.push(tailAnchor)
    }
  }
  if (city.hongKong) {
    for (const anchor of [headAnchor, tailAnchor]) {
      const point = positions.get(anchor)
      if (!point) continue
      const surface = hongKongSiteSurface(point)
      if (surface === 'water') invalid('waterAlignmentEnd')
      if (surface === 'outside') invalid('outsideArea')
    }
  }
  const controls = pairsOf(route, design.circular).flatMap(([from, to]) =>
    handles[sectionKey(from, to)] ?? handles[sectionKey(to, from)] ?? [])
  const goodControls = controls.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= city.width && point.y >= 0 && point.y <= city.height)
  if (!goodControls) invalid('controlPoint')
  const prior = existing && { ...existing, track: allTrack(existing) }
  const rows = goodControls && route.every((stop) => positions.has(stop) &&
    Number.isFinite(positions.get(stop)!.x) && Number.isFinite(positions.get(stop)!.y))
    ? alignTrack(positions, { ...design, stops: route, controls: handles }, prior) : []
  const infrastructure = { underground: 0, elevated: 0, atGrade: 0, terrain: 0, water: 0, track: 0 }
  for (const row of rows) {
    const section = row.section
    const key = sectionKey(section.from, section.to)
    const reverse = sectionKey(section.to, section.from)
    const nextMethod = design.methods?.[key] ?? design.methods?.[reverse]
    const previous = prior?.track.find((entry) => (entry.from === section.from && entry.to === section.to) ||
      (entry.to === section.from && entry.from === section.to))
    const method = nextMethod ?? section.method ?? previous?.method ?? design.method ?? 'underground'
    if (!trackMethods.includes(method)) { invalid('invalidMethod'); continue }
    if (city.hongKong && (row.added || nextMethod && nextMethod !== section.method)) {
      row.added = true
      const pieces = section.pieces.map((piece) => ({ ...piece, method }))
      row.section = { ...section, method, pieces }
    }
    if (!row.added) continue
    const measure = measurePieces(city, row.section.pieces, method)
    if (measure.error) invalid(measure.error)
    for (const method of trackMethods) infrastructure[method] += measure.methods[method]
    infrastructure.terrain += measure.terrain
    infrastructure.water += measure.waterPremium
    infrastructure.track += measure.price
    if (city.hongKong) row.section = { ...row.section, builtCost: measure.price }
  }
  if (rows.some((row) => row.added && radiusStatus(row.radius) === 'invalid')) invalid('curve')
  const interchanges = design.autoInterchanges ? game.stations.filter((station) =>
    !station.interchange && seen.has(station.id) && !existing?.stops.includes(station.id) &&
    game.lines.some((line) => line.id !== existing?.id && line.stops.includes(station.id))) : []
  const stationsCost = newStations.reduce((sum, station) => sum + station.builtCost, 0)
  const interchangeCost = interchanges.length * interchangePrice(game)
  const cost = infrastructure.track + stationsCost + interchangeCost
  if (!canAfford(game, cost)) invalid('funds')
  const radii = rows.flatMap((row) => row.added && row.radius !== null ? [row.radius] : [])
  const allRadii = rows.flatMap((row) => row.junction ? [0] : row.radius !== null ? [row.radius] : [])
  const radius = radii.length ? Math.min(...radii) : null
  const length = rows.reduce((total, row) => total + trackLength(row.section.pieces), 0)
  const curvedSpeeds = rows.flatMap((row) => row.radius !== null && row.radius > 0 ? [curveSpeedKmh(row.radius)] : [])
  const methodSpeeds = rows.flatMap(({ section }) => section.pieces.flatMap(({ method }) => method ? [HKD.methods[method].speedKmh] : []))
  const travel = rows.reduce((total, row) => openEndOf(row.section) || row.radius === 0 && row.added ? total :
    total + trackProfile(row.section, TRAIN_SPEED, 1).duration + DWELL, 0)
  return { rows, newStations, interchanges, cost, infrastructure, stationsCost, interchangeCost, remaining: game.funds - cost,
    radius, totalRadius: allRadii.length ? Math.min(...allRadii) : null,
    length, limit: Math.min(ENGINEERING.designSpeedKmh, ...curvedSpeeds, ...methodSpeeds), travel,
    legacy: Boolean(existing && legacyRestricted(existing) && rows.some((row) => row.section.legacy)), error }
}
