import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ECHO_SCAN_MAX_JSON_BYTES } from '../../../../packages/echo-scan'
import { SPATIAL_BUNDLE_MAX_BYTES } from '../../../../packages/spatial-bundle'
import { inspectSpatialBrowserFiles, type SpatialBrowserFile } from './spatial-browser'

type TestFile = SpatialBrowserFile & { readCount: number }

function selectedFile(name: string, contents: Uint8Array, reportedSize = contents.byteLength): TestFile {
  return {
    name,
    size: reportedSize,
    readCount: 0,
    async arrayBuffer() {
      this.readCount += 1
      const copy = Uint8Array.from(contents)
      return copy.buffer
    },
  }
}

async function publicFixture() {
  const fixtureDirectory = fileURLToPath(new URL('../../../../packages/test-fixtures/spatial/', import.meta.url))
  const manifestBytes = new Uint8Array(await readFile(`${fixtureDirectory}/bundle.json`))
  const sourceBytes = new Uint8Array(await readFile(`${fixtureDirectory}/echo-synthetic.json`))
  return {
    manifest: selectedFile('bundle.json', manifestBytes),
    source: selectedFile('echo-synthetic.json', sourceBytes),
    manifestBytes,
    sourceBytes,
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function manifestWithSourceHash(manifestBytes: Uint8Array, bytes: Uint8Array): Uint8Array {
  const fixtureManifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { sources: Array<{ sha256: string }> }
  fixtureManifest.sources[0]!.sha256 = hash(bytes)
  return new TextEncoder().encode(JSON.stringify(fixtureManifest))
}

describe('browser spatial bundle inspection', () => {
  it('replays the public synthetic fixture with exact hashes and leaves selected bytes unchanged', async () => {
    const fixture = await publicFixture()
    const manifestBefore = Uint8Array.from(fixture.manifestBytes)
    const sourceBefore = Uint8Array.from(fixture.sourceBytes)
    const unrelated = selectedFile('not-declared.json', new TextEncoder().encode('do not read this'))
    const report = await inspectSpatialBrowserFiles(fixture.manifest, [fixture.source, unrelated])

    expect(report.manifest.sha256).toBe('77eb77f9e6154c5f202525c132eadaef30e4c7eaf711b24c79dc8d824896c3d8')
    expect(report.sources[0]).toMatchObject({ id: 'synthetic-room', sha256: '23d118e0808c57c324531c67ffa622dadccd72993afed6d64c2322a16df4a768' })
    expect(report.observations.map(item => item.id)).toEqual([
      'world-observation', 'rotated-frame-observation', 'unknown-frame-observation',
    ])
    expect(report.observations[0]!.speaker.world).toMatchObject({ status: 'known', positionM: [1, 1, 1.2] })
    const rotated = report.observations[1]!.speaker.world
    expect(rotated.status).toBe('known')
    if (rotated.status === 'known') {
      rotated.positionM.forEach((coordinate, index) => expect(coordinate).toBeCloseTo([2, 1, 1.2][index]!, 12))
    }
    expect(report.observations[2]!.speaker.world).toMatchObject({ status: 'unknown' })
    expect(fixture.manifestBytes).toEqual(manifestBefore)
    expect(fixture.sourceBytes).toEqual(sourceBefore)
    expect(fixture.manifest.readCount).toBe(1)
    expect(fixture.source.readCount).toBe(1)
    expect(unrelated.readCount).toBe(0)
  })

  it('rejects a source hash mismatch before decoding and preserves the supplied source bytes', async () => {
    const fixture = await publicFixture()
    const altered = Uint8Array.from(fixture.sourceBytes)
    altered[altered.length - 2] = altered[altered.length - 2]! ^ 1
    const source = selectedFile('echo-synthetic.json', altered)
    const manifest = selectedFile('bundle.json', fixture.manifestBytes)
    const before = Uint8Array.from(altered)
    await expect(inspectSpatialBrowserFiles(manifest, [source])).rejects.toThrow(/SHA256/)
    expect(altered).toEqual(before)
  })

  it('strictly rejects invalid UTF-8 in a correctly hash-linked source', async () => {
    const fixture = await publicFixture()
    const invalidUtf8 = Uint8Array.from([0xff, 0xfe, 0xfd])
    const manifest = selectedFile('bundle.json', manifestWithSourceHash(fixture.manifestBytes, invalidUtf8))
    const source = selectedFile('echo-synthetic.json', invalidUtf8)
    await expect(inspectSpatialBrowserFiles(manifest, [source])).rejects.toThrow(/UTF-8/)
  })

  it('checks declared and actual manifest/source sizes before parsing', async () => {
    const fixture = await publicFixture()
    const oversizedReportedManifest = selectedFile('bundle.json', fixture.manifestBytes, SPATIAL_BUNDLE_MAX_BYTES + 1)
    await expect(inspectSpatialBrowserFiles(oversizedReportedManifest, [fixture.source])).rejects.toThrow(/limit/)
    expect(oversizedReportedManifest.readCount).toBe(0)

    const oversizedActualManifest = selectedFile('bundle.json', new Uint8Array(SPATIAL_BUNDLE_MAX_BYTES + 1), 1)
    await expect(inspectSpatialBrowserFiles(oversizedActualManifest, [fixture.source])).rejects.toThrow(/limit/)
    expect(oversizedActualManifest.readCount).toBe(1)

    const oversizedReportedSource = selectedFile('echo-synthetic.json', fixture.sourceBytes, ECHO_SCAN_MAX_JSON_BYTES + 1)
    await expect(inspectSpatialBrowserFiles(fixture.manifest, [oversizedReportedSource])).rejects.toThrow(/limit/)
    expect(oversizedReportedSource.readCount).toBe(0)

    const oversizedActualSource = selectedFile('echo-synthetic.json', new Uint8Array(ECHO_SCAN_MAX_JSON_BYTES + 1), 1)
    await expect(inspectSpatialBrowserFiles(fixture.manifest, [oversizedActualSource])).rejects.toThrow(/limit/)
    expect(oversizedActualSource.readCount).toBe(1)
  })

  it('rejects duplicate and missing source basenames and ignores undeclared file contents', async () => {
    const fixture = await publicFixture()
    const first = selectedFile('echo-synthetic.json', fixture.sourceBytes)
    const second = selectedFile('echo-synthetic.json', fixture.sourceBytes)
    await expect(inspectSpatialBrowserFiles(fixture.manifest, [first, second])).rejects.toThrow(/unique/)
    expect(first.readCount + second.readCount).toBe(0)
    await expect(inspectSpatialBrowserFiles(fixture.manifest, [selectedFile('other.json', fixture.sourceBytes)])).rejects.toThrow(/missing/)
  })

  it('rejects ambiguous declared basenames before reading source content', async () => {
    const fixture = await publicFixture()
    const manifestValue = JSON.parse(new TextDecoder().decode(fixture.manifestBytes)) as { sources: Array<Record<string, unknown>> }
    manifestValue.sources.push({ ...manifestValue.sources[0], id: 'second-source', path: 'other/echo-synthetic.json' })
    const manifest = selectedFile('bundle.json', new TextEncoder().encode(JSON.stringify(manifestValue)))
    const source = selectedFile('echo-synthetic.json', fixture.sourceBytes)
    await expect(inspectSpatialBrowserFiles(manifest, [source])).rejects.toThrow(/ambiguous/)
    expect(source.readCount).toBe(0)
  })

  it('bounds selected file count and has no Node dependency in the browser helper', async () => {
    const fixture = await publicFixture()
    const tooMany = Array.from({ length: 5 }, (_, index) => selectedFile(`extra-${index}.json`, new Uint8Array()))
    await expect(inspectSpatialBrowserFiles(fixture.manifest, tooMany)).rejects.toThrow(/at most 4 source files/)
    const sourceText = await readFile(new URL('./spatial-browser.ts', import.meta.url), 'utf8')
    expect(sourceText).not.toMatch(/from\s+['"]node:/)
  })
})
