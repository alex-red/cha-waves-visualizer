import { describe, expect, it } from 'vitest'
import { extractEchoPeaks, generateChirp, reconstructEchoRoom, simulateEchoCaptures, type EchoPosition } from './echo'

const positions: EchoPosition[] = [
  { xM: 1.3, yM: 1.1 },
  { xM: 2.4, yM: 2.2 },
  { xM: 3.7, yM: 1.8 },
  { xM: 1.8, yM: 3.4 },
  { xM: 3.1, yM: 3.0 },
]

describe('echo room reconstruction', () => {
  it('recovers a rectangular room from unlabeled noiseless arrivals at multiple poses', () => {
    const room = { widthM: 5.2, depthM: 4.6 }
    const captures = simulateEchoCaptures(room, positions)
    expect(captures.every(capture => capture.arrivalTimesMs.length === 4)).toBe(true)
    const result = reconstructEchoRoom(captures)
    expect(result.status).toBe('ok')
    expect(result.room?.widthM).toBeCloseTo(room.widthM, 2)
    expect(result.room?.depthM).toBeCloseTo(room.depthM, 2)
    expect(result.rmsResidualMs).toBeLessThan(0.01)
    expect(result.echoCount).toBe(20)
  })

  it('estimates all four walls when the room is translated away from the origin', () => {
    const room = { widthM: 5.2, depthM: 4.6, originXM: -3.5, originYM: 7.25 }
    const translated = positions.map(p => ({ xM: p.xM - 3.5, yM: p.yM + 7.25 }))
    const result = reconstructEchoRoom(simulateEchoCaptures(room, translated))
    expect(result.status).toBe('ok')
    expect(result.room?.widthM).toBeCloseTo(room.widthM, 2)
    expect(result.room?.depthM).toBeCloseTo(room.depthM, 2)
    expect(result.room?.originXM).toBeCloseTo(room.originXM!, 2)
    expect(result.room?.originYM).toBeCloseTo(room.originYM!, 2)
  })

  it('keeps the estimate close with reproducible timing noise', () => {
    const room = { widthM: 5.2, depthM: 4.6 }
    const captures = simulateEchoCaptures(room, positions, { seed: 1729, timingNoiseStdMs: 0.08 })
    expect(captures).toEqual(simulateEchoCaptures(room, positions, { seed: 1729, timingNoiseStdMs: 0.08 }))
    const result = reconstructEchoRoom(captures)
    expect(result.status).toBe('ok')
    expect(result.room?.widthM).toBeCloseTo(room.widthM, 1)
    expect(result.room?.depthM).toBeCloseTo(room.depthM, 1)
    expect(result.rmsResidualMs).toBeLessThan(0.3)
  })

  it('keeps consistent residuals with either three or five non-collinear poses, including equal wall distances', () => {
    const room = { widthM: 5.2, depthM: 4.6 }
    const three = reconstructEchoRoom(simulateEchoCaptures(room, positions.slice(0, 3)))
    const five = reconstructEchoRoom(simulateEchoCaptures(room, positions))
    expect(three.status).toBe('ok')
    expect(five.status).toBe('ok')
    expect(three.rmsResidualMs).toBeLessThan(0.001)
    expect(five.rmsResidualMs).toBeLessThan(0.001)
    expect(three.room?.widthM).toBeCloseTo(five.room?.widthM ?? 0, 3)
    expect(three.room?.depthM).toBeCloseTo(five.room?.depthM ?? 0, 3)

    const equalDistancePositions = [{ xM: 2.6, yM: 2.3 }, ...positions]
    const captures = simulateEchoCaptures(room, equalDistancePositions)
    expect(captures[0]!.arrivalTimesMs[0]).toBe(captures[0]!.arrivalTimesMs[1])
    const equalDistanceFit = reconstructEchoRoom(captures)
    expect(equalDistanceFit.status).toBe('ok')
    expect(equalDistanceFit.room?.widthM).toBeCloseTo(room.widthM, 3)
    expect(equalDistanceFit.room?.depthM).toBeCloseTo(room.depthM, 3)
  })

  it('reports insufficient, malformed, and out-of-bounds data', () => {
    expect(reconstructEchoRoom([]).status).toBe('insufficient-data')
    expect(reconstructEchoRoom(simulateEchoCaptures({ widthM: 5.2, depthM: 4.6 }, positions).slice(0, 2)).status).toBe('insufficient-data')
    expect(reconstructEchoRoom([
      { position: { xM: Number.NaN, yM: 1 }, arrivalTimesMs: [10, 20, 30, 40] },
      { position: { xM: 2, yM: 1 }, arrivalTimesMs: [10, 20] },
      { position: { xM: 2, yM: 2 }, arrivalTimesMs: [10, 20] },
    ]).status).toBe('invalid-data')
    const captures = simulateEchoCaptures({ widthM: 5.2, depthM: 4.6 }, positions)
    expect(reconstructEchoRoom(captures, { minDimensionM: 8, maxDimensionM: 10 }).status).toBe('no-solution')
  })

  it('rejects repeated or collinear poses and inconsistent four-echo captures', () => {
    const room = { widthM: 5.2, depthM: 4.6 }
    const repeated = simulateEchoCaptures(room, [positions[0]!, positions[0]!, positions[0]!])
    expect(reconstructEchoRoom(repeated).status).toBe('insufficient-data')
    const collinear = simulateEchoCaptures(room, [{ xM: 1, yM: 1 }, { xM: 2, yM: 2 }, { xM: 3, yM: 3 }])
    expect(reconstructEchoRoom(collinear).status).toBe('insufficient-data')
    const inconsistent = simulateEchoCaptures(room, positions)
    inconsistent[0]!.arrivalTimesMs[0] = 100
    const result = reconstructEchoRoom(inconsistent)
    expect(result.status).toBe('no-solution')
  })
})

