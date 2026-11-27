import { isWeekend, minuteOfDay } from './city.ts'
import { post } from './economy.ts'
import { distance } from './geometry.ts'
import { ferryAccess, hongKong } from './hongKong.ts'
import type { DistrictAccess } from './network.ts'
import { makeRoutingNetwork, routesFrom } from './routing.ts'
import type { Journey } from './routing.ts'
import type { GameState, PassengerGroup } from './types.ts'

// TD TCS 2022, table 3.4. Trips with both endpoints in the scenario's two subregions.
export const TCS_WEEKDAY = [1_909_000, 2_393_000, 1_970_000] as const
const INTERVAL = 5
const MINUTES_PER_HOUR = 60
const MODE_VALUE = 0.52
const choices = ['walk', 'bus', 'ferry'] as const
type Mode = typeof choices[number]
const zones = hongKong.zones
const count = zones.length

const hourly = (base: number, peaks: Record<number, number>) => {
  const weights = Array.from({ length: 24 }, (_, h) => (h < 5 || h > 22 ? base * .14 : base) + (peaks[h] ?? 0))
  const total = weights.reduce((sum, rate) => sum + rate, 0)
  return weights.map((rate) => rate / total)
}

const purposes = [
  { share: .50, weekend: .31, field: 'jobs', profile: 1,
    out: hourly(.30, { 6: 2.2, 7: 8.2, 8: 13.0, 9: 4.8, 10: 1.0, 12: .9 }),
    back: hourly(.28, { 15: 1.1, 16: 1.9, 17: 6.8, 18: 13.3, 19: 5.9, 20: 2.8, 21: 1 }) },
  { share: .12, weekend: .06, field: 'students', profile: 2,
    out: hourly(.06, { 6: .8, 7: 8.5, 8: 14, 9: 1.4, 12: .5 }),
    back: hourly(.06, { 12: .6, 13: 1, 14: 1.7, 15: 7.5, 16: 8, 17: 4.5, 18: 2.7 }) },
  { share: .23, weekend: 1.24, field: 'shops', profile: 3,
    out: hourly(.25, { 9: .7, 10: 2, 11: 2.8, 12: 3.2, 13: 3, 14: 3, 15: 3.3, 16: 3.6, 17: 4.2, 18: 4.2, 19: 2.5, 20: 1 }),
    back: hourly(.18, { 11: .7, 12: 1.5, 13: 2.4, 14: 2.8, 15: 2.9, 16: 3.2, 17: 3.7, 18: 4.5, 19: 4.0, 20: 3.8, 21: 3, 22: 1.3 }) },
  { share: .04, weekend: .66, field: 'health', profile: 4,
    out: hourly(.25, { 7: 1, 8: 2, 9: 3, 10: 4.6, 11: 3.6, 13: 3, 14: 3, 15: 3, 16: 2 }),
    back: hourly(.25, { 9: 1.8, 10: 2.5, 11: 3.6, 12: 4, 13: 1.6, 14: 2, 15: 3, 16: 3, 17: 2.5, 18: 1.2 }) },
  { share: .11, weekend: 1.38, field: 'leisure', profile: 5,
    out: hourly(.22, { 9: .9, 10: 2, 11: 2.1, 12: 2, 13: 2.1, 14: 3, 15: 3, 16: 3.2, 17: 3.6, 18: 4.4, 19: 3.1, 20: 1.7 }),
    back: hourly(.22, { 11: 1.1, 12: 1.6, 13: 2.1, 14: 2, 15: 2.4, 16: 2.8, 17: 3.4, 18: 4.1, 19: 4.3, 20: 4.3, 21: 4.2, 22: 2 }) },
] as const
const weekendOut = hourly(.23, { 8: .5, 9: 1.8, 10: 2.8, 11: 3.7, 12: 4.4, 13: 3.9, 14: 4, 15: 4, 16: 3.4, 17: 3.1, 18: 2.9, 19: 2 })
const weekendBack = hourly(.23, { 11: .6, 12: 1.2, 13: 2.2, 14: 3.2, 15: 3.6, 16: 4.2, 17: 5, 18: 5.6, 19: 5, 20: 4.3, 21: 3.5, 22: 1.8 })

interface TripPair {
  key: string; bank: number; km: number; baseline: number; ferryWalk: number; indexed: number
}

