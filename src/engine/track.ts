import { clamp, distance, interpolate } from './geometry.ts'
import type { Direction, Point, TrackPiece, TrackSection } from './types.ts'

export const ENGINEERING = Object.freeze({
  metersPerUnit: 10,
  minimumRadius: 250,
  restrictedRadius: 400,
  preferredRadius: 600,
  designSpeedKmh: 72,
  lateralAcceleration: 0.53,
  acceleration: 0.7,
  braking: 0.85,
  radiusTolerance: 0.000001,
})

const epsilon = 1e-7
const tau = 2 * Math.PI
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const plus = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Point, factor: number): Point => ({ x: a.x * factor, y: a.y * factor })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const perpendicular = (a: Point): Point => ({ x: -a.y, y: a.x })
const lengthOf = (a: Point) => Math.hypot(a.x, a.y)
const unit = (a: Point) => scale(a, 1 / Math.max(epsilon, lengthOf(a)))
const angleOf = (a: Point) => Math.atan2(a.y, a.x)
const angleMod = (angle: number) => (angle % tau + tau) % tau

export const unitsToMeters = (value: number) => value * ENGINEERING.metersPerUnit
export const unitsPerMinuteToKmh = (value: number) => unitsToMeters(value) * 0.06
export const kmhToUnitsPerMinute = (value: number) => value / unitsPerMinuteToKmh(1)

export function stationTangent(before: Point | undefined, at: Point, after: Point | undefined) {
  const incoming = before ? unit(sub(at, before)) : undefined
  const outgoing = after ? unit(sub(after, at)) : undefined
  if (!incoming || !outgoing) return incoming ?? outgoing ?? { x: 1, y: 0 }
  return unit(plus(incoming, outgoing))
}

export function trackStraight(from: Point, to: Point): TrackPiece {
  return { kind: 'straight', from, to }
}

function arcFromTangent(from: Point, to: Point, tangent: Point): TrackPiece | undefined {
  const chord = sub(to, from)
  const side = cross(tangent, chord)
  if (Math.abs(side) < epsilon) return dot(tangent, chord) > 0 ? trackStraight(from, to) : undefined
  const signedRadius = dot(chord, chord) / (2 * side)
  const center = plus(from, scale(perpendicular(tangent), signedRadius))
  const start = angleOf(sub(from, center))
  const end = angleOf(sub(to, center))
  const sweep = signedRadius > 0 ? angleMod(end - start) : -angleMod(start - end)
  if (Math.abs(sweep) > Math.PI + epsilon) return undefined
  return { kind: 'arc', from, to, center, radius: Math.abs(signedRadius), sweep }
}

export function reversePiece(piece: TrackPiece): TrackPiece {
  return piece.kind === 'arc'
    ? { ...piece, from: piece.to, to: piece.from, sweep: -piece.sweep }
    : trackStraight(piece.to, piece.from)
}

export function reverseSection(section: TrackSection): TrackSection {
  return {
    ...section, from: section.to, to: section.from,
    controls: section.controls.slice().reverse(),
    pieces: section.pieces.map(reversePiece).reverse(),
  }
}

export function pieceTangent(piece: TrackPiece, atEnd = false) {
  if (piece.kind === 'straight') return unit(sub(piece.to, piece.from))
  return scale(unit(perpendicular(sub(atEnd ? piece.to : piece.from, piece.center))), Math.sign(piece.sweep))
}

export function tangentsAgree(a: Point, b: Point) {
  return dot(a, b) >= 1 - 1e-7
}

export function biarc(from: Point, to: Point, start: Point, end: Point): TrackPiece[] | undefined {
  const chord = sub(to, from)
  const extent = lengthOf(chord)
  const direction = unit(chord)
  if (extent < epsilon || lengthOf(start) < 0.9 || lengthOf(end) < 0.9 ||
      dot(start, direction) < -epsilon || dot(end, direction) < -epsilon) return undefined
  if (tangentsAgree(start, direction) && tangentsAgree(end, direction)) return [trackStraight(from, to)]
  // Equal tangent lengths yield a quadratic for the common tangency point.
  const projections = dot(chord, plus(start, end))
  const difference = Math.max(0, 1 - dot(start, end))
  const divisor = projections + Math.sqrt(projections ** 2 + 2 * difference * extent ** 2)
  const offset = divisor > epsilon ? extent ** 2 / divisor : 0
  const join = plus(interpolate(from, to, 0.5), scale(sub(start, end), offset / 2))
  const first = arcFromTangent(from, join, start)
  const second = arcFromTangent(to, join, scale(end, -1))
  if (!first || !second) return undefined
  const tail = reversePiece(second)
  if (!tangentsAgree(pieceTangent(first, true), pieceTangent(tail))) return undefined
  return [first, tail]
}

