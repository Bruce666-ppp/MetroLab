import { activityOf, getCity, jobsOf, populationOf } from './city.ts'
import { netOperating } from './economy.ts'
import { cityCoverage, getDistrictAccess, servedStationIds, stationCapacity, trainLoad, waitingAt } from './network.ts'
import { alignmentMetrics, legacyRestricted } from './alignment.ts'
import { DWELL, TRAIN_SPEED } from './network.ts'
import { curveSpeedKmh, ENGINEERING, trackProfile } from './track.ts'
import type { City, GameState, Line } from './types.ts'

export function networkReach(game: GameState) {
  const city = getCity(game.cityId)
  const served = servedStationIds(game)
  const active = getDistrictAccess(city, game.stations.filter((station) => served.has(station.id)))
  return { served, active, planned: getDistrictAccess(city, game.stations) }
}

export function gameMetrics(game: GameState, reach: ReturnType<typeof networkReach>) {
  const city = getCity(game.cityId)
  const { coverage, population } = cityCoverage(city, game, reach.active)
  const today = game.today
  const waiting = game.stations.reduce((sum, station) => sum + waitingAt(game, station.id), 0)
  const fleet = game.trains.filter((train) => train.active)
  const onboard = fleet.reduce((sum, train) => sum + trainLoad(train), 0)
  const trainCongestion = fleet.length ? onboard / fleet.reduce((sum, train) => sum + train.capacity, 0) : 0
  const stationCongestion = game.stations.length
    ? waiting / game.stations.reduce((sum, station) => sum + stationCapacity(station), 0) : 0
  return {
    coverage, population, waiting, onboard, fleet: fleet.length,
    ridership: today.arrived,
    travelTime: today.arrived ? today.travelMinutes / today.arrived : undefined,
    satisfaction: today.arrived ? today.satisfactionPoints / today.arrived * (1 - Math.min(0.3, today.unmet / Math.max(1, today.demand) * 0.3)) : undefined,
    unmet: today.unmet,
    congestion: 0.62 * trainCongestion + 0.38 * stationCongestion,
    operating: netOperating(today),
  }
}

export function lineDetails(game: GameState, line: Line) {
  const { length: distance, radius } = alignmentMetrics(line.track)
  const trains = game.trains.filter((train) => train.lineId === line.id)
  const fleet = trains.filter((train) => train.active)
  const duration = (direction: 1 | -1) => line.track.reduce((sum, section) => {
    const travel = fleet.length ? fleet.reduce((total, train) => total + trackProfile(section, train.speed, direction).duration, 0) / fleet.length :
      trackProfile(section, TRAIN_SPEED, direction).duration
    return sum + travel + DWELL
  }, 0)
  const travel = duration(1)
  const cycle = travel + (line.circular ? 0 : duration(-1))
  const interval = fleet.length ? Math.max(line.headway, cycle / fleet.length) : undefined
  const capacity = interval === undefined ? undefined :
    60 * (fleet.reduce((sum, train) => sum + train.capacity, 0) / fleet.length) / interval
  const legacy = legacyRestricted(line)
  return { distance, trains, active: fleet.length, radius: legacy ? 0 : radius,
    limit: legacy ? undefined : curveSpeedKmh(radius), designSpeed: ENGINEERING.designSpeedKmh, travel, cycle, interval, capacity, legacy }
}

export function districtDetails(city: City, game: GameState, id: string) {
  const district = city.districts.find((area) => area.id === id)
  return district ? { district, population: populationOf(district, game), jobs: jobsOf(district, game),
    demand: game.districtDemand[id] ?? 0, activity: activityOf(district, game) } : undefined
}
