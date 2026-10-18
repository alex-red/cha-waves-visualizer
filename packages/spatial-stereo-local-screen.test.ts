import { describe, expect, it } from 'vitest'
import { evaluateStereoLocalEligibility, LOCAL_SCREEN_VARIANTS, reconstructStereoLocalScreen, type LocalScreenCaseScore, type LocalScreenResource } from './spatial-stereo-local-screen.ts'
import { evaluateStereoConfidenceEligibility, type StereoConfidenceCaseScore, type StereoConfidenceScore, type StereoConfidenceResource } from './spatial-stereo-confidence.ts'

function score(accepted: number, bad: number, positive: boolean): StereoConfidenceScore {
  const valid = positive ? 100 : 0, total = positive ? 100 : 1000
  const passed = positive && accepted >= 35 && bad / accepted <= 0.1
  return {
    geometry: { totalPixels: total, validTruthPixels: valid, missingTruthPixels: total - valid, acceptedPixels: accepted, acceptedWithTruth: positive ? accepted : 0, acceptedWithoutTruth: positive ? 0 : accepted, unestimatedTruthPixels: valid - accepted, truthCoverage: positive ? accepted / valid : null, disparity: { meanAbsoluteErrorPx: null, p50AbsoluteErrorPx: null, p90AbsoluteErrorPx: null, maxAbsoluteErrorPx: null, bad1Count: bad, bad1AmongEstimatesFraction: accepted ? bad / accepted : null, bad1IncludingMissingFraction: positive ? (bad + valid - accepted) / valid : null }, depth: { meanAbsoluteErrorM: 0.05, p50AbsoluteErrorM: 0.05, p90AbsoluteErrorM: 0.05, maxAbsoluteErrorM: 0.05 }, worstErrors: [], gates: { minimumTruthCoverage: passed, maximumBad1Fraction: passed, maximumDepthP90M: passed, passed }, passed },
    outcomes: { border: total - accepted, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted }, regions: {}, unsupported: { pixels: positive ? 0 : total, acceptedPixels: positive ? 0 : accepted, fraction: positive ? null : accepted / total }, supportVsFullSgm: null,
  }
}

function experiment() {
  const cases: LocalScreenCaseScore[] = [
    { id: 'positive', role: 'positive', variants: [{ id: 'sad-baseline', score: score(50, 10, true) }, { id: 'census-sgm', score: score(60, 6, true) }, { id: 'local-ambiguity-proposal', score: score(80, 5, true) }] },
    { id: 'negative', role: 'negative', variants: LOCAL_SCREEN_VARIANTS.map(variant => ({ id: variant.id, score: score(0, 0, false) })) },
  ]
  const resources: LocalScreenResource[] = cases.flatMap(item => LOCAL_SCREEN_VARIANTS.map(variant => ({ caseId: item.id, variantId: variant.id, completed: true, wallTimeMs: 30_000, peakRssBytes: 512 * 1024 * 1024, sampledPeakRssBytes: null })))
  return { cases, resources }
}

describe('local proposal reuses the fixed confidence criteria', () => {
  it('adapts internal roles while keeping the new proposal identity in artifacts', () => {
    const { cases, resources } = experiment()
    const result = evaluateStereoLocalEligibility(cases, resources)
    expect(result.eligible).toBe(true)
    expect(result.resourceChecks.map(item => item.variantId)).toContain('local-ambiguity-proposal')
    expect(JSON.stringify(result)).not.toContain('no-variance-proposal')
    const role = (id: string) => id === 'local-ambiguity-proposal' ? 'no-variance-proposal' : id
    const original = evaluateStereoConfidenceEligibility(cases.map(item => ({ ...item, variants: item.variants.map(variant => ({ ...variant, id: role(variant.id) })) })) as StereoConfidenceCaseScore[], resources.map(item => ({ ...item, variantId: role(item.variantId) })) as StereoConfidenceResource[])
    expect(result.gates).toEqual(original.gates)
    expect(result.relative).toEqual(original.relative)
    expect(result.negativeUnsupported).toEqual(original.negativeUnsupported)
  })

  it('retains the one-percent cap, failed-trial rules and resource budget unchanged', () => {
    const { cases, resources } = experiment()
    const negative = cases[1]!.variants.find(item => item.id === 'local-ambiguity-proposal')!.score!
    negative.unsupported = { pixels: 1000, acceptedPixels: 10, fraction: 0.01 }
    expect(evaluateStereoLocalEligibility(cases, resources).eligible).toBe(true)
    negative.unsupported = { pixels: 1000, acceptedPixels: 11, fraction: 0.011 }
    expect(evaluateStereoLocalEligibility(cases, resources).gates.everyNegativeUnsupported).toBe(false)
    negative.unsupported = { pixels: 1000, acceptedPixels: 0, fraction: 0 }
    resources[0]!.wallTimeMs++
    expect(evaluateStereoLocalEligibility(cases, resources).gates.everyTrialResource).toBe(false)
    resources[0]!.wallTimeMs--
    cases[0]!.variants.find(item => item.id === 'local-ambiguity-proposal')!.score = null
    expect(evaluateStereoLocalEligibility(cases, resources).eligible).toBe(false)
  })

  it('rejects unsupported methods before reconstruction and freezes all variant metadata', () => {
    expect(() => reconstructStereoLocalScreen({} as never, 'no-variance-proposal')).toThrow(/Unsupported/)
    expect(Object.isFrozen(LOCAL_SCREEN_VARIANTS)).toBe(true)
    expect(LOCAL_SCREEN_VARIANTS.every(Object.isFrozen)).toBe(true)
  })
})
