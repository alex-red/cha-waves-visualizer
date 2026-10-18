import { describe, expect, it } from 'vitest'
import { STEREO_SETTINGS, type StereoInput, type StereoPoint, type StereoResult, type StereoSettings } from './spatial-stereo-types.ts'
import { reconstructStereoSgmAblation } from './spatial-stereo-sgm.ts'
import { censusRawHammingCost, filterStereoLocalAmbiguity, LOCAL_AMBIGUITY_RULE, reconstructStereoLocalAmbiguity } from './spatial-stereo-local-ambiguity.ts'

const width = 64
const height = 48
const intrinsics = { width, height, fx: 40, fy: 40, cx: width / 2, cy: height / 2 }
const settings: StereoSettings = { ...STEREO_SETTINGS, minDisparity: 4, maxDisparity: 24 }

function noise(x: number, y: number): number {
  let value = Math.imul((x + 1024) | 0, 0x45d9f3b)
  value = Math.imul(value ^ ((y + 4096) | 0), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) & 255
}

function sample(x: number, y: number, kind: 'noise' | 'periodic'): [number, number, number] {
  if (kind === 'periodic') return [x % 8 < 4 ? 210 : 24, (y * 37) % 255, x % 8 < 4 ? 45 : 231]
  const value = noise(x, y)
  return [value, (value * 37 + x * 11) & 255, (value * 13 + y * 19) & 255]
}

function pair(disparity = 12, kind: 'noise' | 'periodic' = 'noise'): StereoInput {
  const left = new Uint8Array(width * height * 3)
  const right = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 3
    const a = sample(x, y, kind)
    const b = sample(x + disparity, y, kind)
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

function singletonBase(point: StereoPoint, chosenSettings: StereoSettings = settings, pixelIndex = point.pixelIndex): StereoResult {
  const outcomes = new Uint8Array(width * height)
  outcomes.fill(3) // ambiguous
  outcomes[pixelIndex] = 5 // accepted
  const acceptedPoint = { ...point, pixelIndex }
  return {
    status: 'reconstructed', width, height, baselineM: 0.3, settings: { ...chosenSettings }, outcomes,
    counts: { border: 0, textureless: 0, photometric: 0, ambiguous: width * height - 1, inconsistent: 0, accepted: 1 },
    points: [acceptedPoint],
  }
}

function centeredPoint(result: StereoResult): StereoPoint {
  const center = result.points.find(point => point.pixelIndex === 24 * width + 32)
  if (!center) throw new Error('Expected a center match in the shifted-noise control.')
  return center
}

function conserve(result: StereoResult): void {
  expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(width * height)
  expect(result.counts.accepted).toBe(result.points.length)
  expect(result.outcomes).toHaveLength(width * height)
}

describe('local Census ambiguity post-filter', () => {
  it('freezes the fixed bidirectional Census rule', () => {
    expect(LOCAL_AMBIGUITY_RULE).toEqual({
      censusRadius: 2,
      maxRawCensusCost: 6,
      excludedNeighborLabels: 1,
      competitorRatioSetting: 'settings.uniquenessRatio',
      requireBothDirections: true,
    })
    expect(Object.isFrozen(LOCAL_AMBIGUITY_RULE)).toBe(true)
  })

  it('computes zero raw cost at the known shifted match and retains the exact accepted point', () => {
    const input = pair()
    expect(censusRawHammingCost(input.left, input.right, 32, 24, 20)).toBe(0)
    expect(censusRawHammingCost(input.left, input.right, 32, 24, 21)).toBeGreaterThan(0)
    expect(censusRawHammingCost(input.left, input.right, 1, 24, 20)).toBeNull()

    const base = reconstructStereoSgmAblation(input, settings, 'without-texture')
    const baseCenter = centeredPoint(base)
    const filtered = filterStereoLocalAmbiguity(input, base)
    const filteredCenter = filtered.points.find(point => point.pixelIndex === baseCenter.pixelIndex)
    expect(filteredCenter).toEqual(baseCenter)
    expect(filtered.points).toEqual(base.points.filter(point => filtered.outcomes[point.pixelIndex] === 5))
    conserve(filtered)
    conserve(base)
    expect(base.outcomes[baseCenter.pixelIndex]).toBe(5)
  })

  it('rejects a zero-cost periodic alias when its nonadjacent competitor also costs zero', () => {
    const textured = pair(12, 'noise')
    const base = reconstructStereoSgmAblation(textured, settings, 'without-texture')
    const candidate = singletonBase(centeredPoint(base))
    const periodic = pair(12, 'periodic')
    expect(censusRawHammingCost(periodic.left, periodic.right, 32, 24, 20)).toBe(0)
    expect(censusRawHammingCost(periodic.left, periodic.right, 32, 24, 12)).toBe(0) // disparity 20 aliases disparity 12
    const filtered = filterStereoLocalAmbiguity(periodic, candidate)
    expect(filtered.counts.accepted).toBe(0)
    expect(filtered.counts.ambiguous).toBe(width * height)
    expect(filtered.points).toEqual([])
    conserve(filtered)
  })

  it('rejects an accepted base point with no valid nonadjacent comparison or invalid Census support', () => {
    const input = pair()
    const ordinary = reconstructStereoSgmAblation(input, settings, 'without-texture')
    const sourcePoint = centeredPoint(ordinary)

    const noCompetitorSettings = { ...settings, minDisparity: 12, maxDisparity: 13 }
    const noCompetitor = filterStereoLocalAmbiguity(input, singletonBase(sourcePoint, noCompetitorSettings))
    expect(noCompetitor.counts.accepted).toBe(0)
    expect(noCompetitor.counts.ambiguous).toBe(width * height)

    const invalidSource = filterStereoLocalAmbiguity(input, singletonBase(sourcePoint, settings, 24 * width + 5))
    expect(invalidSource.outcomes[24 * width + 5]).toBe(3)
    expect(invalidSource.counts.accepted).toBe(0)

    const invalidReference = filterStereoLocalAmbiguity(input, singletonBase(sourcePoint, settings, 1 * width + 32))
    expect(invalidReference.outcomes[1 * width + 32]).toBe(3)
    expect(invalidReference.counts.accepted).toBe(0)
    conserve(noCompetitor); conserve(invalidSource); conserve(invalidReference)
  })

  it('uses the no-variance SGM base and rejects unsupported calibration', () => {
    const input = pair()
    const result = reconstructStereoLocalAmbiguity(input, settings)
    expect(result.settings).toEqual(settings)
    conserve(result)

    input.right.camera.positionM[1] = 0.01
    expect(() => reconstructStereoLocalAmbiguity(input, settings)).toThrow(/rectified horizontal stereo/)
  })

  it('rejects malformed supplied base-result accounting', () => {
    const input = pair()
    const base = reconstructStereoSgmAblation(input, settings, 'without-texture')
    const duplicate = { ...base, points: base.points.length ? [base.points[0]!, base.points[0]!] : [] }
    if (duplicate.points.length) expect(() => filterStereoLocalAmbiguity(input, duplicate)).toThrow(/accepted points are inconsistent|duplicated/)
  })
})
