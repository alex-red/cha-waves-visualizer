import { inspectEchoSignal } from '../../../../packages/echo-diagnostics'
import { decodePcm16Base64, validateSatelliteCapture, type SatelliteCapture } from '../../../../packages/satellite'

self.onmessage = (event: MessageEvent<{ id: number; captures: SatelliteCapture[] }>) => {
  const { id, captures } = event.data
  try {
    if (!Array.isArray(captures) || captures.length > 12) throw new Error('Too many recordings for one signal check.')
    const results = captures.map(input => {
      const checked = validateSatelliteCapture(input)
      if (!checked.ok) throw new Error(checked.reason)
      const capture = checked.value, samples = decodePcm16Base64(capture.pcm16Base64)
      return { id: capture.id, quality: inspectEchoSignal(samples, capture.sampleRate) }
    })
    self.postMessage({ id, results })
  } catch (cause) { self.postMessage({ id, error: cause instanceof Error ? cause.message : 'Signal check failed.' }) }
}
