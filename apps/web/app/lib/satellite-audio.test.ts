import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAcousticSweep, encodePcm16Base64, getCaptureSupport } from './satellite-audio'

type MockProcessor = {
  onaudioprocess: ((event: { inputBuffer: { getChannelData: (channel: number) => Float32Array } }) => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function makeBrowser(getUserMedia: () => Promise<unknown>, order: string[] = [], options: { worklet?: boolean; moduleError?: Error; resumePromise?: Promise<void>; trackSettings?: Record<string, unknown> } = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track], getAudioTracks: () => [{ getSettings: () => options.trackSettings ?? {} }] }
  const requestMicrophone = vi.fn((constraints: unknown) => { order.push('permission'); return getUserMedia() })
  const disconnected = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  let processor: MockProcessor | undefined
  let workletNode: { port: { onmessage: ((event: { data: unknown }) => void) | null; close: ReturnType<typeof vi.fn> }; onprocessorerror: ((event: Event) => void) | null; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; options: unknown } | undefined
  const chirpStarts: number[] = []
  let contextState = 'running'
  const context = {
    sampleRate: 48_000,
    currentTime: 0,
    destination: {},
    get state() { return contextState },
    resume: vi.fn(() => { order.push('resume'); return options.resumePromise ?? Promise.resolve() }),
    close: vi.fn(async () => { contextState = 'closed' }),
    createMediaStreamSource: vi.fn(() => disconnected()),
    createScriptProcessor: vi.fn(() => {
      processor = { ...disconnected(), onaudioprocess: null }
      return processor
    }),
    createGain: vi.fn(() => ({ ...disconnected(), gain: { value: 1 } })),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createBufferSource: vi.fn(() => ({ ...disconnected(), buffer: null, start: vi.fn(), stop: vi.fn() })),
    audioWorklet: options.worklet ? { addModule: vi.fn(async () => { if (options.moduleError) throw options.moduleError }) } : undefined,
  }
  class MockAudioContext {
    constructor() { order.push('context') }
    sampleRate = context.sampleRate
    currentTime = context.currentTime
    destination = context.destination
    get state() { return context.state }
    resume = context.resume
    close = context.close
    createMediaStreamSource = context.createMediaStreamSource
    createScriptProcessor = context.createScriptProcessor
    createGain = context.createGain
    createBuffer = context.createBuffer
    createBufferSource = context.createBufferSource
    audioWorklet = context.audioWorklet
  }
  class MockAudioWorkletNode {
    port = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() }
    onprocessorerror: ((event: Event) => void) | null = null
    connect = vi.fn()
    disconnect = vi.fn()
    options: unknown
    constructor(_context: unknown, _name: string, nodeOptions: unknown) {
      this.options = nodeOptions
      workletNode = this
    }
  }
  const createBufferSource = context.createBufferSource
  context.createBufferSource = vi.fn(() => {
    const source = createBufferSource()
    source.start = vi.fn((when: number) => { chirpStarts.push(when) })
    return source
  })
  MockAudioContext.prototype.createBufferSource = context.createBufferSource

  vi.stubGlobal('window', {
    isSecureContext: true,
    AudioContext: MockAudioContext,
    AudioWorkletNode: options.worklet ? MockAudioWorkletNode : undefined,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: requestMicrophone,
    },
  })

  return { context, stream, track, requestMicrophone, get processor() { return processor }, get workletNode() { return workletNode }, chirpStarts, order }
}

async function flushSetup() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('encodePcm16Base64', () => {
  it('clamps extremes and writes signed PCM16 samples in little-endian order', () => {
    const encoded = encodePcm16Base64(new Float32Array([-1, -2, -0.5, 0, 0.5, 2]))
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const view = new DataView(bytes.buffer)

    expect(bytes).toHaveLength(12)
    expect([0, 2, 4, 6, 8, 10].map(offset => view.getInt16(offset, true)))
      .toEqual([-32768, -32768, -16384, 0, 16384, 32767])
    expect([...bytes.slice(0, 4)]).toEqual([0, 128, 0, 128])
  })
})

