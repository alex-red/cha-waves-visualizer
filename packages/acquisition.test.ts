import { describe, expect, it } from 'vitest'
import { validateAcquisitionMetadata, type AcquisitionMetadata } from './acquisition'

const sampleCount = 8_000
const context = { sampleRate: 8_000, sampleCount, captureBackend: 'audio-worklet' }

function metadata(overrides: Partial<AcquisitionMetadata> = {}): AcquisitionMetadata {
  return {
    version: 1,
    requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 8_000, channelCount: 1, sampleSize: 16, latency: 0.01 },
    timing: { clock: 'audio-context', precision: 'sample-frame', contextSampleRate: 8_000, captureStartFrame: 100, captureFrames: sampleCount, scheduledChirpStartFrame: 200, chirpFrames: 640 },
    continuity: { status: 'observed', presentInputFrames: 7_900, missingInputFrames: 100, unobservedFrames: 0, presentZeroFrames: 200, longestPresentZeroRunFrames: 80 },
    ...overrides,
  }
}

describe('acquisition metadata contract', () => {
  it('accepts complete worklet telemetry and the approximate fallback shape', () => {
    expect(validateAcquisitionMetadata(metadata(), context)).toMatchObject({ ok: true })
    const unknownWorkletContinuity = metadata({ continuity: { status: 'unavailable' } })
    expect(validateAcquisitionMetadata(unknownWorkletContinuity, context)).toMatchObject({ ok: true })
    const approximate = metadata({
      timing: { clock: 'audio-context', precision: 'approximate', contextSampleRate: 8_000, captureStartFrame: null, captureFrames: sampleCount, scheduledChirpStartFrame: 200, chirpFrames: 640 },
      continuity: { status: 'unavailable' },
    })
    expect(validateAcquisitionMetadata(approximate, { sampleRate: 8_000, sampleCount, captureBackend: 'script-processor' })).toMatchObject({ ok: true })
    expect(validateAcquisitionMetadata({ ...approximate, continuity: metadata().continuity }, { sampleRate: 8_000, sampleCount, captureBackend: 'script-processor' }).ok).toBe(false)
  })

  it('rejects inconsistent frame totals, zero counts, chirp windows, and unsafe frame counts', () => {
    const base = metadata()
    for (const bad of [
      { ...base, timing: { ...base.timing, captureFrames: sampleCount - 1 } },
      { ...base, continuity: { ...base.continuity, missingInputFrames: 101 } },
      { ...base, continuity: { ...base.continuity, presentZeroFrames: 8_001 } },
      { ...base, continuity: { ...base.continuity, longestPresentZeroRunFrames: 201 } },
      { ...base, continuity: { ...base.continuity, presentZeroFrames: 1, longestPresentZeroRunFrames: 0 } },
      { ...base, continuity: { ...base.continuity, presentZeroFrames: 0, longestPresentZeroRunFrames: 1 } },
      { ...base, timing: { ...base.timing, scheduledChirpStartFrame: 7_500 } },
      { ...base, timing: { ...base.timing, captureStartFrame: Number.MAX_SAFE_INTEGER + 1 } },
    ]) expect(validateAcquisitionMetadata(bad, context).ok).toBe(false)
  })

  it('rejects unsupported versions, clocks, precision/backend combinations, and mismatched sample rates', () => {
    const base = metadata()
    expect(validateAcquisitionMetadata({ ...base, version: 2 }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, timing: { ...base.timing, clock: 'performance' } }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata(base, { ...context, captureBackend: 'script-processor' }).ok).toBe(false)
    expect(validateAcquisitionMetadata(base, { ...context, sampleRate: 16_000 }).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, timing: { ...base.timing, precision: 'approximate', captureStartFrame: null } }, context).ok).toBe(false)
  })

  it('rejects unknown fields, privacy sensitive settings, and malformed requested or applied values', () => {
    const base = metadata()
    expect(validateAcquisitionMetadata({ ...base, acquisitionDebug: true }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, applied: { ...base.applied, deviceId: 'private-id' } }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, applied: { ...base.applied, groupId: 'private-group' } }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, applied: { ...base.applied, label: 'private label' } }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, requested: { ...base.requested, autoGainControl: 'false' } }, context).ok).toBe(false)
    expect(validateAcquisitionMetadata({ ...base, applied: { ...base.applied, channelCount: 0 } }, context).ok).toBe(false)
  })
})
