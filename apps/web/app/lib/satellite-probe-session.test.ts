import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAcousticProbeBatch, encodePcm16Base64 } from './satellite-audio'
import { validateProbeBatch } from '../../../../packages/probe-batch'
import type { SatelliteCapture } from '../../../../packages/satellite'

function setup(getUserMedia?: () => Promise<MediaStream>, alreadyEnded = false) {
  vi.useFakeTimers()
  const tracks = new EventTarget() as MediaStreamTrack
  Object.assign(tracks, { stop: vi.fn(), getSettings: () => ({}), readyState: alreadyEnded ? 'ended' : 'live' })
  const stream = { getTracks: () => [tracks], getAudioTracks: () => [tracks] } as unknown as MediaStream
  let clockOrigin = Date.now()
  let state = 'running'
  const context = new EventTarget() as AudioContext
  Object.assign(context, {
    sampleRate: 8_000,
    destination: {},
    get currentTime() { return (Date.now() - clockOrigin) / 1_000 },
    get state() { return state },
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => { state = 'closed' }),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
    createBuffer: vi.fn((_channels: number, size: number) => ({ getChannelData: () => new Float32Array(size) })),
    createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
    audioWorklet: { addModule: vi.fn(async () => undefined) },
  })
  Object.defineProperty(context, 'currentTime', { configurable: true, get: () => (Date.now() - clockOrigin) / 1_000 })
  Object.defineProperty(context, 'state', { configurable: true, get: () => state })
  const optionsSeen: Array<{ startFrame: number; captureFrames: number }> = []
  class MockAudioWorkletNode extends EventTarget {
    port = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() }
    onprocessorerror: ((event: Event) => void) | null = null
    connect = vi.fn()
    disconnect = vi.fn()
    constructor(_context: AudioContext, _name: string, nodeOptions: AudioWorkletNodeOptions) {
      super()
      const bounds = nodeOptions.processorOptions as { startFrame: number; captureFrames: number }
      optionsSeen.push(bounds)
      const remainingMs = Math.max(0, (bounds.startFrame + bounds.captureFrames) / context.sampleRate * 1_000 - (Date.now() - clockOrigin))
      setTimeout(() => this.port.onmessage?.({ data: {
        type: 'complete',
        samples: new Float32Array(bounds.captureFrames).fill(optionsSeen.length / 10).buffer,
        continuity: { status: 'observed', presentInputFrames: bounds.captureFrames, missingInputFrames: 0, unobservedFrames: 0, presentZeroFrames: 0, longestPresentZeroRunFrames: 0 },
      } } as MessageEvent), remainingMs)
    }
  }
  class MockAudioContext extends EventTarget {
    constructor() { super(); clockOrigin = Date.now(); return context as unknown as MockAudioContext }
  }
  vi.stubGlobal('window', { isSecureContext: true, AudioContext: MockAudioContext, AudioWorkletNode: MockAudioWorkletNode, setTimeout, clearTimeout })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(getUserMedia ?? (async () => stream)) } })
  const documentTarget = new EventTarget()
  Object.defineProperty(documentTarget, 'visibilityState', { configurable: true, value: 'visible' })
  vi.stubGlobal('document', documentTarget)
  return {
    context, tracks, optionsSeen,
    stream,
    hide: () => { Object.defineProperty(documentTarget, 'visibilityState', { configurable: true, value: 'hidden' }); documentTarget.dispatchEvent(new Event('visibilitychange')) },
    suspend: () => { state = 'suspended'; context.dispatchEvent(new Event('statechange')) },
    closeContext: () => { state = 'closed'; context.dispatchEvent(new Event('statechange')) },
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('captureAcousticProbeBatch', () => {
  it('keeps one microphone session and frame clock across five warmup-separated windows', async () => {
    const browser = setup()
    const resultPromise = captureAcousticProbeBatch()
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(browser.context.audioWorklet.addModule).toHaveBeenCalledOnce()
    expect(browser.optionsSeen).toHaveLength(5)
    expect(browser.optionsSeen[0]?.startFrame).toBe(8_832)
    for (let index = 1; index < browser.optionsSeen.length; index++) {
      expect(browser.optionsSeen[index]!.startFrame - browser.optionsSeen[index - 1]!.startFrame).toBeGreaterThanOrEqual(8_000)
    }
    expect(batch.warmupEndFrame).toBeLessThanOrEqual(browser.optionsSeen[0]!.startFrame)
    expect(batch.warmupEndFrame - batch.warmupStartFrame).toBeGreaterThanOrEqual(8_000)
    expect(batch.attempts.map(item => item.status)).toEqual(Array(5).fill('captured'))
    expect(batch.attempts[0]).toMatchObject({ capture: { backend: 'audio-worklet', samples: expect.any(Float32Array) }, capturedAt: expect.any(String) })
    expect((batch.attempts[4] as { capture: { samples: Float32Array } }).capture.samples[0]).toBe(0.5)
    const captures: SatelliteCapture[] = batch.attempts.map((attempt, index) => ({
      id: `capture-${index + 1}`,
      capturedAt: attempt.status === 'captured' ? attempt.capturedAt : '',
      position: { xM: 0, yM: 0 },
      sampleRate: batch.sampleRate,
      pcm16Base64: encodePcm16Base64((attempt as { capture: { samples: Float32Array } }).capture.samples),
      durationMs: 700,
      captureBackend: 'audio-worklet',
      signal: (attempt as { capture: { signal: { peak: number; rms: number; clippedFraction: number } } }).capture.signal,
      acquisition: (attempt as { capture: { acquisition: SatelliteCapture['acquisition'] } }).capture.acquisition!,
    }))
    expect(validateProbeBatch({
      version: 1, id: 'batch-1', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      position: { xM: 0, yM: 0 }, context: { heightM: 1, orientation: 'screen-up', headingDeg: 0, speakerVolumePercent: 50 },
      playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1_000, probeIntervalMs: 1_000,
      sampleRate: batch.sampleRate, warmupStartFrame: batch.warmupStartFrame, warmupEndFrame: batch.warmupEndFrame,
      attempts: batch.attempts.map((attempt, index) => ({ index: index + 1, status: 'captured', captureId: `capture-${index + 1}` })),
    }, captures).ok).toBe(true)
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('preserves completed captures and indexes the interruption and unstarted tail', async () => {
    const browser = setup()
    const controller = new AbortController()
    const resultPromise = captureAcousticProbeBatch({ signal: controller.signal, onProgress: progress => { if (progress.phase === 'recording' && progress.index === 3) controller.abort() } })
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(batch.attempts.map(item => item.status)).toEqual(['captured', 'captured', 'interrupted', 'not-started', 'not-started'])
    expect(batch.attempts[2]).toEqual({ index: 3, status: 'interrupted', reason: 'cancelled' })
    expect((batch.attempts[1] as { capture: { samples: Float32Array } }).capture.samples[0]).toBeCloseTo(0.2)
    const starts = batch.attempts.slice(0, 2).map(attempt => (attempt as { capture: { acquisition: { timing: { captureStartFrame: number } } } }).capture.acquisition.timing.captureStartFrame)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(8_000)
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
  })

  it('returns the active index as interrupted when the page becomes hidden during warmup', async () => {
    const browser = setup()
    const resultPromise = captureAcousticProbeBatch({ onProgress: progress => { if (progress.phase === 'warming') browser.hide() } })
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(batch.attempts[0]).toEqual({ index: 1, status: 'interrupted', reason: 'hidden' })
    expect(batch.attempts.slice(1).every(item => item.status === 'not-started')).toBe(true)
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
  })

  it('turns a running-context suspension into a partial batch', async () => {
    const browser = setup()
    const resultPromise = captureAcousticProbeBatch({ onProgress: progress => { if (progress.phase === 'recording' && progress.index === 1) browser.suspend() } })
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(batch.attempts[0]).toEqual({ index: 1, status: 'interrupted', reason: 'audio-context' })
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('treats an AudioContext that closes after running as an interruption', async () => {
    const browser = setup()
    const resultPromise = captureAcousticProbeBatch({ onProgress: progress => { if (progress.phase === 'recording' && progress.index === 1) browser.closeContext() } })
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(batch.attempts[0]).toEqual({ index: 1, status: 'interrupted', reason: 'audio-context' })
    expect(browser.context.state).toBe('closed')
  })

  it('marks a track that ends during the active probe as interrupted', async () => {
    const browser = setup()
    const resultPromise = captureAcousticProbeBatch({ onProgress: progress => { if (progress.phase === 'recording' && progress.index === 1) browser.tracks.dispatchEvent(new Event('ended')) } })
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(batch.attempts[0]).toEqual({ index: 1, status: 'interrupted', reason: 'microphone-ended' })
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
  })

  it('detects a microphone track that was already ended before its listener was attached', async () => {
    const browser = setup(undefined, true)
    await expect(captureAcousticProbeBatch()).rejects.toThrow('microphone-ended')
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
    expect(browser.optionsSeen).toHaveLength(0)
  })

  it('returns a timeout interruption after warmup if the audio clock stops advancing', async () => {
    const browser = setup()
    Object.defineProperty(browser.context, 'currentTime', { configurable: true, get: () => 0 })
    const resultPromise = captureAcousticProbeBatch()
    await vi.runAllTimersAsync()
    const batch = await resultPromise
    expect(batch.attempts[0]).toEqual({ index: 1, status: 'interrupted', reason: 'timeout' })
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('rejects promptly while permission is pending and stops a stream granted later', async () => {
    let grant!: (stream: MediaStream) => void
    const permission = new Promise<MediaStream>(resolve => { grant = resolve })
    const browser = setup(() => permission)
    const controller = new AbortController()
    const resultPromise = captureAcousticProbeBatch({ signal: controller.signal })
    controller.abort()
    await expect(resultPromise).rejects.toThrow('permission was interrupted')
    grant(browser.stream)
    await Promise.resolve()
    expect(browser.tracks.stop).toHaveBeenCalledOnce()
  })
})
