import { headAnchor, openEndOf, sectionKey } from '../engine/alignment.ts'
import { distance, interpolate } from '../engine/geometry.ts'
import { LINE_COLORS } from '../engine/network.ts'
import { openEndPoints, quoteLine } from '../engine/planning.ts'
import { nearestOnTrack, trackStraight } from '../engine/track.ts'
import type { GameState, Line, LineDesign, Point, TrackMethod } from '../engine/types.ts'

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
  placingStation?: boolean
  controls: Record<string, Point[]>
  proposed: Record<string, Point>
  control?: ControlSelection
  method?: TrackMethod
}

export type MapTarget = {
  point: Point
  selection?: Selection
  shift?: boolean
  control?: ControlSelection
  trackPoint?: Point
  trackLines?: string[]
  surveyTolerance?: number
}

export function availableLineColor(game: GameState) {
  return LINE_COLORS.find((color) => !game.lines.some((line) => line.color === color)) ?? LINE_COLORS[game.lines.length % LINE_COLORS.length]
}

export function extensionChoices(game: GameState, station: string | undefined) {
  return station ? game.lines.filter((line) => !line.circular &&
    (line.stops[0] === station && !line.openEnds?.head || line.stops.at(-1) === station && !line.openEnds?.tail)) : []
}

export function draftDesign(game: GameState, draft: LineDraft): LineDesign {
  const existing = game.lines.find((line) => line.id === draft.id)
  if (!existing || draft.kind === 'edit') {
    if (!game.hongKong || !draft.pending.length) return draft
    const side = draft.stops.length ? 'tail' : 'head'
    const old = draft.alignmentEnds?.[side] ?? []
    return { ...draft, alignmentEnds: { ...draft.alignmentEnds, [side]: [...old, ...draft.pending] } }
  }
  const extra = draft.stops.slice(1)
  const prepend = existing.stops[0] === draft.anchor
  const stops = prepend ? [...extra.reverse(), ...existing.stops] : [...existing.stops, ...extra]
  const alignmentEnds = game.hongKong ? { ...openEndPoints(existing), ...(draft.pending.length ? {
    [prepend ? 'head' : 'tail']: prepend ? draft.pending.slice().reverse() : draft.pending,
  } : {}), ...draft.alignmentEnds } : undefined
  return { ...draft, stops, circular: extra.length > 0 && draft.circular, alignmentEnds }
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

export function appendHongKongStop(game: GameState, draft: LineDraft, id: string, position?: Point, tolerance = 0) {
  const onMap = position ?? game.stations.find((station) => station.id === id)?.position
  if (!onMap) return draft
  const last = draft.stops.at(-1)
  const start = last ? draftPosition(game, draft, last) : undefined
  const points = start ? [start, ...draft.pending] : draft.pending
  let point = onMap
  let before = draft.pending.slice()
  let after: Point[] = []
  if (points.length && draft.pending.length) {
    const exact = points.findIndex((entry) => distance(onMap, entry) <= tolerance)
    if (exact >= Number(Boolean(start))) {
      point = position ? points[exact] : onMap
      before = points.slice(start ? 1 : 0, exact)
      after = points.slice(exact + 1)
    } else if (position && points.length > 1 && tolerance) {
      const pieces = points.slice(1).map((entry, index) => trackStraight(points[index], entry))
      const hit = nearestOnTrack(pieces, onMap)
      if (hit && hit.distance <= tolerance) {
        const i = pieces.findIndex((piece) => nearestOnTrack([piece], hit.point)!.distance < .0001)
        if (i >= 0) {
          point = hit.point
          before = points.slice(start ? 1 : 0, i + 1)
          after = points.slice(i + 1)
        }
      }
    }
  }
  const placed = appendDraftStop({ ...draft, pending: before }, id, position ? point : undefined)
  const method = draft.method ?? 'underground'
  const previous = placed.stops[placed.stops.indexOf(id) - 1]
  return { ...placed, pending: after, placingStation: false,
    alignmentEnds: !previous && before.length ? { ...draft.alignmentEnds, head: before } : draft.alignmentEnds,
    methods: previous ? { ...draft.methods, [sectionKey(previous, id)]: method } : draft.methods,
    stationMethods: position ? { ...draft.stationMethods, [id]: method } : draft.stationMethods }
}

export const draftPosition = (game: GameState, draft: LineDraft, id: string) =>
  draft.proposed[id] ?? game.stations.find((station) => station.id === id)?.position

export function editControl(draft: LineDraft, selection: ControlSelection, point?: Point) {
  if (draft.alignmentEnds && (selection.key.startsWith('@head|') || selection.key.endsWith('|@tail'))) {
    const side = selection.key.startsWith(headAnchor + '|') ? 'head' : 'tail'
    const controls = [...(draft.alignmentEnds[side] ?? [])]
    controls.splice(selection.index + (side === 'head' ? 1 : 0), 1, ...(point ? [point] : []))
    return { ...draft, alignmentEnds: { ...draft.alignmentEnds, [side]: controls }, control: undefined }
  }
  const controls = [...(draft.controls[selection.key] ?? [])]
  controls.splice(selection.index, 1, ...(point ? [point] : []))
  return { ...draft, controls: { ...draft.controls, [selection.key]: controls }, control: undefined }
}

export function addGeometryControl(game: GameState, draft: LineDraft, point: Point) {
  const existing = game.lines.find((line) => line.id === draft.id)
  const quote = quoteLine(game, draftDesign(game, draft), existing)
  let closest: { gap: number; controls: Point[]; key: string } | undefined
  for (const { section } of quote.rows) {
    if (openEndOf(section)) continue
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
  const candidates = quote.rows.filter((row) => row.added && row.section.controls.length && !openEndOf(row.section))
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
    ...(game.hongKong ? { method: 'underground' as const, alignmentEnds: existing ? openEndPoints(existing) : undefined } : {}),
  }
}
