import { distance, isWater, octilinear, pathLength } from './geometry.ts'
import type { City, GameState, Point, Station, Totals } from './types.ts'

export const INITIAL_BUDGET = 20_000_000
export const TRAIN_PRICE = 520_000
export const TRAIN_REFUND = 190_000
export const INTERCHANGE_PRICE = 235_000
export const FARE = 32

export const blankTotals = (): Totals => ({
  demand: 0, unmet: 0, arrived: 0, transfers: 0, travelMinutes: 0, satisfactionPoints: 0,
  fares: 0, subsidy: 0, rewards: 0, expenses: 0, construction: 0, salvage: 0,
})

export function post(game: GameState, category: keyof Totals, amount: number) {
  game.today[category] += amount
  game.lifetime[category] += amount
}

export const canAfford = (game: GameState, amount: number) => amount <= 0 || game.mode === 'sandbox' || game.funds >= amount

export function spendCapital(game: GameState, amount: number) {
  game.funds -= amount
  post(game, 'construction', amount)
}

export function salvage(game: GameState, amount: number) {
  game.funds += amount
  post(game, 'salvage', amount)
}

export function measureTrack(city: City, a: Point, b: Point) {
  const points = octilinear(a, b)
  let waterLength = 0
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    const length = distance(from, to)
    const samples = Math.max(1, Math.ceil(length / 9))
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples
      if (isWater(city, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })) {
        waterLength += length / samples
      }
    }
  }
  const length = pathLength(points)
  return { length, waterLength, price: Math.ceil((length * 4900 + waterLength * 9400) / 1000) * 1000 }
}

export function stationPrice(city: City, position: Point, jobs: number) {
  return Math.round((470 + jobs / 100 + (isWater(city, position, 37) ? 135 : 0)) / 5) * 5000
}

export const upgradePrice = (station: Station) => station.level === 1 ? 370_000 : 610_000

export const netOperating = (totals: Totals) => totals.fares + totals.subsidy - totals.expenses

export function applyOperatingMinute(game: GameState, coverage: number, trackLength: number) {
  const activeTrains = game.trains.filter((train) => train.active)
  const stationUpkeep = game.stations.reduce((total, station) => total + 14 + 6 * station.level + (station.interchange ? 6 : 0), 0)
  const fleetUpkeep = game.trains.reduce((total, train) => total + (train.active ? train.operatingCost : 12), 0)
  const expenses = Math.round(fleetUpkeep + stationUpkeep + trackLength * 0.056)
  const subsidy = activeTrains.length ? Math.round(170 + 510 * coverage) : 0
  game.funds += subsidy - expenses
  post(game, 'expenses', expenses)
  post(game, 'subsidy', subsidy)
}

export const milestones = [
  { id: 'firstRide', target: 50, reward: 700_000, metric: 'lifetime' },
  { id: 'connected', target: 0.36, reward: 1_200_000, metric: 'coverage' },
  { id: 'busyDay', target: 550, reward: 1_900_000, metric: 'today' },
  { id: 'transfer', target: 120, reward: 1_500_000, metric: 'transfers' },
] as const

export function milestoneValue(game: GameState, coverage: number, metric: typeof milestones[number]['metric']) {
  switch (metric) {
    case 'coverage': return coverage
    case 'today': return game.today.arrived
    case 'transfers': return game.lifetime.transfers
    case 'lifetime': return game.lifetime.arrived
  }
}

export function grantMilestones(game: GameState, coverage: number) {
  if (game.mode !== 'career') return
  for (const milestone of milestones) {
    if (game.milestones.includes(milestone.id) || milestoneValue(game, coverage, milestone.metric) < milestone.target) continue
    game.funds += milestone.reward
    post(game, 'rewards', milestone.reward)
    game.milestones.push(milestone.id)
  }
}
