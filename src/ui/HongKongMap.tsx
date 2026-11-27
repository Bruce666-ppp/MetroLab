import { memo, useEffect, useRef, useState } from 'react'
import { hongKong } from '../engine/hongKong.ts'
import type { Place, Polygon, Ring, Road } from '../engine/hongKong.ts'
import type { Station } from '../engine/types.ts'

const files = import.meta.env.BASE_URL + 'data/hong-kong/'
const map = hongKong.map
const tileSize = map.tileSize
const knownTiles = new Set(map.tiles.map(([x, y]) => x + '-' + y))
const roofs = ['#d7baa9', '#adbec4', '#d9c19d', '#c1bab0', '#e1ce9b', '#d9bdaf', '#d9cbbb']
const sides = ['#a5887b', '#798f99', '#a49070', '#97938e', '#ab9b73', '#aa9081', '#aa9b8d']

interface Building { height: number; use: number; outline: Polygon; x: number; y: number; size: number; path: Path2D }
interface Tile { buildings: Building[]; roads: Road[] }
interface RawTile { buildings: [number, number, Polygon][]; roads: Road[] }
interface Bounds { left: number; top: number; right: number; bottom: number }

function trace(path: Path2D | CanvasRenderingContext2D, ring: Ring, close = false) {
  path.moveTo(ring[0], ring[1])
  for (let index = 2; index < ring.length; index += 2) path.lineTo(ring[index], ring[index + 1])
  if (close) path.closePath()
}

function polygonPath(polygons: Polygon[]) {
  const path = new Path2D()
  for (const polygon of polygons) for (const ring of polygon) trace(path, ring, true)
  return path
}

export function mapPath(polygons: Polygon[]) {
  return polygons.map((polygon) => polygon.map((ring) => {
    let value = 'M' + ring[0] + ',' + ring[1]
    for (let i = 2; i < ring.length; i += 2) value += 'L' + ring[i] + ',' + ring[i + 1]
    return value + 'Z'
  }).join('')).join('')
}

const reliefPath = () => polygonPath(map.fullLand)
const playPath = () => polygonPath(map.land)
let paths: { full: Path2D; land: Path2D; wild: Path2D; park: Path2D; coast: Path2D } | undefined
function basePaths() {
  if (!paths) {
    const coast = new Path2D()
    map.coast.forEach((ring) => trace(coast, ring))
    paths = { full: reliefPath(), land: playPath(), wild: polygonPath(map.parks.filter(([kind]) => kind === 0).map(([, shape]) => shape)),
      park: polygonPath(map.parks.filter(([kind]) => kind === 1).map(([, shape]) => shape)), coast }
  }
  return paths
}

const resolvedTiles = new Map<string, Tile>()
const tileRequests = new Map<string, Promise<Tile>>()
function loadTile(id: string) {
  let request = tileRequests.get(id)
  if (!request) {
    request = fetch(files + 'tiles/' + id + '.json').then(async (response) => {
      if (!response.ok) throw new Error('Could not read Hong Kong map tile ' + id)
      return await response.json() as RawTile
    }).then((tile) => {
      const buildings = tile.buildings.map(([height, use, outline]) => {
        const xs = outline[0].filter((_, i) => i % 2 === 0)
        const ys = outline[0].filter((_, i) => i % 2 === 1)
        const x = (Math.min(...xs) + Math.max(...xs)) * .5, y = (Math.min(...ys) + Math.max(...ys)) * .5
        const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
        return { height, use, outline, x, y, size, path: polygonPath([outline]) }
      }).sort((a, b) => a.y - b.y)
      const value = { buildings, roads: tile.roads }
      resolvedTiles.set(id, value)
      return value
    }).catch((error: Error) => {
      tileRequests.delete(id)
      throw error
    })
    tileRequests.set(id, request)
  }
  return request
}

const crosses = (x: number, y: number, bounds: Bounds, margin: number) =>
  x + margin >= bounds.left && x - margin <= bounds.right && y + margin >= bounds.top && y - margin <= bounds.bottom

