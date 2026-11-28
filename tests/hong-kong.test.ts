import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAction } from '../src/engine/actions.ts'
import type { Action } from '../src/engine/actions.ts'
import { allTrack } from '../src/engine/alignment.ts'
import { lineDetails, networkReach } from '../src/engine/analytics.ts'
import { getCity } from '../src/engine/city.ts'
import { applyOperatingMinute, HKD, measurePieces } from '../src/engine/economy.ts'
import { elevationAt, existingMtrStationAt, HONG_KONG, hongKong, hongKongName, officialMtrStationAt, surfaceAt, surveyPoint, walkCells } from '../src/engine/hongKong.ts'
import { activityPopulation, demandDirections, demandPeriod, demandSurface, TCS_WEEKDAY } from '../src/engine/hongKongDemand.ts'
import { coveredCells, stationPreview } from '../src/engine/network.ts'
import { quoteInsertion, quoteLine, roundPoint } from '../src/engine/planning.ts'
import { railReuseOptions } from '../src/engine/rails.ts'
import { makeRoutingNetwork, routesFrom } from '../src/engine/routing.ts'
import { loadGame, saveGame } from '../src/engine/save.ts'
import { advanceGame, newGame, SAVE_VERSION } from '../src/engine/simulation.ts'
import { pointOnTrack, radiusStatus, trackCurves, trackLength, trackStraight, unitsToMeters } from '../src/engine/track.ts'
import type { GameState, LineDesign, Point, TrackMethod } from '../src/engine/types.ts'
import { curveRadiusText } from '../src/ui/format.ts'

const city = getCity(HONG_KONG)
const fresh = () => newGame('career', HONG_KONG)
const central = { x: 635.2, y: 911.6 }
const tsimShaTsui = { x: 798.4, y: 722.9 }
const kennedyTown = { x: 303.5, y: 907.4 }
const kowloonCity = { x: 961.4, y: 376.5 }
const wongTaiSin = { x: 1003.9, y: 247.8 }
const hku = { x: 400.5, y: 887.8 }
const shekTongTsui = { x: 407.3, y: 870.4 }
const peakGarden = { x: 490.6, y: 1001 }
const admiralty = { x: 705.5, y: 942.3 }
const wanChai = { x: 785.4, y: 958.6 }

function act(game: GameState, action: Action) {
  const result = applyAction(game, action)
  assert.equal(result.error, undefined, 'Action ' + action.type)
  assert.ok(result.game)
  return result.game
}

function plan(a: Point, b: Point, method: TrackMethod = 'underground'): LineDesign {
  return { stops: ['a', 'b'], name: '', color: '#287ab8', circular: false, proposed: { a, b }, method }
}

function railway(a: Point, b: Point, trains = 2) {
  let game = act(fresh(), { type: 'saveLine', design: plan(a, b) })
  for (let i = 0; i < trains; i++) game = act(game, { type: 'buyTrain', id: game.lines[0].id })
  return game
}

test('Hong Kong uses a metre grid, real terrain and shore, and audited footprint heights', () => {
  assert.deepEqual(surveyPoint(834352, 815884), central)
  assert.equal(unitsToMeters(trackLength([trackStraight(central, { x: central.x + 100, y: central.y })])), 1000)
  assert.equal(surfaceAt(central), 'land')
  assert.equal(surfaceAt({ x: 735, y: 819 }), 'water')
  assert.equal(surfaceAt({ x: -1, y: 0 }), 'outside')
  assert.ok(elevationAt({ x: 490, y: 1120 }) > 210)
  assert.equal(hongKong.map.buildingHeights.surveyed, 45_280)
  assert.ok(hongKong.map.tiles.length > 20)
})

test('the real HKU station and campus entrance have separate bilingual names from Shek Tong Tsui Market', () => {
  const hkuName = { en: 'HKU', zh: '香港大學' }
  const shekTongTsuiName = { en: 'Shek Tong Tsui', zh: '石塘咀' }
  assert.deepEqual(hongKongName(hku, []), hkuName)
  assert.deepEqual(hongKongName({ x: 413.2, y: 895.6 }, []), hkuName)
  assert.deepEqual(hongKongName({ x: 400, y: 907 }, []), hkuName)
  assert.deepEqual(hongKongName(shekTongTsui, []), shekTongTsuiName)
  const game = act(fresh(), { type: 'saveLine', design: plan(hku, shekTongTsui) })
  assert.deepEqual(game.stations.map((station) => station.names), [hkuName, shekTongTsuiName])
  assert.equal(hongKongName({ x: 413.2, y: 895.6 }, [game.stations[0]]).en, 'HKU South East')
  assert.deepEqual(hongKongName(shekTongTsui, [game.stations[0]]), shekTongTsuiName)
})

