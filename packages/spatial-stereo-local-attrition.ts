import { evaluateStereoGeometry, type StereoGeometryTruth } from './spatial-stereo-geometry.ts'
import { LOCAL_AMBIGUITY_RULE, censusRawHammingCost } from './spatial-stereo-local-ambiguity.ts'
import { STEREO_OUTCOMES, type StereoInput, type StereoOutcome, type StereoPoint, type StereoResult, type StereoSettings, type StereoView } from './spatial-stereo-types.ts'
import { validateStereoInput } from './spatial-stereo.ts'

export type LocalAttritionFailure = 'invalid-anchor' | 'invalid-support' | 'raw-cost' | 'missing-competitor' | 'zero-competitor' | 'ratio' | 'pass'
export type LocalAttritionDirection = 'forward' | 'reverse'
export type LocalAttritionChecks = {
  anchor: boolean
  support: boolean | null
  rawCost: boolean | null
  competitorPresent: boolean | null
  competitorPositive: boolean | null
  ratio: boolean | null
}

export type LocalDirectionEvidence = {
  rawAnchorCost: number | null
  competitorCost: number | null
  competitorFirstLabel: number | null
  competitorTieCount: number
  validCompetitorCount: number
  ratio: number | null
  checks: LocalAttritionChecks
  firstFailure: LocalAttritionFailure
  failedPredicates: (keyof LocalAttritionChecks)[]
}

export type LocalPointEvidence = {
  pixelIndex: number
  disparityPx: number
  anchor: number
  rightX: number
  forward: LocalDirectionEvidence
  reverse: LocalDirectionEvidence
  retainedByEvidence: boolean
}

export type LocalAttritionBucket = 'retained' | 'forwardOnlyFailure' | 'reverseOnlyFailure' | 'bothFailure'
export type LocalErrorClass = 'correct' | 'bad' | 'unknown'
export type LocalAttritionBucketSummary = Record<LocalErrorClass, number> & { total: number }
export type LocalAttritionPartitions = Record<LocalAttritionBucket, LocalAttritionBucketSummary>
export type LocalDirectionFailureSummary = {
  evaluated: number
  firstFailures: Record<LocalAttritionFailure, LocalAttritionBucketSummary>
  failedPredicates: Record<keyof LocalAttritionChecks, LocalAttritionBucketSummary>
}
export type StereoLocalAttritionScore = {
  format: 'cha-stereo-local-attrition-v1'
  evidenceCount: number
  predictionMatchesFiltered: true
  partitions: LocalAttritionPartitions
  directions: Record<LocalAttritionDirection, LocalDirectionFailureSummary>
  regions: Record<string, { pixelCount: number; partitions: LocalAttritionPartitions; directions: Record<LocalAttritionDirection, LocalDirectionFailureSummary> }>
  unsupported: { maskPixels: number; baseAcceptedPixels: number; retained: number; lost: number }
  truthSupport: { validTruthPixels: number; baseAcceptedWithTruth: number; filteredAcceptedWithTruth: number; baseTruthCoverage: number | null; filteredTruthCoverage: number | null }
}

const FAILURE_ORDER: readonly Exclude<LocalAttritionFailure, 'pass'>[] = Object.freeze([
  'invalid-anchor', 'invalid-support', 'raw-cost', 'missing-competitor', 'zero-competitor', 'ratio',
])
const CHECK_ORDER: readonly (keyof LocalAttritionChecks)[] = Object.freeze([
  'anchor', 'support', 'rawCost', 'competitorPresent', 'competitorPositive', 'ratio',
])
const OUTCOME_CODE: Readonly<Record<StereoOutcome, number>> = Object.freeze(
  Object.fromEntries(STEREO_OUTCOMES.map((outcome, index) => [outcome, index])) as Record<StereoOutcome, number>,
)

