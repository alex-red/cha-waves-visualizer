/** Versioned microphone acquisition evidence shared by browser code and the Node relay. */

export type AcquisitionAppliedSettings = {
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  sampleRate?: number
  channelCount?: number
  sampleSize?: number
  latency?: number
}

export type AcquisitionContinuity =
  | {
      status: 'observed'
      presentInputFrames: number
      missingInputFrames: number
      unobservedFrames: number
      presentZeroFrames: number
      longestPresentZeroRunFrames: number
    }
  | { status: 'unavailable' }

export type AcquisitionMetadata = {
  version: 1
  requested: {
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
  }
  applied: AcquisitionAppliedSettings
  timing: {
    clock: 'audio-context'
    precision: 'sample-frame' | 'approximate'
    contextSampleRate: number
    captureStartFrame: number | null
    captureFrames: number
    scheduledChirpStartFrame: number
    chirpFrames: number
  }
  continuity: AcquisitionContinuity
}

export type AcquisitionValidationContext = {
  sampleRate: number
  sampleCount: number
  captureBackend?: string
}

export type AcquisitionValidation =
  | { ok: true; value: AcquisitionMetadata }
  | { ok: false; reason: string }

const MEDIA_KEYS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const
const APPLIED_KEYS = [...MEDIA_KEYS, 'sampleRate', 'channelCount', 'sampleSize', 'latency'] as const

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