function streets(context: CanvasRenderingContext2D, roads: Road[], scale: number, minGrade: number, maxGrade: number) {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (let grade = maxGrade; grade >= minGrade; grade--) {
    const path = new Path2D()
    for (const road of roads) if (road[0] === grade) trace(path, road[2])
    context.strokeStyle = ['#cbbf9f', '#d3c9ae', '#d1c9b7', '#b7bd9f'][grade]
    context.lineWidth = [2.2, 1.6, 1.03, .55][grade] / scale
    context.stroke(path)
    if (grade < 3) {
      context.strokeStyle = ['#f6e8c4', '#fbf1d8', '#f7f0df'][grade]
      context.lineWidth = [1.25, .9, .54][grade] / scale
      context.stroke(path)
    }
  }
}

function paintBuilding(context: CanvasRenderingContext2D, building: Building, scale: number, flat: boolean) {
  const lift = flat ? 0 : Math.min(32, building.height * 0.079)
  const right = lift * .43
  if (lift * scale > .8) {
    const sidesPath = new Path2D()
    const outline = building.outline[0]
    for (let i = 0; i < outline.length - 2; i += 2) {
      const x = outline[i], y = outline[i + 1], endX = outline[i + 2], endY = outline[i + 3]
      sidesPath.moveTo(x, y)
      sidesPath.lineTo(endX, endY)
      sidesPath.lineTo(endX + right, endY - lift)
      sidesPath.lineTo(x + right, y - lift)
      sidesPath.closePath()
    }
    context.fillStyle = sides[building.use]
    context.fill(sidesPath)
  }
  context.translate(right, -lift)
  context.fillStyle = roofs[building.use]
  context.fill(building.path, 'evenodd')
  if (scale >= 1.24 && building.size >= 3.8) {
    context.strokeStyle = '#f2e9d8b0'
    context.lineWidth = .35 / scale
    context.stroke(building.path)
  }
  context.translate(-right, lift)
}

const fixedLabels = [
  { x: 751, y: 799, en: 'Victoria Harbour', zh: '維多利亞港', kind: -2 },
  { x: 675, y: 409, en: 'Kowloon', zh: '九龍', kind: -1 },
  { x: 901, y: 1050, en: 'Hong Kong Island', zh: '香港島', kind: -1 },
]
const primaryLabels = new Set(['Central', 'Kennedy Town', 'Tsim Sha Tsui', 'Stanley', 'Kowloon City', 'Mong Kok', 'Wong Tai Sin',
  'Kwun Tong', 'Chai Wan', 'Aberdeen', 'North Point', 'Causeway Bay'])

function paintLabels(context: CanvasRenderingContext2D, stationList: Station[], scale: number,
  left: number, top: number, width: number, height: number, zh: boolean) {
  const placed: Bounds[] = stationList.map(({ position, names }) => {
    const x = (position.x - left) * scale, y = (position.y - top) * scale
    const text = zh ? names?.zh : names?.en
    const edge = Math.max(34, (text?.length ?? 0) * (zh ? 6.7 : 3.5) + 5)
    return { left: x - edge, right: x + edge, top: y - 32, bottom: y + 10 }
  })
  const names = new Set<string>()
  const maxKind = scale < .34 ? 0 : scale < .74 ? 1 : scale < 1.7 ? 3 : 5
  const priority = (place: Place) => place.kind + (place.source === 0 ? .2 : .6) - (primaryLabels.has(place.en) ? 2 : 0)
  const list = [...fixedLabels, ...hongKong.places.filter((place) => place.kind <= maxKind).sort((a, b) => priority(a) - priority(b))]
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const place of list) {
    const x = (place.x - left) * scale, y = (place.y - top) * scale
    const name = zh ? place.zh : place.en
    if (x < 12 || x > width - 12 || y < 17 || y > height - 16 || names.has(name)) continue
    if (place.kind === -1 && scale > 1.1) continue
    if (place.kind < 0 && scale < .28 && place.kind !== -2) continue
    const size = place.kind < 0 ? (place.kind === -2 ? 16 : 17) : place.kind < 2 ? 12 : 10
    context.font = (place.kind < 2 ? '650 ' : '500 ') + size + 'px Geist Variable, system-ui, Microsoft JhengHei, sans-serif'
    context.letterSpacing = place.kind < 0 ? '1.5px' : place.kind < 2 ? '.35px' : '0px'
    const edge = context.measureText(name).width / 2 + (place.kind < 0 ? 10 : 5)
    const rect = { left: x - edge, right: x + edge, top: y - size * .83, bottom: y + size * .83 }
    if (placed.some((area) => rect.left < area.right && rect.right > area.left && rect.top < area.bottom && rect.bottom > area.top)) continue
    placed.push(rect)
    names.add(name)
    context.lineJoin = 'round'
    context.strokeStyle = place.kind === -2 ? '#c0dae0' : '#eeeddae6'
    context.lineWidth = place.kind < 2 ? 3.7 : 2.5
    context.strokeText(name, x, y)
    context.fillStyle = place.kind === -2 ? '#315f72' : place.kind < 2 ? '#384b42' : '#535d53'
    context.fillText(name, x, y)
  }
}

