import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoInput, type StereoOutcome, type StereoPoint, type StereoResult, type StereoSettings, type StereoView } from './spatial-stereo-types.ts'
import { validateStereoInput } from './spatial-stereo.ts'

/** Bounded four-cardinal-path Census SGM candidate, separate from the frozen SAD baseline. */
export type StereoSgmSettings = { p1: number; p2: number; maxCensusCost: number; minComponentPixels: number }
export const STEREO_SGM_SETTINGS: Readonly<StereoSgmSettings> = Object.freeze({
  p1: 2,
  p2: 12,
  maxCensusCost: 6,
  minComponentPixels: 12,
})

export type StereoSgmAblationId = 'census-sgm' | 'census-local' | 'without-texture' | 'without-rgb' | 'without-uniqueness' | 'without-left-right' | 'without-components' | 'without-endpoints'
export type StereoSgmAblationConfig = Readonly<{
  id: StereoSgmAblationId
  aggregation: 'sgm' | 'local'
  textureGate: boolean
  rgbGate: boolean
  uniquenessGate: boolean
  leftRightGate: boolean
  componentGate: boolean
  endpointGate: boolean
}>

function ablation(id: StereoSgmAblationId, overrides: Partial<Omit<StereoSgmAblationConfig, 'id'>> = {}): StereoSgmAblationConfig {
  return Object.freeze({
    id,
    aggregation: 'sgm',
    textureGate: true,
    rgbGate: true,
    uniquenessGate: true,
    leftRightGate: true,
    componentGate: true,
    endpointGate: true,
    ...overrides,
  })
}

/** Fixed, single-factor controls for synthetic development diagnostics only. */
export const STEREO_SGM_ABLATIONS: readonly StereoSgmAblationConfig[] = Object.freeze([
  ablation('census-sgm'),
  ablation('census-local', { aggregation: 'local' }),
  ablation('without-texture', { textureGate: false }),
  ablation('without-rgb', { rgbGate: false }),
  ablation('without-uniqueness', { uniquenessGate: false }),
  ablation('without-left-right', { leftRightGate: false }),
  ablation('without-components', { componentGate: false }),
  ablation('without-endpoints', { endpointGate: false }),
])

const MAX_WIDTH = 256
const MAX_HEIGHT = 192
const MAX_OUTPUT_COORDINATE_M = 1_000_000
const INVALID = 255
const GRAY = [0.299, 0.587, 0.114] as const
const CODE: Readonly<Record<StereoOutcome, number>> = Object.freeze(
  Object.fromEntries(STEREO_OUTCOMES.map((outcome, index) => [outcome, index])) as Record<StereoOutcome, number>,
)

type Match = { outcome: StereoOutcome; disparityPx?: number; meanAbsoluteError?: number }
type Checked = { left: StereoView; right: StereoView; settings: StereoSettings; baselineM: number }

function fail(path: string, reason: string): never { throw new Error(`${path} ${reason}.`) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function finite(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `must be a finite number from ${min} through ${max}`)
  return value
}
function validateSgmSettings(value: unknown): StereoSgmSettings {
  if (!record(value)) fail('sgmSettings', 'must be an object')
  const keys = ['p1', 'p2', 'maxCensusCost', 'minComponentPixels'] as const
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key as typeof keys[number]))) fail('sgmSettings', 'contains unsupported or missing fields')
  const p1 = finite(value.p1, 'sgmSettings.p1', 1, 24)
  const p2 = finite(value.p2, 'sgmSettings.p2', p1 + 1, 96)
  const maxCensusCost = finite(value.maxCensusCost, 'sgmSettings.maxCensusCost', 1, 24)
  const minComponentPixels = finite(value.minComponentPixels, 'sgmSettings.minComponentPixels', 1, MAX_WIDTH * MAX_HEIGHT)
  if (![p1, p2, maxCensusCost, minComponentPixels].every(Number.isInteger)) fail('sgmSettings', 'values must be integers')
  return { p1, p2, maxCensusCost, minComponentPixels }
}
function validateInput(input: unknown, settingsInput: unknown, sgmInput: unknown): Checked & { sgm: StereoSgmSettings } {
  const { left, right, settings, baselineM } = validateStereoInput(input, settingsInput)
  if (settings.patchRadius !== 2) fail('settings.patchRadius', 'must equal 2 for the supported 5x5 Census descriptor')
  if (settings.maxDisparity - settings.minDisparity + 1 > 64) fail('settings', 'must contain no more than 64 disparity labels for the bounded SGM cost volume')
  return { left, right, settings, baselineM, sgm: validateSgmSettings(sgmInput) }
}

