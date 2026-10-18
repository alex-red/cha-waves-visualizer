import { STEREO_GATES, STEREO_OUTCOMES, type StereoCamera, type StereoImage, type StereoOutcome, type StereoPoint, type StereoResult, type StereoEvaluationInput } from './spatial-stereo-types.ts'
import type { Vector3 } from './spatial-registration.ts'

const MAX_IMAGE_WIDTH = 256
const MAX_IMAGE_HEIGHT = 192
const MAX_RASTER_PIXELS = MAX_IMAGE_WIDTH * MAX_IMAGE_HEIGHT
const MAX_WORLD_COORDINATE_M = 1_000_000
const MAX_DEPTH_M = 1_000_000
const PERFECT_PSNR_CAP_DB = 120

export type StereoHeldOutScore = {
  cameraId: string
  coveredPixels: number
  totalPixels: number
  coverage: number
  coveredMae: number | null
  allPixelMae: number
  psnrDb: number
}

export type StereoEvaluationReport = {
  outcomeCounts: Record<StereoOutcome, number>
  reference: {
    acceptedFraction: number
    depthCount: number
    unevaluatedAcceptedCount: number
    meanAbsoluteDepthErrorM: number | null
    depthP50M: number | null
    depthP90M: number | null
    depthMaxM: number | null
  }
  heldOut: StereoHeldOutScore[]
  gates: {
    minimumAcceptedFraction: boolean
    completeReferenceTruth: boolean
    maximumDepthP90M: boolean
    heldOut: Array<{
      cameraId: string
      minimumCoverage: boolean
      maximumCoveredMae: boolean
      maximumAllPixelMae: boolean
      passed: boolean
    }>
    passed: boolean
  }
  passed: boolean
}

export type StereoImagePreview = { image: StereoImage; covered: Uint8Array<ArrayBuffer> }

function fail(path: string, issue: string): never {
  throw new Error(`${path} ${issue}.`)
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail(path, 'must contain 1–80 printable characters')
  return value
}

function dimensions(width: number, height: number, path: string): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    fail(path, `dimensions must be integers up to ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT}`)
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > MAX_RASTER_PIXELS) fail(path, `may contain at most ${MAX_RASTER_PIXELS} pixels`)
  return pixels
}

function validateCamera(camera: StereoCamera, path: string, expectedWidth?: number, expectedHeight?: number): number {
  if (!camera || typeof camera !== 'object') fail(path, 'must be a camera object')
  identifier(camera.id, `${path}.id`)
  if (!Array.isArray(camera.positionM) || camera.positionM.length !== 3) fail(`${path}.positionM`, 'must contain three finite coordinates')
  for (let index = 0; index < 3; index += 1) finite(camera.positionM[index], `${path}.positionM[${index}]`, -MAX_WORLD_COORDINATE_M, MAX_WORLD_COORDINATE_M)
  if (!camera.intrinsics || typeof camera.intrinsics !== 'object') fail(`${path}.intrinsics`, 'must be an object')
  const { width, height, fx, fy, cx, cy } = camera.intrinsics
  const pixels = dimensions(width, height, `${path}.intrinsics`)
  if (expectedWidth !== undefined && (width !== expectedWidth || height !== expectedHeight)) fail(`${path}.intrinsics`, 'must match the corresponding image dimensions')
  finite(fx, `${path}.intrinsics.fx`, 1e-3, 1e6)
  finite(fy, `${path}.intrinsics.fy`, 1e-3, 1e6)
  finite(cx, `${path}.intrinsics.cx`, -MAX_IMAGE_WIDTH, 2 * MAX_IMAGE_WIDTH)
  finite(cy, `${path}.intrinsics.cy`, -MAX_IMAGE_HEIGHT, 2 * MAX_IMAGE_HEIGHT)
  return pixels
}

