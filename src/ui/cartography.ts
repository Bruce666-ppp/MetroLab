import { districtPoint, STREET_PARKS, CITY_ARTERIALS, streetSpacing } from '../engine/geography.ts'
import { bridgeEnds, isWater, pathString } from '../engine/geometry.ts'
import type { City, District, Point } from '../engine/types.ts'

interface DistrictDrawing {
  id: string
  land: string
  roads: string
  lanes: string
}

const polygon = (pairs: [number, number][]) => pathString(pairs.map(([x, y]) => ({ x, y })), true)
export const mainRoads = CITY_ARTERIALS.map((road) => pathString(road))
export const parkLand = STREET_PARKS.map((park) => pathString(park, true))

export const backgroundGreens = [
  polygon([[-90, -40], [219, -40], [251, 60], [197, 110], [176, 256], [104, 298], [15, 267], [-90, 298]]),
  polygon([[1210, -35], [1590, -35], [1590, 111], [1450, 125], [1336, 95], [1233, 61]]),
  polygon([[-88, 652], [129, 689], [145, 791], [217, 871], [303, 920], [322, 1034], [-88, 1034]]),
  polygon([[1200, 978], [1236, 927], [1355, 901], [1408, 825], [1540, 797], [1550, 1030], [1194, 1030]]),
]



export const parkTrails = [
  'M158 661Q222 595 297 596T389 645M205 755Q246 702 289 701T376 699M242 606Q253 644 319 655T351 734',
  'M669 315Q705 335 751 345M706 287L705 372',
  'M1190 258L1188 300 1233 309M1203 529Q1227 550 1210 584',
  'M832 850Q867 828 879 776M484 735L557 712',
]

export const lake = 'M204 670Q226 644 261 653Q278 658 268 676Q256 693 264 707Q252 727 226 714Q211 710 206 697Q197 684 204 670Z'



const parksInterior = [
  { x: 289, y: 635, rx: 95, ry: 68 }, { x: 337, y: 707, rx: 43, ry: 33 },
  { x: 706, y: 345, rx: 43, ry: 31 }, { x: 1211, y: 278, rx: 39, ry: 24 },
  { x: 1209, y: 562, rx: 26, ry: 37 }, { x: 855, y: 825, rx: 32, ry: 34 },
  { x: 524, y: 726, rx: 34, ry: 22 }, { x: 116, y: 132, rx: 71, ry: 67 },
  { x: 126, y: 836, rx: 81, ry: 82 }, { x: 1467, y: 912, rx: 91, ry: 66 },
]

function randomSequence(seed: number) {
  let value = seed
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0
    return value / 4_294_967_296
  }
}

function drawDistrict(city: City, district: District, index: number): DistrictDrawing {
  const random = randomSequence(73621 + index * 329)
  const [rx, ry] = district.radius
  const land = Array.from({ length: 17 }, (_, i) => {
    const angle = i / 17 * Math.PI * 2
    const radius = 0.91 + random() * 0.14
    return districtPoint(district, Math.cos(angle) * rx * radius, Math.sin(angle) * ry * radius)
  })
  const step = streetSpacing(district)
  const roads: string[] = []
  const lanes: string[] = []
  for (const axis of [0, 1]) {
    const fixedMax = axis ? ry : rx
    const varyingMax = axis ? rx : ry
    for (let fixed = -fixedMax; fixed < fixedMax; fixed += step) {
      const run: Point[] = []
      const chunks: Point[][] = []
      for (let varying = -varyingMax; varying <= varyingMax; varying += 7) {
        const [u, v] = axis ? [varying, fixed] : [fixed, varying]
        const point = districtPoint(district, u, v)
        if ((u / rx) ** 2 + (v / ry) ** 2 <= 1 && !isWater(city, point, 7)) run.push(point)
        else if (run.length) chunks.push(run.splice(0))
      }
      if (run.length) chunks.push(run)
      for (const chunk of chunks) {
        if (chunk.length < 2) continue
        const isCollector = Math.abs(fixed) < step * 0.6 || Math.floor(fixed / step) % 3 === 0
        ;(isCollector ? roads : lanes).push(pathString([chunk[0], chunk.at(-1)!]))
      }
    }
  }
  return { id: district.id, land: pathString(land, true), roads: roads.join(''), lanes: lanes.join('') }
}

const cache = new WeakMap<City, ReturnType<typeof buildCartography>>()

function buildCartography(city: City) {
  const districtDrawings = city.districts.map((area, index) => drawDistrict(city, area, index))
  const bank = (side: number, offset = 0) => Array.from({ length: 101 }, (_, i) => {
    const y = city.height * i / 100
    const { center, halfWidth } = city.river(y)
    return { x: center + side * (halfWidth + offset), y }
  })
  const west = bank(-1)
  const east = bank(1)
  const river = pathString([...west, ...east.slice().reverse()], true)
  const banks = pathString(west) + pathString(east)
  const boardwalk = pathString(bank(-1, 9).slice(22, 49)) + pathString(bank(1, 9).slice(35, 71))
  const bridges = city.bridges.map((bridge) => pathString(bridgeEnds(city, bridge)))
  const random = randomSequence(41080)
  const trees = parksInterior.flatMap(({ x, y, rx, ry }) =>
    Array.from({ length: 29 }, () => {
      const angle = random() * 6.283
      const distance = Math.sqrt(random())
      return { x: x + Math.cos(angle) * distance * rx, y: y + Math.sin(angle) * distance * ry, r: 2.4 + random() * 4.9 }
    }).filter((point) => !isWater(city, point, 5)))
  return { districtDrawings, river, banks, boardwalk, bridges, trees }
}

export function cartography(city: City) {
  const existing = cache.get(city)
  if (existing) return existing
  const map = buildCartography(city)
  cache.set(city, map)
  return map
}
