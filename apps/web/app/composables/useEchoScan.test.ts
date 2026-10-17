import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecordedEchoScan, parseEchoScan, serializeEchoScan } from '../../../../packages/echo-scan'
import type { EchoPeak } from '../../../../packages/echo'
import type { SatelliteCapture } from '../../../../packages/satellite'
import { acquisitionFixture } from '../../../../packages/test-fixtures/acquisition'
import { probeBatchFixture } from '../../../../packages/test-fixtures/probe-batch'
import { useEchoScan } from './useEchoScan'

function capture(id: string, changes: Partial<SatelliteCapture> = {}): SatelliteCapture {
  return {
    id,
    capturedAt: '2026-10-15T12:30:00.000Z',
    position: { xM: 2, yM: 3.5 },
    sampleRate: 8_000,
    pcm16Base64: btoa(String.fromCharCode(...new Array(16).fill(0))),
    durationMs: 1,
    deviceLabel: 'Phone',
    ...changes,
  }
}

const peaks: EchoPeak[] = [0, 6, 12, 18, 24, 180, 190].map((delayMs, index) => ({ delayMs, strength: 1 / (index + 1) }))

function completeReview(scan: ReturnType<typeof useEchoScan>, id: string, values = peaks) {
  expect(scan.setPeaks(id, values)).toBe(true)
  expect(scan.setDirect(id, 0)).toBe(true)
  for (const index of [1, 2, 3, 4]) expect(scan.toggleWall(id, index)).toBe(true)
}

afterEach(() => vi.restoreAllMocks())

