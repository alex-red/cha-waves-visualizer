import { describe, expect, it } from 'vitest'
import type { EchoCapture, EchoRoom } from './echo'
import type { SatelliteCapture } from './satellite'
import type { ProbeBatch } from './probe-batch'
import {
  ECHO_SCAN_FORMAT,
  ECHO_SCAN_MAX_JSON_BYTES,
  createRecordedEchoScan,
  createSyntheticEchoScan,
  parseEchoScan,
  serializeEchoScan,
  type EchoScanReview,
} from './echo-scan'

const fixture: EchoRoom = { widthM: 6.4, depthM: 4.8, originXM: -1, originYM: 2 }
const syntheticCaptures: EchoCapture[] = [
  { position: { xM: 1, yM: 3 }, arrivalTimesMs: [10, 20, 30, 40] },
  { position: { xM: 2, yM: 4 }, arrivalTimesMs: [11, 19, 29, 41] },
]

function recording(id = 'capture-1'): SatelliteCapture {
  return {
    id,
    capturedAt: '2026-10-15T12:30:00.000Z',
    position: { xM: 2.25, yM: 3.5 },
    sampleRate: 8_000,
    pcm16Base64: btoa(String.fromCharCode(...new Array(16).fill(0))),
    durationMs: 1,
    deviceLabel: 'Phone mic',
  }
}

function review(captureId = 'capture-1'): EchoScanReview {
  return {
    captureId,
    peaks: [
      { delayMs: 0, strength: 0.9 },
      { delayMs: 30, strength: 0.5 },
      { delayMs: 70, strength: 0.3 },
      { delayMs: 120, strength: 0.15 },
    ],
    directPeakIndex: 0,
    wallPeakIndices: [1, 2],
  }
}

