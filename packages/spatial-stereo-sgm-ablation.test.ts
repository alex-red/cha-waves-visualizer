import { describe, expect, it } from 'vitest'
import { STEREO_SETTINGS, type StereoInput, type StereoSettings } from './spatial-stereo-types.ts'
import {
  reconstructStereoSgm,
  reconstructStereoSgmAblation,
  STEREO_SGM_ABLATIONS,
  STEREO_SGM_SETTINGS,
} from './spatial-stereo-sgm.ts'

const width = 64
const height = 48
const intrinsics = { width, height, fx: 40, fy: 40, cx: width / 2, cy: height / 2 }
const settings: StereoSettings = { ...STEREO_SETTINGS, minDisparity: 4, maxDisparity: 24 }

function noise(x: number, y: number): number {
  let value = Math.imul((x + 1024) | 0, 0x45d9f3b)
  value = Math.imul(value ^ ((y + 4096) | 0), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) & 255
}
function texture(x: number, y: number): [number, number, number] {
  const value = noise(x, y)
  return [value, (value * 37 + x * 11) & 255, (value * 13 + y * 19) & 255]
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
    const index = (y * width + x) * 3
    const a = sample(x, y)
    const b = sample(x + disparity, y).map(value => Math.max(0, Math.min(255, value + brightness)))
    for (let channel = 0; channel < 3; channel += 1) {
      left[index + channel] = a[channel]!
      right[index + channel] = b[channel]!
    }
  }
  return {
    left: { camera: { id: 'left', positionM: [0, 0, 0], intrinsics }, image: { width, height, rgb: left } },
    right: { camera: { id: 'right', positionM: [0.3, 0, 0], intrinsics: { ...intrinsics } }, image: { width, height, rgb: right } },
  }
}
function countsConserved(result: ReturnType<typeof reconstructStereoSgm>): void {
  expect(Object.values(result.counts).reduce((total, count) => total + count, 0)).toBe(width * height)
  expect(result.counts.accepted).toBe(result.points.length)
  expect(result.outcomes).toHaveLength(width * height)
}

