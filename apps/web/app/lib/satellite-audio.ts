import { generateChirp } from '../../../../packages/echo'
import { validateAcquisitionMetadata, type AcquisitionAppliedSettings, type AcquisitionMetadata } from '../../../../packages/acquisition'
import type { ProbeInterruption } from '../../../../packages/probe-batch'

export type CaptureBackend = 'audio-worklet' | 'script-processor'
export type CaptureSignal = { peak: number; rms: number; clippedFraction: number }
export type AcousticCapture = {
  samples: Float32Array
  sampleRate: number
  backend: CaptureBackend
  signal: CaptureSignal
  acquisition: AcquisitionMetadata
}

const CAPTURE_MS = 700
const MAX_CAPTURE_MS = 1_500
const MIN_SAMPLE_RATE = 8_000
const MAX_SAMPLE_RATE = 96_000
const PRE_ROLL_MS = 100
const WORKLET_URL = '/satellite-capture-worklet.js'
const WORKLET_NAME = 'cha-waves-satellite-capture'
const BATCH_COUNT = 5
const BATCH_WARMUP_MS = 1_000
const BATCH_INTERVAL_MS = 1_000
const BATCH_TIMEOUT_MS = 12_000

export type AcousticProbeBatch = {
  sampleRate: number
  warmupStartFrame: number
  warmupEndFrame: number
  attempts: Array<
    | { index: number; status: 'captured'; capturedAt: string; capture: AcousticCapture }
    | { index: number; status: 'interrupted'; reason: ProbeInterruption }
    | { index: number; status: 'not-started' }
  >
}

type BatchInterruption = ProbeInterruption | undefined

export function getCaptureSupport(): { supported: boolean; message: string } {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return { supported: false, message: 'Microphone capture requires HTTPS or localhost. Pairing can still be completed over HTTP.' }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { supported: false, message: 'This browser does not provide microphone capture. Pairing is still available.' }
  }
  if (!window.AudioContext) {
    return { supported: false, message: 'Web Audio capture is not available in this browser. Pairing is still available.' }
  }
  return { supported: true, message: 'Microphone is available when you choose Record sweep.' }
}

function abortError(): DOMException {
  return new DOMException('Capture cancelled.', 'AbortError')
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(abortError()) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, cause => { cleanup(); reject(cause) })
  })
}

function signalMetrics(samples: Float32Array): CaptureSignal {
  let peak = 0
  let sumSquares = 0
  let clipped = 0
  for (const sample of samples) {
    const magnitude = Math.abs(Number.isFinite(sample) ? sample : 0)
    peak = Math.max(peak, magnitude)
    sumSquares += magnitude * magnitude
    if (magnitude >= 0.999) clipped++
  }
  return { peak: Math.min(1, peak), rms: Math.min(1, Math.sqrt(sumSquares / Math.max(1, samples.length))), clippedFraction: clipped / Math.max(1, samples.length) }
}

function playChirp(context: AudioContext, sampleRate: number, startTime: number) {
  const chirpSamples = generateChirp(sampleRate, 80)
  const chirpBuffer = context.createBuffer(1, chirpSamples.length, sampleRate)
  chirpBuffer.getChannelData(0).set(chirpSamples)
  const chirpSource = context.createBufferSource()
  const chirpGain = context.createGain()
  chirpGain.gain.value = 0.1
  chirpSource.buffer = chirpBuffer
  chirpSource.connect(chirpGain)
  chirpGain.connect(context.destination)
  chirpSource.start(startTime)
  return { chirpSource, chirpGain }
}

function appliedTrackSettings(stream: MediaStream): AcquisitionAppliedSettings {
  const settings = stream.getAudioTracks?.()[0]?.getSettings?.()
  if (!settings) return {}
  const applied: AcquisitionAppliedSettings = {}
  for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const) {
    if (typeof settings[key] === 'boolean') applied[key] = settings[key]
  }
  for (const key of ['sampleRate', 'channelCount', 'sampleSize'] as const) {
    const value = settings[key]
    const maximum = key === 'sampleRate' ? 384_000 : key === 'channelCount' ? 32 : 64
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= maximum) applied[key] = value
  }
  const latency = (settings as MediaTrackSettings & { latency?: unknown }).latency
  if (typeof latency === 'number' && Number.isFinite(latency) && latency >= 0 && latency <= 10) applied.latency = latency
  return applied
}

