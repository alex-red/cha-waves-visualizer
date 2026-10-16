import type { FieldResult, Scene, SolverSettings } from '../../../../packages/engine'
import type { RfSurvey } from '../../../../packages/survey'
import type { FloorPlanReference, ProjectExperiment } from '../../../../packages/project'

export type WorkspaceDomain = 'sound' | 'wifi'
export type BaselineSnapshot = { field: FieldResult | null; settings: SolverSettings; scene: Scene }
export type BaselineState = BaselineSnapshot | null
export type HistoryContext = {
  settings: SolverSettings
  domain: WorkspaceDomain
  baseline: BaselineState
  selectedId: string
  selectedObjectId: string
  selectedDoorId: string
  referenceImage: FloorPlanReference | undefined
  experiments?: readonly ProjectExperiment[]
  baselineExperimentId?: string | null
  survey?: RfSurvey | null
}
export type HistoryChange = { before: HistoryContext; after: HistoryContext }
export type SceneDrag = {
  id: string
  kind: 'source' | 'probe'
  pointerId: number
  start: [number, number]
  original: Scene
  moved: boolean
  valid: boolean
}