function directionEvidence(reference: StereoView, source: StereoView, x: number, y: number, anchor: number, direction: -1 | 1, settings: StereoSettings): LocalDirectionEvidence {
  const anchorValid = Number.isInteger(anchor) && anchor >= settings.minDisparity && anchor <= settings.maxDisparity
  if (!anchorValid) {
    const checks: LocalAttritionChecks = { anchor: false, support: null, rawCost: null, competitorPresent: null, competitorPositive: null, ratio: null }
    return makeDirection(null, null, null, 0, 0, null, checks)
  }

  const rawAnchorCost = censusRawHammingCost(reference, source, x, y, x + direction * anchor)
  let competitorCost: number | null = null
  let competitorFirstLabel: number | null = null
  let competitorTieCount = 0
  let validCompetitorCount = 0
  for (let label = settings.minDisparity; label <= settings.maxDisparity; label += 1) {
    if (Math.abs(label - anchor) <= LOCAL_AMBIGUITY_RULE.excludedNeighborLabels) continue
    const cost = censusRawHammingCost(reference, source, x, y, x + direction * label)
    if (cost === null) continue
    validCompetitorCount += 1
    if (competitorCost === null || cost < competitorCost) {
      competitorCost = cost
      competitorFirstLabel = label
      competitorTieCount = 1
    } else if (cost === competitorCost) competitorTieCount += 1
  }

  const supportValid = rawAnchorCost !== null
  const rawCostValid = rawAnchorCost === null ? null : rawAnchorCost <= LOCAL_AMBIGUITY_RULE.maxRawCensusCost
  const competitorPresent = validCompetitorCount > 0
  const competitorPositive = competitorCost === null ? null : competitorCost > 0
  const ratio = rawAnchorCost !== null && competitorCost !== null && competitorCost > 0 ? rawAnchorCost / competitorCost : null
  const ratioValid = ratio === null ? null : ratio <= settings.uniquenessRatio
  const checks: LocalAttritionChecks = {
    anchor: true,
    support: supportValid,
    rawCost: rawCostValid,
    competitorPresent,
    competitorPositive,
    ratio: ratioValid,
  }
  return makeDirection(rawAnchorCost, competitorCost, competitorFirstLabel, competitorTieCount, validCompetitorCount, ratio, checks)
}

function makeDirection(rawAnchorCost: number | null, competitorCost: number | null, competitorFirstLabel: number | null, competitorTieCount: number, validCompetitorCount: number, ratio: number | null, checks: LocalAttritionChecks): LocalDirectionEvidence {
  const failedPredicates = CHECK_ORDER.filter(key => checks[key] === false)
  const firstFailure: LocalAttritionFailure = FAILURE_ORDER.find(failure => {
    const check = failure === 'invalid-anchor' ? 'anchor'
      : failure === 'invalid-support' ? 'support'
        : failure === 'raw-cost' ? 'rawCost'
          : failure === 'missing-competitor' ? 'competitorPresent'
            : failure === 'zero-competitor' ? 'competitorPositive' : 'ratio'
    return checks[check] === false
  }) ?? 'pass'
  return { rawAnchorCost, competitorCost, competitorFirstLabel, competitorTieCount, validCompetitorCount, ratio, checks, firstFailure, failedPredicates }
}

/**
 * Records fixed-rule local Census evidence for every accepted base point. It receives
 * only estimator input and base result; truth and diagnostic masks are not accepted.
 */
export function inspectStereoLocalEvidence(input: StereoInput, base: StereoResult): LocalPointEvidence[] {
  const checked = validateStereoInput(input, base?.settings)
  if (checked.settings.patchRadius !== LOCAL_AMBIGUITY_RULE.censusRadius) throw new Error('settings.patchRadius must equal 2 for the pinned 5x5 Census helper.')
  const { width, height } = checked.left.image
  if (base.width !== width || base.height !== height || Math.abs(base.baselineM - checked.baselineM) > 1e-12) throw new Error('base result calibration does not match input.')
  const emptyTruth: StereoGeometryTruth = { camera: checked.left.camera, disparityPx: Array(width * height).fill(null), depthM: Array(width * height).fill(null) }
  evaluateStereoGeometry(base, emptyTruth)
  return base.points.map(point => {
    const x = point.pixelIndex % width
    const y = Math.floor(point.pixelIndex / width)
    const disparityPx = point.disparityPx
    const anchor = Math.round(disparityPx)
    const rightX = Math.round(x - disparityPx)
    const forward = directionEvidence(checked.left, checked.right, x, y, anchor, -1, checked.settings)
    const reverse = directionEvidence(checked.right, checked.left, rightX, y, anchor, 1, checked.settings)
    return { pixelIndex: point.pixelIndex, disparityPx, anchor, rightX, forward, reverse, retainedByEvidence: forward.firstFailure === 'pass' && reverse.firstFailure === 'pass' }
  })
}

