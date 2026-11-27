import { isWater } from './geometry.ts'
import { densityAt, elevationAt, HONG_KONG, surfaceAt } from './hongKong.ts'
import { HKD } from './hongKongConfig.ts'
import { allTrack, pieceLength, pointOnPiece } from './track.ts'
import type { City, GameState, Point, Station, Totals, TrackMethod, TrackPiece } from './types.ts'

export const INITIAL_BUDGET = 20_000_000
export const TRAIN_PRICE = 520_000
export const TRAIN_REFUND = 190_000
export const INTERCHANGE_PRICE = 235_000
export const FARE = 32

export { HKD, trackMethods } from './hongKongConfig.ts'
export const trainPrice = (game: GameState) => game.cityId === HONG_KONG ? HKD.train : TRAIN_PRICE
export const trainRefund = (game: GameState) => game.cityId === HONG_KONG ? HKD.resale : TRAIN_REFUND
export const interchangePrice = (game: GameState) => game.cityId === HONG_KONG ? HKD.interchange : INTERCHANGE_PRICE

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

export type EngineeringError = 'outsideArea' | 'surfaceWater' | 'surfaceObstruction' | 'surfaceGrade'

export function stationGroundError(position: Point, method: TrackMethod): EngineeringError | undefined {
  if (densityAt(position) > Math.min(0.84, HKD.methods[method].occupancy + 0.18)) {
    return method === 'underground' ? undefined : 'surfaceObstruction'
  }
}

export function measurePieces(city: City, pieces: TrackPiece[], fallback: TrackMethod = 'underground') {
  let length = 0
  let waterLength = 0
  const methods = { underground: 0, elevated: 0, atGrade: 0 }
  let terrain = 0
  let waterPremium = 0
  let error: EngineeringError | undefined
  let previous: { point: Point; height: number } | undefined
  for (const piece of pieces) {
    const extent = pieceLength(piece)
    length += extent
    const samples = Math.max(1, Math.ceil(extent / (city.hongKong ? 3 : 9)))
    const step = extent / samples
    const method = piece.method ?? fallback
    const rules = HKD.methods[method]
    if (city.hongKong) methods[method] += extent * rules.perKm / 100
    let obstructed = 0
    let steep = 0
    for (let i = 0; i < samples; i++) {
      const point = pointOnPiece(piece, (i + 0.5) / samples)
      if (!city.hongKong) {
        if (isWater(city, point)) waterLength += step
        continue
      }
      const surface = surfaceAt(point)
      if (surface === 'outside') error ??= 'outsideArea'
      if (surface === 'water') {
        waterLength += step
        if (method === 'underground') waterPremium += step * HKD.harbourPerKm / 100
        else error ??= 'surfaceWater'
        previous = undefined
        continue
      }
      const altitude = elevationAt(point)
      const occupancy = densityAt(point)
      const slope = previous ? Math.abs(altitude - previous.height) /
        Math.max(35, 10 * Math.hypot(point.x - previous.point.x, point.y - previous.point.y)) : 0
      previous = { point, height: altitude }
      terrain += step * rules.perKm / 100 * (occupancy * (method === 'underground' ? .32 : .75) + Math.min(.36, slope)
        * (method === 'underground' ? .29 : .83) + Math.min(.18, altitude / 1800))
      if (occupancy > rules.occupancy) obstructed += step
      if (slope > rules.grade) steep += step
    }
    if (obstructed * 10 > Math.max(45, extent * 1.2)) error ??= 'surfaceObstruction'
    if (steep * 10 > Math.max(55, extent * 1.3)) error ??= 'surfaceGrade'
  }
  const subtotal = city.hongKong ? Object.values(methods).reduce((sum, price) => sum + price, terrain + waterPremium) : length * 4900 + waterLength * 9400
  return { length, waterLength, price: Math.ceil(subtotal / 1000) * 1000, methods, terrain, waterPremium, error }
}

export function stationPrice(city: City, position: Point, jobs: number, method: TrackMethod = 'underground') {
  if (city.hongKong) return Math.round(HKD.methods[method].station * (1 + densityAt(position) * 0.5 + elevationAt(position) / 2500) / 1000) * 1000
  return Math.round((470 + jobs / 100 + (isWater(city, position, 37) ? 135 : 0)) / 5) * 5000
}

export const upgradePrice = (station: Station) => station.method ? Math.round(HKD.methods[station.method].station * (station.level === 1 ? 0.34 : 0.55)) :
  station.level === 1 ? 370_000 : 610_000

export const netOperating = (totals: Totals) => totals.fares + totals.subsidy - totals.expenses

export function lineActivity(game: GameState, id: string) {
  if (!game.hongKong) return undefined
  return game.hongKong.lineActivity[id] ??= { boarded: 0, peak: 0, load: 0, departures: 0, fares: 0, expenses: 0 }
}

export function postExpense(game: GameState, amount: number, id?: string) {
  if (id) {
    const stats = lineActivity(game, id)
    if (stats) stats.expenses += amount
  }
  game.funds -= amount
  post(game, 'expenses', amount)
}

function operateHongKong(game: GameState) {
  const active = new Map<string, number>()
  const lines = new Map(game.lines.map((line) => [line.id, line]))
  for (const train of game.trains) {
    const running = train.active && !lines.get(train.lineId)?.suspended
    if (running) active.set(train.lineId, 1 + (active.get(train.lineId) ?? 0))
    postExpense(game, running ? HKD.crewMinute : HKD.idleTrainMinute, train.lineId)
  }
  const byStation = new Map<string, string[]>()
  for (const line of game.lines) {
    const maintenance = allTrack(line).reduce((total, section) => total + section.pieces.reduce((amount, piece) =>
      amount + pieceLength(piece) * HKD.methods[piece.method ?? section.method ?? 'underground'].upkeepKmMinute / 100, 0), 0)
    postExpense(game, Math.round(maintenance), line.id)
    for (const id of line.stops) {
      const entries = byStation.get(id) ?? []
      entries.push(line.id)
      byStation.set(id, entries)
    }
  }
  for (const station of game.stations) {
    const entries = byStation.get(station.id) ?? []
    const operating = entries.filter((id) => active.has(id))
    const amount = operating.length ? HKD.stationMinute * station.level + (station.interchange ? 36 : 0) : HKD.idleStationMinute
    const charging = operating.length ? operating : entries
    if (!charging.length) postExpense(game, amount)
    else charging.forEach((id, i) => postExpense(game, Math.floor(amount * (i + 1) / charging.length) - Math.floor(amount * i / charging.length), id))
  }
}

export function applyOperatingMinute(game: GameState, coverage: number, trackLength: number) {
  if (game.hongKong) { operateHongKong(game); return }
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
  if (game.mode !== 'career' || game.hongKong) return
  for (const milestone of milestones) {
    if (game.milestones.includes(milestone.id) || milestoneValue(game, coverage, milestone.metric) < milestone.target) continue
    game.funds += milestone.reward
    post(game, 'rewards', milestone.reward)
    game.milestones.push(milestone.id)
  }
}
