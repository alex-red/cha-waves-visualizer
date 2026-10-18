import { describe, expect, it } from 'vitest'
import { createStereoDevelopmentCases } from './stereo-development.ts'
import { createStereoHoldoutCases } from './stereo-holdout.ts'

function fingerprint(scene: ReturnType<typeof createStereoHoldoutCases>[number]): string {
  let first = 2166136261
  let second = 0x9e3779b9
  const update = (bytes: Uint8Array) => {
    for (const byte of bytes) {
      first = Math.imul(first ^ byte, 16777619)
      second = Math.imul(second ^ byte, 2246822519)
    }
  }
  update(scene.input.left.image.rgb)
  update(scene.input.right.image.rgb)
  const content = {
    leftCamera: { positionM: scene.input.left.camera.positionM, intrinsics: scene.input.left.camera.intrinsics },
    rightCamera: { positionM: scene.input.right.camera.positionM, intrinsics: scene.input.right.camera.intrinsics },
    truth: { disparityPx: scene.truth.disparityPx, depthM: scene.truth.depthM },
    regions: scene.regions,
  }
  update(new TextEncoder().encode(JSON.stringify(content)))
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

describe('createStereoHoldoutCases', () => {
  it('creates four deterministic cases disjoint from the existing development and evaluation inputs', () => {
    const holdout = createStereoHoldoutCases()
    const again = createStereoHoldoutCases()
    const oldCases = [...createStereoDevelopmentCases('development'), ...createStereoDevelopmentCases('evaluation')]
    const holdoutIds = holdout.map(scene => scene.id)
    const oldIds = new Set(oldCases.map(scene => scene.id))
    const oldFingerprints = new Set(oldCases.map(fingerprint))

    expect(holdout).toHaveLength(4)
    expect(new Set(holdoutIds).size).toBe(4)
    expect(holdoutIds.every(id => id.startsWith('holdout-c-') && !oldIds.has(id))).toBe(true)
    expect(holdout.every(scene => scene.split === 'evaluation')).toBe(true)
    expect(new Set(holdout.map(fingerprint)).size).toBe(4)
    expect(holdout.map(fingerprint)).toEqual(again.map(fingerprint))
    expect(holdout.every(scene => !oldFingerprints.has(fingerprint(scene)))).toBe(true)
  })

  it('uses the supplied stereo rig and returns full left-visible truth with evaluator-only masks', () => {
    for (const scene of createStereoHoldoutCases()) {
      expect(Object.keys(scene.input).sort()).toEqual(['left', 'right'])
      expect(scene.input.left.image.rgb).toHaveLength(160 * 120 * 3)
      expect(scene.input.right.image.rgb).toHaveLength(160 * 120 * 3)
      expect(scene.input.left.camera.positionM).toEqual([-0.15, 0, 0])
      expect(scene.input.right.camera.positionM).toEqual([0.15, 0, 0])
      expect(scene.input.left.camera.intrinsics).toEqual({ width: 160, height: 120, fx: 140, fy: 140, cx: 80, cy: 60 })
      expect(scene.input.right.camera.intrinsics).toEqual({ width: 160, height: 120, fx: 140, fy: 140, cx: 82.5, cy: 60 })
      expect(scene.truth.depthM).toHaveLength(160 * 120)
      expect(scene.truth.disparityPx).toHaveLength(160 * 120)
      expect(scene.truth.depthM.every(depth => depth !== null && depth > 0)).toBe(true)
      expect(scene.truth.disparityPx.every(disparity => disparity !== null && Number.isFinite(disparity))).toBe(true)
      expect(scene.regions.boundary.length).toBeGreaterThan(0)
      expect(scene.regions.occlusion.length).toBeGreaterThan(0)
      for (const mask of Object.values(scene.regions)) {
        expect(new Set(mask).size).toBe(mask.length)
        expect(mask.every(pixel => Number.isInteger(pixel) && pixel >= 0 && pixel < 160 * 120)).toBe(true)
      }
      for (const pixel of scene.regions.occlusion) {
        expect(scene.truth.depthM[pixel]).not.toBeNull()
        expect(scene.truth.disparityPx[pixel]).not.toBeNull()
      }
    }
    expect(createStereoHoldoutCases()[1]!.regions.weakTexture.length).toBeGreaterThan(0)
  })
})
