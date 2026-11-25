import { getCity } from './city.ts'
import { canAfford, INTERCHANGE_PRICE, measurePieces, post, salvage, spendCapital, TRAIN_PRICE, TRAIN_REFUND, upgradePrice } from './economy.ts'
import { clamp } from './geometry.ts'
import { pairsOf, stationPreview, trainLoad } from './network.ts'
import { withdrawLineTrips } from './passengers.ts'
import { maxNameLength, newStation, quoteInsertion, quoteLine, roundPoint } from './planning.ts'
import type { PlanningError } from './planning.ts'
import { nearestOnTrack, splitTrack } from './track.ts'
import { makeTrain, remapTrain, resetTrain } from './trains.ts'
import type { GameState, Point, Line, LineDesign, StationLevel, TrackSection } from './types.ts'

export const HEADWAYS = [3, 5, 8, 12, 16] as const

export type Action =
  | { type: 'buildStation'; point: Point }
  | { type: 'insertStation'; point: Point; lineIds: string[] }
  | { type: 'moveStation'; id: string; point: Point }
  | { type: 'renameStation'; id: string; name: string }
  | { type: 'removeStation' | 'upgradeStation' | 'interchange'; id: string }
  | { type: 'saveLine'; id?: string; design: LineDesign }
  | { type: 'removeLine' | 'buyTrain'; id: string }
  | { type: 'headway'; id: string; headway: number }
  | { type: 'setTrainActive'; id: string; active: boolean }
  | { type: 'sellTrain'; id: string }

export type ActionError = PlanningError | 'notFound' | 'maxLevel' | 'needsInterchange' | 'invalidHeadway'

type Result = { game: GameState; id?: string; cost: number; error?: never }
  | { error: ActionError; game?: never; id?: never; cost?: never }

export { maxNameLength } from './planning.ts'
const playerName = (name: string) => name.trim() ? name.slice(0, maxNameLength) : ''

export function relocationQuote(game: GameState, id: string, target: Point) {
  const point = roundPoint(target)
  const station = game.stations.find((entry) => entry.id === id)
  if (!station) return { cost: 0, error: 'notFound' as const }
  const city = getCity(game.cityId)
  const preview = stationPreview(city, game, point, id)
  if (preview.error) return { cost: 0, error: preview.error }
  const stations = game.stations.map((entry) => entry.id === id ? { ...entry, position: point, district: preview.district } : entry)
  const affected = game.lines.filter((line) => line.stops.includes(id))
  const tracks = new Map<string, TrackSection[]>()
  let additionalTrack = 0
  for (const line of affected) {
    const quote = quoteLine({ ...game, stations, mode: 'sandbox' }, line, line)
    if (quote.error) return { cost: 0, error: quote.error }
    tracks.set(line.id, quote.rows.map((row) => row.section))
    for (const [index, row] of quote.rows.entries()) {
      if (!row.added) continue
      const previous = measurePieces(city, line.track[index].pieces).price
      additionalTrack += Math.max(0, measurePieces(city, row.section.pieces).price - previous)
    }
  }
  return { stations, tracks, cost: Math.round(preview.cost * 0.25) + additionalTrack }
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
      controls: [...head.controls, head.pieces.at(-1)!.to, ...tail.controls],
      ...(head.legacy || tail.legacy ? { legacy: true as const } : {}) }
  })
  return { ...line, stops, circular, track }
}

