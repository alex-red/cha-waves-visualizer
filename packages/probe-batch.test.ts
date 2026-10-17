import { describe, expect, it } from 'vitest'
import type { SatelliteCapture } from './satellite'
import { validateProbeBatch, type ProbeBatch } from './probe-batch'

function capture(id: string, captureStartFrame = 8_000): SatelliteCapture {
  const frames = 5_600
  return {
    id, capturedAt: '2026-10-16T01:00:00.000Z', position: { xM: 1, yM: 2 }, sampleRate: 8_000,
    durationMs: 700, pcm16Base64: btoa('\0'.repeat(frames * 2)), captureBackend: 'audio-worklet',
    acquisition: {
      version: 1,
      requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      timing: { clock: 'audio-context', precision: 'sample-frame', contextSampleRate: 8_000, captureStartFrame, captureFrames: frames, scheduledChirpStartFrame: captureStartFrame + 800, chirpFrames: 640 },
      continuity: { status: 'unavailable' },
    },
  }
}

function batch(attempts: ProbeBatch['attempts']): ProbeBatch {
  return {
    version: 1, id: 'batch-1', startedAt: '2026-10-16T01:00:00.000Z', endedAt: '2026-10-16T01:00:08.000Z',
    position: { xM: 1, yM: 2 }, context: { heightM: 1, orientation: 'screen-up', headingDeg: 90, speakerVolumePercent: 50 },
    playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000,
    sampleRate: 8_000, warmupStartFrame: 0, warmupEndFrame: 8_000, attempts,
  }
}

describe('repeated probe batch contract', () => {
  it('accepts a full batch with five ordered, nonoverlapping worklet captures', () => {
    const captures = Array.from({ length: 5 }, (_, i) => capture(`capture-${i + 1}`, 8_000 + i * 8_000))
    const value = batch(captures.map((item, i) => ({ index: i + 1, status: 'captured', captureId: item.id })))
    expect(validateProbeBatch(value, captures)).toEqual({ ok: true, value })
  })

  it('accepts a captured prefix followed by one interruption and not-started attempts', () => {
    const captures = [capture('capture-1'), capture('capture-2', 16_000)]
    const value = batch([
      { index: 1, status: 'captured', captureId: 'capture-1' },
      { index: 2, status: 'captured', captureId: 'capture-2' },
      { index: 3, status: 'interrupted', reason: 'hidden' },
      { index: 4, status: 'not-started' },
      { index: 5, status: 'not-started' },
    ])
    expect(validateProbeBatch(value, captures)).toEqual({ ok: true, value })
  })

  it('rejects invented telemetry, private keys, missing links and overlapping captures', () => {
    const value = batch([{ index: 1, status: 'captured', captureId: 'capture-1' }, { index: 2, status: 'interrupted', reason: 'timeout' }, { index: 3, status: 'not-started' }, { index: 4, status: 'not-started' }, { index: 5, status: 'not-started' }])
    expect(validateProbeBatch({ ...value, sessionToken: 'private' }, [capture('capture-1')]).ok).toBe(false)
    const { acquisition: _acquisition, ...withoutAcquisition } = capture('capture-1')
    expect(validateProbeBatch(value, [withoutAcquisition]).ok).toBe(false)
    expect(validateProbeBatch(value, [capture('other')]).ok).toBe(false)
    const overlap = batch(Array.from({ length: 5 }, (_, i) => ({ index: i + 1, status: 'captured' as const, captureId: `capture-${i + 1}` })))
    expect(validateProbeBatch(overlap, Array.from({ length: 5 }, (_, i) => capture(`capture-${i + 1}`, 8_000 + i * 1_000))).ok).toBe(false)
  })
})
