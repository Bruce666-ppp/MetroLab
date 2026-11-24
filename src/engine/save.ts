import { citiesList } from './city.ts'
import { blankTotals } from './economy.ts'
import { SAVE_VERSION } from './simulation.ts'
import type { GameState, Layer } from './types.ts'

export const SAVE_KEY = 'metrolab.save'
export const SETTINGS_KEY = 'metrolab.settings'
export const layers: Layer[] = ['standard', 'population', 'demand', 'coverage', 'congestion', 'accessibility']
export type Locale = 'en' | 'zh-CN'
export interface Settings { language: Locale; layer: Layer; guides: boolean }
export interface SaveSlot { savedAt: string; game: GameState }

type StorageIO = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function detectLanguage(browserLanguage?: string): Locale {
  return browserLanguage?.toLowerCase().split('-')[0] === 'zh' ? 'zh-CN' : 'en'
}

export function getSettings(storage: StorageIO, browserLanguage?: string): Settings {
  const defaults: Settings = { language: detectLanguage(browserLanguage), layer: 'standard', guides: true }
  try {
    const value = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null')
    if (!value) return defaults
    return {
      language: value.language === 'en' || value.language === 'zh-CN' ? value.language : defaults.language,
      layer: layers.includes(value.layer) ? value.layer : defaults.layer,
      guides: typeof value.guides === 'boolean' ? value.guides : defaults.guides,
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

function validGame(game: GameState) {
  if (!citiesList.some((city) => city.id === game.cityId) || !['career', 'sandbox'].includes(game.mode) ||
      !Number.isFinite(game.funds) || !Number.isFinite(game.minute) || game.minute < 0 ||
      !Number.isInteger(game.nextId) || game.nextId < 1 ||
      !Array.isArray(game.stations) || !Array.isArray(game.lines) || !Array.isArray(game.trains) ||
      !Array.isArray(game.egress) || !Array.isArray(game.history) || !Array.isArray(game.milestones) ||
      !game.today || !game.lifetime || !game.queues || !game.growth || !game.carry || !game.districtDemand ||
      !Number.isFinite(game.hourArrivals) || !Number.isFinite(game.hourBalance)) return false
  const stationIds = new Set(game.stations.map((station) => station.id))
  const knownLines = new Map(game.lines.map((line) => [line.id, line]))
  return stationIds.size === game.stations.length && knownLines.size === game.lines.length &&
    game.stations.every((station) => Number.isFinite(station.position?.x) && Number.isFinite(station.position?.y) &&
      [1, 2, 3].includes(station.level) && typeof station.name === 'string') &&
    game.lines.every((line) => Array.isArray(line.stops) && line.stops.length >= (line.circular ? 3 : 2) &&
      new Set(line.stops).size === line.stops.length && line.stops.every((id) => stationIds.has(id)) &&
      typeof line.name === 'string' && /^#[a-f\d]{6}$/i.test(line.color) && Number.isFinite(line.releaseAt) &&
      Number.isFinite(line.headway) && line.headway > 0) &&
    game.trains.every((train) => knownLines.has(train.lineId) && Number.isInteger(train.at) && train.at >= 0 &&
      train.at < knownLines.get(train.lineId)!.stops.length && train.capacity > 0 && train.speed > 0 &&
      Array.isArray(train.loads) && Number.isFinite(train.duration) && Number.isFinite(train.remaining))
}

export function loadGame(storage: StorageIO): SaveSlot | undefined {
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return undefined
    const slot = JSON.parse(raw)
    if (!slot?.game || !Number.isFinite(Date.parse(slot.savedAt))) return undefined
    if (slot.game.version === 1) {
      slot.game = {
        ...slot.game, version: SAVE_VERSION, districtDemand: slot.game.districtDemand ?? {},
        hourBalance: slot.game.hourBalance ?? 0, hourArrivals: slot.game.hourArrivals ?? 0,
        today: { ...blankTotals(), ...slot.game.today }, lifetime: { ...blankTotals(), ...slot.game.lifetime },
      }
    }
    if (slot.game.version !== SAVE_VERSION || !validGame(slot.game)) return undefined
    slot.game.stationActivity ??= {}
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
