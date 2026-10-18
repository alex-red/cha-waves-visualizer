import { describe, expect, it } from 'vitest'
import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoImage, type StereoInput, type StereoSettings } from './spatial-stereo-types.ts'
import { reconstructStereo } from './spatial-stereo.ts'

const width = 64
const height = 48
const intrinsics = { width, height, fx: 40, fy: 40, cx: width / 2, cy: height / 2 }

function noise(x: number, y: number, salt = 0): number {
  let value = Math.imul((x + salt + 1024) | 0, 0x45d9f3b)
  value = Math.imul(value ^ ((y + 4096) | 0), 0x45d9f3b)
  value = (value ^ (value >>> 16)) >>> 0
  return value & 0xff
}

function texture(x: number, y: number, salt = 0): [number, number, number] {
  return [noise(x, y, salt), noise(x + 127, y + 17, salt + 31), noise(x - 43, y + 83, salt + 67)]
}

function smoothTexture(x: number, y: number): [number, number, number] {
  const channels = [0, 1, 2].map(channel => 128
    + 58 * Math.sin(0.31 * x + 0.23 * y + channel * 1.7)
    + 43 * Math.cos(0.17 * x - 0.37 * y + channel * 0.9)
    + 27 * Math.sin(0.11 * x + 0.41 * y + channel * 2.4))
  return channels.map(value => Math.max(0, Math.min(255, Math.round(value)))) as [number, number, number]
}

function imagePair(disparity: number, mode: 'random' | 'periodic' | 'blank' | 'corrupt' = 'random'): StereoInput {
  const leftRgb = new Uint8Array(width * height * 3)
  const rightRgb = new Uint8Array(width * height * 3)
  const floorX = Math.floor(disparity)
  const fraction = disparity - floorX
  const store = (rgb: Uint8Array, x: number, y: number, color: readonly number[]) => {
    const offset = (y * width + x) * 3
    rgb[offset] = color[0]!
    rgb[offset + 1] = color[1]!
    rgb[offset + 2] = color[2]!
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let leftColor: readonly number[]
      if (mode === 'blank') leftColor = [96, 96, 96]
      else if (mode === 'periodic') {
        const stripe = ((x % 8) < 4) ? 210 : 24
        leftColor = [stripe, (y * 37) % 255, 255 - stripe]
      } else leftColor = mode === 'random' && fraction !== 0 ? smoothTexture(x, y) : texture(x, y)
      store(leftRgb, x, y, leftColor)

      let rightColor: readonly number[]
      if (mode === 'blank') rightColor = [96, 96, 96]
      else if (mode === 'corrupt') rightColor = texture(x, y, 901)
      else if (mode === 'periodic') {
        const sampleX = x + floorX
        const stripe = ((sampleX % 8) < 4) ? 210 : 24
        rightColor = [stripe, (y * 37) % 255, 255 - stripe]
      } else if (fraction !== 0) {
        rightColor = smoothTexture(x + disparity, y)
      } else {
        rightColor = texture(x + floorX, y)
      }
      store(rightRgb, x, y, rightColor)
    }
  }

  const leftImage: StereoImage = { width, height, rgb: leftRgb }
  const rightImage: StereoImage = { width, height, rgb: rightRgb }
  return {
    left: { camera: { id: 'left', positionM: [0, 0, 0], intrinsics }, image: leftImage },
    right: { camera: { id: 'right', positionM: [0.3, 0, 0], intrinsics: { ...intrinsics } }, image: rightImage },
  }
}

