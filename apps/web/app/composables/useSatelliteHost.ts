import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { validateSatelliteCapture, type SatelliteCapture, type SatelliteSessionSnapshot } from '../../../../packages/satellite'
import { createRecordedEchoScan, parseEchoScan } from '../../../../packages/echo-scan'
import type { ProbeBatch } from '../../../../packages/probe-batch'

/** An ephemeral, same-origin phone session. Audio stays out of project autosave. */
export function useSatelliteHost() {
  const token = ref('')
  const expiresAt = ref('')
  const joined = ref(false)
  const deviceLabel = ref('')
  const captures = shallowRef<SatelliteCapture[]>([])
  const batches = shallowRef<ProbeBatch[]>([])
  const busy = ref(false)
  const error = ref('')
  const suggestedOrigins = ref<string[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let disposed = false
  let starting = false
  let controller: AbortController | undefined

  async function request(path: string, init: RequestInit = {}) {
    const currentController = controller, timeoutController = new AbortController()
    const abort = () => timeoutController.abort()
    currentController?.signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 10_000)
    try {
      const response = await fetch(`/api/satellite/${path}`, {
        ...init, cache: 'no-store', signal: timeoutController.signal,
        headers: { 'Content-Type': 'application/json', ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}), ...init.headers },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error ?? (response.status === 404 || response.status === 405
        ? 'Phone pairing needs the satellite server. Run bun run satellite after building the app.' : `Connection failed (${response.status}).`))
      if (!payload || typeof payload !== 'object') throw new Error('The satellite server returned an invalid response.')
      return payload
    } catch (cause) {
      if (timeoutController.signal.aborted && !currentController?.signal.aborted) throw new Error('The satellite server took too long to respond. Check the connection and retry.')
      throw cause
    } finally { clearTimeout(timeout); currentController?.signal.removeEventListener('abort', abort) }
  }

  async function poll(currentGeneration: number) {
    if (disposed || generation !== currentGeneration || !token.value) return
    try {
      const payload = await request('session') as SatelliteSessionSnapshot
      if (disposed || generation !== currentGeneration) return
      if (!Array.isArray(payload.captures) || typeof payload.joined !== 'boolean' || typeof payload.deviceLabel !== 'string') throw new Error('Invalid satellite session data.')
      const validated: SatelliteCapture[] = []
      for (const capture of payload.captures.slice(0, 12)) {
        const result = validateSatelliteCapture(capture)
        if (!result.ok) throw new Error(`A received recording was rejected: ${result.reason}`)
        validated.push(result.value)
      }
      if (payload.captures.length > 12) throw new Error('The satellite returned too many recordings.')
      const batchDocument = parseEchoScan(JSON.stringify(createRecordedEchoScan(validated, [], payload.batches ?? []))).document
      if (batchDocument.mode !== 'recorded') throw new Error('Invalid satellite series data.')
      const validatedBatches = batchDocument.batches ?? []
      joined.value = payload.joined
      deviceLabel.value = payload.deviceLabel
      // Polls return a fresh JSON array. Preserve identity when nothing changed so
      // an in-progress peak review is not reset by every status refresh.
      if (captures.value.length !== validated.length || validated.some((capture, index) => {
        const previous = captures.value[index]
        return !previous || previous.id !== capture.id || previous.capturedAt !== capture.capturedAt
          || previous.pcm16Base64 !== capture.pcm16Base64 || previous.sampleRate !== capture.sampleRate
          || previous.durationMs !== capture.durationMs || previous.position.xM !== capture.position.xM
          || previous.position.yM !== capture.position.yM || previous.deviceLabel !== capture.deviceLabel
          || previous.captureBackend !== capture.captureBackend || previous.signal?.peak !== capture.signal?.peak
          || previous.signal?.rms !== capture.signal?.rms || previous.signal?.clippedFraction !== capture.signal?.clippedFraction
          || JSON.stringify(previous.acquisition) !== JSON.stringify(capture.acquisition)
      })) captures.value = validated
      if (JSON.stringify(batches.value) !== JSON.stringify(validatedBatches)) batches.value = validatedBatches
      error.value = ''
    } catch (cause) {
      if (disposed || generation !== currentGeneration) return
      error.value = cause instanceof Error ? cause.message : 'Could not reach the phone session.'
      // Retain received audio for export, but do not pretend the phone is connected.
      joined.value = false
      return
    }
    timer = setTimeout(() => { void poll(currentGeneration) }, 1200)
  }

  async function start() {
    if (starting || busy.value || disposed) return
    starting = true
    await end()
    if (disposed) { starting = false; return }
    busy.value = true; error.value = ''; controller = new AbortController()
    const currentGeneration = ++generation
    try {
      const payload = await request('sessions', { method: 'POST', body: '{}' })
      if (disposed || generation !== currentGeneration) return
      if (typeof payload.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(payload.token)
        || !Number.isFinite(Date.parse(payload.expiresAt))) throw new Error('Invalid pairing details from the satellite server.')
      token.value = payload.token; expiresAt.value = payload.expiresAt
      captures.value = []; batches.value = []; joined.value = false; deviceLabel.value = ''
      suggestedOrigins.value = Array.isArray(payload.suggestedOrigins) ? payload.suggestedOrigins.filter((value: unknown) => typeof value === 'string') : []
      await poll(currentGeneration)
    } catch (cause) {
      if (!disposed && generation === currentGeneration) error.value = cause instanceof Error ? cause.message : 'Could not start phone pairing.'
    } finally { starting = false; if (generation === currentGeneration) busy.value = false }
  }

  function retry() {
    if (timer) clearTimeout(timer)
    controller?.abort(); controller = new AbortController()
    void poll(++generation)
  }

  async function end() {
    generation++
    if (timer) clearTimeout(timer)
    controller?.abort()
    const retired = token.value
    token.value = ''; joined.value = false; busy.value = false
    if (retired) {
      try { await fetch('/api/satellite/session', { method: 'DELETE', headers: { Authorization: `Bearer ${retired}` }, keepalive: true }) } catch { /* Server expiry also retires abandoned sessions. */ }
    }
  }

  onBeforeUnmount(() => { disposed = true; void end() })
  return { token, expiresAt, joined, deviceLabel, captures, batches, busy, error, suggestedOrigins, start, retry, end }
}
