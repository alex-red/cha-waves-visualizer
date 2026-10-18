import { describe, expect, it } from 'vitest'
import { inspectStereoLocalEvidence, poolStereoLocalAttrition, scoreStereoLocalAttrition, type LocalDirectionEvidence, type LocalPointEvidence } from './spatial-stereo-local-attrition.ts'
import { STEREO_OUTCOMES, type StereoInput, type StereoResult, type StereoSettings } from './spatial-stereo-types.ts'
import type { StereoGeometryTruth } from './spatial-stereo-geometry.ts'

const SETTINGS: StereoSettings = { minDisparity: 1, maxDisparity: 5, patchRadius: 2, minTextureVariance: 0, maxMeanAbsoluteError: 255, uniquenessRatio: 0.8, leftRightTolerancePx: 1 }
const CODE = Object.fromEntries(STEREO_OUTCOMES.map((name, index) => [name, index])) as Record<(typeof STEREO_OUTCOMES)[number], number>

function camera(id: string, x: number, width: number, height: number) {
  return { id, positionM: [x, 0, 0] as [number, number, number], intrinsics: { width, height, fx: 100, fy: 100, cx: width / 2, cy: height / 2 } }
}

function grayImage(width: number, height: number, valueAt: (x: number, y: number, view: number) => number): Uint8Array<ArrayBuffer> {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = valueAt(x, y, 0), index = (y * width + x) * 3
    rgb[index] = value; rgb[index + 1] = value; rgb[index + 2] = value
  }
  return rgb
}

function inputFor(leftAt: (x: number, y: number) => number, rightAt: (x: number, y: number) => number, width = 16, height = 9): StereoInput {
  const left = { camera: camera('left', -0.1, width, height), image: { width, height, rgb: grayImage(width, height, (x, y) => leftAt(x, y)) } }
  const right = { camera: camera('right', 0, width, height), image: { width, height, rgb: grayImage(width, height, (x, y) => rightAt(x, y)) } }
  return { left, right }
}

function resultFor(width: number, height: number, points: StereoResult['points'], ambiguous: number[] = [], settings: StereoSettings = SETTINGS): StereoResult {
  const outcomes = new Uint8Array(width * height).fill(CODE.border)
  for (const point of points) outcomes[point.pixelIndex] = CODE.accepted
  for (const pixel of ambiguous) outcomes[pixel] = CODE.ambiguous
  const counts = { border: 0, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 }
  for (const code of outcomes) counts[STEREO_OUTCOMES[code]!] += 1
  return { status: points.length ? 'reconstructed' : 'empty', width, height, baselineM: 0.1, settings, outcomes, counts, points }
}

function simplePoint(pixelIndex: number, disparityPx: number, depthM = 5) {
  return { pixelIndex, positionM: [0, 0, 10 - depthM] as [number, number, number], color: [80, 90, 100] as [number, number, number], disparityPx, meanAbsoluteError: 0 }
}

function truthFor(width: number, height: number, values: Record<number, number | null>): StereoGeometryTruth {
  const disparityPx: (number | null)[] = Array(width * height).fill(null)
  const depthM: (number | null)[] = Array(width * height).fill(null)
  for (const [pixelString, disparity] of Object.entries(values)) {
    const pixel = Number(pixelString)
    disparityPx[pixel] = disparity
    depthM[pixel] = disparity === null ? null : 5
  }
  const truthCamera = { ...camera('truth', 0, width, height), positionM: [0, 0, 10] as [number, number, number] }
  return { camera: truthCamera, disparityPx, depthM }
}