const tuned: StereoSettings = {
  ...STEREO_SETTINGS,
  minDisparity: 4,
  maxDisparity: 24,
  patchRadius: 2,
  minTextureVariance: 24,
  maxMeanAbsoluteError: 18,
  uniquenessRatio: 0.8,
  leftRightTolerancePx: 1,
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

describe('bounded calibrated rectified stereo', () => {
  it('recovers integer disparity, metric depth and pixel-centre coordinates', () => {
    const input = imagePair(12)
    const result = reconstructStereo(input, tuned)
    expect(result.status).toBe('reconstructed')
    expect(result.baselineM).toBeCloseTo(0.3, 12)
    expect(result.counts.accepted).toBeGreaterThan(width * height * 0.2)
    expect(sumCounts(result.counts)).toBe(width * height)
    expect(result.outcomes).toHaveLength(width * height)
    const center = result.points.find(point => point.pixelIndex === 24 * width + 32)
    expect(center).toBeDefined()
    expect(center!.disparityPx).toBeCloseTo(12, 10)
    expect(center!.positionM[2]).toBeCloseTo(-1, 10)
    expect(center!.positionM[0]).toBeCloseTo(0.0125, 10)
    expect(center!.positionM[1]).toBeCloseTo(-0.0125, 10)
    expect(center!.color).toEqual(Array.from(input.left.image.rgb.slice(center!.pixelIndex * 3, center!.pixelIndex * 3 + 3)))
  })

  it('refines a fractional pixel disparity without modifying the source images', () => {
    const input = imagePair(11.4)
    const leftBefore = input.left.image.rgb.slice()
    const rightBefore = input.right.image.rgb.slice()
    const result = reconstructStereo(input, tuned)
    const central = result.points.filter(point => {
      const x = point.pixelIndex % width
      const y = Math.floor(point.pixelIndex / width)
      return x > 14 && x < 50 && y > 8 && y < 40
    })
    expect(central.length).toBeGreaterThan(100)
    const sorted = central.map(point => point.disparityPx).sort((a, b) => a - b)
    expect(sorted[Math.floor(sorted.length / 2)]).toBeCloseTo(11.4, 0)
    expect(input.left.image.rgb).toEqual(leftBefore)
    expect(input.right.image.rgb).toEqual(rightBefore)
  })

  it('keeps a rejection outcome for every pixel on textureless input', () => {
    const result = reconstructStereo(imagePair(12, 'blank'), tuned)
    expect(result.status).toBe('empty')
    expect(result.points).toEqual([])
    expect(result.counts.textureless).toBeGreaterThan(0)
    expect(result.counts.border).toBeGreaterThan(0)
    expect(sumCounts(result.counts)).toBe(width * height)
    expect(new Set(result.outcomes).size).toBe(2)
  })

  it('rejects corrupted correspondence and repeated-texture ambiguity rather than filling holes', () => {
    const corrupt = reconstructStereo(imagePair(12, 'corrupt'), tuned)
    expect(corrupt.status).toBe('empty')
    expect(corrupt.counts.accepted).toBe(0)
    expect(corrupt.counts.photometric + corrupt.counts.ambiguous + corrupt.counts.inconsistent).toBeGreaterThan(0)

    const repeated = reconstructStereo(imagePair(12, 'periodic'), tuned)
    expect(repeated.counts.ambiguous).toBeGreaterThan(width * height * 0.2)
    expect(repeated.points.length).toBeLessThan(width * height * 0.1)
    expect(sumCounts(repeated.counts)).toBe(width * height)
  })

  it('rejects unsupported calibration, dimensions, and matcher settings with field paths', () => {
    const valid = imagePair(12)
    expect(() => reconstructStereo({ ...valid, right: { ...valid.right, camera: { ...valid.right.camera, positionM: [0.3, 0.01, 0] } } }, tuned)).toThrow(/right\.camera\.positionM/)
    expect(() => reconstructStereo({ ...valid, right: { ...valid.right, camera: { ...valid.right.camera, intrinsics: { ...intrinsics, fx: 41 } } } }, tuned)).toThrow(/intrinsics\.fx/)
    expect(() => reconstructStereo({ ...valid, right: { ...valid.right, image: { ...valid.right.image, width: width - 1 } } }, tuned)).toThrow(/image/)
    expect(() => reconstructStereo(valid, { ...tuned, maxDisparity: width })).toThrow(/maxDisparity/)
    expect(() => reconstructStereo(valid, { ...tuned, patchRadius: 0 })).toThrow(/patchRadius/)
    expect(() => reconstructStereo(valid, { ...tuned, uniquenessRatio: 0 })).toThrow(/uniquenessRatio/)
    expect(() => reconstructStereo(valid, { ...tuned, uniquenessRatio: 1 })).toThrow(/uniquenessRatio/)
    expect(() => reconstructStereo(valid, { ...tuned, leftRightTolerancePx: 4.01 })).toThrow(/leftRightTolerancePx/)
  })

  it('rejects unmodeled fields and unsafe focal lengths instead of silently ignoring them', () => {
    const valid = imagePair(12)
    const cases: [string, unknown][] = [
      ['input', { ...valid, extra: true }],
      ['left', { ...valid, left: { ...valid.left, extra: true } }],
      ['camera', { ...valid, left: { ...valid.left, camera: { ...valid.left.camera, orientationXyzw: [0, 0, 0, 1] } } }],
      ['intrinsics', { ...valid, left: { ...valid.left, camera: { ...valid.left.camera, intrinsics: { ...intrinsics, skew: 1 } } } }],
      ['image', { ...valid, left: { ...valid.left, image: { ...valid.left.image, depthM: [] } } }],
      ['fx', { ...valid, left: { ...valid.left, camera: { ...valid.left.camera, intrinsics: { ...intrinsics, fx: 1e-4 } } } }],
      ['fx', { ...valid, left: { ...valid.left, camera: { ...valid.left.camera, intrinsics: { ...intrinsics, fx: 10_001 } } } }],
      ['positionM', { ...valid, left: { ...valid.left, camera: { ...valid.left.camera, positionM: [1_001, 0, 0] } } }],
    ]
    for (const [field, input] of cases) {
      expect(() => reconstructStereo(input as StereoInput, tuned)).toThrow(new RegExp(field))
    }
  })

  it('keeps extreme but supported focal/baseline arithmetic finite and bounded', () => {
    const valid = imagePair(12)
    const highFocal = { ...intrinsics, fx: 10_000, fy: 10_000 }
    const wideBaseline: StereoInput = {
      ...valid,
      left: { ...valid.left, camera: { ...valid.left.camera, intrinsics: highFocal } },
      right: { ...valid.right, camera: { ...valid.right.camera, positionM: [10, 0, 0], intrinsics: { ...highFocal } } },
    }
    const result = reconstructStereo(wideBaseline, tuned)
    expect(result.status).toBe('reconstructed')
    for (const point of result.points) {
      expect(point.positionM.every(Number.isFinite)).toBe(true)
      expect(point.positionM.every(value => Math.abs(value) <= 1_000_000)).toBe(true)
    }
  })

  it('guards impossible baselines and preserves outcome-code/count correspondence', () => {
    const valid = imagePair(12)
    expect(() => reconstructStereo({ ...valid, right: { ...valid.right, camera: { ...valid.right.camera, positionM: [0, 0, 0] } } }, tuned)).toThrow(/baseline/)
    const result = reconstructStereo(valid, tuned)
    const codeCounts = STEREO_OUTCOMES.map((outcome, code) => [outcome, result.outcomes.filter(value => value === code).length] as const)
    for (const [outcome, count] of codeCounts) expect(result.counts[outcome]).toBe(count)
  })
})