describe('chirp matched filter', () => {
  it('generates a bounded, windowed chirp and finds delayed copies in PCM', () => {
    const sampleRate = 16000
    const chirp = generateChirp(sampleRate)
    expect(chirp.length).toBe(1280)
    expect(Math.abs(chirp[0]!)).toBeLessThan(1e-6)
    expect(Math.abs(chirp.at(-1)!)).toBeLessThan(1e-5)

    const pcm = new Float32Array(sampleRate * 0.4)
    const addAt = (offset: number, amplitude: number) => {
      for (let i = 0; i < chirp.length; i++) pcm[offset + i] = pcm[offset + i]! + chirp[i]! * amplitude
    }
    addAt(sampleRate * 0.05, 0.8)
    addAt(sampleRate * 0.15, 0.3)
    const peaks = extractEchoPeaks(pcm, sampleRate)
    expect(peaks.length).toBe(2)
    expect(peaks[0]!.delayMs).toBeCloseTo(0, 1)
    expect(peaks[1]!.delayMs).toBeCloseTo(100, 1)
    expect(peaks[0]!.strength).toBeGreaterThan(peaks[1]!.strength)
  })

  it('handles a phone-length 700 ms capture at 48 kHz with bounded FFT matching', () => {
    const sampleRate = 48000, chirp = generateChirp(sampleRate), pcm = new Float32Array(sampleRate * 0.7)
    for (let i = 0; i < chirp.length; i++) pcm[sampleRate * 0.1 + i] = chirp[i]! * 0.7
    const peaks = extractEchoPeaks(pcm, sampleRate)
    expect(peaks.length).toBe(1)
    expect(peaks[0]!.delayMs).toBe(0)
    expect(() => extractEchoPeaks(new Float32Array(sampleRate * 2 + 1), sampleRate)).toThrow(/two seconds/)
  })

  it('accepts signed PCM16 buffers directly', () => {
    const sampleRate = 16000, chirp = generateChirp(sampleRate), pcm = new Int16Array(sampleRate * 0.25), offset = 2400
    for (let i = 0; i < chirp.length; i++) pcm[offset + i] = Math.round(chirp[i]! * 24000)
    const peaks = extractEchoPeaks(pcm, sampleRate)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]!.delayMs).toBe(0)
  })
})
