import { reconstructStereo } from './spatial-stereo.ts'
import { reconstructStereoSgmAblation, STEREO_SGM_ABLATIONS } from './spatial-stereo-sgm.ts'
import { evaluateStereoGeometry, type StereoGeometryTruth } from './spatial-stereo-geometry.ts'
import { evaluateStereoRegions, poolStereoGeometry } from './spatial-stereo-comparison.ts'
import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoResult, type StereoSettings } from './spatial-stereo-types.ts'
import type { StereoDevelopmentCase } from './test-fixtures/stereo-development.ts'

/** Fixed diagnostic controls, not selectable production reconstruction methods. */
export const STEREO_ABLATION_VARIANTS = Object.freeze([
  Object.freeze({ id: 'sad-baseline' as const, family: 'sad' as const, configuration: null }),
  ...STEREO_SGM_ABLATIONS.map(configuration => Object.freeze({ id: configuration.id, family: 'census' as const, configuration })),
])

/** Compare accepted support using evaluator-only truth; missing truth stays unknown. */
export function compareStereoSupport(reference: StereoResult, variant: StereoResult, truth: StereoGeometryTruth) {
  evaluateStereoGeometry(reference, truth)
  evaluateStereoGeometry(variant, truth)
  const referencePoints = new Map(reference.points.map(point => [point.pixelIndex, point]))
  const variantPoints = new Map(variant.points.map(point => [point.pixelIndex, point]))
  const gained = { correct: 0, bad: 0, unknown: 0 }, lost = { correct: 0, bad: 0, unknown: 0 }
  const retained = { correctToCorrect: 0, correctToBad: 0, badToCorrect: 0, badToBad: 0, unknown: 0 }
  const outcomeTransitions = Object.fromEntries(STEREO_OUTCOMES.map(from => [from, Object.fromEntries(STEREO_OUTCOMES.map(to => [to, 0]))])) as Record<typeof STEREO_OUTCOMES[number], Record<typeof STEREO_OUTCOMES[number], number>>
  let rejectedByBoth = 0
  for (let pixel = 0; pixel < reference.outcomes.length; pixel++) {
    outcomeTransitions[STEREO_OUTCOMES[reference.outcomes[pixel]!]!]![STEREO_OUTCOMES[variant.outcomes[pixel]!]!]++
    const before = referencePoints.get(pixel), after = variantPoints.get(pixel)
    const disparity = truth.disparityPx[pixel]!
    const classify = (point: NonNullable<typeof before>) => disparity === null ? 'unknown' : Math.abs(point.disparityPx - disparity) > 1 ? 'bad' : 'correct'
    if (!before && !after) { rejectedByBoth++; continue }
    if (!before && after) { gained[classify(after)]++; continue }
    if (before && !after) { lost[classify(before)]++; continue }
    const a = classify(before!), b = classify(after!)
    if (a === 'unknown' || b === 'unknown') retained.unknown++
    else if (a === 'correct' && b === 'correct') retained.correctToCorrect++
    else if (a === 'correct') retained.correctToBad++
    else if (b === 'correct') retained.badToCorrect++
    else retained.badToBad++
  }
  return { gained, lost, retained, rejectedByBoth, outcomeTransitions }
}

export function runStereoAblationCase(fixture: StereoDevelopmentCase, settings: StereoSettings = STEREO_SETTINGS, onRuntime?: (id: string, elapsedMs: number) => void) {
  if (fixture.split !== 'development') throw new Error('Ablation accepts development cases only.')
  // Each estimator sees the stereo input alone; truth and masks enter only below.
  const results = STEREO_ABLATION_VARIANTS.map(variant => {
    const started = performance.now()
    const result = variant.family === 'sad' ? reconstructStereo(fixture.input, settings) : reconstructStereoSgmAblation(fixture.input, settings, variant.id)
    onRuntime?.(variant.id, performance.now() - started)
    return { id: variant.id, result }
  })
  const reference = results.find(item => item.id === 'census-sgm')!.result
  const scores = results.map(({ id, result }) => ({ id, outcomes: result.counts, geometry: evaluateStereoGeometry(result, fixture.truth), regions: evaluateStereoRegions(fixture, result), supportVsFullSgm: compareStereoSupport(reference, result, fixture.truth) }))
  return { results, score: { id: fixture.id, split: fixture.split, variants: scores } }
}

export type StereoAblationScore = ReturnType<typeof runStereoAblationCase>['score']

export function summarizeStereoAblations(cases: readonly StereoAblationScore[]) {
  if (cases.length === 0 || cases.some(item => item.split !== 'development')) throw new Error('At least one development ablation case is required.')
  for (const item of cases) {
    if (item.variants.length !== STEREO_ABLATION_VARIANTS.length || new Set(item.variants.map(variant => variant.id)).size !== STEREO_ABLATION_VARIANTS.length || STEREO_ABLATION_VARIANTS.some(variant => !item.variants.some(score => score.id === variant.id))) throw new Error('Every case must include each fixed ablation variant exactly once.')
  }
  return STEREO_ABLATION_VARIANTS.map(variant => {
    const scores = cases.map(item => item.variants.find(score => score.id === variant.id)!)
    const pooled = poolStereoGeometry(scores.map(score => score.geometry))
    const sum = (kind: 'gained' | 'lost') => scores.reduce((total, score) => ({ correct: total.correct + score.supportVsFullSgm[kind].correct, bad: total.bad + score.supportVsFullSgm[kind].bad, unknown: total.unknown + score.supportVsFullSgm[kind].unknown }), { correct: 0, bad: 0, unknown: 0 })
    const outcomes = Object.fromEntries(STEREO_OUTCOMES.map(outcome => [outcome, scores.reduce((total, score) => total + score.outcomes[outcome], 0)]))
    const retainedVsFullSgm = scores.reduce((total, score) => {
      for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += score.supportVsFullSgm.retained[key]
      return total
    }, { correctToCorrect: 0, correctToBad: 0, badToCorrect: 0, badToBad: 0, unknown: 0 })
    return { id: variant.id, pooled, outcomes, gainedVsFullSgm: sum('gained'), lostVsFullSgm: sum('lost'), retainedVsFullSgm }
  })
}
