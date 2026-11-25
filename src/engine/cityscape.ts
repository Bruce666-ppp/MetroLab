import { clamp, distance, isWater, walkDistance } from './geometry.ts'
import { CITY_ARTERIALS, districtPoint, districtScore, STREET_PARKS, streetSpacing } from './geography.ts'
import { unitsToMeters } from './track.ts'
import type { City, District, Point } from './types.ts'

export type BuildingUse = 'residential' | 'mixed' | 'office' | 'retail' | 'industry' | 'school' | 'hospital' | 'sports'
export type BuildingForm = 'block' | 'terrace' | 'tower' | 'warehouse' | 'campus' | 'arena'
export const uses: BuildingUse[] = ['residential', 'mixed', 'office', 'retail', 'industry', 'school', 'hospital', 'sports']

export interface Building {
  id: string
  district: string
  use: BuildingUse
  form: BuildingForm
  point: Point
  outline: Point[]
  floors: number
  footprint: number
  height: number
  opensAt: number
  tone: number
}

interface Landmark {
  id: string
  district: string
  point: Point
  reach: number
  reserved: number
  type: 'facility' | 'square' | 'street'
  building?: { use: BuildingUse; form: BuildingForm; width: number; depth: number; floors: number }
}

const landmark = (id: string, district: string, x: number, y: number, reach: number, reserved: number,
  type: Landmark['type'], building?: Landmark['building']): Landmark =>
  ({ id, district, point: { x, y }, reach, reserved, type, building })

export const marlowLandmarks: Landmark[] = [
  landmark('exchangeTower', 'central', 777, 464, 52, 20, 'facility', { use: 'office', form: 'tower', width: 16, depth: 13, floors: 57 }),
  landmark('centralPlaza', 'central', 742, 524, 62, 22, 'square'),
  landmark('civicLibrary', 'central', 699, 530, 44, 16, 'facility', { use: 'mixed', form: 'campus', width: 18, depth: 11, floors: 5 }),
  landmark('marlowUniversity', 'university', 751, 259, 77, 28, 'facility', { use: 'school', form: 'campus', width: 30, depth: 24, floors: 5 }),
  landmark('alderSchool', 'westend', 264, 384, 43, 17, 'facility', { use: 'school', form: 'campus', width: 17, depth: 12, floors: 3 }),
  landmark('oldTownGate', 'oldTown', 522, 409, 60, 14, 'square'),
  landmark('oldTownHall', 'oldTown', 473, 354, 44, 13, 'facility', { use: 'mixed', form: 'terrace', width: 11, depth: 10, floors: 4 }),
  landmark('marketArcade', 'market', 506, 602, 68, 19, 'facility', { use: 'retail', form: 'block', width: 20, depth: 15, floors: 5 }),
  landmark('willowGardens', 'park', 304, 655, 78, 0, 'facility'),
  landmark('quayPromenade', 'northQuay', 1096, 217, 68, 16, 'square'),
  landmark('harborExchange', 'harbor', 1123, 380, 63, 18, 'facility', { use: 'mixed', form: 'tower', width: 15, depth: 12, floors: 32 }),
  landmark('dockWorks', 'docklands', 1139, 673, 63, 23, 'facility', { use: 'industry', form: 'warehouse', width: 30, depth: 19, floors: 2 }),
  landmark('southbankHospital', 'southbank', 954, 812, 73, 28, 'facility', { use: 'hospital', form: 'campus', width: 29, depth: 21, floors: 10 }),
  landmark('eastbankStadium', 'eastbank', 1330, 572, 70, 26, 'facility', { use: 'sports', form: 'arena', width: 39, depth: 28, floors: 4 }),
  landmark('cedarAvenue', 'cedar', 550, 168, 67, 0, 'street'),
  landmark('westendBoulevard', 'westend', 296, 441, 69, 0, 'street'),
  landmark('hillviewRoad', 'hillview', 526, 821, 63, 0, 'street'),
  landmark('quarrySquare', 'quarry', 1348, 204, 61, 14, 'square'),
  landmark('meadowCourt', 'meadow', 1304, 825, 65, 15, 'square'),
]

