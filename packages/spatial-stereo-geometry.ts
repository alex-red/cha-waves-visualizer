import { STEREO_OUTCOMES, type StereoCamera, type StereoOutcome, type StereoResult } from './spatial-stereo-types.ts'

const MAX_IMAGE_WIDTH = 256
const MAX_IMAGE_HEIGHT = 192
const MAX_PIXELS = MAX_IMAGE_WIDTH * MAX_IMAGE_HEIGHT
const MAX_COORDINATE_M = 1_000_000
const MAX_DEPTH_M = 1_000_000
const WORST_ERROR_LIMIT = 10

export const STEREO_GEOMETRY_GATES = Object.freeze({
  minimumTruthCoverage: 0.35,
  maximumBad1Fraction: 0.1,
  maximumDepthP90M: 0.25,
})

export type StereoGeometryTruth = {
  camera: StereoCamera
  disparityPx: (number | null)[]
  depthM: (number | null)[]
}

export type StereoGeometryError = {
  pixelIndex: number
  estimatedDisparityPx: number
  truthDisparityPx: number
  absoluteDisparityErrorPx: number
  absoluteDepthErrorM: number
}

export type StereoGeometryReport = {
  totalPixels: number
  validTruthPixels: number
  missingTruthPixels: number
  acceptedPixels: number
  acceptedWithTruth: number
  acceptedWithoutTruth: number
  unestimatedTruthPixels: number
  truthCoverage: number | null
  disparity: {
    meanAbsoluteErrorPx: number | null
    p50AbsoluteErrorPx: number | null
    p90AbsoluteErrorPx: number | null
    maxAbsoluteErrorPx: number | null
    bad1Count: number
    bad1AmongEstimatesFraction: number | null
    bad1IncludingMissingFraction: number | null
  }
  depth: {
    meanAbsoluteErrorM: number | null
    p50AbsoluteErrorM: number | null
    p90AbsoluteErrorM: number | null
    maxAbsoluteErrorM: number | null
  }
  /** The ten largest absolute depth errors, with disparity errors alongside for diagnosis. */
  worstErrors: StereoGeometryError[]
  gates: {
    minimumTruthCoverage: boolean
    maximumBad1Fraction: boolean
    maximumDepthP90M: boolean
    passed: boolean
  }
  passed: boolean
}

function fail(path: string, issue: string): never {
  throw new Error(`${path} ${issue}.`)
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function dimensions(width: unknown, height: unknown, path: string): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 || (width as number) > MAX_IMAGE_WIDTH || (height as number) > MAX_IMAGE_HEIGHT) {
    fail(path, `dimensions must be positive integers up to ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT}`)
  }
  const pixels = (width as number) * (height as number)
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) fail(path, `may contain at most ${MAX_PIXELS} pixels`)
  return pixels
}

function validateCamera(camera: StereoCamera, width: number, height: number): void {
  if (!camera || typeof camera !== 'object') fail('truth.camera', 'must be a camera object')
  if (typeof camera.id !== 'string' || camera.id.length < 1 || camera.id.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(camera.id)) fail('truth.camera.id', 'must contain 1–80 printable characters')
  if (!Array.isArray(camera.positionM) || camera.positionM.length !== 3) fail('truth.camera.positionM', 'must contain three coordinates')
  for (let axis = 0; axis < 3; axis += 1) finite(camera.positionM[axis], `truth.camera.positionM[${axis}]`, -MAX_COORDINATE_M, MAX_COORDINATE_M)
  if (!camera.intrinsics || typeof camera.intrinsics !== 'object') fail('truth.camera.intrinsics', 'must be an intrinsics object')
  const intrinsics = camera.intrinsics
  dimensions(intrinsics.width, intrinsics.height, 'truth.camera.intrinsics')
  if (intrinsics.width !== width || intrinsics.height !== height) fail('truth.camera.intrinsics', 'dimensions must match the result')
  finite(intrinsics.fx, 'truth.camera.intrinsics.fx', 1e-3, 1e6)
  finite(intrinsics.fy, 'truth.camera.intrinsics.fy', 1e-3, 1e6)
  finite(intrinsics.cx, 'truth.camera.intrinsics.cx', -MAX_IMAGE_WIDTH, 2 * MAX_IMAGE_WIDTH)
  finite(intrinsics.cy, 'truth.camera.intrinsics.cy', -MAX_IMAGE_HEIGHT, 2 * MAX_IMAGE_HEIGHT)
}

