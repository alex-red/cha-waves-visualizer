import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { encodePpm } from '../packages/spatial-ppm.ts'
import { createStereoScene } from '../packages/test-fixtures/stereo-scene.ts'

describe('frozen synthetic stereo images', () => {
  it('reproduces original RGB bytes, splits and exact input hashes', async () => {
    const scene = createStereoScene()
    const views = [scene.training.left, scene.training.right, ...scene.heldOut.map(item => item.view)]
    const hashes = ['66b7ed83a8a235f1063fef33153fd2a9d3725a7a5d0b18978a994ea011f8ffd7', '53475b17a538aa0b4f965870baa84c5a1858eab8487ea101115d6b1b27d35097', 'c7766d9aa5a72b27f52778fb83d03f734def391cdb58f4df9f40933df6c1f084', 'fdcd3eddc961aab38067d02e53b114f714ad1d1aa3d627b2f2d41fa63ee27290']
    for (const [index, view] of views.entries()) {
      const bytes = encodePpm(view.image)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hashes[index])
      const name = index === 0 ? 'training/left.ppm' : index === 1 ? 'training/right.ppm' : `evaluation/${view.camera.id}.ppm`
      expect(bytes).toEqual(new Uint8Array(await readFile(new URL(`../packages/test-fixtures/stereo/${name}`, import.meta.url))))
    }
    expect(new Set(views.map(view => view.camera.id)).size).toBe(4)
    expect(scene.training).not.toHaveProperty('truth')
    expect(Object.keys(scene.training)).toEqual(['left', 'right'])
    expect(scene.referenceTruth.depthM).toHaveLength(160 * 120)
    expect(Math.min(...scene.referenceTruth.depthM as number[])).toBeLessThan(2.3)
    expect(Math.max(...scene.referenceTruth.depthM as number[])).toBeGreaterThan(3.8)
  })
})