export function randomSequence(seed: number) {
  let value = seed
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0
    return value / 4_294_967_296
  }
}

const mix: Record<District['zone'], readonly number[]> = {
  residential: [67, 18, 4, 11, 0, 0, 0, 0],
  office: [12, 35, 41, 12, 0, 0, 0, 0],
  commercial: [31, 33, 12, 24, 0, 0, 0, 0],
  industrial: [5, 9, 10, 12, 64, 0, 0, 0],
  civic: [28, 22, 17, 15, 0, 12, 6, 0],
  park: [41, 22, 1, 30, 0, 6, 0, 0],
  waterfront: [34, 24, 8, 23, 11, 0, 0, 0],
}
const arterialSegments = CITY_ARTERIALS.flatMap((road) => road.slice(1).map((point, i) => ({ start: road[i], end: point })))

function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fraction = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy)
}

function withinPolygon(point: Point, boundary: Point[]) {
  let inside = false
  for (let index = 0, previous = boundary.length - 1; index < boundary.length; previous = index++) {
    const a = boundary[previous]
    const b = boundary[index]
    if ((a.y > point.y) === (b.y > point.y)) continue
    if (point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside
  }
  return inside
}

function shape(area: District, x: number, y: number, width: number, depth: number, form: BuildingForm, variant: number) {
  let border: [number, number][] = [[0, 0], [width, 0], [width, depth], [0, depth]]
  if (form === 'arena') {
    border = Array.from({ length: 18 }, (_, i) => {
      const angle = i / 18 * 2 * Math.PI
      return [width * (0.5 + Math.cos(angle) * 0.5), depth * (0.5 + Math.sin(angle) * 0.5)]
    })
  } else if (form === 'campus' || form === 'terrace' && variant > 0.45) {
    border = [[0, 0], [width, 0], [width, depth * 0.48], [width * 0.51, depth * 0.48], [width * 0.51, depth], [0, depth]]
  } else if (form === 'tower' || form === 'block' && variant > 0.58) {
    const cut = Math.min(width, depth) * 0.17
    border = [[cut, 0], [width - cut, 0], [width, cut], [width, depth - cut],
      [width - cut, depth], [cut, depth], [0, depth - cut], [0, cut]]
  }
  return border.map(([dx, dy]) => districtPoint(area, x + dx, y + dy))
}

function polygonArea(outline: Point[]) {
  const area = outline.reduce((sum, a, index) => {
    const b = outline[(index + 1) % outline.length]
    return sum + a.x * b.y - b.x * a.y
  }, 0)
  return Math.abs(area / 2) * unitsToMeters(1) ** 2
}

function buildCityscape(city: City) {
  const buildings: Building[] = []
  const landmarks = city.id === 'marlow' ? marlowLandmarks : []
  const floorsToHeight = (use: BuildingUse, floors: number) =>
    (use === 'industry' || use === 'sports' ? 6.5 : use === 'office' || use === 'retail' ? 3.9 : 3.25) * floors
  const named = landmarks.flatMap((place): Building[] => {
    const area = city.districts.find((district) => district.id === place.district)
    if (!place.building || !area) return []
    const { use, form, width, depth, floors } = place.building
    const origin = { ...area, center: place.point }
    const outline = shape(origin, -width / 2, -depth / 2, width, depth, form, 0)
    return [{ district: area.id, id: place.id, use, form, point: place.point, outline, floors,
      footprint: polygonArea(outline), height: floorsToHeight(use, floors), opensAt: 0.7, tone: 0 }]
  })
  for (const [index, district] of city.districts.entries()) {
    const random = randomSequence(19259 + index * 11497)
    const [rx, ry] = district.radius
    const step = streetSpacing(district)
    for (let u = -rx; u < rx - step * 0.4; u += step) {
      for (let v = -ry; v < ry - step * 0.4; v += step) {
        const warehouseBlock = district.zone === 'industrial' && random() < 0.72
        const landmarkBlock = district.zone === 'office' && random() > 0.37
        const columns = warehouseBlock ? 2 : landmarkBlock ? 3 : 4
        const rows = warehouseBlock ? 1 : 3
        const width = (step - 7) / columns
        const depth = (step - 7) / rows
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
          const x = u + 4 + (column + 0.5) * width
          const y = v + 4 + (row + 0.5) * depth
          const point = districtPoint(district, x, y)
          const offset = districtScore(district, point)
          if (offset > 0.97 || isWater(city, point, 10) ||
              city.districts.some((neighbor) => neighbor !== district && districtScore(neighbor, point) + 0.01 < offset)) continue
          const centrality = clamp(1 - distance(point, { x: 741, y: 501 }) / 754, 0, 1)
          if (random() < (district.zone === 'park' ? 0.79 : 0.05 + 0.34 * offset * (1 - centrality))) continue
          const siting = random()
          let total = 0
          const use = uses[mix[district.zone].findIndex((weight) => (total += weight) >= siting * 100)]
          const peak = district.zone === 'office' ? 1 : district.id === 'harbor' ? 0.78 : centrality * 0.61
          const height = random()
          let floors = use === 'office' ? 4 + Math.floor(25 * peak * height ** 1.15) :
            use === 'mixed' ? 3 + Math.floor((5 + peak * 16) * height) :
            use === 'residential' ? 2 + Math.floor((4 + peak * 11) * height ** 1.65) :
            use === 'retail' ? 1 + Math.floor(4 * height) : use === 'industry' ? 1 + Math.floor(1.8 * height) : 2 + Math.floor(5 * height)
          if (district.id === 'oldTown') floors = Math.min(floors, 2 + Math.floor(3 * random()))
          if (district.zone === 'residential' && (use === 'mixed' || use === 'residential') && random() > 0.93) floors += 7
          const form = use === 'industry' ? 'warehouse' : floors >= 13 ? 'tower' :
            use === 'school' || use === 'hospital' ? 'campus' : district.id === 'oldTown' || floors < 5 && random() > 0.46 ? 'terrace' : 'block'
          const lotWidth = width * (0.5 + 0.38 * random())
          const lotDepth = depth * (0.44 + 0.4 * random())
          const outline = shape(district, x - lotWidth / 2, y - lotDepth / 2, lotWidth, lotDepth, form, random())
          const points = [point, ...outline]
          if (points.some((entry) =>
            isWater(city, entry, 8) || STREET_PARKS.some((park) => withinPolygon(entry, park)) ||
            landmarks.some((place) => place.reserved > 0 && distance(entry, place.point) < place.reserved) ||
            arterialSegments.some(({ start, end }) =>
              Math.min(start.x, end.x) - 6 <= entry.x && entry.x <= Math.max(start.x, end.x) + 6 &&
              Math.min(start.y, end.y) - 6 <= entry.y && entry.y <= Math.max(start.y, end.y) + 6 &&
              segmentDistance(entry, start, end) < 6))) continue
          const timing = random()
          buildings.push({ id: district.id + '-' + buildings.length, district: district.id,
            point, outline, use, form, floors, footprint: polygonArea(outline), height: floorsToHeight(use, floors),
            opensAt: timing < 0.07 ? 1.08 : timing < 0.14 ? 1.024 : timing < 0.89 ? 0.7 : 0.83,
            tone: random() > 0.58 ? 1 : 0 })
        }
      }
    }
  }
  return { buildings: buildings.concat(named), landmarks }
}

