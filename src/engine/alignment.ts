import { distance, octilinear } from './geometry.ts'
import { pairsOf, pairKey } from './network.ts'
import { allTrack, biarc, minimumRadius, nearestOnTrack, pieceTangent, radiusStatus, reverseSection, stationTangent,
  tangentsAgree, trackLength, trackStraight } from './track.ts'
import type { Direction, Line, LineDesign, Point, Station, TrackSection } from './types.ts'

export const sectionKey = (from: string, to: string) => from + '|' + to
export const headAnchor = '@head'
export const tailAnchor = '@tail'
export const openEndOf = (section: TrackSection) => section.from === headAnchor ? 'head' : section.to === tailAnchor ? 'tail' : undefined
export { allTrack } from './track.ts'

export function legacyTrack(stations: Station[], line: Pick<Line, 'stops' | 'circular'>) {
  const positions = new Map(stations.map((station) => [station.id, station.position]))
  return pairsOf(line.stops, line.circular).map(([from, to]): TrackSection => {
    const points = octilinear(positions.get(from)!, positions.get(to)!)
    return { from, to, controls: points.slice(1, -1), pieces: points.slice(1).map((point, i) => trackStraight(points[i], point)), legacy: true }
  })
}

export function sectionAt(line: Line, at: number, direction: Direction) {
  const sectionIndex = direction === 1 ? at : at - 1
  return line.track[sectionIndex < 0 && line.circular ? line.track.length - 1 : sectionIndex]
}

const samePoints = (a: Point[], b: Point[]) => a.length === b.length &&
  a.every((point, index) => distance(point, b[index]) < 1e-6)

interface AlignmentSection {
  section: TrackSection
  added: boolean
  radius: number | null
  junction: boolean
  reused?: boolean
}

export function alignThrough(points: Point[], start?: Point, end?: Point) {
  const pieces: TrackSection['pieces'] = []
  let invalid = false
  const tangents = points.map((point, i) => {
    if (i === 0 && start) return start
    if (i === points.length - 1 && end) return end
    return stationTangent(points[i - 1], point, points[i + 1])
  })
  for (let i = 1; i < points.length; i++) {
    const result = biarc(points[i - 1], points[i], tangents[i - 1], tangents[i])
    if (!result) invalid = true
    pieces.push(...(result ?? [trackStraight(points[i - 1], points[i])]))
  }
  return { pieces, invalid }
}

export function alignTrack(positions: Map<string, Point>, design: LineDesign, existing?: Line,
  fixedTrack = new Map<string, TrackSection | undefined>()) {
  const oldSections = new Map(existing?.track.map((part) => [pairKey(part.from, part.to), part]))
  const links = pairsOf(design.stops, design.circular).map(([from, to]) => {
    const match = oldSections.get(pairKey(from, to))
    const old = match && match.from !== from ? reverseSection(match) : match
    const a = positions.get(from)!
    const b = positions.get(to)!
    const key = sectionKey(from, to)
    const fixed = fixedTrack.get(key)
    const controls = fixed?.controls ?? design.controls?.[key] ??
      design.controls?.[sectionKey(to, from)]?.slice().reverse() ?? old?.controls ?? []
    const reuse = !fixedTrack.has(key) && old && distance(old.pieces[0].from, a) < 1e-6 &&
      distance(old.pieces.at(-1)!.to, b) < 1e-6 && samePoints(controls, old.controls)
    return { from, to, points: [a, ...controls, b], controls, fixed: fixed ?? (reuse ? old : undefined) }
  })
  const previous = (index: number) => links[index - 1] ?? (design.circular ? links.at(-1) : undefined)
  const next = (index: number) => links[index + 1] ?? (design.circular ? links[0] : undefined)

  const rows: AlignmentSection[] = links.map((link, index) => {
    if (link.fixed) return { section: link.fixed, added: false, radius: minimumRadius(link.fixed.pieces), junction: false }
    const before = previous(index)
    const after = next(index)
    const points = link.points
    const start = before?.fixed ? pieceTangent(before.fixed.pieces.at(-1)!, true) : stationTangent(before?.points.at(-2), points[0], points[1])
    const end = after?.fixed ? pieceTangent(after.fixed.pieces[0]) : stationTangent(points.at(-2), points.at(-1)!, after?.points[1])
    const { pieces, invalid } = alignThrough(points, start, end)
    return { section: { from: link.from, to: link.to, controls: link.controls, pieces },
      added: true, radius: invalid ? 0 : minimumRadius(pieces), junction: false }
  })
  for (const [index, row] of rows.entries()) {
    const following = rows[index + 1] ?? (design.circular ? rows[0] : undefined)
    if (!following || tangentsAgree(pieceTangent(row.section.pieces.at(-1)!, true), pieceTangent(following.section.pieces[0]))) continue
    row.junction = true
    if (row.added) row.radius = 0
    if (following.added) following.radius = 0
  }
  return rows
}

export function trackHits(lines: Line[], point: Point, tolerance: number) {
  return lines.flatMap((line) => {
    const hits = allTrack(line).flatMap((section) => {
      const index = line.track.indexOf(section)
      const hit = nearestOnTrack(section.pieces, point)
      return hit && hit.distance <= tolerance ? [{ ...hit, lineId: line.id, index, section, end: openEndOf(section) }] : []
    })
    hits.sort((a, b) => a.distance - b.distance)
    return hits.length ? [hits[0]] : []
  }).sort((a, b) => a.distance - b.distance)
}

export type TrackHit = ReturnType<typeof trackHits>[number]

export function alignmentMetrics(track: TrackSection[]) {
  const radii = track.map((section) => minimumRadius(section.pieces)).filter((radius) => radius !== null)
  return { length: track.reduce((sum, section) => sum + trackLength(section.pieces), 0),
    radius: radii.length ? Math.min(...radii) : null }
}

export function legacyRestricted(line: Line, hongKong = false) {
  return line.track.some((section, index) => {
    if (!section.legacy) return false
    const following = line.track[index + 1] ?? (line.circular ? line.track[0] : undefined)
    return radiusStatus(minimumRadius(section.pieces), hongKong) === 'invalid' || Boolean(following?.legacy &&
      !tangentsAgree(pieceTangent(section.pieces.at(-1)!, true), pieceTangent(following.pieces[0])))
  })
}
