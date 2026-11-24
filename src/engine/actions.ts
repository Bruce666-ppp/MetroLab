import { getCity } from './city.ts'
import { canAfford, INTERCHANGE_PRICE, measureTrack, post, salvage, spendCapital, TRAIN_PRICE, TRAIN_REFUND, upgradePrice } from './economy.ts'
import { clamp } from './geometry.ts'
import { pairsOf, stationPreview, trackCost, trainLoad } from './network.ts'
import { withdrawLineTrips } from './passengers.ts'
import { makeTrain, resetTrain } from './trains.ts'
import type { GameState, LineDesign, Point, Station, StationLevel } from './types.ts'

export const HEADWAYS = [3, 5, 8, 12, 16] as const

export type Action =
  | { type: 'buildStation'; point: Point }
  | { type: 'moveStation'; id: string; point: Point }
  | { type: 'renameStation'; id: string; name: string }
  | { type: 'removeStation' | 'upgradeStation' | 'interchange'; id: string }
  | { type: 'saveLine'; id?: string; design: LineDesign }
  | { type: 'removeLine' | 'buyTrain'; id: string }
  | { type: 'headway'; id: string; headway: number }
  | { type: 'setTrainActive'; id: string; active: boolean }
  | { type: 'sellTrain'; id: string }

export type ActionError = 'funds' | 'notFound' | 'outOfBounds' | 'water' | 'tooClose' | 'needsStops'
  | 'invalidStops' | 'invalidColor' | 'maxLevel' | 'needsInterchange' | 'invalidHeadway'

type Result = { game: GameState; id?: string; cost: number; error?: never }
  | { error: ActionError; game?: never; id?: never; cost?: never }

const colorPattern = /^#[a-f\d]{6}$/i
export const maxNameLength = 36

export function relocationCost(game: GameState, id: string, point: Point) {
  const station = game.stations.find((entry) => entry.id === id)
  if (!station) return 0
  const city = getCity(game.cityId)
  const preview = stationPreview(city, game, point, id)
  const stations = new Map(game.stations.map((entry) => [entry.id, entry]))
  let additionalTrack = 0
  for (const line of game.lines) {
    for (const [a, b] of pairsOf(line.stops, line.circular)) {
      if (a !== id && b !== id) continue
      const neighbor = stations.get(a === id ? b : a)!
      additionalTrack += Math.max(0, measureTrack(city, point, neighbor.position).price -
        measureTrack(city, station.position, neighbor.position).price)
    }
  }
  return Math.round(preview.cost * 0.25) + additionalTrack
}

export function demolitionCost(game: GameState, id: string) {
  const city = getCity(game.cityId)
  return game.lines.reduce((total, line) => {
    if (!line.stops.includes(id)) return total
    const remaining = line.stops.filter((stop) => stop !== id)
    return total + (remaining.length >= 2 ? trackCost(city, game.stations, remaining, line.circular, line) : 0)
  }, 0)
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
      const moving = action.type === 'moveStation'
      const previous = moving ? game.stations.find((station) => station.id === action.id) : undefined
      if (moving && !previous) return { error: 'notFound' }
      const point = { x: Math.round(action.point.x * 10) / 10, y: Math.round(action.point.y * 10) / 10 }
      const preview = stationPreview(city, game, point, previous?.id)
      if (preview.error) return { error: preview.error }
      if (previous) {
        const cost = relocationCost(current, previous.id, point)
        previous.position = point
        previous.district = preview.district
        reviseService(new Set(game.lines.filter((line) => line.stops.includes(previous.id)).map((line) => line.id)))
        return finish(previous.id, cost)
      }
      const number = game.nextId++
      const station: Station = {
        id: 'station-' + number, number, name: '', position: point, district: preview.district,
        level: 1, interchange: false, builtCost: preview.cost,
      }
      game.stations.push(station)
      return finish(station.id, preview.cost)
    }
    case 'renameStation':
    case 'interchange':
    case 'upgradeStation': {
      const station = game.stations.find((entry) => entry.id === action.id)
      if (!station) return { error: 'notFound' }
      if (action.type === 'renameStation') {
        station.name = action.name.trim().slice(0, maxNameLength)
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
      const cost = demolitionCost(current, action.id)
      const affected = new Set(game.lines.filter((line) => line.stops.includes(action.id)).map((line) => line.id))
      reviseService(affected)
      for (const group of game.queues[action.id] ?? []) post(game, 'unmet', group.count)
      delete game.queues[action.id]
      delete game.stationActivity[action.id]
      game.stations = game.stations.filter((station) => station.id !== action.id)
      for (const line of game.lines.filter((line) => affected.has(line.id))) {
        line.stops = line.stops.filter((stop) => stop !== action.id)
        line.circular = line.circular && line.stops.length >= 3
      }
      game.lines = game.lines.filter((line) => line.stops.length >= 2)
      const lineIds = new Set(game.lines.map((line) => line.id))
      const retired = game.trains.filter((entry) => !lineIds.has(entry.lineId)).length
      if (retired) salvage(game, retired * TRAIN_REFUND)
      game.trains = game.trains.filter((train) => lineIds.has(train.lineId))
      return finish(action.id, cost)
    }
    case 'saveLine': {
      const old = game.lines.find((line) => line.id === action.id)
      if (action.id && !old) return { error: 'notFound' }
      const { stops, circular, color, name } = action.design
      if (stops.length < (circular ? 3 : 2)) return { error: 'needsStops' }
      const stationIds = new Set(game.stations.map((station) => station.id))
      if (new Set(stops).size !== stops.length || stops.some((id) => !stationIds.has(id))) return { error: 'invalidStops' }
      if (!colorPattern.test(color)) return { error: 'invalidColor' }
      const design = { stops: [...stops], circular, color, name: name.trim().slice(0, maxNameLength) }
      const cost = trackCost(city, game.stations, stops, circular, old)
      if (old) {
        const changed = old.circular !== circular || old.stops.join('|') !== stops.join('|')
        Object.assign(old, design)
        if (changed) reviseService(new Set([old.id]))
        return finish(old.id, cost)
      }
      const id = 'line-' + game.nextId++
      const number = Math.max(0, ...game.lines.map((line) => line.number)) + 1
      game.lines.push({ ...design, id, number, headway: 5, releaseAt: game.minute })
      return finish(id, cost)
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
