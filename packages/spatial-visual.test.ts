import { describe, expect, it } from 'vitest'
import { inspectSplatAsset, parseVisualManifest, visualPointToWorld } from './spatial-visual.ts'
import { VISUAL_LIMITS, VISUAL_MANIFEST_FORMAT, type VisualRegistration } from './spatial-visual-types.ts'

function manifest(overrides: Record<string, unknown> = {}): string {
  const base = {
    format: VISUAL_MANIFEST_FORMAT,
    id: 'visual-test',
    label: 'Synthetic visual test',
    asset: { fileName: 'scene.splat', format: 'splat32', sha256: 'a'.repeat(64), splatCount: 1 },
    assetFrame: { handedness: 'right', up: '+y', cameraConvention: 'opengl' },
    worldFrame: { units: 'm', axes: 'right-handed-z-up' },
    registration: {
      status: 'known', scaleMPerUnit: 2, rotationXyzw: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      translationM: [10, 20, 30], method: 'synthetic',
    },
    provenance: {
      kind: 'synthetic', creator: 'test fixture', sourceUrl: null,
      license: { name: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      method: 'deterministic test', version: '1', notes: 'Synthetic data only.',
    },
    cameras: [{
      id: 'camera-1', role: 'training', position: [1, 0, 0], orientationXyzw: [0, 0, 0, 1],
      intrinsics: { width: 640, height: 480, fx: 500, fy: 500, cx: 320, cy: 240 }, imageSha256: null,
    }],
  }
  return JSON.stringify({ ...base, ...overrides })
}

function splatRecord({ center = [1, 2, 3], scale = [0.5, 1, 2], rotation = [128, 128, 128, 255] }: {
  center?: number[]; scale?: number[]; rotation?: number[]
} = {}): Uint8Array {
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)
  center.forEach((value, index) => view.setFloat32(index * 4, value, true))
  scale.forEach((value, index) => view.setFloat32(12 + index * 4, value, true))
  bytes.set([200, 100, 50, 255], 24)
  bytes.set(rotation, 28)
  return bytes
}

describe('parseVisualManifest', () => {
  it('parses a valid manifest into independent validated values', () => {
    const first = parseVisualManifest(manifest())
    const second = parseVisualManifest(manifest())
    expect(first).toMatchObject({ format: VISUAL_MANIFEST_FORMAT, id: 'visual-test', asset: { splatCount: 1 } })
    expect(first.cameras[0]?.position).toEqual([1, 0, 0])
    expect(first).not.toBe(second)
    expect(first.cameras).not.toBe(second.cameras)
    expect(first.registration).not.toBe(second.registration)
  })

  it.each([
    ['unsupported field', { extra: true }],
    ['unsafe asset basename', { asset: { fileName: '../escape.splat', format: 'splat32', sha256: 'a'.repeat(64), splatCount: 1 } }],
    ['bad URL', { provenance: { kind: 'synthetic', creator: 'x', sourceUrl: 'http://example.test', license: { name: 'x', url: null }, method: 'x', version: '1', notes: 'x' } }],
    ['invalid quaternion', { registration: { status: 'known', scaleMPerUnit: 1, rotationXyzw: [0, 0, 0, 2], translationM: [0, 0, 0], method: 'synthetic' } }],
    ['underflowing registration scale', { registration: { status: 'known', scaleMPerUnit: 1e-8, rotationXyzw: [0, 0, 0, 1], translationM: [0, 0, 0], method: 'synthetic' } }],
    ['underflowing camera focal length', { cameras: [{
      id: 'camera-1', role: 'training', position: [0, 0, 0], orientationXyzw: [0, 0, 0, 1],
      intrinsics: { width: 640, height: 480, fx: 1e-4, fy: 500, cx: 320, cy: 240 }, imageSha256: null,
    }] }],
    ['duplicate camera ID', { cameras: [
      { id: 'same', role: 'training', position: [0, 0, 0], orientationXyzw: [0, 0, 0, 1], intrinsics: { width: 1, height: 1, fx: 1, fy: 1, cx: 0, cy: 0 }, imageSha256: null },
      { id: 'same', role: 'held-out', position: [0, 0, 0], orientationXyzw: [0, 0, 0, 1], intrinsics: { width: 1, height: 1, fx: 1, fy: 1, cx: 0, cy: 0 }, imageSha256: null },
    ] }],
    ['transformed camera outside bounds', { registration: { status: 'known', scaleMPerUnit: 100, rotationXyzw: [0, 0, 0, 1], translationM: [999_999, 0, 0], method: 'synthetic' } }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseVisualManifest(manifest(override))).toThrow()
  })

  it('rejects invalid UTF-8 surrogates, excessive UTF-8 bytes and malformed JSON', () => {
    expect(() => parseVisualManifest('{"bad":"\ud800"}')).toThrow(/UTF-8/)
    expect(() => parseVisualManifest(' '.repeat(VISUAL_LIMITS.manifestBytes + 1))).toThrow(/exceeds/)
    expect(() => parseVisualManifest('{')).toThrow(/valid JSON/)
  })

  it('preserves unknown registration as unknown without inventing an identity transform', () => {
    const parsed = parseVisualManifest(manifest({ registration: { status: 'unknown', reason: 'No supplied alignment.' } }))
    expect(parsed.registration).toEqual({ status: 'unknown', reason: 'No supplied alignment.' })
  })

  it.each(['+y', '-y', '+z', '-z'] as const)('accepts an explicit %s asset up-axis', up => {
    expect(parseVisualManifest(manifest({ assetFrame: { handedness: 'right', up, cameraConvention: 'opengl' } })).assetFrame.up).toBe(up)
  })
})