describe('fixed synthetic SGM ablation controls', () => {
  it('keeps the named configurations immutable and each control changes one declared setting', () => {
    expect(Object.isFrozen(STEREO_SGM_ABLATIONS)).toBe(true)
    expect(STEREO_SGM_ABLATIONS.map(item => item.id)).toEqual([
      'census-sgm', 'census-local', 'without-texture', 'without-rgb', 'without-uniqueness', 'without-left-right', 'without-components', 'without-endpoints',
    ])
    const baseline = STEREO_SGM_ABLATIONS[0]!
    for (const variant of STEREO_SGM_ABLATIONS) expect(Object.isFrozen(variant)).toBe(true)
    expect(STEREO_SGM_ABLATIONS[1]).toEqual({ ...baseline, id: 'census-local', aggregation: 'local' })
    const gates = ['textureGate', 'rgbGate', 'uniquenessGate', 'leftRightGate', 'componentGate', 'endpointGate'] as const
    for (const [id, gate] of [
      ['without-texture', 'textureGate'], ['without-rgb', 'rgbGate'], ['without-uniqueness', 'uniquenessGate'],
      ['without-left-right', 'leftRightGate'], ['without-components', 'componentGate'], ['without-endpoints', 'endpointGate'],
    ] as const) {
      const variant = STEREO_SGM_ABLATIONS.find(item => item.id === id)!
      expect(variant.aggregation).toBe('sgm')
      for (const key of gates) expect(variant[key]).toBe(key === gate ? false : true)
    }
    expect(STEREO_SGM_SETTINGS).toEqual({ p1: 2, p2: 12, maxCensusCost: 6, minComponentPixels: 12 })
    expect(Object.isFrozen(STEREO_SGM_SETTINGS)).toBe(true)
  })

  it('rejects unknown controls and keeps the original candidate byte-for-byte equivalent', () => {
    const input = pair(12)
    const ordinary = reconstructStereoSgm(input, settings)
    const named = reconstructStereoSgmAblation(input, settings, 'census-sgm')
    expect(JSON.stringify({ ...named, outcomes: Array.from(named.outcomes) })).toBe(JSON.stringify({ ...ordinary, outcomes: Array.from(ordinary.outcomes) }))
    expect(() => reconstructStereoSgmAblation(input, settings, 'not-a-control')).toThrow(/variantId/)
    countsConserved(ordinary)
  })

  it('makes the local Census control observably different from path aggregation', () => {
    const input = pair(12, 'smooth')
    const sgm = reconstructStereoSgmAblation(input, settings, 'census-sgm')
    const local = reconstructStereoSgmAblation(input, settings, 'census-local')
    countsConserved(sgm); countsConserved(local)
    expect(local.points.map(point => [point.pixelIndex, point.disparityPx])).not.toEqual(sgm.points.map(point => [point.pixelIndex, point.disparityPx]))
  })

  it('shows texture and RGB gate effects and conserves uniqueness-control results', () => {
    const blank = pair(12, 'blank')
    const withTexture = reconstructStereoSgmAblation(blank, settings, 'census-sgm')
    const withoutTexture = reconstructStereoSgmAblation(blank, settings, 'without-texture')
    expect(withTexture.counts.textureless).toBeGreaterThan(0)
    expect(withoutTexture.counts.textureless).toBe(0)
    expect(withoutTexture.counts.ambiguous).toBeGreaterThan(0)
    countsConserved(withoutTexture)

    const bright = pair(12, 'smooth', 20)
    const withRgb = reconstructStereoSgmAblation(bright, settings, 'census-sgm')
    const withoutRgb = reconstructStereoSgmAblation(bright, settings, 'without-rgb')
    expect(withRgb.counts.photometric).toBeGreaterThan(withoutRgb.counts.photometric)
    expect(withoutRgb.counts.accepted).toBeGreaterThan(withRgb.counts.accepted)
    countsConserved(withoutRgb)

    const repeated = pair(12, 'repeat')
    const withUniqueness = reconstructStereoSgmAblation(repeated, settings, 'census-sgm')
    const withoutUniqueness = reconstructStereoSgmAblation(repeated, settings, 'without-uniqueness')
    countsConserved(withUniqueness)
    countsConserved(withoutUniqueness)
  })

  it('shows endpoint and left-right gate effects on controlled synthetic inputs', () => {
    const endpointInput = pair(12)
    const endpointSettings = { ...settings, maxDisparity: 12 }
    const withEndpoints = reconstructStereoSgmAblation(endpointInput, endpointSettings, 'census-sgm')
    const withoutEndpoints = reconstructStereoSgmAblation(endpointInput, endpointSettings, 'without-endpoints')
    expect(withEndpoints.counts.ambiguous).toBeGreaterThan(withoutEndpoints.counts.ambiguous)
    expect(withoutEndpoints.counts.accepted).toBeGreaterThan(withEndpoints.counts.accepted)
    countsConserved(withoutEndpoints)

    const occluded = pair(12)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const value = 118 + (noise(x, y) % 21)
      const leftIndex = (y * width + x) * 3
      for (let channel = 0; channel < 3; channel += 1) occluded.left.image.rgb[leftIndex + channel] = value
    }
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(width - 1, x + 12)
      const destination = (y * width + x) * 3
      const source = (y * width + sourceX) * 3
      const value = 128 + Math.round((occluded.left.image.rgb[source]! - 128) * 0.5)
      for (let channel = 0; channel < 3; channel += 1) occluded.right.image.rgb[destination + channel] = value
    }
    const withLeftRight = reconstructStereoSgmAblation(occluded, settings, 'census-sgm')
    const withoutLeftRight = reconstructStereoSgmAblation(occluded, settings, 'without-left-right')
    expect(withoutLeftRight.counts.accepted).toBeGreaterThan(withLeftRight.counts.accepted)
    countsConserved(withoutLeftRight)
  })

  it('removes small isolated components while retaining their pixels when bypassed', () => {
    const input = pair(12, 'blank')
    const patchWidth = 3
    const patchHeight = 1
    const sourceX = 29
    const sourceY = 19
    const disparity = 12
    for (let y = 0; y < patchHeight; y += 1) for (let x = 0; x < patchWidth; x += 1) {
      const color = texture(x * 7 + y, y * 11 - x)
      const leftIndex = ((sourceY + y) * width + sourceX + x) * 3
      const rightIndex = ((sourceY + y) * width + sourceX + x - disparity) * 3
      for (let channel = 0; channel < 3; channel += 1) {
        input.left.image.rgb[leftIndex + channel] = color[channel]!
        input.right.image.rgb[rightIndex + channel] = color[channel]!
      }
    }
    const withComponents = reconstructStereoSgmAblation(input, settings, 'census-sgm')
    const withoutComponents = reconstructStereoSgmAblation(input, settings, 'without-components')
    countsConserved(withComponents); countsConserved(withoutComponents)
    expect(withComponents.counts.inconsistent).toBeGreaterThan(withoutComponents.counts.inconsistent)
    expect(withoutComponents.counts.accepted).toBeGreaterThan(withComponents.counts.accepted)
  })
})
