import { sectionAt } from './alignment.ts'
import { DWELL, nextStop, TRAIN_SPEED, trainLoad } from './network.ts'
import { post } from './economy.ts'
import { admitGroup, trackStationActivity } from './passengers.ts'
import { motionAt, pointOnTrack, timeAtDistance, trackProfile } from './track.ts'
import type { GameState, Line, PassengerGroup, Station, TrackSection, Train } from './types.ts'

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

export function operateTrains(game: GameState, elapsed: number) {
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
    const section = sectionAt(line, train.at, train.direction)
    if (!section) continue
    board(game, train, line.stops[train.at])
    if (train.at === 0) line.releaseAt = game.minute + line.headway
    train.phase = 'travel'
    train.duration = trackProfile(section, train.speed, train.direction).duration
    train.remaining = train.duration
  }
}

export function trainPosition(train: Train, line: Line, stations: Map<string, Station>, progress = 1 - train.remaining / train.duration) {
  const from = stations.get(line.stops[train.at])?.position
  if (!from) return undefined
  const section = train.phase === 'travel' ? sectionAt(line, train.at, train.direction) : undefined
  if (!section) return { ...from, angle: 0, velocity: 0 }
  const profile = trackProfile(section, train.speed, train.direction)
  const { offset, velocity } = motionAt(profile, profile.duration * progress)
  const point = pointOnTrack(section.pieces, train.direction === 1 ? offset : profile.length - offset)!
  return { ...point, angle: point.angle + (train.direction === 1 ? 0 : 180), velocity }
}

export function remapTrain(train: Train, before: Line, after: Line, insertion?: {
  section: TrackSection; offset: number; station: string
}) {
  const oldAt = train.at
  train.at = after.stops.indexOf(before.stops[oldAt])
  if (train.phase !== 'travel') return
  const original = sectionAt(before, oldAt, train.direction)!
  const oldProfile = trackProfile(original, train.speed, train.direction)
  const progress = motionAt(oldProfile, oldProfile.duration * (1 - train.remaining / train.duration))
  let routeOffset = progress.offset
  const splitSection = insertion && original.from === insertion.section.from && original.to === insertion.section.to
  if (splitSection) {
    const split = train.direction === 1 ? insertion.offset : oldProfile.length - insertion.offset
    if (routeOffset > split) {
      train.at = after.stops.indexOf(insertion.station)
      routeOffset -= split
    }
  }
  const target = sectionAt(after, train.at, train.direction)!
  if (original === target) return
  const profile = trackProfile(target, train.speed, train.direction)
  const offset = splitSection ? routeOffset : routeOffset / oldProfile.length * profile.length
  train.duration = profile.duration
  train.remaining = Math.max(0, profile.duration - timeAtDistance(profile, offset))
}
