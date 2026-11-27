import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAction } from '../src/engine/actions.ts'
import type { Action } from '../src/engine/actions.ts'
import { legacyRestricted, legacyTrack, sectionKey } from '../src/engine/alignment.ts'
import { lineDetails } from '../src/engine/analytics.ts'
import { activityOf, getCity } from '../src/engine/city.ts'
import { cityscape, placeName } from '../src/engine/cityscape.ts'
import { distance } from '../src/engine/geometry.ts'
import { admitGroup, departureRates } from '../src/engine/passengers.ts'
import { quoteInsertion, quoteLine, selectableInsertions } from '../src/engine/planning.ts'
import { loadGame, SAVE_KEY } from '../src/engine/save.ts'
import { advanceGame, newGame } from '../src/engine/simulation.ts'
import { biarc, curveSpeedKmh, kmhToUnitsPerMinute, minimumRadius, motionAt, nearestOnTrack, pieceTangent,
  pointOnTrack, radiusStatus, tangentsAgree, trackLength, trackProfile, trackStraight, unitsPerMinuteToKmh } from '../src/engine/track.ts'
import { trainPosition } from '../src/engine/trains.ts'
import type { GameState, LineDesign, TrackSection } from '../src/engine/types.ts'
import { projectRoof } from '../src/ui/cityRendering.ts'

const color = '#2864d4'
const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, a + ' versus ' + b)

function act(game: GameState, action: Action) {
  const result = applyAction(game, action)
  assert.ok(result.game, 'Expected successful action, received ' + result.error)
  return { game: result.game, id: result.id!, cost: result.cost }
}

function sectionWithRadius(radius: number): TrackSection {
  const from = { x: radius, y: 0 }
  const to = { x: 0, y: radius }
  const pieces = biarc(from, to, { x: 0, y: 1 }, { x: -1, y: 0 })
  assert.ok(pieces)
  return { from: 'a', to: 'b', controls: [], pieces }
}

function twoStops(withControl = false) {
  return act(newGame('career'), {
    type: 'saveLine', design: {
      name: 'City Link', color, circular: false, stops: ['draft-a', 'draft-b'],
      proposed: { 'draft-a': { x: 295, y: 416 }, 'draft-b': { x: 747, y: 505 } },
      controls: withControl ? { 'draft-a|draft-b': [{ x: 520, y: 540 }] } : {},
    },
  })
}

test('biarcs measure exact 249 m and 250 m radii with continuous tangent and the same physical length as the SVG arc', () => {
  const tight = sectionWithRadius(24.9)
  const approved = sectionWithRadius(25)
  close(minimumRadius(tight.pieces)!, 249)
  close(minimumRadius(approved.pieces)!, 250)
  close(trackLength(approved.pieces), Math.PI * 25 / 2)
  assert.equal(radiusStatus(minimumRadius(tight.pieces)), 'invalid')
  assert.equal(radiusStatus(minimumRadius(approved.pieces)), 'restricted')
  assert.equal(radiusStatus(400), 'caution')
  assert.equal(radiusStatus(600), 'good')
  assert.equal(minimumRadius([trackStraight({ x: 0, y: 0 }, { x: 10, y: 2 })]), null)
  assert.ok(tangentsAgree(pieceTangent(approved.pieces[0], true), pieceTangent(approved.pieces[1])))
})

test('the construction transaction applies the 250 m boundary and leaves rejected drafts untouched', () => {
  const game = newGame('career')
  const a = { x: 280, y: 250 }
  const b = { x: 360, y: 250 }
  const designAt = (height: number): LineDesign => ({
    name: '', color, circular: false, stops: ['a', 'b'], proposed: { a, b },
    controls: { 'a|b': [{ x: 320, y: 250 + height }] },
  })
  const aroundRadius = (target: number) => {
    let low = 30
    let high = 44
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2
      if (quoteLine(game, designAt(middle)).radius! > target) low = middle
      else high = middle
    }
    return designAt((low + high) / 2)
  }
  const invalid = aroundRadius(249)
  const valid = aroundRadius(250)
  close(quoteLine(game, invalid).radius!, 249)
  close(quoteLine(game, valid).radius!, 250)
  const snapshot = structuredClone(game)
  assert.equal(applyAction(game, { type: 'saveLine', design: invalid }).error, 'curve')
  assert.deepEqual(game, snapshot)
  const result = act(game, { type: 'saveLine', design: valid })
  assert.equal(result.game.stations.length, 2)
  assert.equal(result.game.lines[0].track[0].controls.length, 1)
  assert.ok(result.cost > 0)
  assert.equal(result.game.funds, game.funds - result.cost)
})