function validateAcquisition(input: AcquisitionMetadata): AcquisitionMetadata {
  const validation = validateAcquisitionMetadata(input, {
    sampleRate: input.timing.contextSampleRate,
    sampleCount: input.timing.captureFrames,
    captureBackend: input.timing.precision === 'sample-frame' ? 'audio-worklet' : 'script-processor',
  })
  if (!validation.ok) throw new Error(`Invalid microphone acquisition telemetry: ${validation.reason}`)
  return validation.value
}

function waitForModule(context: AudioContext, signal?: AbortSignal): Promise<void> {
  const loading = context.audioWorklet!.addModule(WORKLET_URL)
  if (!signal) return loading
  if (signal.aborted) return Promise.reject(abortError())
  return Promise.race([
    loading,
    new Promise<never>((_, reject) => {
      const onAbort = () => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      loading.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => undefined)
    }),
  ])
}

/**
 * Experimental phone capture. Browser processing constraints are requested off,
 * though the device may still alter audio. AudioWorklet is frame-aligned; the
 * ScriptProcessor fallback has approximate callback timing.
 */
export async function captureAcousticSweep(options: { signal?: AbortSignal; onMicrophoneReady?: () => void } = {}): Promise<AcousticCapture> {
  const { signal, onMicrophoneReady } = options
  const support = getCaptureSupport()
  if (!support.supported) throw new Error(support.message)
  if (signal?.aborted) throw abortError()

  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let worklet: AudioWorkletNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let monitor: GainNode | undefined
  let chirpSource: AudioBufferSourceNode | undefined
  let chirpGain: GainNode | undefined
  let abortHandler: (() => void) | undefined
  let timeoutId: number | undefined
  let acquisition: AcquisitionMetadata | undefined

  try {
    // Keep creation/resume inside the original button gesture, before permission UI.
    context = new window.AudioContext()
    const resumePromise = context.resume()
    void resumePromise.catch(() => undefined)
    const permissionRequest = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    })
    void permissionRequest.then(lateStream => {
      if (signal?.aborted) lateStream.getTracks().forEach(track => track.stop())
    }, () => undefined)
    if (signal) {
      stream = await Promise.race([
        permissionRequest,
        new Promise<never>((_, reject) => {
          const onAbort = () => reject(abortError())
          signal.addEventListener('abort', onAbort, { once: true })
          permissionRequest.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => undefined)
        }),
      ])
    } else stream = await permissionRequest
    if (signal?.aborted) throw abortError()
    onMicrophoneReady?.()
    await waitForAbortable(resumePromise, signal)
    const sampleRate = context.sampleRate
    if (sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
      throw new Error('This device sample rate is outside the supported 8–96 kHz range.')
    }

    const captureFrames = Math.round(sampleRate * CAPTURE_MS / 1_000)
    const samples = new Float32Array(captureFrames)
    const applied = appliedTrackSettings(stream)
    source = context.createMediaStreamSource(stream)
    let settled = false
    let backend: CaptureBackend = 'script-processor'
    let resolveCapture!: (value: AcousticCapture) => void
    let rejectCapture!: (reason: Error) => void
    const capturePromise = new Promise<AcousticCapture>((resolve, reject) => {
      resolveCapture = resolve
      rejectCapture = reject
    })
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
      if (error) rejectCapture(error)
      else if (samples.some(sample => !Number.isFinite(sample))) rejectCapture(new Error('The microphone returned nonfinite samples. This take cannot be preserved as PCM.'))
      else if (!acquisition) rejectCapture(new Error('Microphone acquisition telemetry is unavailable. Try recording again.'))
      else {
        try { resolveCapture({ samples, sampleRate, backend, signal: signalMetrics(samples), acquisition: validateAcquisition(acquisition) }) }
        catch (cause) { rejectCapture(cause instanceof Error ? cause : new Error('Invalid microphone acquisition telemetry.')) }
      }
    }
    abortHandler = () => finish(abortError())
    signal?.addEventListener('abort', abortHandler, { once: true })
    timeoutId = window.setTimeout(() => finish(new Error('Microphone capture timed out. Check microphone access and try again.')), MAX_CAPTURE_MS + 1_000)

    // Prefer frame-count capture. A failed module load falls back to callback capture.
    const workletAvailable = Boolean(context.audioWorklet && typeof window.AudioWorkletNode === 'function')
    if (workletAvailable) {
      try {
        await Promise.race([waitForModule(context, signal), capturePromise.then(() => undefined)])
        if (settled) return await capturePromise
        if (signal?.aborted) throw abortError()
        const leadFrames = Math.ceil((context.currentTime * sampleRate + sampleRate * 0.05) / 128) * 128
        const startFrame = leadFrames + Math.round(sampleRate * PRE_ROLL_MS / 1_000)
        worklet = new window.AudioWorkletNode!(context, WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { startFrame, captureFrames },
        })
        backend = 'audio-worklet'
        const chirpFrames = Math.round(sampleRate * 80 / 1_000)
        acquisition = {
          version: 1,
          requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          applied,
          timing: {
            clock: 'audio-context', precision: 'sample-frame', contextSampleRate: sampleRate,
            captureStartFrame: startFrame, captureFrames,
            scheduledChirpStartFrame: startFrame + Math.round(sampleRate * PRE_ROLL_MS / 1_000), chirpFrames,
          },
          continuity: { status: 'unavailable' },
        }
        worklet.onprocessorerror = () => finish(new Error('The audio worklet stopped unexpectedly. Try recording again.'))
        worklet.port.onmessage = event => {
          const data = event.data as { type?: string; message?: string; samples?: ArrayBuffer; signal?: CaptureSignal; continuity?: AcquisitionMetadata['continuity'] }
          if (data.type === 'error') return finish(new Error(data.message ?? 'The audio worklet could not start. Try again.'))
          if (data.type !== 'complete' || !data.samples || settled) return
          const received = new Float32Array(data.samples)
          if (received.length !== captureFrames) return finish(new Error('The audio worklet returned an incomplete capture. Try again.'))
          if (!data.continuity || data.continuity.status !== 'observed') return finish(new Error('The audio worklet returned no valid input continuity telemetry. Try recording again.'))
          acquisition = { ...acquisition!, continuity: data.continuity }
          samples.set(received)
          finish()
        }
        source.connect(worklet)
        worklet.connect(context.destination)
        const chirpTime = (startFrame + Math.round(sampleRate * PRE_ROLL_MS / 1_000)) / sampleRate
        // Keep 100 ms of recorded room noise before the exact shared chirp.
        const playback = playChirp(context, sampleRate, chirpTime)
        chirpSource = playback.chirpSource
        chirpGain = playback.chirpGain
      } catch (cause) {
        if (settled || (cause instanceof DOMException && cause.name === 'AbortError')) throw cause
        try { worklet?.port.close() } catch { /* already closed */ }
        try { worklet?.disconnect() } catch { /* already disconnected */ }
        worklet = undefined
        backend = 'script-processor'
        acquisition = undefined
      }
    }

    if (!worklet) {
      processor = context.createScriptProcessor(2_048, 1, 1)
      monitor = context.createGain()
      monitor.gain.value = 0
      source.connect(processor)
      processor.connect(monitor)
      monitor.connect(context.destination)
      let written = 0
      const scheduledChirpStartFrame = Math.round(context.currentTime * sampleRate) + Math.round(sampleRate * PRE_ROLL_MS / 1_000)
      acquisition = {
        version: 1,
        requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        applied,
        timing: {
          clock: 'audio-context', precision: 'approximate', contextSampleRate: sampleRate,
          captureStartFrame: null, captureFrames, scheduledChirpStartFrame,
          chirpFrames: Math.round(sampleRate * 80 / 1_000),
        },
        continuity: { status: 'unavailable' },
      }
      processor.onaudioprocess = event => {
        if (settled) return
        const input = event.inputBuffer.getChannelData(0)
        const output = event.outputBuffer?.getChannelData(0)
        output?.fill(0)
        const count = Math.min(input.length, captureFrames - written)
        if (count > 0) samples.set(input.subarray(0, count), written)
        written += count
        if (written >= captureFrames) finish()
      }
      const chirpTime = scheduledChirpStartFrame / sampleRate
      const playback = playChirp(context, sampleRate, chirpTime)
      chirpSource = playback.chirpSource
      chirpGain = playback.chirpGain
    }

    return await capturePromise
  } finally {
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    if (processor) processor.onaudioprocess = null
    if (worklet) {
      worklet.port.onmessage = null
      worklet.onprocessorerror = null
      try { worklet.port.close() } catch { /* already closed */ }
    }
    try { chirpSource?.stop() } catch { /* already stopped */ }
    try { source?.disconnect() } catch { /* already disconnected */ }
    try { processor?.disconnect() } catch { /* already disconnected */ }
    try { worklet?.disconnect() } catch { /* already disconnected */ }
    try { monitor?.disconnect() } catch { /* already disconnected */ }
    try { chirpSource?.disconnect() } catch { /* already disconnected */ }
    try { chirpGain?.disconnect() } catch { /* already disconnected */ }
    stream?.getTracks().forEach(track => track.stop())
    if (context && context.state !== 'closed') await context.close()
  }
}

