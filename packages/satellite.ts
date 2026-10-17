/** Shared, browser-safe protocol for the optional phone microphone relay. */
import { validateAcquisitionMetadata, type AcquisitionMetadata } from './acquisition.ts'

export type SatelliteCapture = {
  id: string
  capturedAt: string
  position: { xM: number; yM: number }
  sampleRate: number
  pcm16Base64: string
  durationMs: number
  deviceLabel?: string
  captureBackend?: 'audio-worklet' | 'script-processor'
  signal?: { peak: number; rms: number; clippedFraction: number }
  acquisition?: AcquisitionMetadata
}

export type SatelliteSessionSnapshot = {
  expiresAt: string
  joined: boolean
  deviceLabel: string
  captures: SatelliteCapture[]
  batches?: import('./probe-batch.ts').ProbeBatch[]
}

export type SatelliteCaptureValidation =
  | { ok: true; value: SatelliteCapture }
  | { ok: false; reason: string }

export const SATELLITE_LIMITS = {
  tokenBytes: 32,
  sessionLifetimeMs: 30 * 60 * 1000,
  maxSessions: 32,
  maxCaptures: 12,
  maxBatches: 12,
  maxSessionUploads: 1_024,
  maxRawBytes: 512 * 1024,
  minSampleRate: 8_000,
  maxSampleRate: 96_000,
  maxDurationMs: 2_000,
  maxLabelLength: 80,
} as const

function pcm16Binary(encoded: unknown): string {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length % 4 !== 0 || encoded.length > Math.ceil(SATELLITE_LIMITS.maxRawBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new RangeError('pcm16Base64 must be valid base64 within the 512 KiB audio limit.')
  }
  const binary = atob(encoded)
  if (binary.length === 0 || binary.length > SATELLITE_LIMITS.maxRawBytes || binary.length % 2 !== 0) {
    throw new RangeError('PCM16 audio must contain a non-empty even number of bytes within the 512 KiB limit.')
  }
  return binary
}

/** Decode bounded little-endian PCM16 identically in workers and offline tools. */
export function decodePcm16Base64(encoded: string): Float32Array {
  const binary = pcm16Binary(encoded)
  const samples = new Float32Array(binary.length / 2)
  for (let i = 0; i < samples.length; i++) {
    const unsigned = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8
    samples[i] = (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768
  }
  return samples
}

/** Validate and normalize an untrusted capture payload without Node APIs. */
export function validateSatelliteCapture(input: unknown): SatelliteCaptureValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'Capture must be an object.' }
  const value = input as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 128 || /[\u0000-\u001f\u007f]/.test(value.id)) {
    return { ok: false, reason: 'Capture id must be 1–128 printable characters.' }
  }
  if (typeof value.capturedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt))) {
    return { ok: false, reason: 'capturedAt must be a UTC ISO timestamp.' }
  }
  if (!value.position || typeof value.position !== 'object' || Array.isArray(value.position)) return { ok: false, reason: 'position must contain xM and yM.' }
  const position = value.position as Record<string, unknown>
  if (typeof position.xM !== 'number' || !Number.isFinite(position.xM) || Math.abs(position.xM) > 1_000_000 || typeof position.yM !== 'number' || !Number.isFinite(position.yM) || Math.abs(position.yM) > 1_000_000) {
    return { ok: false, reason: 'position xM and yM must be finite metre coordinates.' }
  }
  if (!Number.isInteger(value.sampleRate) || (value.sampleRate as number) < SATELLITE_LIMITS.minSampleRate || (value.sampleRate as number) > SATELLITE_LIMITS.maxSampleRate) {
    return { ok: false, reason: 'sampleRate must be an integer from 8000 through 96000 Hz.' }
  }
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 1 || (value.durationMs as number) > SATELLITE_LIMITS.maxDurationMs) {
    return { ok: false, reason: 'durationMs must be an integer from 1 through 2000.' }
  }
  let rawBytes: number
  try { rawBytes = pcm16Binary(value.pcm16Base64).length }
  catch (cause) { return { ok: false, reason: cause instanceof Error ? cause.message : 'PCM16 audio is invalid.' } }
  const sampleCount = rawBytes / 2
  const expectedDurationMs = Math.round(sampleCount / (value.sampleRate as number) * 1000)
  if (expectedDurationMs !== value.durationMs) return { ok: false, reason: `PCM sample count implies ${expectedDurationMs} ms, which does not match durationMs.` }
  if (value.deviceLabel !== undefined && (typeof value.deviceLabel !== 'string' || value.deviceLabel.length > SATELLITE_LIMITS.maxLabelLength || /[\u0000-\u001f\u007f]/.test(value.deviceLabel))) {
    return { ok: false, reason: 'deviceLabel must be at most 80 printable characters.' }
  }
  if (value.captureBackend !== undefined && value.captureBackend !== 'audio-worklet' && value.captureBackend !== 'script-processor') {
    return { ok: false, reason: 'captureBackend must identify the audio-worklet or script-processor recorder.' }
  }
  let signal: SatelliteCapture['signal']
  if (value.signal !== undefined) {
    if (!value.signal || typeof value.signal !== 'object' || Array.isArray(value.signal)) return { ok: false, reason: 'signal must contain normalized peak, rms and clippedFraction values.' }
    const stats = value.signal as Record<string, unknown>
    if (Object.keys(stats).length !== 3 || !['peak', 'rms', 'clippedFraction'].every(key => typeof stats[key] === 'number' && Number.isFinite(stats[key]) && stats[key] >= 0 && stats[key] <= 1)
      || (stats.rms as number) > (stats.peak as number) + 1e-6) return { ok: false, reason: 'Signal statistics must be finite values from 0 to 1, with rms no greater than peak.' }
    signal = { peak: stats.peak as number, rms: stats.rms as number, clippedFraction: stats.clippedFraction as number }
  }
  let acquisition: AcquisitionMetadata | undefined
  if (value.acquisition !== undefined) {
    const checked = validateAcquisitionMetadata(value.acquisition, {
      sampleRate: value.sampleRate as number,
      sampleCount,
      ...(value.captureBackend === undefined ? {} : { captureBackend: value.captureBackend as string }),
    })
    if (!checked.ok) return { ok: false, reason: checked.reason }
    acquisition = checked.value
  }
  return {
    ok: true,
    value: {
      id: value.id,
      capturedAt: value.capturedAt,
      position: { xM: position.xM, yM: position.yM },
      sampleRate: value.sampleRate as number,
      pcm16Base64: value.pcm16Base64 as string,
      durationMs: value.durationMs as number,
      ...(typeof value.deviceLabel === 'string' ? { deviceLabel: value.deviceLabel } : {}),
      ...(value.captureBackend !== undefined ? { captureBackend: value.captureBackend } : {}),
      ...(signal ? { signal } : {}),
      ...(acquisition ? { acquisition } : {}),
    },
  }
}