export function applyAction(current: GameState, action: Action): Result {
  const city = getCity(current.cityId)
  const game = structuredClone(current)
  const finish = (id?: string, cost = 0): Result => {
    if (!canAfford(current, cost)) return { error: 'funds' }
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
        game.stations = quote.stations
        for (const line of game.lines) line.track = quote.tracks.get(line.id) ?? line.track
        reviseService(new Set(quote.tracks.keys()))
        return finish(action.id, quote.cost)
      }
      const number = game.nextId++
      const station = newStation(city, game, roundPoint(action.point), 'station-' + number, number)
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
      for (const hit of hits) {
        const line = game.lines.find((entry) => entry.id === hit.lineId)!
        const previous = { ...line }
        const section = hit.section
        const { head, tail } = splitTrack(section.pieces, hit.offset)
        const controls = section.controls.filter((point) => {
          const offset = nearestOnTrack(section.pieces, point)!.offset
          return Math.abs(offset - hit.offset) > 0.01
        })
        const before = controls.filter((point) => nearestOnTrack(section.pieces, point)!.offset < hit.offset)
        const after = controls.slice(before.length)
        line.stops = [...line.stops.slice(0, hit.index + 1), station.id, ...line.stops.slice(hit.index + 1)]
        line.track = [...line.track.slice(0, hit.index),
          { ...section, to: station.id, pieces: head, controls: before },
          { ...section, from: station.id, pieces: tail, controls: after }, ...line.track.slice(hit.index + 1)]
        for (const train of game.trains) {
          if (train.lineId === line.id) remapTrain(train, previous, line, { section, offset: hit.offset, station: station.id })
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
        station.name = playerName(action.name)
        return finish(station.id)
      }
      if (action.type === 'interchange') {
        if (station.interchange) return { error: 'maxLevel' }
        if (game.lines.filter((line) => line.stops.includes(station.id)).length < 2) return { error: 'needsInterchange' }
        station.interchange = true
        return finish(station.id, INTERCHANGE_PRICE)
      }
      if (station.level === 3) return { error: 'maxLevel' }
      const cost = upgradePrice(station)
      station.level = clamp(station.level + 1, 1, 3) as StationLevel
      return finish(station.id, cost)
    }
    case 'removeStation': {
      if (!game.stations.some((station) => station.id === action.id)) return { error: 'notFound' }
      const affected = new Set(game.lines.filter((line) => line.stops.includes(action.id)).map((line) => line.id))
      reviseService(affected)
      for (const group of game.queues[action.id] ?? []) post(game, 'unmet', group.count)
      delete game.queues[action.id]
      delete game.stationActivity[action.id]
      game.stations = game.stations.filter((station) => station.id !== action.id)
      game.lines = game.lines.map((line) => affected.has(line.id) ? removeStop(line, action.id) : line)
      game.lines = game.lines.filter((line) => line.stops.length >= 2)
      const lineIds = new Set(game.lines.map((line) => line.id))
      const retired = game.trains.filter((entry) => !lineIds.has(entry.lineId)).length
      if (retired) salvage(game, retired * TRAIN_REFUND)
      game.trains = game.trains.filter((train) => lineIds.has(train.lineId))
      return finish(action.id)
    }
    case 'saveLine': {
      const old = game.lines.find((line) => line.id === action.id)
      if (action.id && !old) return { error: 'notFound' }
      const quote = quoteLine(game, action.design, old)
      if (quote.error) return { error: quote.error }
      const ids = new Map(quote.newStations.map((station) => {
        const number = game.nextId++
        const id = 'station-' + number
        game.stations.push({ ...station, id, number })
        return [station.id, id]
      }))
      const resolved = (id: string) => ids.get(id) ?? id
      for (const station of quote.interchanges) station.interchange = true
      const { stops, circular, color, name, automaticName } = action.design
      const design = { stops: stops.map(resolved), circular, color, name: playerName(name), automaticName: automaticName ?? old?.automaticName ?? false,
        track: quote.rows.map(({ section }) => {
          const from = resolved(section.from)
          const to = resolved(section.to)
          return from === section.from && to === section.to ? section : { ...section, from, to }
        }) }
      if (old) {
        const previous = { ...old }
        const start = design.stops.indexOf(old.stops[0])
        const keepService = old.circular === circular && start >= 0 &&
          old.stops.every((id, index) => design.stops[start + index] === id) &&
          (!circular || design.stops.length === old.stops.length)
        Object.assign(old, design)
        if (keepService) {
          for (const train of game.trains) if (train.lineId === old.id) remapTrain(train, previous, old)
        } else reviseService(new Set([old.id]))
        return finish(old.id, quote.cost)
      }
      const id = 'line-' + game.nextId++
      const number = Math.max(0, ...game.lines.map((line) => line.number)) + 1
      game.lines.push({ ...design, id, number, headway: 5, releaseAt: game.minute })
      return finish(id, quote.cost)
    }
    case 'removeLine': {
      if (!game.lines.some((line) => line.id === action.id)) return { error: 'notFound' }
      reviseService(new Set([action.id]))
      game.lines = game.lines.filter((line) => line.id !== action.id)
      const retired = game.trains.filter((entry) => entry.lineId === action.id).length
      if (retired) salvage(game, retired * TRAIN_REFUND)
      game.trains = game.trains.filter((train) => train.lineId !== action.id)
      return finish(action.id)
    }
    case 'buyTrain': {
      if (!game.lines.some((line) => line.id === action.id)) return { error: 'notFound' }
      const train = makeTrain(action.id, game.nextId++)
      game.trains.push(train)
      return finish(train.id, TRAIN_PRICE)
    }
    case 'headway': {
      const line = game.lines.find((entry) => entry.id === action.id)
      if (!line) return { error: 'notFound' }
      if (!HEADWAYS.some((headway) => headway === action.headway)) return { error: 'invalidHeadway' }
      line.headway = action.headway
      line.releaseAt = Math.min(line.releaseAt, game.minute + line.headway)
      return finish(line.id)
    }
    case 'setTrainActive':
    case 'sellTrain': {
      const train = game.trains.find((entry) => entry.id === action.id)
      if (!train) return { error: 'notFound' }
      if (action.type === 'sellTrain' || !action.active) {
        post(game, 'unmet', trainLoad(train))
        train.loads = []
        resetTrain(train)
      }
      if (action.type === 'sellTrain') {
        game.trains = game.trains.filter((entry) => entry !== train)
        salvage(game, TRAIN_REFUND)
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