test('the shared speed profile slows rolling stock on bends and keeps the train on the exact planimetric arc', () => {
  const section = sectionWithRadius(25)
  const length = trackLength(section.pieces)
  const speed = kmhToUnitsPerMinute(72)
  const reference = { ...section, pieces: [trackStraight({ x: 0, y: 0 }, { x: length, y: 0 })] }
  const restricted = trackProfile(section, speed, 1)
  const straight = trackProfile(reference, speed, 1)
  assert.ok(restricted.duration > straight.duration)
  assert.ok(curveSpeedKmh(250) < curveSpeedKmh(400))
  close(motionAt(restricted, 0).velocity, 0)
  close(motionAt(restricted, restricted.duration).velocity, 0)
  const midpoint = motionAt(restricted, restricted.duration / 2)
  const position = pointOnTrack(section.pieces, midpoint.offset)!
  close(Math.hypot(position.x, position.y), 25)
  assert.ok(unitsPerMinuteToKmh(midpoint.velocity) <= curveSpeedKmh(250) + 1e-6)
})

test('a line extension reuses confirmed alignments, train IDs, passenger loads and route directions', () => {
  const initial = twoStops(true).game
  const original = initial.lines[0]
  const [a, b] = original.stops
  let state = act(initial, { type: 'buyTrain', id: original.id }).game
  admitGroup(state, a, { count: 22, started: state.minute, readyAt: state.minute, egress: 4,
    legs: [{ lineId: original.id, board: a, alight: b, direction: 1 }] })
  state = advanceGame(state, 2)
  const trainBefore = state.trains[0]
  assert.equal(trainBefore.phase, 'travel')
  assert.ok(trainBefore.loads.length > 0)
  const extended = act(state, { type: 'saveLine', id: original.id, design: {
    ...original, stops: [a, b, 'draft-c'], proposed: { 'draft-c': { x: 1061, y: 536 } },
  } }).game
  assert.deepEqual(extended.lines[0].track[0], original.track[0])
  assert.deepEqual(extended.trains[0], trainBefore)
  assert.equal(extended.lines[0].id, original.id)
  assert.equal(extended.lines[0].stops.length, 3)
  assert.ok(lineDetails(extended, extended.lines[0]).cycle > lineDetails(state, state.lines[0]).cycle)
})

test('joining an intermediate station builds a paid interchange without changing the original service', () => {
  const initial = twoStops().game
  const [a, b] = initial.lines[0].stops
  const platform = selectableInsertions(initial, { x: 520, y: 460 }, 8)[0]
  const inserted = act(initial, { type: 'insertStation', point: platform.point, lineIds: [initial.lines[0].id] })
  const state = act(inserted.game, { type: 'saveLine', design: {
    name: 'Park Branch', color: '#07865e', circular: false, autoInterchanges: true,
    stops: [inserted.id, 'park-draft'], proposed: { 'park-draft': { x: 301, y: 658 } },
  } }).game
  assert.deepEqual(state.lines[0].stops, [a, inserted.id, b])
  assert.equal(state.lines[1].stops[0], inserted.id)
  assert.equal(state.stations.find((station) => station.id === inserted.id)?.interchange, true)
})

test('inserting a station into an occupied curved track preserves train positions and onboard passenger groups in both directions', () => {
  const initial = twoStops(true).game
  const line = initial.lines[0]
  let game = act(initial, { type: 'buyTrain', id: line.id }).game
  game = act(game, { type: 'buyTrain', id: line.id }).game
  const section = line.track[0]
  const length = trackLength(section.pieces)
  const point = pointOnTrack(section.pieces, length * 0.54)!
  for (const [index, train] of game.trains.entries()) {
    train.at = index
    train.direction = index === 0 ? 1 : -1
    train.phase = 'travel'
    train.duration = trackProfile(section, train.speed, train.direction).duration
    train.remaining = train.duration * 0.35
    train.loads = [{ count: 31, started: game.minute, readyAt: game.minute, egress: 4, legs: [{
      lineId: line.id, board: line.stops[index], alight: line.stops[1 - index], direction: train.direction,
    }] }]
  }
  const positioning = (state: GameState) => state.trains.map((train) => trainPosition(train, state.lines[0],
    new Map(state.stations.map((station) => [station.id, station])))!)
  const before = positioning(game)
  const quote = quoteInsertion(game, point, [line.id])
  assert.ok(quote.station && !quote.error)
  const inserted = act(game, { type: 'insertStation', point, lineIds: [line.id] })
  assert.equal(inserted.cost, quote.station.builtCost)
  close(inserted.game.lines[0].track.reduce((sum, part) => sum + trackLength(part.pieces), 0), length)
  const after = positioning(inserted.game)
  before.forEach((position, index) => close(distance(position, after[index]), 0, 1e-4))
  assert.deepEqual(inserted.game.trains.map(({ id, loads }) => ({ id, loads })), game.trains.map(({ id, loads }) => ({ id, loads })))
  assert.ok(lineDetails(inserted.game, inserted.game.lines[0]).cycle > lineDetails(game, line).cycle)
})

