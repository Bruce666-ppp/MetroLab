import { alignThrough, alignTrack, allTrack, headAnchor, legacyRestricted, openEndOf, sectionKey, tailAnchor, trackHits } from './alignment.ts'
import { getCity } from './city.ts'
import { canAfford, HKD, interchangePrice, measurePieces, trackMethods, trackUpkeepMinute } from './economy.ts'
import type { EngineeringError } from './economy.ts'
import { distance } from './geometry.ts'
import { hongKongName, hongKongSiteSurface } from './hongKong.ts'
import { DWELL, pairsOf, stationPreview, stationSiteError, TRAIN_SPEED } from './network.ts'
import type { StationSiteError } from './network.ts'
import { lineRailPath, railUsers, resolveRails } from './rails.ts'
import { curveSpeedKmh, ENGINEERING, pieceLength, pieceTangent, radiusStatus, reverseRailPath, trackCurves, trackLength, trackProfile } from './track.ts'
import type { City, GameState, Line, LineDesign, Point, Station, TrackMethod, TrackSection } from './types.ts'

export type PlanningError = StationSiteError | 'tooClose' | 'invalidStops' | 'needsStops' |
  'invalidColor' | 'curve' | 'controlPoint' | 'noTrack' | 'differentTrack' | 'funds' | 'invalidMethod' | 'openLoop' | 'waterAlignmentEnd' |
  'invalidReuse' | 'railJunction' | EngineeringError

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

export function planStationMoves(game: GameState, moves: Record<string, Point>) {
  const city = getCity(game.cityId)
  const targets = new Map<string, Point>()
  let cost = 0
  for (const [id, target] of Object.entries(moves)) {
    const existing = game.stations.find((station) => station.id === id)
    if (!existing) return { cost, error: 'invalidStops' as PlanningError }
    const siteError = stationSiteError(city, target)
    if (siteError) return { cost, error: siteError }
    const point = roundPoint(target)
    if (distance(existing.position, point) > 1e-6) targets.set(id, point)
  }
  if (!targets.size) return { game, cost, affected: new Set<string>(), changed: new Set<string>(), trackMoveCosts: new Map<string, number>() }
  const stations = game.stations.map((station) => targets.has(station.id) ? { ...station, position: targets.get(station.id)! } : station)
  for (const station of stations) {
    if (!targets.has(station.id)) continue
    const preview = stationPreview(city, { ...game, stations }, station.position, station.id, station.method)
    if (preview.error) return { cost, error: preview.error }
    station.district = preview.district
    cost += Math.round(preview.cost * .25)
  }
  const infrastructure = { ...game.infrastructure }
  const changed = new Set<string>()
  const trackMoveCosts = new Map<string, number>()
  for (const [id, section] of Object.entries(infrastructure)) {
    const from = targets.get(section.from), to = targets.get(section.to)
    if (!from && !to) continue
    const start = section.pieces[0], end = section.pieces.at(-1)!
    const points = [from ?? start.from, ...section.controls, to ?? end.to]
    const shaped = alignThrough(points, pieceTangent(start), pieceTangent(end, true))
    if (shaped.invalid) return { cost, error: 'curve' as PlanningError }
    const method = section.method ?? start.method ?? 'underground'
    const pieces = shaped.pieces.map((piece) => ({ ...piece, method }))
    const measure = measurePieces(city, pieces, method)
    if (measure.error) return { cost, error: measure.error }
    const addition = Math.max(0, measure.price - measurePieces(city, section.pieces, section.method).price)
    cost += addition
    trackMoveCosts.set(id, addition)
    infrastructure[id] = { ...section, pieces, method, builtCost: measure.price }
    changed.add(id)
  }
  const affected = new Set<string>()
  const lines = game.lines.map((line) => {
    if (!allTrack(line).some((section) => section.rails?.some((rail) => changed.has(rail.id)))) return line
    affected.add(line.id)
    const resolve = (section: TrackSection) => section.rails ? resolveRails(infrastructure, section.rails, section.from, section.to) ?? section : section
    const track = line.track.map(resolve)
    const { head, tail } = line.openEnds ?? {}
    return { ...line, track, ...(line.openEnds ? { openEnds: { ...(head ? { head: resolve(head) } : {}), ...(tail ? { tail: resolve(tail) } : {}) } } : {}) }
  })
  return { game: { ...game, stations, lines, infrastructure }, cost, affected, changed, trackMoveCosts }
}

