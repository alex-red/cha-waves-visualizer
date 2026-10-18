import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoInput, type StereoOutcome, type StereoResult, type StereoSettings, type StereoView } from './spatial-stereo-types.ts'
import { validateStereoInput } from './spatial-stereo.ts'
import { reconstructStereoSgmAblation } from './spatial-stereo-sgm.ts'

/** Fixed post-filter rule; the ratio is read from the existing stereo settings. */
export const LOCAL_AMBIGUITY_RULE = Object.freeze({
  censusRadius: 2,
  maxRawCensusCost: 6,
  excludedNeighborLabels: 1,
  competitorRatioSetting: 'settings.uniquenessRatio',
  requireBothDirections: true,
})

const GRAY = [0.299, 0.587, 0.114] as const
const OUTCOME_CODE: Readonly<Record<StereoOutcome, number>> = Object.freeze(
  Object.fromEntries(STEREO_OUTCOMES.map((outcome, index) => [outcome, index])) as Record<StereoOutcome, number>,
)

function grayAt(rgb: Uint8Array<ArrayBuffer>, width: number, x: number, y: number): number {
  const index = (y * width + x) * 3
  return rgb[index]! * GRAY[0] + rgb[index + 1]! * GRAY[1] + rgb[index + 2]! * GRAY[2]
}

function censusDescriptorAt(rgb: Uint8Array<ArrayBuffer>, width: number, x: number, y: number): number {
  const center = grayAt(rgb, width, x, y)
  let descriptor = 0
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    if (dx === 0 && dy === 0) continue
    descriptor = (descriptor << 1) | (grayAt(rgb, width, x + dx, y + dy) < center ? 1 : 0)
  }
  return descriptor
}

/** Raw 5x5 grayscale Census Hamming cost at two explicit patch centers; null means invalid support. */
export function censusRawHammingCost(reference: StereoView, source: StereoView, referenceX: number, y: number, sourceX: number): number | null {
  const { width, height, rgb: refRgb } = reference.image
  const { width: sourceWidth, height: sourceHeight, rgb: sourceRgb } = source.image
  const radius = LOCAL_AMBIGUITY_RULE.censusRadius
  if (sourceWidth !== width || sourceHeight !== height || refRgb.length !== width * height * 3 || sourceRgb.length !== width * height * 3) return null
  if (![referenceX, sourceX, y].every(Number.isInteger) || referenceX < radius || referenceX >= width - radius || sourceX < radius || sourceX >= width - radius || y < radius || y >= height - radius) return null
  return hamming(censusDescriptorAt(refRgb, width, referenceX, y), censusDescriptorAt(sourceRgb, width, sourceX, y))
}

function census(rgb: Uint8Array<ArrayBuffer>, width: number, height: number): Uint32Array<ArrayBuffer> {
  const descriptors = new Uint32Array(width * height)
  for (let y = LOCAL_AMBIGUITY_RULE.censusRadius; y < height - LOCAL_AMBIGUITY_RULE.censusRadius; y += 1) {
    for (let x = LOCAL_AMBIGUITY_RULE.censusRadius; x < width - LOCAL_AMBIGUITY_RULE.censusRadius; x += 1) {
      descriptors[y * width + x] = censusDescriptorAt(rgb, width, x, y)
    }
  }
  return descriptors
}

