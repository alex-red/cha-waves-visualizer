import type { Scene, SolverSettings } from '../../../../packages/engine'
import type { PlacementOptions, PlacementResult } from '../../../../packages/placement'

export type PlacementRequest = { id: number; scene: Scene; settings: SolverSettings; options: PlacementOptions }
export type PlacementResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; result: PlacementResult }
  | { id: number; type: 'error'; error: string }
