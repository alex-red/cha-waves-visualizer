import { describe, expect, it } from 'vitest'
import { compareEchoResponses, inspectEchoSignal, type EchoResponseCapture } from './echo-diagnostics'

describe('inspectEchoSignal', () => {
  it('reports exact-zero runs at the 5 ms boundary and counts near-full-scale samples', () => {
    const samples = new Float32Array(16_000).fill(0.25)
    samples.fill(0, 100, 139) // 4.875 ms at 8 kHz: below the reporting threshold.
    samples.fill(0, 200, 240) // Exactly 5 ms; end time is exclusive.
    samples[10] = 0.999
    samples[11] = -0.999
    samples[12] = 0.998

    expect(inspectEchoSignal(samples, 8_000)).toEqual({
      zeroRuns: [{ startMs: 25, endMs: 30, durationMs: 5 }],
      longestZeroRunMs: 5,
      clippedSampleCount: 2,
    })
  })

  it('validates sample rate, duration, empty input, and non-finite samples', () => {
    expect(() => inspectEchoSignal([], 48_000)).toThrow(/between one sample and two seconds/)
    expect(() => inspectEchoSignal(new Float32Array(96_001), 48_000)).toThrow(/two seconds/)
    expect(() => inspectEchoSignal([0], 7_999)).toThrow(/8–96 kHz/)
    expect(() => inspectEchoSignal([0], 96_001)).toThrow(/8–96 kHz/)
    expect(() => inspectEchoSignal([0, Number.NaN], 48_000)).toThrow(/finite/)
  })
})

