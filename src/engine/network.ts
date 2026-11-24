import { districtAt, jobsOf, populationOf } from './city.ts'
import { measureTrack, stationPrice } from './economy.ts'
import { distance, isWater, octilinear, pathLength, walkDistance } from './geometry.ts'
import type { City, Direction, GameState, Line, Point, Station } from './types.ts'

export const LINE_COLORS = ['#2864d4', '#07865e', '#e47825', '#a552b7', '#ce4450', '#00879d', '#a16e14', '#4053a6']
export const TRAIN_SPEED = 88
export const DWELL = 0.75
export const MIN_STATION_GAP = 42
export const stationRadius = (level: Station['level']) => 147 + 27 * (level - 1)
export const stationCapacity = (station: Station) => 120 + (station.level - 1) * 90 + (station.interchange ? 85 : 0)

export function pairsOf(stops: string[], circular: boolean): [string, string][] {
  const pairs: [string, string][] = stops.slice(1).map((stop, index) => [stops[index], stop])
  if (circular && stops.length > 2) pairs.push([stops.at(-1)!, stops[0]])
  return pairs
}

export const pairKey = (a: string, b: string) => a < b ? a + '|' + b : b + '|' + a

export function nextStop(line: Line, at: number, direction: Direction) {
  const next = at + direction
  return line.circular ? (next + line.stops.length) % line.stops.length : next
}

export function trackCost(city: City, stations: Station[], stops: string[], circular: boolean, oldLine?: Line) {
  const positions = new Map(stations.map((station) => [station.id, station.position]))
  const existing = new Set(oldLine && pairsOf(oldLine.stops, oldLine.circular).map(([a, b]) => pairKey(a, b)))
  return pairsOf(stops, circular).reduce((total, [a, b]) => {
    if (existing.has(pairKey(a, b)) || !positions.has(a) || !positions.has(b)) return total
    return total + measureTrack(city, positions.get(a)!, positions.get(b)!).price
  }, 0)
}

export function lineLength(stations: Station[], line: Line) {
  const positions = new Map(stations.map((station) => [station.id, station.position]))
  return pairsOf(line.stops, line.circular).reduce((total, [a, b]) =>
    total + pathLength(octilinear(positions.get(a)!, positions.get(b)!)), 0)
}

export function stationPreview(city: City, game: GameState, position: Point, ignore?: string) {
  const { area } = districtAt(city, position)
  const level = game.stations.find((station) => station.id === ignore)?.level ?? 1
  const radius = stationRadius(level)
  let population = 0
  let jobs = 0
  for (const district of city.districts) {
    const samples = city.tripSamples.get(district.id) ?? []
    const covered = samples.filter((sample) => walkDistance(city, position, sample) <= radius).length
    const share = samples.length ? covered / samples.length : 0
    population += Math.round(populationOf(district, game) * share)
    jobs += Math.round(jobsOf(district, game) * share)
  }
  let error: 'outOfBounds' | 'water' | 'tooClose' | undefined
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) ||
    position.x < 14 || position.x > city.width - 14 || position.y < 14 || position.y > city.height - 14) {
    error = 'outOfBounds'
  } else if (isWater(city, position, 6)) {
    error = 'water'
  } else if (game.stations.some((station) => station.id !== ignore && distance(station.position, position) < MIN_STATION_GAP)) {
    error = 'tooClose'
  }
  return { district: area.id, radius, population, jobs, cost: stationPrice(city, position, jobs), error }
}

export interface AccessLink {
  stationId: string
  minutes: number
}

export interface DistrictAccess {
  fraction: number
  links: AccessLink[]
}

export function servedStationIds(game: GameState) {
  const activeLines = new Set(game.trains.filter((train) => train.active).map((train) => train.lineId))
  return new Set(game.lines.filter((line) => activeLines.has(line.id)).flatMap((line) => line.stops))
}

export function getDistrictAccess(city: City, stations: Station[]): Record<string, DistrictAccess> {
  return Object.fromEntries(city.districts.map((district) => {
    const samples = city.tripSamples.get(district.id) ?? []
    const walks = new Map<string, { distance: number; count: number }>()
    let covered = 0
    for (const sample of samples) {
      let reachable = false
      for (const station of stations) {
        const direct = distance(sample, station.position)
        if (direct > stationRadius(station.level)) continue
        const distanceByFoot = walkDistance(city, station.position, sample)
        if (distanceByFoot > stationRadius(station.level)) continue
        const summary = walks.get(station.id) ?? { count: 0, distance: 0 }
        summary.count++
        summary.distance += distanceByFoot
        walks.set(station.id, summary)
        reachable = true
      }
      if (reachable) covered++
    }
    const links = Array.from(walks, ([stationId, summary]) => ({
      stationId,
      minutes: 1.2 + (summary.distance / summary.count) / 12 + 1.7 * (1 - summary.count / samples.length),
    })).sort((a, b) => a.minutes - b.minutes).slice(0, 4)
    return [district.id, { links, fraction: samples.length ? covered / samples.length : 0 }]
  }))
}

export function cityCoverage(city: City, game: GameState, access: Record<string, DistrictAccess>) {
  let population = 0
  let served = 0
  for (const district of city.districts) {
    const residents = populationOf(district, game)
    population += residents
    served += residents * (access[district.id]?.fraction ?? 0)
  }
  return { population, coverage: population ? served / population : 0 }
}

export function waitingAt(game: GameState, stationId: string) {
  return (game.queues[stationId] ?? []).reduce((sum, group) => sum + (group.readyAt <= game.minute ? group.count : 0), 0)
}

export function trainLoad(train: GameState['trains'][number]) {
  return train.loads.reduce((sum, group) => sum + group.count, 0)
}