function failureFor(checks: LocalAttritionChecks): LocalAttritionFailure {
  const failure = FAILURE_ORDER.find(item => {
    const key = item === 'invalid-anchor' ? 'anchor' : item === 'invalid-support' ? 'support' : item === 'raw-cost' ? 'rawCost' : item === 'missing-competitor' ? 'competitorPresent' : item === 'zero-competitor' ? 'competitorPositive' : 'ratio'
    return checks[key] === false
  })
  return failure ?? 'pass'
}

function validateDirection(item: LocalDirectionEvidence, path: string, settings: StereoSettings, anchor: number): void {
  if (!item || typeof item !== 'object' || !item.checks || typeof item.checks !== 'object') throw new Error(`${path} is invalid.`)
  for (const key of CHECK_ORDER) if (item.checks[key] !== true && item.checks[key] !== false && item.checks[key] !== null) throw new Error(`${path}.checks.${key} must be true, false, or null.`)
  if (item.firstFailure !== failureFor(item.checks)) throw new Error(`${path}.firstFailure disagrees with its predicates.`)
  const failed = CHECK_ORDER.filter(key => item.checks[key] === false)
  if (!Array.isArray(item.failedPredicates) || item.failedPredicates.length !== failed.length || item.failedPredicates.some((key, index) => key !== failed[index])) throw new Error(`${path}.failedPredicates disagrees with its predicates.`)
  if (!Number.isSafeInteger(item.validCompetitorCount) || item.validCompetitorCount < 0 || !Number.isSafeInteger(item.competitorTieCount) || item.competitorTieCount < 0) throw new Error(`${path} competitor counts are invalid.`)
  if ((item.validCompetitorCount === 0) !== (item.competitorCost === null) || (item.competitorCost === null) !== (item.competitorFirstLabel === null) || (item.competitorCost === null) !== (item.competitorTieCount === 0)) throw new Error(`${path} competitor summary is inconsistent.`)
  if (item.competitorCost !== null && (!Number.isInteger(item.competitorCost) || item.competitorCost < 0 || item.competitorCost > 24 || item.competitorTieCount > item.validCompetitorCount)) throw new Error(`${path} competitor cost is invalid.`)
  if (item.rawAnchorCost !== null && (!Number.isInteger(item.rawAnchorCost) || item.rawAnchorCost < 0 || item.rawAnchorCost > 24)) throw new Error(`${path} raw anchor cost is invalid.`)
  if (item.ratio !== null && (!Number.isFinite(item.ratio) || item.ratio < 0)) throw new Error(`${path} ratio is invalid.`)
  if (!item.checks.anchor) {
    if (CHECK_ORDER.slice(1).some(key => item.checks[key] !== null) || item.rawAnchorCost !== null || item.competitorCost !== null || item.competitorFirstLabel !== null || item.validCompetitorCount !== 0 || item.competitorTieCount !== 0 || item.ratio !== null) throw new Error(`${path} must leave cost predicates unavailable for an invalid anchor.`)
    return
  }
  if (item.checks.support !== (item.rawAnchorCost !== null)) throw new Error(`${path} support predicate disagrees with raw anchor support.`)
  const rawCostCheck = item.rawAnchorCost === null ? null : item.rawAnchorCost <= LOCAL_AMBIGUITY_RULE.maxRawCensusCost
  const competitorPresent = item.validCompetitorCount > 0
  const competitorPositive = item.competitorCost === null ? null : item.competitorCost > 0
  const ratio = item.rawAnchorCost !== null && item.competitorCost !== null && item.competitorCost > 0 ? item.rawAnchorCost / item.competitorCost : null
  const ratioCheck = ratio === null ? null : ratio <= settings.uniquenessRatio
  if (item.checks.rawCost !== rawCostCheck || item.checks.competitorPresent !== competitorPresent || item.checks.competitorPositive !== competitorPositive || item.ratio !== ratio || item.checks.ratio !== ratioCheck) throw new Error(`${path} predicate values disagree with the recorded costs.`)
  if (item.competitorFirstLabel !== null && (!Number.isSafeInteger(item.competitorFirstLabel) || item.competitorFirstLabel < settings.minDisparity || item.competitorFirstLabel > settings.maxDisparity || Math.abs(item.competitorFirstLabel - anchor) <= LOCAL_AMBIGUITY_RULE.excludedNeighborLabels)) throw new Error(`${path} competitor label is invalid.`)
}

