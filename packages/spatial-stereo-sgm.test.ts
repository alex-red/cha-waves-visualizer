import { describe, expect, it } from 'vitest'
import { STEREO_SETTINGS, type StereoInput, type StereoSettings } from './spatial-stereo-types.ts'
import { reconstructStereoSgm, STEREO_SGM_SETTINGS } from './spatial-stereo-sgm.ts'

const width = 64
const height = 48
const intrinsics = { width, height, fx: 40, fy: 40, cx: width / 2, cy: height / 2 }
const settings: StereoSettings = { ...STEREO_SETTINGS, minDisparity: 4, maxDisparity: 24, patchRadius: 2 }

function texture(x: number, y: number): [number, number, number] {
  let n = Math.imul((x + 1024) | 0, 0x45d9f3b)
  n = Math.imul(n ^ ((y + 4096) | 0), 0x45d9f3b)
  n = (n ^ (n >>> 16)) >>> 0
  const a = n & 255
  return [a, (a * 37 + x * 11) & 255, (a * 13 + y * 19) & 255]
}
function smooth(x: number, y: number): [number, number, number] {
  return [0, 1, 2].map(channel => Math.round(128 + 50 * Math.sin(0.31 * x + 0.23 * y + channel * 1.7) + 42 * Math.cos(0.17 * x - 0.37 * y + channel * 0.9))) as [number, number, number]
}
function pair(disparity: number, kind: 'noise' | 'smooth' | 'blank' | 'repeat' = 'noise', brightness = 0): StereoInput {
  const left = new Uint8Array(width * height * 3)
  const right = new Uint8Array(width * height * 3)
  const sample = (x: number, y: number): [number, number, number] => {
    if (kind === 'blank') return [96, 96, 96]
    if (kind === 'repeat') return [x % 8 < 4 ? 210 : 24, (y * 37) % 255, x % 8 < 4 ? 45 : 231]
    return kind === 'smooth' ? smooth(x, y) : texture(Math.round(x), y)
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const li = (y * width + x) * 3
    const leftColor = sample(x, y)
    const rightColor = sample(x + disparity, y).map(value => Math.max(0, Math.min(255, value + brightness)))
    for (let channel = 0; channel < 3; channel += 1) {
      left[li + channel] = leftColor[channel]!
      right[li + channel] = rightColor[channel]!
    }
  }
  return {
    left: { camera: { id: 'left', positionM: [0, 0, 0], intrinsics }, image: { width, height, rgb: left } },
    right: { camera: { id: 'right', positionM: [0.3, 0, 0], intrinsics: { ...intrinsics } }, image: { width, height, rgb: right } },
  }
}
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]! }

describe('bounded Census SGM stereo candidate', () => {
  it('recovers integer disparity and metric depth on a synthetic rectified pair', () => {
    const result = reconstructStereoSgm(pair(12), settings)
    const center = result.points.find(point => point.pixelIndex === 24 * width + 32)
    expect(center).toBeDefined()
    expect(center!.disparityPx).toBeCloseTo(12, 0)
    expect(center!.positionM[2]).toBeCloseTo(-1, 1)
    expect(result.counts.accepted).toBeGreaterThan(150)
    expect(result.outcomes).toHaveLength(width * height)
  })

  it('uses subpixel interpolation for fractional disparity and tolerates a modest brightness shift', () => {
    const result = reconstructStereoSgm(pair(11.4, 'smooth', 5), settings)
    const central = result.points.filter(point => {
      const x = point.pixelIndex % width; const y = Math.floor(point.pixelIndex / width)
      return x > 14 && x < 50 && y > 8 && y < 40
    })
    expect(central.length).toBeGreaterThan(100)
    const medianDisparity = median(central.map(point => point.disparityPx))
    expect(Math.abs(medianDisparity - 11.4)).toBeLessThanOrEqual(0.25)
    expect(Math.abs(medianDisparity - Math.round(medianDisparity))).toBeGreaterThan(0.01)
  })

  it('preserves blank and repeated-texture ambiguity as outcomes without filling them', () => {
    const blank = reconstructStereoSgm(pair(12, 'blank'), settings)
    expect(blank.status).toBe('empty')
    expect(blank.counts.textureless).toBeGreaterThan(0)
    expect(blank.points).toEqual([])
    const repeated = reconstructStereoSgm(pair(12, 'repeat'), settings)
    expect(repeated.counts.ambiguous).toBeGreaterThan(100)
    expect(repeated.points.length).toBeLessThan(width * height * 0.1)
    for (const result of [blank, repeated]) expect(Object.values(result.counts).reduce((a, b) => a + b, 0)).toBe(width * height)
  })

  it('applies maxCensusCost to raw Hamming cost instead of clipping the SGM costs', () => {
    const input = pair(12)
    for (let index = 0; index < input.right.image.rgb.length; index += 1) input.right.image.rgb[index] = 255 - input.right.image.rgb[index]!
    const result = reconstructStereoSgm(input, { ...settings, maxMeanAbsoluteError: 255 }, { ...STEREO_SGM_SETTINGS, maxCensusCost: 1 })
    expect(result.counts.photometric).toBeGreaterThan(0)
    expect(result.counts.accepted).toBe(0)
  })

  it('does not refine across a disparity label whose source coordinate is outside the Census image', () => {
    const result = reconstructStereoSgm(pair(5), { ...settings, minDisparity: 3, maxDisparity: 12 }, { ...STEREO_SGM_SETTINGS, minComponentPixels: 1 })
    const edgePoint = result.points.find(point => point.pixelIndex === 24 * width + 7)
    expect(edgePoint).toBeDefined()
    expect(edgePoint!.disparityPx).toBeCloseTo(5, 8)
  })

  it('rejects unsupported Census radii and clipped disparity-range winners', () => {
    expect(() => reconstructStereoSgm(pair(12), { ...settings, patchRadius: 1 })).toThrow(/patchRadius/)
    const clipped = reconstructStereoSgm(pair(24), { ...settings, minDisparity: 4, maxDisparity: 12 })
    expect(clipped.counts.ambiguous).toBeGreaterThan(0)
  })
})
