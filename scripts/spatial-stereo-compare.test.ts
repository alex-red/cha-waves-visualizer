import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from './lib/stereo-files.ts'
import { createStereoComparisonPins, runSpatialStereoCompare } from './spatial-stereo-compare.ts'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stereo-compare-test-'))
  temporaryRoots.push(root)
  return root
}

describe('stereo comparison pins and CLI', () => {
  it('matches the committed source, truth, region, setting, and split pin bytes exactly', async () => {
    const committed = new Uint8Array(await readFile(new URL('../docs/data/stereo-comparison-cases.json', import.meta.url)))
    const generated = new TextEncoder().encode(JSON.stringify(createStereoComparisonPins(), null, 2) + '\n')
    expect(generated).toEqual(committed)
  })

  it('accepts help and rejects unknown, repeated, incomplete, and invalid split arguments before running', async () => {
    await expect(runSpatialStereoCompare(['--help'])).resolves.toMatch(/^Usage:/)
    await expect(runSpatialStereoCompare(['--split', 'development', '--output', '/tmp/out', '--other', 'x'])).rejects.toThrow(/Unknown, repeated or missing option/)
    await expect(runSpatialStereoCompare(['--split', 'development', '--split', 'evaluation', '--output', '/tmp/out'])).rejects.toThrow(/Unknown, repeated or missing option/)
    await expect(runSpatialStereoCompare(['--split', 'development'])).rejects.toThrow(/Missing required option/)
    await expect(runSpatialStereoCompare(['--split', 'sealed', '--output', '/tmp/out'])).rejects.toThrow(/Split must be development or evaluation/)
  })

  it('writes deterministic development report bytes and keeps measured runtime in its own file', async () => {
    const root = await tempRoot()
    const first = join(root, 'first')
    const second = join(root, 'second')
    const output1 = JSON.parse(await runSpatialStereoCompare(['--split', 'development', '--output', first]))
    expect(output1.reportSha256).toBe('ea94602dd8f0c7ce5bb281bbbbd19567c0046b40f66cac28db397211eddb0540')
    const report1 = new Uint8Array(await readFile(join(first, 'comparison.json')))
    const runtime1 = JSON.parse(await readFile(join(first, 'runtime.json'), 'utf8')) as { id: string; comparisonMs: number }[]
    expect(output1.reportSha256).toBe(sha256(report1))
    expect(runtime1).toHaveLength(3)
    expect(runtime1.every(item => item.id.startsWith('dev-') && Number.isFinite(item.comparisonMs) && item.comparisonMs >= 0)).toBe(true)
    expect(new TextDecoder().decode(report1)).not.toContain('comparisonMs')

    const output2 = JSON.parse(await runSpatialStereoCompare(['--split', 'development', '--output', second]))
    const report2 = new Uint8Array(await readFile(join(second, 'comparison.json')))
    expect(report2).toEqual(report1)
    expect(output2.reportSha256).toBe(output1.reportSha256)
    const report = JSON.parse(new TextDecoder().decode(report1))
    expect(report.split).toBe('development')
    expect(report.cases).toHaveLength(3)
    expect(report.cases.every((item: { split: string; id: string }) => item.split === 'development' && item.id.startsWith('dev-'))).toBe(true)
    const firstCase = report.cases[0]
    const inputBytes = new Uint8Array(await readFile(join(first, `${firstCase.id}-input.json`)))
    const input = JSON.parse(new TextDecoder().decode(inputBytes))
    const baselineBytes = new Uint8Array(await readFile(join(first, `${firstCase.id}-baseline.json`)))
    const baselineResult = JSON.parse(new TextDecoder().decode(baselineBytes))
    expect(baselineResult.inputSha256).toBe(sha256(inputBytes))
    expect(baselineResult.sourceHashes).toEqual({ left: input.left.sha256, right: input.right.sha256 })
    expect(firstCase.baselineResultSha256).toBe(sha256(baselineBytes))
  }, 20_000)

  it('does not replace an existing CLI output directory', async () => {
    const root = await tempRoot()
    const target = join(root, 'existing')
    await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'original')
    await expect(runSpatialStereoCompare(['--split', 'development', '--output', target])).rejects.toThrow()
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('original')
    expect(await readFile(join(target, 'comparison.json')).catch(() => null)).toBeNull()
  })
})
