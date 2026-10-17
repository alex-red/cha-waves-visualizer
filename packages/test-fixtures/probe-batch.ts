import type { ProbeBatch, ProbeInterruption } from '../probe-batch'
import type { SatelliteCapture } from '../satellite'
import { acquisitionFixture } from './acquisition'

/** Synthetic silent probes for protocol/workflow tests; never physical evidence. */
export function probeBatchFixture(id = 'series-fixture', capturedCount = 5, reason: ProbeInterruption = 'cancelled'): { batch: ProbeBatch; captures: SatelliteCapture[] } {
  const captures = Array.from({ length: capturedCount }, (_, index): SatelliteCapture => {
    const acquisition = acquisitionFixture()
    const start = 20_000 + index * 8_000
    acquisition.timing.captureStartFrame = start
    acquisition.timing.scheduledChirpStartFrame = start + 800
    return {
      id: `${id}-probe-${index + 1}`, capturedAt: `2026-01-01T00:00:0${index + 1}.000Z`,
      position: { xM: 1, yM: 2 }, sampleRate: 8_000, durationMs: 700,
      pcm16Base64: btoa('\0'.repeat(11_200)), captureBackend: 'audio-worklet', acquisition,
    }
  })
  const batch: ProbeBatch = {
    version: 1, id, startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:07.000Z',
    position: { xM: 1, yM: 2 }, context: { heightM: 1.2, orientation: 'screen-up', headingDeg: 0, speakerVolumePercent: 50 },
    playbackGain: .1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000, sampleRate: 8_000,
    warmupStartFrame: 10_000, warmupEndFrame: 18_000,
    attempts: Array.from({ length: 5 }, (_, index) => index < capturedCount
      ? { index: index + 1, status: 'captured', captureId: captures[index]!.id }
      : index === capturedCount ? { index: index + 1, status: 'interrupted', reason } : { index: index + 1, status: 'not-started' }),
  }
  return { batch, captures }
}
