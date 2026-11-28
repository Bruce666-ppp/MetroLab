import { getCity } from './city.ts'
import { allTrack, headAnchor, openEndOf, tailAnchor } from './alignment.ts'
import { canAfford, HKD, interchangePrice, measurePieces, salvage, spendCapital, trainPrice, trainRefund, upgradePrice } from './economy.ts'
import { clamp } from './geometry.ts'
import { pairsOf, stationPreview, stationSiteError } from './network.ts'
import { abandonTrip, withdrawLineTrips } from './passengers.ts'
import { maxNameLength, newStation, planStationMoves, quoteInsertion, quoteLine, roundPoint } from './planning.ts'
import type { PlanningError } from './planning.ts'
import { splitRailPathAt, splitSectionAt, synchronizeRails } from './rails.ts'
import { makeTrain, remapTrain, resetTrain } from './trains.ts'
import type { GameState, Point, Line, LineDesign, StationLevel, TrackMethod, TrackSection } from './types.ts'

export const HEADWAYS = [3, 5, 8, 12, 16] as const

export type Action =
  | { type: 'buildStation'; point: Point; method?: TrackMethod }
  | { type: 'insertStation'; point: Point; lineIds: string[] }
  | { type: 'moveStation'; id: string; point: Point }
  | { type: 'renameStation'; id: string; name: string; chinese?: string }
  | { type: 'removeStation' | 'upgradeStation' | 'interchange'; id: string }
  | { type: 'saveLine'; id?: string; design: LineDesign }
  | { type: 'removeLine' | 'buyTrain'; id: string }
  | { type: 'removeSection'; id: string; index: number | 'head' | 'tail' }
  | { type: 'headway'; id: string; headway: number }
  | { type: 'fare'; id: string; fare: number }
  | { type: 'service'; id: string; running: boolean }
  | { type: 'setTrainActive'; id: string; active: boolean }
  | { type: 'sellTrain'; id: string }

export type ActionError = PlanningError | 'notFound' | 'maxLevel' | 'needsInterchange' | 'invalidHeadway' | 'invalidFare'

type Result = { game: GameState; id?: string; cost: number; error?: never }
  | { error: ActionError; game?: never; id?: never; cost?: never }

export { maxNameLength } from './planning.ts'
const playerName = (name: string) => name.trim() ? name.slice(0, maxNameLength) : ''

export function relocationQuote(game: GameState, id: string, target: Point) {
  const point = roundPoint(target)
  const station = game.stations.find((entry) => entry.id === id)
  if (!station) return { cost: 0, error: 'notFound' as const }
  const city = getCity(game.cityId)
  if (city.hongKong && game.infrastructure) {
    const moved = planStationMoves(game, { [id]: target })
    if (!moved.game) return { cost: 0, error: moved.error ?? 'notFound' as const }
    const affected = moved.game.lines.filter((line) => moved.affected.has(line.id))
    return { cost: moved.cost, stations: moved.game.stations, tracks: new Map(affected.map((line) => [line.id, line.track])),
      ends: new Map(affected.map((line) => [line.id, line.openEnds])), relocation: { game: moved.game, affected: moved.affected } }
  }
  const siteError = city.hongKong && stationSiteError(city, target)
  if (siteError) return { cost: 0, error: siteError }
  const preview = stationPreview(city, game, point, id, station.method)
  if (preview.error) return { cost: 0, error: preview.error }
  const stations = game.stations.map((entry) => entry.id === id ? { ...entry, position: point, district: preview.district } : entry)
  const affected = game.lines.filter((line) => line.stops.includes(id))
  const tracks = new Map<string, TrackSection[]>()
  const ends = new Map<string, Line['openEnds']>()
  let additionalTrack = 0
  for (const line of affected) {
    const methods = Object.fromEntries(line.track.flatMap((section) => section.method ? [[section.from + '|' + section.to, section.method]] : []))
    const quote = quoteLine({ ...game, stations, mode: 'sandbox' }, { ...line, methods }, line)
    if (quote.error) return { cost: 0, error: quote.error }
    const route = quote.rows.map((row) => row.section)
    tracks.set(line.id, route.filter((section) => !openEndOf(section)))
    if (line.openEnds) ends.set(line.id, Object.fromEntries(route.flatMap((section) => {
      const end = openEndOf(section)
      return end ? [[end, section]] : []
    })))
    for (const row of quote.rows) {
      if (!row.added) continue
      const existing = allTrack(line).find((section) => section.from === row.section.from && section.to === row.section.to)
      const previous = existing ? measurePieces(city, existing.pieces, existing.method).price : 0
      additionalTrack += Math.max(0, measurePieces(city, row.section.pieces).price - previous)
    }
  }
  return { stations, tracks, ends, cost: Math.round(preview.cost * 0.25) + additionalTrack }
}

