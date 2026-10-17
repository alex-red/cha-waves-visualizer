import { predictPlaneDelayMs, type PlaneFitResult, type PlaneObservation, type SpatialPlane } from './spatial-plane'

export interface SpatialPlaneEvaluation {
  fitStatus: PlaneFitResult['status']
  trainingAttempts: { eligibleCount: number; missingCount: number; ambiguousCount: number }
  normalAngleErrorDeg: number | null
  absoluteOffsetErrorM: number | null
  heldOut: {
    eligibleCandidateCount: number
    evaluatedCount: number
    excludedCount: number
    rmsResidualMs: number | null
    maxResidualMs: number | null
    exclusions: Array<{ id: string; reason: 'missing' | 'ambiguous' | 'unsupported-geometry' | 'no-estimate' }>
    unavailableReason: string | null
  }
  limitations: string[]
}

/** Evaluate an already completed fit against truth and distinct held-out attempts. Never refits. */
export function evaluatePlaneFit(
  result: PlaneFitResult,
  truth: SpatialPlane,
  heldOut: readonly PlaneObservation[],
): SpatialPlaneEvaluation {
  if (!Array.isArray(heldOut) || heldOut.length > 48) throw new Error('heldOut must contain at most 48 observations.')
  const trainingIds = new Set(result.outcomes.map(outcome => outcome.id))
  const heldOutIds = new Set<string>()
  for (const [index, observation] of heldOut.entries()) {
    const path = `heldOut[${index}]`
    if (!observation || typeof observation !== 'object' || typeof observation.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(observation.id)) {
      throw new Error(`${path}.id must be a valid observation ID.`)
    }
    if (heldOutIds.has(observation.id)) throw new Error(`${path}.id duplicates another held-out observation.`)
    if (trainingIds.has(observation.id)) throw new Error(`${path}.id overlaps a training observation.`)
    heldOutIds.add(observation.id)
    validatePosition(observation.speakerPositionM, `${path}.speakerPositionM`)
    validatePosition(observation.microphonePositionM, `${path}.microphonePositionM`)
    if (!Array.isArray(observation.arrivalCandidatesMs) || observation.arrivalCandidatesMs.length > 16) {
      throw new Error(`${path}.arrivalCandidatesMs must contain at most 16 candidate delays.`)
    }
    for (const [candidateIndex, delay] of observation.arrivalCandidatesMs.entries()) {
      if (!Number.isFinite(delay) || delay <= 0 || delay > 1_000_000) {
        throw new Error(`${path}.arrivalCandidatesMs[${candidateIndex}] must be a positive finite delay no greater than 1000000 ms.`)
      }
    }
  }
  const trainingAttempts = {
    eligibleCount: result.outcomes.filter(outcome => outcome.status === 'eligible').length,
    missingCount: result.outcomes.filter(outcome => outcome.status === 'missing').length,
    ambiguousCount: result.outcomes.filter(outcome => outcome.status === 'ambiguous').length,
  }
  const estimate = result.status === 'ok' ? validatePlane(result.plane, 'result.plane') : undefined
  const normalizedTruth = validatePlane(truth, 'truth')
  const normalDot = estimate ? dot(estimate.normal, normalizedTruth.normal) : null
  const normalAngleErrorDeg = estimate && normalDot !== null
    ? Math.acos(Math.min(1, Math.max(-1, Math.abs(normalDot)))) * 180 / Math.PI
    : null
  const alignedOffset = estimate && normalDot !== null
    ? (normalDot < 0 ? -estimate.offsetM : estimate.offsetM)
    : null
  const absoluteOffsetErrorM = alignedOffset === null ? null : Math.abs(alignedOffset - normalizedTruth.offsetM)

  const eligibleCandidates = heldOut.filter(observation => observation.arrivalCandidatesMs.length === 1)
  const exclusions = heldOut.flatMap<SpatialPlaneEvaluation['heldOut']['exclusions'][number]>(observation => observation.arrivalCandidatesMs.length === 0
    ? [{ id: observation.id, reason: 'missing' as const }]
    : observation.arrivalCandidatesMs.length > 1
      ? [{ id: observation.id, reason: 'ambiguous' as const }]
      : [])
  let rmsResidualMs: number | null = null
  let maxResidualMs: number | null = null
  let residuals: number[] = []
  if (estimate) {
    for (const observation of eligibleCandidates) {
      try {
        residuals.push(predictPlaneDelayMs(
          estimate,
          observation.speakerPositionM,
          observation.microphonePositionM,
        ) - observation.arrivalCandidatesMs[0]!)
      } catch {
        exclusions.push({ id: observation.id, reason: 'unsupported-geometry' })
      }
    }
  } else {
    for (const observation of eligibleCandidates) exclusions.push({ id: observation.id, reason: 'no-estimate' })
  }
  if (residuals.length > 0) {
    rmsResidualMs = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length)
    maxResidualMs = Math.max(...residuals.map(Math.abs))
  }
  const unavailableReason = estimate
    ? residuals.length === 0 ? 'No held-out observations had one candidate and supported reflection geometry.' : null
    : `Plane estimate unavailable because fit status is ${result.status}.`

  return {
    fitStatus: result.status,
    trainingAttempts,
    normalAngleErrorDeg,
    absoluteOffsetErrorM,
    heldOut: {
      eligibleCandidateCount: eligibleCandidates.length,
      evaluatedCount: residuals.length,
      excludedCount: exclusions.length,
      rmsResidualMs,
      maxResidualMs,
      exclusions,
      unavailableReason,
    },
    limitations: [
      'Synthetic numerical evaluation only; it is not physical room-mapping evidence.',
      'The evaluator consumes the supplied fit and never refits against held-out observations or truth.',
      'The model assumes one fixed speaker and one infinite specular plane with supplied 3D microphone positions.',
      'Finite wall bounds, occlusion, diffraction, reflectivity, echo assignment, device response and acoustic calibration are outside scope.',
      'Plane comparison uses the shared declared world frame without alignment or rescaling.',
    ],
  }
}

function dot(a: SpatialPlane['normal'], b: SpatialPlane['normal']): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function validatePlane(plane: SpatialPlane | undefined, path: string): SpatialPlane {
  if (!plane || !Array.isArray(plane.normal) || plane.normal.length !== 3 || !plane.normal.every(Number.isFinite)) {
    throw new Error(`${path}.normal must contain three finite coordinates.`)
  }
  const norm = Math.hypot(...plane.normal)
  if (Math.abs(norm - 1) > 1e-6) throw new Error(`${path}.normal must have unit length within 1e-6.`)
  if (!Number.isFinite(plane.offsetM) || Math.abs(plane.offsetM) > 1_000_000) throw new Error(`${path}.offsetM must be finite and bounded to ±1000000 m.`)
  return { normal: [plane.normal[0] / norm, plane.normal[1] / norm, plane.normal[2] / norm], offsetM: plane.offsetM / norm }
}

function validatePosition(position: unknown, path: string): asserts position is [number, number, number] {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000)) {
    throw new Error(`${path} must contain three finite coordinates bounded to ±1000000 m.`)
  }
}
