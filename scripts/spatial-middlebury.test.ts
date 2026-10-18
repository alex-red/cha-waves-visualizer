import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStereoFixtureFiles } from './spatial-stereo-fixture.ts'
import { installNewDirectory, jsonBytes, sha256 } from './lib/stereo-files.ts'
import { decodePngRgb, runSpatialMiddlebury, type SourcePin } from './spatial-middlebury.ts'

function syntheticSource() {
  const width = 32, height = 24
  const calibration = new TextEncoder().encode(`cam0=[40 0 15; 0 40 11; 0 0 1]\ncam1=[40 0 17; 0 40 11; 0 0 1]\ndoffs=2\nbaseline=200\nwidth=${width}\nheight=${height}\nndisp=4\nvmin=999\nvmax=9999\n`)
  const header = new TextEncoder().encode(`Pf\n${width} ${height}\n-1\n`)
  const truth = new Uint8Array(header.length + width * height * 4)
  truth.set(header)
  const view = new DataView(truth.buffer)
  for (let index = 0; index < width * height; index++) view.setFloat32(header.length + index * 4, index === 0 ? Infinity : 2, true)
  const originals = { 'calib.txt': calibration, 'im0.png': Uint8Array.of(1, 2, 3), 'im1.png': Uint8Array.of(4, 5, 6), 'disp0.pfm': truth }
  const pin: SourcePin = {
    format: 'cha-middlebury-source-pin-v1', dataset: 'Synthetic codec test', sourceUrl: 'https://vision.middlebury.edu/synthetic/', license: { name: 'MIT synthetic test', url: 'https://vision.middlebury.edu/stereo/data/', attribution: 'Self-authored test bytes; no real images.' },
    preparation: { width, height, minDisparity: 1, maxDisparity: 4, version: 'area-rgb-nearest-truth-v1' },
    sources: Object.fromEntries(Object.entries(originals).map(([name, bytes]) => [name, { url: `https://vision.middlebury.edu/synthetic/${name}`, sha256: sha256(bytes), bytes: bytes.length }])) as SourcePin['sources'],
  }
  const decodePng = (bytes: Uint8Array) => ({ width, height, rgb: new Uint8Array(width * height * 3).fill(bytes[0]!) })
  return { pin, originals, decodePng }
}

