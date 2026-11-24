import { districtPoint } from '../engine/city.ts'
import { bridgeEnds, isWater, pathString } from '../engine/geometry.ts'
import type { City, District, Point } from '../engine/types.ts'

interface DistrictDrawing {
  id: string
  land: string
  roads: string
  lanes: string
  buildings: [string, string, string]
  expansion: [string, string]
}

const polygon = (pairs: [number, number][]) => pathString(pairs.map(([x, y]) => ({ x, y })), true)
const polyline = (pairs: [number, number][]) => pathString(pairs.map(([x, y]) => ({ x, y })))

export const backgroundGreens = [
  polygon([[-90, -40], [219, -40], [251, 60], [197, 110], [176, 256], [104, 298], [15, 267], [-90, 298]]),
  polygon([[1210, -35], [1590, -35], [1590, 111], [1450, 125], [1336, 95], [1233, 61]]),
  polygon([[-88, 652], [129, 689], [145, 791], [217, 871], [303, 920], [322, 1034], [-88, 1034]]),
  polygon([[1200, 978], [1236, 927], [1355, 901], [1408, 825], [1540, 797], [1550, 1030], [1194, 1030]]),
]

export const parkLand = [
  polygon([[140, 618], [186, 569], [300, 548], [363, 574], [400, 620], [399, 673], [369, 729], [303, 774], [231, 776], [166, 737], [132, 689]]),
  polygon([[648, 312], [673, 264], [698, 265], [722, 317], [759, 333], [764, 360], [738, 386], [698, 386], [653, 364]]),
  polygon([[451, 219], [492, 220], [515, 244], [501, 279], [461, 278], [438, 248]]),
  polygon([[1135, 254], [1184, 240], [1247, 255], [1252, 300], [1223, 327], [1178, 309], [1142, 291]]),
  polygon([[1198, 516], [1230, 512], [1251, 553], [1237, 591], [1196, 597], [1177, 561]]),
  polygon([[824, 812], [854, 769], [880, 752], [903, 777], [892, 822], [870, 859], [827, 869], [807, 849]]),
  polygon([[501, 690], [552, 695], [578, 725], [567, 763], [509, 768], [470, 745], [470, 718]]),
  polygon([[738, 691], [755, 663], [798, 655], [812, 691], [796, 724], [754, 735]]),
]

export const parkTrails = [
  'M158 661Q222 595 297 596T389 645M205 755Q246 702 289 701T376 699M242 606Q253 644 319 655T351 734',
  'M669 315Q705 335 751 345M706 287L705 372',
  'M1190 258L1188 300 1233 309M1203 529Q1227 550 1210 584',
  'M832 850Q867 828 879 776M484 735L557 712',
]

export const lake = 'M204 670Q226 644 261 653Q278 658 268 676Q256 693 264 707Q252 727 226 714Q211 710 206 697Q197 684 204 670Z'

export const mainRoads = [
  polyline([[-30, 491], [132, 476], [230, 456], [325, 435], [433, 427], [531, 415], [636, 437], [728, 471], [800, 485], [887, 450]]),
  polyline([[172, -28], [235, 96], [279, 178], [317, 263], [319, 383], [325, 435], [360, 496], [417, 544], [470, 608], [514, 700], [535, 813], [588, 1007]]),
  polyline([[557, -30], [553, 69], [543, 158], [558, 237], [552, 322], [531, 415], [544, 516], [579, 594], [640, 637], [727, 680], [810, 714], [899, 735]]),
  polyline([[96, 306], [216, 288], [317, 263], [444, 245], [558, 237], [658, 221], [762, 240], [869, 252], [917, 269]]),
  polyline([[715, -34], [766, 91], [763, 197], [762, 240], [792, 332], [774, 416], [728, 471], [738, 561], [727, 680], [708, 782], [663, 900], [646, 998]]),
  polyline([[891, 275], [914, 312], [842, 380], [823, 437], [853, 507], [857, 554], [816, 632], [810, 714], [761, 779], [720, 835], [675, 855], [535, 813], [371, 855], [263, 907], [0, 910]]),
  polyline([[1088, -19], [1162, 109], [1148, 200], [1122, 265], [1087, 333], [1034, 404], [1069, 483], [1090, 580], [1121, 644], [1120, 735], [1051, 815], [991, 911], [976, 1018]]),
  polyline([[1510, 315], [1402, 304], [1286, 296], [1205, 320], [1087, 333], [1029, 312], [1007, 232], [1072, 211], [1148, 200], [1267, 184], [1343, 201], [1460, 186]]),
  polyline([[1510, 480], [1408, 479], [1285, 485], [1190, 470], [1069, 483], [1003, 468], [981, 417], [1034, 404]]),
  polyline([[1510, 676], [1385, 655], [1266, 646], [1121, 644], [1051, 605], [1021, 569], [1090, 580], [1208, 561], [1289, 552], [1381, 560], [1510, 583]]),
  polyline([[1327, -15], [1333, 106], [1343, 201], [1286, 296], [1302, 385], [1285, 485], [1289, 552], [1266, 646], [1261, 738], [1317, 807], [1327, 987]]),
  polyline([[1510, 838], [1410, 830], [1317, 807], [1212, 812], [1051, 815], [990, 796], [919, 790], [904, 771], [965, 728], [1012, 710], [1120, 735]]),
  polyline([[764, 904], [826, 888], [893, 877], [991, 911], [1188, 894], [1324, 911], [1510, 897]]),
]

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
  const step = district.zone === 'industrial' ? 41 : district.zone === 'residential' ? 28 : 32
  const parks = district.zone === 'park'
  const roads: string[] = []
  const lanes: string[] = []
  const buildings: [string[], string[], string[]] = [[], [], []]
  const expansion: [string[], string[]] = [[], []]
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
  for (let u = -rx + 4; u < rx - 12; u += step) {
    for (let v = -ry + 4; v < ry - 12; v += step) {
      const rows = district.zone === 'industrial' ? 1 : 2
      for (let slot = 0; slot < rows * 2; slot++) {
        if (random() < (parks ? 0.94 : 0.14)) continue
        const left = u + (slot % 2) * (step / 2) + random() * 2
        const top = v + Math.floor(slot / 2) * (step / 2) + random() * 3
        const width = (step / 2 - 5) * (0.58 + random() * 0.49)
        const height = (step / rows - 9) * (0.64 + random() * 0.4)
        if (((left + width * 0.5) / rx) ** 2 + ((top + height * 0.5) / ry) ** 2 > 0.94) continue
        const corners = [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
          .map(([x, y]) => districtPoint(district, x, y))
        if (corners.some((point) => isWater(city, point, 7))) continue
        const path = pathString(corners, true)
        const threshold = random()
        if (threshold < 0.13) expansion[0].push(path)
        else if (threshold < 0.24) expansion[1].push(path)
        else buildings[Math.floor(random() * 3)].push(path)
      }
    }
  }
  return {
    id: district.id, land: pathString(land, true), roads: roads.join(''), lanes: lanes.join(''),
    buildings: buildings.map((paths) => paths.join('')) as DistrictDrawing['buildings'],
    expansion: expansion.map((paths) => paths.join('')) as DistrictDrawing['expansion'],
  }
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