describe('useEchoScan', () => {
  it('installs probe outcomes with their recordings atomically and preserves them through export/restore', () => {
    const scan = useEchoScan(), fixture = probeBatchFixture('complete')
    expect(scan.mergeRecordings(fixture.captures, [fixture.batch])).toBe(true)
    completeReview(scan, fixture.captures[0]!.id)
    const stable = scan.recordings.value, stableBatches = scan.batches.value
    expect(scan.mergeRecordings(fixture.captures, [fixture.batch])).toBe(true)
    expect(scan.recordings.value).toBe(stable)
    expect(scan.batches.value).toBe(stableBatches)
    expect(scan.mergeRecordings([capture('orphan')], [{ ...fixture.batch, context: { ...fixture.batch.context, heightM: 1.5 } }])).toBe(false)
    expect(scan.recordings.value).toBe(stable)
    expect(scan.error.value).toContain('changed metadata')
    expect(scan.removeRecording(fixture.captures[0]!.id)).toBe(false)
    const restored = useEchoScan()
    restored.installRecordedScan(parseEchoScan(serializeEchoScan(scan.document())).document)
    expect(restored.batches.value).toEqual([fixture.batch])
    expect(restored.reviews.value[fixture.captures[0]!.id]?.wallPeakIndices).toEqual([1, 2, 3, 4])
    scan.clear()
    expect(scan.mergeRecordings(fixture.captures, [fixture.batch])).toBe(true)
    expect(scan.batches.value).toEqual([])
    expect(scan.recordings.value).toEqual([])
  })

  it('retains a stopped series with no captured audio and rejects broken capture links without appending audio', () => {
    const scan = useEchoScan(), partial = probeBatchFixture('stopped', 0, 'hidden')
    expect(scan.mergeRecordings([], [partial.batch])).toBe(true)
    expect(scan.batches.value[0]?.attempts[0]).toMatchObject({ status: 'interrupted', reason: 'hidden' })
    const invalid = probeBatchFixture('invalid')
    expect(scan.mergeRecordings([invalid.captures[0]], [invalid.batch])).toBe(false)
    expect(scan.recordings.value).toEqual([])
    expect(scan.batches.value).toEqual([partial.batch])
    const parsed = parseEchoScan(serializeEchoScan(scan.document())).document
    expect(parsed.mode === 'recorded' && parsed.batches).toEqual([partial.batch])
  })
  it('retains canonical acquisition evidence and rejects changed same-id telemetry without resetting reviews', () => {
    const scan = useEchoScan()
    const acquisition = acquisitionFixture()
    const original = capture('instrumented', { captureBackend: 'audio-worklet', durationMs: 700, pcm16Base64: btoa('\0'.repeat(11_200)), acquisition })
    expect(scan.mergeRecordings([original])).toBe(true)
    completeReview(scan, original.id)
    const stable = scan.recordings.value
    const reordered = { ...acquisition, requested: { autoGainControl: false, noiseSuppression: false, echoCancellation: false } }
    expect(scan.mergeRecordings([{ ...original, acquisition: reordered }])).toBe(true)
    expect(scan.recordings.value).toBe(stable)
    const changed = { ...acquisition, applied: { ...acquisition.applied, echoCancellation: true } }
    expect(scan.mergeRecordings([{ ...original, acquisition: changed }])).toBe(false)
    expect(scan.recordings.value).toBe(stable)
    expect(scan.reviews.value[original.id]?.wallPeakIndices).toEqual([1, 2, 3, 4])
    const restored = useEchoScan()
    restored.installRecordedScan(parseEchoScan(serializeEchoScan(scan.document())).document)
    expect(restored.recordings.value[0]?.acquisition).toEqual(acquisition)
    expect(restored.reviews.value[original.id]?.wallPeakIndices).toEqual([1, 2, 3, 4])
  })
  it('merges idempotent polling snapshots without replacing captures or resetting review state', () => {
    const scan = useEchoScan(), first = capture('capture-1')
    expect(scan.mergeRecordings([first])).toBe(true)
    expect(scan.activeCaptureId.value).toBe('capture-1')
    completeReview(scan, 'capture-1')
    const stableArray = scan.recordings.value, stableCapture = scan.recordings.value[0]
    expect(scan.mergeRecordings([{ ...first, position: { ...first.position } }])).toBe(true)
    expect(scan.recordings.value).toBe(stableArray)
    expect(scan.recordings.value[0]).toBe(stableCapture)
    expect(scan.readyCaptures.value).toHaveLength(1)
    expect(scan.readyCaptures.value[0]?.capture.arrivalTimesMs).toEqual([6, 12, 18, 24])

    expect(scan.mergeRecordings([capture('capture-2')])).toBe(true)
    expect(scan.activeCaptureId.value).toBe('capture-1')
    expect(scan.reviews.value['capture-1']?.wallPeakIndices).toEqual([1, 2, 3, 4])
  })

  it('rejects changed same-id data transactionally while keeping earlier recordings and review intact', () => {
    const scan = useEchoScan(), original = capture('capture-1')
    scan.mergeRecordings([original])
    completeReview(scan, original.id)
    const before = scan.recordings.value
    const changed = capture(original.id, { pcm16Base64: btoa(String.fromCharCode(...new Array(16).fill(1))) })
    expect(scan.mergeRecordings([capture('capture-2'), changed])).toBe(false)
    expect(scan.error.value).toMatch(/changed audio or metadata/)
    expect(scan.recordings.value).toBe(before)
    expect(scan.recordings.value.map(item => item.id)).toEqual(['capture-1'])
    expect(scan.readyCaptures.value).toHaveLength(1)
  })

  it('treats capture backend and signal metadata changes as same-id collisions', () => {
    const scan = useEchoScan(), original = capture('capture-1', { captureBackend: 'audio-worklet', signal: { peak: 0.8, rms: 0.2, clippedFraction: 0 } })
    scan.mergeRecordings([original])
    expect(scan.mergeRecordings([capture('capture-1', { ...original, signal: { peak: 0.9, rms: 0.2, clippedFraction: 0 } })])).toBe(false)
    expect(scan.recordings.value[0]?.signal?.peak).toBe(0.8)
    expect(scan.mergeRecordings([capture('capture-1', { ...original, captureBackend: 'script-processor' })])).toBe(false)
  })

  it('enforces a 12-recording cap and requires explicit removal before accepting another', () => {
    const scan = useEchoScan(), batch = Array.from({ length: 12 }, (_, index) => capture(`capture-${index + 1}`))
    expect(scan.mergeRecordings(batch)).toBe(true)
    const before = scan.recordings.value
    expect(scan.mergeRecordings([capture('capture-13')])).toBe(false)
    expect(scan.recordings.value).toBe(before)
    expect(scan.recordings.value).toHaveLength(12)
    expect(scan.error.value).toMatch(/Export or remove/)
    expect(scan.removeRecording('capture-1')).toBe(true)
    expect(scan.mergeRecordings([capture('capture-13')])).toBe(true)
    expect(scan.recordings.value).toHaveLength(12)
    // A later cumulative server poll cannot silently restore the explicitly removed capture.
    expect(scan.mergeRecordings(batch)).toBe(true)
    expect(scan.recordings.value.map(item => item.id)).not.toContain('capture-1')
  })

  it('resets only the review whose peak analysis changed and guards incomplete/invalid selections', () => {
    const scan = useEchoScan()
    scan.mergeRecordings([capture('capture-1'), capture('capture-2')])
    completeReview(scan, 'capture-1')
    completeReview(scan, 'capture-2')
    expect(scan.readyCaptures.value).toHaveLength(2)
    expect(scan.setPeaks('capture-1', [...peaks].reverse())).toBe(false)
    expect(scan.reviews.value['capture-1']?.peaks).toEqual(peaks)
    expect(scan.setPeaks('capture-1', peaks)).toBe(true)
    expect(scan.readyCaptures.value).toHaveLength(2)

    expect(scan.setPeaks('capture-1', peaks.map(peak => ({ ...peak, strength: peak.strength * 2 })))).toBe(true)
    expect(scan.reviews.value['capture-1']).toMatchObject({ directPeakIndex: null, wallPeakIndices: [] })
    expect(scan.reviews.value['capture-2']?.wallPeakIndices).toEqual([1, 2, 3, 4])
    expect(scan.readyCaptures.value.map(item => item.captureId)).toEqual(['capture-2'])

    expect(scan.setPeaks('capture-1', peaks)).toBe(true)
    expect(scan.setDirect('capture-1', 99)).toBe(false)
    expect(scan.setDirect('capture-1', 0)).toBe(true)
    expect(scan.toggleWall('capture-1', 0)).toBe(false)
    expect(scan.toggleWall('capture-1', 5)).toBe(false)
    for (const index of [1, 2, 3, 4]) expect(scan.toggleWall('capture-1', index)).toBe(true)
    expect(scan.toggleWall('capture-1', 5)).toBe(false)
    expect(scan.readyCaptures.value).toHaveLength(2)
  })

  it('keeps selection stable as recordings arrive, then selects a neighbor when the active one is removed', () => {
    const scan = useEchoScan()
    scan.mergeRecordings([capture('capture-1'), capture('capture-2')])
    expect(scan.activeCaptureId.value).toBe('capture-1')
    scan.selectRecording('capture-2')
    scan.mergeRecordings([capture('capture-3')])
    expect(scan.activeCaptureId.value).toBe('capture-2')
    expect(scan.removeRecording('capture-2')).toBe(true)
    expect(scan.activeCaptureId.value).toBe('capture-3')
    expect(scan.removeRecording('capture-3')).toBe(true)
    expect(scan.activeCaptureId.value).toBe('capture-1')
    scan.clear()
    expect(scan.recordings.value).toEqual([])
    expect(scan.reviews.value).toEqual({})
    expect(scan.activeCaptureId.value).toBeNull()
  })

  it('installs a validated recorded document and round-trips raw audio with stable id-linked reviews', () => {
    const source = useEchoScan()
    source.mergeRecordings([capture('capture-1')])
    completeReview(source, 'capture-1')
    const serialized = serializeEchoScan(source.document())
    const parsed = parseEchoScan(serialized)
    expect(parsed.document.mode).toBe('recorded')
    const restored = useEchoScan()
    restored.installRecordedScan(parsed.document)
    expect(restored.recordings.value).toEqual(source.recordings.value)
    expect(restored.reviews.value['capture-1']).toEqual(source.reviews.value['capture-1'])
    expect(restored.readyCaptures.value).toEqual(source.readyCaptures.value)

    const before = restored.recordings.value
    const invalid = createRecordedEchoScan([capture('capture-1')], [{
      captureId: 'capture-1', peaks, directPeakIndex: 0, wallPeakIndices: [1, 2, 3, 5],
    }])
    expect(() => restored.installRecordedScan(invalid)).toThrow(/within 175 ms/)
    expect(restored.recordings.value).toBe(before)
  })

  it('does not install reviews that reference missing recordings or accept malformed PCM', () => {
    const scan = useEchoScan()
    expect(scan.mergeRecordings([capture('bad', { pcm16Base64: 'nope' })])).toBe(false)
    expect(scan.recordings.value).toEqual([])
    expect(() => scan.installRecordedScan(createRecordedEchoScan([capture('capture-1')], [{
      captureId: 'missing', peaks, directPeakIndex: 0, wallPeakIndices: [1, 2, 3, 4],
    }]))).toThrow(/missing capture/)
    expect(scan.recordings.value).toEqual([])
  })

  it('safely stores prototype-named capture ids and round-trips their independent reviews', () => {
    const scan = useEchoScan()
    const ids = ['__proto__', 'constructor', 'toString']
    const incoming = ids.map((id, index) => capture(id, { position: { xM: index + 1, yM: index + 2 } }))
    expect(scan.mergeRecordings(incoming)).toBe(true)
    expect(Object.getPrototypeOf(scan.reviews.value)).toBeNull()
    for (const id of ids) completeReview(scan, id)
    expect(ids.map(id => scan.reviews.value[id]?.captureId)).toEqual(ids)
    expect(Object.prototype).not.toHaveProperty('polluted')

    const parsed = parseEchoScan(serializeEchoScan(scan.document()))
    expect(parsed.document.mode).toBe('recorded')
    if (parsed.document.mode !== 'recorded') throw new Error('Expected a recorded scan.')
    expect(parsed.document.reviews.map(review => review.captureId).sort()).toEqual(ids.sort())
    const restored = useEchoScan()
    restored.installRecordedScan(parsed.document)
    expect(Object.getPrototypeOf(restored.reviews.value)).toBeNull()
    expect(ids.map(id => restored.reviews.value[id]?.wallPeakIndices)).toEqual([[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]])
    restored.removeRecording('__proto__')
    expect(Object.getPrototypeOf(restored.reviews.value)).toBeNull()
    expect(restored.reviews.value['__proto__']).toBeUndefined()
  })
})