export const HongKongMap = memo(function HongKongMap({ left, top, scale, width, height, flat, zh, stations }: {
  left: number; top: number; scale: number; width: number; height: number; flat: boolean; zh: boolean; stations: Station[]
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const relief = useRef<HTMLImageElement | undefined>(undefined)
  const [, invalidate] = useState(0)
  const [missing, setMissing] = useState(false)
  const right = left + width / scale, bottom = top + height / scale
  const bounds = { left, top, right, bottom }
  const ids = scale < .25 ? [] : [...knownTiles].filter((id) => {
    const [x, y] = id.split('-').map(Number)
    return crosses((x + .5) * tileSize, (y + .5) * tileSize, bounds, tileSize * .5 + 36)
  })
  const visible = ids.join(',')

  useEffect(() => {
    let active = true
    const image = new Image()
    image.onload = () => {
      if (!active) return
      relief.current = image
      invalidate((value) => value + 1)
    }
    image.onerror = () => { if (active) setMissing(true) }
    image.src = files + 'relief.png'
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const unread = visible.split(',').filter((id) => id && !resolvedTiles.has(id))
    if (unread.length) void Promise.allSettled(unread.map(loadTile)).then((outcomes) => {
      if (!active) return
      if (outcomes.some((outcome) => outcome.status === 'rejected')) setMissing(true)
      invalidate((value) => value + 1)
    })
    return () => { active = false }
  }, [visible])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = ref.current
      const context = canvas?.getContext('2d', { alpha: false })
      if (!canvas || !context) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const sea = context.createLinearGradient(0, 0, width, height)
      sea.addColorStop(0, '#bbd6da')
      sea.addColorStop(1, '#a7cbd4')
      context.fillStyle = sea
      context.fillRect(0, 0, width, height)
      context.setTransform(scale * ratio, 0, 0, scale * ratio, -left * scale * ratio, -top * scale * ratio)
      const paths = basePaths()
      context.fillStyle = '#d3d9c4'
      context.fill(paths.full, 'evenodd')
      context.save()
      context.clip(paths.land, 'evenodd')
      context.fillStyle = '#e7e7d0'
      context.fill(paths.land, 'evenodd')
      if (relief.current) context.drawImage(relief.current, 0, 0, hongKong.width, hongKong.height)
      context.fillStyle = '#7e9f6f43'
      context.fill(paths.wild, 'nonzero')
      context.fillStyle = '#a9c197ac'
      context.fill(paths.park, 'nonzero')
      const tiles = ids.flatMap((id) => resolvedTiles.get(id) ?? [])
      if (scale >= .48) for (const tile of tiles) streets(context, tile.roads, scale, 2, scale > 1.03 ? 3 : 2)
      streets(context, map.majorRoads, scale, 0, 1)
      const minSize = scale < .48 ? 3.0 : scale < .83 ? 1.42 : .64
      for (const tile of tiles) for (const building of tile.buildings) {
        if (building.size * scale >= minSize && crosses(building.x, building.y, bounds, building.size + 35)) paintBuilding(context, building, scale, flat)
      }
      context.restore()
      context.strokeStyle = '#7c9ca066'
      context.lineWidth = 1.23 / scale
      context.stroke(paths.coast)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      paintLabels(context, stations, scale, left, top, width, height, zh)
    })
    return () => cancelAnimationFrame(frame)
  })

  return <canvas className="hong-kong-canvas" ref={ref} aria-hidden="true" data-testid="hk-map-canvas"
    data-assets={missing ? 'partial' : ids.every((id) => resolvedTiles.has(id)) && relief.current ? 'ready' : 'loading'}/>
})