function validateResult(result: StereoResult): { pixels: number; histogram: Record<StereoOutcome, number>; pointsByPixel: Array<StereoResult['points'][number] | undefined> } {
  if (!result || typeof result !== 'object') fail('result', 'must be an object')
  if (result.status !== 'reconstructed' && result.status !== 'empty') fail('result.status', 'is unsupported')
  const pixels = dimensions(result.width, result.height, 'result')
  finite(result.baselineM, 'result.baselineM', Number.MIN_VALUE, MAX_COORDINATE_M)
  if (!result.settings || typeof result.settings !== 'object') fail('result.settings', 'must be an object')
  if (!(result.outcomes instanceof Uint8Array) || result.outcomes.length !== pixels) fail('result.outcomes', 'must contain one outcome code per result pixel')
  if (!result.counts || typeof result.counts !== 'object') fail('result.counts', 'must contain outcome counts')
  const countKeys = Object.keys(result.counts)
  if (countKeys.length !== STEREO_OUTCOMES.length || STEREO_OUTCOMES.some(outcome => !Object.hasOwn(result.counts, outcome))) {
    fail('result.counts', 'must contain exactly the supported outcome names')
  }

  const histogram = Object.fromEntries(STEREO_OUTCOMES.map(outcome => [outcome, 0])) as Record<StereoOutcome, number>
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const outcome = STEREO_OUTCOMES[result.outcomes[pixel]!]
    if (!outcome) fail(`result.outcomes[${pixel}]`, 'contains an unknown outcome code')
    histogram[outcome] += 1
  }
  for (const outcome of STEREO_OUTCOMES) {
    const count = result.counts[outcome]
    if (!Number.isInteger(count) || count < 0 || count !== histogram[outcome]) fail(`result.counts.${outcome}`, 'does not match the outcome-code histogram')
  }

  if (!Array.isArray(result.points)) fail('result.points', 'must be an array')
  const pointsByPixel: Array<StereoResult['points'][number] | undefined> = new Array(pixels)
  for (let index = 0; index < result.points.length; index += 1) {
    if (!Object.hasOwn(result.points, index)) fail(`result.points[${index}]`, 'is missing')
    const point = result.points[index]!
    const path = `result.points[${index}]`
    if (!point || typeof point !== 'object') fail(path, 'must be an object')
    if (!Number.isInteger(point.pixelIndex) || point.pixelIndex < 0 || point.pixelIndex >= pixels) fail(`${path}.pixelIndex`, 'is outside the result image')
    if (pointsByPixel[point.pixelIndex]) fail(`${path}.pixelIndex`, 'duplicates another accepted point')
    if (result.outcomes[point.pixelIndex] !== STEREO_OUTCOMES.indexOf('accepted')) fail(`${path}.pixelIndex`, 'does not identify an accepted outcome')
    pointsByPixel[point.pixelIndex] = point
    if (!Array.isArray(point.positionM) || point.positionM.length !== 3) fail(`${path}.positionM`, 'must contain three coordinates')
    for (let axis = 0; axis < 3; axis += 1) finite(point.positionM[axis], `${path}.positionM[${axis}]`, -MAX_COORDINATE_M, MAX_COORDINATE_M)
    if (!Array.isArray(point.color) || point.color.length !== 3) fail(`${path}.color`, 'must contain three RGB bytes')
    for (let channel = 0; channel < 3; channel += 1) {
      const value = point.color[channel]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) fail(`${path}.color[${channel}]`, 'must be an integer RGB byte')
    }
    finite(point.disparityPx, `${path}.disparityPx`, Number.MIN_VALUE, 1e6)
    finite(point.meanAbsoluteError, `${path}.meanAbsoluteError`, 0, 255)
  }
  if (result.points.length !== histogram.accepted) fail('result.points', 'must contain exactly one point for each accepted outcome')
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const accepted = result.outcomes[pixel] === STEREO_OUTCOMES.indexOf('accepted')
    if (accepted !== Boolean(pointsByPixel[pixel])) fail(`result.outcomes[${pixel}]`, 'does not match the accepted point set')
  }
  if ((result.status === 'empty') !== (result.points.length === 0)) fail('result.status', 'does not match the accepted point set')
  return { pixels, histogram, pointsByPixel }
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * fraction
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
}

function summary(values: number[]): { mean: number | null; p50: number | null; p90: number | null; max: number | null } {
  if (values.length === 0) return { mean: null, p50: null, p90: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]!,
  }
}

