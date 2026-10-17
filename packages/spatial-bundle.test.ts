import { describe, expect, it } from 'vitest'
import {
  SPATIAL_BUNDLE_FORMAT,
  SPATIAL_BUNDLE_LIMITS,
  parseSpatialBundle,
  validateSpatialBundle,
  type SpatialBundle,
} from './spatial-bundle.ts'

function bundle(): SpatialBundle {
  return {
    format: SPATIAL_BUNDLE_FORMAT,
    id: 'bundle-1',
    worldFrame: { id: 'world', units: 'm', axes: 'right-handed-z-up' },
    frames: [{ id: 'device', toWorld: { status: 'unknown', reason: 'Registration not supplied.' } }],
    clocks: [{ id: 'audio-clock', units: 'ms' }],
    sources: [{ id: 'scan-a', path: 'scans/scan.json', sha256: 'a'.repeat(64) }],
    observations: [{
      id: 'observation-a', sourceId: 'scan-a', captureRef: { kind: 'recorded', captureId: 'capture 1' },
      time: { status: 'known', clockId: 'audio-clock', timeMs: 0, method: 'supplied' },
      speakerPose: { status: 'unknown', reason: 'Acoustic center calibration is unavailable.' },
      microphonePose: { status: 'known', frameId: 'device', positionM: [1, 2, 3], orientationXyzw: [0, 0, 0, 1], method: 'estimated' },
    }],
  }
}

const clone = <T>(value: T): T => structuredClone(value)