function validateEvidence(evidence: readonly LocalPointEvidence[], basePoints: readonly StereoPoint[], width: number, settings: StereoSettings): void {
  if (!Array.isArray(evidence) || evidence.length !== basePoints.length) throw new Error('evidence must contain one row per accepted base point.')
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index]!
    const point = basePoints[index]!
    if (item.pixelIndex !== point.pixelIndex || item.disparityPx !== point.disparityPx || item.anchor !== Math.round(point.disparityPx) || item.rightX !== Math.round((point.pixelIndex % width) - point.disparityPx)) throw new Error(`evidence[${index}] does not correspond to the base point.`)
    validateDirection(item.forward, `evidence[${index}].forward`, settings, item.anchor)
    validateDirection(item.reverse, `evidence[${index}].reverse`, settings, item.anchor)
    if (item.forward.checks.anchor !== (item.anchor >= settings.minDisparity && item.anchor <= settings.maxDisparity) || item.reverse.checks.anchor !== item.forward.checks.anchor) throw new Error(`evidence[${index}] anchor checks disagree with settings.`)
    if (item.retainedByEvidence !== (item.forward.firstFailure === 'pass' && item.reverse.firstFailure === 'pass')) throw new Error(`evidence[${index}].retainedByEvidence disagrees with direction evidence.`)
  }
}

function emptyBucket(): LocalAttritionBucketSummary { return { total: 0, correct: 0, bad: 0, unknown: 0 } }
function emptyPartitions(): LocalAttritionPartitions { return { retained: emptyBucket(), forwardOnlyFailure: emptyBucket(), reverseOnlyFailure: emptyBucket(), bothFailure: emptyBucket() } }
function emptyDirection(): LocalDirectionFailureSummary {
  return {
    evaluated: 0,
    firstFailures: { 'invalid-anchor': emptyBucket(), 'invalid-support': emptyBucket(), 'raw-cost': emptyBucket(), 'missing-competitor': emptyBucket(), 'zero-competitor': emptyBucket(), ratio: emptyBucket(), pass: emptyBucket() },
    failedPredicates: { anchor: emptyBucket(), support: emptyBucket(), rawCost: emptyBucket(), competitorPresent: emptyBucket(), competitorPositive: emptyBucket(), ratio: emptyBucket() },
  }
}

function pointClass(pixel: number, truth: StereoGeometryTruth, disparityPx: number): LocalErrorClass {
  const expected = truth.disparityPx[pixel]
  if (expected === null || expected === undefined) return 'unknown'
  return Math.abs(disparityPx - expected) <= 1 ? 'correct' : 'bad'
}

function addPoint(partitions: LocalAttritionPartitions, bucket: LocalAttritionBucket, kind: LocalErrorClass): void {
  partitions[bucket].total += 1
  partitions[bucket][kind] += 1
}

function addDirectionalEvidence(summary: LocalDirectionFailureSummary, item: LocalDirectionEvidence, kind: LocalErrorClass): void {
  summary.evaluated += 1
  addBucket(summary.firstFailures[item.firstFailure], kind)
  for (const predicate of item.failedPredicates) addBucket(summary.failedPredicates[predicate], kind)
}

function addBucket(bucket: LocalAttritionBucketSummary, kind: LocalErrorClass): void {
  bucket.total += 1
  bucket[kind] += 1
}

