import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type Payload = {
  type: string
  samples?: ArrayBuffer
  continuity?: {
    status: string
    presentInputFrames: number
    missingInputFrames: number
    unobservedFrames: number
    presentZeroFrames: number
    longestPresentZeroRunFrames: number
  }
}

function loadProcessor() {
  const source = readFileSync(new URL('../../public/satellite-capture-worklet.js', import.meta.url), 'utf8')
  let Processor: (new (options: unknown) => { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean; samples: Float32Array; port: { postMessage: ReturnType<typeof vi.fn> } }) | undefined
  const sandbox = {
    currentFrame: 0,
    AudioWorkletProcessor: class { port = { postMessage: vi.fn() } },
    registerProcessor: vi.fn((_name: string, definition: typeof Processor) => { Processor = definition }),
  }
  runInNewContext(source, sandbox)
  expect(sandbox.registerProcessor).toHaveBeenCalledWith('cha-waves-satellite-capture', expect.any(Function))
  if (!Processor) throw new Error('The capture processor was not registered.')
  return { Processor, sandbox }
}

describe('satellite capture worklet', () => {
  it('preserves exact samples and separates present zero, missing and unobserved frames', () => {
    const { Processor, sandbox } = loadProcessor()
    const processor = new Processor({ processorOptions: { startFrame: 3, captureFrames: 20 } })
    const outputs = [new Float32Array(8).fill(1)]
    processor.process([[new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])]], [outputs])
    expect([...outputs[0]!]).toEqual(Array(8).fill(0))

    sandbox.currentFrame = 8
    processor.process([[new Float32Array(8)]], [[new Float32Array(8)]])
    sandbox.currentFrame = 20 // Frames 16–19 in the requested window had no callback.
    processor.process([[new Float32Array([0.9, 0.8])]], [[new Float32Array(8)]])

    const [payload, transfer] = processor.port.postMessage.mock.calls[0] as [Payload, ArrayBuffer[]]
    expect(processor.port.postMessage).toHaveBeenCalledOnce()
    expect(payload.type).toBe('complete')
    expect([...new Float32Array(payload.samples!)].map(value => Number(value.toFixed(5)))).toEqual([
      0.4, 0.5, 0.6, 0.7, 0.8,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0,
      0.9, 0.8, 0,
    ])
    expect(payload.continuity).toEqual({
      status: 'observed', presentInputFrames: 15, missingInputFrames: 1, unobservedFrames: 4,
      presentZeroFrames: 8, longestPresentZeroRunFrames: 8,
    })
    expect(transfer).toEqual([payload.samples])
  })

  it('uses output quantum length when input is absent, accounts for short input, and completes late first callbacks', () => {
    const { Processor, sandbox } = loadProcessor()
    const processor = new Processor({ processorOptions: { startFrame: 5, captureFrames: 10 } })
    sandbox.currentFrame = 12
    const output = [new Float32Array(4).fill(1)]
    processor.process([], [output])
    expect([...output[0]!]).toEqual([0, 0, 0, 0])
    const [payload] = processor.port.postMessage.mock.calls[0] as [Payload]
    expect(payload.type).toBe('complete')
    expect([...new Float32Array(payload.samples!)]).toEqual(Array(10).fill(0))
    expect(payload.continuity).toEqual({
      status: 'observed', presentInputFrames: 0, missingInputFrames: 3, unobservedFrames: 7,
      presentZeroFrames: 0, longestPresentZeroRunFrames: 0,
    })
  })

  it('counts absent and short input within the capture window and preserves the present prefix', () => {
    const { Processor, sandbox } = loadProcessor()
    const processor = new Processor({ processorOptions: { startFrame: 0, captureFrames: 12 } })
    processor.process([[]], [[new Float32Array(8)]])
    sandbox.currentFrame = 8
    processor.process([[new Float32Array([0.25, 0.5])]], [[new Float32Array(8)]])
    const [payload] = processor.port.postMessage.mock.calls[0] as [Payload]
    expect([...new Float32Array(payload.samples!)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0.5, 0, 0])
    expect(payload.continuity).toEqual({
      status: 'observed', presentInputFrames: 2, missingInputFrames: 10, unobservedFrames: 0,
      presentZeroFrames: 0, longestPresentZeroRunFrames: 0,
    })
  })

  it('keeps the coverage cursor stable when an older duplicate callback arrives', () => {
    const { Processor, sandbox } = loadProcessor()
    const processor = new Processor({ processorOptions: { startFrame: 0, captureFrames: 12 } })
    sandbox.currentFrame = 4
    processor.process([[new Float32Array([4, 5, 6, 7])]], [[new Float32Array(4)]])
    sandbox.currentFrame = 2
    processor.process([[new Float32Array([2, 3, 4, 5])]], [[new Float32Array(4)]])
    sandbox.currentFrame = 8
    processor.process([[new Float32Array([8, 9, 10, 11])]], [[new Float32Array(4)]])

    const [payload] = processor.port.postMessage.mock.calls[0] as [Payload]
    expect([...new Float32Array(payload.samples!)]).toEqual([0, 0, 0, 0, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(payload.continuity).toEqual({
      status: 'observed', presentInputFrames: 8, missingInputFrames: 0, unobservedFrames: 4,
      presentZeroFrames: 0, longestPresentZeroRunFrames: 0,
    })
  })

  it('rejects non-finite microphone samples once and keeps output silent', () => {
    const { Processor } = loadProcessor()
    const processor = new Processor({ processorOptions: { startFrame: 0, captureFrames: 8 } })
    const output = [new Float32Array(8).fill(1)]
    processor.process([[new Float32Array([0.1, Number.NaN, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])]], [output])
    expect([...output[0]!]).toEqual(Array(8).fill(0))
    expect(processor.port.postMessage).toHaveBeenCalledOnce()
    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Microphone input contained a non-finite sample.' })
    processor.process([[new Float32Array(8)]], [[new Float32Array(8).fill(1)]])
    expect(processor.port.postMessage).toHaveBeenCalledOnce()
  })

  it('rejects a capture window whose frame end overflows safe integer bounds', () => {
    const { Processor } = loadProcessor()
    const processor = new Processor({ processorOptions: { startFrame: Number.MAX_SAFE_INTEGER, captureFrames: 1 } })
    processor.process([], [[new Float32Array(128)]])
    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Invalid capture frame bounds.' })
  })
})
