import { describe, expect, it } from 'vitest'
import { probeBatchFixture } from '../../../../packages/test-fixtures/probe-batch'
import { decodePcm16Base64 } from '../../../../packages/satellite'
import { parseEchoScan } from '../../../../packages/echo-scan'
import type { AcousticProbeBatch } from './satellite-audio'
import { prepareProbeBatch, serializeProbeBatch } from './probe-batch-capture'

describe('probe series handoff', () => {
  it('snapshots completed PCM and manual context once, preserving partial outcomes and capture IDs for retry', () => {
    const fixture = probeBatchFixture('partial', 2, 'hidden')
    const result: AcousticProbeBatch = {
      sampleRate: 8_000, warmupStartFrame: 10_000, warmupEndFrame: 18_000,
      attempts: fixture.batch.attempts.map(attempt => {
        if (attempt.status !== 'captured') return { ...attempt }
        const source = fixture.captures.find(capture => capture.id === attempt.captureId)!
        return { index: attempt.index, status: 'captured', capturedAt: source.capturedAt, capture: {
          samples: decodePcm16Base64(source.pcm16Base64), sampleRate: source.sampleRate, backend: 'audio-worklet',
          acquisition: source.acquisition!, signal: { peak: 0, rms: 0, clippedFraction: 0 },
        } }
      }),
    }
    let count = 0
    const input = { ...fixture.batch, deviceLabel: 'Synthetic phone', createCaptureId: () => `stable-${++count}` }
    const upload = prepareProbeBatch(result, input)
    const firstBody = JSON.stringify(upload)
    expect(upload.captures.map(capture => capture.id)).toEqual(['stable-1', 'stable-2'])
    expect(upload.batch.attempts.map(attempt => attempt.status)).toEqual(['captured', 'captured', 'interrupted', 'not-started', 'not-started'])
    input.context.heightM = 4
    if (result.attempts[0]?.status === 'captured') result.attempts[0].capture.acquisition.applied.echoCancellation = true
    expect(JSON.stringify(upload)).toBe(firstBody)
    expect(count).toBe(2)
    const document = parseEchoScan(serializeProbeBatch(upload)).document
    expect(document.mode === 'recorded' && document.batches).toEqual([upload.batch])
    expect(document.mode === 'recorded' && document.recordings).toEqual(upload.captures)
  })
})