function samePoint(a: StereoPoint, b: StereoPoint): boolean {
  return a.pixelIndex === b.pixelIndex && a.disparityPx === b.disparityPx && a.meanAbsoluteError === b.meanAbsoluteError
    && a.positionM.length === b.positionM.length && a.positionM.every((value, index) => value === b.positionM[index])
    && a.color.length === b.color.length && a.color.every((value, index) => value === b.color[index])
}

function validateFiltered(base: StereoResult, filtered: StereoResult, evidence: readonly LocalPointEvidence[], width: number, height: number): void {
  const settingKeys: readonly (keyof StereoSettings)[] = ['minDisparity', 'maxDisparity', 'patchRadius', 'minTextureVariance', 'maxMeanAbsoluteError', 'uniquenessRatio', 'leftRightTolerancePx']
  if (!filtered || filtered.width !== width || filtered.height !== height || filtered.baselineM !== base.baselineM || !filtered.settings || settingKeys.some(key => filtered.settings[key] !== base.settings[key])) throw new Error('filtered calibration or settings differ from the base result.')
  if (!(filtered.outcomes instanceof Uint8Array) || filtered.outcomes.length !== width * height || !Array.isArray(filtered.points)) throw new Error('filtered result arrays are invalid.')
  const baseByPixel = new Map(base.points.map(point => [point.pixelIndex, point]))
  const expectedAccepted = new Set(evidence.filter(item => item.retainedByEvidence).map(item => item.pixelIndex))
  const filteredByPixel = new Map<number, StereoPoint>()
  for (const point of filtered.points) {
    if (filteredByPixel.has(point.pixelIndex)) throw new Error('filtered result contains duplicate accepted points.')
    filteredByPixel.set(point.pixelIndex, point)
  }
  const expectedInBaseOrder = base.points.filter(point => expectedAccepted.has(point.pixelIndex)).map(point => point.pixelIndex)
  if (filteredByPixel.size !== expectedAccepted.size || filtered.points.some((point, index) => point.pixelIndex !== expectedInBaseOrder[index])) throw new Error('filtered accepted point set or order does not match predicted evidence keep-set.')
  for (const pixel of expectedAccepted) if (!samePoint(baseByPixel.get(pixel)!, filteredByPixel.get(pixel)!)) throw new Error(`filtered point ${pixel} changed its base point values.`)
  const acceptedCode = OUTCOME_CODE.accepted, ambiguousCode = OUTCOME_CODE.ambiguous
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const wasAccepted = base.outcomes[pixel] === acceptedCode
    const expected = wasAccepted ? (expectedAccepted.has(pixel) ? acceptedCode : ambiguousCode) : base.outcomes[pixel]
    if (filtered.outcomes[pixel] !== expected) throw new Error(`filtered outcomes changed an unrelated pixel or failed to mark a rejected point ambiguous at ${pixel}.`)
  }
  const counts: Record<StereoOutcome, number> = { border: 0, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 }
  for (const code of filtered.outcomes) {
    const name = STEREO_OUTCOMES[code]
    if (!name) throw new Error('filtered result has an unknown outcome code.')
    counts[name] += 1
  }
  if (filtered.points.length !== counts.accepted || filtered.status !== (counts.accepted ? 'reconstructed' : 'empty') || STEREO_OUTCOMES.some(name => filtered.counts?.[name] !== counts[name])) throw new Error('filtered point/outcome accounting is inconsistent.')
}

