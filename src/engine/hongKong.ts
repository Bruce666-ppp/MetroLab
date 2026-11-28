import type { BilingualName, District, Point, Station } from './types.ts'

export type Ring = number[]
export type Polygon = Ring[]
export type Road = [hierarchy: number, level: number, points: Ring]
export interface HongKongCell extends Point {
  zone: number; council: number; residents: number; jobs: number; students: number; shops: number; health: number; leisure: number
  node: number; column: number; row: number
}
export interface Place extends Point { en: string; zh: string; kind: number; source: number }
type Zone = [id: string, x: number, y: number, en: string, zh: string, residents: number, jobs: number,
  students: number, shops: number, health: number, leisure: number, km2: number, shape: Polygon[]]
type Cell = [x: number, y: number, zone: number, council: number, homes: number, work: number, school: number, shops: number,
  health: number, leisure: number, node: number, column: number, row: number]
interface RawMap {
  projection: [number, number, number, number, number]; grid: number; cellSize: number; tileSize: number
  elevation: string; density: string; nodes: string; edges: string; tiles: [number, number][]
  land: Polygon[]; fullLand: Polygon[]; island: Polygon[]; coast: Ring[]; ferryPiers: [number, number][]
  zones: Zone[]; cells: Cell[]; places: [number, number, string, string, number, number][];
  majorRoads: Road[]; parks: [number, Polygon][]; councils: [string, string, number][]
  buildingHeights: { surveyed: number; storeys: number; estimated: number }
}

interface StationSites {
  water: Polygon[]
  restricted: Polygon[]
  names: [en: string, zh: string, anchors: [x: number, y: number, reach: number][]][]
}

type OfficialStationNames = [code: string, en: string, zh: string, anchors: [x: number, y: number, reach: number][]][]

async function loadGeography<T>(file: string): Promise<T> {
  const asset = 'data/hong-kong/' + file
  if (typeof location !== 'undefined') {
    const response = await fetch(import.meta.env.BASE_URL + asset)
    if (!response.ok) throw new Error('Hong Kong geography could not be loaded (' + response.status + ')')
    return response.json()
  }
  const nodeFileSystem = 'node:fs/promises'
  const { readFile } = await import(/* @vite-ignore */ nodeFileSystem) as typeof import('node:fs/promises')
  return JSON.parse(await readFile(new URL('../../public/' + asset, import.meta.url), 'utf8'))
}

const [map, stationSites, mtrNames] = await Promise.all([loadGeography<RawMap>('model.json'),
  loadGeography<StationSites>('station-sites.json'), loadGeography<OfficialStationNames>('mtr-stations.json')])
const coordinate = ([x, y]: number[]): Point => ({ x, y })
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const zones = map.zones.map(([id, x, y, en, zh, residents, jobs, students, shops, health, leisure, areaKm2, shape]) => ({
  id, center: { x, y }, names: { en, zh }, residents, jobs, students, shops, health, leisure, areaKm2, shape,
}))
const cells = map.cells.map(([x, y, zone, council, residents, jobs, students, shops, health, leisure, node, column, row]) =>
  ({ x, y, zone, council, residents, jobs, students, shops, health, leisure, node, column, row }))
const places = map.places.map(([x, y, en, zh, kind, source]) => ({ x, y, en, zh, kind, source }))
const piers = map.ferryPiers.map(coordinate)
const width = (map.projection[3] - map.projection[1]) / 10
const height = (map.projection[2] - map.projection[4]) / 10
const surveyColumns = width / map.grid

export const HONG_KONG = 'hong-kong'

export function surveyPoint(easting: number, northing: number) {
  return { x: (easting - map.projection[1]) / 10, y: (map.projection[2] - northing) / 10 }
}

const from64 = (value: string) => Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0))
const dataView = (value: string) => new DataView(from64(value).buffer)
const nodeBytes = dataView(map.nodes)
const nodes = Array.from({ length: nodeBytes.byteLength / 4 }, (_, index) =>
  ({ x: nodeBytes.getUint16(index * 4, true) / 10, y: nodeBytes.getUint16(index * 4 + 2, true) / 10 }))