function removeStop(line: Line, stationId: string) {
  const stops = line.stops.filter((stop) => stop !== stationId)
  const circular = line.circular && stops.length >= 3
  const track = pairsOf(stops, circular).map(([from, to]) => {
    const old = line.track.find((section) => section.from === from && section.to === to)
    if (old) return old
    const head = line.track.find((section) => section.from === from && section.to === stationId)!
    const tail = line.track.find((section) => section.from === stationId && section.to === to)!
    return { from, to, pieces: head.pieces.concat(tail.pieces),
      ...(head.rails && tail.rails ? { rails: [...head.rails, ...tail.rails] } : {}),
      controls: [...head.controls, head.pieces.at(-1)!.to, ...tail.controls],
      ...(head.legacy || tail.legacy ? { legacy: true as const } : {}),
      ...(head.method && head.method === tail.method ? { method: head.method } : {}),
      ...(head.builtCost !== undefined ? { builtCost: head.builtCost + (tail.builtCost ?? 0) } : {}) }
  })
  return { ...line, stops, circular, track }
}

function extendBeyondStop(from: string, to: string, first: TrackSection | undefined, last: TrackSection | undefined) {
  if (!first) return last && { ...last, from, to }
  if (!last) return { ...first, from, to }
  return { from, to, pieces: [...first.pieces, ...last.pieces],
    ...(first.rails && last.rails ? { rails: [...first.rails, ...last.rails] } : {}),
    controls: [...first.controls, first.pieces.at(-1)!.to, ...last.controls],
    ...(first.method && first.method === last.method ? { method: first.method } : {}),
    builtCost: (first.builtCost ?? 0) + (last.builtCost ?? 0) }
}

function removeHongKongStop(line: Line, station: string) {
  if (line.circular || line.stops[0] !== station && line.stops.at(-1) !== station) return removeStop(line, station)
  const open = line.openEnds ?? {}
  const stops = line.stops.filter((id) => id !== station)
  if (!stops.length) return { ...line, stops, track: [], openEnds: { head: extendBeyondStop(headAnchor, tailAnchor, open.head, open.tail) } }
  if (line.stops[0] === station) return { ...line, stops, track: line.track.slice(1),
    openEnds: { ...open, head: extendBeyondStop(headAnchor, stops[0], open.head, line.track[0]) } }
  return { ...line, stops, track: line.track.slice(0, -1),
    openEnds: { ...open, tail: extendBeyondStop(stops.at(-1)!, tailAnchor, line.track.at(-1), open.tail) } }
}

function applyRelocation(game: GameState, relocated: GameState, affected: Set<string>) {
  for (const train of game.trains) if (affected.has(train.lineId)) {
    remapTrain(train, game.lines.find((line) => line.id === train.lineId)!, relocated.lines.find((line) => line.id === train.lineId)!)
  }
  game.stations = relocated.stations
  game.lines = relocated.lines
  game.infrastructure = relocated.infrastructure
}

