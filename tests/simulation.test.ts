import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAction } from '../src/engine/actions.ts'
import type { Action } from '../src/engine/actions.ts'
import { gameMetrics, networkReach } from '../src/engine/analytics.ts'
import { dayNumber, getCity } from '../src/engine/city.ts'
import { blankTotals, FARE, INITIAL_BUDGET, measurePieces, netOperating, TRAIN_PRICE } from '../src/engine/economy.ts'
import { exampleGame } from '../src/engine/example.ts'
import { distance, walkDistance } from '../src/engine/geometry.ts'
import { getDistrictAccess, LINE_COLORS, stationPreview, trainLoad, waitingAt } from '../src/engine/network.ts'
import { admitGroup, generateDemand } from '../src/engine/passengers.ts'
import { makeRoutingNetwork, routesFrom } from '../src/engine/routing.ts'
import { advanceGame, newGame } from '../src/engine/simulation.ts'
import { trackStraight } from '../src/engine/track.ts'
import { trainPosition } from '../src/engine/trains.ts'
import type { GameState, Point } from '../src/engine/types.ts'

const city = getCity('marlow')
const west = { x: 295, y: 416 }
const central = { x: 747, y: 505 }
const east = { x: 1288, y: 475 }
const market = { x: 506, y: 613 }

function execute(game: GameState, action: Action) {
  const result = applyAction(game, action)
  assert.ok(result.game, 'Expected action success: ' + result.error)
  return result
}

function setup(points: Point[], links: number[][], fleet = 1, circular = false) {
  let game = newGame('career')
  const stops = points.map((point) => {
    const result = execute(game, { type: 'buildStation', point })
    game = result.game
    return result.id!
  })
  const lines = links.map((indices, i) => {
    const design = { name: '', color: LINE_COLORS[i], stops: indices.map((index) => stops[index]), circular }
    const result = execute(game, { type: 'saveLine', design })
    game = result.game
    for (let k = 0; k < fleet; k++) {
      game = execute(game, { type: 'buyTrain', id: result.id! }).game
    }
    return result.id!
  })
  return { game, stops, lines }
}

function route(game: GameState, a: string, b: string) {
  return routesFrom(makeRoutingNetwork(game), [{ stationId: a, minutes: 2 }])([{ stationId: b, minutes: 3 }])
}

test('the authored city has seven land uses, useful walking bridges and higher river construction costs', () => {
  assert.equal(new Set(city.districts.map((district) => district.zone)).size, 7)
  assert.ok(city.bridges.length >= 4)
  const a = { x: 800, y: 530 }
  const b = { x: 1070, y: 530 }
  const crossing = measurePieces(city, [trackStraight(a, b)])
  const dry = measurePieces(city, [trackStraight({ x: 410, y: 530 }, { x: 680, y: 530 })])
  assert.equal(crossing.length, dry.length)
  assert.ok(crossing.waterLength > 60 && dry.waterLength === 0)
  assert.ok(crossing.price > dry.price)
  assert.ok(walkDistance(city, a, b) > distance(a, b))
})

test('walking catchments depend on station locations, capacity upgrades and active service', () => {
  const { game, stops, lines } = setup([west, central], [[0, 1]], 0)
  const initial = networkReach(game)
  assert.ok(initial.planned.westend.fraction > 0.65)
  assert.equal(initial.active.westend.fraction, 0)
  const served = execute(game, { type: 'buyTrain', id: lines[0] }).game
  const before = gameMetrics(served, networkReach(served))
  const upgraded = execute(served, { type: 'upgradeStation', id: stops[0] }).game
  assert.ok(gameMetrics(upgraded, networkReach(upgraded)).coverage >= before.coverage)
  const moved = execute(upgraded, { type: 'moveStation', id: stops[0], point: { x: 175, y: 460 } }).game
  assert.ok(networkReach(moved).planned.westend.fraction < networkReach(upgraded).planned.westend.fraction)
  assert.ok(stationPreview(city, game, central).jobs > stationPreview(city, game, west).jobs)
})

test('invalid construction, line designs and insufficient funds leave the input state intact', () => {
  const { game, stops } = setup([west, central], [])
  const snapshot = structuredClone(game)
  assert.equal(applyAction(game, { type: 'buildStation', point: { x: city.river(490).center, y: 490 } }).error, 'water')
  assert.equal(applyAction(game, { type: 'buildStation', point: west }).error, 'tooClose')
  assert.equal(applyAction(game, { type: 'buildStation', point: { x: -35, y: 100 } }).error, 'outOfBounds')
  const design = { name: '', color: LINE_COLORS[0], stops: [stops[0], stops[0]], circular: false }
  assert.equal(applyAction(game, { type: 'saveLine', design }).error, 'invalidStops')
  assert.equal(applyAction(game, { type: 'saveLine', design: { ...design, stops, circular: true } }).error, 'needsStops')
  assert.deepEqual(game, snapshot)
  assert.equal(applyAction({ ...game, funds: 0 }, { type: 'buildStation', point: market }).error, 'funds')
  assert.ok(applyAction({ ...game, funds: -100, mode: 'sandbox' }, { type: 'buildStation', point: market }).game)
  assert.ok(applyAction({ ...game, funds: -100 }, { type: 'renameStation', id: stops[0], name: 'West' }).game)
})

