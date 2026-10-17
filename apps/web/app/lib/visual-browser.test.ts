import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createSyntheticVisualAsset, createSyntheticVisualManifest } from '../../../../packages/test-fixtures/visual-example'
import { VISUAL_LIMITS, type VisualManifest } from '../../../../packages/spatial-visual-types'
import { inspectVisualBrowserFiles, visualSha256 } from './visual-browser'
import type { SpatialBrowserFile } from './spatial-browser'

function file(name: string, bytes: Uint8Array<ArrayBuffer>, size = bytes.byteLength): SpatialBrowserFile {
  return { name, size, arrayBuffer: async () => bytes.slice().buffer }
}
function manifestFile(manifest: VisualManifest): SpatialBrowserFile {
  return file('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
}
async function example() {
  const bytes = createSyntheticVisualAsset()
  const manifest = createSyntheticVisualManifest(await visualSha256(bytes))
  return { bytes, manifest, asset: file(manifest.asset.fileName, bytes) }
}

describe('local visual bundle inspection', () => {
  it('hashes exact original bytes and preserves the synthetic scene and illustrative cameras', async () => {
    const { bytes, manifest, asset } = await example()
    const original = bytes.slice()
    const loaded = await inspectVisualBrowserFiles(manifestFile(manifest), asset)
    expect(loaded.assetSha256).toBe('14f5c2425e69891d4e045e21dd76c48bd8fa3f69b9b02e3880a5afba9a012697')
    expect(loaded.stats.splatCount).toBe(1883)
    expect(loaded.stats.decodedAttributeBytes).toBe(1883 * 40)
    expect(loaded.manifest.cameras.every(camera => camera.role === 'illustrative')).toBe(true)
    expect(loaded.manifest.registration.status).toBe('known')
    expect(loaded.timing.readMs).toBeGreaterThanOrEqual(0)
    expect(loaded.timing.inspectMs).toBeGreaterThanOrEqual(0)
    expect(bytes).toEqual(original)
    expect(loaded.assetBytes).toEqual(original)
  })

  it('inspects the external CC0 mesh conversion without inventing metric scale or camera poses', async () => {
    const manifest = JSON.parse(await readFile('apps/web/public/research/violin/manifest.json', 'utf8')) as VisualManifest
    const bytes = new Uint8Array(await readFile('apps/web/public/research/violin/violin_10k.splat'))
    const loaded = await inspectVisualBrowserFiles(manifestFile(manifest), file(manifest.asset.fileName, bytes))
    expect(loaded.stats.splatCount).toBe(10000)
    expect(loaded.manifest.registration.status).toBe('unknown')
    expect(loaded.manifest.cameras).toEqual([])
    expect(loaded.manifest.provenance.license.name).toBe('CC0-1.0')
  })

  it('rejects mismatched hashes before attempting to decode a malformed splat', async () => {
    const { manifest } = await example()
    await expect(inspectVisualBrowserFiles(manifestFile(manifest), file(manifest.asset.fileName, new Uint8Array([1, 2, 3])))).rejects.toThrow(/SHA256/)
  })

  it('requires the declared filename even when the selected bytes match', async () => {
    const { manifest, bytes } = await example()
    await expect(inspectVisualBrowserFiles(manifestFile(manifest), file('different.splat', bytes))).rejects.toThrow(/filename/)
  })

  it('bounds both reported and actual file sizes before accepting data', async () => {
    const { manifest, asset } = await example()
    let read = false
    const oversized = { ...manifestFile(manifest), size: VISUAL_LIMITS.manifestBytes + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(1) } }
    await expect(inspectVisualBrowserFiles(oversized, asset)).rejects.toThrow(/readable file/)
    expect(read).toBe(false)
    const largeAsset = file(manifest.asset.fileName, new Uint8Array(VISUAL_LIMITS.assetBytes + 1), 1)
    await expect(inspectVisualBrowserFiles(manifestFile(manifest), largeAsset)).rejects.toThrow(/byte limit/)
    await expect(inspectVisualBrowserFiles(file('invalid.json', new Uint8Array([0xff])), asset)).rejects.toThrow(/UTF-8/)
  })

  it('rejects registered asset bounds outside the world limit', async () => {
    const { manifest, asset } = await example()
    if (manifest.registration.status !== 'known') throw new Error('Expected known fixture registration')
    manifest.registration.translationM = [1_000_000, 0, 0]
    manifest.cameras = []
    await expect(inspectVisualBrowserFiles(manifestFile(manifest), asset)).rejects.toThrow(/bounded world/)
  })
})