export function applyAction(current: GameState, action: Action): Result {
  const city = getCity(current.cityId)
  const game = structuredClone(current)
  const finish = (id?: string, cost = 0): Result => {
    if (!canAfford(current, cost)) return { error: 'funds' }
    if (city.hongKong && ['saveLine', 'moveStation', 'insertStation', 'removeStation', 'removeLine', 'removeSection'].includes(action.type)) {
      synchronizeRails(game)
    }
    if (cost) spendCapital(game, cost)
    game.revision++
    return { game, cost, id }
  }

  const reviseService = (affected: Set<string>) => {
    withdrawLineTrips(game, affected)
    for (const train of game.trains) if (affected.has(train.lineId)) resetTrain(train)
    for (const line of game.lines) if (affected.has(line.id)) line.releaseAt = game.minute
  }

  switch (action.type) {
    case 'buildStation':
    case 'moveStation': {
      if (action.type === 'moveStation') {
        const quote = relocationQuote(game, action.id, action.point)
        if (quote.error || !quote.stations || !quote.tracks) return { error: quote.error ?? 'notFound' }
        if (quote.relocation) {
          applyRelocation(game, quote.relocation.game, quote.relocation.affected)
          return finish(action.id, quote.cost)
        }
        game.stations = quote.stations
        for (const line of game.lines) {
          line.track = quote.tracks.get(line.id) ?? line.track
          line.openEnds = quote.ends?.get(line.id) ?? line.openEnds
        }
        reviseService(new Set(quote.tracks.keys()))
        return finish(action.id, quote.cost)
      }
      const siteError = city.hongKong && stationSiteError(city, action.point)
      if (siteError) return { error: siteError }
      const number = game.nextId++
      const station = newStation(city, game, roundPoint(action.point), 'station-' + number, number, action.method)
      if (typeof station === 'string') return { error: station }
      game.stations.push(station)
      return finish(station.id, station.builtCost)
    }
    case 'insertStation': {
      const quote = quoteInsertion(game, action.point, action.lineIds)
      if (quote.error || !quote.station || !quote.hits) return { error: quote.error ?? 'noTrack' }
      const { station, hits } = quote
      game.nextId++
      game.stations.push(station)
      for (const [index, hit] of hits.entries()) {
        const line = game.lines.find((entry) => entry.id === hit.lineId)!
        const previous = { ...line }
        const section = hit.section
        const rails = splitRailPathAt(game, section, hit.offset, station.id)
        const { first, second } = splitSectionAt(section, hit.offset, station.id)
        if (rails) { first.rails = rails.head; second.rails = rails.tail }
        if (hit.end === 'head') {
          line.stops = [station.id, ...line.stops]
          line.openEnds = { ...line.openEnds, head: first }
          if (section.to === tailAnchor) line.openEnds.tail = second
          else line.track = [second, ...line.track]
        } else if (hit.end === 'tail') {
          line.stops = [...line.stops, station.id]
          line.openEnds = { ...line.openEnds, tail: second }
          line.track = [...line.track, first]
        } else {
          line.stops = [...line.stops.slice(0, hit.index + 1), station.id, ...line.stops.slice(hit.index + 1)]
          line.track = [...line.track.slice(0, hit.index), first, second, ...line.track.slice(hit.index + 1)]
        }
        if (city.hongKong) line.builtCost = (line.builtCost ?? 0) + Math.floor(quote.cost * (index + 1) / hits.length) - Math.floor(quote.cost * index / hits.length)
        for (const train of game.trains) {
          if (train.lineId === line.id) remapTrain(train, previous, line, hit.end ? undefined : { section, offset: hit.offset, station: station.id })
        }
      }
      return finish(station.id, quote.cost)
    }
    case 'renameStation':
    case 'interchange':
    case 'upgradeStation': {
      const station = game.stations.find((entry) => entry.id === action.id)
      if (!station) return { error: 'notFound' }
      if (action.type === 'renameStation') {
        if (city.hongKong) {
          const names = station.names!
          station.names = { en: playerName(action.name) || names.en, zh: playerName(action.chinese ?? '') || names.zh }
          station.name = ''
          station.namePinned = Boolean(action.name.trim() || action.chinese?.trim())
        } else station.name = playerName(action.name)
        return finish(station.id)
      }
      if (action.type === 'interchange') {
        if (station.interchange) return { error: 'maxLevel' }
        if (game.lines.filter((line) => line.stops.includes(station.id)).length < 2) return { error: 'needsInterchange' }
        station.interchange = true
        const cost = interchangePrice(game)
        if (city.hongKong) station.builtCost += cost
        return finish(station.id, cost)
      }
      if (station.level === 3) return { error: 'maxLevel' }
      const cost = upgradePrice(station)
      station.level = clamp(station.level + 1, 1, 3) as StationLevel
      if (city.hongKong) station.builtCost += cost
      return finish(station.id, cost)
    }
    case 'removeStation': {
      if (!game.stations.some((station) => station.id === action.id)) return { error: 'notFound' }
      const affected = new Set(game.lines.filter((line) => line.stops.includes(action.id)).map((line) => line.id))
      reviseService(affected)
      for (const group of game.queues[action.id] ?? []) abandonTrip(game, group)
      delete game.queues[action.id]
      delete game.stationActivity[action.id]
      game.stations = game.stations.filter((station) => station.id !== action.id)
      game.lines = game.lines.map((line) => affected.has(line.id) ? city.hongKong ? removeHongKongStop(line, action.id) : removeStop(line, action.id) : line)
      game.lines = game.lines.filter((line) => line.stops.length >= 2 || line.openEnds?.head || line.openEnds?.tail)
      const lineIds = new Set(game.lines.filter((line) => line.stops.length >= 2).map((line) => line.id))
      const retired = game.trains.filter((entry) => !lineIds.has(entry.lineId)).length
      if (retired) salvage(game, retired * trainRefund(game))
      game.trains = game.trains.filter((train) => lineIds.has(train.lineId))
      return finish(action.id)
    }
    case 'saveLine': {
      let old = game.lines.find((line) => line.id === action.id)
      if (action.id && !old) return { error: 'notFound' }
      const quote = quoteLine(game, action.design, old)
      if (quote.error) return { error: quote.error }
      if (quote.relocation?.game) {
        applyRelocation(game, quote.relocation.game, quote.relocation.affected)
        old = game.lines.find((line) => line.id === action.id)
      }
      const ids = new Map(quote.newStations.map((station) => {
        const number = game.nextId++
        const id = 'station-' + number
        game.stations.push({ ...station, id, number })
        return [station.id, id]
      }))
      const resolved = (id: string) => ids.get(id) ?? id
      if (city.hongKong) for (const id of action.design.stops) {
        const names = action.design.stationNames?.[id]
        const station = names && game.stations.find((entry) => entry.id === resolved(id))
        if (station?.names && names) {
          station.names = { en: playerName(names.en) || station.names.en, zh: playerName(names.zh) || station.names.zh }
          station.namePinned = true
        }
      }
      for (const station of quote.interchanges) station.interchange = true
      const { stops, circular, color, name, automaticName } = action.design
      const route = quote.rows.map(({ section }) => {
        const from = resolved(section.from), to = resolved(section.to)
        return from === section.from && to === section.to ? section : { ...section, from, to }
      })
      const openEnds = Object.fromEntries(route.flatMap((section) => {
        const end = openEndOf(section)
        return end ? [[end, section]] : []
      }))
      const design = { stops: stops.map(resolved), circular, color, name: playerName(name), automaticName: automaticName ?? old?.automaticName ?? false,
        track: route.filter((section) => !openEndOf(section)), ...(city.hongKong ? { openEnds } : {}) }
      if (old) {
        const previous = { ...old }
        const start = design.stops.indexOf(old.stops[0])
        const keepService = old.circular === circular && start >= 0 &&
          old.stops.every((id, index) => design.stops[start + index] === id) &&
          (!circular || design.stops.length === old.stops.length)
        Object.assign(old, design)
        if (city.hongKong) old.builtCost = (old.builtCost ?? 0) + quote.cost
        if (old.stops.length < 2) {
          reviseService(new Set([old.id]))
          const retired = game.trains.filter((train) => train.lineId === old.id).length
          if (retired) salvage(game, retired * trainRefund(game))
          game.trains = game.trains.filter((train) => train.lineId !== old.id)
        } else if (keepService) {
          for (const train of game.trains) if (train.lineId === old.id) remapTrain(train, previous, old)
        } else reviseService(new Set([old.id]))
        return finish(old.id, quote.cost)
      }
      const id = 'line-' + game.nextId++
      const number = Math.max(0, ...game.lines.map((line) => line.number)) + 1
      game.lines.push({ ...design, id, number, headway: 5, releaseAt: game.minute,
        ...(city.hongKong ? { builtCost: quote.cost, fare: HKD.fare, suspended: false } : {}) })
      return finish(id, quote.cost)
    }
    case 'removeLine': {
      if (!game.lines.some((line) => line.id === action.id)) return { error: 'notFound' }
      reviseService(new Set([action.id]))
      game.lines = game.lines.filter((line) => line.id !== action.id)
      const retired = game.trains.filter((entry) => entry.lineId === action.id).length
      if (retired) salvage(game, retired * trainRefund(game))
      game.trains = game.trains.filter((train) => train.lineId !== action.id)
      return finish(action.id)
    }
    case 'removeSection': {
      const line = game.lines.find((line) => line.id === action.id)
      if (!line) return { error: 'notFound' }
      if (typeof action.index === 'string') {
        const end = line.openEnds?.[action.index]
        if (!end) return { error: 'notFound' }
        delete line.openEnds![action.index]
        if (!allTrack(line).length) {
          game.lines = game.lines.filter((entry) => entry !== line)
          return finish()
        }
        return finish(line.id)
      }
      if (!line.track[action.index]) return { error: 'notFound' }
      const cut = action.index + 1
      const parts = line.circular ? [{ stops: [...line.stops.slice(cut), ...line.stops.slice(0, cut)],
        track: [...line.track.slice(cut), ...line.track.slice(0, action.index)], openEnds: undefined }] : [
        { stops: line.stops.slice(0, cut), track: line.track.slice(0, action.index), openEnds: { head: line.openEnds?.head } },
        { stops: line.stops.slice(cut), track: line.track.slice(cut), openEnds: { tail: line.openEnds?.tail } },
      ].filter((part) => part.track.length || part.openEnds.head || part.openEnds.tail).sort((a, b) => b.track.length - a.track.length)
      reviseService(new Set([line.id]))
      if (!parts[0]?.track.length) {
        const retired = game.trains.filter((train) => train.lineId === line.id).length
        game.trains = game.trains.filter((train) => train.lineId !== line.id)
        if (retired) salvage(game, retired * trainRefund(game))
      }
      if (!parts.length) {
        game.lines = game.lines.filter((entry) => entry !== line)
        return finish()
      }
      const retained = { ...line, ...parts[0], circular: false }
      if (city.hongKong) retained.builtCost = allTrack(retained).reduce((sum, section) => sum + (section.builtCost ?? 0), 0)
      Object.assign(line, retained)
      if (parts[1]) {
        const at = 'line-' + game.nextId++
        const number = Math.max(...game.lines.map((entry) => entry.number)) + 1
        const builtCost = allTrack({ ...line, ...parts[1] }).reduce((sum, section) => sum + (section.builtCost ?? 0), 0)
        game.lines.push({ ...line, ...parts[1], id: at, number, name: '', builtCost, automaticName: true, suspended: true })
      }
      return finish(line.id)
    }
    case 'buyTrain': {
      const line = game.lines.find((line) => line.id === action.id)
      if (!line) return { error: 'notFound' }
      if (line.stops.length < 2) return { error: 'needsStops' }
      const train = makeTrain(action.id, game.nextId++, Boolean(city.hongKong))
      game.trains.push(train)
      return finish(train.id, trainPrice(game))
    }
    case 'headway': {
      const line = game.lines.find((entry) => entry.id === action.id)
      if (!line) return { error: 'notFound' }
      if (!HEADWAYS.some((headway) => headway === action.headway)) return { error: 'invalidHeadway' }
      line.headway = action.headway
      line.releaseAt = Math.min(line.releaseAt, game.minute + line.headway)
      return finish(line.id)
    }
    case 'fare':
    case 'service': {
      const line = game.lines.find((entry) => entry.id === action.id)
      if (!line || !city.hongKong) return { error: 'notFound' }
      if (action.type === 'fare') {
        if (!Number.isInteger(action.fare) || action.fare < HKD.minimumFare || action.fare > HKD.maximumFare) return { error: 'invalidFare' }
        line.fare = action.fare
      } else {
        line.suspended = !action.running
        if (!action.running) reviseService(new Set([line.id]))
        else line.releaseAt = game.minute
      }
      return finish(line.id)
    }
    case 'setTrainActive':
    case 'sellTrain': {
      const train = game.trains.find((entry) => entry.id === action.id)
      if (!train) return { error: 'notFound' }
      if (action.type === 'sellTrain' || !action.active) {
        for (const group of train.loads) abandonTrip(game, group)
        train.loads = []
        resetTrain(train)
      }
      if (action.type === 'sellTrain') {
        game.trains = game.trains.filter((entry) => entry !== train)
        salvage(game, trainRefund(game))
      } else {
        train.active = action.active
      }
      if (!game.trains.some((entry) => entry.lineId === train.lineId && entry.active)) {
        withdrawLineTrips(game, new Set([train.lineId]))
      }
      return finish(train.id)
    }
  }
}
