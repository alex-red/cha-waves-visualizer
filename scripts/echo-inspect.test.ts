import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateChirp } from '../packages/echo'
import { acquisitionFixture } from '../packages/test-fixtures/acquisition'
import type { ProbeBatch } from '../packages/probe-batch'
import { createEchoInspectionReport, parseEchoInspectArguments, renderEchoInspectionReport } from './lib/echo-report'
import { ECHO_INSPECT_USAGE, readBoundedInput, runEchoInspect } from './echo-inspect'

function capture(id: string, position: { xM: number; yM: number }, gapStartMs: number, reviewDelay: number) {
  const sampleRate = 48_000
  const samples = new Float32Array(sampleRate * 0.7).fill(0.001)
  const chirp = generateChirp(sampleRate, 80)
  add(samples, chirp, 200 * sampleRate / 1000, 0.8)
  add(samples, chirp, 210 * sampleRate / 1000, 0.22)
  samples.fill(0, gapStartMs * sampleRate / 1000, (gapStartMs + 40) * sampleRate / 1000)
  const raw = new Uint8Array(samples.length * 2)
  const view = new DataView(raw.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true))
  const pcm16Base64 = Buffer.from(raw).toString('base64')
  return {
    id,
    capturedAt: '2026-10-16T12:00:00.000Z',
    position,
    sampleRate,
    pcm16Base64,
    durationMs: 700,
    captureBackend: 'audio-worklet' as const,
    signal: { peak: 0.8, rms: 0.1, clippedFraction: 0 },
    review: { captureId: id, peaks: [{ delayMs: reviewDelay, strength: 0.4 }], directPeakIndex: 0, wallPeakIndices: [] },
  }
}

function add(samples: Float32Array, chirp: Float32Array, offset: number, gain: number) {
  for (let i = 0; i < chirp.length && offset + i < samples.length; i++) samples[offset + i] = samples[offset + i]! + chirp[i]! * gain
}

function scanBytes() {
  const a = capture('capture-A', { xM: 0, yM: 0 }, 50, 1)
  const b = capture('capture-B', { xM: 1, yM: 0 }, 400, 2)
  const document = {
    format: 'cha-echo-scan-v2',
    mode: 'recorded',
    recordings: [a, b].map(({ review: _review, ...recording }) => recording),
    // Review order intentionally differs from recording order; IDs are the join key.
    reviews: [b.review, a.review],
  }
  return new TextEncoder().encode(JSON.stringify(document))
}

function repeatedCapture(id: string, captureStartFrame: number, peakMs: number | null) {
  const sampleRate = 48_000
  const samples = new Float32Array(sampleRate * 0.7).fill(0.001)
  if (peakMs !== null) add(samples, generateChirp(sampleRate, 80), peakMs * sampleRate / 1000, 0.8)
  const raw = new Uint8Array(samples.length * 2)
  const view = new DataView(raw.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true))
  const acquisition = acquisitionFixture(sampleRate)
  acquisition.timing.captureStartFrame = captureStartFrame
  acquisition.timing.scheduledChirpStartFrame = captureStartFrame + sampleRate * 0.1
  acquisition.continuity = { status: 'observed', presentInputFrames: samples.length, missingInputFrames: 0, unobservedFrames: 0, presentZeroFrames: 0, longestPresentZeroRunFrames: 0 }
  return {
    id, capturedAt: '2026-10-16T12:00:00.000Z', position: { xM: 0, yM: 0 }, sampleRate,
    pcm16Base64: Buffer.from(raw).toString('base64'), durationMs: 700, captureBackend: 'audio-worklet' as const, acquisition,
  }
}

function repeatBatch(id: string, attempts: ProbeBatch['attempts']): ProbeBatch {
  return {
    version: 1, id, startedAt: '2026-10-16T12:00:00.000Z', endedAt: '2026-10-16T12:00:08.000Z',
    position: { xM: 0, yM: 0 }, context: { heightM: 1, orientation: 'screen-up', headingDeg: 90, speakerVolumePercent: 50 },
    playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000, sampleRate: 48_000,
    warmupStartFrame: 0, warmupEndFrame: 48_000, attempts,
  }
}

