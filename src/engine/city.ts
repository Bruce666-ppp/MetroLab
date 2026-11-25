import { cityscape, districtActivity } from './cityscape.ts'
import { clamp, distance, isWater } from './geometry.ts'
import { districtPoint, districtScore } from './geography.ts'
import type { City, District, GameState, Point, Zone } from './types.ts'

const district = (
  id: string, x: number, y: number, rx: number, ry: number, angle: number, zone: Zone,
  residents: number, jobs: number, visitors: number, opens = 1, label?: Point,
): District => ({ id, center: { x, y }, radius: [rx, ry], angle, zone, residents, jobs, visitors, opens, label })

const riverControl = [1107, 1077, 980, 884, 893, 946, 973, 911, 820, 739, 689]

function riverAt(y: number) {
  const t = clamp(y / 98, 0, 10)
  const i = Math.min(9, Math.floor(t))
  const f = t - i
  const a = riverControl[Math.max(0, i - 1)]
  const b = riverControl[i]
  const c = riverControl[i + 1]
  const d = riverControl[Math.min(10, i + 2)]
  const center = b + 0.5 * f * ((c - a) + f * ((2 * a - 5 * b + 4 * c - d) + f * (3 * b - a - 3 * c + d)))
  return { center, halfWidth: 39 + 13 * Math.sin(y / 125 + 0.4) + 19 * Math.pow(y / 980, 2) }
}

const marlow: City = {
  id: 'marlow',
  width: 1500,
  height: 980,
  river: riverAt,
  bridges: [{ y: 250, tilt: -17 }, { y: 432, tilt: -15 }, { y: 567, tilt: 10 }, { y: 724, tilt: -15 }, { y: 876, tilt: 11 }],
  districts: [
    district('northfields', 317, 180, 150, 115, -0.13, 'residential', 12400, 1250, 380),
    district('cedar', 543, 163, 145, 110, 0.11, 'residential', 11500, 1800, 450),
    district('university', 744, 268, 145, 114, -0.17, 'civic', 6100, 4450, 2800, 1, { x: 731, y: 230 }),
    district('northQuay', 1109, 204, 145, 110, 0.15, 'waterfront', 3800, 2750, 4300),
    district('quarry', 1335, 203, 115, 90, -0.12, 'residential', 9700, 2800, 1050, 5),
    district('westend', 295, 418, 152, 133, 0.06, 'residential', 15300, 2400, 780, 1, { x: 275, y: 368 }),
    district('oldTown', 522, 397, 130, 108, -0.21, 'commercial', 6900, 9400, 3900, 1, { x: 510, y: 338 }),
    district('harbor', 1052, 389, 120, 105, -0.14, 'commercial', 5400, 7400, 5200, 1, { x: 1080, y: 333 }),
    district('eastbank', 1295, 475, 148, 141, 0.13, 'residential', 13300, 1900, 700, 1, { x: 1302, y: 410 }),
    district('central', 747, 510, 140, 127, 0.1, 'office', 5700, 19000, 2550, 1, { x: 741, y: 454 }),
    district('market', 503, 612, 140, 120, 0.16, 'commercial', 8500, 8100, 4900, 1, { x: 515, y: 661 }),
    district('park', 292, 662, 163, 126, -0.17, 'park', 950, 350, 5650, 1, { x: 276, y: 685 }),
    district('docklands', 1128, 660, 141, 134, -0.17, 'industrial', 2500, 9800, 800, 1, { x: 1160, y: 620 }),
    district('hillview', 525, 824, 160, 110, -0.15, 'residential', 10900, 1200, 1050),
    district('southbank', 953, 824, 125, 113, 0.19, 'civic', 3350, 6100, 3200, 1, { x: 949, y: 878 }),
    district('meadow', 1307, 824, 116, 107, 0.18, 'residential', 8600, 2600, 1950, 9),
  ],
  tripSamples: new Map(),
}

for (const area of marlow.districts) {
  const localLots = cityscape(marlow).buildings.filter((building) => building.district === area.id && building.opensAt <= 0.83)
  const samples = [[0, 0], [-0.36, -0.43], [0.36, -0.43], [-0.44, 0.36], [0.44, 0.36], [0, -0.65], [0, 0.66], [-0.68, 0], [0.68, 0]]
  marlow.tripSamples.set(area.id, samples
    .map(([u, v]) => districtPoint(area, u * area.radius[0], v * area.radius[1]))
    .filter((point) => !isWater(marlow, point, 4))
    .map((point) => {
      const closest = localLots.reduce((best, lot) =>
        distance(lot.point, point) < distance(best, point) ? lot.point : best, { x: Infinity, y: Infinity })
      return distance(closest, point) < 38 ? closest : point
    }))
}

const cities: Record<string, City> = { [marlow.id]: marlow }
export const citiesList = Object.values(cities)

export function getCity(id: string) {
  return cities[id] ?? marlow
}

export function districtAt(city: City, point: Point) {
  let nearest = city.districts[0]
  let best = Infinity
  for (const area of city.districts) {
    const score = districtScore(area, point)
    if (score < best) {
      nearest = area
      best = score
    }
  }
  return { area: nearest, score: best }
}

export const dayNumber = (minute: number) => Math.floor(minute / 1440) + 1
export const minuteOfDay = (minute: number) => minute % 1440
export const isWeekend = (minute: number) => (dayNumber(minute) - 1) % 7 >= 5

export function populationOf(area: District, game: GameState) {
  return Math.round(activityOf(area, game).residents)
}

export function jobsOf(area: District, game: GameState) {
  return Math.round(activityOf(area, game).jobs)
}

export function activityOf(area: District, game: GameState) {
  return districtActivity(getCity(game.cityId), area.id, game.growth[area.id] ?? 0)
}

export function developCity(city: City, game: GameState, accessibility: Record<string, number>) {
  const day = dayNumber(game.minute)
  for (const area of city.districts) {
    if (day < area.opens) continue
    const previous = game.growth[area.id]
    game.growth[area.id] = previous
      ? Math.min(2.45, previous * (1.004 + 0.012 * (accessibility[area.id] ?? 0)))
      : 0.73
  }
}