const banks = zones.map((zone) => zone.id.startsWith('1'))
const piers = zones.map((zone) => ferryAccess(zone.center))
const pairs: TripPair[] = zones.flatMap((origin, i) => zones.map((target, j) => {
  const km = i === j ? Math.max(.55, Math.min(2.6, Math.sqrt(origin.areaKm2) * .43)) : Math.max(.42, distance(origin.center, target.center) / 100)
  const bank = banks[i] === banks[j] ? banks[i] ? 0 : 1 : 2
  return { key: origin.id + '>' + target.id, bank, km, baseline: 7 + km * 3.25 + (bank === 2 ? 13 : 0),
    ferryWalk: (piers[i] + piers[j]) / 8, indexed: i * count + j }
}))

const gravity = purposes.map((purpose) => {
  const values = new Float64Array(pairs.length)
  const bankSum = [0, 0, 0]
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
    const key = i * count + j
    const pair = pairs[key]
    const weight = (zones[i].residents * zones[j][purpose.field]) / (1 + (pair.baseline / (purpose.field === 'jobs' ? 28 : 16)) ** 2.1)
    values[key] = weight
    bankSum[pair.bank] += weight
  }
  for (const pair of pairs) values[pair.indexed] *= .5 * TCS_WEEKDAY[pair.bank] * purpose.share / bankSum[pair.bank]
  return values
})

function timeWeights(minute: number) {
  const hour = Math.floor(minuteOfDay(minute) / 60)
  const weekend = isWeekend(minute)
  return purposes.map((purpose) => {
    const rate = INTERVAL / MINUTES_PER_HOUR * (weekend ? purpose.weekend : 1)
    return [rate * (weekend ? weekendOut : purpose.out)[hour], rate * (weekend ? weekendBack : purpose.back)[hour]]
  })
}

function expectedPair(i: number, j: number, rates: number[][]) {
  const outgoing = i * count + j
  const incoming = j * count + i
  return purposes.reduce((sum, _, purpose) => sum + gravity[purpose][outgoing] * rates[purpose][0] +
    gravity[purpose][incoming] * rates[purpose][1], 0)
}

export function demandDirections(id: string, minute: number) {
  const origin = zones.findIndex((zone) => zone.id === id)
  if (origin < 0) return { total: 0, destinations: [] as { id: string; trips: number; point: { x: number; y: number } }[] }
  const rates = timeWeights(minute)
  const links = zones.map((zone, j) => ({ id: zone.id, trips: expectedPair(origin, j, rates), point: zone.center }))
  return { total: Math.round(links.reduce((sum, link) => sum + link.trips, 0)),
    destinations: links.filter((link) => link.id !== id && link.trips >= 1).sort((a, b) => b.trips - a.trips).slice(0, 5) }
}

export function demandSurface(minute: number) {
  const rates = timeWeights(minute)
  return zones.map((_, i) => zones.reduce((sum, _, j) => sum + expectedPair(i, j, rates), 0))
}

export function activityPopulation(id: string, day: number, hour: number) {
  const index = zones.findIndex((zone) => zone.id === id)
  if (index < 0) return 0
  const weekend = isWeekend(day)
  return Math.max(0, Math.round(purposes.reduce((present, purpose, p) => {
    const out = weekend ? weekendOut : purpose.out
    const back = weekend ? weekendBack : purpose.back
    let absent = 0
    let net = 0
    for (let h = 0; h < hour; h++) absent += out[h] - back[h]
    for (let j = 0; j < count; j++) net += gravity[p][j * count + index] - gravity[p][index * count + j]
    return present + net * absent * (weekend ? purpose.weekend : 1)
  }, zones[index].residents)))
}

function alternative(pair: TripPair, peak: boolean) {
  const walk = pair.bank === 2 || pair.km > 3.8 ? Infinity : 3 + pair.km * 15.2
  const bus = pair.baseline + (peak ? 5 : 1) + MODE_VALUE * (pair.bank === 2 ? 15 : 7)
  const ferry = pair.bank !== 2 ? Infinity : 20 + 1.8 * pair.km + pair.ferryWalk + MODE_VALUE * 7
  const costs = [walk, bus, ferry]
  const best = Math.min(...costs)
  return { mode: choices[costs.indexOf(best)], cost: best }
}

export function demandPeriod(minute: number) {
  const hour = minuteOfDay(minute) / 60
  if (hour < 5 || hour >= 23) return 'night'
  if (!isWeekend(minute)) {
    if (hour >= 7 && hour < 10) return 'morning'
    if (hour >= 17 && hour < 20) return 'evening'
  }
  return 'offPeak'
}

