import {
  STEREO_OUTCOMES,
  STEREO_SETTINGS,
  type StereoCamera,
  type StereoInput,
  type StereoOutcome,
  type StereoPoint,
  type StereoResult,
  type StereoSettings,
  type StereoView,
} from './spatial-stereo-types.ts'

const MAX_WIDTH = 256
const MAX_HEIGHT = 192
const MAX_BASELINE_M = 10
const MAX_CAMERA_COORDINATE_M = 1_000
const MAX_OUTPUT_COORDINATE_M = 1_000_000
const CAMERA_ALIGNMENT_TOLERANCE_M = 1e-9
const GRAYSCALE_WEIGHTS = [0.299, 0.587, 0.114] as const
const OUTCOME_CODE: Readonly<Record<StereoOutcome, number>> = Object.freeze(
  Object.fromEntries(STEREO_OUTCOMES.map((outcome, index) => [outcome, index])) as Record<StereoOutcome, number>,
)

type Match = { outcome: StereoOutcome; disparityPx?: number; meanAbsoluteError?: number }

function fail(path: string, reason: string): never {
  throw new Error(`${path} ${reason}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  if (Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !Object.hasOwn(value, key))) {
    fail(path, 'contains unsupported or missing fields')
  }
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function validateView(viewInput: unknown, path: string): StereoView {
  if (!isRecord(viewInput)) fail(path, 'must be an object')
  exactKeys(viewInput, ['camera', 'image'], path)
  const camera = viewInput.camera
  const image = viewInput.image
  if (!isRecord(camera)) fail(`${path}.camera`, 'must be an object')
  if (!isRecord(image)) fail(`${path}.image`, 'must be an object')
  exactKeys(camera, ['id', 'positionM', 'intrinsics'], `${path}.camera`)
  exactKeys(image, ['width', 'height', 'rgb'], `${path}.image`)

  if (typeof camera.id !== 'string' || camera.id.length < 1 || camera.id.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(camera.id)) {
    fail(`${path}.camera.id`, 'must contain 1–80 printable characters')
  }
  if (!Array.isArray(camera.positionM) || camera.positionM.length !== 3) fail(`${path}.camera.positionM`, 'must contain three coordinates')
  const positionM: [number, number, number] = [
    finite(camera.positionM[0], `${path}.camera.positionM[0]`, -MAX_CAMERA_COORDINATE_M, MAX_CAMERA_COORDINATE_M),
    finite(camera.positionM[1], `${path}.camera.positionM[1]`, -MAX_CAMERA_COORDINATE_M, MAX_CAMERA_COORDINATE_M),
    finite(camera.positionM[2], `${path}.camera.positionM[2]`, -MAX_CAMERA_COORDINATE_M, MAX_CAMERA_COORDINATE_M),
  ]

  if (!isRecord(camera.intrinsics)) fail(`${path}.camera.intrinsics`, 'must be an object')
  exactKeys(camera.intrinsics, ['width', 'height', 'fx', 'fy', 'cx', 'cy'], `${path}.camera.intrinsics`)
  const width = finite(camera.intrinsics.width, `${path}.camera.intrinsics.width`, 1, MAX_WIDTH)
  const height = finite(camera.intrinsics.height, `${path}.camera.intrinsics.height`, 1, MAX_HEIGHT)
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail(`${path}.camera.intrinsics`, 'width and height must be integers')
  const intrinsics = {
    width,
    height,
    fx: finite(camera.intrinsics.fx, `${path}.camera.intrinsics.fx`, 1e-3, 1e4),
    fy: finite(camera.intrinsics.fy, `${path}.camera.intrinsics.fy`, 1e-3, 1e4),
    cx: finite(camera.intrinsics.cx, `${path}.camera.intrinsics.cx`, 0, width),
    cy: finite(camera.intrinsics.cy, `${path}.camera.intrinsics.cy`, 0, height),
  }

  if (image.width !== width || image.height !== height) fail(`${path}.image`, 'dimensions must match the camera intrinsics')
  if (!(image.rgb instanceof Uint8Array) || image.rgb.byteLength !== width * height * 3) {
    fail(`${path}.image.rgb`, 'must contain exactly three 8-bit channels per pixel')
  }
  return {
    camera: { id: camera.id, positionM, intrinsics },
    image: { width, height, rgb: image.rgb as Uint8Array<ArrayBuffer> },
  }
}

function validateSettings(input: unknown): StereoSettings {
  if (!isRecord(input)) fail('settings', 'must be an object')
  const allowed = [
    'minDisparity', 'maxDisparity', 'patchRadius', 'minTextureVariance',
    'maxMeanAbsoluteError', 'uniquenessRatio', 'leftRightTolerancePx',
  ] as const
  if (Object.keys(input).length !== allowed.length || Object.keys(input).some(key => !allowed.includes(key as typeof allowed[number]))) {
    fail('settings', 'contains unsupported or missing fields')
  }
  const minDisparity = finite(input.minDisparity, 'settings.minDisparity', 1, MAX_WIDTH - 1)
  const maxDisparity = finite(input.maxDisparity, 'settings.maxDisparity', 1, MAX_WIDTH - 1)
  const patchRadius = finite(input.patchRadius, 'settings.patchRadius', 1, 4)
  if (!Number.isInteger(minDisparity) || !Number.isInteger(maxDisparity) || !Number.isInteger(patchRadius)) {
    fail('settings', 'disparities and patchRadius must be integers')
  }
  if (minDisparity >= maxDisparity) fail('settings', 'minDisparity must be less than maxDisparity')
  const uniquenessRatio = finite(input.uniquenessRatio, 'settings.uniquenessRatio', 0, 1)
  if (uniquenessRatio === 0 || uniquenessRatio === 1) fail('settings.uniquenessRatio', 'must be greater than 0 and less than 1')
  return {
    minDisparity,
    maxDisparity,
    patchRadius,
    minTextureVariance: finite(input.minTextureVariance, 'settings.minTextureVariance', 0, 65_025),
    maxMeanAbsoluteError: finite(input.maxMeanAbsoluteError, 'settings.maxMeanAbsoluteError', 0, 255),
    uniquenessRatio,
    leftRightTolerancePx: finite(input.leftRightTolerancePx, 'settings.leftRightTolerancePx', 0, 4),
  }
}

function validateInput(input: unknown, settingsInput: unknown): { left: StereoView; right: StereoView; settings: StereoSettings; baselineM: number } {
  if (!isRecord(input)) fail('input', 'must be an object')
  exactKeys(input, ['left', 'right'], 'input')
  const left = validateView(input.left, 'left')
  const right = validateView(input.right, 'right')
  if (left.image.width !== right.image.width || left.image.height !== right.image.height) {
    fail('right.image', 'dimensions must match the left image')
  }
  const keys = ['width', 'height', 'fx', 'fy', 'cx', 'cy'] as const
  for (const key of keys) {
    if (left.camera.intrinsics[key] !== right.camera.intrinsics[key]) fail(`right.camera.intrinsics.${key}`, 'must match the left camera')
  }
  const [leftX, leftY, leftZ] = left.camera.positionM
  const [rightX, rightY, rightZ] = right.camera.positionM
  if (Math.abs(leftY - rightY) > CAMERA_ALIGNMENT_TOLERANCE_M || Math.abs(leftZ - rightZ) > CAMERA_ALIGNMENT_TOLERANCE_M) {
    fail('right.camera.positionM', 'must share the left camera y and z for rectified horizontal stereo')
  }
  const baselineM = rightX - leftX
  if (!Number.isFinite(baselineM) || baselineM < 0.001 || baselineM > MAX_BASELINE_M) {
    fail('right.camera.positionM[0]', `must give a positive left-to-right baseline from 0.001 through ${MAX_BASELINE_M} m`)
  }
  const settings = validateSettings(settingsInput)
  if (settings.maxDisparity >= left.image.width) fail('settings.maxDisparity', 'must be less than the image width')
  return { left, right, settings, baselineM }
}

function gray(image: Uint8Array<ArrayBuffer>, width: number, x: number, y: number): number {
  const index = (y * width + x) * 3
  return image[index]! * GRAYSCALE_WEIGHTS[0] + image[index + 1]! * GRAYSCALE_WEIGHTS[1] + image[index + 2]! * GRAYSCALE_WEIGHTS[2]
}

function patchVariance(image: Uint8Array<ArrayBuffer>, width: number, x: number, y: number, radius: number): number {
  const side = radius * 2 + 1
  const count = side * side
  let sum = 0
  let sumSquares = 0
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const value = gray(image, width, x + dx, y + dy)
      sum += value
      sumSquares += value * value
    }
  }
  return Math.max(0, sumSquares / count - (sum / count) ** 2)
}

function patchMae(
  reference: Uint8Array<ArrayBuffer>,
  source: Uint8Array<ArrayBuffer>,
  width: number,
  x: number,
  y: number,
  sourceX: number,
  radius: number,
): number {
  let total = 0
  let samples = 0
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const referenceIndex = ((y + dy) * width + x + dx) * 3
      const sourceIndex = ((y + dy) * width + sourceX + dx) * 3
      total += Math.abs(reference[referenceIndex]! - source[sourceIndex]!)
        + Math.abs(reference[referenceIndex + 1]! - source[sourceIndex + 1]!)
        + Math.abs(reference[referenceIndex + 2]! - source[sourceIndex + 2]!)
      samples += 3
    }
  }
  return total / samples
}

function matchPixel(
  reference: Uint8Array<ArrayBuffer>,
  source: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  x: number,
  y: number,
  sourceDirection: -1 | 1,
  settings: StereoSettings,
): Match {
  const radius = settings.patchRadius
  if (x - radius < 0 || x + radius >= width || y - radius < 0 || y + radius >= height) return { outcome: 'border' }
  if (patchVariance(reference, width, x, y, radius) < settings.minTextureVariance) return { outcome: 'textureless' }

  const costs: number[] = []
  let bestCost = Infinity
  let bestDisparity = -1
  let bestMae = Infinity
  for (let disparity = settings.minDisparity; disparity <= settings.maxDisparity; disparity += 1) {
    const sourceX = x + sourceDirection * disparity
    if (sourceX - radius < 0 || sourceX + radius >= width) {
      costs.push(Infinity)
      continue
    }
    const cost = patchMae(reference, source, width, x, y, sourceX, radius)
    costs.push(cost)
    if (cost < bestCost) {
      bestCost = cost
      bestDisparity = disparity
      bestMae = cost
    }
  }
  if (bestDisparity < 0) return { outcome: 'border' }
  if (bestMae > settings.maxMeanAbsoluteError) return { outcome: 'photometric' }

  let secondCost = Infinity
  for (let disparity = settings.minDisparity; disparity <= settings.maxDisparity; disparity += 1) {
    if (Math.abs(disparity - bestDisparity) <= 1) continue
    secondCost = Math.min(secondCost, costs[disparity - settings.minDisparity]!)
  }
  if (!Number.isFinite(secondCost) || secondCost <= Number.EPSILON || bestCost / secondCost > settings.uniquenessRatio) {
    return { outcome: 'ambiguous' }
  }

  const centerIndex = bestDisparity - settings.minDisparity
  const lowerCost = costs[centerIndex - 1]
  const upperCost = costs[centerIndex + 1]
  let subpixelOffset = 0
  if (bestCost > 1e-9 && lowerCost !== undefined && upperCost !== undefined && Number.isFinite(lowerCost) && Number.isFinite(upperCost)) {
    const denominator = lowerCost - 2 * bestCost + upperCost
    if (denominator > 1e-9) subpixelOffset = Math.max(-1, Math.min(1, 0.5 * (lowerCost - upperCost) / denominator))
  }
  return { outcome: 'accepted', disparityPx: bestDisparity + subpixelOffset, meanAbsoluteError: bestMae }
}

/** Reconstruct a bounded, rectified stereo pair without reading truth or held-out data. */
export function reconstructStereo(input: StereoInput, settings: StereoSettings = STEREO_SETTINGS): StereoResult {
  const checked = validateInput(input, settings)
  const { left, right, baselineM } = checked
  const config = checked.settings
  const { width, height, rgb: leftRgb } = left.image
  const rightRgb = right.image.rgb
  const outcomes = new Uint8Array(width * height)
  const points: StereoPoint[] = []
  const counts: Record<StereoOutcome, number> = {
    border: 0, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0,
  }

  const reverse = new Array<Match>(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      reverse[y * width + x] = matchPixel(rightRgb, leftRgb, width, height, x, y, 1, config)
    }
  }

  const { fx, fy, cx, cy } = left.camera.intrinsics
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x
      const match = matchPixel(leftRgb, rightRgb, width, height, x, y, -1, config)
      let outcome = match.outcome
      if (outcome === 'accepted') {
        const disparity = match.disparityPx!
        const rightX = Math.round(x - disparity)
        const reverseMatch = rightX >= 0 && rightX < width ? reverse[pixelIndex - x + rightX]! : null
        if (!reverseMatch || reverseMatch.outcome !== 'accepted'
          || Math.abs(reverseMatch.disparityPx! - disparity) > config.leftRightTolerancePx) {
          outcome = 'inconsistent'
        } else {
          const depthM = fx * baselineM / disparity
          const localX = ((x + 0.5 - cx) * depthM) / fx
          const localY = -((y + 0.5 - cy) * depthM) / fy
          const positionM: [number, number, number] = [
            left.camera.positionM[0] + localX,
            left.camera.positionM[1] + localY,
            left.camera.positionM[2] - depthM,
          ]
          if (![disparity, depthM, localX, localY, ...positionM].every(Number.isFinite)
            || positionM.some(component => Math.abs(component) > MAX_OUTPUT_COORDINATE_M)) {
            fail('reconstruction', 'produced a non-finite or out-of-bounds point; this camera configuration is unsupported')
          }
          const colorOffset = pixelIndex * 3
          points.push({
            pixelIndex,
            positionM,
            color: [leftRgb[colorOffset]!, leftRgb[colorOffset + 1]!, leftRgb[colorOffset + 2]!],
            disparityPx: disparity,
            meanAbsoluteError: match.meanAbsoluteError!,
          })
        }
      }
      outcomes[pixelIndex] = OUTCOME_CODE[outcome]!
      counts[outcome] += 1
    }
  }

  return {
    status: points.length > 0 ? 'reconstructed' : 'empty',
    width, height, baselineM,
    settings: { ...config },
    outcomes,
    counts,
    points,
  }
}
