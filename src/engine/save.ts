import { citiesList } from './city.ts'
import { headAnchor, legacyTrack, tailAnchor } from './alignment.ts'
import { blankTotals, HKD, trackMethods } from './economy.ts'
import { distance } from './geometry.ts'
import { HONG_KONG } from './hongKong.ts'
import { pairsOf } from './network.ts'
import { resolveRails, synchronizeRails } from './rails.ts'
import { blankOperations, SAVE_VERSION } from './simulation.ts'
import { pieceLength, pointOnPiece } from './track.ts'
import type { GameState, Layer, Point, TrackSection } from './types.ts'

export const SAVE_KEY = 'metrolab.save'
export const SETTINGS_KEY = 'metrolab.settings'
export const layers: Layer[] = ['standard', 'population', 'employment', 'demand', 'coverage', 'flow', 'congestion', 'accessibility', 'engineering']
export type Locale = 'en' | 'zh-HK'
export interface Settings { language: Locale; layer: Layer; guides: boolean; view?: 'city' | 'plan' }
export interface SaveSlot { savedAt: string; game: GameState }

type StorageIO = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function detectLanguage(browserLanguage?: string): Locale {
  return browserLanguage?.toLowerCase().split('-')[0] === 'zh' ? 'zh-HK' : 'en'
}

export function getSettings(storage: StorageIO, browserLanguage?: string): Settings {
  const defaults: Settings = { language: detectLanguage(browserLanguage), layer: 'standard', guides: true }
  try {
    const value = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null')
    if (!value) return defaults
    return {
      language: value.language === 'en' ? 'en' : value.language === 'zh-HK' || value.language === 'zh-CN' ? 'zh-HK' : defaults.language,
      layer: layers.includes(value.layer) ? value.layer : defaults.layer,
      guides: typeof value.guides === 'boolean' ? value.guides : defaults.guides,
      ...(value.view === 'city' || value.view === 'plan' ? { view: value.view } : {}),
    }
  } catch {
    return defaults
  }
}

export function saveSettings(storage: StorageIO, settings: Settings) {
  return write(storage, SETTINGS_KEY, settings)
}

