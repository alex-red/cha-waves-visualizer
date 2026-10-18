import { createStereoDevelopmentCases, type StereoDevelopmentCase } from './stereo-development.ts'
import type { StereoImage, StereoView } from '../spatial-stereo-types.ts'

export type StereoConfidenceRole = 'positive' | 'negative'
export type StereoConfidenceCase = {
  fixture: StereoDevelopmentCase
  role: StereoConfidenceRole
  unsupportedPixels: number[]
  notes: string
}

const WIDTH = 160
const HEIGHT = 120
const PATCH_RADIUS = 2
const SEARCH_MIN = 4
const SEARCH_MAX = 28
const LEFT_INTERIOR = Object.freeze({ minX: SEARCH_MAX + PATCH_RADIUS, maxX: WIDTH - 1 - PATCH_RADIUS, minY: PATCH_RADIUS, maxY: HEIGHT - 1 - PATCH_RADIUS })
const RIGHT_PATCH = Object.freeze({ minX: 50, maxX: 110, minY: 30, maxY: 90, margin: 3 })

function cloneView(view: StereoView): StereoView {
  return {
    camera: { ...view.camera, positionM: [...view.camera.positionM] as [number, number, number], intrinsics: { ...view.camera.intrinsics } },
    image: { width: view.image.width, height: view.image.height, rgb: view.image.rgb.slice() as Uint8Array<ArrayBuffer> } satisfies StereoImage,
  }
}

function cloneFixture(source: StereoDevelopmentCase, id = source.id): StereoDevelopmentCase {
  return {
    id,
    split: 'development',
    input: { left: cloneView(source.input.left), right: cloneView(source.input.right) },
    truth: {
      camera: { ...source.truth.camera, positionM: [...source.truth.camera.positionM] as [number, number, number], intrinsics: { ...source.truth.camera.intrinsics } },
      disparityPx: [...source.truth.disparityPx],
      depthM: [...source.truth.depthM],
    },
    regions: { boundary: [...source.regions.boundary], weakTexture: [...source.regions.weakTexture], occlusion: [...source.regions.occlusion] },
  }
}

function nullTruth(fixture: StereoDevelopmentCase): void {
  fixture.truth.disparityPx = Array(WIDTH * HEIGHT).fill(null)
  fixture.truth.depthM = Array(WIDTH * HEIGHT).fill(null)
  fixture.regions = { boundary: [], weakTexture: [], occlusion: [] }
}

function mix32(x: number, y: number, channel: number, seed: number): number {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(channel + 1, 2246822519) ^ seed
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return (value ^ (value >>> 16)) >>> 0
}

function byteNoise(x: number, y: number, channel: number, seed: number): number {
  return mix32(x, y, channel, seed) & 255
}

function signedNoise(x: number, y: number, channel: number, seed: number): number {
  return mix32(x, y, channel, seed) % 7 - 3
}

function clampByte(value: number): number { return Math.max(0, Math.min(255, Math.round(value))) }

function blankFixture(id: string, source: StereoDevelopmentCase): StereoDevelopmentCase {
  const fixture = cloneFixture(source, id)
  nullTruth(fixture)
  return fixture
}

function unsupportedInterior(): number[] {
  const pixels: number[] = []
  for (let y = LEFT_INTERIOR.minY; y <= LEFT_INTERIOR.maxY; y += 1) {
    for (let x = LEFT_INTERIOR.minX; x <= LEFT_INTERIOR.maxX; x += 1) pixels.push(y * WIDTH + x)
  }
  return pixels
}

function makeUniformNegative(source: StereoDevelopmentCase): StereoConfidenceCase {
  const fixture = blankFixture('confidence-negative-uniform', source)
  fixture.input.left.image.rgb.fill(96)
  fixture.input.right.image.rgb.fill(96)
  return { fixture, role: 'negative', unsupportedPixels: unsupportedInterior(), notes: 'Uniform RGB 96 images provide no correspondence evidence; geometry truth is intentionally unknown.' }
}

function makeIndependentNoiseNegative(source: StereoDevelopmentCase): StereoConfidenceCase {
  const fixture = blankFixture('confidence-negative-independent-noise', source)
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const offset = (y * WIDTH + x) * 3
    for (let channel = 0; channel < 3; channel += 1) {
      fixture.input.left.image.rgb[offset + channel] = byteNoise(x, y, channel, 2017)
      fixture.input.right.image.rgb[offset + channel] = byteNoise(x, y, channel, 7019)
    }
  }
  return { fixture, role: 'negative', unsupportedPixels: unsupportedInterior(), notes: 'Independent seeded RGB noise in each view has no shared surface correspondence; geometry truth is intentionally unknown.' }
}