/** Score saved evidence only after matching it against the saved filtered result. */
export function scoreStereoLocalAttrition(
  evidence: readonly LocalPointEvidence[],
  base: StereoResult,
  filtered: StereoResult,
  truth: StereoGeometryTruth,
  regions: Record<string, number[]>,
  unsupportedPixels: readonly number[],
): StereoLocalAttritionScore {
  if (!base || typeof base !== 'object') throw new Error('base result is required.')
  // The shared geometry validator checks complete truth support and both serialized results.
  const baseGeometry = evaluateStereoGeometry(base, truth)
  const filteredGeometry = evaluateStereoGeometry(filtered, truth)
  const width = base.width, height = base.height, pixelCount = width * height
  const baseByPixel = new Map(base.points.map(point => [point.pixelIndex, point]))
  validateEvidence(evidence, base.points, width, base.settings)
  validateFiltered(base, filtered, evidence, width, height)

  if (!regions || typeof regions !== 'object' || Array.isArray(regions)) throw new Error('regions must be a record of pixel-index arrays.')
  const regionSets = new Map<string, Set<number>>()
  for (const [name, indexes] of Object.entries(regions)) {
    if (!name || !Array.isArray(indexes)) throw new Error('region names and index arrays must be valid.')
    const set = new Set<number>()
    for (const pixel of indexes) {
      if (!Number.isSafeInteger(pixel) || pixel < 0 || pixel >= pixelCount || set.has(pixel)) throw new Error(`region ${name} has an invalid or duplicate pixel index.`)
      set.add(pixel)
    }
    regionSets.set(name, set)
  }
  const unsupported = new Set<number>()
  for (const pixel of unsupportedPixels) {
    if (!Number.isSafeInteger(pixel) || pixel < 0 || pixel >= pixelCount || unsupported.has(pixel)) throw new Error('unsupported mask has an invalid or duplicate pixel index.')
    unsupported.add(pixel)
  }

  const partitions = emptyPartitions()
  const directions = { forward: emptyDirection(), reverse: emptyDirection() }
  const regionSummaries: StereoLocalAttritionScore['regions'] = Object.fromEntries([...regionSets].map(([name, indexes]) => [name, { pixelCount: indexes.size, partitions: emptyPartitions(), directions: { forward: emptyDirection(), reverse: emptyDirection() } }]))
  let unsupportedBaseAccepted = 0, unsupportedRetained = 0
  for (const item of evidence) {
    const point = baseByPixel.get(item.pixelIndex)!
    const forwardFailed = item.forward.firstFailure !== 'pass'
    const reverseFailed = item.reverse.firstFailure !== 'pass'
    const bucket: LocalAttritionBucket = forwardFailed ? (reverseFailed ? 'bothFailure' : 'forwardOnlyFailure') : (reverseFailed ? 'reverseOnlyFailure' : 'retained')
    const kind = pointClass(item.pixelIndex, truth, point.disparityPx)
    addPoint(partitions, bucket, kind)
    for (const [name, indexes] of regionSets) if (indexes.has(item.pixelIndex)) {
      addPoint(regionSummaries[name]!.partitions, bucket, kind)
      addDirectionalEvidence(regionSummaries[name]!.directions.forward, item.forward, kind)
      addDirectionalEvidence(regionSummaries[name]!.directions.reverse, item.reverse, kind)
    }
    for (const directionName of ['forward', 'reverse'] as const) {
      addDirectionalEvidence(directions[directionName], item[directionName], kind)
    }
    if (unsupported.has(item.pixelIndex)) {
      unsupportedBaseAccepted += 1
      if (item.retainedByEvidence) unsupportedRetained += 1
    }
  }
  if (evidence.length !== baseByPixel.size) throw new Error('evidence did not cover every accepted base point.')
  return {
    format: 'cha-stereo-local-attrition-v1', evidenceCount: evidence.length, predictionMatchesFiltered: true,
    partitions, directions, regions: regionSummaries,
    unsupported: { maskPixels: unsupported.size, baseAcceptedPixels: unsupportedBaseAccepted, retained: unsupportedRetained, lost: unsupportedBaseAccepted - unsupportedRetained },
    truthSupport: { validTruthPixels: baseGeometry.validTruthPixels, baseAcceptedWithTruth: baseGeometry.acceptedWithTruth, filteredAcceptedWithTruth: filteredGeometry.acceptedWithTruth, baseTruthCoverage: baseGeometry.truthCoverage, filteredTruthCoverage: filteredGeometry.truthCoverage },
  }
}

