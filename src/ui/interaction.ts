import { sectionKey } from '../engine/alignment.ts'
import { interpolate } from '../engine/geometry.ts'
import { LINE_COLORS } from '../engine/network.ts'
import { quoteLine } from '../engine/planning.ts'
import { nearestOnTrack } from '../engine/track.ts'
import type { GameState, Line, LineDesign, Point } from '../engine/types.ts'

export type Tool = 'select' | 'station' | 'line' | 'move'
export type Selection = { type: 'station' | 'line' | 'train' | 'district'; id: string } | undefined
export interface ControlSelection { key: string; index: number }

export interface LineDraft extends LineDesign {
  kind: 'draw' | 'edit'
  id?: string
  anchor?: string
  insertion?: number
  pending: Point[]
  placingControl?: boolean
  controls: Record<string, Point[]>
  proposed: Record<string, Point>
  control?: ControlSelection
}

export type MapTarget = {
  point: Point
  selection?: Selection
  shift?: boolean
  control?: ControlSelection
  trackPoint?: Point
  trackLines?: string[]
}

export function availableLineColor(game: GameState) {
  return LINE_COLORS.find((color) => !game.lines.some((line) => line.color === color)) ?? LINE_COLORS[game.lines.length % LINE_COLORS.length]
}

export function extensionChoices(game: GameState, station: string | undefined) {
  return station ? game.lines.filter((line) => !line.circular && (line.stops[0] === station || line.stops.at(-1) === station)) : []
}

export function draftDesign(game: GameState, draft: LineDraft): LineDesign {
  const existing = game.lines.find((line) => line.id === draft.id)
  if (!existing || draft.kind === 'edit') return draft
  const extra = draft.stops.slice(1)
  const stops = existing.stops[0] === draft.anchor ? [...extra.reverse(), ...existing.stops] : [...existing.stops, ...extra]
  return { ...draft, stops, circular: extra.length > 0 && draft.circular }
}

export function appendDraftStop(draft: LineDraft, id: string, position?: Point): LineDraft {
  if (draft.stops.includes(id)) return draft
  const stops = [...draft.stops]
  const at = draft.insertion === undefined ? stops.length : draft.insertion + 1
  const previous = stops[at - 1]
  const controls = { ...draft.controls }
  if (previous && draft.pending.length) controls[sectionKey(previous, id)] = draft.pending
  stops.splice(at, 0, id)
  return { ...draft, stops, controls, pending: [], insertion: undefined,
    proposed: position ? { ...draft.proposed, [id]: position } : draft.proposed }
}

export const draftPosition = (game: GameState, draft: LineDraft, id: string) =>
  draft.proposed[id] ?? game.stations.find((station) => station.id === id)?.position

export function editControl(draft: LineDraft, selection: ControlSelection, point?: Point) {
  const controls = [...(draft.controls[selection.key] ?? [])]
  controls.splice(selection.index, 1, ...(point ? [point] : []))
  return { ...draft, controls: { ...draft.controls, [selection.key]: controls }, control: undefined }
}

export function addGeometryControl(game: GameState, draft: LineDraft, point: Point) {
  const existing = game.lines.find((line) => line.id === draft.id)
  const quote = quoteLine(game, draftDesign(game, draft), existing)
  let closest: { gap: number; controls: Point[]; key: string } | undefined
  for (const { section } of quote.rows) {
    const hit = nearestOnTrack(section.pieces, point)
    if (!hit || (closest && closest.gap <= hit.distance)) continue
    const controls = section.controls.slice()
    const next = controls.findIndex((entry) => (nearestOnTrack(section.pieces, entry)?.offset ?? 0) > hit.offset)
    controls.splice(next < 0 ? controls.length : next, 0, point)
    closest = { gap: hit.distance, controls, key: sectionKey(section.from, section.to) }
  }
  return closest ? { ...draft, controls: { ...draft.controls, [closest.key]: closest.controls } } : draft
}

export function smoothDraft(game: GameState, draft: LineDraft) {
  const design = draftDesign(game, draft)
  const existing = game.lines.find((line) => line.id === draft.id)
  const quote = quoteLine(game, design, existing)
  const candidates = quote.rows.filter((row) => row.added && row.section.controls.length)
  if (!candidates.length) return undefined
  for (const amount of [0.35, 0.6, 0.85]) {
    const controls = { ...draft.controls }
    for (const { section } of candidates) {
      const from = draftPosition(game, draft, section.from)!
      const to = draftPosition(game, draft, section.to)!
      controls[sectionKey(section.from, section.to)] = section.controls.map((point, index) =>
        interpolate(point, interpolate(from, to, (index + 1) / (section.controls.length + 1)), amount))
    }
    const next = { ...draft, controls }
    const result = quoteLine(game, draftDesign(game, next), existing)
    if (result.error !== 'curve' && result.error !== 'controlPoint') return next
  }
  return undefined
}

export function makeDraft(game: GameState, existing?: Line): LineDraft {
  return {
    kind: existing ? 'edit' : 'draw', id: existing?.id, name: existing?.name ?? '',
    color: existing?.color ?? availableLineColor(game), circular: existing?.circular ?? false,
    stops: existing?.stops.slice() ?? [], proposed: {}, pending: [],
    controls: Object.fromEntries(existing?.track.map((section) => [sectionKey(section.from, section.to), section.controls]) ?? []),
    autoInterchanges: true, automaticName: existing ? existing.automaticName : true,
  }
}