function direction(failure: LocalDirectionEvidence['firstFailure'], anchor = 2): LocalDirectionEvidence {
  const checks: LocalDirectionEvidence['checks'] = { anchor: true, support: true, rawCost: true, competitorPresent: true, competitorPositive: true, ratio: true }
  let rawAnchorCost: number | null = 0, competitorCost: number | null = 8, competitorFirstLabel: number | null = anchor + 2 <= 5 ? anchor + 2 : anchor - 2, validCompetitorCount = 2, competitorTieCount = 1, ratio: number | null = 0
  switch (failure) {
    case 'invalid-anchor': checks.anchor = false; checks.support = checks.rawCost = checks.competitorPresent = checks.competitorPositive = checks.ratio = null; rawAnchorCost = competitorCost = null; competitorFirstLabel = null; validCompetitorCount = competitorTieCount = 0; ratio = null; break
    case 'invalid-support': checks.support = false; checks.rawCost = null; checks.competitorPresent = false; checks.competitorPositive = checks.ratio = null; rawAnchorCost = competitorCost = null; competitorFirstLabel = null; validCompetitorCount = competitorTieCount = 0; ratio = null; break
    case 'raw-cost': rawAnchorCost = 8; ratio = 1; checks.rawCost = false; checks.ratio = false; break
    case 'missing-competitor': checks.competitorPresent = false; checks.competitorPositive = checks.ratio = null; competitorCost = null; competitorFirstLabel = null; validCompetitorCount = competitorTieCount = 0; ratio = null; break
    case 'zero-competitor': checks.competitorPositive = false; checks.ratio = null; competitorCost = 0; ratio = null; break
    case 'ratio': rawAnchorCost = 2; competitorCost = 2; ratio = 1; checks.ratio = false; break
    case 'pass': break
  }
  const failedPredicates = (Object.keys(checks) as (keyof typeof checks)[]).filter(key => checks[key] === false)
  return { rawAnchorCost, competitorCost, competitorFirstLabel, competitorTieCount, validCompetitorCount, ratio, checks, firstFailure: failure, failedPredicates }
}

function pointEvidence(pixelIndex: number, disparityPx: number, forward: LocalDirectionEvidence, reverse: LocalDirectionEvidence): LocalPointEvidence {
  const width = 8
  return { pixelIndex, disparityPx, anchor: Math.round(disparityPx), rightX: Math.round(pixelIndex % width - disparityPx), forward, reverse, retainedByEvidence: forward.firstFailure === 'pass' && reverse.firstFailure === 'pass' }
}