export function quoteLine(game: GameState, design: LineDesign, existing?: Line) {
  const move = game.hongKong && design.stationMoves && Object.keys(design.stationMoves).length ? planStationMoves(game, design.stationMoves) : undefined
  const network = move?.game ?? game
  const current = existing ? network.lines.find((line) => line.id === existing.id) ?? existing : undefined
  const quote = quoteAlignment(network, design, current)
  const previewed = new Set(quote.rows.flatMap(({ section }) => section.rails?.map((rail) => rail.id) ?? []))
  const keptByOtherServices = move?.game && railUsers(network.lines.filter((line) => line.id !== existing?.id))
  const replacedMoveCost = move?.trackMoveCosts ? [...move.trackMoveCosts].reduce((sum, [id, amount]) =>
    previewed.has(id) || keptByOtherServices && keptByOtherServices.has(id) ? sum : sum + amount, 0) : 0
  const stationMoveCost = move?.game ? move.cost - replacedMoveCost : 0
  const cost = quote.cost + stationMoveCost
  const error = move?.error ?? quote.error ?? (canAfford(game, cost) ? undefined : 'funds' as const)
  const movedCurves = move?.changed && network.infrastructure && keptByOtherServices ? [...move.changed].filter((id) =>
    !previewed.has(id) && keptByOtherServices.has(id)).flatMap((id) => {
    const section = network.infrastructure![id]
    return trackCurves(section.pieces).filter(({ radius }) => radius < ENGINEERING.restrictedRadius)
      .map((curve) => ({ ...curve, from: section.from, to: section.to }))
  }) : []
  return { ...quote, cost, stationMoveCost, error, remaining: game.funds - cost,
    restrictions: [...quote.restrictions, ...movedCurves], relocation: move?.game ? move : undefined }
}