describe('spatial bundle v1 contract', () => {
  it('accepts and parses the declared bundle without inventing pose or time metadata', () => {
    const value = bundle()
    expect(validateSpatialBundle(value)).toEqual(value)
    expect(parseSpatialBundle(JSON.stringify(value))).toEqual(value)
    expect(value.observations[0]?.speakerPose).toEqual({ status: 'unknown', reason: 'Acoustic center calibration is unavailable.' })
  })

  it('retains explicit unknown registration states', () => {
    const value = bundle()
    expect(validateSpatialBundle(value).frames[0]?.toWorld).toEqual({ status: 'unknown', reason: 'Registration not supplied.' })
  })

  it('rejects duplicate IDs, duplicate source paths, and duplicate or dangling references', () => {
    const duplicateFrame = bundle()
    duplicateFrame.frames.push({ id: 'device', toWorld: { status: 'unknown', reason: 'Unknown.' } })
    expect(() => validateSpatialBundle(duplicateFrame)).toThrow(/duplicate frame ids/)

    const duplicatePath = bundle()
    duplicatePath.sources.push({ id: 'scan-b', path: 'scans/scan.json', sha256: 'b'.repeat(64) })
    expect(() => validateSpatialBundle(duplicatePath)).toThrow(/duplicate paths/)

    const danglingSource = bundle()
    danglingSource.observations[0]!.sourceId = 'missing'
    expect(() => validateSpatialBundle(danglingSource)).toThrow(/declared source/)

    const danglingFrame = bundle()
    const mic = danglingFrame.observations[0]!.microphonePose
    if (mic.status === 'known') mic.frameId = 'missing'
    expect(() => validateSpatialBundle(danglingFrame)).toThrow(/declared local frame/)

    const danglingClock = bundle()
    const time = danglingClock.observations[0]!.time
    if (time.status === 'known') time.clockId = 'missing'
    expect(() => validateSpatialBundle(danglingClock)).toThrow(/declared clock/)

    const duplicateCapture = bundle()
    duplicateCapture.observations.push({ ...clone(duplicateCapture.observations[0]!), id: 'observation-b' })
    expect(() => validateSpatialBundle(duplicateCapture)).toThrow(/duplicate source\/capture references/)
  })

  it('rejects unknown fields and unsupported formats throughout the schema', () => {
    const extra = bundle() as SpatialBundle & { debug: string }
    extra.debug = 'private-value'
    expect(() => validateSpatialBundle(extra)).toThrow(/\$ contains an unsupported field/)
    expect(() => validateSpatialBundle({ ...bundle(), format: 'cha-spatial-bundle-v2' })).toThrow(/unsupported version/)
    const nested = bundle()
    ;(nested.observations[0]!.time as unknown as Record<string, unknown>).legacyTime = 5
    expect(() => validateSpatialBundle(nested)).toThrow(/observations\[0\]\.time contains an unsupported field/)

    const privateKey = bundle()
    const privatePathKey = '/private/example/captures/scan.json'
    ;(privateKey.observations[0]!.time as unknown as Record<string, unknown>)[privatePathKey] = 'do-not-echo'
    let diagnostic = ''
    try { validateSpatialBundle(privateKey) }
    catch (error) { diagnostic = error instanceof Error ? error.message : String(error) }
    expect(diagnostic).toMatch(/observations\[0\]\.time contains an unsupported field/)
    expect(diagnostic).not.toContain(privatePathKey)
    expect(diagnostic).not.toContain('do-not-echo')
  })

  it('enforces array and numeric bounds, including quaternion unit norm and clock time', () => {
    const tooManyFrames = bundle()
    tooManyFrames.frames = Array.from({ length: SPATIAL_BUNDLE_LIMITS.maxFrames + 1 }, (_, index) => ({ id: `f${index}`, toWorld: { status: 'unknown' as const, reason: 'Unknown.' } }))
    expect(() => validateSpatialBundle(tooManyFrames)).toThrow(/at most 16 items/)

    const far = bundle()
    const mic = far.observations[0]!.microphonePose
    if (mic.status === 'known') mic.positionM[0] = 1_000_001
    expect(() => validateSpatialBundle(far)).toThrow(/observations\[0\]\.microphonePose\.positionM\[0\]/)

    const badQuaternion = bundle()
    const pose = badQuaternion.observations[0]!.microphonePose
    if (pose.status === 'known') pose.orientationXyzw = [0, 0, 0, 0]
    expect(() => validateSpatialBundle(badQuaternion)).toThrow(/unit norm/)

    const negativeTime = bundle()
    const time = negativeTime.observations[0]!.time
    if (time.status === 'known') time.timeMs = -0.01
    expect(() => validateSpatialBundle(negativeTime)).toThrow(/timeMs must be a finite number/)

    const oversizedTime = bundle()
    const oversized = oversizedTime.observations[0]!.time
    if (oversized.status === 'known') oversized.timeMs = Number.MAX_SAFE_INTEGER + 1
    expect(() => validateSpatialBundle(oversizedTime)).toThrow(/timeMs must be a finite number/)
  })

  it('rejects unsafe relative paths and malformed hashes', () => {
    for (const path of [
      '/absolute/scan.json', '../scan.json', 'scans/../scan.json', 'scans//scan.json', './scan.json',
      'https://example.invalid/scan.json', 'C:/scan.json', 'scans\\scan.json', 'scan:name.json',
      'scan?query.json', 'scan#fragment.json', 'scans/scan\u0000.json', 'scans/scan\u0085.json', 'a'.repeat(1025),
    ]) {
      const value = bundle()
      value.sources[0]!.path = path
      expect(() => validateSpatialBundle(value), path).toThrow(/printable path characters|portable relative POSIX path|empty, dot or traversal/)
    }
    const unicodePath = bundle()
    unicodePath.sources[0]!.path = 'scans/音声 café.json'
    expect(validateSpatialBundle(unicodePath).sources[0]?.path).toBe('scans/音声 café.json')
    const badHash = bundle()
    badHash.sources[0]!.sha256 = 'A'.repeat(64)
    expect(() => validateSpatialBundle(badHash)).toThrow(/lowercase hexadecimal/)
  })

  it('enforces encoded manifest size and bounds parsed JSON shape', () => {
    expect(() => parseSpatialBundle(' '.repeat(SPATIAL_BUNDLE_LIMITS.maxBytes + 1))).toThrow(/262144-byte limit/)
    expect(() => validateSpatialBundle({ nested: { nested: { nested: {} } } })).toThrow(/\$ contains an unsupported field/)
    const deep = { value: 1 } as Record<string, unknown>
    let cursor = deep
    for (let index = 0; index < SPATIAL_BUNDLE_LIMITS.maxJsonDepth + 2; index += 1) {
      const next: Record<string, unknown> = {}
      cursor.child = next
      cursor = next
    }
    expect(() => validateSpatialBundle(deep)).toThrow(/nesting exceeds/)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => validateSpatialBundle(cyclic)).toThrow(/cycles or repeated object references/)
  })
})