describe('bounded real-image preparation workflow with synthetic inputs', () => {
  it('selects either pinned dataset and keeps the default Adirondack selection', async () => {
    const requests: string[] = []
    const fetchImpl = (async (url: URL | RequestInfo) => {
      requests.push(String(url))
      return new Response(null, { status: 503 })
    }) as typeof fetch

    for (const [args, expected] of [
      [['fetch', '--output', 'unused'], 'https://vision.middlebury.edu/stereo/data/scenes2014/datasets/Adirondack-perfect/calib.txt'],
      [['fetch', '--dataset', 'adirondack', '--output', 'unused'], 'https://vision.middlebury.edu/stereo/data/scenes2014/datasets/Adirondack-perfect/calib.txt'],
      [['fetch', '--dataset', 'motorcycle', '--output', 'unused'], 'https://vision.middlebury.edu/stereo/data/scenes2014/datasets/Motorcycle-perfect/calib.txt'],
    ] as const) {
      const before = requests.length
      await expect(runSpatialMiddlebury(args, { fetchImpl })).rejects.toThrow(/download failed/)
      expect(requests.slice(before)).toEqual([expected])
    }
  })

  it('rejects duplicate, invalid, and missing dataset values', async () => {
    for (const args of [
      ['fetch', '--dataset', 'adirondack', '--dataset', 'motorcycle', '--output', 'unused'],
      ['fetch', '--dataset', 'unknown', '--output', 'unused'],
      ['fetch', '--dataset', '--output', 'unused'],
      ['fetch', '--dataset'],
    ]) {
      await expect(runSpatialMiddlebury(args)).rejects.toThrow(/Choose one supported dataset/)
    }
  })

  it('uses a motorcycle artifact id while preserving an injected Adirondack pin metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'middlebury-selector-'))
    try {
      const source = syntheticSource()
      source.pin.dataset = 'Middlebury 2014 Adirondack-perfect'
      source.pin.sourceUrl = 'https://vision.middlebury.edu/stereo/data/scenes2014/datasets/Adirondack-perfect/'
      const metadataBefore = structuredClone(source.pin)
      await installNewDirectory(join(root, 'original'), source.originals)
      await runSpatialMiddlebury([
        'prepare', '--dataset', 'motorcycle', '--source', join(root, 'original'), '--output', join(root, 'prepared'),
      ], source)
      const input = JSON.parse(await readFile(join(root, 'prepared/input.json'), 'utf8'))
      expect(input.id).toBe('middlebury-motorcycle-perfect')
      expect(input.provenance.notes).toContain(metadataBefore.dataset)
      expect(input.provenance.notes).toContain(metadataBefore.sourceUrl)
      expect(source.pin).toEqual(metadataBefore)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('prepares calibrated RGB without opening truth, reproduces bytes and preserves original hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'middlebury-prepare-'))
    try {
      const source = syntheticSource()
      const { 'disp0.pfm': unusedTruth, ...training } = source.originals
      expect(unusedTruth.length).toBeGreaterThan(0)
      await installNewDirectory(join(root, 'original'), training)
      const args = ['prepare', '--source', join(root, 'original'), '--output', join(root, 'prepared')]
      const summary = JSON.parse(await runSpatialMiddlebury(args, source))
      const input = JSON.parse(await readFile(join(root, 'prepared/input.json'), 'utf8'))
      expect(input.provenance.kind).toBe('recorded')
      expect(input.left.camera.intrinsics.cx).toBe(15.5)
      expect(input.right.camera.intrinsics.cx).toBe(17.5)
      expect(input.right.camera.positionM).toEqual([0.2, 0, 0])
      expect(input.settings.maxDisparity).toBe(4)
      expect(summary.inputSha256).toBe(sha256(await readFile(join(root, 'prepared/input.json'))))
      expect(input).not.toHaveProperty('truth')
      const second = JSON.parse(await runSpatialMiddlebury([...args.slice(0, -1), join(root, 'second')], source))
      expect(second.inputSha256).toBe(summary.inputSha256)
      expect((await readFile(join(root, 'original/im0.png'))).equals(source.originals['im0.png'])).toBe(true)
      await expect(runSpatialMiddlebury(args, source)).rejects.toThrow()
      await writeFile(join(root, 'original/im1.png'), Uint8Array.of(9))
      await expect(runSpatialMiddlebury([...args.slice(0, -1), join(root, 'bad')], source)).rejects.toThrow(/SHA256|size|bounded/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('prepares separately linked truth with missing samples and rejects mismatched calibration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'middlebury-truth-'))
    try {
      const source = syntheticSource()
      await installNewDirectory(join(root, 'original'), source.originals)
      await runSpatialMiddlebury(['prepare', '--source', join(root, 'original'), '--output', join(root, 'prepared')], source)
      const inputPath = join(root, 'prepared/input.json')
      const args = ['truth', '--source', join(root, 'original'), '--input', inputPath, '--output', join(root, 'truth')]
      const summary = JSON.parse(await runSpatialMiddlebury(args, source))
      expect(summary.missingTruthPixels).toBe(1)
      const truth = JSON.parse(await readFile(join(root, 'truth/truth.json'), 'utf8'))
      expect(truth.inputSha256).toBe(sha256(await readFile(inputPath)))
      const bytes = await readFile(join(root, 'truth/disparity.f32'))
      expect(sha256(bytes)).toBe(truth.disparity.sha256)
      expect(bytes.readFloatLE(0)).toBe(2)
      expect(Number.isNaN(bytes.readFloatLE((24 - 1) * 32 * 4))).toBe(true)
      const input = JSON.parse(await readFile(inputPath, 'utf8'))
      input.left.camera.intrinsics.cx += 1
      await writeFile(inputPath, jsonBytes(input))
      await expect(runSpatialMiddlebury([...args.slice(0, -1), join(root, 'bad')], source)).rejects.toThrow(/calibration/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('fetches only explicit pinned HTTPS sources, rejects changed bytes and installs no partial download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'middlebury-fetch-'))
    try {
      const source = syntheticSource()
      let calls = 0
      const fetchImpl = (async (url: URL | RequestInfo) => {
        calls++
        const name = new URL(String(url)).pathname.split('/').at(-1)! as keyof typeof source.originals
        return new Response(source.originals[name])
      }) as typeof fetch
      const output = join(root, 'download')
      await runSpatialMiddlebury(['fetch', '--output', output], { ...source, fetchImpl })
      expect(calls).toBe(4)
      expect((await readFile(join(output, 'disp0.pfm'))).equals(source.originals['disp0.pfm'])).toBe(true)
      const changed = (async () => new Response(Uint8Array.of(1))) as typeof fetch
      await expect(runSpatialMiddlebury(['fetch', '--output', join(root, 'changed')], { ...source, fetchImpl: changed })).rejects.toThrow(/SHA256|size/)
      await expect(readFile(join(root, 'changed/calib.txt'))).rejects.toThrow()
      source.pin.sources['calib.txt'].url = 'https://example.com/no'
      await expect(runSpatialMiddlebury(['fetch', '--output', join(root, 'foreign')], { ...source, fetchImpl })).rejects.toThrow(/official/)
      source.pin.sources['calib.txt'].url = 'https://vision.middlebury.edu/synthetic/calib.txt'
      source.pin.sources['im0.png'].bytes = 64 * 1024 * 1024
      await expect(runSpatialMiddlebury(['fetch', '--output', join(root, 'oversize')], { ...source, fetchImpl })).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('requires explicit modes/options and cannot use unrelated synthetic fixture calibration', async () => {
    expect(() => decodePngRgb(new Uint8Array())).toThrow(/byte limit/)
    expect(await runSpatialMiddlebury(['--help'])).toMatch(/^Usage:/)
    await expect(runSpatialMiddlebury([])).rejects.toThrow(/Choose/)
    await expect(runSpatialMiddlebury(['prepare', '--source', 'x'])).rejects.toThrow(/Missing/)
    const root = await mkdtemp(join(tmpdir(), 'middlebury-unrelated-'))
    try {
      const source = syntheticSource()
      await installNewDirectory(join(root, 'original'), source.originals)
      await installNewDirectory(join(root, 'unrelated'), createStereoFixtureFiles().training)
      await expect(runSpatialMiddlebury(['truth', '--source', join(root, 'original'), '--input', join(root, 'unrelated/input.json'), '--output', join(root, 'truth')], source)).rejects.toThrow(/calibration/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
