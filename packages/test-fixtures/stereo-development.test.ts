import { describe, expect, it } from 'vitest'
import { createStereoDevelopmentCases } from './stereo-development.ts'

function imageBytes(cases: ReturnType<typeof createStereoDevelopmentCases>): number[] {
  return cases.flatMap(scene => [...scene.input.left.image.rgb, ...scene.input.right.image.rgb])
}

describe('createStereoDevelopmentCases', () => {
  it('returns distinct, reproducible cases for each requested split', () => {
    const development = createStereoDevelopmentCases('development')
    const evaluation = createStereoDevelopmentCases('evaluation')
    const developmentAgain = createStereoDevelopmentCases('development')
    const evaluationAgain = createStereoDevelopmentCases('evaluation')

    expect(development).toHaveLength(3)
    expect(evaluation).toHaveLength(2)
    expect(new Set([...development, ...evaluation].map(scene => scene.id)).size).toBe(5)
    expect(development.every(scene => scene.split === 'development')).toBe(true)
    expect(evaluation.every(scene => scene.split === 'evaluation')).toBe(true)
    expect(imageBytes(development)).toEqual(imageBytes(developmentAgain))
    expect(imageBytes(evaluation)).toEqual(imageBytes(evaluationAgain))
    expect(development.map(scene => scene.truth.depthM)).toEqual(developmentAgain.map(scene => scene.truth.depthM))
    expect(evaluation.map(scene => scene.truth.disparityPx)).toEqual(evaluationAgain.map(scene => scene.truth.disparityPx))
  })

  it('keeps stereo input limited to the two calibrated views', () => {
    for (const scene of [...createStereoDevelopmentCases('development'), ...createStereoDevelopmentCases('evaluation')]) {
      expect(Object.keys(scene.input).sort()).toEqual(['left', 'right'])
      expect(scene.input.left.image.rgb).toHaveLength(160 * 120 * 3)
      expect(scene.input.right.image.rgb).toHaveLength(160 * 120 * 3)
      expect(scene.input.left.camera.positionM).toEqual([-0.15, 0, 0])
      expect(scene.input.right.camera.positionM).toEqual([0.15, 0, 0])
      expect(scene.input.left.camera.intrinsics).toEqual({ width: 160, height: 120, fx: 140, fy: 140, cx: 80, cy: 60 })
      expect(scene.input.right.camera.intrinsics).toEqual({ width: 160, height: 120, fx: 140, fy: 140, cx: 82.5, cy: 60 })
      expect(scene.truth.depthM).toHaveLength(160 * 120)
      expect(scene.truth.disparityPx).toHaveLength(160 * 120)
    }
  })

  it('retains unavailable right correspondences, controlled weak texture, and projected foreground boundaries', () => {
    const development = createStereoDevelopmentCases('development')
    const evaluation = createStereoDevelopmentCases('evaluation')
    expect(development.every(scene => scene.regions.occlusion.length > 0)).toBe(true)
    expect(development[1]!.regions.weakTexture.length).toBeGreaterThan(0)
    expect(evaluation[1]!.regions.weakTexture.length).toBeGreaterThan(0)
    expect([...development, ...evaluation].every(scene => scene.regions.boundary.length > 0)).toBe(true)
    for (const scene of [...development, ...evaluation]) {
      let inFrameOcclusion = 0
      let outOfFrameCorrespondence = 0
      for (const pixel of scene.regions.occlusion) {
        expect(scene.truth.depthM[pixel]).not.toBeNull()
        expect(scene.truth.disparityPx[pixel]).not.toBeNull()
        const x = pixel % 160
        const projectedRightX = x + 0.5 - scene.truth.disparityPx[pixel]!
        if (projectedRightX < 0.5 || projectedRightX >= 159.5) outOfFrameCorrespondence += 1
        else inFrameOcclusion += 1
      }
      expect(inFrameOcclusion).toBeGreaterThan(0)
      expect(outOfFrameCorrespondence).toBeGreaterThan(0)
    }
  })

  it('matches the analytical tilted-plane ray depth and calibrated disparity at an unobstructed pixel', () => {
    const scene = createStereoDevelopmentCases('development')[0]!
    const x = 24, y = 0, pixel = y * 160 + x
    const dx = (x + 0.5 - 80) / 140
    const dy = -(y + 0.5 - 60) / 140
    const expectedDepth = (3.6 + 0.18 * -0.15) / (1 - 0.18 * dx + 0.12 * dy)
    const depth = scene.truth.depthM[pixel]
    const disparity = scene.truth.disparityPx[pixel]
    expect(depth).not.toBeNull()
    expect(depth).toBeCloseTo(expectedDepth, 12)
    expect(disparity).toBeCloseTo(140 * 0.3 / depth! - 2.5, 10)
  })

  it('limits the right-camera exposure transform to the specified gain and offset', () => {
    const scene = createStereoDevelopmentCases('development')[2]!
    const right = scene.input.right.image.rgb
    const maxValue = right.reduce((maximum, value) => Math.max(maximum, value), 0)
    const minValue = right.reduce((minimum, value) => Math.min(minimum, value), 255)
    expect(scene.id).toContain('exposure')
    expect(maxValue).toBeLessThanOrEqual(1.06 * 190 + 4)
    expect(minValue).toBeGreaterThanOrEqual(0)
  })
})