test('official naming regions are nearest-match suggestions, and only a manual rename changes a saved name', () => {
  assert.equal(officialMtrStationAt(central)?.code, 'CEN')
  assert.equal(officialMtrStationAt(admiralty)?.code, 'ADM')
  assert.equal(officialMtrStationAt(shekTongTsui), undefined)
  let game = act(fresh(), { type: 'buildStation', point: central })
  const id = game.stations[0].id
  assert.deepEqual(game.stations[0].names, { en: 'Central', zh: '中環' })
  assert.equal(existingMtrStationAt(central, game.stations)?.id, id)
  game = act(game, { type: 'moveStation', id, point: admiralty })
  assert.deepEqual(game.stations[0].names, { en: 'Central', zh: '中環' })
  game = act(game, { type: 'renameStation', id, name: 'Harbour Hall', chinese: '海港大堂' })
  assert.deepEqual(game.stations[0].names, { en: 'Harbour Hall', zh: '海港大堂' })
  assert.equal(existingMtrStationAt(central, game.stations), undefined)
})

test('actual arc radii use a strict 400 m restriction, with enough precision below the boundary', () => {
  for (const radius of [399, 400, 450]) {
    const r = radius / 10
    const curves = trackCurves([{ kind: 'arc', from: { x: r, y: 0 }, to: { x: 0, y: r }, center: { x: 0, y: 0 }, radius: r, sweep: Math.PI / 2 }])
    assert.equal(curves.length, 1)
    assert.equal(curves[0].radius, radius)
    assert.equal(radiusStatus(curves[0].radius, true) === 'restricted', radius === 399)
  }
  assert.equal(curveRadiusText(399.995, 400, 'en'), '399.995')
  assert.equal(curveRadiusText(400, 400, 'en'), '400')
  assert.equal(radiusStatus(225, true), 'restricted')
  assert.equal(radiusStatus(0, true), 'invalid')
})

test('independent track, shared track and express stopping patterns keep separate services and one physical asset per reused segment', () => {
  const seed = newGame('sandbox', HONG_KONG)
  const original = act(seed, { type: 'saveLine', design: { ...plan(central, admiralty), stops: ['a', 'b', 'c'],
    proposed: { a: central, b: admiralty, c: wanChai } } })
  const source = original.lines[0]
  const [a, b, c] = source.stops
  const service = { stops: [a, b], name: 'Connector', color: '#07865e', circular: false }
  let game = act(original, { type: 'saveLine', design: service })
  const line = game.lines[1].id
  assert.notEqual(game.lines[1].track[0].rails![0].id, source.track[0].rails![0].id)
  assert.equal(Object.keys(game.infrastructure!).length, 3)
  assert.ok(game.stations.filter((station) => [a, b].includes(station.id)).every((station) => station.interchange))
  const path = railReuseOptions(game, a, b, line)[0].path
  const reuse = { ...service, reuse: { [a + '|' + b]: path } }
  const quote = quoteLine(game, reuse, game.lines[1])
  assert.equal(quote.cost, 0)
  assert.ok(quote.reusedLength > 0 && quote.operatingHourly > 0)
  const balance = game.funds
  game = act(game, { type: 'saveLine', id: line, design: reuse })
  assert.equal(game.funds, balance)
  assert.equal(Object.keys(game.infrastructure!).length, 2)
  const before = structuredClone(original), after = structuredClone(game)
  applyOperatingMinute(before, 0, 0)
  applyOperatingMinute(after, 0, 0)
  assert.equal(before.today.expenses, after.today.expenses)

  const through = railReuseOptions(game, c, a)[0].path
  const express = { ...service, name: 'Express', stops: [c, a], reuse: { [c + '|' + a]: through } }
  assert.equal(quoteLine(game, express).cost, 0)
  game = act(game, { type: 'saveLine', design: express })
  const expressId = game.lines[2].id
  assert.deepEqual(game.lines[2].stops, [c, a])
  assert.equal(game.lines[2].track[0].rails!.length, 2)
  assert.ok(game.lines[2].track[0].rails!.every((rail) => rail.direction === -1))

  const moved = { x: 622, y: 926 }
  const rename = { en: 'Central Commons', zh: '中環匯' }
  game = act(game, { type: 'saveLine', id: line, design: { ...game.lines[1], stationMoves: { [a]: moved }, stationNames: { [a]: rename } } })
  assert.deepEqual(game.stations.find((station) => station.id === a)?.names, rename)
  assert.deepEqual(game.lines[0].track[0].pieces[0].from, moved)
  assert.deepEqual(game.lines[1].track[0].pieces[0].from, moved)
  assert.deepEqual(game.lines[2].track[0].pieces.at(-1)?.to, moved)
  game = act(game, { type: 'saveLine', id: source.id, design: { ...game.lines[0], stops: [a, c] } })
  assert.ok(game.stations.some((station) => station.id === b))
  assert.deepEqual(game.lines[1].stops, [a, b])
  game = act(game, { type: 'removeLine', id: source.id })
  assert.equal(Object.keys(game.infrastructure!).length, 2)
  assert.ok(game.lines.some((entry) => entry.id === expressId))

  const storage = new Map<string, string>()
  const io = { setItem: (key: string, value: string) => { storage.set(key, value) }, getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => { storage.delete(key) } }
  saveGame(io, game)
  const saved = loadGame(io)?.game
  assert.deepEqual(saved, game)
})

