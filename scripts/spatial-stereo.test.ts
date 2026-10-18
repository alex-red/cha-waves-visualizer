import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVisualManifest, inspectSplatAsset } from '../packages/spatial-visual.ts'
import { createStereoFixtureFiles } from './spatial-stereo-fixture.ts'
import { runSpatialStereo } from './spatial-stereo.ts'
import { runSpatialStereoEvaluate } from './spatial-stereo-evaluate.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, sha256 } from './lib/stereo-files.ts'

async function fixture(root: string) {
  const files = createStereoFixtureFiles()
  await installNewDirectory(join(root, 'training'), files.training)
  await installNewDirectory(join(root, 'evaluation'), files.evaluation)
  return { input: join(root, 'training/input.json'), evaluation: join(root, 'evaluation/evaluation.json'), files }
}

describe('stereo workflow CLI boundaries', () => {
  it('requires explicit, unique options and separate input/output paths', async () => {
    expect(parseFileArguments(['--', '--input', 'x', '--output', 'y'], ['--input', '--output'])).toEqual({ '--input': 'x', '--output': 'y' })
    for (const args of [[], ['--input'], ['--bad', 'x'], ['--input', 'a', '--input', 'b'], ['--help', '--input', 'a']]) expect(() => parseFileArguments(args, ['--input', '--output'])).toThrow()
    expect(await runSpatialStereo(['--help'])).toMatch(/^Usage:/)
    expect(await runSpatialStereoEvaluate(['--help'])).toMatch(/^Usage:/)
  })

  it('reconstructs without evaluator files, retains all outcomes and exports deterministic original bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-workflow-'))
    try {
      const { input, files } = await fixture(root)
      await rm(join(root, 'evaluation'), { recursive: true })
      const first = join(root, 'first'), second = join(root, 'second')
      const one = JSON.parse(await runSpatialStereo(['--input', input, '--output', first]))
      const two = JSON.parse(await runSpatialStereo(['--input', input, '--output', second]))
      expect(one.inputSha256).toBe('caeaf104bd0d6e75420045d78179e2af765606eaac5b93f3f24a657c55271c0f')
      expect(one.resultSha256).toBe('e3801402601ad05fa2c9c830909b3b642e28f2f01dea18021277c39a55868ec5')
      expect(two.resultSha256).toBe(one.resultSha256)
      expect(one.pointCount).toBe(14599)
      expect(Object.values(one.counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(19200)
      const manifest = parseVisualManifest(await readFile(join(first, 'manifest.json'), 'utf8'))
      const asset = await readFile(join(first, 'reconstruction.splat'))
      expect(sha256(asset)).toBe(manifest.asset.sha256)
      expect(sha256(asset)).toBe('232305feb7f48cee4e2598803259a7173e00db04f7050ba9e0bf3b05e038e13c')
      expect((await readFile(join(first, 'manifest.json'))).equals(await readFile(new URL('../apps/web/public/research/stereo/manifest.json', import.meta.url)))).toBe(true)
      expect(asset.equals(await readFile(new URL('../apps/web/public/research/stereo/reconstruction.splat', import.meta.url)))).toBe(true)
      expect(inspectSplatAsset(asset).splatCount).toBe(14599)
      expect(manifest.provenance.kind).toBe('image-reconstruction')
      expect(manifest.cameras.map(camera => camera.role)).toEqual(['training', 'training'])
      for (const name of ['reconstruction.json', 'reconstruction.ply', 'manifest.json', 'reconstruction.splat']) expect((await readFile(join(first, name))).equals(await readFile(join(second, name)))).toBe(true)
      expect(new Uint8Array(await readFile(input))).toEqual(files.training['input.json'])
      await expect(runSpatialStereo(['--input', input, '--output', first])).rejects.toThrow()
      expect(sha256(await readFile(join(first, 'reconstruction.json')))).toBe(one.resultSha256)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('evaluates the frozen split, retains the large error tail, and rejects training-view leakage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-evaluation-'))
    try {
      const { input, evaluation } = await fixture(root)
      await runSpatialStereo(['--input', input, '--output', join(root, 'result')])
      const args = ['--input', input, '--result', join(root, 'result/reconstruction.json'), '--evaluation', evaluation, '--output', join(root, 'scores')]
      const report = JSON.parse(await runSpatialStereoEvaluate(args))
      expect((await readFile(join(root, 'scores/report.json'))).equals(await readFile(new URL('../apps/web/public/research/stereo/report.json', import.meta.url)))).toBe(true)
      expect(report.passed).toBe(true)
      expect(report.evaluation.reference.depthP90M).toBeCloseTo(0.0424843038, 8)
      expect(report.evaluation.reference.depthMaxM).toBeGreaterThan(1.6)
      expect(report.evaluation.reference.unevaluatedAcceptedCount).toBe(0)
      expect(report.evaluation.heldOut).toHaveLength(2)
      expect(report.evaluation.heldOut[0].allPixelMae).toBeGreaterThan(report.evaluation.heldOut[0].coveredMae)
      expect(report.evaluationInputSha256).toBe('da1e6092fc1463b2bb251eb87ebfc9dde178fafeb439520a6baa15ef9058b4aa')
      const bad = JSON.parse(await readFile(evaluation, 'utf8'))
      bad.heldOut[0].image.camera.id = 'stereo-right'
      await writeFile(evaluation, jsonBytes(bad))
      await expect(runSpatialStereoEvaluate([...args.slice(0, -1), join(root, 'leaked')])).rejects.toThrow(/training/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('retains an empty corrupt-image result and reports failed gates with CLI status 2', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-negative-'))
    try {
      const { input, evaluation } = await fixture(root)
      const rightPath = join(root, 'training/right.ppm')
      const right = new Uint8Array(await readFile(rightPath))
      right.fill(0, right.length - 160 * 120 * 3)
      await writeFile(rightPath, right)
      const manifest = JSON.parse(await readFile(input, 'utf8'))
      manifest.right.sha256 = sha256(right)
      const inputBytes = jsonBytes(manifest)
      await writeFile(input, inputBytes)
      const control = JSON.parse(await readFile(evaluation, 'utf8'))
      control.inputSha256 = sha256(inputBytes)
      await writeFile(evaluation, jsonBytes(control))
      const reconstruction = JSON.parse(await runSpatialStereo(['--input', input, '--output', join(root, 'result')]))
      expect(reconstruction.status).toBe('empty')
      expect(reconstruction.pointCount).toBe(0)
      await expect(readFile(join(root, 'result/manifest.json'))).rejects.toThrow()
      const args = ['--input', input, '--result', join(root, 'result/reconstruction.json'), '--evaluation', evaluation, '--output', join(root, 'scores')]
      const report = JSON.parse(await runSpatialStereoEvaluate(args))
      expect(report.passed).toBe(false)
      expect(report.evaluation.reference.depthP90M).toBeNull()
      expect(report.evaluation.heldOut.every((score: { coverage: number }) => score.coverage === 0)).toBe(true)
      const child = spawnSync('bun', ['scripts/spatial-stereo-evaluate.ts', ...args.slice(0, -1), join(root, 'child-scores')], { encoding: 'utf8' })
      expect(child.status).toBe(2)
      expect(JSON.parse(child.stdout).passed).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects wrong hashes, escaping links, invalid calibration and tampered result lineage before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-invalid-'))
    try {
      const { input, evaluation, files } = await fixture(root)
      const manifest = JSON.parse(await readFile(input, 'utf8'))
      manifest.left.sha256 = '0'.repeat(64)
      await writeFile(input, jsonBytes(manifest))
      await expect(runSpatialStereo(['--input', input, '--output', join(root, 'bad')])).rejects.toThrow(/SHA256/)
      await writeFile(input, files.training['input.json']!)
      await runSpatialStereo(['--input', input, '--output', join(root, 'result')])
      const resultPath = join(root, 'result/reconstruction.json')
      const result = JSON.parse(await readFile(resultPath, 'utf8'))
      result.inputSha256 = 'f'.repeat(64)
      await writeFile(resultPath, jsonBytes(result))
      await expect(runSpatialStereoEvaluate(['--input', input, '--result', resultPath, '--evaluation', evaluation, '--output', join(root, 'bad-report')])).rejects.toThrow(/SHA256/)
      await rm(join(root, 'training/right.ppm'))
      await writeFile(join(root, 'outside.ppm'), files.training['right.ppm']!)
      await symlink(join(root, 'outside.ppm'), join(root, 'training/right.ppm'))
      await expect(runSpatialStereo(['--input', input, '--output', join(root, 'bad-link')])).rejects.toThrow(/directory/)
      const incompatible = JSON.parse(await readFile(input, 'utf8'))
      incompatible.settings.minDisparity = incompatible.settings.maxDisparity
      await writeFile(input, jsonBytes(incompatible))
      await expect(runSpatialStereo(['--input', input, '--output', join(root, 'bad-settings')])).rejects.toThrow(/settings/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
