export type Point = { x: number; y: number }
export type Zone = 'residential' | 'office' | 'commercial' | 'industrial' | 'civic' | 'park' | 'waterfront'
export type Mode = 'career' | 'sandbox'
export type Direction = 1 | -1
export type Speed = 0 | 1 | 2 | 4
export type Layer = 'standard' | 'population' | 'employment' | 'demand' | 'coverage' | 'flow' | 'congestion' | 'accessibility' | 'engineering'
export type StationLevel = 1 | 2 | 3
export type TrackMethod = 'underground' | 'elevated' | 'atGrade'
export type BilingualName = { en: string; zh: string }

export interface District {
  id: string
  center: Point
  radius: [number, number]
  angle: number
  zone: Zone
  residents: number
  jobs: number
  visitors: number
  opens: number
  label?: Point
  names?: BilingualName
  areaKm2?: number
}

export interface City {
  id: string
  width: number
  height: number
  districts: District[]
  river: (y: number) => { center: number; halfWidth: number }
  bridges: { y: number; tilt: number }[]
  tripSamples: Map<string, Point[]>
  hongKong?: typeof import('./hongKong.ts').hongKong
}

export interface Station {
  id: string
  number: number
  name: string
  names?: BilingualName
  position: Point
  district: string
  level: StationLevel
  interchange: boolean
  builtCost: number
  method?: TrackMethod
  namePinned?: boolean
}

export interface Line {
  id: string
  number: number
  name: string
  color: string
  stops: string[]
  circular: boolean
  headway: number
  releaseAt: number
  track: TrackSection[]
  automaticName?: boolean
  suspended?: boolean
  fare?: number
  builtCost?: number
  openEnds?: Partial<Record<'head' | 'tail', TrackSection>>
}

export type TrackPiece = ({ kind: 'straight'; from: Point; to: Point }
  | { kind: 'arc'; from: Point; to: Point; center: Point; radius: number; sweep: number }) & { method?: TrackMethod }

export interface RailReference {
  id: string
  direction: Direction
}

export interface TrackSection {
  from: string
  to: string
  controls: Point[]
  pieces: TrackPiece[]
  legacy?: true
  method?: TrackMethod
  builtCost?: number
  rails?: RailReference[]
}

export interface Leg {
  board: string
  alight: string
  lineId: string
  direction: Direction
}

export interface PassengerGroup {
  count: number
  started: number
  readyAt: number
  egress: number
  legs: Leg[]
  tickets?: { lineId: string; fare: number }[]
  alternative?: 'walk' | 'bus' | 'ferry'
}

export interface Train {
  id: string
  lineId: string
  number: number
  active: boolean
  capacity: number
  speed: number
  operatingCost: number
  at: number
  direction: Direction
  phase: 'dwell' | 'travel'
  remaining: number
  duration: number
  loads: PassengerGroup[]
}

export interface Totals {
  demand: number
  unmet: number
  arrived: number
  transfers: number
  travelMinutes: number
  satisfactionPoints: number
  fares: number
  subsidy: number
  rewards: number
  expenses: number
  construction: number
  salvage: number
}

export interface HistoryPoint {
  minute: number
  arrivals: number
  coverage: number
  balance: number
}

export interface LineActivity {
  boarded: number
  peak: number
  load: number
  departures: number
  fares: number
  expenses: number
}

export interface HongKongOperations {
  lineActivity: Record<string, LineActivity>
  od: Record<string, number>
  alternatives: Record<'walk' | 'bus' | 'ferry', number>
}

export interface GameState {
  version: number
  cityId: string
  mode: Mode
  minute: number
  funds: number
  nextId: number
  stations: Station[]
  lines: Line[]
  infrastructure?: Record<string, TrackSection>
  trains: Train[]
  queues: Record<string, PassengerGroup[]>
  egress: PassengerGroup[]
  growth: Record<string, number>
  carry: Record<string, number>
  districtDemand: Record<string, number>
  stationActivity: Record<string, { requested: number; boarded: number; alighted: number; transferred?: number }>
  today: Totals
  lifetime: Totals
  history: HistoryPoint[]
  hourArrivals: number
  hourBalance: number
  milestones: string[]
  revision: number
  hongKong?: HongKongOperations
}

export interface LineDesign {
  name: string
  color: string
  stops: string[]
  circular: boolean
  controls?: Record<string, Point[]>
  proposed?: Record<string, Point>
  autoInterchanges?: boolean
  automaticName?: boolean
  method?: TrackMethod
  methods?: Record<string, TrackMethod>
  stationMethods?: Record<string, TrackMethod>
  alignmentEnds?: Partial<Record<'head' | 'tail', Point[]>>
  reuse?: Record<string, RailReference[]>
  stationMoves?: Record<string, Point>
  stationNames?: Record<string, BilingualName>
}
