import { reconstructStereo } from './spatial-stereo.ts'
import { reconstructStereoSgm, reconstructStereoSgmAblation, STEREO_SGM_SETTINGS } from './spatial-stereo-sgm.ts'
import { evaluateStereoGeometry } from './spatial-stereo-geometry.ts'
import { compareStereoSupport } from './spatial-stereo-ablation.ts'
import { evaluateStereoRegions, summarizeStereoComparison } from './spatial-stereo-comparison.ts'
import { STEREO_SETTINGS, type StereoInput, type StereoResult } from './spatial-stereo-types.ts'
import type { StereoConfidenceCase } from './test-fixtures/stereo-confidence.ts'

export const STEREO_CONFIDENCE_VARIANTS = Object.freeze([
  Object.freeze({ id: 'sad-baseline', method: 'rectified-rgb-sad-v1', textureGate: true }),
  Object.freeze({ id: 'census-sgm', method: 'rectified-census-sgm-v1', textureGate: true }),
  Object.freeze({ id: 'no-variance-proposal', method: 'development-only-no-variance-proposal', textureGate: false }),
] as const)
export type StereoConfidenceVariantId = typeof STEREO_CONFIDENCE_VARIANTS[number]['id']
export const STEREO_CONFIDENCE_GATES = Object.freeze({ maximumUnsupportedFraction: 0.01, maxWallTimeMs: 30_000, maxPeakRssBytes: 512 * 1024 * 1024 })

/** One fixed proposal; no search or truth/mask access in the estimator. */
export function reconstructStereoConfidence(input: StereoInput, variantId: string): StereoResult {
  if (variantId === 'sad-baseline') return reconstructStereo(input, STEREO_SETTINGS)
  if (variantId === 'census-sgm') return reconstructStereoSgm(input, STEREO_SETTINGS, STEREO_SGM_SETTINGS)
  if (variantId === 'no-variance-proposal') return reconstructStereoSgmAblation(input, STEREO_SETTINGS, 'without-texture')
  throw new Error('Unsupported confidence variant.')
}

export function scoreStereoConfidence(control: StereoConfidenceCase, result: StereoResult, reference?: StereoResult) {
  if (control.fixture.split !== 'development') throw new Error('Confidence controls must be development-only.')
  const geometry = evaluateStereoGeometry(result, control.fixture.truth)
  const unsupported = new Set(control.unsupportedPixels)
  if (unsupported.size !== control.unsupportedPixels.length || [...unsupported].some(pixel => !Number.isInteger(pixel) || pixel < 0 || pixel >= result.width * result.height)) throw new Error('Invalid unsupported correspondence mask.')
  const acceptedPixels = result.points.filter(point => unsupported.has(point.pixelIndex)).length
  return { geometry, outcomes: result.counts, regions: evaluateStereoRegions(control.fixture, result), unsupported: { pixels: unsupported.size, acceptedPixels, fraction: unsupported.size ? acceptedPixels / unsupported.size : null }, supportVsFullSgm: reference ? compareStereoSupport(reference, result, control.fixture.truth) : null }
}
export type StereoConfidenceScore = ReturnType<typeof scoreStereoConfidence>
export type StereoConfidenceCaseScore = { id: string; role: 'positive' | 'negative'; variants: { id: StereoConfidenceVariantId; score: StereoConfidenceScore | null }[] }
export type StereoConfidenceResource = { caseId: string; variantId: StereoConfidenceVariantId; completed: boolean; wallTimeMs: number; peakRssBytes: number | null; sampledPeakRssBytes: number | null }

/** Eligibility is a development decision, never automatic default promotion. */
export function evaluateStereoConfidenceEligibility(cases: readonly StereoConfidenceCaseScore[], resources: readonly StereoConfidenceResource[]) {
  if (cases.length === 0 || new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Distinct confidence cases are required.')
  for (const item of cases) {
    if (item.variants.length !== STEREO_CONFIDENCE_VARIANTS.length || new Set(item.variants.map(variant => variant.id)).size !== STEREO_CONFIDENCE_VARIANTS.length || STEREO_CONFIDENCE_VARIANTS.some(variant => !item.variants.some(value => value.id === variant.id))) throw new Error('Every fixed variant must be retained once per case, including failed trials.')
  }
  const positives = cases.filter(item => item.role === 'positive'), negatives = cases.filter(item => item.role === 'negative')
  const get = (item: StereoConfidenceCaseScore, id: StereoConfidenceVariantId) => item.variants.find(variant => variant.id === id)!.score
  const completePositive = positives.length > 0 && positives.every(item => get(item, 'sad-baseline') !== null && get(item, 'no-variance-proposal') !== null)
  const relative = completePositive ? summarizeStereoComparison(positives.map(item => ({ id: item.id, split: 'development' as const, baseline: get(item, 'sad-baseline')!.geometry, candidate: get(item, 'no-variance-proposal')!.geometry, regions: {} }))) : null
  const absolute = positives.map(item => ({ id: item.id, passed: get(item, 'no-variance-proposal')?.geometry.passed === true }))
  const unsupported = negatives.map(item => { const score = get(item, 'no-variance-proposal')?.unsupported; return { id: item.id, ...(score ?? { pixels: 0, acceptedPixels: null, fraction: null }), passed: score !== undefined && score.pixels > 0 && score.fraction !== null && score.fraction <= STEREO_CONFIDENCE_GATES.maximumUnsupportedFraction } })
  const resourceChecks = cases.flatMap(item => STEREO_CONFIDENCE_VARIANTS.map(variant => {
    const matches = resources.filter(trial => trial.caseId === item.id && trial.variantId === variant.id)
    const trial = matches[0]
    const passed = matches.length === 1 && trial !== undefined && trial.completed && Number.isFinite(trial.wallTimeMs) && trial.wallTimeMs >= 0 && trial.wallTimeMs <= STEREO_CONFIDENCE_GATES.maxWallTimeMs && trial.peakRssBytes !== null && Number.isFinite(trial.peakRssBytes) && trial.peakRssBytes > 0 && trial.peakRssBytes <= STEREO_CONFIDENCE_GATES.maxPeakRssBytes && (trial.sampledPeakRssBytes === null || (Number.isFinite(trial.sampledPeakRssBytes) && trial.sampledPeakRssBytes >= 0 && trial.sampledPeakRssBytes <= STEREO_CONFIDENCE_GATES.maxPeakRssBytes))
    return { caseId: item.id, variantId: variant.id, passed }
  }))
  const gates = { everyPositiveAbsolute: positives.length > 0 && absolute.every(item => item.passed), pooledRelative: relative?.passed === true, everyNegativeUnsupported: negatives.length > 0 && unsupported.every(item => item.passed), everyTrialResource: resources.length === cases.length * STEREO_CONFIDENCE_VARIANTS.length && resourceChecks.every(item => item.passed) }
  return { eligible: Object.values(gates).every(Boolean), gates, relative, positiveAbsolute: absolute, negativeUnsupported: unsupported, resourceChecks }
}
