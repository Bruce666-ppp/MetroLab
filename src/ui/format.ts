import type { TFunction } from 'i18next'
import { dayNumber, minuteOfDay } from '../engine/city.ts'
import type { GameState, Line, Station } from '../engine/types.ts'

const formatters = new Map<string, Intl.NumberFormat>()
function numberFormat(locale: string, kind: 'number' | 'percent' | 'money' | 'compact') {
  const key = locale + kind
  const existing = formatters.get(key)
  if (existing) return existing
  const options: Intl.NumberFormatOptions = {
    number: { maximumFractionDigits: 1 },
    percent: { style: 'percent', maximumFractionDigits: 0 },
    compact: { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 },
    money: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
  }[kind] as Intl.NumberFormatOptions
  const formatter = new Intl.NumberFormat(locale, options)
  formatters.set(key, formatter)
  return formatter
}

export function number(n: number, locale: string) {
  return numberFormat(locale, 'number').format(n)
}
export function percent(n: number | undefined, locale: string) {
  return n === undefined ? '—' : numberFormat(locale, 'percent').format(n)
}
export function money(n: number, locale: string, compact = true) {
  return numberFormat(locale, compact ? 'compact' : 'money').format(n)
}
export function stationLabel(game: GameState, station: Station, t: TFunction) {
  if (station.name) return station.name
  const sameDistrict = game.stations.filter((entry) => entry.district === station.district)
  const district = t('district.' + station.district)
  const index = sameDistrict.findIndex((entry) => entry.id === station.id)
  return index > 0 ? t('station.numbered', { district, number: index + 1 }) : district
}
export const lineCode = (line: Pick<Line, 'number'>) => 'M' + line.number
export function lineLabel(line: Line, t: TFunction, example = false) {
  return line.name || (example ? t('sample.line' + line.number) : t('line.defaultName', { number: line.number }))
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