function validatePoints(points: StereoPoint[], width: number, height: number): void {
  if (!Array.isArray(points)) fail('result.points', 'must be an array')
  const pixels = width * height
  const seen = new Set<number>()
  for (let index = 0; index < points.length; index += 1) {
    if (!Object.hasOwn(points, index)) fail(`result.points[${index}]`, 'is missing')
    const point = points[index]!
    const path = `result.points[${index}]`
    if (!point || typeof point !== 'object') fail(path, 'must be an object')
    if (!Number.isInteger(point.pixelIndex) || point.pixelIndex < 0 || point.pixelIndex >= pixels) fail(`${path}.pixelIndex`, 'is outside the reference image')
    if (seen.has(point.pixelIndex)) fail(`${path}.pixelIndex`, 'duplicates another accepted point')
    seen.add(point.pixelIndex)
    if (!Array.isArray(point.positionM) || point.positionM.length !== 3) fail(`${path}.positionM`, 'must contain three finite coordinates')
    for (let axis = 0; axis < 3; axis += 1) finite(point.positionM[axis], `${path}.positionM[${axis}]`, -MAX_WORLD_COORDINATE_M, MAX_WORLD_COORDINATE_M)
    if (!Array.isArray(point.color) || point.color.length !== 3) fail(`${path}.color`, 'must contain three integer RGB bytes')
    for (let channelIndex = 0; channelIndex < 3; channelIndex += 1) {
      const channel = point.color[channelIndex]
      if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255) fail(`${path}.color[${channelIndex}]`, 'must be an integer byte')
    }
    finite(point.disparityPx, `${path}.disparityPx`, Number.MIN_VALUE, 1e6)
    finite(point.meanAbsoluteError, `${path}.meanAbsoluteError`, 0, 255)
  }
}

function validateResult(result: StereoResult): number {
  if (!result || typeof result !== 'object') fail('result', 'must be an object')
  if (result.status !== 'reconstructed' && result.status !== 'empty') fail('result.status', 'is unsupported')
  const pixels = dimensions(result.width, result.height, 'result')
  finite(result.baselineM, 'result.baselineM', Number.MIN_VALUE, MAX_WORLD_COORDINATE_M)
  if (!(result.outcomes instanceof Uint8Array) || result.outcomes.length !== pixels) fail('result.outcomes', 'must contain one outcome code per reference pixel')
  if (!result.counts || typeof result.counts !== 'object') fail('result.counts', 'must contain outcome counts')
  const histogram: Record<StereoOutcome, number> = { border: 0, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 }
  for (let pixel = 0; pixel < result.outcomes.length; pixel += 1) {
    const code = result.outcomes[pixel]!
    const outcome = STEREO_OUTCOMES[code]
    if (!outcome) fail(`result.outcomes[${pixel}]`, 'contains an unknown outcome code')
    histogram[outcome] += 1
  }
  for (const outcome of STEREO_OUTCOMES) {
    const count = result.counts[outcome]
    if (!Number.isInteger(count) || count < 0 || count !== histogram[outcome]) fail(`result.counts.${outcome}`, 'does not match the per-pixel outcomes')
  }
  validatePoints(result.points, result.width, result.height)
  if (histogram.accepted !== result.points.length) fail('result.points', 'must contain exactly one point for each accepted reference pixel')
  for (const point of result.points) {
    if (result.outcomes[point.pixelIndex] !== STEREO_OUTCOMES.indexOf('accepted')) fail(`result.points[${point.pixelIndex}]`, 'does not match an accepted outcome')
  }
  if ((result.status === 'empty') !== (result.points.length === 0)) fail('result.status', 'does not match the accepted point set')
  return pixels
}

function validateImage(image: StereoImage, camera: StereoCamera, path: string): number {
  if (!image || typeof image !== 'object') fail(path, 'must be an image object')
  const pixels = dimensions(image.width, image.height, path)
  validateCamera(camera, `${path}.camera`, image.width, image.height)
  if (!(image.rgb instanceof Uint8Array) || image.rgb.length !== pixels * 3) fail(`${path}.rgb`, 'must contain exactly three RGB bytes per pixel')
  return pixels
}

