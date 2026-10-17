import type { AcousticProbeBatch } from './satellite-audio'
import { encodePcm16Base64 } from './satellite-audio'
import { validateProbeBatch, type ProbeBatch, type ProbeContext } from '../../../../packages/probe-batch'
import type { SatelliteCapture } from '../../../../packages/satellite'
import { createRecordedEchoScan, parseEchoScan, serializeEchoScan } from '../../../../packages/echo-scan'

export type ProbeBatchUpload = { batch: ProbeBatch; captures: SatelliteCapture[] }

/** Create the immutable upload once; retrying must preserve IDs, audio and context. */
export function prepareProbeBatch(result: AcousticProbeBatch, input: {
  id: string; startedAt: string; endedAt: string; position: { xM: number; yM: number }
  context: ProbeContext; deviceLabel: string; createCaptureId: () => string
}): ProbeBatchUpload {
  const captures: SatelliteCapture[] = []
  const attempts = result.attempts.map(attempt => {
    if (attempt.status !== 'captured') return { ...attempt }
    const capture = attempt.capture
    const id = input.createCaptureId()
    captures.push({
      id, capturedAt: attempt.capturedAt, position: { ...input.position },
      sampleRate: capture.sampleRate, durationMs: Math.round(capture.samples.length * 1000 / capture.sampleRate),
      pcm16Base64: encodePcm16Base64(capture.samples), captureBackend: capture.backend,
      signal: capture.signal, acquisition: capture.acquisition, deviceLabel: input.deviceLabel,
    })
    return { index: attempt.index, status: 'captured' as const, captureId: id }
  })
  const checked = validateProbeBatch({
    version: 1, id: input.id, startedAt: input.startedAt, endedAt: input.endedAt,
    position: { ...input.position }, context: { ...input.context },
    playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000,
    sampleRate: result.sampleRate, warmupStartFrame: result.warmupStartFrame,
    warmupEndFrame: result.warmupEndFrame, attempts,
  }, captures)
  if (!checked.ok) throw new Error(`The probe series could not be preserved: ${checked.reason}`)
  const normalized = parseEchoScan(JSON.stringify(createRecordedEchoScan(captures, [], [checked.value]))).document
  if (normalized.mode !== 'recorded' || !normalized.batches?.[0]) throw new Error('The probe series could not be preserved.')
  return { batch: normalized.batches[0], captures: normalized.recordings }
}

export function serializeProbeBatch(upload: ProbeBatchUpload): string {
  return serializeEchoScan(createRecordedEchoScan(upload.captures, [], [upload.batch]))
}
