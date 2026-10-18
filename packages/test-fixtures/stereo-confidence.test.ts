import { describe, expect, it } from 'vitest'
import { createStereoDevelopmentCases } from './stereo-development.ts'
import { createStereoConfidenceCases } from './stereo-confidence.ts'

async function fixtureFingerprint(fixture: ReturnType<typeof createStereoDevelopmentCases>[number], unsupportedPixels: readonly number[] = []): Promise<string> {
  const metadata = new TextEncoder().encode(JSON.stringify({
    id: fixture.id,
    split: fixture.split,
    leftCamera: fixture.input.left.camera,
    rightCamera: fixture.input.right.camera,
    truthCamera: fixture.truth.camera,
    disparityPx: fixture.truth.disparityPx,
    depthM: fixture.truth.depthM,
    regions: fixture.regions,
    unsupportedPixels,
  }))
  const bytes = new Uint8Array(fixture.input.left.image.rgb.length + fixture.input.right.image.rgb.length + metadata.length)
  bytes.set(fixture.input.left.image.rgb)
  bytes.set(fixture.input.right.image.rgb, fixture.input.left.image.rgb.length)
  bytes.set(metadata, fixture.input.left.image.rgb.length + fixture.input.right.image.rgb.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
}

describe('createStereoConfidenceCases', () => {
  it('returns deterministic, separated confidence cases without changing source positives', async () => {
    const before = createStereoDevelopmentCases('development')
    const cases = createStereoConfidenceCases()
    const again = createStereoConfidenceCases()
    const after = createStereoDevelopmentCases('development')

    expect(cases).toHaveLength(9)
    const beforeFingerprints = await Promise.all(before.map(fixture => fixtureFingerprint(fixture)))
    expect(await Promise.all(cases.slice(0, 3).map(item => fixtureFingerprint(item.fixture, item.unsupportedPixels)))).toEqual(beforeFingerprints)
    expect(await Promise.all(after.map(fixture => fixtureFingerprint(fixture)))).toEqual(beforeFingerprints)
    expect(cases.map(item => item.fixture.id)).toEqual(again.map(item => item.fixture.id))
    expect(await Promise.all(cases.map(item => fixtureFingerprint(item.fixture, item.unsupportedPixels)))).toEqual(await Promise.all(again.map(item => fixtureFingerprint(item.fixture, item.unsupportedPixels))))
    expect(cases.slice(3).every(item => item.fixture.id.startsWith('confidence-'))).toBe(true)
    expect(new Set(cases.slice(3).map(item => item.fixture.id)).size).toBe(6)
    expect(cases.every(item => item.fixture.split === 'development')).toBe(true)
  })

  it('preserves original truth/masks and camera values for both positive transformations', () => {
    const original = createStereoDevelopmentCases('development')[0]!
    const cases = createStereoConfidenceCases()
    const exposed = cases[3]!.fixture
    const lowContrast = cases[4]!.fixture

    expect(cases.slice(0, 5).every(item => item.role === 'positive')).toBe(true)
    for (const fixture of [exposed, lowContrast]) {
      expect(fixture.input.left.camera).toEqual(original.input.left.camera)
      expect(fixture.input.right.camera).toEqual(original.input.right.camera)
      expect(fixture.truth).toEqual(original.truth)
      expect(fixture.regions).toEqual(original.regions)
    }
    expect(exposed.input.left.image.rgb).toEqual(original.input.left.image.rgb)
    expect(exposed.input.left.image.rgb).not.toBe(original.input.left.image.rgb)
    expect(exposed.input.right.image.rgb).not.toBe(original.input.right.image.rgb)
    expect(lowContrast.input.left.image.rgb).not.toBe(original.input.left.image.rgb)
    expect(lowContrast.input.right.image.rgb).not.toBe(original.input.right.image.rgb)

    for (let index = 0; index < original.input.right.image.rgb.length; index += 1) {
      const source = original.input.right.image.rgb[index]!
      const transformed = exposed.input.right.image.rgb[index]!
      const nominal = Math.max(0, Math.min(255, Math.round(source * 1.12 + 8)))
      expect(Math.abs(transformed - nominal)).toBeLessThanOrEqual(3)
    }
    for (const [source, transformed] of [
      [original.input.left.image.rgb, lowContrast.input.left.image.rgb],
      [original.input.right.image.rgb, lowContrast.input.right.image.rgb],
    ]) {
      for (let index = 0; index < source!.length; index += 1) expect(transformed![index]).toBe(Math.round(96 + (source![index]! - 96) * 0.25))
    }
  })

  it('marks unsupported interior only for the three geometry-unknown controls', () => {
    const cases = createStereoConfidenceCases()
    const expected: number[] = []
    for (let y = 2; y <= 117; y += 1) for (let x = 30; x <= 157; x += 1) expected.push(y * 160 + x)

    for (const item of cases.slice(5, 8)) {
      expect(item.role).toBe('negative')
      expect(item.fixture.truth.depthM).toHaveLength(160 * 120)
      expect(item.fixture.truth.depthM.every(value => value === null)).toBe(true)
      expect(item.fixture.truth.disparityPx.every(value => value === null)).toBe(true)
      expect(item.unsupportedPixels).toEqual(expected)
    }
    expect(cases[5]!.fixture.input.left.image.rgb.every(value => value === 96)).toBe(true)
    expect(cases[5]!.fixture.input.right.image.rgb.every(value => value === 96)).toBe(true)
    expect(cases[6]!.fixture.input.left.image.rgb).not.toEqual(cases[6]!.fixture.input.right.image.rgb)
    for (const y of [0, 1, 33, 59, 119]) for (let x = 0; x < 152; x += 1) {
      const a = (y * 160 + x) * 3, b = (y * 160 + x + 8) * 3
      expect(cases[7]!.fixture.input.left.image.rgb.slice(a, a + 3)).toEqual(cases[7]!.fixture.input.left.image.rgb.slice(b, b + 3))
      expect(cases[7]!.fixture.input.right.image.rgb.slice(a, a + 3)).toEqual(cases[7]!.fixture.input.right.image.rgb.slice(b, b + 3))
    }
    expect(cases[7]!.fixture.input.left.image.rgb).toEqual(cases[7]!.fixture.input.right.image.rgb)
  })

  it('retains patch-case geometry and limits its mask to safely damaged, originally right-visible matches', () => {
    const source = createStereoDevelopmentCases('development')[0]!
    const patch = createStereoConfidenceCases()[8]!
    const fixture = patch.fixture
    const unavailable = new Set(source.regions.occlusion)
    const expected: number[] = []
    for (let y = 35; y <= 85; y += 1) for (let x = 30; x <= 157; x += 1) {
      const pixel = y * 160 + x
      const disparity = source.truth.disparityPx[pixel]
      if (unavailable.has(pixel) || disparity === null || disparity === undefined) continue
      const rightCenterX = x - disparity
      if (rightCenterX >= 55 && rightCenterX <= 105) expected.push(pixel)
    }

    expect(patch.role).toBe('negative')
    expect(fixture.truth).toEqual(source.truth)
    expect(fixture.regions).toEqual(source.regions)
    expect(fixture.input.left.image.rgb).toEqual(source.input.left.image.rgb)
    expect(patch.unsupportedPixels).toEqual(expected)
    expect(patch.unsupportedPixels.length).toBeGreaterThan(0)
    for (const pixel of patch.unsupportedPixels) {
      const x = pixel % 160, y = Math.floor(pixel / 160)
      const disparity = fixture.truth.disparityPx[pixel]!
      expect(unavailable.has(pixel)).toBe(false)
      expect(y).toBeGreaterThanOrEqual(35)
      expect(y).toBeLessThanOrEqual(85)
      expect(x - disparity).toBeGreaterThanOrEqual(55)
      expect(x - disparity).toBeLessThanOrEqual(105)
      expect(fixture.truth.depthM[pixel]).not.toBeNull()
    }
    for (let y = 0; y < 120; y += 1) for (let x = 0; x < 160; x += 1) {
      const changed = x >= 50 && x <= 110 && y >= 30 && y <= 90
      const offset = (y * 160 + x) * 3
      if (!changed) expect(fixture.input.right.image.rgb.slice(offset, offset + 3)).toEqual(source.input.right.image.rgb.slice(offset, offset + 3))
    }
  })
})