function grayAt(rgb: Uint8Array<ArrayBuffer>, index: number): number { return rgb[index]! * GRAY[0] + rgb[index + 1]! * GRAY[1] + rgb[index + 2]! * GRAY[2] }
function census(rgb: Uint8Array<ArrayBuffer>, width: number, height: number): Uint32Array<ArrayBuffer> {
  const result = new Uint32Array(width * height)
  for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
    const center = grayAt(rgb, (y * width + x) * 3)
    let descriptor = 0
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      if (dx === 0 && dy === 0) continue
      descriptor = (descriptor << 1) | (grayAt(rgb, ((y + dy) * width + x + dx) * 3) < center ? 1 : 0)
    }
    result[y * width + x] = descriptor
  }
  return result
}
function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}
function patchVariance(rgb: Uint8Array<ArrayBuffer>, width: number, x: number, y: number): number {
  let sum = 0; let squares = 0
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    const value = grayAt(rgb, ((y + dy) * width + x + dx) * 3)
    sum += value; squares += value * value
  }
  return Math.max(0, squares / 25 - (sum / 25) ** 2)
}
function patchMae(ref: Uint8Array<ArrayBuffer>, src: Uint8Array<ArrayBuffer>, width: number, x: number, y: number, sx: number): number {
  let total = 0
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    const a = ((y + dy) * width + x + dx) * 3; const b = ((y + dy) * width + sx + dx) * 3
    total += Math.abs(ref[a]! - src[b]!) + Math.abs(ref[a + 1]! - src[b + 1]!) + Math.abs(ref[a + 2]! - src[b + 2]!)
  }
  return total / 75
}
function aggregate(cost: Uint8Array<ArrayBuffer>, width: number, height: number, disparities: number, p1: number, p2: number): Uint32Array<ArrayBuffer> {
  const total = new Uint32Array(cost.length)
  const path = new Uint16Array(disparities)
  const previous = new Uint16Array(disparities)
  const run = (startX: number, startY: number, dx: number, dy: number) => {
    let x = startX; let y = startY; let hasPrevious = false
    while (x >= 0 && x < width && y >= 0 && y < height) {
      const pixel = y * width + x
      const base = pixel * disparities
      let minPrevious = 0xffff
      if (hasPrevious) for (let d = 0; d < disparities; d += 1) if (previous[d]! < minPrevious) minPrevious = previous[d]!
      for (let d = 0; d < disparities; d += 1) {
        const c = cost[base + d]!
        if (c === INVALID) { path[d] = 0xffff; continue }
        if (!hasPrevious || minPrevious === 0xffff) { path[d] = c; continue }
        const same = previous[d]!
        const lower = d > 0 ? previous[d - 1]! + p1 : 0xffff
        const upper = d + 1 < disparities ? previous[d + 1]! + p1 : 0xffff
        const jump = minPrevious + p2
        const candidate = Math.min(same, lower, upper, jump)
        path[d] = candidate >= 0xffff ? 0xffff : c + candidate - minPrevious
      }
      for (let d = 0; d < disparities; d += 1) {
        const index = base + d
        if (path[d] !== 0xffff) total[index] = total[index]! + path[d]!
      }
      previous.set(path)
      hasPrevious = true
      x += dx; y += dy
    }
  }
  // Each pixel belongs to exactly one scanline for each of the four cardinal directions.
  for (let y = 0; y < height; y += 1) { run(0, y, 1, 0); run(width - 1, y, -1, 0) }
  for (let x = 0; x < width; x += 1) { run(x, 0, 0, 1); run(x, height - 1, 0, -1) }
  return total
}

