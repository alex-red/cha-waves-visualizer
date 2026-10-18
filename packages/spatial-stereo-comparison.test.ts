import { describe, expect, it } from 'vitest'
import { compareStereoCase, summarizeStereoComparison, type StereoComparisonScore } from './spatial-stereo-comparison.ts'
import type { StereoDevelopmentCase } from './test-fixtures/stereo-development.ts'
import type { StereoCamera, StereoInput, StereoSettings } from './spatial-stereo-types.ts'

function pooledScore(
  id: string,
  split: 'development',
  baseline: { valid: number; accepted: number; bad1: number },
  candidate: { valid: number; accepted: number; bad1: number },
): StereoComparisonScore {
  const side = ({ valid, accepted, bad1 }: { valid: number; accepted: number; bad1: number }) => ({
    validTruthPixels: valid,
    acceptedWithTruth: accepted,
    unestimatedTruthPixels: valid - accepted,
    disparity: { bad1Count: bad1 },
  })
  return { id, split, baseline: side(baseline), candidate: side(candidate) } as unknown as StereoComparisonScore
}

function smallDevelopmentCase(): StereoDevelopmentCase {
  const width = 16, height = 12, pixels = width * height
  const intrinsics = { width, height, fx: 100, fy: 100, cx: width / 2, cy: height / 2 }
  const leftCamera: StereoCamera = { id: 'small-left', positionM: [-0.15, 0, 0], intrinsics }
  const rightCamera: StereoCamera = { id: 'small-right', positionM: [0.15, 0, 0], intrinsics: { ...intrinsics } }
  const rgb = new Uint8Array(pixels * 3)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    rgb[pixel * 3] = (x * 31 + y * 17) % 256
    rgb[pixel * 3 + 1] = (x * 13 + y * 43) % 256
    rgb[pixel * 3 + 2] = (x * 47 + y * 7) % 256
  }
  const input: StereoInput = {
    left: { camera: leftCamera, image: { width, height, rgb: rgb.slice() } },
    right: { camera: rightCamera, image: { width, height, rgb: rgb.slice() } },
  }
  return {
    id: 'small-mask-support-check', split: 'development', input,
    truth: { camera: leftCamera, disparityPx: Array(pixels).fill(3), depthM: Array(pixels).fill(10) },
    regions: { boundary: [0, 1], weakTexture: [2, 3, 4], occlusion: [5, 6] },
  }
}

describe('summarizeStereoComparison', () => {
  it('pools missing-aware error and coverage by pixel counts, not by averaging case rates', () => {
    const scores = [
      pooledScore('large', 'development', { valid: 100, accepted: 50, bad1: 10 }, { valid: 100, accepted: 90, bad1: 5 }),
      pooledScore('small', 'development', { valid: 10, accepted: 10, bad1: 0 }, { valid: 10, accepted: 10, bad1: 0 }),
    ]

    const summary = summarizeStereoComparison(scores)

    expect(summary.baseline).toMatchObject({ validTruthPixels: 110, acceptedWithTruth: 60, unestimatedTruthPixels: 50, bad1Count: 10 })
    expect(summary.candidate).toMatchObject({ validTruthPixels: 110, acceptedWithTruth: 100, unestimatedTruthPixels: 10, bad1Count: 5 })
    expect(summary.baseline.bad1IncludingMissing).toBeCloseTo(60 / 110)
    expect(summary.candidate.bad1IncludingMissing).toBeCloseTo(15 / 110)
    expect(summary.missingAwareImprovement).toBeCloseTo(45 / 110)
    expect(summary.coverageChange).toBeCloseTo(40 / 110)
    expect(summary.gates).toEqual({ minimumMissingAwareImprovement: true, maximumCoverageLoss: true, noBad1Regression: true })
    expect(summary.passed).toBe(true)
  })

  it('fails null denominators and an empty case collection explicitly', () => {
    const noTruth = pooledScore('no-truth', 'development', { valid: 0, accepted: 0, bad1: 0 }, { valid: 0, accepted: 0, bad1: 0 })
    const summary = summarizeStereoComparison([noTruth])
    expect(summary.baseline.truthCoverage).toBeNull()
    expect(summary.baseline.bad1AmongEstimates).toBeNull()
    expect(summary.baseline.bad1IncludingMissing).toBeNull()
    expect(summary.missingAwareImprovement).toBeNull()
    expect(summary.coverageChange).toBeNull()
    expect(summary.gates).toEqual({ minimumMissingAwareImprovement: false, maximumCoverageLoss: false, noBad1Regression: false })
    expect(summary.passed).toBe(false)
    expect(() => summarizeStereoComparison([])).toThrow(/At least one comparison case/)
  })
})

describe('compareStereoCase diagnostic regions', () => {
  it('scores masks separately without erasing the full left-visible truth support', () => {
    const fixture = smallDevelopmentCase()
    const settings: StereoSettings = {
      minDisparity: 1, maxDisparity: 4, patchRadius: 2,
      minTextureVariance: 0, maxMeanAbsoluteError: 255, uniquenessRatio: 0.8, leftRightTolerancePx: 1,
    }
    const truthBefore = { disparityPx: [...fixture.truth.disparityPx], depthM: [...fixture.truth.depthM] }

    const comparison = compareStereoCase(fixture, settings)

    expect(comparison.score.baseline.validTruthPixels).toBe(16 * 12)
    expect(comparison.score.candidate.validTruthPixels).toBe(16 * 12)
    expect(comparison.score.regions.boundary!.pixelCount).toBe(2)
    expect(comparison.score.regions.weakTexture!.pixelCount).toBe(3)
    expect(comparison.score.regions.occlusion!.pixelCount).toBe(2)
    expect(comparison.score.regions.boundary!.baseline.validTruthPixels).toBe(2)
    expect(comparison.score.regions.weakTexture!.candidate.validTruthPixels).toBe(3)
    expect(comparison.score.regions.occlusion!.baseline.validTruthPixels).toBe(2)
    expect(fixture.truth.disparityPx).toEqual(truthBefore.disparityPx)
    expect(fixture.truth.depthM).toEqual(truthBefore.depthM)
  })
})
