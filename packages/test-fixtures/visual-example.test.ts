import { describe, expect, it } from 'vitest'
import { createSyntheticVisualAsset, createSyntheticVisualManifest } from './visual-example'

const EXPECTED_ASSET_SHA256 = '14f5c2425e69891d4e045e21dd76c48bd8fa3f69b9b02e3880a5afba9a012697'
const BYTES_PER_SPLAT = 32

function directionFromQuaternion(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q
  // Rotate OpenGL camera forward (0,0,-1) by q.
  return [-2 * (x * z + w * y), 2 * (w * x - y * z), -1 + 2 * (x * x + y * y)]
}

function normalized(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector)
  return vector.map(value => value / length) as [number, number, number]
}

describe('synthetic visual example', () => {
  it('produces stable fixed-width splat32 bytes with positive anisotropic scales', async () => {
    const asset = createSyntheticVisualAsset()
    const repeated = createSyntheticVisualAsset()
    expect(asset).toBeInstanceOf(Uint8Array)
    expect(asset.byteLength % BYTES_PER_SPLAT).toBe(0)
    const count = asset.byteLength / BYTES_PER_SPLAT
    expect(count).toBeGreaterThanOrEqual(1000)
    expect(count).toBeLessThanOrEqual(4000)
    expect(asset).toEqual(repeated)
    const digest = await crypto.subtle.digest('SHA-256', asset)
    expect(Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')).toBe(EXPECTED_ASSET_SHA256)

    const view = new DataView(asset.buffer, asset.byteOffset, asset.byteLength)
    for (let index = 0; index < count; index++) {
      const offset = index * BYTES_PER_SPLAT
      for (let component = 0; component < 3; component++) {
        expect(Number.isFinite(view.getFloat32(offset + component * 4, true))).toBe(true)
        expect(view.getFloat32(offset + 12 + component * 4, true)).toBeGreaterThan(0)
      }
      const quaternion = Array.from({ length: 4 }, (_, component) => view.getUint8(offset + 28 + component) / 127.5 - 1)
      expect(Math.hypot(...quaternion)).toBeGreaterThan(0.98)
      expect(Math.hypot(...quaternion)).toBeLessThan(1.02)
    }
    asset[0] = 0
    expect(createSyntheticVisualAsset()[0]).not.toBe(0)
  })

  it('declares synthetic provenance, nontrivial registration, and illustrative OpenGL cameras only', () => {
    const manifest = createSyntheticVisualManifest(EXPECTED_ASSET_SHA256)
    expect(manifest.id).toBe('synthetic-study-room')
    expect(manifest.asset).toMatchObject({ fileName: 'synthetic-study-room.splat', format: 'splat32', sha256: EXPECTED_ASSET_SHA256, splatCount: 1883 })
    expect(manifest.assetFrame).toEqual({ handedness: 'right', up: '+z', cameraConvention: 'opengl' })
    expect(manifest.registration).toMatchObject({ status: 'known', scaleMPerUnit: 1, translationM: [1, 2, 0], method: 'synthetic' })
    if (manifest.registration.status !== 'known') throw new Error('Expected known synthetic registration')
    expect(manifest.registration.rotationXyzw).toEqual([0, 0, Math.SQRT1_2, Math.SQRT1_2])
    expect(manifest.provenance).toMatchObject({ kind: 'synthetic', creator: 'Cha Waves', sourceUrl: null, license: { name: 'MIT', url: null }, method: 'proceduralGaussianfixture' })
    expect(manifest.provenance.notes).toMatch(/not captured/i)
    expect(manifest.provenance.notes).toMatch(/not image-trained/i)
    expect(manifest.cameras).toHaveLength(3)
    const targets: [number, number, number][] = [[3, 2.4, 1.25], [3, 2.4, 1.35], [3, 2.4, 0.9]]
    for (const [index, camera] of manifest.cameras.entries()) {
      expect(camera.role).toBe('illustrative')
      expect(camera.imageSha256).toBeNull()
      expect(camera.intrinsics.fx).toBeGreaterThan(0)
      expect(camera.intrinsics.fy).toBeGreaterThan(0)
      expect(Math.hypot(...camera.orientationXyzw)).toBeCloseTo(1, 12)
      const actualDirection = normalized(directionFromQuaternion(camera.orientationXyzw))
      const expectedDirection = normalized([
        targets[index]![0] - camera.position[0],
        targets[index]![1] - camera.position[1],
        targets[index]![2] - camera.position[2],
      ])
      actualDirection.forEach((value, axis) => expect(value).toBeCloseTo(expectedDirection[axis]!, 12))
    }
    expect(manifest.cameras.some(camera => camera.role === 'training' || camera.role === 'held-out')).toBe(false)

    manifest.cameras[0]!.position[0] = -100
    expect(createSyntheticVisualManifest(EXPECTED_ASSET_SHA256).cameras[0]!.position[0]).toBe(3)
  })
})