test('building and moving stations reject sea, inland water and designated parks without changing the game', () => {
  const game = act(fresh(), { type: 'buildStation', point: central })
  const before = structuredClone(game)
  const excluded = [
    [{ x: 735, y: 819 }, 'water'],                          // Victoria Harbour
    [{ x: 1020.2, y: 1193.1 }, 'water'],                    // Wong Nai Chung Reservoir
    [peakGarden, 'restrictedStationSite'],                  // Victoria Peak Garden
    [{ x: 397.1, y: 933.7 }, 'restrictedStationSite'],      // Lung Fu Shan
    [{ x: 750.8, y: 1447.6 }, 'restrictedStationSite'],     // Ocean Park
  ] as const
  for (const [point, error] of excluded) {
    assert.equal(stationPreview(city, game, point).error, error)
    assert.deepEqual(applyAction(game, { type: 'buildStation', point }), { error })
    assert.deepEqual(applyAction(game, { type: 'moveStation', id: game.stations[0].id, point }), { error })
    assert.deepEqual(applyAction(game, { type: 'saveLine', design: plan(kennedyTown, point) }), { error })
  }
  assert.deepEqual(game, before)
})

test('a shoreline click stays invalid when its rounded station position would fall on land', () => {
  const point = { x: 350, y: 857.365 }
  const game = act(fresh(), { type: 'buildStation', point: central })
  assert.equal(stationPreview(city, game, point).error, 'water')
  assert.equal(stationPreview(city, game, roundPoint(point)).error, undefined)
  assert.deepEqual(applyAction(game, { type: 'buildStation', point }), { error: 'water' })
  assert.deepEqual(applyAction(game, { type: 'moveStation', id: game.stations[0].id, point }), { error: 'water' })
  assert.deepEqual(applyAction(game, { type: 'saveLine', design: plan(kennedyTown, point) }), { error: 'water' })
})