test('Dijkstra compresses consecutive stops into a leg and supports reverse travel', () => {
  const { game, stops, lines } = setup([west, central, east], [[0, 1, 2]])
  const outward = route(game, stops[0], stops[2])
  assert.deepEqual(outward?.legs, [{ board: stops[0], alight: stops[2], lineId: lines[0], direction: 1 }])
  assert.ok(outward.minutes > 5)
  assert.deepEqual(route(game, stops[2], stops[0])?.legs, [{ board: stops[2], alight: stops[0], lineId: lines[0], direction: -1 }])
  assert.equal(route(game, stops[0], stops[0]), undefined)
})

test('shared stations require an interchange and geometric crossings cannot transfer passengers', () => {
  const { game, stops, lines } = setup([west, central, east], [[0, 1], [1, 2]])
  assert.equal(route(game, stops[0], stops[2]), undefined)
  const interchange = execute(game, { type: 'interchange', id: stops[1] }).game
  const transfer = route(interchange, stops[0], stops[2])
  assert.deepEqual(transfer?.legs.map((leg) => leg.lineId), lines)
  assert.equal(transfer.legs[1].board, stops[1])
  const crossing = setup([{ x: 270, y: 412 }, { x: 720, y: 410 }, { x: 530, y: 233 }, { x: 520, y: 613 }], [[0, 1], [2, 3]])
  assert.equal(route(crossing.game, crossing.stops[0], crossing.stops[3]), undefined)
})

test('dispatch wait and crowding change the route comparison', () => {
  const fixture = setup([west, central, market, { x: 706, y: 743 }], [[0, 1, 3], [0, 2, 3]])
  const initial = route(fixture.game, fixture.stops[0], fixture.stops[3])
  assert.ok(initial)
  const initialLine = initial.legs[0].lineId
  const alternate = fixture.lines.find((id) => id !== initialLine)!
  let changed = execute(fixture.game, { type: 'headway', id: initialLine, headway: 16 }).game
  changed = execute(changed, { type: 'headway', id: alternate, headway: 3 }).game
  for (let i = 0; i < 3; i++) changed = execute(changed, { type: 'buyTrain', id: alternate }).game
  assert.equal(route(changed, fixture.stops[0], fixture.stops[3])?.legs[0].lineId, alternate)
})

test('weekday peaks and weekend trips come from deterministic district activity', () => {
  const peak = newGame('career')
  const quiet = { ...newGame('career'), minute: 140 }
  const weekend = { ...newGame('career'), minute: 5 * 1440 + 480 }
  const access = getDistrictAccess(city, [])
  for (const game of [peak, quiet, weekend]) {
    generateDemand(city, game, access)
    assert.equal(game.today.demand, game.today.unmet)
    assert.equal(game.today.fares, 0)
    assert.ok(game.districtDemand.westend >= 0)
  }
  assert.ok(peak.today.demand > weekend.today.demand)
  assert.ok(weekend.today.demand > quiet.today.demand)
  const reproduce = newGame('career')
  generateDemand(city, reproduce, access)
  assert.deepEqual(reproduce.districtDemand, peak.districtDemand)
})

test('trains respect capacity, update map position, board, unload and charge fares after egress', () => {
  const { game, lines, stops } = setup([west, central], [[0, 1]])
  game.growth = {}
  const [a, b] = stops
  assert.equal(admitGroup(game, a, {
    count: 105, started: game.minute, readyAt: game.minute, egress: 5,
    legs: [{ board: a, alight: b, lineId: lines[0], direction: 1 }],
  }), 105)
  const running = advanceGame(game, 1)
  assert.equal(trainLoad(running.trains[0]), running.trains[0].capacity)
  assert.equal(waitingAt(running, a), 9)
  assert.equal(running.stationActivity[a].boarded, 96)
  const position = trainPosition(running.trains[0], running.lines[0], new Map(running.stations.map((station) => [station.id, station])))
  assert.ok(position && distance(position, west) > 0)
  const unloaded = advanceGame(running, 7)
  assert.ok(unloaded.stationActivity[b].alighted >= 96)
  assert.equal(unloaded.today.fares, 0)
  const arrived = advanceGame(unloaded, 7)
  assert.equal(arrived.today.arrived, 96)
  assert.equal(arrived.today.fares, FARE * 96)
  assert.ok(arrived.today.travelMinutes > 0)
  assert.equal(game.today.arrived, 0)
})