describe('echo scan v3 documents', () => {
  it('round-trips a synthetic fixture and raw arrivals', () => {
    const source = createSyntheticEchoScan(fixture, syntheticCaptures)
    const parsed = parseEchoScan(serializeEchoScan(source))
    expect(parsed.document).toEqual(source)
    expect(parsed.notices).toEqual([])
  })

  it('round-trips raw recordings and capture-id-linked partial review state', () => {
    const measured = { ...recording(), captureBackend: 'audio-worklet' as const, signal: { peak: 0.72, rms: 0.21, clippedFraction: 0.01 } }
    const source = createRecordedEchoScan([measured], [review()])
    const parsed = parseEchoScan(serializeEchoScan(source))
    expect(parsed.document).toEqual(source)
    expect(parsed.notices).toEqual([])
  })

  it('round-trips batches with capture links and keeps old batch-free v3 documents omitted', () => {
    const frames = 5_600
    const measured: SatelliteCapture = {
      ...recording('batch-capture'), pcm16Base64: btoa(String.fromCharCode(...new Array(frames * 2).fill(0))), durationMs: 700,
      captureBackend: 'audio-worklet',
      acquisition: {
        version: 1, requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, applied: {},
        timing: { clock: 'audio-context', precision: 'sample-frame', contextSampleRate: 8_000, captureStartFrame: 8_000, captureFrames: frames, scheduledChirpStartFrame: 8_800, chirpFrames: 640 },
        continuity: { status: 'unavailable' },
      },
    }
    const batch: ProbeBatch = {
      version: 1, id: 'batch-1', startedAt: '2026-10-16T01:00:00.000Z', endedAt: '2026-10-16T01:00:08.000Z',
      position: measured.position, context: { heightM: 1, orientation: 'upright', headingDeg: 90, speakerVolumePercent: 50 },
      playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000, sampleRate: 8_000,
      warmupStartFrame: 0, warmupEndFrame: 8_000,
      attempts: [{ index: 1, status: 'captured', captureId: measured.id }, { index: 2, status: 'interrupted', reason: 'cancelled' }, { index: 3, status: 'not-started' }, { index: 4, status: 'not-started' }, { index: 5, status: 'not-started' }],
    }
    const document = { ...createRecordedEchoScan([measured], []), batches: [batch] }
    expect(parseEchoScan(serializeEchoScan(document)).document).toEqual(document)
    expect(parseEchoScan(serializeEchoScan(createRecordedEchoScan([recording()], []))).document).not.toHaveProperty('batches')
    expect(() => serializeEchoScan({ ...document, batches: [{ ...batch, attempts: [{ index: 1, status: 'captured', captureId: 'missing' }, ...batch.attempts.slice(1)] }] })).toThrow(/missing capture/)
    expect(() => serializeEchoScan({ ...document, batches: [{ ...batch, debug: 'private' } as unknown as ProbeBatch] })).toThrow(/unsupported or missing fields/)
  })

  it('round-trips validated acquisition evidence with raw PCM and review state', () => {
    const acquisition = {
      version: 1 as const,
      requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 8_000, channelCount: 1, sampleSize: 16 },
      timing: { clock: 'audio-context' as const, precision: 'sample-frame' as const, contextSampleRate: 8_000, captureStartFrame: 0, captureFrames: 8, scheduledChirpStartFrame: 0, chirpFrames: 640 },
      continuity: { status: 'observed' as const, presentInputFrames: 8, missingInputFrames: 0, unobservedFrames: 0, presentZeroFrames: 8, longestPresentZeroRunFrames: 8 },
    }
    // A full chirp window needs a correspondingly sized recording.
    const audio = btoa(String.fromCharCode(...new Array(1_280).fill(0)))
    const measured: SatelliteCapture = { ...recording(), pcm16Base64: audio, durationMs: 80, captureBackend: 'audio-worklet', acquisition: { ...acquisition, timing: { ...acquisition.timing, captureFrames: 640 }, continuity: { ...acquisition.continuity, presentInputFrames: 640, presentZeroFrames: 640, longestPresentZeroRunFrames: 640 } } }
    const source = createRecordedEchoScan([measured], [review()])
    expect(parseEchoScan(serializeEchoScan(source)).document).toEqual(source)
  })

  it('accepts an incomplete review while enforcing peak order and wall-delay rules', () => {
    const partial: EchoScanReview = { captureId: 'capture-1', peaks: [{ delayMs: 10, strength: 0.5 }], directPeakIndex: 0, wallPeakIndices: [] }
    expect(parseEchoScan(serializeEchoScan(createRecordedEchoScan([recording()], [partial]))).document).toMatchObject({ reviews: [partial] })
    const tooLate = { ...review(), peaks: [{ delayMs: 0, strength: 1 }, { delayMs: 176, strength: 0.5 }] , wallPeakIndices: [1] }
    expect(() => serializeEchoScan(createRecordedEchoScan([recording()], [tooLate]))).toThrow(/within 175 ms/)
    const unordered = { ...review(), peaks: [{ delayMs: 20, strength: 1 }, { delayMs: 10, strength: 0.5 }], wallPeakIndices: [1] }
    expect(() => serializeEchoScan(createRecordedEchoScan([recording()], [unordered]))).toThrow(/nondecreasing delay/)
  })

  it('rejects malformed JSON, oversized input, and non-finite numeric values', () => {
    expect(() => parseEchoScan('{')).toThrow(/valid JSON/)
    expect(() => parseEchoScan(' '.repeat(ECHO_SCAN_MAX_JSON_BYTES + 1))).toThrow(/10485760-byte limit/)
    const nonFinite = JSON.stringify({ format: 'cha-echo-scan-v2', mode: 'synthetic', fixture, captures: [{ position: { xM: 1, yM: 2 }, arrivalTimesMs: [1, 2, 3, 1e999] }] })
    expect(() => parseEchoScan(nonFinite)).toThrow(/finite number/)
  })

  it('rejects duplicate recording ids, duplicate reviews, and broken peak references', () => {
    expect(() => serializeEchoScan(createRecordedEchoScan([recording(), recording()], []))).toThrow(/duplicate capture id/)
    expect(() => serializeEchoScan(createRecordedEchoScan([recording()], [review(), review()]))).toThrow(/duplicate capture id/)
    const missing = { ...review(), captureId: 'missing' }
    expect(() => serializeEchoScan(createRecordedEchoScan([recording()], [missing]))).toThrow(/missing capture/)
    const badIndex = { ...review(), wallPeakIndices: [1, 4] }
    expect(() => serializeEchoScan(createRecordedEchoScan([recording()], [badIndex]))).toThrow(/existing peak/)
    const duplicateWalls = { ...review(), wallPeakIndices: [1, 1] }
    expect(() => serializeEchoScan(createRecordedEchoScan([recording()], [duplicateWalls]))).toThrow(/must be distinct/)
  })

  it('rejects unknown v2 keys, malformed raw samples, and session-secret fields', () => {
    const withExtra = { ...createSyntheticEchoScan(fixture, syntheticCaptures), reconstruction: { status: 'ok' } }
    expect(() => parseEchoScan(JSON.stringify(withExtra))).toThrow(/unsupported field "reconstruction"/)
    const badRaw = { ...recording(), position: { xM: 2.25, yM: 3.5, elevation: 4 } }
    expect(() => serializeEchoScan(createRecordedEchoScan([badRaw], []))).toThrow(/unsupported field "elevation"/)
    const secret = { ...createSyntheticEchoScan(fixture, syntheticCaptures), sessionToken: 'never-export-this' }
    expect(() => serializeEchoScan(secret)).toThrow(/session or authorization/)
  })
})

