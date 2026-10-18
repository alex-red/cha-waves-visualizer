import { describe, expect, it } from 'vitest'
import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoCamera, type StereoOutcome, type StereoResult } from './spatial-stereo-types.ts'
import { evaluateStereoGeometry, STEREO_GEOMETRY_GATES, type StereoGeometryTruth } from './spatial-stereo-geometry.ts'

const camera: StereoCamera = {
  id: 'synthetic-left',
  positionM: [0, 0, 10],
  intrinsics: { width: 5, height: 2, fx: 100, fy: 100, cx: 2.5, cy: 1 },
}

function makeResult(width: number, height: number, estimates: Array<{ pixelIndex: number; disparityPx: number; depthM: number }>): StereoResult {
  const pixels = width * height
  const outcomes = new Uint8Array(pixels)
  outcomes.fill(STEREO_OUTCOMES.indexOf('textureless'))
  const points = estimates.map(estimate => {
    outcomes[estimate.pixelIndex] = STEREO_OUTCOMES.indexOf('accepted')
    return {
      pixelIndex: estimate.pixelIndex,
      positionM: [0, 0, camera.positionM[2] - estimate.depthM] as [number, number, number],
      color: [20, 40, 60] as [number, number, number],
      disparityPx: estimate.disparityPx,
      meanAbsoluteError: 0,
    }
  })
  const counts = Object.fromEntries(STEREO_OUTCOMES.map(outcome => [outcome, 0])) as Record<StereoOutcome, number>
  for (const code of outcomes) counts[STEREO_OUTCOMES[code]!] += 1
  return {
    status: points.length ? 'reconstructed' : 'empty', width, height, baselineM: 0.2,
    settings: { ...STEREO_SETTINGS }, outcomes, counts, points,
  }
}

function makeTruth(disparityPx: (number | null)[], depthM: (number | null)[], width = 5, height = 2): StereoGeometryTruth {
  return {
    camera: { ...camera, intrinsics: { ...camera.intrinsics, width, height } },
    disparityPx,
    depthM,
  }
}

