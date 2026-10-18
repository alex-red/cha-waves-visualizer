import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVisualManifest } from '../packages/spatial-visual.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { createStereoFixtureFiles } from './spatial-stereo-fixture.ts'
import { runSpatialStereo } from './spatial-stereo.ts'
import { runSpatialStereoEvaluate } from './spatial-stereo-evaluate.ts'
import { runSpatialStereoSgm } from './spatial-stereo-sgm.ts'
import { installNewDirectory, sha256, stereoResultSchema } from './lib/stereo-files.ts'

async function installFixture(root: string) {
  const fixture = createStereoFixtureFiles()
  await installNewDirectory(join(root, 'training'), fixture.training)
  await installNewDirectory(join(root, 'evaluation'), fixture.evaluation)
  return {
    input: join(root, 'training/input.json'),
    evaluation: join(root, 'evaluation/evaluation.json'),
  }
}

describe('explicit Census SGM CLI contract', () => {
  it('records candidate settings, keeps SAD as the default, and carries candidate metadata through evaluation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-sgm-cli-'))
    try {
      const { input, evaluation } = await installFixture(root)
      const candidateDir = join(root, 'candidate')
      const sadDir = join(root, 'sad')
      await runSpatialStereoSgm(['--input', input, '--output', candidateDir])
      await runSpatialStereo(['--input', input, '--output', sadDir])

      const candidate = JSON.parse(await readFile(join(candidateDir, 'reconstruction.json'), 'utf8')) as unknown
      const sad = JSON.parse(await readFile(join(sadDir, 'reconstruction.json'), 'utf8')) as Record<string, unknown>
      expect(stereoResultSchema.safeParse(candidate).success).toBe(true)
      const candidateFile = stereoResultSchema.parse(candidate)
      expect(candidateFile.algorithm).toBe('rectified-census-sgm-v1')
      expect(candidateFile.algorithmSettings).toEqual(STEREO_SGM_SETTINGS)
      const candidateWithoutSettings = { ...candidateFile }
      delete candidateWithoutSettings.algorithmSettings
      expect(stereoResultSchema.safeParse(candidateWithoutSettings).success).toBe(false)
      expect(stereoResultSchema.safeParse({ ...candidateFile, algorithmSettings: { ...STEREO_SGM_SETTINGS, extra: true } }).success).toBe(false)

      expect(stereoResultSchema.safeParse(sad).success).toBe(true)
      expect(sad.algorithm).toBe('rectified-rgb-sad-v1')
      expect(sad).not.toHaveProperty('algorithmSettings')
      expect(stereoResultSchema.safeParse({ ...sad, algorithmSettings: STEREO_SGM_SETTINGS }).success).toBe(false)

      const candidateManifest = parseVisualManifest(await readFile(join(candidateDir, 'manifest.json'), 'utf8'))
      const sadManifest = parseVisualManifest(await readFile(join(sadDir, 'manifest.json'), 'utf8'))
      expect(candidateManifest.id).toContain('census-sgm')
      expect(candidateManifest.label).toContain('Census/SGM')
      expect(candidateManifest.provenance.method).toContain('rectifiedCensusSgm')
      expect(candidateManifest.label).not.toBe(sadManifest.label)
      expect(candidateManifest.provenance.method).not.toBe(sadManifest.provenance.method)

      const reportDir = join(root, 'candidate-scores')
      await runSpatialStereoEvaluate([
        '--input', input,
        '--result', join(candidateDir, 'reconstruction.json'),
        '--evaluation', evaluation,
        '--output', reportDir,
      ])
      const report = JSON.parse(await readFile(join(reportDir, 'report.json'), 'utf8'))
      expect(report.algorithm).toBe('rectified-census-sgm-v1')
      expect(report.algorithmSettings).toEqual(STEREO_SGM_SETTINGS)
      expect(report.resultSha256).toBe(sha256(await readFile(join(candidateDir, 'reconstruction.json'))))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