function hamming(left: number, right: number): number {
  let value = left ^ right
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

type DirectionCensus = { reference: Uint32Array<ArrayBuffer>; source: Uint32Array<ArrayBuffer>; width: number; height: number; direction: -1 | 1 }

function candidateCost(censusPair: DirectionCensus, x: number, y: number, disparity: number): number | null {
  const sourceX = x + censusPair.direction * disparity
  const radius = LOCAL_AMBIGUITY_RULE.censusRadius
  if (x < radius || x >= censusPair.width - radius || y < radius || y >= censusPair.height - radius || sourceX < radius || sourceX >= censusPair.width - radius) return null
  const refIndex = y * censusPair.width + x
  const sourceIndex = y * censusPair.width + sourceX
  return hamming(censusPair.reference[refIndex]!, censusPair.source[sourceIndex]!)
}

function directionPasses(censusPair: DirectionCensus, x: number, y: number, anchor: number, settings: StereoSettings): boolean {
  if (!Number.isInteger(anchor) || anchor < settings.minDisparity || anchor > settings.maxDisparity) return false
  const winner = candidateCost(censusPair, x, y, anchor)
  if (winner === null || winner > LOCAL_AMBIGUITY_RULE.maxRawCensusCost) return false
  let competitor = Infinity
  for (let disparity = settings.minDisparity; disparity <= settings.maxDisparity; disparity += 1) {
    if (Math.abs(disparity - anchor) <= LOCAL_AMBIGUITY_RULE.excludedNeighborLabels) continue
    const cost = candidateCost(censusPair, x, y, disparity)
    if (cost !== null) competitor = Math.min(competitor, cost)
  }
  return Number.isFinite(competitor) && competitor > 0 && winner / competitor <= settings.uniquenessRatio
}

function validBaseResult(base: StereoResult, width: number, height: number, baselineM: number, settings: StereoSettings): void {
  if (base.width !== width || base.height !== height || Math.abs(base.baselineM - baselineM) > 1e-12) throw new Error(`baseResult calibration does not match input (${base.width}x${base.height}/${base.baselineM} versus ${width}x${height}/${baselineM}).`)
  const settingKeys = ['minDisparity', 'maxDisparity', 'patchRadius', 'minTextureVariance', 'maxMeanAbsoluteError', 'uniquenessRatio', 'leftRightTolerancePx'] as const
  if (!base.settings || settingKeys.some(key => base.settings[key] !== settings[key])) throw new Error('baseResult settings are invalid or do not match input.')
  if (!(base.outcomes instanceof Uint8Array) || base.outcomes.length !== width * height) throw new Error('baseResult outcomes are invalid.')
  if (!base.counts || !Array.isArray(base.points)) throw new Error('baseResult accounting is invalid.')
  const observed: Record<StereoOutcome, number> = { border: 0, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 }
  for (const code of base.outcomes) {
    const outcome = STEREO_OUTCOMES[code]
    if (!outcome) throw new Error('baseResult contains an unknown outcome code.')
    observed[outcome] += 1
  }
  for (const outcome of STEREO_OUTCOMES) {
    if (!Number.isSafeInteger(base.counts[outcome]) || base.counts[outcome] !== observed[outcome]) throw new Error('baseResult outcome histogram is inconsistent.')
  }
  if (base.points.length !== observed.accepted || base.status !== (observed.accepted > 0 ? 'reconstructed' : 'empty')) throw new Error('baseResult accepted points are inconsistent.')
  const seen = new Set<number>()
  for (const point of base.points) {
    if (!Number.isSafeInteger(point.pixelIndex) || point.pixelIndex < 0 || point.pixelIndex >= width * height || seen.has(point.pixelIndex) || base.outcomes[point.pixelIndex] !== OUTCOME_CODE.accepted) throw new Error('baseResult point indices are invalid or duplicated.')
    seen.add(point.pixelIndex)
  }
}

/**
 * The base matcher has already applied left-right consistency and component removal.
 * This post-filter changes only accepted points; it does not rerun either screen, so
 * retained accepted islands may fragment.
 */
export function filterStereoLocalAmbiguity(input: StereoInput, baseResult: StereoResult): StereoResult {
  const checked = validateStereoInput(input, baseResult?.settings)
  if (checked.settings.patchRadius !== LOCAL_AMBIGUITY_RULE.censusRadius) throw new Error('settings.patchRadius must equal 2 for the supported 5x5 Census descriptor.')
  const { settings, baselineM } = checked
  const { width, height } = checked.left.image
  validBaseResult(baseResult, width, height, baselineM, settings)

  const leftCensus = census(checked.left.image.rgb, width, height)
  const rightCensus = census(checked.right.image.rgb, width, height)
  const leftToRight: DirectionCensus = { reference: leftCensus, source: rightCensus, width, height, direction: -1 }
  const rightToLeft: DirectionCensus = { reference: rightCensus, source: leftCensus, width, height, direction: 1 }
  const outcomes = baseResult.outcomes.slice()
  const points: StereoResult['points'] = []
  let rejected = 0
  for (const point of baseResult.points) {
    const x = point.pixelIndex % width
    const y = Math.floor(point.pixelIndex / width)
    const disparity = point.disparityPx
    const anchor = Number.isFinite(disparity) ? Math.round(disparity) : Number.NaN
    const rightX = Number.isFinite(disparity) ? Math.round(x - disparity) : -1
    const passes = directionPasses(leftToRight, x, y, anchor, settings)
      && directionPasses(rightToLeft, rightX, y, anchor, settings)
    if (passes) points.push(point)
    else {
      outcomes[point.pixelIndex] = OUTCOME_CODE.ambiguous!
      rejected += 1
    }
  }
  const counts = { ...baseResult.counts, accepted: baseResult.counts.accepted - rejected, ambiguous: baseResult.counts.ambiguous + rejected }
  return { ...baseResult, status: points.length > 0 ? 'reconstructed' : 'empty', outcomes, counts, points }
}

/** No-variance proposal followed by fixed bidirectional local Census ambiguity filtering. */
export function reconstructStereoLocalAmbiguity(input: StereoInput, settings: StereoSettings = STEREO_SETTINGS): StereoResult {
  const base = reconstructStereoSgmAblation(input, settings, 'without-texture')
  return filterStereoLocalAmbiguity(input, base)
}