test('an underground alignment may cross western Victoria Harbour with both ends on land', () => {
  const game = fresh()
  const west = { x: 325, y: 898 }, bend = { x: 415, y: 754 }, offshore = { x: 575, y: 789 }, kowloon = { x: 799, y: 720 }
  const design = { stops: [], name: '', color: '#2864d4', circular: false }
  for (const head of [[west, bend, offshore], [offshore, bend, west], [west, { x: 1020.2, y: 1193.1 }]]) {
    const unfinished = { ...design, alignmentEnds: { head } }
    assert.equal(quoteLine(game, unfinished).error, 'waterAlignmentEnd')
    assert.deepEqual(applyAction(game, { type: 'saveLine', design: unfinished }), { error: 'waterAlignmentEnd' })
  }
  const approach = { ...design, stops: ['west'], proposed: { west }, alignmentEnds: { tail: [bend, offshore] } }
  assert.deepEqual(applyAction(game, { type: 'saveLine', design: approach }), { error: 'waterAlignmentEnd' })

  const crossing = { ...design, alignmentEnds: { head: [west, bend, kowloon] } }
  assert.ok(quoteLine(game, crossing).infrastructure.water > 0)
  const built = act(game, { type: 'saveLine', design: crossing })
  assert.equal(built.stations.length, 0)
  const pieces = built.lines[0].openEnds!.head!.pieces
  const point = pointOnTrack(pieces, trackLength(pieces) * 0.5)!
  assert.equal(surfaceAt(point), 'water')
  assert.deepEqual(applyAction(built, { type: 'insertStation', point, lineIds: [built.lines[0].id] }), { error: 'water' })
})

test('underground track can pass under a park while station insertion on that segment is blocked', () => {
  const game = act(fresh(), { type: 'saveLine', design: plan({ x: 465, y: peakGarden.y }, { x: 525, y: peakGarden.y }) })
  const lineIds = [game.lines[0].id]
  assert.deepEqual(quoteInsertion(game, peakGarden, lineIds), { error: 'restrictedStationSite' })
  assert.deepEqual(applyAction(game, { type: 'insertStation', point: peakGarden, lineIds }), { error: 'restrictedStationSite' })
  assert.ok(quoteInsertion(game, { x: 516, y: peakGarden.y }, lineIds).station)
})

test('every population group and employment district conserves its official control total', () => {
  assert.equal(hongKong.zones.length, 105)
  for (const [index, zone] of hongKong.zones.entries()) {
    const cells = hongKong.cells.filter((cell) => cell.zone === index)
    assert.equal(cells.reduce((total, cell) => total + cell.residents, 0), zone.residents, zone.id)
    assert.equal(cells.reduce((total, cell) => total + cell.jobs, 0), zone.jobs, zone.id)
  }
  for (const [index, [name, , control]] of hongKong.map.councils.entries()) {
    assert.equal(hongKong.cells.filter((cell) => cell.council === index).reduce((total, cell) => total + cell.jobs, 0), control, name)
  }
  assert.equal(hongKong.cells.reduce((total, cell) => total + cell.residents, 0), 3_346_352)
  assert.equal(hongKong.cells.reduce((total, cell) => total + cell.jobs, 0), 2_446_550)
})

test('the Hong Kong naming index applies authentic bilingual names and distinguishes close stations', () => {
  let game = fresh()
  for (const [point, en, zh] of [[central, 'Central', '中環'], [kennedyTown, 'Kennedy Town', '堅尼地城'],
    [tsimShaTsui, 'Tsim Sha Tsui', '尖沙咀']] as const) {
    game = act(game, { type: 'buildStation', point })
    assert.deepEqual(game.stations.at(-1)!.names, { en, zh })
  }
  const duplicate = hongKongName({ x: central.x + 5, y: central.y + 5 }, game.stations)
  assert.notEqual(duplicate.en, 'Central')
  assert.doesNotMatch(duplicate.en, /\d/)
  const id = game.stations[0].id
  game = act(game, { type: 'renameStation', id, name: 'Harbour Exchange', chinese: '海港交匯處' })
  game = act(game, { type: 'moveStation', id, point: { x: central.x + 2, y: central.y + 3 } })
  assert.deepEqual(game.stations[0].names, { en: 'Harbour Exchange', zh: '海港交匯處' })
})

