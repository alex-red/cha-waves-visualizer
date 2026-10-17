/** Shared, erasable contract for a repeated-probe batch. */
import type { SatelliteCapture } from './satellite.ts'

export type ProbeContext = {
  heightM: number
  orientation: 'screen-up' | 'screen-down' | 'upright'
  headingDeg: number
  speakerVolumePercent: number
}

export type ProbeInterruption = 'cancelled' | 'hidden' | 'microphone-ended' | 'audio-context' | 'capture-error' | 'timeout'

export type ProbeAttempt =
  | { index: number; status: 'captured'; captureId: string }
  | { index: number; status: 'interrupted'; reason: ProbeInterruption }
  | { index: number; status: 'not-started' }

export type ProbeBatch = {
  version: 1
  id: string
  startedAt: string
  endedAt: string
  position: { xM: number; yM: number }
  context: ProbeContext
  playbackGain: 0.1
  plannedProbeCount: 5
  warmupMs: 1000
  probeIntervalMs: 1000
  sampleRate: number
  warmupStartFrame: number
  warmupEndFrame: number
  attempts: ProbeAttempt[]
}

export type ProbeBatchValidation = { ok: true; value: ProbeBatch } | { ok: false; reason: string }

const BATCH_KEYS = ['version', 'id', 'startedAt', 'endedAt', 'position', 'context', 'playbackGain', 'plannedProbeCount', 'warmupMs', 'probeIntervalMs', 'sampleRate', 'warmupStartFrame', 'warmupEndFrame', 'attempts'] as const
const CONTEXT_KEYS = ['heightM', 'orientation', 'headingDeg', 'speakerVolumePercent'] as const
const CAPTURED_KEYS = ['index', 'status', 'captureId'] as const
const INTERRUPTED_KEYS = ['index', 'status', 'reason'] as const
const NOT_STARTED_KEYS = ['index', 'status'] as const
const INTERRUPTIONS: readonly ProbeInterruption[] = ['cancelled', 'hidden', 'microphone-ended', 'audio-context', 'capture-error', 'timeout']

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function printableId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeFrame(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function utcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
}

