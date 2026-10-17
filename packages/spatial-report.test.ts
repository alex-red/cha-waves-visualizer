import { describe, expect, it } from 'vitest'
import { parseSpatialBundle, type SpatialBundle, type SpatialPose } from './spatial-bundle.ts'
import { createSpatialInspectionReport, renderSpatialInspectionReport, type SpatialSourceInput } from './spatial-report.ts'
import { parseEchoScan } from './echo-scan.ts'

const sourceHash = 'b'.repeat(64)
const manifest = { sha256: 'a'.repeat(64), byteLength: 1500 }
const unknown = { status: 'unknown', reason: 'No calibration supplied' } as const
const quarter = Math.SQRT1_2

function fixture(): { bundle: SpatialBundle; sources: SpatialSourceInput[] } {
  const bundle = parseSpatialBundle(JSON.stringify({
    format: 'cha-spatial-bundle-v1', id: 'report-test',
    worldFrame: { id: 'world', units: 'm', axes: 'right-handed-z-up' },
    frames: [
      { id: 'registered', toWorld: { status: 'known', transform: { translationM: [10, 20, 30], rotationXyzw: [0, 0, quarter, quarter] }, method: 'supplied' } },
      { id: 'unregistered', toWorld: unknown },
    ],
    clocks: [{ id: 'clock-a', units: 'ms' }, { id: 'clock-b', units: 'ms' }],
    sources: [{ id: 'scan', path: 'scan.json', sha256: sourceHash }],
    observations: [{
      id: 'one', sourceId: 'scan', captureRef: { kind: 'synthetic', index: 0 },
      time: { status: 'known', clockId: 'clock-a', timeMs: 200, method: 'supplied' },
      speakerPose: { status: 'known', frameId: 'registered', positionM: [1, 0, 2], orientationXyzw: [quarter, 0, 0, quarter], method: 'estimated' },
      microphonePose: { status: 'known', frameId: 'world', positionM: [4, 5, 6], orientationXyzw: [0, 0, 0, 1], method: 'supplied' },
    }],
  }))
  const source = parseEchoScan(JSON.stringify({
    format: 'cha-echo-scan-v3', mode: 'synthetic', fixture: { widthM: 6.4, depthM: 4.8 },
    captures: [{ position: { xM: 1, yM: 2 }, arrivalTimesMs: [5, 10, 15, 20] }],
  }))
  return { bundle, sources: [{ sourceId: 'scan', sha256: sourceHash, byteLength: 200, ...source }] }
}