test('overlapping tracks can share one inserted station or leave the other line unchanged', () => {
  const initial = twoStops().game
  const [first] = initial.lines
  const game = act(initial, { type: 'saveLine', design: { ...first, name: 'Parallel Local', color: '#07865e' } }).game
  const point = pointOnTrack(first.track[0].pieces, trackLength(first.track[0].pieces) / 2)!
  const hits = selectableInsertions(game, point, 1)
  assert.equal(hits.length, 2)
  const one = act(game, { type: 'insertStation', point, lineIds: [first.id] }).game
  assert.deepEqual(one.lines[1], game.lines[1])
  const both = act(game, { type: 'insertStation', point, lineIds: game.lines.map((line) => line.id) })
  assert.equal(both.game.stations.length, 3)
  assert.equal(both.game.stations.at(-1)!.interchange, true)
  assert.ok(both.game.lines.every((line) => line.stops[1] === both.id))
})

test('version-two saves preserve sharp original track, train state and choose new limits when rebuilding it', () => {
  const initial = twoStops().game
  const game = act(initial, { type: 'buyTrain', id: initial.lines[0].id }).game
  const line = game.lines[0]
  const original = legacyTrack(game.stations, line)
  const train = game.trains[0]
  train.phase = 'travel'
  train.duration = trackLength(original[0].pieces) / train.speed
  train.remaining = train.duration / 2
  const oldLines = [{ ...line, track: undefined }]
  const raw = JSON.stringify({ savedAt: '2026-11-24T09:00:00Z', game: { ...game, version: 2, lines: oldLines } })
  const slot = loadGame({ getItem: (key) => key === SAVE_KEY ? raw : null, setItem() {}, removeItem() {} })
  assert.ok(slot)
  assert.deepEqual(slot.game.lines[0].track, original)
  assert.deepEqual(slot.game.trains[0], train)
  assert.equal(legacyRestricted(slot.game.lines[0]), true)
  assert.equal(advanceGame(slot.game, 0.5).trains[0].phase, 'travel')
  const renamed = act(slot.game, { type: 'saveLine', id: line.id, design: { ...line, name: 'Kept Legacy' } })
  assert.deepEqual(renamed.game.lines[0].track, original)
  const rebuilt = act(slot.game, { type: 'saveLine', id: line.id, design: { ...line,
    controls: { [sectionKey(line.stops[0], line.stops[1])]: [] },
  } })
  assert.equal(legacyRestricted(rebuilt.game.lines[0]), false)
})

test('the city model generates mixed uses, predicts school trips, names stations by place and leaves track coordinates unchanged in 2.5D', () => {
  const game = newGame('career')
  const city = getCity(game.cityId)
  const place = cityscape(city)
  assert.ok(place.buildings.length > 1000)
  const downtown = city.districts.find((area) => area.id === 'central')!
  const university = city.districts.find((area) => area.id === 'university')!
  const oldTown = city.districts.find((area) => area.id === 'oldTown')!
  const centralActivity = activityOf(downtown, game)
  assert.ok('use' in centralActivity)
  assert.ok(centralActivity.use.office > 0 && centralActivity.use.residential > 0 && centralActivity.use.retail > 0)
  assert.ok(centralActivity.jobs > activityOf(oldTown, game).jobs)
  assert.ok(activityOf(university, game).students > 5000)
  assert.ok(departureRates({ ...game, minute: 16 * 60 }, university).schoolReturn > 0)
  assert.equal(departureRates({ ...game, minute: 5 * 1440 + 16 * 60 }, university).schoolReturn, 0)
  const hospital = place.landmarks.find((entry) => entry.id === 'southbankHospital')!
  assert.equal(placeName(city, hospital.point, city.districts.find((area) => area.id === 'southbank')!, game.growth).key,
    'landmark.southbankHospital')
  const section = twoStops(true).game.lines[0].track[0]
  const length = trackLength(section.pieces)
  const boundary = pointOnTrack(section.pieces, length / 2)!
  const raised = projectRoof(boundary, 100)
  assert.ok(distance(boundary, raised) > 0)
  close(trackLength(section.pieces), length)
  close(nearestOnTrack(section.pieces, boundary)!.distance, 0)
})
