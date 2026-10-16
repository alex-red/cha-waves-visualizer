import { MAX_GRID_CELLS, type Scene } from './engine'

export type SamplingExtent = { widthM: number; depthM: number }
export type SamplingPlan = {
  requestedStepM: number
  stepM: number
  coarsened: boolean
  maxCells: number
}

/** Return the boundary bounding-box dimensions used by computeField. */
export function sceneSamplingExtent(scene: Scene, levelId = scene.levels[0]?.id): SamplingExtent {
  const level = scene.levels.find(candidate => candidate.id === levelId)
  if (!level) throw new RangeError(`Cannot plan sampling: level "${levelId}" was not found`)
  const xs = level.boundary.map(point => point[0]), ys = level.boundary.map(point => point[1])
  const widthM = Math.max(...xs) - Math.min(...xs), depthM = Math.max(...ys) - Math.min(...ys)
  return validateExtent({ widthM, depthM })
}

/** Plan one shared step for all extents so fields remain grid-compatible. */
export function planSampling(extents: readonly SamplingExtent[], requestedStepM: number, maxCells = MAX_GRID_CELLS): SamplingPlan {
  if (!Number.isFinite(requestedStepM) || requestedStepM <= 0) throw new RangeError('Sampling step must be a finite positive number')
  if (!Number.isSafeInteger(maxCells) || maxCells < 1) throw new RangeError('Sampling cell limit must be a positive safe integer')
  if (extents.length === 0) throw new RangeError('At least one scene extent is required to plan sampling')
  const checked = extents.map(validateExtent)
  let stepM = requestedStepM
  while (Number.isFinite(stepM)) {
    let maxCount = 0
    let fits = true
    for (const extent of checked) {
      const cols = Math.max(1, Math.ceil(extent.widthM / stepM)), rows = Math.max(1, Math.ceil(extent.depthM / stepM))
      if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 1 || rows < 1 || cols > maxCells / rows) {
        fits = false
        continue
      }
      const count = cols * rows
      maxCount = Math.max(maxCount, count)
      if (count > maxCells) fits = false
    }
    if (fits) return { requestedStepM, stepM, coarsened: stepM !== requestedStepM, maxCells: maxCount }
    stepM *= 2
  }
  throw new RangeError('Unable to choose a finite sampling step for these scene dimensions; check the imported coordinates')
}

function validateExtent(extent: SamplingExtent): SamplingExtent {
  if (!Number.isFinite(extent.widthM) || !Number.isFinite(extent.depthM) || extent.widthM <= 0 || extent.depthM <= 0) {
    throw new RangeError('Sampling bounds must have finite, positive width and depth; check the scene coordinates')
  }
  return extent
}

/** Convenience adapter for planning a common step across one or more scenes. */
export function planSceneSampling(scenes: readonly Scene[], requestedStepM: number, maxCells = MAX_GRID_CELLS): SamplingPlan {
  return planSampling(scenes.map(scene => sceneSamplingExtent(scene)), requestedStepM, maxCells)
}
