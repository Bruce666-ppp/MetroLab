import { districtAt, jobsOf, populationOf } from './city.ts'
import { stationGroundError, stationPrice } from './economy.ts'
import type { EngineeringError } from './economy.ts'
import { distance, isWater, walkDistance } from './geometry.ts'
import { hongKongStationSiteError, walkCells, walkingMinutes, walkRadius } from './hongKong.ts'
import { ENGINEERING, kmhToUnitsPerMinute, trackLength } from './track.ts'
import type { City, Direction, GameState, Line, Point, Station, TrackMethod } from './types.ts'

export const LINE_COLORS = ['#2864d4', '#07865e', '#e47825', '#a552b7', '#ce4450', '#00879d', '#a16e14', '#4053a6']
export const TRAIN_SPEED = kmhToUnitsPerMinute(ENGINEERING.designSpeedKmh)
export const DWELL = 0.75
export const MIN_STATION_GAP = 42
export const stationRadius = (level: Station['level']) => 147 + 27 * (level - 1)
export const stationCapacity = (station: Station) => station.method ? 800 + (station.level - 1) * 650 + (station.interchange ? 850 : 0) :
  120 + (station.level - 1) * 90 + (station.interchange ? 85 : 0)
export const stationGap = (city: City) => city.hongKong ? 2.4 : MIN_STATION_GAP

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

export function lineLength(line: Line) {
  return line.track.reduce((total, section) => total + trackLength(section.pieces), 0) +
    trackLength(line.openEnds?.head?.pieces ?? []) + trackLength(line.openEnds?.tail?.pieces ?? [])
}

export type StationSiteError = NonNullable<ReturnType<typeof hongKongStationSiteError>>

export function stationSiteError(city: City, position: Point): StationSiteError | undefined {
  if (city.hongKong) return hongKongStationSiteError(position)
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) ||
    position.x < 14 || position.x > city.width - 14 || position.y < 14 || position.y > city.height - 14) return 'outOfBounds'
  if (isWater(city, position, 6)) return 'water'
}

export function stationPreview(city: City, game: GameState, position: Point, ignore?: string, method?: TrackMethod) {
  const { area } = districtAt(city, position)
  const level = game.stations.find((station) => station.id === ignore)?.level ?? 1
  const radius = city.hongKong ? walkRadius(level) : stationRadius(level)
  let population = 0
  let jobs = 0
  if (city.hongKong) {
    for (const index of walkCells(position, level).keys()) {
      const cell = city.hongKong.cells[index]
      population += cell.residents
      jobs += cell.jobs
    }
  } else {
    for (const district of city.districts) {
      const samples = city.tripSamples.get(district.id) ?? []
      const covered = samples.filter((sample) => walkDistance(city, position, sample) <= radius).length
      const share = samples.length ? covered / samples.length : 0
      population += Math.round(populationOf(district, game) * share)
      jobs += Math.round(jobsOf(district, game) * share)
    }
  }
  let error: StationSiteError | 'tooClose' | EngineeringError | undefined = stationSiteError(city, position)
  if (!error && game.stations.some((station) => station.id !== ignore && distance(station.position, position) < stationGap(city))) {
    error = 'tooClose'
  }
  if (!error && city.hongKong && method) error = stationGroundError(position, method)
  return { district: area.id, radius, population, jobs, cost: stationPrice(city, position, jobs, method), error }
}

export interface AccessLink {
  stationId: string
  minutes: number
}

export interface DistrictAccess {
  fraction: number
  links: AccessLink[]
  jobs?: number
  choices?: { stationId: string; minutes: number[]; shares: number[] }[]
}

export function servedStationIds(game: GameState) {
  const activeLines = new Set(game.trains.filter((train) => train.active).map((train) => train.lineId))
  return new Set(game.lines.filter((line) => activeLines.has(line.id) && !line.suspended).flatMap((line) => line.stops))
}

export const cellActivities = (cell: NonNullable<City['hongKong']>['cells'][number]) =>
  [cell.residents, cell.jobs, cell.students, cell.shops, cell.health, cell.leisure]

export function coveredCells(stations: Station[]) {
  const reached = new Map<number, { id: string; length: number }>()
  for (const station of stations) for (const [cell, length] of walkCells(station.position, station.level)) {
    if (length < (reached.get(cell)?.length ?? Infinity)) reached.set(cell, { id: station.id, length })
  }
  return reached
}

function hongKongAccess(city: NonNullable<City['hongKong']>, stations: Station[]): Record<string, DistrictAccess> {
  const allocations = city.zones.map(() => new Map<string, { units: number[]; weights: number[] }>())
  for (const [index, hit] of coveredCells(stations)) {
    const cell = city.cells[index]
    const zone = allocations[cell.zone]
    const byStation = zone.get(hit.id) ?? { units: new Array<number>(6).fill(0), weights: new Array<number>(6).fill(0) }
    cellActivities(cell).forEach((weight, i) => {
      byStation.units[i] += weight * hit.length
      byStation.weights[i] += weight
    })
    zone.set(hit.id, byStation)
  }
  return Object.fromEntries(city.zones.map((zone, i) => {
    const totals = [zone.residents, zone.jobs, zone.students, zone.shops, zone.health, zone.leisure]
    const choices = Array.from(allocations[i], ([stationId, { units, weights }]) => ({ stationId,
      minutes: units.map((length, i) => walkingMinutes(weights[i] ? length / weights[i] : 0)),
      shares: weights.map((weight, i) => totals[i] ? weight / totals[i] : 0),
    }))
    const covered = (i: number) => Math.min(1, choices.reduce((sum, item) => sum + item.shares[i], 0))
    const links = choices.map((item) => ({ stationId: item.stationId, minutes: item.minutes[0] || item.minutes[1] }))
    return [zone.id, { fraction: covered(0), jobs: covered(1), choices, links }]
  }))
}

export function getDistrictAccess(city: City, stations: Station[]): Record<string, DistrictAccess> {
  if (city.hongKong) return hongKongAccess(city.hongKong, stations)
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
  let jobs = 0
  let servedJobs = 0
  for (const district of city.districts) {
    const residents = populationOf(district, game)
    population += residents
    served += residents * (access[district.id]?.fraction ?? 0)
    if (city.hongKong) {
      jobs += district.jobs
      servedJobs += district.jobs * (access[district.id]?.jobs ?? 0)
    }
  }
  return { population, coverage: population ? served / population : 0, jobs, jobCoverage: jobs ? servedJobs / jobs : 0 }
}

export function waitingAt(game: GameState, stationId: string) {
  return (game.queues[stationId] ?? []).reduce((sum, group) => sum + (group.readyAt <= game.minute ? group.count : 0), 0)
}

export function trainLoad(train: GameState['trains'][number]) {
  return train.loads.reduce((sum, group) => sum + group.count, 0)
}