function makePeriodicNegative(source: StereoDevelopmentCase): StereoConfidenceCase {
  const fixture = blankFixture('confidence-negative-periodic-stripes', source)
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const offset = (y * WIDTH + x) * 3
    for (let channel = 0; channel < 3; channel += 1) {
      const high = [220, 180, 230][channel]!
      const low = [24, 45, 32][channel]!
      const stripe = x % 8 < 4 ? high : low
      const verticalVariation = mix32(0, y, channel, 8111) % 17 - 8
      const value = clampByte(stripe + verticalVariation)
      fixture.input.left.image.rgb[offset + channel] = value
      fixture.input.right.image.rgb[offset + channel] = value
    }
  }
  return { fixture, role: 'negative', unsupportedPixels: unsupportedInterior(), notes: 'An exactly 8-pixel-periodic vertical pattern repeats across the full frame with deterministic y variation and no unique markings; geometry truth is intentionally unknown.' }
}

function patchUnavailablePixels(source: StereoDevelopmentCase): number[] {
  const unavailable = new Set(source.regions.occlusion)
  const pixels: number[] = []
  const patchMinX = RIGHT_PATCH.minX + PATCH_RADIUS + RIGHT_PATCH.margin
  const patchMaxX = RIGHT_PATCH.maxX - PATCH_RADIUS - RIGHT_PATCH.margin
  const patchMinY = RIGHT_PATCH.minY + PATCH_RADIUS + RIGHT_PATCH.margin
  const patchMaxY = RIGHT_PATCH.maxY - PATCH_RADIUS - RIGHT_PATCH.margin
  for (let y = patchMinY; y <= patchMaxY; y += 1) for (let x = LEFT_INTERIOR.minX; x <= LEFT_INTERIOR.maxX; x += 1) {
    const pixel = y * WIDTH + x
    const disparity = source.truth.disparityPx[pixel]
    if (unavailable.has(pixel) || disparity === null || disparity === undefined) continue
    // The right-view 5x5 match support plus a further three-pixel margin stays in the damaged rectangle.
    const rightCenterX = x - disparity
    if (rightCenterX >= patchMinX && rightCenterX <= patchMaxX) pixels.push(pixel)
  }
  return pixels
}

function makePatchedNegative(source: StereoDevelopmentCase): StereoConfidenceCase {
  const fixture = cloneFixture(source, 'confidence-negative-right-patch')
  const unsupportedPixels = patchUnavailablePixels(source)
  for (let y = RIGHT_PATCH.minY; y <= RIGHT_PATCH.maxY; y += 1) for (let x = RIGHT_PATCH.minX; x <= RIGHT_PATCH.maxX; x += 1) {
    const offset = (y * WIDTH + x) * 3
    for (let channel = 0; channel < 3; channel += 1) fixture.input.right.image.rgb[offset + channel] = byteNoise(x, y, channel, 12347)
  }
  return { fixture, role: 'negative', unsupportedPixels, notes: 'A seeded independent-noise rectangle replaces right-view content. Truth is retained; unsupportedPixels includes only originally right-visible left pixels whose full 5x5 correspondence window has an additional three-pixel interior margin.' }
}

/** Original development positives plus fixed calibration/texture confidence controls; never runs an estimator. */
export function createStereoConfidenceCases(): StereoConfidenceCase[] {
  const original = createStereoDevelopmentCases('development')
  const positives: StereoConfidenceCase[] = original.map(source => ({
    fixture: cloneFixture(source), role: 'positive', unsupportedPixels: [],
    notes: 'Original ray-rendered development positive with unchanged input bytes, cameras, truth and diagnostic masks.',
  }))

  const exposed = cloneFixture(original[0]!, 'confidence-positive-exposure-noise')
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const offset = (y * WIDTH + x) * 3
    for (let channel = 0; channel < 3; channel += 1) {
      const base = exposed.input.right.image.rgb[offset + channel]!
      exposed.input.right.image.rgb[offset + channel] = clampByte(base * 1.12 + 8 + signedNoise(x, y, channel, 10007))
    }
  }
  positives.push({ fixture: exposed, role: 'positive', unsupportedPixels: [], notes: 'First original scene with right-view exposure gain 1.12, offset 8 and independent deterministic integer noise from -3 through +3 per RGB channel.' })

  const lowContrast = cloneFixture(original[0]!, 'confidence-positive-low-contrast')
  for (const view of [lowContrast.input.left, lowContrast.input.right]) {
    const rgb = view.image.rgb
    for (let index = 0; index < rgb.length; index += 1) rgb[index] = clampByte(96 + (rgb[index]! - 96) * 0.25)
  }
  positives.push({ fixture: lowContrast, role: 'positive', unsupportedPixels: [], notes: 'Both views of the first original scene quantized around RGB 96 with linear contrast gain 0.25; calibration, truth and masks are preserved.' })

  return [
    ...positives,
    makeUniformNegative(original[0]!),
    makeIndependentNoiseNegative(original[0]!),
    makePeriodicNegative(original[0]!),
    makePatchedNegative(original[0]!),
  ]
}
