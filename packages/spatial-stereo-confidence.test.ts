import { describe, expect, it } from 'vitest'
import {
  evaluateStereoConfidenceEligibility,
  scoreStereoConfidence,
  STEREO_CONFIDENCE_GATES,
  STEREO_CONFIDENCE_VARIANTS,
  type StereoConfidenceCaseScore,
  type StereoConfidenceResource,
  type StereoConfidenceScore,
  type StereoConfidenceVariantId,
} from './spatial-stereo-confidence.ts'
import type { StereoGeometryReport } from './spatial-stereo-geometry.ts'
import type { StereoConfidenceCase } from './test-fixtures/stereo-confidence.ts'
import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoOutcome, type StereoResult } from './spatial-stereo-types.ts'

const width = 7, height = 2, pixelCount = width * height
const camera = { id: 'confidence-unit', positionM: [0, 0, 0] as [number, number, number], intrinsics: { width, height, fx: 10, fy: 10, cx: 3.5, cy: 1 } }

function result(points: Array<{ pixelIndex: number; disparityPx: number }>): StereoResult {
  const outcomes = new Uint8Array(pixelCount)
  const acceptedCode = STEREO_OUTCOMES.indexOf('accepted')
  for (const point of points) outcomes[point.pixelIndex] = acceptedCode
  const counts: Record<StereoOutcome, number> = { border: pixelCount - points.length, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: points.length }
  return {
    status: points.length ? 'reconstructed' : 'empty', width, height, baselineM: 0.3,
    settings: { ...STEREO_SETTINGS, minDisparity: 1, maxDisparity: 6 }, outcomes, counts,
    points: points.map(point => ({
      ...point,
      positionM: [0, 0, -3 / point.disparityPx],
      color: [90, 80, 70],
      meanAbsoluteError: 0,
    })),
  }
}

function control(
  split: 'development' | 'evaluation' = 'development',
  disparityPx: (number | null)[] = Array(pixelCount).fill(3),
  depthM: (number | null)[] = Array(pixelCount).fill(1),
  unsupportedPixels: number[] = [0],
): StereoConfidenceCase {
  const rgb = new Uint8Array(pixelCount * 3)
  return {
    fixture: {
      id: 'confidence-unit-case', split,
      input: {
        left: { camera, image: { width, height, rgb: rgb.slice() } },
        right: { camera: { ...camera, id: 'confidence-unit-right', positionM: [0.3, 0, 0] }, image: { width, height, rgb: rgb.slice() } },
      },
      truth: { camera, disparityPx, depthM },
      regions: { boundary: [], weakTexture: [], occlusion: [] },
    },
    role: 'positive', unsupportedPixels, notes: 'Small fabricated scoring control; no reconstruction is run.',
  }
}

function geometry(valid: number, accepted: number, bad1: number, passed = true): StereoGeometryReport {
  return {
    totalPixels: valid,
    validTruthPixels: valid,
    missingTruthPixels: 0,
    acceptedPixels: accepted,
    acceptedWithTruth: accepted,
    acceptedWithoutTruth: 0,
    unestimatedTruthPixels: valid - accepted,
    truthCoverage: valid ? accepted / valid : null,
    disparity: {
      meanAbsoluteErrorPx: null, p50AbsoluteErrorPx: null, p90AbsoluteErrorPx: null, maxAbsoluteErrorPx: null,
      bad1Count: bad1, bad1AmongEstimatesFraction: accepted ? bad1 / accepted : null,
      bad1IncludingMissingFraction: valid ? (bad1 + valid - accepted) / valid : null,
    },
    depth: { meanAbsoluteErrorM: null, p50AbsoluteErrorM: null, p90AbsoluteErrorM: null, maxAbsoluteErrorM: null },
    worstErrors: [],
    gates: { minimumTruthCoverage: passed, maximumBad1Fraction: passed, maximumDepthP90M: passed, passed },
    passed,
  }
}

