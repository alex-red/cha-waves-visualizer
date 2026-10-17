import { describe, expect, it } from 'vitest'
import { decodePcm16Base64, SATELLITE_LIMITS, validateSatelliteCapture } from './satellite'

const capture = {
  id: 'worklet-observation', capturedAt: '2026-10-16T01:00:00.000Z', position: { xM: 1, yM: 2 },
  sampleRate: 8000, durationMs: 1, pcm16Base64: btoa('\0'.repeat(16)),
}

describe('satellite capture provenance', () => {
  it('preserves optional recorder metadata without inventing it for earlier recordings', () => {
    const legacy = validateSatelliteCapture(capture)
    expect(legacy.ok && legacy.value.captureBackend).toBeUndefined()
    const signal = { peak: 0.9, rms: 0.1, clippedFraction: 0.01 }
    const result = validateSatelliteCapture({ ...capture, captureBackend: 'audio-worklet', signal })
    expect(result.ok && result.value).toMatchObject({ captureBackend: 'audio-worklet', signal })
  })

  it('validates and preserves optional acquisition metadata against the actual PCM length', () => {
    const acquisition = {
      version: 1,
      requested: { echoCancellation: false, noiseSuppression: true, autoGainControl: false },
      applied: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
      timing: { clock: 'audio-context', precision: 'approximate', contextSampleRate: 8_000, captureStartFrame: null, captureFrames: 640, scheduledChirpStartFrame: 0, chirpFrames: 640 },
      continuity: { status: 'unavailable' },
    }
    const accepted = validateSatelliteCapture({ ...capture, pcm16Base64: btoa('\0'.repeat(1_280)), durationMs: 80, acquisition })
    expect(accepted.ok && accepted.value.acquisition).toEqual(acquisition)
    expect(validateSatelliteCapture({ ...capture, pcm16Base64: btoa('\0'.repeat(1_280)), durationMs: 80, acquisition: { ...acquisition, timing: { ...acquisition.timing, captureFrames: 639 } } }).ok).toBe(false)
    expect(validateSatelliteCapture({ ...capture, acquisition: { ...acquisition, applied: { ...acquisition.applied, deviceId: 'private-device' } } }).ok).toBe(false)
  })

  it('rejects unsupported backends and impossible or nonfinite signal statistics', () => {
    expect(validateSatelliteCapture({ ...capture, captureBackend: 'unknown' }).ok).toBe(false)
    for (const signal of [null, [], { peak: 1, rms: 0.2 }, { peak: 0.2, rms: 0.8, clippedFraction: 0 }, { peak: Number.NaN, rms: 0, clippedFraction: 0 }, { peak: 1, rms: 0.2, clippedFraction: 2 }]) {
      expect(validateSatelliteCapture({ ...capture, signal }).ok).toBe(false)
    }
  })
})

describe('shared PCM16 decoding', () => {
  it('preserves signed little-endian values and sample order at full-scale boundaries', () => {
    const values = [-32768, -32767, -1, 0, 1, 255, 256, 32767]
    const bytes = new Uint8Array(values.length * 2)
    const view = new DataView(bytes.buffer)
    values.forEach((value, index) => view.setInt16(index * 2, value, true))
    const encoded = btoa(String.fromCharCode(...bytes))
    expect(Array.from(decodePcm16Base64(encoded))).toEqual(values.map(value => value / 32768))
  })

  it('rejects malformed, odd-length and oversized bytes before allocating samples', () => {
    for (const encoded of ['', 'not base64!', 'AA', 'AA==']) expect(() => decodePcm16Base64(encoded)).toThrow()
    expect(() => decodePcm16Base64(btoa('\0'.repeat(SATELLITE_LIMITS.maxRawBytes + 2)))).toThrow(/512 KiB/)
    expect(() => decodePcm16Base64(btoa('\0'.repeat(SATELLITE_LIMITS.maxRawBytes)))).not.toThrow()
  })
})