describe('fixed local-Census attrition evidence', () => {
  it('records raw-Hamming rejection separately from zero and absent competitors and evaluates both directions', () => {
    const noise = (x: number, y: number, seed: number) => (Math.imul(x + 11, 374761393) ^ Math.imul(y + 5, 668265263) ^ seed) & 255
    const unrelated = inputFor((x, y) => noise(x, y, 2017), (x, y) => noise(x, y, 7019))
    const one = simplePoint(4 * 16 + 8, 2)
    const highCost = inspectStereoLocalEvidence(unrelated, resultFor(16, 9, [one]))[0]!
    expect(highCost.forward.rawAnchorCost).toBeGreaterThan(6)
    expect(highCost.forward.firstFailure).toBe('raw-cost')
    expect(highCost.reverse.rawAnchorCost).toBeGreaterThan(6)
    expect(highCost.reverse.firstFailure).toBe('raw-cost')
    expect(highCost.forward.validCompetitorCount).toBeGreaterThan(0)
    expect(highCost.reverse.validCompetitorCount).toBeGreaterThan(0)

    const uniform = inputFor(() => 96, () => 96)
    const zero = inspectStereoLocalEvidence(uniform, resultFor(16, 9, [simplePoint(4 * 16 + 8, 2)]))[0]!
    expect(zero.forward.rawAnchorCost).toBe(0)
    expect(zero.forward.competitorCost).toBe(0)
    expect(zero.forward.firstFailure).toBe('zero-competitor')
    expect(zero.reverse.firstFailure).toBe('zero-competitor')

    const noCompetitorSettings = { ...SETTINGS, maxDisparity: 3 }
    const tinyUniform = inputFor(() => 96, () => 96, 8, 7)
    const noCompetitor = inspectStereoLocalEvidence(tinyUniform, resultFor(8, 7, [simplePoint(3 * 8 + 4, 1)], [], noCompetitorSettings))[0]!
    expect(noCompetitor.forward.validCompetitorCount).toBe(0)
    expect(noCompetitor.reverse.validCompetitorCount).toBe(0)
    expect(noCompetitor.forward.firstFailure).toBe('missing-competitor')
    expect(noCompetitor.reverse.firstFailure).toBe('missing-competitor')
  })

  it('records a positive competitor ratio failure from a fixed synthetic shifted texture', () => {
    const period3 = (x: number, y: number) => (((x % 3 === 0) ? 210 : (x % 3 === 1) ? 70 : 140) + y * 2) & 255
    const left = grayImage(16, 9, (x, y) => period3(x, y))
    const right = grayImage(16, 9, (x, y) => x + 2 < 16 ? period3(x + 2, y) : period3(x, y))
    // Keep the periodic right view fixed while altering one left Census bit; label 5 aliases anchor 2.
    const edit = ((2 * 16 + 6) * 3)
    left[edit] = (left[edit]! + 42) & 255
    left[edit + 1] = left[edit]!
    left[edit + 2] = left[edit]!
    const input: StereoInput = {
      left: { camera: camera('left', -0.1, 16, 9), image: { width: 16, height: 9, rgb: left } },
      right: { camera: camera('right', 0, 16, 9), image: { width: 16, height: 9, rgb: right } },
    }
    const evidence = inspectStereoLocalEvidence(input, resultFor(16, 9, [simplePoint(4 * 16 + 8, 2)]))[0]!
    expect(evidence.forward.rawAnchorCost).toBeGreaterThan(0)
    expect(evidence.forward.rawAnchorCost).toBeLessThanOrEqual(6)
    expect(evidence.forward.competitorCost).toBeGreaterThan(0)
    expect(evidence.forward.ratio).toBeGreaterThan(SETTINGS.uniquenessRatio)
    expect(evidence.forward.firstFailure).toBe('ratio')
    expect(evidence.reverse.rawAnchorCost).not.toBeNull()
  })

  it('evaluates independent forward/reverse candidate support and reports unavailable checks as null', () => {
    const width = 12, height = 9
    const pattern = (x: number, y: number) => (x * 37 + y * 79 + x * y * 17 + 11) & 255
    const shifted = inputFor((x, y) => pattern(x, y), (x, y) => x + 3 < width ? pattern(x + 3, y) : 0, width, height)
    const edge = inspectStereoLocalEvidence(shifted, resultFor(width, height, [simplePoint(4 * width + 5, 3)]))[0]!
    expect(edge.forward.rawAnchorCost).not.toBeNull()
    expect(edge.reverse.rawAnchorCost).not.toBeNull()
    expect(edge.forward.validCompetitorCount).toBe(1)
    expect(edge.reverse.validCompetitorCount).toBe(2)

    const uniform = inputFor(() => 96, () => 96, width, height)
    const unsupported = inspectStereoLocalEvidence(uniform, resultFor(width, height, [simplePoint(4 * width + 2, 1)]))[0]!
    expect(unsupported.forward.firstFailure).toBe('invalid-support')
    expect(unsupported.forward.checks.rawCost).toBeNull()
    const outOfRange = inspectStereoLocalEvidence(uniform, resultFor(width, height, [simplePoint(4 * width + 8, 6)]))[0]!
    expect(outOfRange.forward.firstFailure).toBe('invalid-anchor')
    expect(outOfRange.forward.checks.support).toBeNull()
    expect(outOfRange.reverse.checks.ratio).toBeNull()
  })

  it('partitions every point once, retains overlapping failures, and rejects changed point sets', () => {
    const width = 8, height = 6
    const points = [simplePoint(19, 2), simplePoint(20, 4), simplePoint(21, 3), simplePoint(22, 2)]
    const base = resultFor(width, height, points)
    const filtered = resultFor(width, height, [points[0]!], [20, 21, 22])
    const evidence = [
      pointEvidence(19, 2, direction('pass'), direction('pass')),
      pointEvidence(20, 4, direction('raw-cost', 4), direction('pass', 4)),
      pointEvidence(21, 3, direction('pass', 3), direction('ratio', 3)),
      pointEvidence(22, 2, direction('raw-cost'), direction('missing-competitor')),
    ]
    const truth = truthFor(width, height, { 19: 2, 20: 2, 21: null, 22: 2 })
    const score = scoreStereoLocalAttrition(evidence, base, filtered, truth, { edge: [19, 20], overlap: [20, 22] }, [20, 22])
    expect(score.partitions).toEqual({
      retained: { total: 1, correct: 1, bad: 0, unknown: 0 },
      forwardOnlyFailure: { total: 1, correct: 0, bad: 1, unknown: 0 },
      reverseOnlyFailure: { total: 1, correct: 0, bad: 0, unknown: 1 },
      bothFailure: { total: 1, correct: 1, bad: 0, unknown: 0 },
    })
    expect(score.directions.forward.firstFailures['raw-cost']).toMatchObject({ total: 2, correct: 1, bad: 1, unknown: 0 })
    expect(score.directions.forward.failedPredicates.rawCost).toMatchObject({ total: 2, correct: 1, bad: 1, unknown: 0 })
    expect(score.directions.forward.failedPredicates.ratio).toMatchObject({ total: 2, correct: 1, bad: 1 })
    expect(score.directions.reverse.firstFailures.ratio).toMatchObject({ total: 1, unknown: 1 })
    expect(score.directions.reverse.firstFailures['missing-competitor']).toMatchObject({ total: 1, correct: 1 })
    expect(score.regions.edge!.partitions.forwardOnlyFailure.bad).toBe(1)
    expect(score.regions.overlap!.partitions.bothFailure.correct).toBe(1)
    expect(score.regions.edge!.directions.forward.firstFailures['raw-cost'].bad).toBe(1)
    expect(score.unsupported).toEqual({ maskPixels: 2, baseAcceptedPixels: 2, retained: 0, lost: 2 })
    expect(score.truthSupport).toEqual({ validTruthPixels: 3, baseAcceptedWithTruth: 3, filteredAcceptedWithTruth: 1, baseTruthCoverage: 1, filteredTruthCoverage: 1 / 3 })
    const pooled = poolStereoLocalAttrition([score, score])
    expect(pooled.caseCount).toBe(2)
    expect(pooled.pointCount).toBe(8)
    expect(pooled.partitions.forwardOnlyFailure.bad).toBe(2)
    expect(pooled.unsupported.lost).toBe(4)

    const gained = resultFor(width, height, [points[0]!, points[2]!, points[3]!], [20])
    expect(() => scoreStereoLocalAttrition(evidence, base, gained, truth, {}, [])).toThrow(/point set/)
    const moved = resultFor(width, height, [simplePoint(19, 2, 4)], [20, 21, 22])
    expect(() => scoreStereoLocalAttrition(evidence, base, moved, truth, {}, [])).toThrow(/changed its base point/)
    const keptUnknownEvidence = [...evidence]
    keptUnknownEvidence[2] = pointEvidence(21, 3, direction('pass', 3), direction('pass', 3))
    const keptUnknown = resultFor(width, height, [points[0]!, points[2]!], [20, 22])
    expect(scoreStereoLocalAttrition(keptUnknownEvidence, base, keptUnknown, truth, {}, []).partitions.retained.unknown).toBe(1)
    const reordered = resultFor(width, height, [points[2]!, points[0]!], [20, 22])
    expect(() => scoreStereoLocalAttrition(keptUnknownEvidence, base, reordered, truth, {}, [])).toThrow(/order/)
    const tamperedEvidence = [...evidence]
    tamperedEvidence[0] = { ...evidence[0]!, forward: { ...evidence[0]!.forward, rawAnchorCost: 1 } }
    expect(() => scoreStereoLocalAttrition(tamperedEvidence, base, filtered, truth, {}, [])).toThrow(/recorded costs/)
    for (const competitorFirstLabel of [4.5, Number.NaN]) {
      const malformed = [...evidence]
      malformed[0] = { ...evidence[0]!, forward: { ...evidence[0]!.forward, competitorFirstLabel } }
      expect(() => scoreStereoLocalAttrition(malformed, base, filtered, truth, {}, [])).toThrow(/competitor label/)
    }
  })

  it('supports an empty accepted set and all-unknown truth without inventing error labels', () => {
    const width = 8, height = 6
    const base = resultFor(width, height, [])
    const truth = truthFor(width, height, {})
    const score = scoreStereoLocalAttrition([], base, base, truth, { empty: [] }, [])
    expect(score.evidenceCount).toBe(0)
    expect(Object.values(score.partitions).every(bucket => bucket.total === 0 && bucket.unknown === 0)).toBe(true)
    expect(score.regions.empty!.pixelCount).toBe(0)
    expect(() => scoreStereoLocalAttrition([], base, base, truth, {}, [99])).toThrow(/unsupported mask/)
  })
})