export function pieceLength(piece: TrackPiece) {
  return piece.kind === 'arc' ? piece.radius * Math.abs(piece.sweep) : distance(piece.from, piece.to)
}

export const trackLength = (pieces: TrackPiece[]) => pieces.reduce((length, piece) => length + pieceLength(piece), 0)

export function pointOnPiece(piece: TrackPiece, fraction: number) {
  const t = clamp(fraction, 0, 1)
  if (piece.kind === 'straight') {
    return { ...interpolate(piece.from, piece.to, t), angle: angleOf(sub(piece.to, piece.from)) * 180 / Math.PI }
  }
  const angle = angleOf(sub(piece.from, piece.center)) + piece.sweep * t
  const point = t === 0 ? piece.from : t === 1 ? piece.to : {
    x: piece.center.x + piece.radius * Math.cos(angle), y: piece.center.y + piece.radius * Math.sin(angle),
  }
  return { ...point, angle: angle * 180 / Math.PI + Math.sign(piece.sweep) * 90 }
}

export function pointOnTrack(pieces: TrackPiece[], offset: number) {
  let left = Math.max(0, offset)
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]
    const length = pieceLength(piece)
    if (left <= length || index === pieces.length - 1) return pointOnPiece(piece, left / length)
    left -= length
  }
  return undefined
}

export function nearestOnTrack(pieces: TrackPiece[], point: Point) {
  let nearest: { point: Point; offset: number; distance: number } | undefined
  let offset = 0
  for (const piece of pieces) {
    const length = pieceLength(piece)
    let fraction: number
    if (piece.kind === 'straight') {
      const chord = sub(piece.to, piece.from)
      fraction = clamp(dot(sub(point, piece.from), chord) / dot(chord, chord), 0, 1)
    } else {
      const start = angleOf(sub(piece.from, piece.center))
      const target = angleOf(sub(point, piece.center))
      const turn = angleMod((target - start) * Math.sign(piece.sweep))
      fraction = turn <= Math.abs(piece.sweep) ? turn / Math.abs(piece.sweep) :
        distance(point, piece.from) <= distance(point, piece.to) ? 0 : 1
    }
    const { x, y } = pointOnPiece(piece, fraction)
    const gap = distance(point, { x, y })
    if (!nearest || gap < nearest.distance) nearest = { point: { x, y }, offset: offset + length * fraction, distance: gap }
    offset += length
  }
  return nearest
}

export function splitTrack(pieces: TrackPiece[], offset: number) {
  const head: TrackPiece[] = []
  const tail: TrackPiece[] = []
  let remaining = offset
  for (const piece of pieces) {
    const length = pieceLength(piece)
    if (remaining >= length - epsilon) head.push(piece)
    else if (remaining <= epsilon) tail.push(piece)
    else {
      const fraction = remaining / length
      const { x, y } = pointOnPiece(piece, fraction)
      const split = { x, y }
      if (piece.kind === 'arc') {
        head.push({ ...piece, to: split, sweep: piece.sweep * fraction })
        tail.push({ ...piece, from: split, sweep: piece.sweep * (1 - fraction) })
      } else {
        head.push(trackStraight(piece.from, split))
        tail.push(trackStraight(split, piece.to))
      }
    }
    remaining -= length
  }
  return { head, tail }
}

export function minimumRadius(pieces: TrackPiece[]): number | null {
  let radius = Infinity
  for (const [index, piece] of pieces.entries()) {
    if (index && !tangentsAgree(pieceTangent(pieces[index - 1], true), pieceTangent(piece))) return 0
    if (piece.kind === 'arc') radius = Math.min(radius, unitsToMeters(piece.radius))
  }
  return Number.isFinite(radius) ? radius : null
}

export function radiusStatus(radius: number | null) {
  if (radius === null || radius >= ENGINEERING.preferredRadius) return 'good'
  if (radius >= ENGINEERING.restrictedRadius) return 'caution'
  if (radius >= ENGINEERING.minimumRadius - ENGINEERING.radiusTolerance) return 'restricted'
  return 'invalid'
}

export function curveSpeedKmh(radius: number | null) {
  // The lateral acceleration is a game parameter. Speed here is in km/h.
  return radius === null ? ENGINEERING.designSpeedKmh :
    Math.min(ENGINEERING.designSpeedKmh, 3.6 * Math.sqrt(Math.max(0, radius) * ENGINEERING.lateralAcceleration))
}

export const trackColors = { good: '#1a7854', caution: '#a08117', restricted: '#c1631e', invalid: '#c3333d' } as const

