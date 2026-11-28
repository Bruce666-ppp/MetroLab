import type { TFunction } from 'i18next'
import { dayNumber, districtAt, getCity, minuteOfDay } from '../engine/city.ts'
import { placeName } from '../engine/cityscape.ts'
import { hongKongName } from '../engine/hongKong.ts'
import type { BilingualName, District, GameState, Line, Point, Station } from '../engine/types.ts'

const formatters = new Map<string, Intl.NumberFormat>()
function numberFormat(locale: string, kind: 'number' | 'percent' | 'money' | 'compact', currency = 'USD') {
  const key = locale + kind + currency
  const existing = formatters.get(key)
  if (existing) return existing
  const options: Intl.NumberFormatOptions = {
    number: { maximumFractionDigits: 1 },
    percent: { style: 'percent', maximumFractionDigits: 0 },
    compact: { style: 'currency', currency, currencyDisplay: currency === 'HKD' ? 'code' : 'symbol', notation: 'compact', maximumFractionDigits: 2 },
    money: { style: 'currency', currency, currencyDisplay: currency === 'HKD' ? 'code' : 'symbol', maximumFractionDigits: 0 },
  }[kind] as Intl.NumberFormatOptions
  const formatter = new Intl.NumberFormat(locale, options)
  formatters.set(key, formatter)
  return formatter
}

export function number(n: number, locale: string) {
  return numberFormat(locale, 'number').format(n)
}

export function curveRadiusText(radius: number, limit: number, locale: string) {
  const digits = radius < limit && Math.round(radius) >= limit ? Math.max(1, Math.ceil(-Math.log10(limit - radius))) : 0
  return digits ? radius.toLocaleString(locale, { maximumFractionDigits: digits }) : number(Math.round(radius), locale)
}
export function percent(n: number | undefined, locale: string) {
  return n === undefined ? '—' : numberFormat(locale, 'percent').format(n)
}
export function gameMoney(game: GameState, n: number, locale: string, compact = true) {
  return numberFormat(locale, compact ? 'compact' : 'money', game.hongKong ? 'HKD' : 'USD').format(n)
}
export const localizedName = (names: BilingualName, t: TFunction) => t('app.languageCode') === 'zh-HK' ? names.zh : names.en
export const districtLabel = (area: District, t: TFunction) => area.names ? localizedName(area.names, t) : t('district.' + area.id)
function stationPlace(game: GameState, position: Point) {
  const city = getCity(game.cityId)
  const area = districtAt(city, position).area
  return placeName(city, position, area, game.growth)
}

const nameCache = new WeakMap<Station[], { growth: GameState['growth']; places: Map<string, ReturnType<typeof stationPlace>> }>()

export function stationNameAt(game: GameState, position: Point, t: TFunction, stations = game.stations) {
  if (game.hongKong) return localizedName(hongKongName(position, stations), t)
  return t(stationPlace(game, position).key)
}

export function stationLabel(game: GameState, station: Station, t: TFunction) {
  if (station.names) return localizedName(station.names, t)
  if (station.name) return station.name
  let cached = nameCache.get(game.stations)
  if (cached?.growth !== game.growth) {
    cached = { growth: game.growth, places: new Map(game.stations.map((entry) => [entry.id, stationPlace(game, entry.position)])) }
    nameCache.set(game.stations, cached)
  }
  const place = cached.places.get(station.id) ?? stationPlace(game, station.position)
  const base = t(place.key)
  const duplicates = game.stations.filter((entry) => !entry.name && cached.places.get(entry.id)?.key === place.key)
  if (duplicates[0]?.id === station.id || duplicates.length === 0) return base
  const direction = (entry: Station) => {
    const x = entry.position.x - place.center.x
    const y = entry.position.y - place.center.y
    return Math.abs(x) > Math.abs(y) ? x >= 0 ? 'east' : 'west' : y >= 0 ? 'south' : 'north'
  }
  const name = t('station.directional', { district: base, direction: t('station.' + direction(station)) })
  const rank = duplicates.slice(1).filter((entry) => direction(entry) === direction(station)).findIndex((entry) => entry.id === station.id)
  return rank > 0 ? t('station.numbered', { district: name, number: rank + 1 }) : name
}
export const lineCode = (line: Pick<Line, 'number'>) => 'M' + line.number
export function lineLabel(line: Line, t: TFunction, example = false, game?: GameState) {
  if (line.name) return line.name
  if (example) return t('sample.line' + line.number)
  if (line.automaticName && game) {
    const head = game.stations.find((station) => station.id === line.stops[0])
    const tail = game.stations.find((station) => station.id === line.stops.at(-1))
    if (head && tail) return t(line.circular ? 'line.loopName' : 'line.corridorName', {
      from: stationLabel(game, head, t), to: stationLabel(game, tail, t),
    })
  }
  return t('line.defaultName', { number: line.number })
}
export const trainCode = (train: { number: number }) => 'T' + String(train.number).padStart(2, '0')

export function timeLabel(minute: number) {
  const hour = Math.floor(minuteOfDay(minute) / 60)
  const part = Math.floor(minuteOfDay(minute) % 60)
  return String(hour).padStart(2, '0') + ':' + String(part).padStart(2, '0')
}
export function dayLabel(minute: number, t: TFunction) {
  return t('clock.day', { day: dayNumber(minute) })
}
export function weekdayLabel(minute: number, t: TFunction) {
  return t('clock.weekday' + ((dayNumber(minute) - 1) % 7))
}