const heights = from64(map.elevation)
const density = from64(map.density)
const byteIndex = (point: Point) => Math.floor(point.y / map.grid) * surveyColumns + Math.floor(point.x / map.grid)

export function elevationAt(point: Point) {
  const index = 2 * byteIndex(point)
  return (heights[index] ?? 0) + 256 * (heights[index + 1] ?? 0)
}

export function densityAt(point: Point) {
  return (density[byteIndex(point)] ?? 0) / 100
}

function contains(ring: Ring, point: Point) {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1]
    if ((ay > point.y) !== (by > point.y) && point.x < (bx - ax) * (point.y - ay) / (by - ay) + ax) inside = !inside
  }
  return inside
}

const inPolygon = (polygon: Polygon, point: Point) => contains(polygon[0], point) && !polygon.slice(1).some((ring) => contains(ring, point))
const inSet = (polygons: Polygon[], point: Point) => polygons.some((polygon) => inPolygon(polygon, point))
const cellKey = (x: number, y: number) => x + ',' + y

function indexPolygons(polygons: Polygon[], step: number) {
  const index = new Map<string, Polygon[]>()
  for (const polygon of polygons) {
    const outer = polygon[0]
    const xs = outer.filter((_, i) => i % 2 === 0)
    const ys = outer.filter((_, i) => i % 2 === 1)
    const minX = Math.floor(Math.min(...xs) / step), maxX = Math.floor(Math.max(...xs) / step)
    const minY = Math.floor(Math.min(...ys) / step), maxY = Math.floor(Math.max(...ys) / step)
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = cellKey(x, y)
        const bucket = index.get(key) ?? []
        bucket.push(polygon)
        index.set(key, bucket)
      }
    }
  }
  return (point: Point) => inSet(index.get(cellKey(Math.floor(point.x / step), Math.floor(point.y / step))) ?? [], point)
}

function indexPoints<T extends Point>(points: T[], step: number) {
  const index = new Map<string, T[]>()
  for (const item of points) {
    const key = cellKey(Math.floor(item.x / step), Math.floor(item.y / step))
    const bucket = index.get(key) ?? []
    bucket.push(item)
    index.set(key, bucket)
  }
  return (origin: Point, radius: number) => {
    const result: T[] = []
    for (let x = Math.floor((origin.x - radius) / step); x <= Math.floor((origin.x + radius) / step); x++) {
      for (let y = Math.floor((origin.y - radius) / step); y <= Math.floor((origin.y + radius) / step); y++) {
        const bucket = index.get(cellKey(x, y))
        if (bucket) result.push(...bucket)
      }
    }
    return result
  }
}

const areaIndex = new Map<string, typeof zones>()
for (const zone of zones) for (const polygon of zone.shape) {
  const xs = polygon[0].filter((_, i) => i % 2 === 0)
  const ys = polygon[0].filter((_, i) => i % 2 === 1)
  for (let x = Math.floor(Math.min(...xs) / 60); x <= Math.floor(Math.max(...xs) / 60); x++) {
    for (let y = Math.floor(Math.min(...ys) / 60); y <= Math.floor(Math.max(...ys) / 60); y++) {
      const key = cellKey(x, y)
      const entries = areaIndex.get(key) ?? []
      if (!entries.includes(zone)) entries.push(zone)
      areaIndex.set(key, entries)
    }
  }
}

const inMap = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
  point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
const mapSurface = (point: Point) => inSet(map.land, point) ? 'land' : inSet(map.fullLand, point) ? 'outside' : 'water'
const shoreGrid = new Map<string, 'land' | 'water' | 'outside'>()
export function surfaceAt(point: Point) {
  if (!inMap(point)) return 'outside'
  const key = cellKey(Math.round(point.x * 2), Math.round(point.y * 2))
  const known = shoreGrid.get(key)
  if (known) return known
  const result = mapSurface(point)
  if (shoreGrid.size > 80_000) shoreGrid.clear()
  shoreGrid.set(key, result)
  return result
}