describe('compareEchoResponses', () => {
  const poses = [
    { captureId: 'origin', position: { xM: 0, yM: 0 } },
    { captureId: 'x-step', position: { xM: 1, yM: 0 } },
    { captureId: 'y-step', position: { xM: 0, yM: 1 } },
  ] as const

  it('uses the strongest peak only as a reference and finds a fixed relative-delay track', () => {
    const captures: EchoResponseCapture[] = poses.map((pose, i) => ({
      ...pose,
      // Strongest peak is intentionally not index 0. A weaker earlier peak
      // must not become a positive-delay candidate relative to that reference.
      peaks: [
        { delayMs: 49, strength: 0.03 },
        { delayMs: 50 + i * 20, strength: 0.8 + i * 0.01 },
        { delayMs: 52 + i * 20 + [0.05, 0.12, -0.06][i]!, strength: 0.04 },
        { delayMs: 50 + i * 20 + 0.5, strength: 0.02 },
      ],
    }))

    const result = compareEchoResponses(captures)
    expect(result.hasSpatialCoverage).toBe(true)
    expect(result.references).toEqual([
      { captureId: 'origin', peakIndex: 1, delayMs: 50 },
      { captureId: 'x-step', peakIndex: 1, delayMs: 70 },
      { captureId: 'y-step', peakIndex: 1, delayMs: 90 },
    ])
    expect(result.stationaryTracks).toHaveLength(1)
    expect(result.stationaryTracks[0]!.meanDelayMs).toBeCloseTo(2.0366666666666666, 12)
    expect(result.stationaryTracks[0]!.spreadMs).toBeCloseTo(0.18, 12)
    expect(result.stationaryTracks[0]!.arrivals.map(item => item.peakIndex)).toEqual([2, 2, 2])
  })

  it('does not call a geometry-shifting candidate stationary', () => {
    const captures: EchoResponseCapture[] = poses.map((pose, i) => ({
      ...pose,
      peaks: [
        { delayMs: 100 + i * 10, strength: 1 },
        // An X-normal reflected path shifts by approximately 2*1m/c on the
        // x move, then stays fixed on the orthogonal y move.
        { delayMs: 110 + i * 10 + [0, 5.83, 0][i]!, strength: 0.2 },
      ],
    }))

    const result = compareEchoResponses(captures)
    expect(result.hasSpatialCoverage).toBe(true)
    expect(result.stationaryTracks).toEqual([])
  })

  it('requires three distinct, non-collinear poses with the specified baseline and area', () => {
    const commonPeak = { peaks: [{ delayMs: 10, strength: 1 }, { delayMs: 12, strength: 0.1 }] }
    const collinear = compareEchoResponses([
      { captureId: 'a', position: { xM: 0, yM: 0 }, ...commonPeak },
      { captureId: 'b', position: { xM: 1, yM: 1 }, ...commonPeak },
      { captureId: 'c', position: { xM: 2, yM: 2 }, ...commonPeak },
    ])
    expect(collinear.hasSpatialCoverage).toBe(false)
    expect(collinear.stationaryTracks).toEqual([])

    const repeated = compareEchoResponses([
      { captureId: 'a', position: { xM: 0, yM: 0 }, ...commonPeak },
      { captureId: 'b', position: { xM: 0, yM: 0 }, ...commonPeak },
      { captureId: 'c', position: { xM: 0.5, yM: 0.5 }, ...commonPeak },
    ])
    expect(repeated.hasSpatialCoverage).toBe(false)

    const minimumArea = compareEchoResponses([
      { captureId: 'a', position: { xM: 0, yM: 0 }, ...commonPeak },
      { captureId: 'b', position: { xM: 0.5, yM: 0 }, ...commonPeak },
      { captureId: 'c', position: { xM: 0, yM: 0.5 }, ...commonPeak },
    ])
    expect(minimumArea.hasSpatialCoverage).toBe(true)
    expect(minimumArea.stationaryTracks).toHaveLength(1)
  })

  it('keeps weak references descriptive and ignores zero-strength or missing candidates', () => {
    const captures: EchoResponseCapture[] = [
      { captureId: 'a', position: poses[0].position, peaks: [{ delayMs: 10, strength: 1e-12 }, { delayMs: 12, strength: 0 }] },
      { captureId: 'b', position: poses[1].position, peaks: [{ delayMs: 20, strength: 0 }, { delayMs: 22, strength: 0 }] },
      { captureId: 'c', position: poses[2].position, peaks: [] },
    ]

    const result = compareEchoResponses(captures)
    expect(result.hasSpatialCoverage).toBe(true)
    expect(result.references).toEqual([
      { captureId: 'a', peakIndex: 0, delayMs: 10 },
      { captureId: 'b', peakIndex: 0, delayMs: 20 },
    ])
    expect(result.stationaryTracks).toEqual([])
  })

  it('does not infer a stationary feature from only the captures where it was detected', () => {
    const captures: EchoResponseCapture[] = [
      ...poses.map(pose => ({
        ...pose,
        peaks: [
          { delayMs: 10, strength: 1 },
          { delayMs: 12, strength: 0.1 },
        ],
      })),
      { captureId: 'fourth-without-return', position: { xM: 1, yM: 1 }, peaks: [{ delayMs: 10, strength: 1 }] },
    ]
    expect(compareEchoResponses(captures).stationaryTracks).toEqual([])
  })

  it('accepts a positive candidate at exactly 1 ms and exactly 0.3 ms track spread', () => {
    const captures: EchoResponseCapture[] = poses.map((pose, i) => ({
      ...pose,
      peaks: [
        { delayMs: 20 + i, strength: 1 },
        { delayMs: 21 + i + [0, 0.15, 0.3][i]!, strength: 0.1 },
      ],
    }))
    const result = compareEchoResponses(captures)
    expect(result.stationaryTracks).toHaveLength(1)
    expect(result.stationaryTracks[0]!.spreadMs).toBeCloseTo(0.3, 12)
  })

  it('validates capture counts, peak counts, IDs, and finite numeric fields', () => {
    expect(() => compareEchoResponses(Array.from({ length: 13 }, (_, i) => ({ captureId: String(i), position: { xM: i, yM: 0 }, peaks: [] })))).toThrow(/12 captures/)
    expect(() => compareEchoResponses([{ captureId: 'a', position: { xM: 0, yM: 0 }, peaks: Array.from({ length: 17 }, () => ({ delayMs: 1, strength: 1 })) }])).toThrow(/16 peaks/)
    expect(() => compareEchoResponses([
      { captureId: 'same', position: { xM: 0, yM: 0 }, peaks: [] },
      { captureId: 'same', position: { xM: 1, yM: 0 }, peaks: [] },
    ])).toThrow(/unique/)
    expect(() => compareEchoResponses([{ captureId: 'a', position: { xM: Number.NaN, yM: 0 }, peaks: [] }])).toThrow(/finite coordinates/)
    expect(() => compareEchoResponses([{ captureId: 'a', position: { xM: 0, yM: 0 }, peaks: [{ delayMs: Infinity, strength: 1 }] }])).toThrow(/finite/)
    expect(() => compareEchoResponses(Array.from({ length: 12 }, (_, i) => ({
      captureId: `within-limit-${i}`,
      position: { xM: i / 10, yM: i % 2 },
      peaks: Array.from({ length: 16 }, (_, j) => ({ delayMs: j, strength: 1 })),
    })))).not.toThrow()
  })
})
