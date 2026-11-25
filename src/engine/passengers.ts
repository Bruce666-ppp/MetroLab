import { activityOf, isWeekend, minuteOfDay, populationOf } from './city.ts'
import { FARE, post } from './economy.ts'
import { clamp, distance } from './geometry.ts'
import { stationCapacity } from './network.ts'
import type { DistrictAccess } from './network.ts'
import { makeRoutingNetwork, routesFrom } from './routing.ts'
import type { City, District, GameState, PassengerGroup } from './types.ts'

export const DEMAND_INTERVAL = 5
const MAX_WAIT = 48
const MAX_JOURNEY = 155

export function departureRates(game: GameState, district: District) {
  const hour = minuteOfDay(game.minute) / 60
  const weekend = isWeekend(game.minute)
  const { residents: population, jobs, visits, students } = activityOf(district, game)
  const morning = !weekend && hour >= 6 && hour < 10
  const evening = !weekend && hour >= 16 && hour < 20
  const daytime = hour >= 8 && hour < 22
  const shops = hour >= 11 && hour < 21
  const termStart = !weekend && hour >= 6.75 && hour < 9
  const termEnd = !weekend && hour >= 14.75 && hour < 17
  return {
    work: population * (morning ? 0.00082 : daytime && !weekend ? 0.000068 : 0.000015),
    home: jobs * (evening ? 0.00105 : daytime && !weekend ? 0.000075 : 0.000015),
    leisure: population * (shops ? weekend ? 0.00049 : 0.00027 : daytime ? 0.000075 : 0.000018),
    return: visits * (hour >= 11 && hour < 23 ? weekend ? 0.00156 : 0.00080 : 0.000018),
    school: termStart ? population * 0.00019 : 0,
    schoolReturn: termEnd ? students * 0.00105 : 0,
  }
}

type Purpose = keyof ReturnType<typeof departureRates>
export type ActivityCount = keyof GameState['stationActivity'][string]

export function trackStationActivity(game: GameState, id: string, activity: ActivityCount, count: number) {
  if (!count) return
  const station = game.stationActivity[id] ??= { requested: 0, boarded: 0, alighted: 0 }
  station[activity] += count
}

function attraction(game: GameState, area: District, purpose: Purpose) {
  const profile = activityOf(area, game)
  switch (purpose) {
    case 'work': return profile.jobs
    case 'school': return profile.students
    case 'leisure': return profile.visits
    case 'home':
    case 'schoolReturn':
    case 'return': return populationOf(area, game)
  }
}

function roundWithCarry(game: GameState, key: string, expected: number) {
  const total = expected + (game.carry[key] ?? 0)
  const count = Math.floor(total)
  game.carry[key] = total - count
  return count
}

export function admitGroup(game: GameState, stationId: string, group: PassengerGroup) {
  const station = game.stations.find((entry) => entry.id === stationId)
  if (station) trackStationActivity(game, stationId, 'requested', group.count)
  const queue = game.queues[stationId] ?? (game.queues[stationId] = [])
  const reserved = queue.reduce((sum, entry) => sum + entry.count, 0)
  const accepted = station ? clamp(group.count, 0, Math.max(0, stationCapacity(station) - reserved)) : 0
  if (accepted) queue.push({ ...group, count: accepted })
  post(game, 'unmet', group.count - accepted)
  return accepted
}

export function generateDemand(city: City, game: GameState, access: Record<string, DistrictAccess>) {
  const network = makeRoutingNetwork(game)
  const districts = city.districts.filter((district) => game.growth[district.id])
  for (const origin of districts) {
    const origins = access[origin.id]
    const plan = origins.links.length ? routesFrom(network, origins.links) : undefined
    const targets = districts.filter((target) => target !== origin)
    const expected = new Array<number>(targets.length).fill(0)
    for (const [purpose, rate] of Object.entries(departureRates(game, origin)) as [Purpose, number][]) {
      if (rate === 0) continue
      const weights = targets.map((target) => attraction(game, target, purpose) / (1 + (distance(origin.center, target.center) / 510) ** 1.3))
      const sum = weights.reduce((a, b) => a + b, 0)
      if (sum === 0) continue
      for (let i = 0; i < weights.length; i++) expected[i] += DEMAND_INTERVAL * rate * weights[i] / sum
    }
    let outgoing = 0
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      const od = origin.id + '>' + target.id
      const count = roundWithCarry(game, od, expected[i])
      if (!count) continue
      outgoing += count
      post(game, 'demand', count)
      const destination = access[target.id]
      const journey = plan?.(destination.links)
      if (!journey) {
        post(game, 'unmet', count)
        continue
      }
      const served = roundWithCarry(game, 'access:' + od, count * origins.fraction * destination.fraction)
      post(game, 'unmet', count - served)
      if (!served) continue
      admitGroup(game, journey.legs[0].board, {
        count: served, started: game.minute, readyAt: game.minute + journey.access,
        egress: journey.egress, legs: journey.legs,
      })
    }
    game.districtDemand[origin.id] = outgoing
  }
}

export function processPassengers(game: GameState) {
  for (const [stationId, queue] of Object.entries(game.queues)) {
    game.queues[stationId] = queue.filter((group) => {
      if (game.minute - group.readyAt <= MAX_WAIT && game.minute - group.started <= MAX_JOURNEY) return true
      post(game, 'unmet', group.count)
      return false
    })
  }
  game.egress = game.egress.filter((group) => {
    if (group.readyAt > game.minute) return true
    const travelTime = game.minute - group.started
    const fare = group.count * FARE
    game.funds += fare
    post(game, 'fares', fare)
    post(game, 'arrived', group.count)
    post(game, 'travelMinutes', travelTime * group.count)
    post(game, 'satisfactionPoints', clamp((85 - travelTime) / 60, 0.2, 1) * group.count)
    return false
  })
}

export function withdrawLineTrips(game: GameState, affected: Set<string>) {
  const keep = (group: PassengerGroup) => {
    if (!group.legs.some((leg) => affected.has(leg.lineId))) return true
    post(game, 'unmet', group.count)
    return false
  }
  for (const [id, queue] of Object.entries(game.queues)) game.queues[id] = queue.filter(keep)
  for (const train of game.trains) train.loads = train.loads.filter(keep)
}
