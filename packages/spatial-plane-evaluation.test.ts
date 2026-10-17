import { describe, expect, it } from 'vitest'
import { evaluatePlaneFit } from './spatial-plane-evaluation'
import type { PlaneFitResult, PlaneObservation, SpatialPlane } from './spatial-plane'

const truth: SpatialPlane = { normal: [1, 0, 0], offsetM: 2 }
const directRelativeDelayMs = 4 * 1000 / 343
const eligible: PlaneObservation = {
  id: 'heldout-one', speakerPositionM: [0, 0, 0], microphonePositionM: [0, 0, 0],
  arrivalCandidatesMs: [directRelativeDelayMs + 0.2],
}

function okFit(overrides: Partial<PlaneFitResult> = {}): PlaneFitResult {
  return {
    status: 'ok', message: 'accepted',
    outcomes: [
      { id: 'training-a', status: 'eligible' },
      { id: 'training-b', status: 'missing' },
      { id: 'training-c', status: 'ambiguous' },
    ],
    eligibleCount: 1, plane: { normal: [-1, 0, 0], offsetM: -2 }, imageSourceM: [4, 0, 0],
    ...overrides,
  }
}

describe('spatial plane evaluation', () => {
  it('aligns equivalent plane signs, counts training outcomes, and evaluates perturbed held-out timing independently', () => {
    const heldOut: PlaneObservation[] = [
      eligible,
      { ...eligible, id: 'heldout-missing', arrivalCandidatesMs: [] },
      { ...eligible, id: 'heldout-ambiguous', arrivalCandidatesMs: [2, 2.1] },
      { ...eligible, id: 'heldout-opposite-side', microphonePositionM: [3, 0, 0] },
    ]
    const evaluated = evaluatePlaneFit(okFit(), truth, heldOut)
    expect(evaluated.fitStatus).toBe('ok')
    expect(evaluated.trainingAttempts).toEqual({ eligibleCount: 1, missingCount: 1, ambiguousCount: 1 })
    expect(evaluated.normalAngleErrorDeg).toBe(0)
    expect(evaluated.absoluteOffsetErrorM).toBe(0)
    expect(evaluated.heldOut.eligibleCandidateCount).toBe(2)
    expect(evaluated.heldOut.evaluatedCount).toBe(1)
    expect(evaluated.heldOut.excludedCount).toBe(3)
    expect(evaluated.heldOut.exclusions).toEqual([
      { id: 'heldout-missing', reason: 'missing' },
      { id: 'heldout-ambiguous', reason: 'ambiguous' },
      { id: 'heldout-opposite-side', reason: 'unsupported-geometry' },
    ])
    expect(evaluated.heldOut.rmsResidualMs).toBeCloseTo(0.2, 10)
    expect(evaluated.heldOut.maxResidualMs).toBeCloseTo(0.2, 10)
    expect(evaluated.limitations.join(' ')).toContain('never refits')
    expect(evaluated.limitations.join(' ')).toContain('Synthetic')
  })

  it('keeps geometry and held-out errors unavailable when the fit is rejected', () => {
    const rejected: PlaneFitResult = {
      status: 'insufficient-data', message: 'not enough diverse poses',
      outcomes: [{ id: 'training-a', status: 'eligible' }, { id: 'training-b', status: 'missing' }],
      eligibleCount: 1,
    }
    const evaluated = evaluatePlaneFit(rejected, truth, [
      eligible,
      { ...eligible, id: 'heldout-missing', arrivalCandidatesMs: [] },
      { ...eligible, id: 'heldout-ambiguous', arrivalCandidatesMs: [1, 2] },
    ])
    expect(evaluated.normalAngleErrorDeg).toBeNull()
    expect(evaluated.absoluteOffsetErrorM).toBeNull()
    expect(evaluated.heldOut).toMatchObject({
      eligibleCandidateCount: 1, evaluatedCount: 0, excludedCount: 3, rmsResidualMs: null, maxResidualMs: null,
      unavailableReason: 'Plane estimate unavailable because fit status is insufficient-data.',
    })
    expect(evaluated.heldOut.eligibleCandidateCount).toBe(1)
    expect(evaluated.heldOut.evaluatedCount).toBe(0)
    expect(evaluated.heldOut.exclusions).toEqual([
      { id: 'heldout-missing', reason: 'missing' },
      { id: 'heldout-ambiguous', reason: 'ambiguous' },
      { id: 'heldout-one', reason: 'no-estimate' },
    ])
  })

  it('rejects held-out leakage, malformed truth, and non-finite held-out coordinates', () => {
    expect(() => evaluatePlaneFit(okFit(), truth, [{ ...eligible, id: 'training-a' }])).toThrow(/overlaps a training observation/)
    expect(() => evaluatePlaneFit(okFit(), { normal: [NaN, 0, 0], offsetM: 2 }, [eligible])).toThrow(/finite coordinates/)
    expect(() => evaluatePlaneFit(okFit(), truth, [{ ...eligible, microphonePositionM: [Infinity, 0, 0] }])).toThrow(/finite coordinates/)
    expect(() => evaluatePlaneFit(okFit(), truth, [{ ...eligible, id: undefined } as unknown as PlaneObservation])).toThrow(/valid observation ID/)
    const withoutPlane = okFit()
    delete withoutPlane.plane
    expect(() => evaluatePlaneFit(withoutPlane, truth, [eligible])).toThrow(/result\.plane/)
  })

  it('normalizes accepted near-unit plane representations before sign-invariant comparison', () => {
    const evaluated = evaluatePlaneFit(
      { ...okFit(), plane: { normal: [-1 + 5e-7, 0, 0], offsetM: -2 * (1 - 5e-7) } },
      { normal: [1 - 5e-7, 0, 0], offsetM: 2 * (1 - 5e-7) },
      [eligible],
    )
    expect(evaluated.normalAngleErrorDeg).toBe(0)
    expect(evaluated.absoluteOffsetErrorM).toBe(0)
  })

  it('does not mutate fit, truth, or held-out observations', () => {
    const fit = okFit()
    const heldOut = [{ ...eligible, speakerPositionM: [0, 0, 0] as [number, number, number] }]
    const before = JSON.stringify([fit, truth, heldOut])
    evaluatePlaneFit(fit, truth, heldOut)
    expect(JSON.stringify([fit, truth, heldOut])).toBe(before)
  })
})
