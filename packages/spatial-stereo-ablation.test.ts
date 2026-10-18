import { describe, expect, it } from 'vitest'
import { compareStereoSupport, runStereoAblationCase, summarizeStereoAblations } from './spatial-stereo-ablation.ts'
import { STEREO_OUTCOMES, STEREO_SETTINGS, type StereoResult } from './spatial-stereo-types.ts'
import type { StereoGeometryTruth } from './spatial-stereo-geometry.ts'

const camera = { id: 'support-test', positionM: [0, 0, 0] as [number, number, number], intrinsics: { width: 7, height: 2, fx: 10, fy: 10, cx: 3.5, cy: 1 } }
function result(points: [number, number][]): StereoResult {
  const outcomes = new Uint8Array(14)
  const accepted = STEREO_OUTCOMES.indexOf('accepted')
  for (const [pixel] of points) outcomes[pixel] = accepted
  return { status: points.length ? 'reconstructed' : 'empty', width: 7, height: 2, baselineM: 0.3, settings: { ...STEREO_SETTINGS, minDisparity: 1, maxDisparity: 6 }, outcomes, counts: { border: 14 - points.length, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: points.length }, points: points.map(([pixelIndex, disparityPx]) => ({ pixelIndex, disparityPx, positionM: [0, 0, -3 / disparityPx], color: [90, 80, 70], meanAbsoluteError: 0 })) }
}
const truth: StereoGeometryTruth = { camera, disparityPx: Array.from({ length: 14 }, (_, index) => [6, 7, 8].includes(index) ? null : 3), depthM: Array.from({ length: 14 }, (_, index) => [6, 7, 8].includes(index) ? null : 1) }

describe('ablation accepted-support accounting', () => {
  it('separates gained/lost correct, bad and unknown points, including the strict one-pixel boundary', () => {
    const before = result([[0, 3], [1, 5], [4, 3], [5, 5], [6, 3], [7, 3], [9, 5], [10, 3], [12, 4]])
    const after = result([[2, 3], [3, 5], [4, 5], [5, 3], [6, 3], [8, 3], [9, 5], [10, 3], [12, 4], [13, 4.0001]])
    const transitions = compareStereoSupport(before, after, truth)
    expect(transitions.gained).toEqual({ correct: 1, bad: 2, unknown: 1 })
    expect(transitions.lost).toEqual({ correct: 1, bad: 1, unknown: 1 })
    expect(transitions.retained).toEqual({ correctToCorrect: 2, correctToBad: 1, badToCorrect: 1, badToBad: 1, unknown: 1 })
    expect(transitions.rejectedByBoth).toBe(1)
    expect(transitions.outcomeTransitions.accepted.accepted).toBe(6)
    expect(transitions.outcomeTransitions.border.accepted).toBe(4)
    expect(transitions.outcomeTransitions.accepted.border).toBe(3)
    expect(Object.values(transitions.outcomeTransitions).flatMap(Object.values).reduce((total, count) => total + count, 0)).toBe(14)
    expect(after.points.length - before.points.length).toBe(Object.values(transitions.gained).reduce((a, b) => a + b, 0) - Object.values(transitions.lost).reduce((a, b) => a + b, 0))
  })

  it('rejects mismatched truth dimensions or invalid point/outcome conservation', () => {
    const empty = result([])
    expect(() => compareStereoSupport(empty, { ...empty, counts: { ...empty.counts, accepted: 1 } }, truth)).toThrow()
    expect(() => compareStereoSupport(empty, empty, { ...truth, disparityPx: [3] })).toThrow()
  })

  it('rejects non-development ablation before invoking any estimator', () => {
    // Deliberately invalid input shows the split guard runs before reconstruction.
    expect(() => runStereoAblationCase({ split: 'evaluation' } as never)).toThrow(/development/)
    expect(() => summarizeStereoAblations([])).toThrow(/development/)
  })
})
