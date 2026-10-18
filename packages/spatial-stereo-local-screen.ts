import { reconstructStereo } from './spatial-stereo.ts'
import { reconstructStereoSgm } from './spatial-stereo-sgm.ts'
import { reconstructStereoLocalAmbiguity } from './spatial-stereo-local-ambiguity.ts'
import { evaluateStereoConfidenceEligibility, type StereoConfidenceCaseScore, type StereoConfidenceResource, type StereoConfidenceScore, type StereoConfidenceVariantId } from './spatial-stereo-confidence.ts'
import { STEREO_SETTINGS, type StereoInput, type StereoResult } from './spatial-stereo-types.ts'

export const LOCAL_SCREEN_VARIANTS = Object.freeze([
  Object.freeze({ id: 'sad-baseline', method: 'rectified-rgb-sad-v1', textureGate: true, localAmbiguityGate: false }),
  Object.freeze({ id: 'census-sgm', method: 'rectified-census-sgm-v1', textureGate: true, localAmbiguityGate: false }),
  Object.freeze({ id: 'local-ambiguity-proposal', method: 'development-only-local-ambiguity-proposal', textureGate: false, localAmbiguityGate: true }),
] as const)
export type LocalScreenVariantId = typeof LOCAL_SCREEN_VARIANTS[number]['id']
export type LocalScreenCaseScore = { id: string; role: 'positive' | 'negative'; variants: { id: LocalScreenVariantId; score: StereoConfidenceScore | null }[] }
export type LocalScreenResource = Omit<StereoConfidenceResource, 'variantId'> & { variantId: LocalScreenVariantId }

export function reconstructStereoLocalScreen(input: StereoInput, variantId: string): StereoResult {
  if (variantId === 'sad-baseline') return reconstructStereo(input, STEREO_SETTINGS)
  if (variantId === 'census-sgm') return reconstructStereoSgm(input, STEREO_SETTINGS)
  if (variantId === 'local-ambiguity-proposal') return reconstructStereoLocalAmbiguity(input, STEREO_SETTINGS)
  throw new Error('Unsupported local-screen variant.')
}

// The earlier eligibility implementation indexes three roles by their original
// IDs. Adapt those internal keys only; all new artifacts keep this proposal's
// distinct identity. This preserves the frozen criteria without changing old
// source files or reinterpreting their recorded results.
const TO_ROLE: Readonly<Record<LocalScreenVariantId, StereoConfidenceVariantId>> = Object.freeze({ 'sad-baseline': 'sad-baseline', 'census-sgm': 'census-sgm', 'local-ambiguity-proposal': 'no-variance-proposal' })
const FROM_ROLE: Readonly<Record<StereoConfidenceVariantId, LocalScreenVariantId>> = Object.freeze({ 'sad-baseline': 'sad-baseline', 'census-sgm': 'census-sgm', 'no-variance-proposal': 'local-ambiguity-proposal' })

export function evaluateStereoLocalEligibility(cases: readonly LocalScreenCaseScore[], resources: readonly LocalScreenResource[]) {
  const mappedCases: StereoConfidenceCaseScore[] = cases.map(item => ({ ...item, variants: item.variants.map(variant => ({ ...variant, id: TO_ROLE[variant.id] })) }))
  const mappedResources: StereoConfidenceResource[] = resources.map(item => ({ ...item, variantId: TO_ROLE[item.variantId] }))
  const decision = evaluateStereoConfidenceEligibility(mappedCases, mappedResources)
  return { ...decision, resourceChecks: decision.resourceChecks.map(item => ({ ...item, variantId: FROM_ROLE[item.variantId] })) }
}