function buildMatches(reference: StereoView, source: StereoView, direction: -1 | 1, config: StereoSettings, sgm: StereoSgmSettings, variant: StereoSgmAblationConfig): Match[] {
  const { width, height, rgb: refRgb } = reference.image
  const srcRgb = source.image.rgb
  const pixels = width * height
  const disparityCount = config.maxDisparity - config.minDisparity + 1
  const refCensus = census(refRgb, width, height)
  const srcCensus = census(srcRgb, width, height)
  const cost = new Uint8Array(pixels * disparityCount)
  cost.fill(INVALID)
  for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
    const base = (y * width + x) * disparityCount
    for (let i = 0; i < disparityCount; i += 1) {
      const sx = x + direction * (config.minDisparity + i)
      if (sx < 2 || sx >= width - 2) continue
      cost[base + i] = popcount(refCensus[y * width + x]! ^ srcCensus[y * width + sx]!)
    }
  }
  const summed = variant.aggregation === 'sgm' ? aggregate(cost, width, height, disparityCount, sgm.p1, sgm.p2) : null
  const matches = new Array<Match>(pixels)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    if (x - 2 < 0 || x + 2 >= width || y - 2 < 0 || y + 2 >= height) { matches[pixel] = { outcome: 'border' }; continue }
    if (variant.textureGate && patchVariance(refRgb, width, x, y) < config.minTextureVariance) { matches[pixel] = { outcome: 'textureless' }; continue }
    const base = pixel * disparityCount
    let best = -1; let bestCost = Infinity
    for (let i = 0; i < disparityCount; i += 1) {
      if (cost[base + i] === INVALID) continue
      const value = summed ? summed[base + i]! : cost[base + i]!
      if (value < bestCost) { best = i; bestCost = value }
    }
    if (best < 0) { matches[pixel] = { outcome: 'border' }; continue }
    if (cost[base + best]! > sgm.maxCensusCost) { matches[pixel] = { outcome: 'photometric' }; continue }
    const disparity = config.minDisparity + best
    if (variant.endpointGate && (disparity === config.minDisparity || disparity === config.maxDisparity)) { matches[pixel] = { outcome: 'ambiguous' }; continue }
    if (variant.uniquenessGate) {
      let second = Infinity
      for (let i = 0; i < disparityCount; i += 1) {
        if (Math.abs(i - best) <= 1 || cost[base + i] === INVALID) continue
        second = Math.min(second, summed ? summed[base + i]! : cost[base + i]!)
      }
      if (!Number.isFinite(second) || second <= 0 || bestCost / second > config.uniquenessRatio) { matches[pixel] = { outcome: 'ambiguous' }; continue }
    }
    const mae = patchMae(refRgb, srcRgb, width, x, y, x + direction * disparity)
    if (variant.rgbGate && mae > config.maxMeanAbsoluteError) { matches[pixel] = { outcome: 'photometric' }; continue }
    let offset = 0
    if (best > 0 && best + 1 < disparityCount && cost[base + best - 1] !== INVALID && cost[base + best + 1] !== INVALID) {
      const lower = summed ? summed[base + best - 1]! : cost[base + best - 1]!
      const upper = summed ? summed[base + best + 1]! : cost[base + best + 1]!
      const denominator = lower - 2 * bestCost + upper
      if (denominator > 1e-9) offset = Math.max(-1, Math.min(1, 0.5 * (lower - upper) / denominator))
    }
    matches[pixel] = { outcome: 'accepted', disparityPx: disparity + offset, meanAbsoluteError: mae }
  }
  return matches
}

function removeSmallComponents(matches: Match[], width: number, height: number, minimum: number): void {
  const visited = new Uint8Array(matches.length)
  for (let index = 0; index < matches.length; index += 1) {
    if (visited[index] || matches[index]!.outcome !== 'accepted') continue
    const component: number[] = [index]; visited[index] = 1
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const current = component[cursor]!
      const x = current % width; const y = Math.floor(current / width)
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1]
      for (const next of neighbors) {
        if (next < 0 || visited[next] || matches[next]!.outcome !== 'accepted') continue
        if (Math.abs(matches[next]!.disparityPx! - matches[current]!.disparityPx!) > 1) continue
        visited[next] = 1; component.push(next)
      }
    }
    if (component.length < minimum) for (const pixel of component) matches[pixel] = { outcome: 'inconsistent' }
  }
}

