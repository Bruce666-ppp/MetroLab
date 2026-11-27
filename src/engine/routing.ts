import { sectionAt } from './alignment.ts'
import { HKD } from './economy.ts'
import { clamp } from './geometry.ts'
import { DWELL, nextStop, trainLoad, waitingAt, stationCapacity } from './network.ts'
import type { AccessLink } from './network.ts'
import { trackProfile } from './track.ts'
import type { Direction, GameState, Leg } from './types.ts'

interface Edge extends Leg {
  minutes: number
  wait: number
  fare: number
}

interface Node {
  station: string
  origin: string
  lineId: string
  direction: Direction
  cost: number
  elapsed: number
  arrival?: Edge
  previous?: Node
  walk: number
}

interface RoutingNetwork {
  outgoing: Map<string, Edge[]>
  transfers: Set<string>
}

export interface Journey {
  legs: Leg[]
  minutes: number
  access: number
  egress: number
  cost: number
  tickets: { lineId: string; fare: number }[]
}

export function makeRoutingNetwork(game: GameState): RoutingNetwork {
  const outgoing = new Map<string, Edge[]>()
  const stationById = new Map(game.stations.map((station) => [station.id, station]))
  for (const line of game.lines) {
    const fleet = game.trains.filter((train) => train.lineId === line.id && train.active)
    if (!fleet.length || line.suspended) continue
    const load = fleet.reduce((total, train) => total + trainLoad(train) / train.capacity, 0) / fleet.length
    const segments: Edge[] = []
    const directions: Direction[] = line.circular ? [1] : [1, -1]
    for (let i = 0; i < line.stops.length; i++) {
      const from = stationById.get(line.stops[i])!
      for (const direction of directions) {
        const next = nextStop(line, i, direction)
        if (next < 0 || next >= line.stops.length) continue
        const to = stationById.get(line.stops[next])!
        const section = sectionAt(line, i, direction)!
        const minutes = fleet.reduce((total, train) => total + trackProfile(section, train.speed, direction).duration, 0) / fleet.length + DWELL
        segments.push({ lineId: line.id, board: from.id, alight: to.id, direction, minutes, wait: 0,
          fare: game.hongKong ? line.fare ?? HKD.fare : 0 })
      }
    }
    const cycle = segments.reduce((sum, segment) => sum + segment.minutes, 0)
    for (const edge of segments) {
      const crowd = waitingAt(game, edge.board) / stationCapacity(stationById.get(edge.board)!)
      edge.wait = 0.5 * Math.max(line.headway, cycle / fleet.length) * (1 + 0.5 * clamp(crowd + load, 0, 2))
      const neighbors = outgoing.get(edge.board) ?? []
      neighbors.push(edge)
      outgoing.set(edge.board, neighbors)
    }
  }
  const transfers = new Set(game.stations.filter((station) => station.interchange).map((station) => station.id))
  return { outgoing, transfers }
}

class Frontier {
  private nodes: Node[] = []

  push(node: Node) {
    const entries = this.nodes
    let i = entries.length
    entries.push(node)
    while (i > 0) {
      const parent = (i - 1) >>> 1
      if (entries[parent].cost <= node.cost) break
      entries[i] = entries[parent]
      i = parent
    }
    entries[i] = node
  }

  take() {
    if (this.nodes.length === 0) return undefined
    const first = this.nodes[0]
    const tail = this.nodes.pop()!
    if (!this.nodes.length) return first
    let parent = 0
    while (2 * parent + 1 < this.nodes.length) {
      let child = 2 * parent + 1
      if (child + 1 < this.nodes.length && this.nodes[child + 1].cost < this.nodes[child].cost) child++
      if (tail.cost <= this.nodes[child].cost) break
      this.nodes[parent] = this.nodes[child]
      parent = child
    }
    this.nodes[parent] = tail
    return first
  }
}

export function routesFrom(network: RoutingNetwork, origins: AccessLink[]) {
  const bestByStation = new Map<string, Node>()
  const frontier = new Frontier()
  const best = new Map<string, number>()
  const key = (node: Node) => node.station + '|' + node.lineId + '|' + node.direction + '|' + node.origin
  const add = (node: Node) => {
    const nodeKey = key(node)
    if ((best.get(nodeKey) ?? Infinity) <= node.cost) return
    best.set(nodeKey, node.cost)
    frontier.push(node)
  }
  for (const access of origins) {
    add({ station: access.stationId, origin: access.stationId, lineId: '', direction: 1,
      walk: access.minutes, cost: access.minutes, elapsed: access.minutes })
  }
  for (let node = frontier.take(); node; node = frontier.take()) {
    if (node.cost !== best.get(key(node))) continue
    if (node.arrival && node.cost < (bestByStation.get(node.station)?.cost ?? Infinity)) {
      bestByStation.set(node.station, node)
    }
    for (const edge of network.outgoing.get(node.station) ?? []) {
      if (edge.alight === node.origin) continue
      const sameLine = node.lineId === edge.lineId
      if (sameLine && node.direction !== edge.direction) continue
      const transfer = Boolean(node.lineId && !sameLine)
      if (transfer && !network.transfers.has(node.station)) continue
      const elapsed = node.elapsed + edge.minutes + (sameLine ? 0 : edge.wait) + (transfer ? 4 : 0)
      const cost = node.cost + elapsed - node.elapsed + (sameLine ? 0 : edge.fare * 0.52)
      if (cost <= 145) {
        add({ station: edge.alight, origin: node.origin, lineId: edge.lineId, direction: edge.direction, cost, elapsed,
          arrival: edge, previous: node, walk: node.walk })
      }
    }
  }

  return (targets: AccessLink[]): Journey | undefined => {
    let destination: Node | undefined
    let egress = 0
    let minutes = 148
    for (const target of targets) {
      const node = bestByStation.get(target.stationId)
      if (!node || node.cost + target.minutes >= minutes) continue
      destination = node
      egress = target.minutes
      minutes = node.cost + egress
    }
    if (!destination) return undefined
    const edges: Edge[] = []
    for (let node: Node | undefined = destination; node?.arrival; node = node.previous) edges.push(node.arrival)
    edges.reverse()
    const legs: Leg[] = []
    const tickets: Journey['tickets'] = []
    for (const edge of edges) {
      const last = legs.at(-1)
      if (last?.lineId === edge.lineId && last.direction === edge.direction) {
        last.alight = edge.alight
      } else {
        legs.push({ board: edge.board, alight: edge.alight, lineId: edge.lineId, direction: edge.direction })
        tickets.push({ lineId: edge.lineId, fare: edge.fare })
      }
    }
    return { legs, minutes: destination.elapsed + egress, access: destination.walk, egress, cost: minutes, tickets }
  }
}