const inInlandWater = indexPolygons(stationSites.water, 60)
const inRestrictedArea = indexPolygons(stationSites.restricted, 60)
export function hongKongSiteSurface(point: Point) {
  if (!inMap(point)) return 'outside'
  const surface = mapSurface(point)
  return surface === 'land' && inInlandWater(point) ? 'water' : surface
}

export function hongKongStationSiteError(point: Point) {
  const surface = hongKongSiteSurface(point)
  if (surface === 'outside') return 'outOfBounds'
  if (surface === 'water') return 'water'
  if (inRestrictedArea(point)) return 'restrictedStationSite'
}

export function zoneAt(point: Point) {
  const local = areaIndex.get(cellKey(Math.floor(point.x / 60), Math.floor(point.y / 60)))
  return local?.find((area) => inSet(area.shape, point))
}

const placeIndex = indexPoints(places, 45)
const kinds = [2, 1.4, 0.8, 1.0, 0.65, 0.7]
const reachByKind = [85, 63, 29, 32, 23, 24]
const nameKey = (name: string) => name.trim().toLowerCase()
const directions: BilingualName[] = [{ en: 'East', zh: '東' }, { en: 'South East', zh: '東南' }, { en: 'South', zh: '南' }, { en: 'South West', zh: '西南' },
  { en: 'West', zh: '西' }, { en: 'North West', zh: '西北' }, { en: 'North', zh: '北' }, { en: 'North East', zh: '東北' }]
const stationReferences = stationSites.names.flatMap(([en, zh, anchors]) => {
  const origin = coordinate(anchors[0])
  return anchors.map(([x, y, reach]) => ({ en, zh, x, y, reach, origin }))
})

const mtrReferences = mtrNames.flatMap(([code, en, zh, anchors]) => {
  const origin = coordinate(anchors[0])
  const local = code === 'HKU' ? stationSites.names.find(([name]) => name === 'HKU')?.[2] ?? [] : []
  return [...anchors, ...local].map(([x, y, reach]) => ({ code, en, zh, x, y, reach, origin }))
})

function nearestReference<T extends Point & { reach: number }>(point: Point, references: T[]) {
  let reference: T | undefined
  let nearest = Infinity
  for (const anchor of references) {
    const distance = gap(anchor, point)
    if (distance <= anchor.reach && distance < nearest) { reference = anchor; nearest = distance }
  }
  return reference
}

export const officialMtrStationAt = (point: Point) => nearestReference(point, mtrReferences)

export function existingMtrStationAt(point: Point, stations: Station[]) {
  const official = officialMtrStationAt(point)
  if (!official) return undefined
  return stations.filter(({ names }) => names && (nameKey(names.en) === nameKey(official.en) || nameKey(names.zh) === nameKey(official.zh)))
    .sort((a, b) => gap(a.position, point) - gap(b.position, point))[0]
}

export function hongKongName(point: Point, previous: Station[]): BilingualName {
  const reference = officialMtrStationAt(point) ?? nearestReference(point, stationReferences)
  const local = reference ? [] : placeIndex(point, 135).map((place) => ({ place, distance: gap(place, point) }))
    .filter(({ place, distance }) => distance <= reachByKind[place.kind] * 1.25)
    .sort((a, b) => (a.distance / reachByKind[a.place.kind]) ** 2 - (b.distance / reachByKind[b.place.kind]) ** 2
      + 0.42 * (kinds[b.place.kind] - kinds[a.place.kind]) + 0.05 * (a.place.source - b.place.source))
  const busy = new Set(previous.flatMap((station) => [station.names?.en ?? station.name, station.names?.zh ?? station.name]).map(nameKey))
  const unique = (name: BilingualName) => !busy.has(nameKey(name.en)) && !busy.has(nameKey(name.zh))
  const best = reference ?? local[0]?.place
  if (best && unique(best)) return { en: best.en, zh: best.zh }
  const alternate = best && local.find(({ place, distance }) => place.kind < 4 && distance < 43 && unique(place))?.place
  if (alternate) return { en: alternate.en, zh: alternate.zh }
  const area = zoneAt(point) ?? zones.reduce((best, zone) => gap(zone.center, point) < gap(best.center, point) ? zone : best)
  const name = best ?? { ...area.names, ...area.center }
  const origin = reference?.origin ?? name
  const angle = Math.atan2(point.y - origin.y, point.x - origin.x)
  const index = (Math.round(angle / (Math.PI / 4)) + 8) % 8
  for (const offset of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const direction = directions[(index + offset + 8) % 8]
    const directional = { en: name.en + ' ' + direction.en, zh: name.zh + direction.zh }
    if (unique(directional)) return directional
  }
  const street = local.find(({ place }) => unique(place))?.place
  return street ? { en: street.en, zh: street.zh } : { en: name.en, zh: name.zh }
}

