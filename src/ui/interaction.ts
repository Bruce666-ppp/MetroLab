import type { LineDesign, Point } from '../engine/types.ts'

export type Tool = 'select' | 'station' | 'line' | 'move'
export type Selection =
  | { type: 'station' | 'line' | 'train' | 'district'; id: string }
  | undefined

export interface LineDraft extends LineDesign {
  id?: string
  insertion?: number
}
export type MapTarget = { point: Point; selection?: Selection }