export function trackPath(pieces: TrackPiece[]) {
  if (!pieces.length) return ''
  const point = (p: Point) => p.x.toFixed(3) + ',' + p.y.toFixed(3)
  return 'M' + point(pieces[0].from) + pieces.map((piece) => {
    if (piece.kind === 'straight') return 'L' + point(piece.to)
    const radius = piece.radius.toFixed(4)
    return 'A' + radius + ',' + radius + ' 0 ' + (Math.abs(piece.sweep) > Math.PI ? 1 : 0) + ',' +
      (piece.sweep > 0 ? 1 : 0) + ' ' + point(piece.to)
  }).join('')
}

type SpeedNode = { offset: number; velocity: number; minute: number }
export interface TrackProfile { length: number; duration: number; nodes: SpeedNode[] }

const profiles = new WeakMap<TrackSection, Map<string, TrackProfile>>()
const accelerationInUnits = (value: number) => value * 3600 / ENGINEERING.metersPerUnit

function buildProfile(section: TrackSection, speed: number, direction: Direction): TrackProfile {
  const length = trackLength(section.pieces)
  if (section.legacy) {
    const duration = length / speed
    return { length, duration, nodes: [{ offset: 0, velocity: speed, minute: 0 }, { offset: length, velocity: speed, minute: duration }] }
  }
  const pieces = direction === 1 ? section.pieces : section.pieces.slice().reverse()
  const nodes = [{ offset: 0, velocity: 0, minute: 0 }]
  let offset = 0
  for (const piece of pieces) {
    const distance = pieceLength(piece)
    const limit = Math.min(speed, kmhToUnitsPerMinute(curveSpeedKmh(piece.kind === 'arc' ? unitsToMeters(piece.radius) : null)))
    const steps = Math.max(2, Math.ceil(distance / 8))
    const previous = nodes.at(-1)!
    previous.velocity = Math.min(previous.velocity, limit)
    for (let index = 1; index <= steps; index++) nodes.push({ offset: offset + distance * index / steps, velocity: limit, minute: 0 })
    offset += distance
  }
  nodes.at(-1)!.velocity = 0
  const constrain = (from: SpeedNode, to: SpeedNode, acceleration: number) => {
    to.velocity = Math.min(to.velocity, Math.sqrt(from.velocity ** 2 + 2 * accelerationInUnits(acceleration) * Math.abs(to.offset - from.offset)))
  }
  for (let index = 1; index < nodes.length; index++) constrain(nodes[index - 1], nodes[index], ENGINEERING.acceleration)
  for (let index = nodes.length - 1; index >= 1; index--) constrain(nodes[index], nodes[index - 1], ENGINEERING.braking)
  for (let index = 1; index < nodes.length; index++) {
    const a = nodes[index - 1]
    const b = nodes[index]
    b.minute = a.minute + 2 * (b.offset - a.offset) / (a.velocity + b.velocity)
  }
  return { length, duration: nodes.at(-1)!.minute, nodes }
}

export function trackProfile(section: TrackSection, speed: number, direction: Direction): TrackProfile {
  const cached = profiles.get(section) ?? new Map<string, TrackProfile>()
  const key = speed + '|' + direction
  const existing = cached.get(key)
  if (existing) return existing
  const profile = buildProfile(section, speed, direction)
  cached.set(key, profile)
  profiles.set(section, cached)
  return profile
}

function searchProfile(profile: TrackProfile, value: number, axis: 'offset' | 'minute') {
  let low = 0
  let high = profile.nodes.length - 1
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (profile.nodes[middle][axis] <= value) low = middle
    else high = middle
  }
  return [profile.nodes[low], profile.nodes[high]]
}

export function motionAt(profile: TrackProfile, minute: number) {
  const [a, b] = searchProfile(profile, minute, 'minute')
  const time = clamp(minute - a.minute, 0, b.minute - a.minute)
  const fraction = time / (b.minute - a.minute)
  const velocity = a.velocity + (b.velocity - a.velocity) * fraction
  return { offset: a.offset + (a.velocity + velocity) * time / 2, velocity }
}

export function timeAtDistance(profile: TrackProfile, distance: number) {
  const [a, b] = searchProfile(profile, distance, 'offset')
  const advance = clamp(distance - a.offset, 0, b.offset - a.offset)
  if (advance === 0) return a.minute
  const acceleration = (b.velocity - a.velocity) / (b.minute - a.minute)
  const velocity = Math.sqrt(Math.max(0, a.velocity ** 2 + 2 * acceleration * advance))
  return a.minute + 2 * advance / (a.velocity + velocity)
}