test('survey alignments can be built empty, gain stops, lose stops and retain metre geometry', () => {
  let game = fresh()
  const start = { x: 944, y: 407 }, end = { x: 1004, y: 234 }
  const design: LineDesign = { name: 'Survey alignment', color: '#002244', circular: false, stops: [], alignmentEnds: { head: [start, end] } }
  const quote = quoteLine(game, design)
  assert.equal(quote.error, undefined)
  assert.equal(game.funds, HKD.initial)
  game = act(game, { type: 'saveLine', design })
  const id = game.lines[0].id
  const pieces = game.lines[0].openEnds!.head!.pieces
  const length = trackLength(pieces)
  assert.equal(game.funds, HKD.initial - quote.cost)
  assert.equal(game.stations.length, 0)
  assert.equal(applyAction(game, { type: 'buyTrain', id }).error, 'needsStops')
  for (const share of [.18, .81]) game = act(game, { type: 'insertStation', point: pointOnTrack(pieces, length * share)!, lineIds: [id] })
  assert.equal(game.lines[0].stops.length, 2)
  assert.ok(Math.abs(allTrack(game.lines[0]).reduce((sum, section) => sum + trackLength(section.pieces), 0) - length) < .001)
  game = act(game, { type: 'removeStation', id: game.lines[0].stops[0] })
  assert.equal(game.lines[0].stops.length, 1)
  assert.ok(Math.abs(allTrack(game.lines[0]).reduce((sum, section) => sum + trackLength(section.pieces), 0) - length) < .001)
  game = act(game, { type: 'removeSection', id, index: 'head' })
  assert.equal(allTrack(game.lines[0]).length, 1)
})

test('the marine tunnel premium, site charges and construction modes reconcile to the capital ledger', () => {
  const game = fresh()
  const design = plan(central, tsimShaTsui)
  const tunnel = quoteLine(game, design)
  assert.equal(tunnel.error, undefined)
  assert.ok(tunnel.infrastructure.water > 1_000_000_000)
  assert.equal(tunnel.cost, tunnel.infrastructure.track + tunnel.stationsCost + tunnel.interchangeCost)
  assert.equal(tunnel.remaining, game.funds - tunnel.cost)
  for (const mode of ['elevated', 'atGrade'] as const) {
    const result = applyAction(game, { type: 'saveLine', design: { ...design, method: mode } })
    assert.equal(result.error, 'surfaceWater')
    assert.equal(quoteLine(game, { ...design, method: mode }).infrastructure.water, 0)
  }
  assert.equal(applyAction({ ...game, funds: 1 }, { type: 'saveLine', design }).error, 'funds')
  const surface = quoteLine(game, plan(kowloonCity, wongTaiSin, 'atGrade'))
  assert.equal(surface.error, undefined)
  assert.ok(surface.cost < quoteLine(game, plan(kowloonCity, wongTaiSin, 'elevated')).cost)
  assert.ok(measurePieces(city, [trackStraight(central, tsimShaTsui)]).waterLength > 75)
})

test('walkable access cuts at the harbour and overlapping stations conserve the cells and their populations', () => {
  const a = walkCells(central, 1)
  const b = walkCells({ x: central.x + 4, y: central.y + 4 }, 1)
  assert.ok(a.size > 4 && b.size > 4)
  assert.ok([...a.keys()].every((id) => hongKong.cells[id].zone < 45))
  let game = act(fresh(), { type: 'buildStation', point: central })
  game = act(game, { type: 'buildStation', point: { x: central.x + 4, y: central.y + 4 } })
  const unique = coveredCells(game.stations)
  assert.equal(unique.size, new Set([...a.keys(), ...b.keys()]).size)
  assert.ok(unique.size < a.size + b.size)
  assert.equal(stationPreview(city, game, tstWater).error, 'water')
  for (const access of Object.values(networkReach(game).planned)) {
    assert.ok(access.fraction <= 1 && (access.jobs ?? 0) <= 1)
  }
})

const tstWater = { x: 735, y: 819 }

test('gravity demand matches the TD market and peak-hour controls, even without rail', () => {
  const hourly = Array.from({ length: 24 }, (_, h) => demandSurface(h * 60).reduce((sum, count) => sum + count, 0) * 12)
  const total = hourly.reduce((sum, count) => sum + count, 0)
  assert.equal(Math.round(total), TCS_WEEKDAY.reduce((sum, count) => sum + count, 0))
  assert.ok(Math.abs(hourly[8] / total - .13) < .005 && Math.abs(hourly[18] / total - .14) < .005)
  assert.deepEqual([8, 11, 18, 1].map((hour) => demandPeriod(hour * 60)), ['morning', 'offPeak', 'evening', 'night'])
  assert.ok(demandDirections('121S', 8 * 60).destinations.length > 0)
  assert.ok(activityPopulation('121S', 0, 13) > activityPopulation('121S', 0, 23))
  const game = advanceGame(fresh(), 45)
  assert.ok(game.today.demand > 0)
  assert.equal(game.today.demand, game.today.unmet)
  assert.equal(game.today.fares, 0)
  assert.equal(game.today.expenses, 0)
  assert.equal(game.funds, HKD.initial)
})

