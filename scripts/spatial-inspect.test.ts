import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSpatialBundle } from '../packages/spatial-bundle'
import { ECHO_SCAN_MAX_JSON_BYTES } from '../packages/echo-scan'
import { parseSpatialInspectArguments, runSpatialInspect, SPATIAL_INSPECT_USAGE } from './spatial-inspect'

const unknown = { status: 'unknown', reason: 'not provided' }

function scanBytes() {
  return Buffer.from(JSON.stringify({
    format: 'cha-echo-scan-v3', mode: 'synthetic',
    fixture: { widthM: 5, depthM: 6 },
    captures: [{ position: { xM: 1, yM: 2 }, arrivalTimesMs: [1, 2, 3, 4] }],
  }))
}

function bundle(sourceHash: string, sourcePath = 'scans/synthetic.json') {
  return {
    format: 'cha-spatial-bundle-v1', id: 'fixture-bundle',
    worldFrame: { id: 'world', units: 'm', axes: 'right-handed-z-up' },
    frames: [], clocks: [],
    sources: [{ id: 'scan-a', path: sourcePath, sha256: sourceHash }],
    observations: [{
      id: 'observation-a', sourceId: 'scan-a', captureRef: { kind: 'synthetic', index: 0 },
      time: unknown, speakerPose: unknown, microphonePose: unknown,
    }],
  }
}

async function writeFixture(directory: string, options: { sourceBytes?: Uint8Array; path?: string; hash?: string } = {}) {
  const bytes = options.sourceBytes ?? scanBytes()
  const sourcePath = options.path ?? 'scans/synthetic.json'
  const sourceFile = join(directory, ...sourcePath.split('/'))
  const manifestFile = join(directory, 'bundle.json')
  const manifestBytes = Buffer.from(JSON.stringify(bundle(options.hash ?? createHash('sha256').update(bytes).digest('hex'), sourcePath)))
  if (!sourcePath.includes('escape')) {
    const fs = await import('node:fs/promises')
    await fs.mkdir(dirname(sourceFile), { recursive: true })
    await writeFile(sourceFile, bytes)
  }
  await writeFile(manifestFile, manifestBytes)
  return { bytes, sourceFile, manifestFile, manifestBytes }
}