function safeFrame(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Validate untrusted acquisition evidence without browser or Node runtime dependencies. */
export function validateAcquisitionMetadata(input: unknown, context: AcquisitionValidationContext): AcquisitionValidation {
  const invalid = (reason: string): AcquisitionValidation => ({ ok: false, reason })
  if (!object(input)) return invalid('acquisition must be an object.')
  if (!exactKeys(input, ['version', 'requested', 'applied', 'timing', 'continuity'])) return invalid('acquisition contains an unsupported field.')
  if (input.version !== 1) return invalid('acquisition.version must be 1.')

  if (!object(input.requested) || !exactKeys(input.requested, MEDIA_KEYS)) {
    return invalid('acquisition.requested must contain exactly the three boolean media constraints.')
  }
  const requested = input.requested
  if (!MEDIA_KEYS.every(key => typeof requested[key] === 'boolean')) return invalid('acquisition.requested must contain exactly the three boolean media constraints.')
  if (!object(input.applied) || !exactKeys(input.applied, APPLIED_KEYS)) return invalid('acquisition.applied contains an unsupported field.')
  const applied: AcquisitionAppliedSettings = {}
  for (const key of MEDIA_KEYS) {
    if (input.applied[key] !== undefined) {
      if (typeof input.applied[key] !== 'boolean') return invalid(`acquisition.applied.${key} must be boolean.`)
      applied[key] = input.applied[key] as boolean
    }
  }
  for (const key of ['sampleRate', 'channelCount', 'sampleSize'] as const) {
    const value = input.applied[key]
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > (key === 'sampleRate' ? 384_000 : key === 'channelCount' ? 32 : 64)) {
        return invalid(`acquisition.applied.${key} must be a supported positive integer.`)
      }
      applied[key] = value
    }
  }
  if (input.applied.latency !== undefined) {
    if (typeof input.applied.latency !== 'number' || !Number.isFinite(input.applied.latency) || input.applied.latency < 0 || input.applied.latency > 10) {
      return invalid('acquisition.applied.latency must be from 0 through 10 seconds.')
    }
    applied.latency = input.applied.latency
  }

  if (!object(input.timing) || !exactKeys(input.timing, ['clock', 'precision', 'contextSampleRate', 'captureStartFrame', 'captureFrames', 'scheduledChirpStartFrame', 'chirpFrames'])) {
    return invalid('acquisition.timing contains unsupported or missing fields.')
  }
  const timing = input.timing
  if (timing.clock !== 'audio-context') return invalid('acquisition.timing.clock must be audio-context.')
  if (timing.precision !== 'sample-frame' && timing.precision !== 'approximate') return invalid('acquisition.timing.precision is unsupported.')
  if (!Number.isSafeInteger(timing.contextSampleRate) || (timing.contextSampleRate as number) < 8_000 || (timing.contextSampleRate as number) > 384_000) {
    return invalid('acquisition.timing.contextSampleRate must be an integer from 8000 through 384000 Hz.')
  }
  if (!safeFrame(timing.captureFrames) || timing.captureFrames !== context.sampleCount) return invalid('acquisition.timing.captureFrames must equal the PCM sample count.')
  if (!safeFrame(timing.scheduledChirpStartFrame) || !safeFrame(timing.chirpFrames) || timing.chirpFrames < 1) return invalid('acquisition timing frame counts must be nonnegative safe integers, with a nonempty chirp.')
  if (timing.contextSampleRate !== context.sampleRate) return invalid('acquisition.timing.contextSampleRate must match the recording sampleRate.')
  const expectedChirpFrames = Math.round((timing.contextSampleRate as number) * 0.08)
  const chirpEndFrame = timing.scheduledChirpStartFrame + timing.chirpFrames
  if (timing.chirpFrames !== expectedChirpFrames || !Number.isSafeInteger(chirpEndFrame)) return invalid('the scheduled chirp must span the 80 ms probe with safe frame counts.')

  let continuity: AcquisitionContinuity
  if (!object(input.continuity)) return invalid('acquisition.continuity must be an object.')
  if (input.continuity.status === 'unavailable') {
    if (!exactKeys(input.continuity, ['status'])) return invalid('unavailable acquisition.continuity must contain only status.')
    continuity = { status: 'unavailable' }
  } else if (input.continuity.status === 'observed') {
    const c = input.continuity
    const countKeys = ['status', 'presentInputFrames', 'missingInputFrames', 'unobservedFrames', 'presentZeroFrames', 'longestPresentZeroRunFrames'] as const
    if (!exactKeys(c, countKeys) || !countKeys.slice(1).every(key => safeFrame(c[key]))) return invalid('observed acquisition.continuity must contain safe nonnegative frame counts.')
    if ((c.presentInputFrames as number) + (c.missingInputFrames as number) + (c.unobservedFrames as number) !== timing.captureFrames) return invalid('acquisition continuity counts must sum to captureFrames.')
    if ((c.presentZeroFrames as number) > (c.presentInputFrames as number) || (c.longestPresentZeroRunFrames as number) > (c.presentZeroFrames as number)) return invalid('acquisition present-zero counts cannot exceed present input counts.')
    if (c.presentZeroFrames !== 0 && c.longestPresentZeroRunFrames === 0) return invalid('present zero samples require a nonempty present-zero run.')
    continuity = {
      status: 'observed', presentInputFrames: c.presentInputFrames as number, missingInputFrames: c.missingInputFrames as number,
      unobservedFrames: c.unobservedFrames as number, presentZeroFrames: c.presentZeroFrames as number,
      longestPresentZeroRunFrames: c.longestPresentZeroRunFrames as number,
    }
  } else return invalid('acquisition.continuity.status is unsupported.')

  if (timing.precision === 'sample-frame') {
    if (context.captureBackend !== 'audio-worklet') return invalid('sample-frame timing requires the audio-worklet backend.')
    if (!safeFrame(timing.captureStartFrame)) return invalid('sample-frame timing requires a safe captureStartFrame.')
    if (timing.scheduledChirpStartFrame < timing.captureStartFrame) return invalid('scheduled chirp must not precede captureStartFrame.')
    const captureEndFrame = timing.captureStartFrame + timing.captureFrames
    if (!Number.isSafeInteger(captureEndFrame) || timing.scheduledChirpStartFrame < timing.captureStartFrame || chirpEndFrame > captureEndFrame) {
      return invalid('the complete scheduled chirp must fit within the capture window.')
    }
  } else {
    if (timing.captureStartFrame !== null) return invalid('approximate timing requires captureStartFrame to be null.')
    if (continuity.status !== 'unavailable') return invalid('approximate timing requires unavailable continuity.')
  }

  return {
    ok: true,
    value: {
      version: 1,
      requested: { echoCancellation: requested.echoCancellation as boolean, noiseSuppression: requested.noiseSuppression as boolean, autoGainControl: requested.autoGainControl as boolean },
      applied,
      timing: {
        clock: 'audio-context', precision: timing.precision, contextSampleRate: timing.contextSampleRate as number,
        captureStartFrame: timing.captureStartFrame as number | null, captureFrames: timing.captureFrames as number,
        scheduledChirpStartFrame: timing.scheduledChirpStartFrame as number, chirpFrames: timing.chirpFrames as number,
      },
      continuity,
    },
  }
}