test('an actual passenger group changes trains before it reaches its destination', () => {
  let { game } = setup([west, central, east], [[0, 1], [1, 2]])
  const [a, b, c] = game.stations.map((station) => station.id)
  game = execute(game, { type: 'interchange', id: b }).game
  game.growth = {}
  const journey = route(game, a, c)!
  admitGroup(game, a, { count: 27, started: game.minute, readyAt: game.minute, ...journey })
  const completed = advanceGame(game, 70)
  assert.equal(completed.today.transfers, 27)
  assert.equal(completed.stationActivity[b].boarded, 27)
  assert.equal(completed.stationActivity[c].alighted, 27)
  assert.equal(completed.today.arrived, 27)
  assert.equal(completed.today.fares, 27 * FARE)
})

test('linear trains reverse and loop trains visit their start again in a single direction', () => {
  const linear = setup([west, central], [[0, 1]])
  assert.equal(advanceGame(linear.game, 10).trains[0].direction, -1)
  const loop = setup([west, central, market], [[0, 1, 2]], 1, true)
  const locations = new Set()
  let current = loop.game
  for (let step = 0; step < 120; step++) {
    current = advanceGame(current, 0.25)
    assert.equal(current.trains[0].direction, 1)
    locations.add(current.trains[0].at)
  }
  assert.deepEqual(locations, new Set([0, 1, 2]))
  assert.ok(current.lines[0].releaseAt > loop.game.lines[0].releaseAt + 5)
})

test('economy accounts for purchases, upkeep and grants, and spare trains can reduce margins', () => {
  const small = setup([west, central], [[0, 1]])
  assert.equal(INITIAL_BUDGET - small.game.funds, small.game.today.construction)
  const empty = advanceGame(newGame('career'), 180)
  assert.equal(empty.funds, INITIAL_BUDGET)
  assert.equal(empty.today.fares, 0)
  const regular = advanceGame(small.game, 200)
  assert.ok(regular.lifetime.arrived > 50 && regular.lifetime.rewards > 0)
  assert.ok(regular.funds > 0 && regular.funds < INITIAL_BUDGET)
  let surplus = small.game
  for (let i = 0; i < 15; i++) surplus = execute(surplus, { type: 'buyTrain', id: small.lines[0] }).game
  const oversupplied = advanceGame(surplus, 200)
  assert.equal(small.game.funds - surplus.funds, 15 * TRAIN_PRICE)
  assert.ok(oversupplied.lifetime.expenses > regular.lifetime.expenses)
  assert.ok(netOperating(oversupplied.lifetime) < netOperating(regular.lifetime))
})

test('line changes and station removal leave no dangling train, track or passenger references', () => {
  const { game, stops, lines } = setup([west, central, market], [[0, 1]])
  const [a, b, c] = stops
  const first = execute(game, { type: 'saveLine', id: lines[0],
    design: { name: 'Civic Express', color: '#ba4433', stops: [a, c, b], circular: true,
      controls: { [b + '|' + a]: [{ x: 540, y: 455 }] } } }).game
  assert.deepEqual(first.lines[0].stops, [a, c, b])
  assert.equal(first.lines[0].circular, true)
  assert.equal(first.trains[0].at, 0)
  const second = execute(first, { type: 'removeStation', id: a }).game
  assert.equal(second.lines[0].circular, false)
  assert.deepEqual(second.lines[0].stops, [c, b])
  const final = execute(second, { type: 'removeStation', id: b }).game
  assert.equal(final.lines.length, 0)
  assert.equal(final.trains.length, 0)
  assert.ok(final.today.salvage > 0)
})

test('time advances in quarter-minute steps and midnight develops new districts', () => {
  let game = newGame('career')
  assert.equal(advanceGame(game, 0), game)
  assert.equal(advanceGame(game, 0.5).minute, game.minute + 0.5)
  game = { ...game, minute: 4 * 1440 - 0.25, today: { ...blankTotals(), fares: 24 } }
  const next = advanceGame(game, 0.25)
  assert.equal(dayNumber(next.minute), 5)
  assert.ok(next.growth.quarry > 0)
  assert.equal(next.growth.meadow, 0)
  assert.equal(next.today.fares, 0)
  assert.equal(next.history.length, 1)
  assert.equal(game.growth.quarry, 0)
})

test('passenger conservation holds across several days, including abandoned and transferring riders', () => {
  const game = advanceGame(exampleGame(), 3 * 1440)
  const inStations = Object.values(game.queues).flat().reduce((sum, group) => sum + group.count, 0)
  const inTrains = game.trains.reduce((sum, train) => sum + trainLoad(train), 0)
  const leaving = game.egress.reduce((sum, group) => sum + group.count, 0)
  assert.equal(game.lifetime.demand, game.lifetime.arrived + game.lifetime.unmet + inStations + inTrains + leaving)
  assert.ok(game.lifetime.transfers > 0)
  assert.equal(game.history.length, 48)
  assert.ok(Number.isFinite(game.funds))
})