describe('captureAcousticSweep', () => {
  it('uses frame-count AudioWorklet capture and preserves the pre-roll before the chirp', async () => {
    const browser = makeBrowser(async () => browser.stream, [], { worklet: true, trackSettings: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, sampleRate: 48_000, channelCount: 1, sampleSize: 16, latency: 0.01, deviceId: 'private-device', groupId: 'private-group' } })
    const resultPromise = captureAcousticSweep()
    await flushSetup()
    expect(browser.context.audioWorklet?.addModule).toHaveBeenCalledWith('/satellite-capture-worklet.js')
    expect(browser.requestMicrophone.mock.calls[0]?.[0]).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
    expect(browser.workletNode).toBeDefined()
    const nodeOptions = browser.workletNode!.options as { processorOptions: { startFrame: number; captureFrames: number } }
    expect(nodeOptions.processorOptions.captureFrames).toBe(33_600)
    expect(browser.chirpStarts[0]).toBe((nodeOptions.processorOptions.startFrame + 4_800) / 48_000)

    const captured = new Float32Array(33_600).fill(0.25)
    browser.workletNode!.port.onmessage!({ data: { type: 'complete', samples: captured.buffer, continuity: { status: 'observed', presentInputFrames: 33_600, missingInputFrames: 0, unobservedFrames: 0, presentZeroFrames: 0, longestPresentZeroRunFrames: 0 } } })
    const result = await resultPromise
    expect(result.backend).toBe('audio-worklet')
    expect(result.samples).toHaveLength(33_600)
    expect(result.samples[0]).toBe(0.25)
    expect(result.signal).toEqual({ peak: 0.25, rms: 0.25, clippedFraction: 0 })
    expect(result.acquisition).toMatchObject({ requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, timing: { precision: 'sample-frame', captureStartFrame: nodeOptions.processorOptions.startFrame, captureFrames: 33_600, chirpFrames: 3_840 }, continuity: { status: 'observed', presentInputFrames: 33_600 } })
    expect(result.acquisition.applied).toEqual({ echoCancellation: false, noiseSuppression: true, autoGainControl: false, sampleRate: 48_000, channelCount: 1, sampleSize: 16, latency: 0.01 })
    expect(browser.workletNode!.port.close).toHaveBeenCalledOnce()
    expect(browser.workletNode!.disconnect).toHaveBeenCalledOnce()
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('falls back to callback capture if the same-origin worklet cannot load', async () => {
    const browser = makeBrowser(async () => browser.stream, [], { worklet: true, moduleError: new Error('CSP/module failure') })
    const resultPromise = captureAcousticSweep()
    await flushSetup()
    expect(browser.processor).toBeDefined()
    browser.processor!.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(33_600).fill(-0.5) } })
    const result = await resultPromise
    expect(result.backend).toBe('script-processor')
    expect(result.samples[0]).toBe(-0.5)
    expect(result.acquisition.timing).toMatchObject({ precision: 'approximate', captureStartFrame: null })
    expect(result.acquisition.continuity).toEqual({ status: 'unavailable' })
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('activates audio before requesting permission, then captures and releases all resources', async () => {
    const browser = makeBrowser(async () => browser.stream)
    const resultPromise = captureAcousticSweep()

    // AudioContext creation and resume must remain in the original click stack.
    expect(browser.order).toEqual(['context', 'resume', 'permission'])
    await flushSetup()
    expect(browser.processor).toBeDefined()
    browser.processor!.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array(33_600).fill(0.25) } })

    const result = await resultPromise
    expect(result.sampleRate).toBe(48_000)
    expect(result.samples).toHaveLength(33_600)
    expect(result.samples[0]).toBe(0.25)
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
    expect(browser.processor?.disconnect).toHaveBeenCalledOnce()
  })

  it('returns promptly when permission is cancelled and stops a stream granted later', async () => {
    let grantPermission!: (stream: unknown) => void
    const pendingPermission = new Promise<unknown>(resolve => { grantPermission = resolve })
    const browser = makeBrowser(() => pendingPermission)
    const controller = new AbortController()
    const resultPromise = captureAcousticSweep({ signal: controller.signal })

    expect(browser.order).toEqual(['context', 'resume', 'permission'])
    controller.abort()
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.context.close).toHaveBeenCalledOnce()

    grantPermission(browser.stream)
    await flushSetup()
    expect(browser.track.stop).toHaveBeenCalledOnce()
  })

  it('announces microphone acquisition and cleans up if the active capture is then hidden/cancelled', async () => {
    const browser = makeBrowser(async () => browser.stream)
    const controller = new AbortController()
    const onMicrophoneReady = vi.fn(() => controller.abort())
    const resultPromise = captureAcousticSweep({ signal: controller.signal, onMicrophoneReady })
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(onMicrophoneReady).toHaveBeenCalledOnce()
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('cleans up audio resources when capture times out', async () => {
    vi.useFakeTimers()
    const browser = makeBrowser(async () => browser.stream)
    const resultPromise = captureAcousticSweep()
    await flushSetup()
    expect(browser.processor).toBeDefined()

    const assertion = expect(resultPromise).rejects.toThrow('Microphone capture timed out')
    await vi.advanceTimersByTimeAsync(2_500)
    await assertion
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
    expect(browser.processor?.disconnect).toHaveBeenCalledOnce()
  })

  it('times out and cleans up if an AudioWorklet never completes its frame window', async () => {
    vi.useFakeTimers()
    const browser = makeBrowser(async () => browser.stream, [], { worklet: true })
    const resultPromise = captureAcousticSweep()
    await flushSetup()
    expect(browser.workletNode).toBeDefined()
    const assertion = expect(resultPromise).rejects.toThrow('Microphone capture timed out')
    await vi.advanceTimersByTimeAsync(2_500)
    await assertion
    expect(browser.workletNode!.port.close).toHaveBeenCalledOnce()
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('cleans up audio resources when capture is aborted after permission', async () => {
    const browser = makeBrowser(async () => browser.stream)
    const controller = new AbortController()
    const resultPromise = captureAcousticSweep({ signal: controller.signal })
    await flushSetup()
    expect(browser.processor).toBeDefined()

    controller.abort()
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
    expect(browser.processor?.disconnect).toHaveBeenCalledOnce()
  })

  it('closes worklet and releases the microphone when a worklet capture is cancelled', async () => {
    const browser = makeBrowser(async () => browser.stream, [], { worklet: true })
    const controller = new AbortController()
    const resultPromise = captureAcousticSweep({ signal: controller.signal })
    await flushSetup()
    expect(browser.workletNode).toBeDefined()
    controller.abort()
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.workletNode!.port.close).toHaveBeenCalledOnce()
    expect(browser.workletNode!.disconnect).toHaveBeenCalledOnce()
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('fails immediately and cleans up when the worklet reports a runtime error', async () => {
    const browser = makeBrowser(async () => browser.stream, [], { worklet: true })
    const resultPromise = captureAcousticSweep()
    await flushSetup()
    browser.workletNode!.onprocessorerror!(new Event('processorerror'))
    await expect(resultPromise).rejects.toThrow('audio worklet stopped unexpectedly')
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('rejects a completed worklet payload that omits continuity counters', async () => {
    const browser = makeBrowser(async () => browser.stream, [], { worklet: true })
    const resultPromise = captureAcousticSweep()
    await flushSetup()
    browser.workletNode!.port.onmessage!({ data: { type: 'complete', samples: new Float32Array(33_600).buffer } })
    await expect(resultPromise).rejects.toThrow('no valid input continuity telemetry')
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
  })

  it('releases an acquired stream if cancellation happens while context resume is pending', async () => {
    let resumeContext!: () => void
    const resumePromise = new Promise<void>(resolve => { resumeContext = resolve })
    const browser = makeBrowser(async () => browser.stream, [], { resumePromise })
    const controller = new AbortController()
    const resultPromise = captureAcousticSweep({ signal: controller.signal })
    await flushSetup()
    controller.abort()
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.track.stop).toHaveBeenCalledOnce()
    expect(browser.context.close).toHaveBeenCalledOnce()
    resumeContext()
  })
})

describe('getCaptureSupport', () => {
  it('explains insecure-context restrictions before the user tries to record', () => {
    vi.stubGlobal('window', { isSecureContext: false, AudioContext: class {} })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
    expect(getCaptureSupport()).toMatchObject({ supported: false, message: expect.stringContaining('HTTPS or localhost') })
  })
})