test('rail demand responds to destinations and service choices with fares charged after arrival', () => {
  const seeded = railway(kennedyTown, central)
  const id = seeded.lines[0].id
  const slow = act(seeded, { type: 'headway', id, headway: 16 })
  const costly = act(seeded, { type: 'fare', id, fare: 48 })
  assert.ok(lineDetails(slow, slow.lines[0]).waiting! > lineDetails(seeded, seeded.lines[0]).waiting!)
  assert.ok(lineDetails(slow, slow.lines[0]).capacity! < lineDetails(seeded, seeded.lines[0]).capacity!)
  const running = advanceGame(seeded, 180)
  const infrequent = advanceGame(slow, 180)
  const expensive = advanceGame(costly, 180)
  const local = advanceGame(railway(kowloonCity, wongTaiSin), 180)
  const paused = advanceGame(act(seeded, { type: 'service', id, running: false }), 180)
  assert.ok(running.today.arrived > local.today.arrived * 2 && running.today.arrived > expensive.today.arrived)
  assert.ok(running.today.expenses > infrequent.today.expenses && infrequent.today.expenses > paused.today.expenses)
  assert.equal(paused.today.arrived, 0)
  assert.equal(paused.today.fares, 0)
  assert.equal(running.today.fares, HKD.fare * running.today.arrived)
  assert.equal(running.hongKong!.lineActivity[id].fares, running.today.fares)
  assert.equal(running.hongKong!.lineActivity[id].expenses, running.today.expenses)
  assert.equal(running.today.subsidy + running.today.rewards, 0)
  assert.equal(running.funds, HKD.initial - running.lifetime.construction + running.lifetime.fares - running.lifetime.expenses)
  assert.equal(Object.values(running.hongKong!.alternatives).reduce((sum, mode) => sum + mode, 0), running.today.unmet)
  const travelling = [...Object.values(running.queues).flat(), ...running.egress, ...running.trains.flatMap((train) => train.loads)]
  assert.equal(running.lifetime.demand, running.lifetime.unmet + running.lifetime.arrived + travelling.reduce((sum, group) => sum + group.count, 0))
})

test('two lines with a paid interchange route riders and save the bilingual and financial state', () => {
  let game = railway(kennedyTown, central, 1)
  const hub = game.stations[1].id
  const first = game.lines[0].id
  game = act(game, { type: 'saveLine', design: { ...plan(central, tsimShaTsui), stops: [hub, 'b'], autoInterchanges: true } })
  const second = game.lines[1].id
  game = act(game, { type: 'buyTrain', id: second })
  const journey = routesFrom(makeRoutingNetwork(game), [{ stationId: game.stations[0].id, minutes: 3 }])([
    { stationId: game.stations[2].id, minutes: 4 },
  ])
  assert.deepEqual(journey?.legs.map((leg) => leg.lineId), [first, second])
  assert.equal(journey?.tickets.reduce((sum, ticket) => sum + ticket.fare, 0), 22)
  game = advanceGame(game, 50)
  const data = new Map<string, string>()
  const storage = { setItem: (key: string, value: string) => data.set(key, value), getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => data.delete(key) }
  const slot = saveGame(storage, game)!
  assert.equal(slot.game.version, SAVE_VERSION)
  assert.deepEqual(loadGame(storage), JSON.parse(JSON.stringify(slot)))
})

test('taking a line back to track without service removes its fleet and preserves the independent stations', () => {
  let game = railway(kowloonCity, wongTaiSin)
  const line = game.lines[0]
  game = act(game, { type: 'saveLine', id: line.id, design: { ...line, stops: [],
    alignmentEnds: { head: [kowloonCity, wongTaiSin] } } })
  assert.equal(game.trains.length, 0)
  assert.equal(game.stations.length, 2)
  assert.equal(game.lifetime.salvage, HKD.resale * 2)
  assert.equal(networkReach(game).served.size, 0)
  game = act(game, { type: 'removeSection', id: line.id, index: 'head' })
  assert.equal(game.lines.length, 0)
})