describe('legacy v2 migration', () => {
  it('preserves raw PCM and capture-linked reviews without inventing acquisition evidence', () => {
    const legacy: { format: string; mode: string; recordings: SatelliteCapture[]; reviews: EchoScanReview[] } = {
      format: 'cha-echo-scan-v2', mode: 'recorded', recordings: [{ ...recording(), captureBackend: 'audio-worklet' }], reviews: [review()],
    }
    const migrated = parseEchoScan(JSON.stringify(legacy))
    expect(migrated.document).toEqual({ ...createRecordedEchoScan(legacy.recordings, legacy.reviews), format: ECHO_SCAN_FORMAT })
    expect(migrated.document.mode === 'recorded' && migrated.document.recordings[0]?.acquisition).toBeUndefined()
    expect(migrated.notices[0]).toMatch(/telemetry was not available/)
    expect(parseEchoScan(serializeEchoScan(migrated.document)).document).toEqual(migrated.document)
  })

  it('rejects acquisition fields in v2 recordings and preserves v1 migration behavior as v3', () => {
    const legacyV2 = { format: 'cha-echo-scan-v2', mode: 'recorded', recordings: [{ ...recording(), acquisition: { version: 1 } }], reviews: [] }
    expect(() => parseEchoScan(JSON.stringify(legacyV2))).toThrow(/unsupported field "acquisition"/)
    const legacyV1 = { format: 'cha-echo-scan-v1', mode: 'recorded', recordings: [recording()], detectedPeaks: [], directPeakIndices: {}, selectedWallArrivals: [], reconstruction: {} }
    expect(parseEchoScan(JSON.stringify(legacyV1)).document.format).toBe(ECHO_SCAN_FORMAT)
  })
})

describe('legacy v1 recovery', () => {
  it('preserves synthetic fixture and captures while dropping derived reconstruction', () => {
    const legacy = { format: 'cha-echo-scan-v1', mode: 'synthetic', fixture, captures: syntheticCaptures, reconstruction: { status: 'ok', room: fixture } }
    const imported = parseEchoScan(JSON.stringify(legacy))
    expect(imported.document).toEqual(createSyntheticEchoScan(fixture, syntheticCaptures))
    expect(imported.notices).toHaveLength(1)
    expect(imported.notices[0]).toMatch(/recomputed/)
  })

  it('recovers raw recorded audio and resets unlinked v1 review selections with a notice', () => {
    const legacy = {
      format: 'cha-echo-scan-v1', mode: 'recorded', recordings: [recording()],
      detectedPeaks: [{ id: 'capture-1', peaks: review().peaks }],
      directPeakIndices: { 'capture-1': '0' }, selectedWallArrivals: [], reconstruction: { status: 'ok' },
    }
    const imported = parseEchoScan(JSON.stringify(legacy))
    expect(imported.document).toEqual(createRecordedEchoScan([recording()], []))
    expect(imported.notices[0]).toMatch(/selections were reset/)
  })

  it('still rejects secret-bearing and unknown legacy fields', () => {
    const legacy = { format: 'cha-echo-scan-v1', mode: 'recorded', recordings: [recording()], detectedPeaks: [], directPeakIndices: {}, selectedWallArrivals: [], reconstruction: {}, token: 'secret' }
    expect(() => parseEchoScan(JSON.stringify(legacy))).toThrow(/session or authorization/)
    const unknown = { format: 'cha-echo-scan-v1', mode: 'synthetic', fixture, captures: syntheticCaptures, surprise: true }
    expect(() => parseEchoScan(JSON.stringify(unknown))).toThrow(/unsupported field "surprise"/)
  })
})
