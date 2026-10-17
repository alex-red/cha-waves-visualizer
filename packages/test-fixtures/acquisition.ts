import type { AcquisitionMetadata } from '../acquisition'

/** Synthetic provenance for contract/integration tests, never a measured capture. */
export function acquisitionFixture(sampleRate = 8000): AcquisitionMetadata {
  const captureFrames = Math.round(sampleRate * .7)
  return {
    version: 1,
    requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate },
    timing: {
      clock: 'audio-context', precision: 'sample-frame', contextSampleRate: sampleRate,
      captureStartFrame: 10_000, captureFrames,
      scheduledChirpStartFrame: 10_000 + Math.round(sampleRate * .1), chirpFrames: Math.round(sampleRate * .08),
    },
    continuity: { status: 'observed', presentInputFrames: captureFrames, missingInputFrames: 0, unobservedFrames: 0, presentZeroFrames: captureFrames, longestPresentZeroRunFrames: captureFrames },
  }
}
