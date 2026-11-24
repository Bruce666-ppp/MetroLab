import { octilinear, pathLength, pathPosition } from './geometry.ts'
import { DWELL, nextStop, TRAIN_SPEED, trainLoad } from './network.ts'
import { post } from './economy.ts'
import { admitGroup, trackStationActivity } from './passengers.ts'
import type { GameState, Line, PassengerGroup, Station, Train } from './types.ts'

export const CAPACITY = 96
const OPERATING_COST = 85

export function makeTrain(lineId: string, number: number): Train {
  return {
    id: 'train-' + number, lineId, number, active: true, capacity: CAPACITY, speed: TRAIN_SPEED,
    operatingCost: OPERATING_COST, at: 0, direction: 1, phase: 'dwell', remaining: DWELL, duration: DWELL, loads: [],
  }
}

export function resetTrain(train: Train) {
  train.at = 0
  train.direction = 1
  train.phase = 'dwell'
  train.duration = DWELL
  train.remaining = DWELL
}

function unload(game: GameState, train: Train, stationId: string) {
  let leaving = 0
  train.loads = train.loads.filter((group) => {
    if (group.legs[0].alight !== stationId) return true
    leaving += group.count
    trackStationActivity(game, stationId, 'alighted', group.count)
    const legs = group.legs.slice(1)
    if (legs.length) {
      const transferred = admitGroup(game, stationId, { ...group, legs, readyAt: game.minute + 2.5 })
      post(game, 'transfers', transferred)
    } else {
      game.egress.push({ ...group, legs, readyAt: game.minute + group.egress })
    }
    return false
  })
  return leaving
}

function board(game: GameState, train: Train, stationId: string) {
  const queue = game.queues[stationId]
  if (!queue?.length) return
  let seats = train.capacity - trainLoad(train)
  const remaining: PassengerGroup[] = []
  for (const group of queue) {
    const leg = group.legs[0]
    const eligible = seats > 0 && group.readyAt <= game.minute && leg.lineId === train.lineId && leg.direction === train.direction
    if (!eligible) {
      remaining.push(group)
      continue
    }
    const boarded = Math.min(seats, group.count)
    trackStationActivity(game, stationId, 'boarded', boarded)
    train.loads.push({ ...group, count: boarded })
    seats -= boarded
    if (boarded < group.count) remaining.push({ ...group, count: group.count - boarded })
  }
  game.queues[stationId] = remaining
}

export function operateTrains(game: GameState, elapsed: number, stations: Map<string, Station>) {
  const lines = new Map(game.lines.map((line) => [line.id, line]))
  for (const train of game.trains) {
    if (!train.active) continue
    const line = lines.get(train.lineId)
    if (!line) continue
    train.remaining = Math.max(0, train.remaining - elapsed)
    if (train.remaining > 0) continue
    if (train.phase === 'travel') {
      train.at = nextStop(line, train.at, train.direction)
      const leaving = unload(game, train, line.stops[train.at])
      train.phase = 'dwell'
      train.duration = DWELL + Math.min(0.75, leaving / 120)
      train.remaining = train.duration
      continue
    }
    if (!line.circular) {
      if (train.at === 0) train.direction = 1
      if (train.at === line.stops.length - 1) train.direction = -1
    }
    if (train.at === 0 && game.minute < line.releaseAt) continue
    const from = stations.get(line.stops[train.at])!
    const to = stations.get(line.stops[nextStop(line, train.at, train.direction)])!
    board(game, train, from.id)
    if (train.at === 0) line.releaseAt = game.minute + line.headway
    train.phase = 'travel'
    train.duration = Math.max(0.25, pathLength(octilinear(from.position, to.position)) / train.speed)
    train.remaining = train.duration
  }
}

export function trainPosition(train: Train, line: Line, stations: Map<string, Station>) {
  const from = stations.get(line.stops[train.at])?.position
  if (!from) return undefined
  const to = stations.get(line.stops[nextStop(line, train.at, train.direction)])?.position
  if (train.phase !== 'travel' || !to) return { ...from, angle: 0 }
  return pathPosition(octilinear(from, to), 1 - train.remaining / train.duration)
}