const geometry = new WeakMap<City, ReturnType<typeof buildCityscape>>()
export function cityscape(city: City) {
  const existing = geometry.get(city)
  if (existing) return existing
  const generated = buildCityscape(city)
  geometry.set(city, generated)
  return generated
}

export const buildingIsOpen = (building: Building, factor: number) => factor + 1e-7 >= building.opensAt

function capacities(building: Building) {
  const area = building.footprint * building.floors
  const { use } = building
  return {
    residents: area * (use === 'mixed' ? 0.57 : use === 'residential' ? 1 : 0) / 61,
    jobs: area * ({ residential: 0.015, mixed: 0.51, office: 1, retail: 0.76, industry: 0.22, school: 0.32, hospital: 0.86, sports: 0.063 }[use]) / 75,
    visits: area * ({ residential: 0.004, mixed: 0.3, office: 0.016, retail: 1, industry: 0.006, school: 0.08, hospital: 0.43, sports: 1.05 }[use]) / 101,
    students: use === 'school' ? area / 29 : 0,
  }
}

interface ActivityFactors { residents: number; jobs: number; visits: number }
interface DistrictActivity extends ActivityFactors {
  students: number
  buildings: number
  use: Record<BuildingUse, number>
}

function totals(city: City) {
  const buildings = cityscape(city).buildings
  const established = city.districts.filter((district) => district.opens === 1)
  const sites = new Set(established.map((district) => district.id))
  const base = buildings.filter((building) => sites.has(building.district) && buildingIsOpen(building, 1))
    .reduce((sum, building) => {
      const value = capacities(building)
      return { residents: sum.residents + value.residents, jobs: sum.jobs + value.jobs, visits: sum.visits + value.visits }
    }, { residents: 0, jobs: 0, visits: 0 })
  const factor = {
    residents: established.reduce((sum, district) => sum + district.residents, 0) / Math.max(1, base.residents),
    jobs: established.reduce((sum, district) => sum + district.jobs, 0) / Math.max(1, base.jobs),
    visits: established.reduce((sum, district) => sum + district.visitors, 0) / Math.max(1, base.visits),
  }
  return { factor, districts: new Map<string, Building[]>(city.districts.map((district) =>
    [district.id, buildings.filter((building) => building.district === district.id)])),
    profiles: new Map<string, { growth: number; value: DistrictActivity }>() }
}

