import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStereoAblationPins, createStereoHoldoutPins, runSpatialStereoAblate } from './spatial-stereo-ablate.ts'
import * as files from './lib/stereo-files.ts'
import * as ablation from '../packages/spatial-stereo-ablation.ts'

describe('development-only stereo ablation workflow', () => {
  it('matches committed data, controls and source hashes without estimating holdout images', async () => {
    const holdout = files.jsonBytes(createStereoHoldoutPins())
    const ablation = files.jsonBytes(await createStereoAblationPins())
    expect(Buffer.from(holdout).equals(await readFile(new URL('../docs/data/stereo-holdout-c.json', import.meta.url)))).toBe(true)
    expect(Buffer.from(ablation).equals(await readFile(new URL('../docs/data/stereo-ablation.json', import.meta.url)))).toBe(true)
    expect(await runSpatialStereoAblate(['--holdout-pins'])).toBe(new TextDecoder().decode(holdout))
    expect(await runSpatialStereoAblate(['--pins'])).toBe(new TextDecoder().decode(ablation))
  })

  it('requires explicit unique output and refuses evaluation or arbitrary input selection', async () => {
    expect(await runSpatialStereoAblate(['--help'])).toMatch(/^Usage:/)
    for (const args of [[], ['--output'], ['--output', 'x', '--output', 'y'], ['--split', 'evaluation', '--output', 'x'], ['--input', 'real.json', '--output', 'x'], ['--pins', '--output', 'x']]) await expect(runSpatialStereoAblate(args)).rejects.toThrow()
  })

  it('rejects a changed pin before calling any estimator or writing output', async () => {
    const originalRead = files.readBounded
    const estimate = vi.spyOn(ablation, 'runStereoAblationCase')
    vi.spyOn(files, 'readBounded').mockImplementation(async (path, maximum) => path.endsWith('/stereo-ablation.json') ? new TextEncoder().encode('{}') : originalRead(path, maximum))
    const root = await mkdtemp(join(tmpdir(), 'ablation-pin-reject-'))
    try {
      await expect(runSpatialStereoAblate(['--output', join(root, 'result')])).rejects.toThrow(/Frozen ablation/)
      expect(estimate).not.toHaveBeenCalled()
      await expect(readFile(join(root, 'result/ablation.json'))).rejects.toThrow()
    } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) }
  })

  it('retains every development outcome, preserves original method bytes and writes deterministic diagnostic reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-ablation-workflow-'))
    const originalSgmHashes = ['aabf0ebd6a3bf05f81689e88543fae170752037cf1aaa89fbd7eba980ff9a97b', '3e9b8afa26b968d9c6ee611d204b1e705003f680ffb8e94ee5a3f3779bda0ef0', '03360079673625decc30a1d0871565db30f2fec285babe33da8fbb0c72c1fc5d']
    try {
      const first = join(root, 'first'), second = join(root, 'second')
      const one = JSON.parse(await runSpatialStereoAblate(['--output', first]))
      const reportBytes = await readFile(join(first, 'ablation.json'))
      expect(files.sha256(reportBytes)).toBe(one.reportSha256)
      const report = JSON.parse(reportBytes.toString('utf8'))
      expect(report.diagnosticOnly).toBe(true)
      expect(report.split).toBe('development')
      expect(report.cases).toHaveLength(3)
      expect(report.summary).toHaveLength(9)
      expect(reportBytes.toString('utf8')).not.toContain('reconstructionMs')
      for (const [index, item] of report.cases.entries()) {
        expect(item.id).toMatch(/^dev-/)
        expect(item.split).toBe('development')
        expect(item.variants).toHaveLength(9)
        expect(files.sha256(await readFile(join(first, `${item.id}-input.json`)))).toBe(item.inputSha256)
        for (const variant of item.variants) {
          expect(Object.values(variant.outcomes).reduce((a, b) => Number(a) + Number(b), 0)).toBe(19200)
          expect(variant.geometry.validTruthPixels).toBe(19200)
        }
        for (const result of item.results) expect(files.sha256(await readFile(join(first, result.fileName)))).toBe(result.sha256)
        const reference = JSON.parse(await readFile(join(first, `${item.id}-census-sgm.json`), 'utf8'))
        const original = files.stereoResultSchema.parse({ format: 'cha-stereo-result-v1', inputSha256: reference.inputSha256, algorithm: 'rectified-census-sgm-v1', sourceHashes: reference.sourceHashes, reconstruction: reference.reconstruction, algorithmSettings: reference.censusSettings })
        expect(files.sha256(files.jsonBytes(original))).toBe(originalSgmHashes[index])
      }
      const runtime = JSON.parse(await readFile(join(first, 'runtime.json'), 'utf8'))
      expect(runtime).toHaveLength(27)
      expect(runtime.every((item: { caseId: string; reconstructionMs: number }) => item.caseId.startsWith('dev-') && Number.isFinite(item.reconstructionMs) && item.reconstructionMs >= 0)).toBe(true)
      const two = JSON.parse(await runSpatialStereoAblate(['--output', second]))
      expect(two.reportSha256).toBe(one.reportSha256)
      expect((await readFile(join(second, 'ablation.json'))).equals(reportBytes)).toBe(true)
      await writeFile(join(first, 'keep.txt'), 'preserved')
      await expect(runSpatialStereoAblate(['--output', first])).rejects.toThrow()
      expect(await readFile(join(first, 'keep.txt'), 'utf8')).toBe('preserved')
      expect((await readFile(join(first, 'ablation.json'))).equals(reportBytes)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 20_000)
})