describe('spatial replay report', () => {
  it('maps sensor poses in the declared direction, composes orientation and keeps derivation separate from source origin', () => {
    const { bundle, sources } = fixture()
    const before = JSON.stringify({ bundle, sources })
    const report = createSpatialInspectionReport(bundle, sources, manifest)
    const world = report.observations[0]!.speaker.world
    expect(world.status).toBe('known')
    if (world.status !== 'known') throw new Error('Expected registered pose')
    world.positionM.forEach((value, index) => expect(value).toBeCloseTo([10, 21, 32][index]!))
    world.orientationXyzw.forEach(value => expect(value).toBeCloseTo(.5))
    expect(world.poseMethod).toBe('estimated')
    expect(world.registrationMethod).toBe('supplied')
    expect(report.observations[0]!.microphone.world).toMatchObject({ positionM: [4, 5, 6], registrationMethod: 'world-frame' })
    expect(report.observations[0]!.measurement.mode).toBe('synthetic')
    expect(report.observations[0]!.originalPositionXYM).toEqual({ xM: 1, yM: 2 })
    expect(report.summary).toMatchObject({ syntheticCount: 1, recordedCount: 0, knownSpeakerWorldPoseCount: 1 })
    expect(JSON.stringify({ bundle, sources })).toBe(before)
    report.frames[0]!.id = 'changed'
    report.observations[0]!.time.status = 'unknown'
    expect(JSON.stringify({ bundle, sources })).toBe(before)
  })

  it('retains missing frame registration and independent unknown sensor calibration instead of inferring height or identity', () => {
    const { bundle, sources } = fixture()
    const observation = bundle.observations[0]!
    observation.speakerPose = { status: 'known', frameId: 'unregistered', positionM: [0, 0, 1.2], orientationXyzw: [0, 0, 0, 1], method: 'supplied' }
    observation.microphonePose = { ...unknown }
    observation.time = { ...unknown }
    const report = createSpatialInspectionReport(bundle, sources, manifest)
    expect(report.observations[0]!.speaker.world).toEqual(unknown)
    expect(report.observations[0]!.microphone.world).toEqual(unknown)
    expect(report.observations[0]!.time).toEqual(unknown)
    expect(report.summary).toMatchObject({ knownSpeakerWorldPoseCount: 0, knownMicrophoneWorldPoseCount: 0, knownTimeCount: 0 })
    const text = renderSpatialInspectionReport(report, 'markdown')
    expect(text).toContain('Unavailable: No calibration supplied')
    expect(text).toContain('does not reconstruct geometry')
  })

  it('rejects mismatched source metadata, missing captures and mode mismatches before claiming replay', () => {
    const { bundle, sources } = fixture()
    expect(() => createSpatialInspectionReport(bundle, [], manifest)).toThrow(/exactly one/)
    expect(() => createSpatialInspectionReport(bundle, [...sources, ...sources], manifest)).toThrow(/exactly one/)
    expect(() => createSpatialInspectionReport(bundle, [{ ...sources[0]!, sha256: 'c'.repeat(64) }], manifest)).toThrow(/SHA256/)
    expect(() => createSpatialInspectionReport(bundle, [{ ...sources[0]!, byteLength: Infinity }], manifest)).toThrow(/byte length/)
    bundle.observations[0]!.captureRef = { kind: 'synthetic', index: 9 }
    expect(() => createSpatialInspectionReport(bundle, sources, manifest)).toThrow(/missing synthetic/)
    bundle.observations[0]!.captureRef = { kind: 'recorded', captureId: 'capture-a' }
    expect(() => createSpatialInspectionReport(bundle, sources, manifest)).toThrow(/kind does not match/)
  })

  it('allowlists output metadata instead of spreading runtime paths or credentials', () => {
    const { bundle, sources } = fixture()
    const extra = { ...manifest, localPath: '/private/example/bundle.json', authorization: 'example-secret' }
    const report = createSpatialInspectionReport(bundle, sources, extra)
    expect(report.manifest).toEqual({ ...manifest, id: bundle.id, format: bundle.format })
    expect(JSON.stringify(report)).not.toContain('localPath')
    expect(JSON.stringify(report)).not.toContain('example-secret')
  })

  it('preserves capture-linked recorded reviews and original PCM integrity without reporting samples or invented telemetry', () => {
    const { bundle } = fixture()
    const bytes = new Uint8Array(160)
    const parsed = parseEchoScan(JSON.stringify({
      format: 'cha-echo-scan-v2', mode: 'recorded',
      recordings: [{ id: 'capture-a', capturedAt: '2026-10-17T00:00:00Z', position: { xM: 3, yM: 4 }, sampleRate: 8000, pcm16Base64: btoa(String.fromCharCode(...bytes)), durationMs: 10 }],
      reviews: [{ captureId: 'capture-a', peaks: [{ delayMs: 2, strength: .9 }], directPeakIndex: null, wallPeakIndices: [] }],
    }))
    bundle.observations[0]!.captureRef = { kind: 'recorded', captureId: 'capture-a' }
    bundle.observations[0]!.speakerPose = { ...unknown }
    bundle.observations[0]!.microphonePose = { ...unknown }
    const report = createSpatialInspectionReport(bundle, [{ sourceId: 'scan', sha256: sourceHash, byteLength: 800, ...parsed }], manifest)
    const measurement = report.observations[0]!.measurement
    expect(measurement.mode).toBe('recorded')
    if (measurement.mode !== 'recorded') throw new Error('Expected recorded measurement')
    expect(measurement.sampleCount).toBe(80)
    expect(measurement.signal.zeroRuns).toEqual([{ startMs: 0, endMs: 10, durationMs: 10 }])
    expect(measurement.continuity).toBeNull()
    expect(measurement.review?.captureId).toBe('capture-a')
    expect(report.sources[0]!.notices[0]).toContain('v2')
    expect(report.summary).toMatchObject({ recordedCount: 1, syntheticCount: 0, knownSpeakerWorldPoseCount: 0 })
    const json = renderSpatialInspectionReport(report, 'json')
    expect(json).not.toContain('pcm16Base64')
    expect(json).not.toContain('scan.json')
  })

  it('does not align unrelated clocks and escapes authored text in deterministic Markdown', () => {
    const { bundle, sources } = fixture()
    const pose: SpatialPose = { status: 'unknown', reason: '<img src=x> [click](https://example.com) | *text*' }
    bundle.observations[0]!.microphonePose = pose
    bundle.observations.push({ ...structuredClone(bundle.observations[0]!), id: 'two', captureRef: { kind: 'synthetic', index: 1 }, time: { status: 'known', clockId: 'clock-b', timeMs: 1, method: 'estimated' } })
    const document = sources[0]!.document
    if (document.mode !== 'synthetic') throw new Error('Expected synthetic document')
    document.captures.push({ position: { xM: 2, yM: 2 }, arrivalTimesMs: [6, 11, 16, 21] })
    const report = createSpatialInspectionReport(bundle, sources, manifest)
    expect(report.observations.map(item => item.time)).toEqual(bundle.observations.map(item => item.time))
    expect(report.observations.map(item => item.id)).toEqual(['one', 'two'])
    const text = renderSpatialInspectionReport(report, 'markdown')
    expect(text).toContain('&lt;img src=x&gt;')
    expect(text).not.toContain('[click](')
    expect(text).toContain('no cross-clock alignment inferred')
    expect(renderSpatialInspectionReport(createSpatialInspectionReport(bundle, sources, manifest), 'markdown')).toBe(text)
    expect(renderSpatialInspectionReport(report, 'json')).toBe(renderSpatialInspectionReport(createSpatialInspectionReport(bundle, sources, manifest), 'json'))
  })
})