/** Compare supplied stereo geometry directly with metric truth; no fitting or rescaling is performed. */
export function evaluateStereoGeometry(result: StereoResult, truth: StereoGeometryTruth): StereoGeometryReport {
  const { pixels, histogram, pointsByPixel } = validateResult(result)
  if (!truth || typeof truth !== 'object') fail('truth', 'must be an object')
  validateCamera(truth.camera, result.width, result.height)
  if (!Array.isArray(truth.disparityPx) || truth.disparityPx.length !== pixels) fail('truth.disparityPx', 'must contain one entry per result pixel')
  if (!Array.isArray(truth.depthM) || truth.depthM.length !== pixels) fail('truth.depthM', 'must contain one entry per result pixel')

  let validTruthPixels = 0
  let missingTruthPixels = 0
  let acceptedWithTruth = 0
  let acceptedWithoutTruth = 0
  let unestimatedTruthPixels = 0
  const disparityErrors: number[] = []
  const depthErrors: number[] = []
  const worstErrors: StereoGeometryError[] = []

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!Object.hasOwn(truth.disparityPx, pixel) || !Object.hasOwn(truth.depthM, pixel)) fail(`truth[${pixel}]`, 'is missing')
    const disparity = truth.disparityPx[pixel]
    const depth = truth.depthM[pixel]
    if (disparity === undefined || depth === undefined) fail(`truth[${pixel}]`, 'is missing')
    if ((disparity === null) !== (depth === null)) fail(`truth[${pixel}]`, 'disparity and depth must share the same null support')
    if (disparity === null || depth === null) {
      missingTruthPixels += 1
      if (pointsByPixel[pixel]) acceptedWithoutTruth += 1
      continue
    }
    const truthDisparityPx = finite(disparity, `truth.disparityPx[${pixel}]`, 0, 1e6)
    const truthDepthM = finite(depth, `truth.depthM[${pixel}]`, Number.MIN_VALUE, MAX_DEPTH_M)
    validTruthPixels += 1
    const point = pointsByPixel[pixel]
    if (!point) {
      unestimatedTruthPixels += 1
      continue
    }
    acceptedWithTruth += 1
    const disparityError = Math.abs(point.disparityPx - truthDisparityPx)
    const estimatedDepth = truth.camera.positionM[2] - point.positionM[2]
    finite(estimatedDepth, `result.points[${pixel}].axialDepthM`, Number.MIN_VALUE, MAX_DEPTH_M)
    const depthError = Math.abs(estimatedDepth - truthDepthM)
    if (!Number.isFinite(disparityError) || !Number.isFinite(depthError)) fail(`result.points[${pixel}]`, 'produces a non-finite geometry error')
    disparityErrors.push(disparityError)
    depthErrors.push(depthError)
    worstErrors.push({
      pixelIndex: pixel,
      estimatedDisparityPx: point.disparityPx,
      truthDisparityPx,
      absoluteDisparityErrorPx: disparityError,
      absoluteDepthErrorM: depthError,
    })
  }

  const disparitySummary = summary(disparityErrors)
  const depthSummary = summary(depthErrors)
  const bad1Count = disparityErrors.reduce((count, error) => count + (error > 1 ? 1 : 0), 0)
  const truthCoverage = validTruthPixels ? acceptedWithTruth / validTruthPixels : null
  const bad1AmongEstimatesFraction = acceptedWithTruth ? bad1Count / acceptedWithTruth : null
  const bad1IncludingMissingFraction = validTruthPixels ? (bad1Count + unestimatedTruthPixels) / validTruthPixels : null
  worstErrors.sort((a, b) => b.absoluteDepthErrorM - a.absoluteDepthErrorM || b.absoluteDisparityErrorPx - a.absoluteDisparityErrorPx || a.pixelIndex - b.pixelIndex)
  worstErrors.length = Math.min(worstErrors.length, WORST_ERROR_LIMIT)

  const gates = {
    minimumTruthCoverage: truthCoverage !== null && truthCoverage >= STEREO_GEOMETRY_GATES.minimumTruthCoverage,
    maximumBad1Fraction: bad1AmongEstimatesFraction !== null && bad1AmongEstimatesFraction <= STEREO_GEOMETRY_GATES.maximumBad1Fraction,
    maximumDepthP90M: depthSummary.p90 !== null && depthSummary.p90 <= STEREO_GEOMETRY_GATES.maximumDepthP90M,
  }
  const passed = gates.minimumTruthCoverage && gates.maximumBad1Fraction && gates.maximumDepthP90M
  return {
    totalPixels: pixels,
    validTruthPixels,
    missingTruthPixels,
    acceptedPixels: histogram.accepted,
    acceptedWithTruth,
    acceptedWithoutTruth,
    unestimatedTruthPixels,
    truthCoverage,
    disparity: {
      meanAbsoluteErrorPx: disparitySummary.mean,
      p50AbsoluteErrorPx: disparitySummary.p50,
      p90AbsoluteErrorPx: disparitySummary.p90,
      maxAbsoluteErrorPx: disparitySummary.max,
      bad1Count,
      bad1AmongEstimatesFraction,
      bad1IncludingMissingFraction,
    },
    depth: {
      meanAbsoluteErrorM: depthSummary.mean,
      p50AbsoluteErrorM: depthSummary.p50,
      p90AbsoluteErrorM: depthSummary.p90,
      maxAbsoluteErrorM: depthSummary.max,
    },
    worstErrors,
    gates: { ...gates, passed },
    passed,
  }
}