describe('spatial-inspect CLI', () => {
  it('parses standalone help and strict options, including a package-manager separator', () => {
    expect(parseSpatialInspectArguments(['--', '--input', 'bundle.json'])).toEqual({ input: 'bundle.json', format: 'json' })
    expect(parseSpatialInspectArguments(['--input', 'bundle.json', '--format', 'markdown'])).toEqual({ input: 'bundle.json', format: 'markdown' })
    expect(parseSpatialInspectArguments(['--help'])).toEqual({ help: true })
    for (const args of [[], ['--input'], ['--input', 'x', '--input', 'y'], ['--input', 'x', '--format', 'csv'], ['--input', 'x', '--bad'], ['--help', '--input', 'x']]) {
      expect(() => parseSpatialInspectArguments(args)).toThrow()
    }
  })

  it('replays synthetic source bytes deterministically without changing them or exposing paths/PCM', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spatial-inspect-'))
    try {
      const fixture = await writeFixture(directory)
      const before = await readFile(fixture.sourceFile)
      const first = await runSpatialInspect(['--input', fixture.manifestFile])
      const second = await runSpatialInspect(['--input', fixture.manifestFile])
      expect(first).toBe(second)
      const report = JSON.parse(first)
      expect(report.reportFormat).toBe('cha-spatial-inspection-v1')
      expect(report.sources[0].sha256).toBe(createHash('sha256').update(fixture.bytes).digest('hex'))
      expect(first).not.toContain(directory)
      expect(first).not.toContain('pcm16Base64')
      expect(await readFile(fixture.sourceFile)).toEqual(before)
      expect(await runSpatialInspect(['--input', fixture.manifestFile, '--format', 'markdown'])).toMatch(/Spatial inspection/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('replays the checked-in spatial fixture with exact hashes, transform direction, and explicit unknown registration', async () => {
    const fixtureDirectory = fileURLToPath(new URL('../packages/test-fixtures/spatial/', import.meta.url))
    const manifestPath = join(fixtureDirectory, 'bundle.json')
    const sourcePath = join(fixtureDirectory, 'echo-synthetic.json')
    const manifestBefore = await readFile(manifestPath)
    const sourceBefore = await readFile(sourcePath)
    expect(createHash('sha256').update(manifestBefore).digest('hex')).toBe('77eb77f9e6154c5f202525c132eadaef30e4c7eaf711b24c79dc8d824896c3d8')
    expect(createHash('sha256').update(sourceBefore).digest('hex')).toBe('23d118e0808c57c324531c67ffa622dadccd72993afed6d64c2322a16df4a768')

    const report = JSON.parse(await runSpatialInspect(['--input', manifestPath]))
    expect(report.manifest.sha256).toBe('77eb77f9e6154c5f202525c132eadaef30e4c7eaf711b24c79dc8d824896c3d8')
    expect(report.sources).toEqual([expect.objectContaining({ id: 'synthetic-room', sha256: '23d118e0808c57c324531c67ffa622dadccd72993afed6d64c2322a16df4a768' })])
    expect(report.observations.map((item: { id: string }) => item.id)).toEqual([
      'world-observation', 'rotated-frame-observation', 'unknown-frame-observation',
    ])
    expect(report.observations[0].speaker.world.positionM).toEqual([1, 1, 1.2])
    report.observations[1].speaker.world.positionM.forEach((value: number, index: number) => {
      expect(value).toBeCloseTo([2, 1, 1.2][index]!, 12)
    })
    expect(report.observations[2].speaker.world).toMatchObject({ status: 'unknown' })
    expect(await readFile(manifestPath)).toEqual(manifestBefore)
    expect(await readFile(sourcePath)).toEqual(sourceBefore)
  })

  it('uses report validation for hash, missing source, scan mode, and capture reference mismatches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spatial-inspect-'))
    try {
      const bytes = scanBytes()
      const badHash = await writeFixture(directory, { hash: '0'.repeat(64) })
      await expect(runSpatialInspect(['--input', badHash.manifestFile])).rejects.toThrow(/hash|SHA-?256/i)
      const invalidSourceWithBadHash = await writeFixture(join(directory, 'hash-before-parse'), { sourceBytes: Uint8Array.from([0xff, 0xfe]), hash: '0'.repeat(64) })
      await expect(runSpatialInspect(['--input', invalidSourceWithBadHash.manifestFile])).rejects.toThrow(/SHA256/)
      const source = parseSpatialBundle(JSON.stringify(bundle(createHash('sha256').update(bytes).digest('hex')))).sources[0]!
      expect(source.id).toBe('scan-a')

      const missingDir = join(directory, 'missing')
      const missing = await writeFixture(missingDir, { path: 'scans/missing.json' })
      await rm(join(missingDir, 'scans'), { recursive: true, force: true })
      await expect(runSpatialInspect(['--input', missing.manifestFile])).rejects.toThrow(/scan-a/)

      const wrongModeDir = join(directory, 'wrong-mode')
      const wrongModeBytes = Buffer.from(JSON.stringify({ format: 'cha-echo-scan-v3', mode: 'synthetic', fixture: { widthM: 5, depthM: 6 }, captures: [] }))
      const wrongMode = await writeFixture(wrongModeDir, { sourceBytes: wrongModeBytes })
      await expect(runSpatialInspect(['--input', wrongMode.manifestFile])).rejects.toThrow(/capture|synthetic|index/i)

      const modeMismatchDir = join(directory, 'mode-mismatch')
      const modeMismatch = await writeFixture(modeMismatchDir, { sourceBytes: bytes })
      const mismatchBundle = JSON.parse(JSON.stringify(bundle(createHash('sha256').update(bytes).digest('hex')))) as { observations: Array<{ captureRef: unknown }> }
      mismatchBundle.observations[0]!.captureRef = { kind: 'recorded', captureId: 'capture-a' }
      await writeFile(modeMismatch.manifestFile, JSON.stringify(mismatchBundle))
      await expect(runSpatialInspect(['--input', modeMismatch.manifestFile])).rejects.toThrow(/kind does not match|capture kind/i)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects oversized files, invalid UTF-8, directories and symlinks escaping the bundle root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spatial-inspect-'))
    try {
      const badUtf8 = await writeFixture(directory, { sourceBytes: Uint8Array.from([0xff, 0xfe]) })
      await expect(runSpatialInspect(['--input', badUtf8.manifestFile])).rejects.toThrow(/UTF-8/)

      const oversizedDir = join(directory, 'oversized')
      const oversized = await writeFixture(oversizedDir, { sourceBytes: Buffer.alloc(ECHO_SCAN_MAX_JSON_BYTES + 1) })
      await expect(runSpatialInspect(['--input', oversized.manifestFile])).rejects.toThrow(/limit/)

      const symlinkDir = join(directory, 'symlink')
      await (await import('node:fs/promises')).mkdir(join(symlinkDir, 'scans'), { recursive: true })
      const outside = join(directory, 'outside.json')
      const bytes = scanBytes()
      await writeFile(outside, bytes)
      await symlink(outside, join(symlinkDir, 'scans', 'synthetic.json'))
      const escaped = await writeFixture(symlinkDir, { path: 'scans/escape.json', sourceBytes: bytes })
      await rm(join(symlinkDir, 'scans', 'escape.json'), { force: true })
      await symlink(outside, join(symlinkDir, 'scans', 'escape.json'))
      // Re-write a matching manifest path so only the real-path boundary is under test.
      const manifestBytes = Buffer.from(JSON.stringify(bundle(createHash('sha256').update(bytes).digest('hex'), 'scans/escape.json')))
      await writeFile(escaped.manifestFile, manifestBytes)
      await expect(runSpatialInspect(['--input', escaped.manifestFile])).rejects.toThrow(/outside|scan-a/)

      const directorySource = await writeFixture(join(directory, 'directory-source'), { path: 'scans/synthetic.json' })
      await rm(directorySource.sourceFile)
      await (await import('node:fs/promises')).mkdir(directorySource.sourceFile)
      await expect(runSpatialInspect(['--input', directorySource.manifestFile])).rejects.toThrow(/regular file|scan-a/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects FIFOs without blocking and keeps filesystem paths out of diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spatial-inspect-'))
    try {
      const fifoDir = join(directory, 'fifo')
      const scans = join(fifoDir, 'scans')
      const fs = await import('node:fs/promises')
      await fs.mkdir(scans, { recursive: true })
      const fifoPath = join(scans, 'source.json')
      const fifo = spawnSync('mkfifo', [fifoPath])
      if (fifo.error || fifo.status !== 0) return
      const bytes = scanBytes()
      const manifestPath = join(fifoDir, 'bundle.json')
      await writeFile(manifestPath, JSON.stringify(bundle(createHash('sha256').update(bytes).digest('hex'), 'scans/source.json')))
      const startedAt = Date.now()
      await expect(runSpatialInspect(['--input', manifestPath])).rejects.toThrow(/regular file/)
      expect(Date.now() - startedAt).toBeLessThan(2000)

      const privatePath = join(directory, 'private-name-do-not-print', 'missing.json')
      await expect(runSpatialInspect(['--input', privatePath])).rejects.toThrow(/could not be opened/)
      await expect(runSpatialInspect([privatePath])).rejects.toThrow(/Unknown option/)
      try { await runSpatialInspect(['--input', privatePath]) } catch (error) {
        expect(String(error)).not.toContain(directory)
        expect(String(error)).not.toContain('private-name-do-not-print')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('bounds and strictly decodes the manifest before parsing, and keeps help I/O-free', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spatial-inspect-'))
    try {
      const invalid = join(directory, 'invalid.json')
      await writeFile(invalid, Uint8Array.from([0xff]))
      await expect(runSpatialInspect(['--input', invalid])).rejects.toThrow(/UTF-8/)
      const large = join(directory, 'large.json')
      await writeFile(large, Buffer.alloc(256 * 1024 + 1))
      await expect(runSpatialInspect(['--input', large])).rejects.toThrow(/limit/)
      expect(await runSpatialInspect(['--help'])).toBe(SPATIAL_INSPECT_USAGE)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('can execute help as a command and importing the module does not launch it', () => {
    const script = fileURLToPath(new URL('./spatial-inspect.ts', import.meta.url))
    const help = spawnSync('bun', [script, '--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toBe(SPATIAL_INSPECT_USAGE)
    expect(help.stderr).toBe('')
    const invalid = spawnSync('bun', [script, '--input'], { encoding: 'utf8' })
    expect(invalid.status).toBe(1)
    expect(invalid.stdout).toBe('')
    expect(invalid.stderr).toMatch(/requires a value/)
    const imported = spawnSync('bun', ['-e', `import(${JSON.stringify(script)}).then(() => process.stdout.write('imported'))`], { encoding: 'utf8' })
    expect(imported.status).toBe(0)
    expect(imported.stdout).toBe('imported')
    expect(imported.stderr).toBe('')
  })
})