/** Rasterize points as deterministic 3x3 square surfels using an OpenGL +Y-up, -Z-forward camera. */
export function renderStereoPreview(points: readonly StereoPoint[], camera: StereoCamera): StereoImagePreview {
  const pixels = validateCamera(camera, 'camera')
  validatePoints(points as StereoPoint[], camera.intrinsics.width, camera.intrinsics.height)
  const width = camera.intrinsics.width
  const height = camera.intrinsics.height
  const rgb = new Uint8Array(pixels * 3)
  const covered = new Uint8Array(pixels)
  const zBuffer = new Float64Array(pixels)
  zBuffer.fill(Infinity)
  const { fx, fy, cx, cy } = camera.intrinsics
  const projected = points.map(point => {
    const axialDepth = camera.positionM[2] - point.positionM[2]
    finite(axialDepth, 'projected depth', -MAX_DEPTH_M, MAX_DEPTH_M)
    if (axialDepth <= 0) return null
    const u = fx * (point.positionM[0] - camera.positionM[0]) / axialDepth + cx
    const v = cy - fy * (point.positionM[1] - camera.positionM[1]) / axialDepth
    if (!Number.isFinite(u) || !Number.isFinite(v)) fail('projected point', 'has non-finite image coordinates')
    // Projection coordinates refer to pixel centers (`x + 0.5`, `y + 0.5` in
    // the estimator); convert back to integer pixel indices before rasterizing.
    return { point, depth: axialDepth, x: Math.round(u - 0.5), y: Math.round(v - 0.5) }
  }).filter((entry): entry is { point: StereoPoint; depth: number; x: number; y: number } => entry !== null)
  projected.sort((a, b) => a.depth - b.depth || a.point.pixelIndex - b.point.pixelIndex)

  for (const entry of projected) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = entry.y + dy
      if (y < 0 || y >= height) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = entry.x + dx
        if (x < 0 || x >= width) continue
        const index = y * width + x
        if (entry.depth >= zBuffer[index]!) continue
        zBuffer[index] = entry.depth
        covered[index] = 1
        const rgbOffset = index * 3
        rgb[rgbOffset] = entry.point.color[0]
        rgb[rgbOffset + 1] = entry.point.color[1]
        rgb[rgbOffset + 2] = entry.point.color[2]
      }
    }
  }
  return { image: { width, height, rgb }, covered }
}

function validateTruth(truth: StereoEvaluationInput['reference'], path: string, width: number, height: number): void {
  if (!truth || typeof truth !== 'object' || !Array.isArray(truth.depthM)) fail(path, 'must contain a depth map')
  const pixels = validateCamera(truth.camera, `${path}.camera`, width, height)
  if (truth.depthM.length !== pixels) fail(`${path}.depthM`, 'must contain one entry per image pixel')
  for (let index = 0; index < truth.depthM.length; index += 1) {
    const depth = truth.depthM[index]
    if (depth === null) continue
    finite(depth, `${path}.depthM[${index}]`, Number.MIN_VALUE, MAX_DEPTH_M)
  }
}

function percentile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * fraction
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low)
}

