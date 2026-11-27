import type { City, Point } from './types.ts'
import { surfaceAt } from './hongKong.ts'

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
export const interpolate = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

export function octilinear(a: Point, b: Point): Point[] {
  if (a.x > b.x || (a.x === b.x && a.y > b.y)) return octilinear(b, a).reverse()
  const dx = b.x - a.x
  const dy = b.y - a.y
  const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
  if (diagonal < 1 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1) return [a, b]
  return [a, { x: a.x + diagonal, y: a.y + Math.sign(dy) * diagonal }, b]
}

export function isWater(city: City, point: Point, margin = 0) {
  if (city.hongKong) return surfaceAt(point) === 'water'
  const river = city.river(point.y)
  return Math.abs(point.x - river.center) <= river.halfWidth + margin
}

export function bridgeEnds(city: City, bridge: City['bridges'][number]): [Point, Point] {
  const river = city.river(bridge.y)
  return [
    { x: river.center - river.halfWidth - 45, y: bridge.y - bridge.tilt },
    { x: river.center + river.halfWidth + 45, y: bridge.y + bridge.tilt },
  ]
}

export function walkDistance(city: City, a: Point, b: Point) {
  const direct = distance(a, b)
  const sameBank = Math.sign(a.x - city.river(a.y).center) === Math.sign(b.x - city.river(b.y).center)
  if (sameBank) return direct * 1.11
  return Math.min(...city.bridges.map((bridge) => {
    const [west, east] = bridgeEnds(city, bridge)
    const [entry, exit] = a.x < city.river(a.y).center ? [west, east] : [east, west]
    return 1.11 * (distance(a, entry) + distance(entry, exit) + distance(exit, b))
  }))
}

export function pathString(points: Point[], close = false) {
  return points.map((point, index) => (index ? 'L' : 'M') + point.x.toFixed(1) + ',' + point.y.toFixed(1)).join('') + (close ? 'Z' : '')
}