function score(geometryReport: StereoGeometryReport, unsupported: { pixels: number; acceptedPixels: number; fraction: number | null } = { pixels: 100, acceptedPixels: 0, fraction: 0 }): StereoConfidenceScore {
  return { geometry: geometryReport, outcomes: {} as StereoResult['counts'], regions: {}, unsupported, supportVsFullSgm: null } as StereoConfidenceScore
}

function caseScore(
  id: string,
  role: 'positive' | 'negative',
  sadGeometry: StereoGeometryReport,
  proposalGeometry: StereoGeometryReport,
  proposalUnsupported = { pixels: 100, acceptedPixels: 0, fraction: 0 },
  proposalScore: StereoConfidenceScore | null = score(proposalGeometry, proposalUnsupported),
): StereoConfidenceCaseScore {
  const base = score(sadGeometry)
  return {
    id, role,
    variants: STEREO_CONFIDENCE_VARIANTS.map(variant => ({
      id: variant.id,
      score: variant.id === 'sad-baseline' ? base
        : variant.id === 'no-variance-proposal' ? proposalScore
          : score(sadGeometry),
    })),
  }
}

function eligibleCases(): StereoConfidenceCaseScore[] {
  return [
    caseScore('positive-large', 'positive', geometry(100, 50, 5), geometry(100, 90, 0)),
    caseScore('positive-small', 'positive', geometry(10, 10, 0), geometry(10, 10, 0)),
    caseScore('negative-uniform', 'negative', geometry(0, 0, 0), geometry(0, 0, 0), { pixels: 100, acceptedPixels: 1, fraction: 0.01 }),
  ]
}

function completeResources(cases: readonly StereoConfidenceCaseScore[]): StereoConfidenceResource[] {
  return cases.flatMap(item => STEREO_CONFIDENCE_VARIANTS.map(variant => ({
    caseId: item.id, variantId: variant.id, completed: true,
    wallTimeMs: STEREO_CONFIDENCE_GATES.maxWallTimeMs,
    peakRssBytes: STEREO_CONFIDENCE_GATES.maxPeakRssBytes,
    sampledPeakRssBytes: STEREO_CONFIDENCE_GATES.maxPeakRssBytes,
  })))
}

describe('scoreStereoConfidence', () => {
  it('counts unsupported acceptance independently of correct disparity error', () => {
    const fixture = control('development', Array(pixelCount).fill(3), Array(pixelCount).fill(1), [0])
    const scored = scoreStereoConfidence(fixture, result([{ pixelIndex: 0, disparityPx: 3 }]))
    expect(scored.geometry.disparity.meanAbsoluteErrorPx).toBe(0)
    expect(scored.unsupported).toEqual({ pixels: 1, acceptedPixels: 1, fraction: 1 })
  })

  it('keeps unsupported acceptance defined when every geometry truth value is unknown', () => {
    const fixture = control('development', Array(pixelCount).fill(null), Array(pixelCount).fill(null), [0, 1])
    const scored = scoreStereoConfidence(fixture, result([{ pixelIndex: 0, disparityPx: 3 }]))
    expect(scored.geometry.validTruthPixels).toBe(0)
    expect(scored.geometry.disparity.meanAbsoluteErrorPx).toBeNull()
    expect(scored.geometry.depth.p90AbsoluteErrorM).toBeNull()
    expect(scored.unsupported).toEqual({ pixels: 2, acceptedPixels: 1, fraction: 0.5 })
  })

  it('rejects duplicate and out-of-range unsupported indices and refuses evaluation cases', () => {
    const estimate = result([{ pixelIndex: 0, disparityPx: 3 }])
    expect(() => scoreStereoConfidence(control('development', undefined, undefined, [0, 0]), estimate)).toThrow(/Invalid unsupported correspondence mask/)
    expect(() => scoreStereoConfidence(control('development', undefined, undefined, [pixelCount]), estimate)).toThrow(/Invalid unsupported correspondence mask/)
    expect(() => scoreStereoConfidence(control('evaluation'), estimate)).toThrow(/development-only/)
  })
})