export const walkRadius = (level: Station['level']) => 60 + 10 * (level - 1)
const walkIndex = indexPoints(nodes.map((point, id) => ({ ...point, id })), 15)
const cellIndex = indexPoints(cells.map((cell, id) => ({ ...cell, id })), 25)
const adjacency: [number, number][][] = nodes.map(() => [])
const edgeBytes = dataView(map.edges)
for (let offset = 0; offset < edgeBytes.byteLength; offset += 10) {
  const a = edgeBytes.getUint32(offset, true), b = edgeBytes.getUint32(offset + 4, true), length = edgeBytes.getUint16(offset + 8, true) / 10
  adjacency[a].push([b, length])
  adjacency[b].push([a, length])
}

function connector(a: Point, b: Point) {
  const length = gap(a, b)
  for (let index = 1; index < Math.ceil(length / 2); index++) {
    const rate = index / Math.ceil(length / 2)
    if (surfaceAt({ x: a.x + rate * (b.x - a.x), y: a.y + rate * (b.y - a.y) }) !== 'land') return Infinity
  }
  return length + Math.abs(elevationAt(a) - elevationAt(b)) / 12
}

const walkCache = new Map<string, Map<number, number>>()
export function walkCells(position: Point, level: Station['level']) {
  const key = position.x.toFixed(1) + '|' + position.y.toFixed(1) + '|' + level
  const known = walkCache.get(key)
  if (known) return known
  const radius = walkRadius(level)
  const result = new Map<number, number>()
  if (surfaceAt(position) !== 'land') return result
  const spurs = walkIndex(position, 15).map((node) => ({ id: node.id, distance: gap(position, node) }))
    .filter((node) => node.distance <= 15).sort((a, b) => a.distance - b.distance)
  const queue: [number, number][] = []
  for (const spur of spurs) {
    if (queue.length && (queue.length === 4 || spur.distance > queue[0][1] + 5)) break
    const length = connector(position, nodes[spur.id])
    if (length <= 15) queue.push([spur.id, length])
  }
  if (!queue.length) return result
  const distances = new Map(queue)
  while (queue.length) {
    const [node, length] = queue.pop()!
    if (length !== distances.get(node)) continue
    for (const [next, weight] of adjacency[node]) {
      const nextLength = weight + length
      if (nextLength > radius || nextLength >= (distances.get(next) ?? Infinity)) continue
      distances.set(next, nextLength)
      // Re-open an improved vertex. The search is bounded to one pedestrian catchment.
      queue.push([next, nextLength])
    }
  }
  for (const cell of cellIndex(position, radius)) {
    const length = distances.get(cell.node)
    if (length === undefined) continue
    const access = length + connector(cell, nodes[cell.node])
    if (access <= radius) result.set(cell.id, access)
  }
  if (walkCache.size >= 196) walkCache.delete(walkCache.keys().next().value!)
  walkCache.set(key, result)
  return result
}

export const walkingMinutes = (units: number) => 0.75 + units / 8
export const onIsland = (point: Point) => inSet(map.island, point)
export const ferryAccess = (point: Point) => Math.min(...piers.map((pier) => gap(point, pier)))

export const hongKong = { width, height, map, zones, cells, places, piers }
export const hongKongDistricts: District[] = zones.map((area) => ({ ...area, radius: [65, 65], angle: 0,
  zone: 'waterfront', visitors: area.shops + area.health + area.leisure, opens: 1 }))
