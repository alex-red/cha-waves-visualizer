import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STEREO_OUTCOMES } from '../packages/spatial-stereo-types.ts'
import { createStereoFixtureFiles } from './spatial-stereo-fixture.ts'
import { runSpatialStereo } from './spatial-stereo.ts'
import { runSpatialStereoGeometry, stereoGeometryTruthSchema } from './spatial-stereo-geometry.ts'
import { installNewDirectory, jsonBytes, sha256 } from './lib/stereo-files.ts'

async function prepare(root: string) {
  const files = createStereoFixtureFiles()
  const training = join(root, 'training')
  await installNewDirectory(training, files.training)
  const inputPath = join(training, 'input.json')
  const inputBytes = await readFile(inputPath)
  const input = JSON.parse(inputBytes.toString('utf8'))
  const resultDir = join(root, 'result')
  await runSpatialStereo(['--input', inputPath, '--output', resultDir])
  const resultBytes = await readFile(join(resultDir, 'reconstruction.json'))
  const result = JSON.parse(resultBytes.toString('utf8'))
  return { inputPath, inputBytes, input, resultDir, resultBytes, result }
}

async function writeTruth(root: string, inputBytes: Uint8Array, input: any, result: any, allMissing = false) {
  const pixelCount = result.reconstruction.width * result.reconstruction.height
  const disparity = new Float32Array(pixelCount)
  const depth = new Float32Array(pixelCount)
  disparity.fill(Number.NaN)
  depth.fill(Number.NaN)
  if (!allMissing) {
    for (const point of result.reconstruction.points) {
      disparity[point.pixelIndex] = point.disparityPx
      depth[point.pixelIndex] = input.left.camera.positionM[2] - point.positionM[2]
    }
    const missingEstimate = result.reconstruction.outcomes.findIndex((code: number) => code !== STEREO_OUTCOMES.indexOf('accepted'))
    if (missingEstimate >= 0) {
      disparity[missingEstimate] = 0
      depth[missingEstimate] = 2
    }
  }
  const encode = (values: Float32Array): Uint8Array<ArrayBuffer> => {
    const bytes = new Uint8Array(values.length * 4)
    const view = new DataView(bytes.buffer)
    values.forEach((value, index) => view.setFloat32(index * 4, value, true))
    return bytes
  }
  const disparityBytes = encode(disparity), depthBytes = encode(depth)
  const truthDir = join(root, 'truth')
  await installNewDirectory(truthDir, { 'disparity.f32': disparityBytes, 'depth.f32': depthBytes })
  const truth = stereoGeometryTruthSchema.parse({
    format: 'cha-stereo-geometry-truth-v1', inputSha256: sha256(inputBytes), camera: input.left.camera,
    disparity: { fileName: 'disparity.f32', sha256: sha256(disparityBytes) },
    depth: { fileName: 'depth.f32', sha256: sha256(depthBytes) },
    provenance: { dataset: 'synthetic CLI test', sourceUrl: 'https://example.test/synthetic', method: 'generated from synthetic reconstruction for CLI boundary testing', notes: 'No real data.' },
  })
  const truthBytes = jsonBytes(truth)
  const truthPath = join(truthDir, 'truth.json')
  await writeFile(truthPath, truthBytes)
  return { truthPath, truthBytes, truth }
}

describe('spatial stereo geometry CLI', () => {
  it('exports a strict truth schema and requires explicit unique file arguments', async () => {
    expect(stereoGeometryTruthSchema.safeParse({}).success).toBe(false)
    expect(await runSpatialStereoGeometry(['--help'])).toMatch(/^Usage:/)
    for (const args of [[], ['--input', 'x'], ['--input', 'x', '--input', 'y']]) {
      await expect(runSpatialStereoGeometry(args)).rejects.toThrow()
    }
  })

  it('binds camera and hashes, writes deterministic geometry-only metrics, and retains missing support', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-geometry-cli-'))
    try {
      const prepared = await prepare(root)
      const truth = await writeTruth(root, prepared.inputBytes, prepared.input, prepared.result)
      const output = join(root, 'scores')
      const args = ['--input', prepared.inputPath, '--result', join(prepared.resultDir, 'reconstruction.json'), '--truth', truth.truthPath, '--output', output]
      const summary = JSON.parse(await runSpatialStereoGeometry(args))
      const reportBytes = await readFile(join(output, 'report.json'))
      const report = JSON.parse(reportBytes.toString('utf8'))
      expect(summary.passed).toBe(true)
      expect(summary.reportSha256).toBe(sha256(reportBytes))
      expect(report.inputSha256).toBe(sha256(prepared.inputBytes))
      expect(report.resultSha256).toBe(sha256(prepared.resultBytes))
      expect(report.truthSha256).toBe(sha256(truth.truthBytes))
      expect(report.provenance.geometryTruth.dataset).toBe('synthetic CLI test')
      expect(report.evaluation.acceptedPixels).toBe(prepared.result.reconstruction.points.length)
      expect(report.evaluation.acceptedWithoutTruth).toBe(0)
      expect(report.evaluation.unestimatedTruthPixels).toBe(1)
      expect(report.evaluation.truthCoverage).toBeLessThan(1)
      expect(report.evaluation.worstErrors).toHaveLength(Math.min(10, prepared.result.reconstruction.points.length))
      expect(report.limitations.join(' ')).toMatch(/no held-out camera-view/)

      const wrongCamera = { ...truth.truth, camera: { ...truth.truth.camera, intrinsics: { ...truth.truth.camera.intrinsics, cx: truth.truth.camera.intrinsics.cx + 1 } } }
      await writeFile(truth.truthPath, jsonBytes(wrongCamera))
      await expect(runSpatialStereoGeometry([...args.slice(0, -1), join(root, 'bad-camera')])).rejects.toThrow(/exactly match/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects lineage mismatch and writes a failed zero-truth report with process exit status 2', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-geometry-fail-'))
    try {
      const prepared = await prepare(root)
      const zeroTruth = await writeTruth(root, prepared.inputBytes, prepared.input, prepared.result, true)
      const args = ['--input', prepared.inputPath, '--result', join(prepared.resultDir, 'reconstruction.json'), '--truth', zeroTruth.truthPath, '--output', join(root, 'scores')]
      const corrupted = { ...zeroTruth.truth, inputSha256: 'f'.repeat(64) }
      await writeFile(zeroTruth.truthPath, jsonBytes(corrupted))
      await expect(runSpatialStereoGeometry(args)).rejects.toThrow(/SHA256 mismatch/)

      await writeFile(zeroTruth.truthPath, jsonBytes(zeroTruth.truth))
      const summary = JSON.parse(await runSpatialStereoGeometry(args))
      expect(summary.passed).toBe(false)
      const report = JSON.parse(await readFile(join(root, 'scores/report.json'), 'utf8'))
      expect(report.evaluation.validTruthPixels).toBe(0)
      expect(report.evaluation.truthCoverage).toBeNull()
      expect(report.evaluation.gates.passed).toBe(false)

      const child = spawnSync('bun', ['scripts/spatial-stereo-geometry.ts', ...args.slice(0, -1), join(root, 'child-scores')], { encoding: 'utf8' })
      expect(child.status).toBe(2)
      expect(JSON.parse(child.stdout).passed).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