function scoreHeldOut(result: StereoResult, view: StereoEvaluationInput['heldOut'][number]): StereoHeldOutScore {
  const { image, covered } = renderStereoPreview(result.points, view.view.camera)
  const totalPixels = image.width * image.height
  let coveredPixels = 0
  let coveredAbsolute = 0
  let fullAbsolute = 0
  let fullSquared = 0
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 3
    if (covered[pixel] === 1) coveredPixels += 1
    for (let channel = 0; channel < 3; channel += 1) {
      const prediction = image.rgb[offset + channel]!
      const truth = view.view.image.rgb[offset + channel]!
      const difference = Math.abs(prediction - truth)
      fullAbsolute += difference
      fullSquared += difference * difference
      if (covered[pixel] === 1) coveredAbsolute += difference
    }
  }
  const allChannelCount = totalPixels * 3
  const mse = fullSquared / allChannelCount
  const psnrDb = mse === 0 ? PERFECT_PSNR_CAP_DB : 10 * Math.log10((255 * 255) / mse)
  if (!Number.isFinite(psnrDb)) fail(`heldOut.${view.view.camera.id}.psnrDb`, 'could not be computed as a finite value')
  return {
    cameraId: view.view.camera.id,
    coveredPixels,
    totalPixels,
    coverage: coveredPixels / totalPixels,
    coveredMae: coveredPixels ? coveredAbsolute / (coveredPixels * 3) : null,
    allPixelMae: fullAbsolute / allChannelCount,
    psnrDb,
  }
}

/** Evaluate accepted reference depths and held-out previews without fitting, rescaling, or using truth in rendering. */
export function evaluateStereo(result: StereoResult, input: StereoEvaluationInput): StereoEvaluationReport {
  const pixels = validateResult(result)
  if (!input || typeof input !== 'object') fail('evaluation', 'must be an object')
  validateTruth(input.reference, 'reference', result.width, result.height)
  if (!Array.isArray(input.heldOut) || input.heldOut.length < 1 || input.heldOut.length > 16) fail('heldOut', 'must contain 1–16 views')

  const depthErrors: number[] = []
  let unevaluatedAcceptedCount = 0
  for (const point of result.points) {
    const truthDepth = input.reference.depthM[point.pixelIndex]
    if (truthDepth === undefined) fail(`reference.depthM[${point.pixelIndex}]`, 'is missing')
    if (truthDepth === null) {
      unevaluatedAcceptedCount += 1
      continue
    }
    const predictedDepth = input.reference.camera.positionM[2] - point.positionM[2]
    finite(predictedDepth, `reference.points[${point.pixelIndex}].depth`, Number.MIN_VALUE, MAX_DEPTH_M)
    depthErrors.push(Math.abs(predictedDepth - truthDepth))
  }
  depthErrors.sort((a, b) => a - b)
  const depthMean = depthErrors.length ? depthErrors.reduce((sum, error) => sum + error, 0) / depthErrors.length : null
  const depthP50 = percentile(depthErrors, 0.5)
  const depthP90 = percentile(depthErrors, 0.9)
  const depthMax = depthErrors.length ? depthErrors[depthErrors.length - 1]! : null
  const reference = {
    acceptedFraction: result.points.length / pixels,
    depthCount: depthErrors.length,
    unevaluatedAcceptedCount,
    meanAbsoluteDepthErrorM: depthMean,
    depthP50M: depthP50,
    depthP90M: depthP90,
    depthMaxM: depthMax,
  }

  const heldOutIds = new Set<string>()
  const heldOut: StereoHeldOutScore[] = []
  for (const item of input.heldOut) {
    if (!item || typeof item !== 'object' || !item.view || !item.truth) fail('heldOut', 'contains an invalid view')
    const id = identifier(item.view.camera?.id, 'heldOut.cameraId')
    if (heldOutIds.has(id)) fail('heldOut', 'contains duplicate camera IDs')
    if (id === input.reference.camera.id) fail('heldOut', 'must not include the reference camera')
    heldOutIds.add(id)
    const imagePixels = validateImage(item.view.image, item.view.camera, `heldOut.${id}.image`)
    if (imagePixels !== result.width * result.height) fail(`heldOut.${id}`, 'dimensions must match the reference image')
    validateTruth(item.truth, `heldOut.${id}.truth`, item.view.image.width, item.view.image.height)
    if (item.truth.camera.id !== id) fail(`heldOut.${id}.truth.camera`, 'ID must match its held-out view')
    heldOut.push(scoreHeldOut(result, item))
  }

  const gates = {
    minimumAcceptedFraction: Number.isFinite(reference.acceptedFraction) && reference.acceptedFraction >= STEREO_GATES.minimumAcceptedFraction,
    completeReferenceTruth: unevaluatedAcceptedCount === 0,
    maximumDepthP90M: reference.depthP90M !== null && Number.isFinite(reference.depthP90M) && reference.depthP90M <= STEREO_GATES.maximumDepthP90M,
    heldOut: heldOut.map(score => {
      const minimumCoverage = Number.isFinite(score.coverage) && score.coverage >= STEREO_GATES.minimumHeldOutCoverage
      const maximumCoveredMae = score.coveredMae !== null && Number.isFinite(score.coveredMae) && score.coveredMae <= STEREO_GATES.maximumCoveredMae
      const maximumAllPixelMae = Number.isFinite(score.allPixelMae) && score.allPixelMae <= STEREO_GATES.maximumAllPixelMae
      return { cameraId: score.cameraId, minimumCoverage, maximumCoveredMae, maximumAllPixelMae, passed: minimumCoverage && maximumCoveredMae && maximumAllPixelMae }
    }),
  }
  const passed = gates.minimumAcceptedFraction && gates.completeReferenceTruth && gates.maximumDepthP90M && gates.heldOut.length > 0 && gates.heldOut.every(gate => gate.passed)
  const outcomeCounts = Object.fromEntries(STEREO_OUTCOMES.map(outcome => [outcome, result.counts[outcome]])) as Record<StereoOutcome, number>
  return { outcomeCounts, reference, heldOut, gates: { ...gates, passed }, passed }
}

function markdownEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function renderStereoEvaluation(report: StereoEvaluationReport, format: 'json' | 'markdown' = 'json'): string {
  if (format === 'json') return JSON.stringify(report, null, 2)
  if (format !== 'markdown') fail('format', 'must be json or markdown')
  const rows = report.heldOut.map(score => `| ${markdownEscape(score.cameraId)} | ${score.coveredPixels}/${score.totalPixels} | ${score.coverage.toFixed(4)} | ${score.coveredMae?.toFixed(3) ?? 'unavailable'} | ${score.allPixelMae.toFixed(3)} | ${score.psnrDb.toFixed(3)} |`).join('\n')
  const outcomes = STEREO_OUTCOMES.map(outcome => `${outcome}: ${report.outcomeCounts[outcome]}`).join(', ')
  return [
    '# Synthetic stereo evaluation',
    '',
    `Passed: **${report.passed ? 'yes' : 'no'}**`,
    '',
    `Reference accepted fraction: ${report.reference.acceptedFraction.toFixed(4)}`,
    `Depth comparisons: ${report.reference.depthCount}; accepted points without truth: ${report.reference.unevaluatedAcceptedCount}`,
    `Depth MAE (m): ${report.reference.meanAbsoluteDepthErrorM?.toFixed(6) ?? 'unavailable'}`,
    `Depth P50/P90/max (m): ${report.reference.depthP50M?.toFixed(6) ?? 'unavailable'} / ${report.reference.depthP90M?.toFixed(6) ?? 'unavailable'} / ${report.reference.depthMaxM?.toFixed(6) ?? 'unavailable'}`,
    `Outcomes: ${outcomes}`,
    '',
    '| Held-out camera | Covered pixels | Coverage | Covered MAE | All-pixel MAE | PSNR (dB) |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    rows,
    '',
    `Gates: accepted fraction ${report.gates.minimumAcceptedFraction ? 'pass' : 'fail'}, complete truth ${report.gates.completeReferenceTruth ? 'pass' : 'fail'}, depth P90 ${report.gates.maximumDepthP90M ? 'pass' : 'fail'}, held-out views ${report.gates.heldOut.map(gate => `${markdownEscape(gate.cameraId)}=${gate.passed ? 'pass' : 'fail'}`).join(', ') || 'none'}.`,
  ].join('\n')
}

