import { reconstructStereo } from './spatial-stereo.ts'
import { reconstructStereoSgm } from './spatial-stereo-sgm.ts'
import { evaluateStereoGeometry, type StereoGeometryReport } from './spatial-stereo-geometry.ts'
import { STEREO_SETTINGS, type StereoResult, type StereoSettings } from './spatial-stereo-types.ts'
import type { StereoDevelopmentCase } from './test-fixtures/stereo-development.ts'

export const STEREO_COMPARISON_GATES = Object.freeze({ minimumMissingAwareImprovement: 0.02, maximumCoverageLoss: 0.02 })

/** Diagnostic masks affect evaluation only; they never remove full-scene truth. */
export function evaluateStereoRegions(fixture: StereoDevelopmentCase, result: StereoResult) {
  return Object.fromEntries(Object.entries(fixture.regions).map(([name, indexes]) => {
    const mask = new Set(indexes)
    const truth = { camera: fixture.truth.camera, disparityPx: fixture.truth.disparityPx.map((value, index) => mask.has(index) ? value : null), depthM: fixture.truth.depthM.map((value, index) => mask.has(index) ? value : null) }
    const score = evaluateStereoGeometry(result, truth)
    return [name, { pixelCount: indexes.length, validTruthPixels: score.validTruthPixels, acceptedWithTruth: score.acceptedWithTruth, unestimatedTruthPixels: score.unestimatedTruthPixels, truthCoverage: score.truthCoverage, disparity: score.disparity, depth: score.depth }]
  }))
}

export function compareStereoCase(fixture: StereoDevelopmentCase, settings: StereoSettings = STEREO_SETTINGS) {
  // Neither estimator receives the reference geometry or diagnostic masks.
  const baseline = reconstructStereo(fixture.input, settings)
  const candidate = reconstructStereoSgm(fixture.input, settings)
  const evaluate = (result: typeof baseline) => evaluateStereoGeometry(result, fixture.truth)
  const baselineScore = evaluate(baseline), candidateScore = evaluate(candidate)
  const baselineRegions = evaluateStereoRegions(fixture, baseline), candidateRegions = evaluateStereoRegions(fixture, candidate)
  const regions = Object.fromEntries(Object.entries(baselineRegions).map(([name, region]) => {
    const { pixelCount, ...baseline } = region
    const { pixelCount: _count, ...candidate } = candidateRegions[name]!
    return [name, { pixelCount, baseline, candidate }]
  }))
  return { baseline, candidate, score: { id: fixture.id, split: fixture.split, baseline: baselineScore, candidate: candidateScore, regions } }
}

export type StereoComparisonScore = ReturnType<typeof compareStereoCase>['score']

/** Pool counts, rather than averaging rates with different coverage denominators. */
export function poolStereoGeometry(scores: readonly Pick<StereoGeometryReport, 'validTruthPixels' | 'acceptedWithTruth' | 'unestimatedTruthPixels' | 'disparity'>[]) {
  const totals = scores.reduce((sum, item) => ({ validTruthPixels: sum.validTruthPixels + item.validTruthPixels, acceptedWithTruth: sum.acceptedWithTruth + item.acceptedWithTruth, unestimatedTruthPixels: sum.unestimatedTruthPixels + item.unestimatedTruthPixels, bad1Count: sum.bad1Count + item.disparity.bad1Count }), { validTruthPixels: 0, acceptedWithTruth: 0, unestimatedTruthPixels: 0, bad1Count: 0 })
  return { ...totals, truthCoverage: totals.validTruthPixels ? totals.acceptedWithTruth / totals.validTruthPixels : null, bad1AmongEstimates: totals.acceptedWithTruth ? totals.bad1Count / totals.acceptedWithTruth : null, bad1IncludingMissing: totals.validTruthPixels ? (totals.bad1Count + totals.unestimatedTruthPixels) / totals.validTruthPixels : null }
}

export function summarizeStereoComparison(scores: readonly StereoComparisonScore[]) {
  if (scores.length === 0) throw new Error('At least one comparison case is required.')
  const baseline = poolStereoGeometry(scores.map(score => score.baseline)), candidate = poolStereoGeometry(scores.map(score => score.candidate))
  const missingAwareImprovement = baseline.bad1IncludingMissing !== null && candidate.bad1IncludingMissing !== null ? baseline.bad1IncludingMissing - candidate.bad1IncludingMissing : null
  const coverageChange = baseline.truthCoverage !== null && candidate.truthCoverage !== null ? candidate.truthCoverage - baseline.truthCoverage : null
  const gates = {
    minimumMissingAwareImprovement: missingAwareImprovement !== null && missingAwareImprovement >= STEREO_COMPARISON_GATES.minimumMissingAwareImprovement,
    maximumCoverageLoss: coverageChange !== null && coverageChange >= -STEREO_COMPARISON_GATES.maximumCoverageLoss,
    noBad1Regression: candidate.bad1AmongEstimates !== null && baseline.bad1AmongEstimates !== null && candidate.bad1AmongEstimates <= baseline.bad1AmongEstimates,
  }
  return { baseline, candidate, missingAwareImprovement, coverageChange, gates, passed: Object.values(gates).every(Boolean) }
}