/** Validate and canonicalize a batch against the recordings it references. */
export function validateProbeBatch(input: unknown, recordings: readonly SatelliteCapture[]): ProbeBatchValidation {
  const invalid = (reason: string): ProbeBatchValidation => ({ ok: false, reason })
  if (!object(input)) return invalid('Batch must be an object.')
  if (!hasExactKeys(input, BATCH_KEYS)) return invalid('Batch contains unsupported or missing fields.')
  if (input.version !== 1) return invalid('Batch version must be 1.')
  if (!printableId(input.id)) return invalid('Batch id must contain 1–128 printable characters.')
  if (!utcTimestamp(input.startedAt) || !utcTimestamp(input.endedAt) || Date.parse(input.endedAt) < Date.parse(input.startedAt)) return invalid('Batch timestamps must be UTC ISO values with endedAt no earlier than startedAt.')
  if (!object(input.position) || !hasExactKeys(input.position, ['xM', 'yM']) || !finite(input.position.xM) || !finite(input.position.yM) || Math.abs(input.position.xM) > 1_000_000 || Math.abs(input.position.yM) > 1_000_000) return invalid('Batch position must contain finite xM and yM metre coordinates.')
  if (!object(input.context) || !hasExactKeys(input.context, CONTEXT_KEYS)) return invalid('Batch context contains unsupported or missing fields.')
  const context = input.context
  if (!finite(context.heightM) || context.heightM < 0 || context.heightM > 5) return invalid('context.heightM must be from 0 through 5 metres.')
  if (context.orientation !== 'screen-up' && context.orientation !== 'screen-down' && context.orientation !== 'upright') return invalid('context.orientation is unsupported.')
  if (!finite(context.headingDeg) || context.headingDeg < 0 || context.headingDeg >= 360) return invalid('context.headingDeg must be from 0 through 360 degrees, excluding 360.')
  if (!Number.isInteger(context.speakerVolumePercent) || (context.speakerVolumePercent as number) < 0 || (context.speakerVolumePercent as number) > 100) return invalid('context.speakerVolumePercent must be an integer from 0 through 100.')
  if (input.playbackGain !== 0.1 || input.plannedProbeCount !== 5 || input.warmupMs !== 1000 || input.probeIntervalMs !== 1000) return invalid('Batch playback gain, probe count, warmup and interval must match the version 1 protocol.')
  if (!Number.isInteger(input.sampleRate) || (input.sampleRate as number) < 8_000 || (input.sampleRate as number) > 96_000) return invalid('sampleRate must be an integer from 8000 through 96000 Hz.')
  const sampleRate = input.sampleRate as number
  if (!safeFrame(input.warmupStartFrame) || !safeFrame(input.warmupEndFrame) || input.warmupEndFrame < input.warmupStartFrame) return invalid('Warmup frames must be safe and ordered.')
  if (!Array.isArray(input.attempts) || input.attempts.length !== 5) return invalid('Batch must contain exactly five attempts.')

  const attempts: ProbeAttempt[] = []
  let interrupted = false
  let notStarted = false
  const referenced = new Set<string>()
  let previousEnd = -1
  let previousStart = -1
  let hasCapturedAttempt = false
  for (let i = 0; i < input.attempts.length; i += 1) {
    const raw = input.attempts[i]
    if (!object(raw) || !Number.isInteger(raw.index) || raw.index !== i + 1) return invalid('Attempts must be ordered and indexed from 1 through 5.')
    if (raw.status === 'captured') {
      hasCapturedAttempt = true
      if (!hasExactKeys(raw, CAPTURED_KEYS) || interrupted || notStarted || !printableId(raw.captureId)) return invalid(`attempts[${i}] is not a valid captured attempt in a completed prefix.`)
      if (referenced.has(raw.captureId)) return invalid('A capture id may be referenced only once in a batch.')
      referenced.add(raw.captureId)
      const capture = recordings.find(item => item.id === raw.captureId)
      if (!capture) return invalid(`attempts[${i}] refers to missing capture "${raw.captureId}".`)
      if (capture.position.xM !== input.position.xM || capture.position.yM !== input.position.yM || capture.sampleRate !== sampleRate) return invalid(`Capture "${raw.captureId}" must match the batch position and sample rate.`)
      const acquisition = capture.acquisition
      if (capture.captureBackend !== 'audio-worklet' || !acquisition || acquisition.timing.precision !== 'sample-frame' || !safeFrame(acquisition.timing.captureStartFrame)) return invalid(`Capture "${raw.captureId}" requires audio-worklet sample-frame acquisition telemetry.`)
      const timing = acquisition.timing
      const captureStart = timing.captureStartFrame as number
      const captureEnd = captureStart + timing.captureFrames
      if (!Number.isSafeInteger(captureEnd) || captureStart < (input.warmupEndFrame as number) || captureStart < previousEnd || (previousStart >= 0 && captureStart - previousStart < sampleRate)) return invalid(`Capture "${raw.captureId}" must start after warmup with ordered, nonoverlapping windows at least one second apart.`)
      if (timing.captureFrames !== Math.round(sampleRate * 0.7)) return invalid(`Capture "${raw.captureId}" must contain exactly 700 ms of PCM.`)
      if (timing.scheduledChirpStartFrame - captureStart !== Math.round(sampleRate * 0.1)) return invalid(`Capture "${raw.captureId}" must place the 80 ms probe 100 ms after capture start.`)
      previousEnd = captureEnd
      previousStart = captureStart
      attempts.push({ index: i + 1, status: 'captured', captureId: raw.captureId })
    } else if (raw.status === 'interrupted') {
      if (!hasExactKeys(raw, INTERRUPTED_KEYS) || interrupted || notStarted || typeof raw.reason !== 'string' || !INTERRUPTIONS.includes(raw.reason as ProbeInterruption)) return invalid(`attempts[${i}] is not a valid interruption.`)
      interrupted = true
      attempts.push({ index: i + 1, status: 'interrupted', reason: raw.reason as ProbeInterruption })
    } else if (raw.status === 'not-started') {
      if (!hasExactKeys(raw, NOT_STARTED_KEYS) || !interrupted) return invalid(`attempts[${i}] may be not-started only after an interruption.`)
      notStarted = true
      attempts.push({ index: i + 1, status: 'not-started' })
    } else return invalid(`attempts[${i}].status is unsupported.`)
  }
  if (hasCapturedAttempt && (input.warmupEndFrame as number) - (input.warmupStartFrame as number) < sampleRate) return invalid('A batch with captured probes requires at least one second of warmup frames.')
  if (attempts.some(attempt => attempt.status !== 'captured') && !interrupted) return invalid('An incomplete batch requires an interruption attempt.')
  return {
    ok: true,
    value: {
      version: 1, id: input.id, startedAt: input.startedAt, endedAt: input.endedAt,
      position: { xM: input.position.xM, yM: input.position.yM },
      context: { heightM: context.heightM, orientation: context.orientation, headingDeg: context.headingDeg, speakerVolumePercent: context.speakerVolumePercent as number },
      playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000,
      sampleRate, warmupStartFrame: input.warmupStartFrame, warmupEndFrame: input.warmupEndFrame,
      attempts,
    },
  }
}