describe('inspectSplatAsset', () => {
  it('decodes finite records, includes three-sigma envelopes and reports native attribute bytes', () => {
    const bytes = splatRecord()
    const original = bytes.slice()
    const stats = inspectSplatAsset(bytes, 1)
    expect(stats).toEqual({
      splatCount: 1, visibleSplatCount: 1, sourceBytes: 32,
      localBounds: { min: [-0.5, -1, -3], max: [2.5, 5, 9] },
      decodedAttributeBytes: 40,
    })
    expect(bytes).toEqual(original)
  })

  it('counts zero-opacity records as splats but not visible splats', () => {
    const transparent = splatRecord()
    transparent[27] = 0
    expect(inspectSplatAsset(transparent)).toMatchObject({ splatCount: 1, visibleSplatCount: 0 })
  })

  it('projects an anisotropic covariance through the packed quaternion before building bounds', () => {
    const bytes = splatRecord({ center: [0, 0, 0], scale: [10, 0.01, 0.01], rotation: [219, 128, 128, 219] })
    const stats = inspectSplatAsset(bytes)
    expect(stats.localBounds.min[0]).toBeGreaterThan(-0.13)
    expect(stats.localBounds.max[0]).toBeLessThan(0.13)
    expect(stats.localBounds.min[1]).toBeLessThan(-29.9)
    expect(stats.localBounds.max[1]).toBeGreaterThan(29.9)
  })

  it.each([
    ['non-record length', new Uint8Array(31)],
    ['zero quaternions', splatRecord({ rotation: [128, 128, 128, 128] })],
    ['zero scale', splatRecord({ scale: [1, 0, 1] })],
    ['non-finite centers', splatRecord({ center: [Number.NaN, 0, 0] })],
    ['oversized centers', splatRecord({ center: [1_000_001, 0, 0] })],
    ['out-of-bounds envelope', splatRecord({ center: [999_999, 0, 0], scale: [1, 1, 1] })],
    ['rotated out-of-bounds envelope', splatRecord({ center: [0, 999_999, 0], scale: [1, 0.01, 0.01], rotation: [219, 128, 128, 219] })],
  ])('rejects %s', (_label, bytes) => {
    expect(() => inspectSplatAsset(bytes)).toThrow()
  })

  it('enforces expected count and the asset byte cap', () => {
    expect(() => inspectSplatAsset(splatRecord(), 2)).toThrow(/count/)
    expect(() => inspectSplatAsset(new Uint8Array(VISUAL_LIMITS.assetBytes + 1))).toThrow(/bytes/)
  })

  it('accepts the maximum record count and rejects larger count before decoding', () => {
    const maximum = new Uint8Array(VISUAL_LIMITS.splatCount * 32)
    for (let recordOffset = 0; recordOffset < maximum.length; recordOffset += 32) {
      const view = new DataView(maximum.buffer)
      view.setFloat32(recordOffset + 12, 0.001, true)
      view.setFloat32(recordOffset + 16, 0.001, true)
      view.setFloat32(recordOffset + 20, 0.001, true)
      maximum[recordOffset + 28] = 128
      maximum[recordOffset + 29] = 128
      maximum[recordOffset + 30] = 128
      maximum[recordOffset + 31] = 255
    }
    expect(inspectSplatAsset(maximum).splatCount).toBe(VISUAL_LIMITS.splatCount)
  })

})

describe('visualPointToWorld', () => {
  it('applies local scale before rotation and translation without mutating registration', () => {
    const registrationValue: VisualRegistration = {
      status: 'known', scaleMPerUnit: 2, rotationXyzw: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      translationM: [10, 20, 30], method: 'supplied',
    }
    const before = structuredClone(registrationValue)
    expect(visualPointToWorld([1, 0, 0], registrationValue)).toEqual([10, 22, 30])
    expect(registrationValue).toEqual(before)
  })

  it('returns null for unknown scale and rejects overflowed mapped coordinates', () => {
    expect(visualPointToWorld([1, 2, 3], { status: 'unknown', reason: 'scale unavailable' })).toBeNull()
    expect(() => visualPointToWorld([1_000_000, 0, 0], {
      status: 'known', scaleMPerUnit: 2, rotationXyzw: [0, 0, 0, 1], translationM: [0, 0, 0], method: 'supplied',
    })).toThrow(/bounded/)
  })
})