/** Capture five repeated, frame-aligned probes during one continuous microphone session. */
export async function captureAcousticProbeBatch(options: {
  signal?: AbortSignal
  onMicrophoneReady?: () => void
  onProgress?: (progress: { phase: 'warming' | 'recording'; index: number; total: 5 }) => void
} = {}): Promise<AcousticProbeBatch> {
  const { signal, onMicrophoneReady, onProgress } = options
  const support = getCaptureSupport()
  if (!support.supported) throw new Error(support.message)
  if (signal?.aborted) throw abortError()

  let context: AudioContext | undefined
  let stream: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let silentGain: GainNode | undefined
  let signalHandler: (() => void) | undefined
  let visibilityHandler: (() => void) | undefined
  let stateHandler: (() => void) | undefined
  let endedTracks: MediaStreamTrack[] = []
  const endedHandler = () => stopFor('microphone-ended')
  let timeoutId: number | undefined
  let contextStateWasRunning = false
  let interruption: BatchInterruption
  let interrupt!: (reason: ProbeInterruption) => void
  const interrupted = new Promise<ProbeInterruption>(resolve => { interrupt = resolve })
  const interruptionListeners = new Set<(reason: ProbeInterruption) => void>()
  const attempts: AcousticProbeBatch['attempts'] = []
  let warmupStartFrame = 0
  let warmupEndFrame = 0
  let warmed = false
  let readyForWarmup = false
  let activeNode: AudioWorkletNode | undefined
  let activeChirp: AudioBufferSourceNode | undefined
  let activeChirpGain: GainNode | undefined

  const stopFor = (reason: ProbeInterruption) => {
    if (interruption) return
    interruption = reason
    interrupt(reason)
    for (const listener of [...interruptionListeners]) listener(reason)
  }
  const reasonForAbort = (): ProbeInterruption => signal?.reason === 'hidden' ? 'hidden' : 'cancelled'
  const cleanupActive = () => {
    if (activeNode) {
      activeNode.port.onmessage = null
      activeNode.onprocessorerror = null
      try { activeNode.port.close() } catch { /* already closed */ }
      try { activeNode.disconnect() } catch { /* already disconnected */ }
      activeNode = undefined
    }
    try { activeChirp?.stop() } catch { /* already stopped */ }
    try { activeChirp?.disconnect() } catch { /* already disconnected */ }
    try { activeChirpGain?.disconnect() } catch { /* already disconnected */ }
    activeChirp = undefined
    activeChirpGain = undefined
  }
  const waitForFrame = async (frame: number) => {
    while (context && Math.floor(context.currentTime * context.sampleRate) < frame) {
      if (interruption) throw new Error(interruption)
      await new Promise<void>((resolve, reject) => {
        const finish = (reason?: ProbeInterruption) => {
          window.clearTimeout(timer)
          interruptionListeners.delete(onInterrupt)
          if (reason) reject(new Error(reason))
          else resolve()
        }
        const onInterrupt = (reason: ProbeInterruption) => finish(reason)
        const timer = window.setTimeout(() => finish(), 10)
        interruptionListeners.add(onInterrupt)
        if (interruption) finish(interruption)
      })
    }
    if (interruption) throw new Error(interruption)
  }
  const waitForWindow = (capture: AcousticCapture, frames: number, index: number, startFrame: number): Promise<{ capture: AcousticCapture; capturedAt: string }> => new Promise((resolve, reject) => {
    if (!context || !source) return reject(new Error('Audio context was not ready.'))
    const audioContext = context
    const inputSource = source
    const node = new window.AudioWorkletNode!(audioContext, WORKLET_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { startFrame, captureFrames: frames },
    })
    activeNode = node
    node.onprocessorerror = () => { cleanupActive(); reject(new Error('The audio worklet stopped unexpectedly.')) }
    node.port.onmessage = event => {
      const data = event.data as { type?: string; message?: string; samples?: ArrayBuffer; continuity?: AcquisitionMetadata['continuity'] }
      if (data.type === 'error') { cleanupActive(); reject(new Error(data.message ?? 'The audio worklet could not start.')) }
      if (data.type !== 'complete') return
      if (!data.samples || !data.continuity || data.continuity.status !== 'observed') {
        cleanupActive()
        reject(new Error('The audio worklet returned incomplete capture telemetry.'))
        return
      }
      const samples = new Float32Array(data.samples)
      if (samples.length !== frames || samples.some(sample => !Number.isFinite(sample))) {
        cleanupActive()
        reject(new Error('The audio worklet returned invalid samples.'))
        return
      }
      try {
        const acquisition = validateAcquisition({
          ...capture.acquisition,
          timing: { ...capture.acquisition.timing, captureStartFrame: startFrame },
          continuity: data.continuity,
        })
        cleanupActive()
        // Bridge the AudioContext frame clock back to UTC at callback receipt,
        // subtracting callback delay so the timestamp describes the first frame.
        const frameAgeMs = Math.max(0, (audioContext.currentTime - startFrame / audioContext.sampleRate) * 1_000)
        resolve({ capture: { ...capture, samples, acquisition, signal: signalMetrics(samples) }, capturedAt: new Date(Date.now() - frameAgeMs).toISOString() })
      } catch (cause) {
        cleanupActive()
        reject(cause instanceof Error ? cause : new Error('Invalid microphone acquisition telemetry.'))
      }
    }
    try {
      inputSource.connect(node)
      node.connect(audioContext.destination)
      const chirpStartFrame = startFrame + Math.round(audioContext.sampleRate * PRE_ROLL_MS / 1_000)
      const playback = playChirp(audioContext, audioContext.sampleRate, chirpStartFrame / audioContext.sampleRate)
      activeChirp = playback.chirpSource
      activeChirpGain = playback.chirpGain
    } catch (cause) {
      cleanupActive()
      reject(cause instanceof Error ? cause : new Error(`Probe ${index} could not start.`))
    }
  })

  try {
    // Both calls happen synchronously in the initiating button stack.
    context = new window.AudioContext()
    const resumePromise = context.resume()
    void resumePromise.catch(() => undefined)
    const permissionRequest = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
    })
    void permissionRequest.then(lateStream => { if (signal?.aborted || interruption) lateStream.getTracks().forEach(track => track.stop()) }, () => undefined)
    timeoutId = window.setTimeout(() => stopFor('timeout'), BATCH_TIMEOUT_MS)
    signalHandler = () => stopFor(reasonForAbort())
    signal?.addEventListener('abort', signalHandler, { once: true })
    visibilityHandler = () => { if (document.visibilityState === 'hidden') stopFor('hidden') }
    document.addEventListener('visibilitychange', visibilityHandler)
    stateHandler = () => {
      const state = context?.state
      if (state === 'running') contextStateWasRunning = true
      else if (contextStateWasRunning) stopFor('audio-context')
    }
    context.addEventListener('statechange', stateHandler)
    const permissionOrInterrupt = await Promise.race([
      permissionRequest.then(value => ({ stream: value })),
      interrupted.then(reason => ({ reason })),
    ])
    if ('reason' in permissionOrInterrupt) throw new Error(permissionOrInterrupt.reason === 'timeout' ? 'Microphone permission timed out before batch setup completed.' : 'Microphone permission was interrupted before batch setup completed.')
    stream = permissionOrInterrupt.stream
    if (interruption) throw new Error(`Microphone setup was interrupted (${interruption}).`)
    endedTracks = stream.getAudioTracks()
    for (const track of endedTracks) track.addEventListener('ended', endedHandler, { once: true })
    if (endedTracks.some(track => track.readyState === 'ended')) stopFor('microphone-ended')
    onMicrophoneReady?.()
    await Promise.race([resumePromise, interrupted.then(reason => { throw new Error(reason) })])
    if (!context || context.state !== 'running') throw new Error('Audio context did not start running.')
    contextStateWasRunning = true
    const sampleRate = context.sampleRate
    if (sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) throw new Error('This device sample rate is outside the supported 8–96 kHz range.')
    if (!context.audioWorklet || typeof window.AudioWorkletNode !== 'function') throw new Error('Repeated capture requires AudioWorklet support on this device.')
    await Promise.race([context.audioWorklet.addModule(WORKLET_URL), interrupted.then(reason => { throw new Error(reason) })])
    if (interruption) throw new Error(`Audio setup was interrupted (${interruption}).`)
    source = context.createMediaStreamSource(stream)
    silentGain = context.createGain()
    silentGain.gain.value = 0
    source.connect(silentGain)
    silentGain.connect(context.destination)

    const applied = appliedTrackSettings(stream)
    const startNow = Math.floor(context.currentTime * sampleRate)
    warmupStartFrame = startNow
    readyForWarmup = true
    onProgress?.({ phase: 'warming', index: 1, total: 5 })
    await waitForFrame(startNow + Math.round(sampleRate * BATCH_WARMUP_MS / 1_000))
    warmupEndFrame = Math.floor(context.currentTime * sampleRate)
    warmed = true

    const captureFrames = Math.ceil(sampleRate * CAPTURE_MS / 1_000)
    const chirpFrames = Math.round(sampleRate * 80 / 1_000)
    const baseAcquisition: AcquisitionMetadata = {
      version: 1,
      requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      applied,
      timing: { clock: 'audio-context', precision: 'sample-frame', contextSampleRate: sampleRate, captureStartFrame: null, captureFrames, scheduledChirpStartFrame: 0, chirpFrames },
      continuity: { status: 'unavailable' },
    }
    const leadFrames = Math.round(sampleRate * 0.1)
    const alignFrame = (frame: number) => Math.ceil(frame / 128) * 128
    let nextStartFrame = warmupEndFrame
    for (let index = 1; index <= BATCH_COUNT; index++) {
      if (interruption) {
        attempts.push({ index, status: 'interrupted', reason: interruption })
        break
      }
      onProgress?.({ phase: 'recording', index, total: 5 })
      try {
        // Create and connect the worklet before its first input quantum. Waiting
        // to the target itself would make the beginning of every window unknown.
        const scheduleLeadStart = Math.max(Math.floor(context.currentTime * sampleRate), nextStartFrame - leadFrames)
        await waitForFrame(scheduleLeadStart)
        const captureStartFrame = Math.max(nextStartFrame, alignFrame(Math.floor(context.currentTime * sampleRate) + leadFrames))
        const acquisition = validateAcquisition({
          ...baseAcquisition,
          timing: { ...baseAcquisition.timing, captureStartFrame, scheduledChirpStartFrame: captureStartFrame + Math.round(sampleRate * PRE_ROLL_MS / 1_000) },
        })
        const capture: AcousticCapture = { samples: new Float32Array(captureFrames), sampleRate, backend: 'audio-worklet', signal: { peak: 0, rms: 0, clippedFraction: 0 }, acquisition }
        const result = await Promise.race([
          waitForWindow(capture, captureFrames, index, captureStartFrame),
          interrupted.then(reason => { throw new Error(reason) }),
        ])
        attempts.push({ index, status: 'captured', capturedAt: result.capturedAt, capture: result.capture })
        nextStartFrame = captureStartFrame + Math.round(sampleRate * BATCH_INTERVAL_MS / 1_000)
      } catch (cause) {
        const reason = interruption ?? 'capture-error'
        attempts.push({ index, status: 'interrupted', reason })
        break
      }
    }
    while (attempts.length < BATCH_COUNT) attempts.push({ index: attempts.length + 1, status: 'not-started' })
    return { sampleRate, warmupStartFrame, warmupEndFrame, attempts }
  } catch (cause) {
    if (readyForWarmup) {
      const reason = interruption ?? 'capture-error'
      if (!attempts.length) attempts.push({ index: 1, status: 'interrupted', reason })
      while (attempts.length < BATCH_COUNT) attempts.push({ index: attempts.length + 1, status: 'not-started' })
      if (!warmed && context) warmupEndFrame = Math.floor(context.currentTime * context.sampleRate)
      return { sampleRate: context?.sampleRate ?? 0, warmupStartFrame, warmupEndFrame, attempts }
    }
    throw cause instanceof Error ? cause : new Error('Repeated microphone capture could not be set up.')
  } finally {
    cleanupActive()
    if (signal && signalHandler) signal.removeEventListener('abort', signalHandler)
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
    if (context && stateHandler) context.removeEventListener('statechange', stateHandler)
    for (const track of endedTracks) track.removeEventListener('ended', endedHandler)
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    try { source?.disconnect() } catch { /* already disconnected */ }
    try { silentGain?.disconnect() } catch { /* already disconnected */ }
    stream?.getTracks().forEach(track => track.stop())
    if (context && context.state !== 'closed') await context.close()
  }
}

export function encodePcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(index * 2, value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), true)
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}