function reconstructWithAblation(input: StereoInput, settings: StereoSettings, sgmSettings: StereoSgmSettings, variant: StereoSgmAblationConfig): StereoResult {
  const checked = validateInput(input, settings, sgmSettings)
  const { left, right, baselineM, settings: config, sgm } = checked
  const { width, height, rgb: leftRgb } = left.image
  const reverse = buildMatches(right, left, 1, config, sgm, variant)
  const matches = buildMatches(left, right, -1, config, sgm, variant)
  if (variant.leftRightGate) {
    for (let pixel = 0; pixel < matches.length; pixel += 1) {
      const match = matches[pixel]!
      if (match.outcome !== 'accepted') continue
      const x = pixel % width; const y = Math.floor(pixel / width)
      const rightX = Math.round(x - match.disparityPx!)
      const reverseMatch = rightX >= 0 && rightX < width ? reverse[y * width + rightX]! : null
      if (!reverseMatch || reverseMatch.outcome !== 'accepted' || Math.abs(reverseMatch.disparityPx! - match.disparityPx!) > config.leftRightTolerancePx) matches[pixel] = { outcome: 'inconsistent' }
    }
  }
  if (variant.componentGate) removeSmallComponents(matches, width, height, sgm.minComponentPixels)
  const outcomes = new Uint8Array(width * height)
  const points: StereoPoint[] = []
  const counts: Record<StereoOutcome, number> = { border: 0, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 }
  const { fx, fy, cx, cy } = left.camera.intrinsics
  const doffs = right.camera.intrinsics.cx - cx
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    const match = matches[pixel]!
    const outcome = match.outcome
    if (outcome === 'accepted') {
      const disparity = match.disparityPx!
      const depthM = fx * baselineM / (disparity + doffs)
      const localX = ((x + 0.5 - cx) * depthM) / fx
      const localY = -((y + 0.5 - cy) * depthM) / fy
      const positionM: [number, number, number] = [left.camera.positionM[0] + localX, left.camera.positionM[1] + localY, left.camera.positionM[2] - depthM]
      if (![disparity, depthM, localX, localY, ...positionM].every(Number.isFinite) || positionM.some(value => Math.abs(value) > MAX_OUTPUT_COORDINATE_M)) fail('reconstruction', 'produced a non-finite or out-of-bounds point; this camera configuration is unsupported')
      const color = pixel * 3
      points.push({ pixelIndex: pixel, positionM, color: [leftRgb[color]!, leftRgb[color + 1]!, leftRgb[color + 2]!], disparityPx: disparity, meanAbsoluteError: match.meanAbsoluteError! })
    }
    outcomes[pixel] = CODE[outcome]!
    counts[outcome] += 1
  }
  return { status: points.length > 0 ? 'reconstructed' : 'empty', width, height, baselineM, settings: { ...config }, outcomes, counts, points }
}

/** Reconstruct with the fixed production candidate configuration. */
export function reconstructStereoSgm(input: StereoInput, settings: StereoSettings = STEREO_SETTINGS, sgmSettings: StereoSgmSettings = STEREO_SGM_SETTINGS): StereoResult {
  return reconstructWithAblation(input, settings, sgmSettings, STEREO_SGM_ABLATIONS[0]!)
}

/** Run a fixed single-factor candidate control for bounded synthetic diagnostics. */
export function reconstructStereoSgmAblation(input: StereoInput, settings: StereoSettings, variantId: string): StereoResult {
  const variant = STEREO_SGM_ABLATIONS.find(item => item.id === variantId)
  if (!variant) fail('variantId', 'is unsupported')
  return reconstructWithAblation(input, settings, STEREO_SGM_SETTINGS, variant)
}
