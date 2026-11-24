import { developCity, getCity } from './city.ts'
import { applyOperatingMinute, blankTotals, grantMilestones, INITIAL_BUDGET, netOperating } from './economy.ts'
import { cityCoverage, getDistrictAccess, lineLength, servedStationIds } from './network.ts'
import type { DistrictAccess } from './network.ts'
import { DEMAND_INTERVAL, generateDemand, processPassengers } from './passengers.ts'
import { operateTrains } from './trains.ts'
import type { GameState, Mode } from './types.ts'

export const SAVE_VERSION = 2
export const TICK = 0.25

export function newGame(mode: Mode, cityId = 'marlow'): GameState {
  const city = getCity(cityId)
  return {
    version: SAVE_VERSION, cityId: city.id, mode, minute: 365, funds: INITIAL_BUDGET, nextId: 1,
    stations: [], lines: [], trains: [], queues: {}, egress: [],
    growth: Object.fromEntries(city.districts.map((area) => [area.id, Number(area.opens === 1)])),
    carry: {}, districtDemand: {}, stationActivity: {}, today: blankTotals(), lifetime: blankTotals(), history: [],
    hourArrivals: 0, hourBalance: 0, milestones: [], revision: 0,
  }
}

export function advanceGame(previous: GameState, minutes: number): GameState {
  const steps = Math.floor(minutes / TICK)
  if (!Number.isFinite(steps) || steps <= 0) return previous
  const city = getCity(previous.cityId)
  const game: GameState = {
    ...previous, lines: previous.lines.map((line) => ({ ...line })),
    trains: structuredClone(previous.trains), queues: structuredClone(previous.queues),
    egress: previous.egress.slice(), carry: { ...previous.carry },
    stationActivity: structuredClone(previous.stationActivity),
    districtDemand: { ...previous.districtDemand }, today: { ...previous.today }, lifetime: { ...previous.lifetime },
    milestones: previous.milestones.slice(),
  }
  const stations = new Map(game.stations.map((station) => [station.id, station]))
  let access: Record<string, DistrictAccess> | undefined
  let trackLength: number | undefined
  for (let i = 0; i < steps; i++) {
    game.minute += TICK
    processPassengers(game)
    operateTrains(game, TICK, stations)
    if (game.minute % 1 !== 0) continue
    if (!access) {
      const served = servedStationIds(game)
      access = getDistrictAccess(city, game.stations.filter((station) => served.has(station.id)))
    }
    trackLength ??= game.lines.reduce((length, line) => length + lineLength(game.stations, line), 0)
    const { coverage } = cityCoverage(city, game, access)
    applyOperatingMinute(game, coverage, trackLength)
    grantMilestones(game, coverage)
    if (game.minute % 60 === 0) {
      const balance = netOperating(game.lifetime)
      game.history = [...game.history.slice(-47), {
        minute: game.minute, arrivals: game.lifetime.arrived - game.hourArrivals, coverage,
        balance: balance - game.hourBalance,
      }]
      game.hourArrivals = game.lifetime.arrived
      game.hourBalance = balance
    }
    if (game.minute % 1440 === 0) {
      game.today = blankTotals()
      game.stationActivity = {}
      game.growth = { ...game.growth }
      developCity(city, game, Object.fromEntries(Object.entries(access).map(([id, value]) => [id, value.fraction])))
    }
    if (game.minute % DEMAND_INTERVAL === 0) generateDemand(city, game, access)
  }
  return game
}