/** Pool mutually exclusive point partitions; named regions remain independent and may overlap. */
export function poolStereoLocalAttrition(scores: readonly StereoLocalAttritionScore[]) {
  if (scores.length === 0) throw new Error('At least one local attrition score is required.')
  const partitions = emptyPartitions()
  const directions = { forward: emptyDirection(), reverse: emptyDirection() }
  const unsupported = { maskPixels: 0, baseAcceptedPixels: 0, retained: 0, lost: 0 }
  const truthSupport = { validTruthPixels: 0, baseAcceptedWithTruth: 0, filteredAcceptedWithTruth: 0 }
  const regions: StereoLocalAttritionScore['regions'] = {}
  for (const score of scores) {
    for (const bucket of Object.keys(partitions) as LocalAttritionBucket[]) for (const kind of ['correct', 'bad', 'unknown'] as const) {
      partitions[bucket][kind] += score.partitions[bucket][kind]
      partitions[bucket].total += score.partitions[bucket][kind]
    }
    for (const directionName of ['forward', 'reverse'] as const) {
      const source = score.directions[directionName], target = directions[directionName]
      target.evaluated += source.evaluated
      for (const failure of Object.keys(target.firstFailures) as LocalAttritionFailure[]) for (const kind of ['correct', 'bad', 'unknown'] as const) {
        target.firstFailures[failure][kind] += source.firstFailures[failure][kind]
        target.firstFailures[failure].total += source.firstFailures[failure][kind]
      }
      for (const key of CHECK_ORDER) for (const kind of ['correct', 'bad', 'unknown'] as const) {
        target.failedPredicates[key][kind] += source.failedPredicates[key][kind]
        target.failedPredicates[key].total += source.failedPredicates[key][kind]
      }
    }
    unsupported.maskPixels += score.unsupported.maskPixels
    unsupported.baseAcceptedPixels += score.unsupported.baseAcceptedPixels
    unsupported.retained += score.unsupported.retained
    unsupported.lost += score.unsupported.lost
    truthSupport.validTruthPixels += score.truthSupport.validTruthPixels
    truthSupport.baseAcceptedWithTruth += score.truthSupport.baseAcceptedWithTruth
    truthSupport.filteredAcceptedWithTruth += score.truthSupport.filteredAcceptedWithTruth
    for (const [name, region] of Object.entries(score.regions)) {
      if (!regions[name]) regions[name] = { pixelCount: 0, partitions: emptyPartitions(), directions: { forward: emptyDirection(), reverse: emptyDirection() } }
      const target = regions[name]!
      target.pixelCount += region.pixelCount
      for (const bucket of Object.keys(target.partitions) as LocalAttritionBucket[]) for (const kind of ['correct', 'bad', 'unknown'] as const) {
        target.partitions[bucket][kind] += region.partitions[bucket][kind]
        target.partitions[bucket].total += region.partitions[bucket][kind]
      }
      for (const directionName of ['forward', 'reverse'] as const) {
        const targetDirection = target.directions[directionName], sourceDirection = region.directions[directionName]
        targetDirection.evaluated += sourceDirection.evaluated
        for (const failure of Object.keys(targetDirection.firstFailures) as LocalAttritionFailure[]) for (const kind of ['correct', 'bad', 'unknown'] as const) {
          targetDirection.firstFailures[failure][kind] += sourceDirection.firstFailures[failure][kind]
          targetDirection.firstFailures[failure].total += sourceDirection.firstFailures[failure][kind]
        }
        for (const key of CHECK_ORDER) for (const kind of ['correct', 'bad', 'unknown'] as const) {
          targetDirection.failedPredicates[key][kind] += sourceDirection.failedPredicates[key][kind]
          targetDirection.failedPredicates[key].total += sourceDirection.failedPredicates[key][kind]
        }
      }
    }
  }
  return { format: 'cha-stereo-local-attrition-pooled-v1' as const, caseCount: scores.length, pointCount: Object.values(partitions).reduce((sum, bucket) => sum + bucket.total, 0), partitions, directions, regions, unsupported, truthSupport: { ...truthSupport, baseTruthCoverage: truthSupport.validTruthPixels ? truthSupport.baseAcceptedWithTruth / truthSupport.validTruthPixels : null, filteredTruthCoverage: truthSupport.validTruthPixels ? truthSupport.filteredAcceptedWithTruth / truthSupport.validTruthPixels : null } }
}