const districtCities = new WeakMap<City, ReturnType<typeof totals>>()
function districtProfile(city: City, buildings: Building[], growth: number, factor: ActivityFactors, id: string): DistrictActivity {
  const result = { residents: 0, jobs: 0, visits: 0, students: 0, buildings: 0,
    use: Object.fromEntries(uses.map((use) => [use, 0])) as Record<BuildingUse, number> }
  if (!growth) return result
  for (const building of buildings) {
    if (!buildingIsOpen(building, growth)) continue
    const value = capacities(building)
    result.buildings++
    result.use[building.use]++
    result.residents += value.residents * factor.residents * growth
    result.jobs += value.jobs * factor.jobs * growth
    result.visits += value.visits * factor.visits * growth
    result.students += value.students * growth
  }
  if (city.id === 'marlow' && id === 'park') result.visits += 2200 * growth
  return result
}

export function districtActivity(city: City, id: string, growth: number) {
  const data = districtCities.get(city) ?? totals(city)
  districtCities.set(city, data)
  const existing = data.profiles.get(id)
  if (existing?.growth === growth) return existing.value
  const profile = districtProfile(city, data.districts.get(id) ?? [], growth, data.factor, id)
  data.profiles.set(id, { growth, value: profile })
  return profile
}

export function placeName(city: City, point: Point, district: District, growth: Record<string, number>) {
  const landmarks = cityscape(city).landmarks.filter((place) => growth[place.district] > 0 &&
    distance(point, place.point) <= place.reach && walkDistance(city, point, place.point) <= place.reach * 1.14)
  for (const type of ['facility', 'square', 'street'] as const) {
    const matches = landmarks.filter((place) => place.type === type)
      .sort((a, b) => distance(point, a.point) - distance(point, b.point))
    if (matches.length) return { key: 'landmark.' + matches[0].id, center: matches[0].point }
  }
  return { key: 'district.' + district.id, center: district.center }
}
