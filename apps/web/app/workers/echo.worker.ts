import { extractEchoPeaks } from '../../../../packages/echo'
import { decodePcm16Base64, validateSatelliteCapture, type SatelliteCapture } from '../../../../packages/satellite'

self.onmessage = (event: MessageEvent<{ id: number; captures: SatelliteCapture[] }>) => {
  const { id, captures } = event.data
  try {
    if (!Array.isArray(captures) || captures.length > 12) throw new Error('Too many recordings for one analysis.')
    const results = captures.map(input => {
      const checked = validateSatelliteCapture(input)
      if (!checked.ok) throw new Error(checked.reason)
      const capture = checked.value, samples = decodePcm16Base64(capture.pcm16Base64)
      // Preserve capture-clock offsets. A weak direct path can fall below the
      // threshold, so the UI must explicitly identify the timing reference.
      const peaks = extractEchoPeaks(samples, capture.sampleRate, { maxPeaks: 16, thresholdRatio: 0.08, minimumSpacingMs: 1.5, relativeToFirstPeak: false })
      return { id: capture.id, peaks }
    })
    self.postMessage({ id, results })
  } catch (cause) { self.postMessage({ id, error: cause instanceof Error ? cause.message : 'Recording analysis failed.' }) }
}
