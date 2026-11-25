import { buildingIsOpen, cityscape } from '../engine/cityscape.ts'
import type { Building, BuildingUse } from '../engine/cityscape.ts'
import { interpolate, pathString } from '../engine/geometry.ts'
import { ENGINEERING } from '../engine/track.ts'
import type { City, Point } from '../engine/types.ts'

const paints: Record<BuildingUse, [string, string, string, string]> = {
  residential: ['#e6ddc9', '#dbcfb8', '#b8a991', '#cdbfa7'],
  mixed: ['#dfd2bd', '#d4c3ad', '#a79381', '#c4ac97'],
  office: ['#cddde0', '#bdcdd4', '#849ca8', '#a2b6bf'],
  retail: ['#dec9b9', '#d2bcac', '#ad9587', '#c3aa99'],
  industry: ['#ddd3c4', '#cec3b4', '#aaa092', '#bdb2a2'],
  school: ['#d4ddca', '#c6d3bf', '#93a68f', '#adc0aa'],
  hospital: ['#dbe6df', '#cbdcd3', '#95aaa4', '#afc2b9'],
  sports: ['#d5e0d9', '#cbd9d5', '#8ea8a4', '#acbeb7'],
}

// An oblique roof displacement leaves the survey plane fixed.
export function projectRoof(point: Point, height: number): Point {
  const exaggeration = height / ENGINEERING.metersPerUnit * 2.65
  return { x: point.x - exaggeration * 0.27, y: point.y - exaggeration * 0.96 }
}

const translate = (p: Point, x: number, y: number): Point => ({ x: p.x + x, y: p.y + y })
const inset = (outline: Point[], center: Point, amount: number) => outline.map((p) => interpolate(center, p, amount))

interface Shape {
  building: Building
  base: string
  roof: string
  shade: string
  sun: string
  shadow: string
  detail: string
  accent: string
  field: string
  depth: number
}

function prepareBuilding(building: Building): Shape {
  const { outline, point, height, form } = building
  const roof = outline.map((corner) => projectRoof(corner, height))
  const center = projectRoof(point, height)
  const shift = { x: center.x - point.x, y: center.y - point.y }
  const lit: string[] = []
  const shaded: string[] = []
  const striations: string[] = []
  const features: string[] = []
  for (let i = 0; i < outline.length; i++) {
    const n = (i + 1) % outline.length
    const a = outline[i]
    const b = outline[n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx * shift.y - dy * shift.x <= 0) continue
    const collection = Math.abs(dx) >= Math.abs(dy) ? shaded : lit
    collection.push(pathString([a, b, roof[n], roof[i]], true))
    if (height < 14 || form === 'arena') continue
    const rows = Math.min(7, Math.floor(building.floors / (form === 'tower' ? 3 : 2)))
    for (let floor = 1; floor <= rows; floor++) {
      const t = floor / (rows + 1)
      const left = interpolate(roof[i], a, t)
      const right = interpolate(roof[n], b, t)
      striations.push(pathString([interpolate(left, right, 0.11), interpolate(left, right, 0.91)]))
    }
  }
  let field = ''
  if (form === 'arena') {
    field = pathString(inset(roof, center, 0.67), true)
    features.push(pathString([translate(center, 0, -7), translate(center, 0, 7)]))
    features.push(pathString([translate(center, -9, -7), translate(center, 9, -7), translate(center, 9, 7), translate(center, -9, 7)], true))
  } else if (form === 'tower') {
    const penthouse = inset(roof.slice(0, roof.length), translate(center, -0.4, -1.2), building.floors >= 40 ? 0.58 : 0.33)
    features.push(pathString(penthouse, true))
    striations.push(pathString([roof[0], roof[1]]))
  } else if (form === 'warehouse') {
    const axisA = interpolate(roof[0], roof[1], 0.34)
    const axisB = interpolate(roof[3], roof[2], 0.34)
    const secondA = interpolate(roof[0], roof[1], 0.65)
    const secondB = interpolate(roof[3], roof[2], 0.65)
    features.push(pathString([interpolate(axisA, axisB, 0.14), interpolate(axisA, axisB, 0.87)]))
    features.push(pathString([interpolate(secondA, secondB, 0.14), interpolate(secondA, secondB, 0.87)]))
  } else if (form === 'terrace') {
    striations.push(pathString([interpolate(roof[0], roof[1], 0.52), interpolate(roof.at(-1)!, roof.at(-2)!, 0.52)]))
  }
  if (building.use === 'hospital' && building.floors > 7) {
    features.push(pathString([translate(center, -2.8, 0), translate(center, 2.8, 0)]) +
      pathString([translate(center, 0, -2.8), translate(center, 0, 2.8)]))
  }
  const shadow = outline.map((corner) => translate(corner, -shift.x * 1.3 + height * 0.035, -shift.y * 0.39))
  return {
    building, base: pathString(outline, true), roof: pathString(roof, true),
    shade: shaded.join(''), sun: lit.join(''), shadow: pathString(shadow, true),
    detail: striations.join(''), accent: features.join(''), field,
    depth: Math.max(...outline.map((p) => p.y)),
  }
}

const prepared = new WeakMap<City, Shape[]>()

export function buildingPaint(city: City, growth: Record<string, number>, detail: boolean, flat: boolean) {
  const shapes = prepared.get(city) ?? cityscape(city).buildings.map(prepareBuilding).sort((a, b) => a.depth - b.depth)
  prepared.set(city, shapes)
  const shadows: string[] = []
  const batches: Map<string, string[]>[] = []
  const group = (bucket: Map<string, string[]>, channel: string, path: string) => {
    if (!path) return
    const paths = bucket.get(channel) ?? []
    paths.push(path)
    bucket.set(channel, paths)
  }
  for (const shape of shapes) {
    if (!buildingIsOpen(shape.building, growth[shape.building.district] ?? 0)) continue
    const colors = paints[shape.building.use]
    if (flat) {
      const bucket = batches[0] ??= new Map()
      group(bucket, 'fill|' + colors[shape.building.tone], shape.base)
      continue
    }
    if (detail || shape.building.floors >= 4) shadows.push(shape.shadow)
    const band = Math.floor(shape.depth / 11) * 4
    const walls = batches[band] ??= new Map()
    const roof = batches[band + 1] ??= new Map()
    const details = batches[band + 2] ??= new Map()
    const accents = batches[band + 3] ??= new Map()
    group(walls, 'fill|' + colors[2], shape.shade)
    group(walls, 'fill|' + colors[3], shape.sun)
    group(roof, 'roof|' + colors[shape.building.tone], shape.roof)
    if (detail || shape.building.floors >= 15) {
      group(details, 'fill|#759d7f', shape.field)
      group(details, 'line|#5c7467', shape.detail)
      group(accents, 'accent|' + (shape.building.use === 'hospital' ? '#b36b62' : '#f5f5eb'), shape.accent)
    }
  }
  return { shadows: shadows.join(''), batches: batches.flatMap((batch) => Array.from(batch, ([key, paths]) => {
    const [pass, color] = key.split('|')
    return { pass, color, path: paths.join('') }
  })) }
}