describe('evaluateStereoGeometry', () => {
  it('compares aligned geometry directly and passes the frozen gates without fitting or mutation', () => {
    const result = makeResult(5, 2, Array.from({ length: 8 }, (_, pixelIndex) => ({ pixelIndex, disparityPx: 10 + pixelIndex, depthM: 1 + pixelIndex * 0.1 })))
    const truth = makeTruth(Array.from({ length: 10 }, (_, index) => 10 + index), Array.from({ length: 10 }, (_, index) => 1 + index * 0.1))
    const resultBefore = JSON.stringify({ ...result, outcomes: Array.from(result.outcomes) })
    const truthBefore = JSON.stringify(truth)

    const report = evaluateStereoGeometry(result, truth)

    expect(report.totalPixels).toBe(10)
    expect(report.validTruthPixels).toBe(10)
    expect(report.missingTruthPixels).toBe(0)
    expect(report.acceptedPixels).toBe(8)
    expect(report.acceptedWithTruth).toBe(8)
    expect(report.acceptedWithoutTruth).toBe(0)
    expect(report.unestimatedTruthPixels).toBe(2)
    expect(report.truthCoverage).toBe(0.8)
    expect(report.disparity.meanAbsoluteErrorPx).toBe(0)
    expect(report.disparity.bad1Count).toBe(0)
    expect(report.disparity.bad1IncludingMissingFraction).toBe(0.2)
    expect(report.depth.meanAbsoluteErrorM).toBeCloseTo(0, 12)
    expect(report.depth.p90AbsoluteErrorM).toBeCloseTo(0, 12)
    expect(report.worstErrors).toHaveLength(8)
    expect(report.gates).toEqual({ minimumTruthCoverage: true, maximumBad1Fraction: true, maximumDepthP90M: true, passed: true })
    expect(report.passed).toBe(true)
    expect(result.outcomes).toEqual(Uint8Array.from(JSON.parse(resultBefore).outcomes))
    expect(JSON.stringify({ ...result, outcomes: Array.from(result.outcomes) })).toBe(resultBefore)
    expect(JSON.stringify(truth)).toBe(truthBefore)
    expect(STEREO_GEOMETRY_GATES).toEqual({ minimumTruthCoverage: 0.35, maximumBad1Fraction: 0.1, maximumDepthP90M: 0.25 })
  })

  it('retains missing truth and missing estimates, and does not treat a bad disparity as correct', () => {
    const result = makeResult(5, 2, [
      { pixelIndex: 0, disparityPx: 10, depthM: 2 },
      { pixelIndex: 1, disparityPx: 12, depthM: 3.2 },
      { pixelIndex: 2, disparityPx: 14, depthM: 4.4 },
      { pixelIndex: 8, disparityPx: 18, depthM: 8 },
    ])
    const disparityPx = [10, 11, 12, 13, 14, 15, 16, 17, null, null]
    const depthM = [2, 3, 4, 5, 6, 7, 8, 9, null, null]

    const report = evaluateStereoGeometry(result, makeTruth(disparityPx, depthM))

    expect(report.validTruthPixels).toBe(8)
    expect(report.missingTruthPixels).toBe(2)
    expect(report.acceptedPixels).toBe(4)
    expect(report.acceptedWithTruth).toBe(3)
    expect(report.acceptedWithoutTruth).toBe(1)
    expect(report.unestimatedTruthPixels).toBe(5)
    expect(report.truthCoverage).toBe(3 / 8)
    expect(report.disparity.bad1Count).toBe(1) // exactly 1 px is not bad-1; 2 px is.
    expect(report.disparity.bad1AmongEstimatesFraction).toBe(1 / 3)
    expect(report.disparity.bad1IncludingMissingFraction).toBe(6 / 8)
    expect(report.depth.meanAbsoluteErrorM).toBeCloseTo(0.2)
    expect(report.worstErrors[0]?.pixelIndex).toBe(2)
    expect(report.worstErrors[0]?.absoluteDepthErrorM).toBeCloseTo(0.4)
    expect(report.gates).toEqual({ minimumTruthCoverage: true, maximumBad1Fraction: false, maximumDepthP90M: false, passed: false })
    expect(report.passed).toBe(false)
  })

  it('fails explicitly when truth has zero valid pixels or no estimates overlap truth', () => {
    const zeroTruth = makeTruth(Array(10).fill(null), Array(10).fill(null))
    const empty = makeResult(5, 2, [])
    const zeroReport = evaluateStereoGeometry(empty, zeroTruth)
    expect(zeroReport.validTruthPixels).toBe(0)
    expect(zeroReport.missingTruthPixels).toBe(10)
    expect(zeroReport.truthCoverage).toBeNull()
    expect(zeroReport.disparity.bad1AmongEstimatesFraction).toBeNull()
    expect(zeroReport.disparity.bad1IncludingMissingFraction).toBeNull()
    expect(zeroReport.depth.p90AbsoluteErrorM).toBeNull()
    expect(zeroReport.gates).toEqual({ minimumTruthCoverage: false, maximumBad1Fraction: false, maximumDepthP90M: false, passed: false })
    expect(zeroReport.passed).toBe(false)

    const validTruth = makeTruth(Array(10).fill(4), Array(10).fill(2))
    const noOverlap = evaluateStereoGeometry(empty, validTruth)
    expect(noOverlap.unestimatedTruthPixels).toBe(10)
    expect(noOverlap.truthCoverage).toBe(0)
    expect(noOverlap.disparity.bad1IncludingMissingFraction).toBe(1)
    expect(noOverlap.passed).toBe(false)
  })

  it('rejects malformed outcomes, histogram/point mismatches, sparse truth, and non-finite geometry', () => {
    const validTruth = makeTruth(Array(10).fill(4), Array(10).fill(2))
    const valid = makeResult(5, 2, [{ pixelIndex: 0, disparityPx: 4, depthM: 2 }])

    const badCounts = { ...valid, counts: { ...valid.counts, accepted: 0 } }
    expect(() => evaluateStereoGeometry(badCounts, validTruth)).toThrow(/result\.counts\.accepted/)

    const extraCount = { ...valid, counts: { ...valid.counts, hidden: 0 } } as unknown as StereoResult
    expect(() => evaluateStereoGeometry(extraCount, validTruth)).toThrow(/exactly the supported outcome names/)

    const badCode = { ...valid, outcomes: valid.outcomes.slice() }
    badCode.outcomes[1] = 255
    expect(() => evaluateStereoGeometry(badCode, validTruth)).toThrow(/result\.outcomes\[1\]/)

    const badPoint = { ...valid, points: valid.points.map(point => ({ ...point, positionM: [0, Number.NaN, 8] as [number, number, number] })) }
    expect(() => evaluateStereoGeometry(badPoint, validTruth)).toThrow(/positionM\[1\]/)

    const sparseDisparity = Array<number | null>(10).fill(4)
    delete sparseDisparity[4]
    expect(() => evaluateStereoGeometry(valid, makeTruth(sparseDisparity, Array(10).fill(2)))).toThrow(/truth\[4\]/)

    expect(() => evaluateStereoGeometry(valid, makeTruth([4, Number.NaN, ...Array(8).fill(4)], Array(10).fill(2)))).toThrow(/truth\.disparityPx\[1\]/)
    expect(() => evaluateStereoGeometry(valid, makeTruth([4, ...Array(9).fill(null)], Array(10).fill(2)))).toThrow(/same null support/)
  })

  it('rejects dimension mismatches and duplicate accepted point identities', () => {
    const result = makeResult(5, 2, [{ pixelIndex: 0, disparityPx: 4, depthM: 2 }])
    expect(() => evaluateStereoGeometry(result, makeTruth(Array(9).fill(4), Array(9).fill(2), 3, 3))).toThrow(/dimensions must match/)

    const duplicate = { ...result, points: [...result.points, { ...result.points[0]!, pixelIndex: 0 }] }
    expect(() => evaluateStereoGeometry(duplicate, makeTruth(Array(10).fill(4), Array(10).fill(2)))).toThrow(/duplicates another accepted point/)
  })
})
