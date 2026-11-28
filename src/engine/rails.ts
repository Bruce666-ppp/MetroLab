import { distance } from './geometry.ts'
import { allTrack, nearestOnTrack, reverseRailPath, reverseSection, splitTrack, trackLength } from './track.ts'
import type { Direction, GameState, Line, Point, RailReference, TrackSection } from './types.ts'

export const railPathKey = (path: RailReference[]) => path.map(({ id, direction }) => id + ':' + direction).join(',')

export function resolveRails(infrastructure: NonNullable<GameState['infrastructure']>, rails: RailReference[], from: string, to: string): TrackSection | undefined {
  const parts = rails.map(({ id, direction }) => {
    const section = Object.hasOwn(infrastructure, id) ? infrastructure[id] : undefined
    return section && (direction === 1 ? section : direction === -1 ? reverseSection(section) : undefined)
  })
  if (!parts.length || parts.some((part) => !part) || (from !== '@head' && parts[0]?.from !== from) ||
    (to !== '@tail' && parts.at(-1)?.to !== to)) return
  const sections = parts as TrackSection[]
  if (sections.some((section, index) => index && (sections[index - 1].to !== section.from ||
    distance(sections[index - 1].pieces.at(-1)!.to, section.pieces[0].from) > 0.012))) return
  if (sections.length === 1) return { ...sections[0], from, to, rails }
  return {
    from, to, rails,
    pieces: sections.flatMap((section) => section.pieces),
    controls: sections.flatMap((section, i) => i ? [section.pieces[0].from, ...section.controls] : section.controls),
    builtCost: sections.reduce((cost, section) => cost + (section.builtCost ?? 0), 0),
    ...(sections.some((section) => section.legacy) ? { legacy: true } : {}),
    ...(sections[0].method && sections.every((section) => section.method === sections[0].method) ? { method: sections[0].method } : {}),
  }
}

export function registerRail(game: GameState, section: TrackSection): RailReference {
  const id = 'track-' + game.nextId++
  const { rails: _references, ...physical } = section
  const infrastructure = game.infrastructure ??= {}
  infrastructure[id] = physical
  return { id, direction: 1 }
}

export function synchronizeRails(game: GameState) {
  const infrastructure = game.infrastructure ??= {}
  const inUse = new Set<string>()
  const synchronize = (section: TrackSection) => {
    section.rails ??= [registerRail(game, section)]
    for (const rail of section.rails) inUse.add(rail.id)
    return resolveRails(infrastructure, section.rails, section.from, section.to) ?? section
  }
  for (const line of game.lines) {
    line.track = line.track.map(synchronize)
    for (const side of ['head', 'tail'] as const) {
      const section = line.openEnds?.[side]
      if (section) line.openEnds![side] = synchronize(section)
    }
  }
  for (const id of Object.keys(infrastructure)) if (!inUse.has(id)) delete infrastructure[id]
}

export function splitSectionAt(section: TrackSection, offset: number, node: string) {
  const { head, tail } = splitTrack(section.pieces, offset)
  const before: Point[] = [], after: Point[] = []
  for (const point of section.controls) {
    const at = nearestOnTrack(section.pieces, point)!.offset
    if (at < offset - .01) before.push(point)
    if (at > offset + .01) after.push(point)
  }
  const cost = section.builtCost
  const headCost = cost === undefined ? undefined : Math.round(cost * offset / trackLength(section.pieces))
  const { rails: _references, ...base } = section
  return {
    first: { ...base, to: node, pieces: head, controls: before, ...(headCost === undefined ? {} : { builtCost: headCost }) } as TrackSection,
    second: { ...base, from: node, pieces: tail, controls: after, ...(cost === undefined ? {} : { builtCost: cost - headCost! }) } as TrackSection,
  }
}

export function splitRailPathAt(game: GameState, section: TrackSection, offset: number, node: string) {
  const path = section.rails
  const infrastructure = game.infrastructure
  if (!path || !infrastructure) return
  let remaining = offset
  for (const [index, rail] of path.entries()) {
    const physical = infrastructure[rail.id]
    const length = trackLength(physical.pieces)
    if (remaining > length + 1e-6) { remaining -= length; continue }
    if (Math.abs(remaining - length) <= 1e-6) {
      const junction = rail.direction === 1 ? physical.to : physical.from
      for (const link of Object.values(infrastructure)) {
        if (link.from === junction && junction !== '@head' && junction !== '@tail') link.from = node
        if (link.to === junction && junction !== '@head' && junction !== '@tail') link.to = node
      }
      return { head: path.slice(0, index + 1), tail: path.slice(index + 1) }
    }
    const oriented = rail.direction === 1 ? physical : reverseSection(physical)
    const { first, second } = splitSectionAt(oriented, remaining, node)
    const head = registerRail(game, first), tail = registerRail(game, second)
    for (const line of game.lines) for (const part of allTrack(line)) {
      if (!part.rails?.some((ref) => ref.id === rail.id)) continue
      part.rails = part.rails.flatMap((ref) => ref.id !== rail.id ? [ref] :
        ref.direction === rail.direction ? [head, tail] : reverseRailPath([head, tail]))
    }
    return { head: [...path.slice(0, index), head], tail: [tail, ...path.slice(index + 1)] }
  }
}

export function railUsers(lines: Line[]) {
  const uses = new Map<string, Line[]>()
  for (const line of lines) {
    const ids = new Set(allTrack(line).flatMap((section) => section.rails?.map((rail) => rail.id) ?? []))
    for (const id of ids) {
      const entries = uses.get(id) ?? []
      entries.push(line)
      uses.set(id, entries)
    }
  }
  return uses
}

export function lineRailPath(game: GameState, line: Line, from: string, to: string, direction: Direction) {
  if (from === to || !game.infrastructure) return
  const forward = line.track.flatMap((section) => section.rails ?? [])
  const ordered = direction === 1 ? forward : reverseRailPath(forward)
  const ends = ordered.map((rail) => {
    const section = game.infrastructure![rail.id]
    return rail.direction === 1 ? [section.from, section.to] : [section.to, section.from]
  })
  const first = ends.findIndex(([node]) => node === from)
  if (first < 0) return
  const path: RailReference[] = []
  let node = from
  const length = line.circular ? ordered.length : ordered.length - first
  for (let offset = 0; offset < length; offset++) {
    const index = (first + offset) % ordered.length
    if (ends[index][0] !== node) return
    path.push(ordered[index])
    node = ends[index][1]
    if (node === to) return path
  }
}

export function railReuseOptions(game: GameState, from: string, to: string, exclude?: string) {
  if (!game.infrastructure) return []
  const options = new Map<string, { key: string; path: RailReference[]; lines: Line[]; length: number }>()
  for (const line of game.lines) {
    if (line.id === exclude) continue
    for (const direction of [1, -1] as const) {
      const path = lineRailPath(game, line, from, to, direction)
      if (!path) continue
      const key = railPathKey(path)
      const other = options.get(key)
      if (other) { other.lines.push(line); continue }
      const section = resolveRails(game.infrastructure, path, from, to)
      if (section) options.set(key, { key, path, lines: [line], length: trackLength(section.pieces) })
    }
  }
  return [...options.values()]
}