function quoteAlignment(game: GameState, design: LineDesign, existing?: Line) {
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
    else {
      if (design.stationNames?.[stop] && city.hongKong) {
        const names = design.stationNames[stop]
        station.names = { en: names.en.trim().slice(0, maxNameLength) || station.names!.en, zh: names.zh.trim().slice(0, maxNameLength) || station.names!.zh }
        station.namePinned = true
      }
      newStations.push(station)
    }
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
  const fixed = new Map<string, TrackSection | undefined>()
  const explicitReuse = new Set<string>()
  if (city.hongKong && game.infrastructure) for (const [from, to] of pairsOf(route, design.circular)) {
    const key = sectionKey(from, to), reverse = sectionKey(to, from)
    const chosen = design.reuse?.[key] ?? (design.reuse?.[reverse] && reverseRailPath(design.reuse[reverse]))
    if (chosen && !chosen.length) { fixed.set(key, undefined); continue }
    const hadSection = prior?.track.some((section) => section.from === from && section.to === to || section.to === from && section.from === to)
    const retained = existing && !hadSection && !handles[key] && !handles[reverse] &&
      (lineRailPath(game, existing, from, to, 1) ?? lineRailPath(game, existing, from, to, -1))
    const references = chosen ?? (retained || undefined)
    if (!references) continue
    const section = resolveRails(game.infrastructure, references, from, to)
    if (!section || !positions.has(from) || !positions.has(to) || distance(section.pieces[0].from, positions.get(from)!) > 0.012 ||
      distance(section.pieces.at(-1)!.to, positions.get(to)!) > 0.012) {
      if (chosen) invalid('invalidReuse')
      continue
    }
    if (chosen) explicitReuse.add(key)
    fixed.set(key, section)
  }
  const rows = goodControls && route.every((stop) => positions.has(stop) &&
    Number.isFinite(positions.get(stop)!.x) && Number.isFinite(positions.get(stop)!.y))
    ? alignTrack(positions, { ...design, stops: route, controls: handles }, prior, fixed) : []
  const users = railUsers(game.lines.filter((line) => line.id !== existing?.id))
  let reusedLength = 0
  const infrastructure = { underground: 0, elevated: 0, atGrade: 0, terrain: 0, water: 0, track: 0 }
  for (const row of rows) {
    const section = row.section
    const key = sectionKey(section.from, section.to)
    const reverse = sectionKey(section.to, section.from)
    const nextMethod = fixed.get(key) ? undefined : design.methods?.[key] ?? design.methods?.[reverse]
    const previous = prior?.track.find((entry) => (entry.from === section.from && entry.to === section.to) ||
      (entry.to === section.from && entry.from === section.to))
    const method = nextMethod ?? section.method ?? previous?.method ?? design.method ?? 'underground'
    if (!trackMethods.includes(method)) { invalid('invalidMethod'); continue }
    if (city.hongKong && (row.added || nextMethod && nextMethod !== section.method)) {
      row.added = true
      const pieces = section.pieces.map((piece) => ({ ...piece, method }))
      row.section = { ...section, method, pieces, rails: undefined }
    }
    if (!row.added) {
      const references = row.section.rails ?? []
      const shared = references.filter((rail) => users.has(rail.id))
      row.reused = explicitReuse.has(key) || shared.length > 0
      reusedLength += shared.reduce((length, rail) => length + trackLength(game.infrastructure![rail.id].pieces), 0)
      continue
    }
    const measure = measurePieces(city, row.section.pieces, method)
    if (measure.error) invalid(measure.error)
    for (const method of trackMethods) infrastructure[method] += measure.methods[method]
    infrastructure.terrain += measure.terrain
    infrastructure.water += measure.waterPremium
    infrastructure.track += measure.price
    if (city.hongKong) row.section = { ...row.section, builtCost: measure.price }
  }
  for (const [index, row] of rows.entries()) {
    const following = rows[index + 1] ?? (design.circular ? rows[0] : undefined)
    if (row.junction && following && [row, following].some(({ section }) => explicitReuse.has(sectionKey(section.from, section.to)))) invalid('railJunction')
    if (explicitReuse.has(sectionKey(row.section.from, row.section.to)) && row.radius === 0) invalid('railJunction')
    if (row.added && radiusStatus(row.radius, !!city.hongKong) === 'invalid') invalid('curve')
  }
  const interchanges = city.hongKong || design.autoInterchanges ? game.stations.filter((station) =>
    !station.interchange && seen.has(station.id) && !existing?.stops.includes(station.id) &&
    game.lines.some((line) => line.id !== existing?.id && line.stops.includes(station.id))) : []
  const stationsCost = newStations.reduce((sum, station) => sum + station.builtCost, 0)
  const interchangeCost = city.hongKong ? 0 : interchanges.length * interchangePrice(game)
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
  const serviceLength = rows.reduce((total, row) => openEndOf(row.section) ? total : total + trackLength(row.section.pieces), 0)
  const newUpkeep = rows.reduce((total, row) => row.added ? total + trackUpkeepMinute(row.section) : total, 0)
  const operatingHourly = Math.round(60 * (newUpkeep + (travel ? HKD.crewMinute + serviceLength / 100 / travel * HKD.travelCostKm : 0) +
    newStations.length * (travel ? HKD.stationMinute : HKD.idleStationMinute) + (travel ? interchanges.length * 36 : 0)))
  const restrictions = rows.flatMap(({ section }) => trackCurves(section.pieces).filter(({ radius }) => radius < ENGINEERING.restrictedRadius)
    .map((curve) => ({ ...curve, from: section.from, to: section.to })))
  return { rows, newStations, interchanges, cost, infrastructure, stationsCost, interchangeCost, reusedLength, operatingHourly, restrictions, remaining: game.funds - cost,
    radius, totalRadius: allRadii.length ? Math.min(...allRadii) : null,
    length, limit: Math.min(ENGINEERING.designSpeedKmh, ...curvedSpeeds, ...methodSpeeds), travel,
    legacy: Boolean(existing && legacyRestricted(existing, !!city.hongKong) && rows.some((row) => row.section.legacy)), error }
}