describe('evaluateStereoConfidenceEligibility', () => {
  it('accepts a fully fabricated eligible set, including exact error and resource thresholds, without promoting a default', () => {
    const cases = eligibleCases()
    const resources = completeResources(cases)
    const beforeSettings = { ...STEREO_SETTINGS }

    const evaluation = evaluateStereoConfidenceEligibility(cases, resources)

    expect(evaluation.eligible).toBe(true)
    expect(evaluation.gates).toEqual({ everyPositiveAbsolute: true, pooledRelative: true, everyNegativeUnsupported: true, everyTrialResource: true })
    expect(evaluation.relative?.baseline.validTruthPixels).toBe(110)
    expect(evaluation.relative?.baseline.acceptedWithTruth).toBe(60)
    expect(evaluation.relative?.baseline.bad1IncludingMissing).toBe(55 / 110)
    expect(evaluation.relative?.candidate.acceptedWithTruth).toBe(100)
    expect(evaluation.relative?.candidate.bad1IncludingMissing).toBe(10 / 110)
    expect(evaluation.negativeUnsupported).toEqual([{ id: 'negative-uniform', pixels: 100, acceptedPixels: 1, fraction: 0.01, passed: true }])
    expect(evaluation.resourceChecks.every(check => check.passed)).toBe(true)
    expect(Object.keys(evaluation)).not.toContain('promotedDefault')
    expect(STEREO_SETTINGS).toEqual(beforeSettings)
    expect(STEREO_CONFIDENCE_VARIANTS[0]!.id).toBe('sad-baseline')
  })

  it('retains failed/null variant trials and makes incompleteness ineligible', () => {
    const cases = eligibleCases()
    const positive = cases[0]!
    const variant = positive.variants.find(item => item.id === 'no-variance-proposal')!
    variant.score = null
    const resources = completeResources(cases)
    resources[0]!.completed = false

    const evaluation = evaluateStereoConfidenceEligibility(cases, resources)

    expect(positive.variants).toHaveLength(STEREO_CONFIDENCE_VARIANTS.length)
    expect(positive.variants.find(item => item.id === 'no-variance-proposal')!.score).toBeNull()
    expect(evaluation.positiveAbsolute).toEqual([{ id: 'positive-large', passed: false }, { id: 'positive-small', passed: true }])
    expect(evaluation.gates.everyPositiveAbsolute).toBe(false)
    expect(evaluation.gates.pooledRelative).toBe(false)
    expect(evaluation.resourceChecks[0]!.passed).toBe(false)
    expect(evaluation.gates.everyTrialResource).toBe(false)
    expect(evaluation.eligible).toBe(false)
  })

  it('requires each positive proposal to pass its own absolute geometry gate', () => {
    for (const index of [0, 1]) {
      const cases = eligibleCases()
      const positive = cases[index]!
      const proposal = positive.variants.find(item => item.id === 'no-variance-proposal')!
      proposal.score = score(geometry(index === 0 ? 100 : 10, index === 0 ? 90 : 10, 0, false))
      const evaluation = evaluateStereoConfidenceEligibility(cases, completeResources(cases))
      expect(evaluation.gates.everyPositiveAbsolute).toBe(false)
      expect(evaluation.positiveAbsolute[index]!.passed).toBe(false)
      expect(evaluation.positiveAbsolute[1 - index]!.passed).toBe(true)
    }
  })

  it('applies the negative unsupported cap at and above one percent', () => {
    const cases = eligibleCases()
    const negative = cases[2]!
    const proposal = negative.variants.find(item => item.id === 'no-variance-proposal')!
    proposal.score = score(geometry(0, 0, 0), { pixels: 100, acceptedPixels: 2, fraction: 0.02 })
    let evaluation = evaluateStereoConfidenceEligibility(cases, completeResources(cases))
    expect(evaluation.negativeUnsupported[0]!.passed).toBe(false)
    expect(evaluation.gates.everyNegativeUnsupported).toBe(false)

    proposal.score = score(geometry(0, 0, 0), { pixels: 100, acceptedPixels: 1, fraction: 0.01 })
    evaluation = evaluateStereoConfidenceEligibility(cases, completeResources(cases))
    expect(evaluation.negativeUnsupported[0]!.passed).toBe(true)
    expect(evaluation.gates.everyNegativeUnsupported).toBe(true)

    proposal.score = score(geometry(0, 0, 0), { pixels: 0, acceptedPixels: 0, fraction: null })
    evaluation = evaluateStereoConfidenceEligibility(cases, completeResources(cases))
    expect(evaluation.negativeUnsupported[0]!.passed).toBe(false)
  })

  it('allows exactly 30 seconds and 512 MiB, but fails over, missing, duplicate and unknown resource trials', () => {
    const cases = eligibleCases()
    const resources = completeResources(cases)
    expect(evaluateStereoConfidenceEligibility(cases, resources).gates.everyTrialResource).toBe(true)

    const overTime = structuredClone(resources)
    overTime[0]!.wallTimeMs = STEREO_CONFIDENCE_GATES.maxWallTimeMs + 0.001
    expect(evaluateStereoConfidenceEligibility(cases, overTime).gates.everyTrialResource).toBe(false)

    const overPeak = structuredClone(resources)
    overPeak[0]!.peakRssBytes = STEREO_CONFIDENCE_GATES.maxPeakRssBytes + 1
    expect(evaluateStereoConfidenceEligibility(cases, overPeak).gates.everyTrialResource).toBe(false)

    const overSample = structuredClone(resources)
    overSample[0]!.sampledPeakRssBytes = STEREO_CONFIDENCE_GATES.maxPeakRssBytes + 1
    expect(evaluateStereoConfidenceEligibility(cases, overSample).gates.everyTrialResource).toBe(false)

    const missingPeak = structuredClone(resources)
    missingPeak[0]!.peakRssBytes = null
    expect(evaluateStereoConfidenceEligibility(cases, missingPeak).gates.everyTrialResource).toBe(false)

    const missingSample = structuredClone(resources)
    delete (missingSample[0] as Partial<StereoConfidenceResource>).sampledPeakRssBytes
    expect(evaluateStereoConfidenceEligibility(cases, missingSample).gates.everyTrialResource).toBe(false)

    expect(evaluateStereoConfidenceEligibility(cases, resources.slice(1)).gates.everyTrialResource).toBe(false)
    expect(evaluateStereoConfidenceEligibility(cases, [...resources, { ...resources[0]! }]).gates.everyTrialResource).toBe(false)

    const unknownCase = structuredClone(resources)
    unknownCase[0]!.caseId = 'unknown-case'
    expect(evaluateStereoConfidenceEligibility(cases, unknownCase).gates.everyTrialResource).toBe(false)

    const unknownVariant = structuredClone(resources)
    unknownVariant[0]!.variantId = 'unknown-variant' as StereoConfidenceVariantId
    expect(evaluateStereoConfidenceEligibility(cases, unknownVariant).gates.everyTrialResource).toBe(false)
  })

  it('rejects missing cases and duplicate variant entries instead of silently dropping trials', () => {
    expect(() => evaluateStereoConfidenceEligibility([], [])).toThrow(/Distinct confidence cases/)
    const duplicateCase = eligibleCases()
    duplicateCase.push({ ...duplicateCase[0]!, variants: [...duplicateCase[0]!.variants] })
    expect(() => evaluateStereoConfidenceEligibility(duplicateCase, completeResources(duplicateCase))).toThrow(/Distinct confidence cases/)
    const missingVariant = eligibleCases()
    missingVariant[0]!.variants.pop()
    expect(() => evaluateStereoConfidenceEligibility(missingVariant, completeResources(missingVariant))).toThrow(/Every fixed variant must be retained once per case/)
    const duplicateVariant = eligibleCases()
    duplicateVariant[0]!.variants[0] = { ...duplicateVariant[0]!.variants[1]! }
    expect(() => evaluateStereoConfidenceEligibility(duplicateVariant, completeResources(duplicateVariant))).toThrow(/Every fixed variant must be retained once per case/)
  })
})