function write(storage: StorageIO, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function saveGame(storage: StorageIO, game: GameState, at = new Date()) {
  const slot = { savedAt: at.toISOString(), game }
  return write(storage, SAVE_KEY, slot) ? slot : undefined
}

const validPoint = (point: Point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)

function validSection(section: TrackSection, from: string, to: string, start?: Point, end?: Point) {
  return section.from === from && section.to === to && Array.isArray(section.controls) && section.controls.every(validPoint) &&
    (!section.method || trackMethods.includes(section.method)) && Array.isArray(section.pieces) && section.pieces.length > 0 &&
    section.pieces.every((piece, i) => {
      if (!validPoint(piece?.from) || !validPoint(piece?.to) || (piece.method && !trackMethods.includes(piece.method)) ||
          i > 0 && distance(piece.from, section.pieces[i - 1].to) > 0.012) return false
      if (piece.kind === 'straight') return pieceLength(piece) > 0
      if (piece.kind !== 'arc' || !validPoint(piece.center) || !Number.isFinite(piece.radius) || !Number.isFinite(piece.sweep) ||
          piece.radius <= 0 || Math.abs(piece.sweep) > Math.PI * 2 || piece.sweep === 0) return false
      return Math.abs(distance(piece.from, piece.center) - piece.radius) < 1e-5 && distance(pointOnPiece(piece, 1 - 1e-8), piece.to) < 0.0002
    }) && (!start || distance(section.pieces[0].from, start) <= 0.012) &&
    (!end || distance(section.pieces.at(-1)!.to, end) <= 0.012)
}

function validGame(game: GameState, requireTrack: boolean) {
  if (!citiesList.some((city) => city.id === game.cityId) || !['career', 'sandbox'].includes(game.mode) ||
      !Number.isFinite(game.funds) || !Number.isFinite(game.minute) || game.minute < 0 ||
      !Number.isInteger(game.nextId) || game.nextId < 1 ||
      !Array.isArray(game.stations) || !Array.isArray(game.lines) || !Array.isArray(game.trains) ||
      !Array.isArray(game.egress) || !Array.isArray(game.history) || !Array.isArray(game.milestones) ||
      !game.today || !game.lifetime || !game.queues || !game.growth || !game.carry || !game.districtDemand ||
      !Number.isFinite(game.hourArrivals) || !Number.isFinite(game.hourBalance)) return false
  const stationIds = new Map(game.stations.map((station) => [station.id, station]))
  const knownLines = new Map(game.lines.map((line) => [line.id, line]))
  const hongKong = game.cityId === HONG_KONG
  return stationIds.size === game.stations.length && knownLines.size === game.lines.length &&
    game.stations.every((station) => Number.isFinite(station.position?.x) && Number.isFinite(station.position?.y) &&
      [1, 2, 3].includes(station.level) && typeof station.name === 'string' &&
      (!hongKong || typeof station.names?.en === 'string' && typeof station.names.zh === 'string' && trackMethods.includes(station.method!))) &&
    game.lines.every((line) => Array.isArray(line.stops) && (line.stops.length >= (line.circular ? 3 : 2) ||
      hongKong && !line.circular && Boolean(line.openEnds?.head || line.openEnds?.tail)) &&
      new Set(line.stops).size === line.stops.length && line.stops.every((id) => stationIds.has(id)) &&
      typeof line.name === 'string' && /^#[a-f\d]{6}$/i.test(line.color) && Number.isFinite(line.releaseAt) &&
      Number.isFinite(line.headway) && line.headway > 0 &&
      (!hongKong || line.fare === undefined || Number.isInteger(line.fare) && line.fare >= HKD.minimumFare && line.fare <= HKD.maximumFare)) &&
    (!requireTrack || game.lines.every((line) => {
      const pairs = pairsOf(line.stops, line.circular)
      const head = line.openEnds?.head, tail = line.openEnds?.tail
      const first = line.stops[0], last = line.stops.at(-1)
      return (!(head || tail) || hongKong && !line.circular) &&
        (!head || validSection(head, headAnchor, first ?? tailAnchor, undefined, first ? stationIds.get(first)!.position : undefined)) &&
        (!tail || Boolean(last && validSection(tail, last, tailAnchor, stationIds.get(last)!.position))) &&
        Array.isArray(line.track) && line.track.length === pairs.length && line.track.every((section, index) => {
        const [from, to] = pairs[index]
        return validSection(section, from, to, stationIds.get(from)!.position, stationIds.get(to)!.position)
      })
    })) &&
    game.trains.every((train) => knownLines.has(train.lineId) && Number.isInteger(train.at) && train.at >= 0 &&
      knownLines.get(train.lineId)!.stops.length >= 2 && train.at < knownLines.get(train.lineId)!.stops.length && train.capacity > 0 && train.speed > 0 &&
      Array.isArray(train.loads) && Number.isFinite(train.duration) && Number.isFinite(train.remaining))
}

function restoreRails(game: GameState) {
  const infrastructure = game.infrastructure
  if (!infrastructure || Array.isArray(infrastructure) || !Object.entries(infrastructure).every(([id, section]) =>
    /^track-\d+$/.test(id) && typeof section?.from === 'string' && typeof section.to === 'string' && !section.rails &&
    validSection(section, section.from, section.to))) return false
  const restore = (section: TrackSection) => Array.isArray(section.rails) && section.rails.every((rail) =>
    typeof rail?.id === 'string' && (rail.direction === 1 || rail.direction === -1))
    ? resolveRails(infrastructure, section.rails, section.from, section.to) : undefined
  for (const line of game.lines) {
    const track = line.track.map(restore)
    if (track.some((section) => !section)) return false
    line.track = track as TrackSection[]
    for (const side of ['head', 'tail'] as const) {
      const section = line.openEnds?.[side]
      if (!section) continue
      const restored = restore(section)
      if (!restored) return false
      line.openEnds![side] = restored
    }
  }
  return validGame(game, true)
}

export function loadGame(storage: StorageIO): SaveSlot | undefined {
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return undefined
    const slot = JSON.parse(raw)
    if (!slot?.game || !Number.isFinite(Date.parse(slot.savedAt))) return undefined
    if (slot.game.version === 1) {
      slot.game = {
        ...slot.game, version: 2, districtDemand: slot.game.districtDemand ?? {},
        hourBalance: slot.game.hourBalance ?? 0, hourArrivals: slot.game.hourArrivals ?? 0,
        today: { ...blankTotals(), ...slot.game.today }, lifetime: { ...blankTotals(), ...slot.game.lifetime },
      }
    }
    if (slot.game.version === 2 && validGame(slot.game, false)) {
      const game = slot.game as GameState
      game.lines = game.lines.map((line) => ({ ...line, track: legacyTrack(game.stations, line) }))
      game.version = 4
    }
    if (slot.game.version === 3) slot.game.version = 4
    if ((slot.game.version !== 4 && slot.game.version !== SAVE_VERSION) || !validGame(slot.game, true)) return undefined
    slot.game.stationActivity ??= {}
    if (slot.game.cityId === HONG_KONG) {
      const game = slot.game as GameState
      game.hongKong ??= blankOperations()
      if (game.version === 4) {
        game.infrastructure = {}
        for (const line of game.lines) {
          for (const section of line.track) delete section.rails
          for (const section of Object.values(line.openEnds ?? {})) if (section) delete section.rails
        }
        synchronizeRails(game)
        for (const station of game.stations) if (game.lines.filter((line) => line.stops.includes(station.id)).length > 1) station.interchange = true
      } else if (!restoreRails(game)) return undefined
    }
    slot.game.version = SAVE_VERSION
    return slot as SaveSlot
  } catch {
    return undefined
  }
}

export function clearGame(storage: StorageIO) {
  try {
    storage.removeItem(SAVE_KEY)
    return true
  } catch {
    return false
  }
}

export function readBrowserStorage(): StorageIO {
  try {
    return window.localStorage
  } catch {
    return {
      getItem: () => null,
      setItem: () => { throw new Error('Local storage unavailable') },
      removeItem: () => { throw new Error('Local storage unavailable') },
    }
  }
}