describe('echo inspection report', () => {
  it('reports repeat reference variation only for eligible captures and preserves partial outcomes', () => {
    const first = repeatedCapture('repeat-1', 48_000, 200)
    const second = repeatedCapture('repeat-2', 96_000, 210)
    const noMatch = repeatedCapture('repeat-no-match', 48_000, null)
    const interruptedBatch = repeatBatch('batch-partial', [
      { index: 1, status: 'captured', captureId: first.id },
      { index: 2, status: 'captured', captureId: second.id },
      { index: 3, status: 'interrupted', reason: 'hidden' },
      { index: 4, status: 'not-started' },
      { index: 5, status: 'not-started' },
    ])
    const noMatchBatch = repeatBatch('batch-no-match', [
      { index: 1, status: 'captured', captureId: noMatch.id },
      { index: 2, status: 'interrupted', reason: 'cancelled' },
      { index: 3, status: 'not-started' },
      { index: 4, status: 'not-started' },
      { index: 5, status: 'not-started' },
    ])
    const input = {
      format: 'cha-echo-scan-v3', mode: 'recorded', recordings: [first, second, noMatch], reviews: [],
      batches: [interruptedBatch, noMatchBatch],
    }
    const report = createEchoInspectionReport(new TextEncoder().encode(JSON.stringify(input)), { threshold: .08, spacingMs: 1.5 })
    expect(report.captures.map(capture => capture.captureId)).toEqual(['repeat-1', 'repeat-2', 'repeat-no-match'])
    expect(report.batches).toHaveLength(2)
    expect(report.batches[0]?.batch).toEqual(interruptedBatch)
    expect(report.batches[0]?.repeatability.attempts.map(attempt => attempt.captureLinkStatus)).toEqual(['linked', 'linked', 'interrupted', 'not-started', 'not-started'])
    expect(report.batches[0]?.repeatability.attempts[0]?.strongestReferenceMinusScheduleMs).toBeCloseTo(100, 2)
    expect(report.batches[0]?.repeatability.attempts[1]?.strongestReferenceMinusScheduleMs).toBeCloseTo(110, 2)
    expect(report.batches[0]?.repeatability.eligibleProbeCount).toBe(2)
    expect(report.batches[0]?.repeatability.spreadMs).toBeCloseTo(10, 2)
    expect(report.batches[0]?.repeatability.attempts[2]?.strongestReferenceMinusScheduleMs).toBeNull()
    expect(report.batches[1]?.repeatability.eligibleProbeCount).toBe(0)
    expect(report.batches[1]?.repeatability.spreadMs).toBeNull()
    expect(report.batches[1]?.repeatability.attempts[0]?.exclusionReason).toMatch(/no strongest matched-peak/)
    expect(report.batches[0]?.repeatability.attempts[0]?.hasPcmZeroRuns).toBe(false)
    expect(report.batches[0]?.repeatability.attempts[0]?.hasClippedSamples).toBe(false)
    expect(report.batches[0]?.repeatability.note).toContain('not a verified wall arrival')
    const markdown = renderEchoInspectionReport(report, 'markdown')
    expect(markdown).toContain('Batch batch-partial')
    expect(markdown).toContain('10.000 ms')
    expect(markdown).toContain('Attempt 3: interrupted')
    const output = JSON.stringify(report)
    expect(output).not.toContain('pcm16Base64')
    expect(output).not.toContain('captureBackend')
    expect(createEchoInspectionReport(new TextEncoder().encode(JSON.stringify(input)), { threshold: .08, spacingMs: 1.5 })).toEqual(report)
  })
  it('keeps acquisition counters separate from PCM zero runs and exposes only a software timing comparison', () => {
    const { review, ...recording } = capture('telemetry', { xM: 0, yM: 0 }, 50, 1)
    const acquisition = acquisitionFixture(recording.sampleRate)
    acquisition.continuity = { status: 'observed', presentInputFrames: 31_680, missingInputFrames: 1920, unobservedFrames: 0, presentZeroFrames: 0, longestPresentZeroRunFrames: 0 }
    const input = { format: 'cha-echo-scan-v3', mode: 'recorded', recordings: [{ ...recording, acquisition }], reviews: [review] }
    const report = createEchoInspectionReport(new TextEncoder().encode(JSON.stringify(input)), { threshold: .08, spacingMs: 1.5 })
    expect(report.captures[0]?.acquisition?.continuity).toEqual(acquisition.continuity)
    expect(report.captures[0]?.signal.zeroRuns[0]?.durationMs).toBe(40)
    expect(report.captures[0]?.timingComparison.scheduledChirpOffsetMs).toBe(100)
    expect(report.captures[0]?.timingComparison.strongestReferenceMinusScheduleMs).toBeCloseTo(100, 2)
    expect(report.captures[0]?.timingComparison.note).toContain('not an acoustic latency calibration')
    expect(report.scan.sourceFormat).toBe('cha-echo-scan-v3')
    const text = renderEchoInspectionReport(report, 'markdown')
    expect(text).toContain('1920 missing')
    expect(text).toContain('Present input zeros: 0')
  })
  it('binds separate PCM hashes, zero intervals, peak analysis and reviews to capture IDs in source order', () => {
    const bytes = scanBytes()
    const report = createEchoInspectionReport(bytes, { threshold: 0.08, spacingMs: 1.5 })
    expect(report.source.byteLength).toBe(bytes.byteLength)
    expect(report.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(report.captures.map(item => item.captureId)).toEqual(['capture-A', 'capture-B'])
    expect(report.captures[0]!.pcmSha256).not.toBe(report.captures[1]!.pcmSha256)
    expect(report.captures[0]!.signal.zeroRuns).toEqual([{ startMs: 50, endMs: 90, durationMs: 40 }])
    expect(report.captures[1]!.signal.zeroRuns).toEqual([{ startMs: 400, endMs: 440, durationMs: 40 }])
    expect(report.captures[0]!.existingReview?.peaks[0]?.delayMs).toBe(1)
    expect(report.captures[1]!.existingReview?.peaks[0]?.delayMs).toBe(2)
    expect(report.captures[0]!.thresholdSensitivity.map(item => item.threshold)).toEqual([0.08, 0.04, 0.02, 0.01])
    expect(report.captures[0]!.candidates[0]!.absoluteMs).toBeCloseTo(200, 2)
    expect(report.captures[0]!.candidates[0]!.relativeToStrongestMs).toBe(0)
    expect(report.captures[0]!.thresholdSensitivity[0]!.peaks[1]!.relativeToStrongestMs).toBeCloseTo(10, 2)
    expect(report.captures[0]!.candidates.some(peak => peak.overlapsZeroRun)).toBe(false)
    expect(report.captures[0]!.existingReview).not.toEqual(report.captures[0]!.candidates)
    const output = JSON.stringify(report)
    expect(output).not.toContain('pcm16Base64')
    expect(output).not.toContain('captureBackend')
    expect(createEchoInspectionReport(bytes, { threshold: 0.08, spacingMs: 1.5 })).toEqual(report)
  })

  it('reports matched-window overlap and preserves a legacy import notice', () => {
    const a = capture('overlap', { xM: 0, yM: 0 }, 220, 3)
    const legacy = {
      format: 'cha-echo-scan-v1', mode: 'recorded',
      recordings: [{ id: a.id, capturedAt: a.capturedAt, position: a.position, sampleRate: a.sampleRate, pcm16Base64: a.pcm16Base64, durationMs: a.durationMs }],
      detectedPeaks: [], directPeakIndices: [], selectedWallArrivals: [],
    }
    const report = createEchoInspectionReport(new TextEncoder().encode(JSON.stringify(legacy)), { threshold: 0.01, spacingMs: 1 })
    expect(report.scan.notices.join(' ')).toMatch(/v1 recordings/)
    expect(report.captures[0]!.signal.zeroRuns[0]).toEqual({ startMs: 220, endMs: 260, durationMs: 40 })
    expect(report.captures[0]!.candidates.some(peak => peak.overlapsZeroRun)).toBe(true)
    expect(report.captures[0]!.candidates.find(peak => peak.overlapsZeroRun)?.overlappingZeroRuns).toEqual([0])
    expect(report.captures[0]!.existingReview).toBeNull()
  })

  it('labels synthetic scans without pretending they contain PCM', () => {
    const scan = { format: 'cha-echo-scan-v2', mode: 'synthetic', fixture: { widthM: 5, depthM: 6 }, captures: [] }
    const report = createEchoInspectionReport(new TextEncoder().encode(JSON.stringify(scan)), { threshold: 0.08, spacingMs: 1.5 })
    expect(report.scan.mode).toBe('synthetic')
    expect(report.captures).toEqual([])
    expect(report.crossPosition).toBeNull()
    expect(renderEchoInspectionReport(report, 'markdown')).toContain('no recorded PCM analysis')
  })

  it('reports computed peak and RMS from PCM rather than capture metadata', () => {
    const raw = new Uint8Array(9_600)
    const view = new DataView(raw.buffer)
    for (let index = 0; index < 4_800; index += 1) view.setInt16(index * 2, 8_192, true)
    const pcm16Base64 = Buffer.from(raw).toString('base64')
    const document = {
      format: 'cha-echo-scan-v2', mode: 'recorded',
      recordings: [{ id: 'constant', capturedAt: '2026-10-16T12:00:00.000Z', position: { xM: 0, yM: 0 }, sampleRate: 48_000, pcm16Base64, durationMs: 100, signal: { peak: 0.9, rms: 0.8, clippedFraction: 0 } }],
      reviews: [],
    }
    const report = createEchoInspectionReport(new TextEncoder().encode(JSON.stringify(document)), { threshold: 0.08, spacingMs: 1.5 })
    expect(report.captures[0]!.signal.computedPeakAmplitude).toBe(0.25)
    expect(report.captures[0]!.signal.computedRmsAmplitude).toBe(0.25)
  })

  it('validates deterministic bounded CLI arguments, strict scans, and source-size limits', () => {
    expect(parseEchoInspectArguments(['--', '--input', 'x.json'])).toEqual({ input: 'x.json', format: 'json', threshold: 0.08, spacingMs: 1.5 })
    expect(parseEchoInspectArguments(['--input', 'x', '--format', 'markdown', '--threshold', '0.04', '--spacing-ms', '2'])).toEqual({ input: 'x', format: 'markdown', threshold: 0.04, spacingMs: 2 })
    for (const args of [[], ['--input', 'x', '--bad'], ['--input', 'x', '--threshold', '0'], ['--input', 'x', '--spacing-ms', '0']]) expect(() => parseEchoInspectArguments(args)).toThrow()
    expect(() => createEchoInspectionReport(new Uint8Array(10 * 1024 * 1024 + 1), { threshold: 0.08, spacingMs: 1.5 })).toThrow(/10 MiB|10485760/)
    expect(() => createEchoInspectionReport(new TextEncoder().encode('{'), { threshold: 0.08, spacingMs: 1.5 })).toThrow(/valid JSON/)
    expect(() => createEchoInspectionReport(new TextEncoder().encode(JSON.stringify({ format: 'cha-echo-scan-v2', mode: 'recorded', recordings: [], reviews: [], sessionToken: 'secret' })), { threshold: 0.08, spacingMs: 1.5 })).toThrow(/cannot contain session/)
  })

  it('rejects missing and oversized input files before parsing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echo-inspect-test-'))
    try {
      await expect(readBoundedInput(join(directory, 'missing.json'))).rejects.toThrow()
      const oversizedPath = join(directory, 'oversized.json')
      const handle = await open(oversizedPath, 'w')
      try { await handle.truncate(10 * 1024 * 1024 + 1) } finally { await handle.close() }
      await expect(readBoundedInput(oversizedPath)).rejects.toThrow(/exceeds the 10485760-byte limit/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('prints help without input or I/O, and rejects help combined with other arguments', async () => {
    expect(await runEchoInspect(['--help'])).toBe(ECHO_INSPECT_USAGE)
    expect(await runEchoInspect(['--', '-h'])).toBe(ECHO_INSPECT_USAGE)
    await expect(runEchoInspect(['--help', '--invalid'])).rejects.toThrow(/Unknown option/)
    await expect(runEchoInspect(['--input', '/missing/scan.json', '--help'])).rejects.toThrow(/Unknown option|requires a value|Required option/)
  })
})