export function isPeak(minute: number) {
  const period = demandPeriod(minute)
  return period === 'morning' || period === 'evening'
}

export function retainAlternative(game: GameState, count: number, mode: Mode = 'bus') {
  if (game.hongKong) game.hongKong.alternatives[mode] += count
  post(game, 'unmet', count)
}

function rounded(game: GameState, key: string, value: number, maximum = Infinity) {
  const expected = value + (game.carry[key] ?? 0)
  const realized = Math.min(maximum, Math.floor(expected))
  game.carry[key] = Math.min(1, Math.max(0, expected - realized))
  return realized
}

export function generateHongKongDemand(game: GameState, access: Record<string, DistrictAccess>, admit: (game: GameState, id: string, group: PassengerGroup) => number) {
  const rates = timeWeights(game.minute)
  const network = makeRoutingNetwork(game)
  const plans = new Map<string, ReturnType<typeof routesFrom>>()
  const paths = new Map<string, Journey | undefined>()
  const getPath = (from: string, to: string) => {
    const key = from + '>' + to
    if (paths.has(key)) return paths.get(key)
    const plan = plans.get(from) ?? routesFrom(network, [{ stationId: from, minutes: 0 }])
    plans.set(from, plan)
    const path = plan([{ stationId: to, minutes: 0 }])
    paths.set(key, path)
    return path
  }
  const newQueue = new Map<string, PassengerGroup>()
  const peak = isPeak(game.minute)
  for (let i = 0; i < count; i++) {
    const from = access[zones[i].id]?.choices ?? []
    let leaving = 0
    for (let j = 0; j < count; j++) {
      const pair = pairs[i * count + j]
      const expected = expectedPair(i, j, rates)
      const trips = rounded(game, pair.key, expected)
      if (!trips) continue
      leaving += trips
      post(game, 'demand', trips)
      game.hongKong!.od[pair.key] = (game.hongKong!.od[pair.key] ?? 0) + trips
      const other = alternative(pair, peak)
      const to = access[zones[j].id]?.choices ?? []
      const candidates: { value: number; journey: Journey; access: number; egress: number }[] = []
      for (const board of from) for (const alight of to) {
        if (board.stationId === alight.stationId) continue
        const path = getPath(board.stationId, alight.stationId)
        if (!path) continue
        for (const [p, purpose] of purposes.entries()) {
          const field = purpose.profile
          const weights = [gravity[p][pair.indexed] * rates[p][0], gravity[p][j * count + i] * rates[p][1]]
          for (const [direction, share] of weights.entries()) {
            const origin = direction ? field : 0
            const target = direction ? 0 : field
            const access = board.minutes[origin], egress = alight.minutes[target]
            const served = board.shares[origin] * alight.shares[target]
            if (served <= 0 || share <= 0) continue
            const rail = path.cost + access + egress
            const probability = .91 / (1 + Math.exp((rail - other.cost) / 5.5))
            const value = share / expected * served * probability
            if (value > 0.00001) candidates.push({ value, journey: path, access, egress })
          }
        }
      }
      const eligible = candidates.reduce((sum, option) => sum + option.value, 0)
      const rail = eligible ? rounded(game, 'rail:' + pair.key, trips * eligible, trips) : 0
      retainAlternative(game, trips - rail, other.mode)
      if (!rail) continue
      // Allocate the integer batch once, even when several stations cover the same district.
      const allocations = candidates.map((option, k) => ({ k, passengers: Math.floor(rail * option.value / eligible), remainder: (rail * option.value / eligible) % 1 }))
      const short = rail - allocations.reduce((sum, option) => sum + option.passengers, 0)
      allocations.sort((a, b) => b.remainder - a.remainder).slice(0, short).forEach((option) => option.passengers++)
      for (const { k, passengers } of allocations) {
        if (!passengers) continue
        const option = candidates[k]
        const walk = Math.round(option.access * 2) / 2, egress = Math.round(option.egress * 2) / 2
        const key = JSON.stringify([option.journey.legs, walk, egress, other.mode])
        const existing = newQueue.get(key)
        if (existing) existing.count += passengers
        else newQueue.set(key, { count: passengers, started: game.minute, readyAt: game.minute + walk, egress,
          legs: option.journey.legs, tickets: option.journey.tickets, alternative: other.mode })
      }
    }
    game.districtDemand[zones[i].id] = leaving
  }
  for (const group of newQueue.values()) admit(game, group.legs[0].board, group)
}
