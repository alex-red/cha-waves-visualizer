import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStereoLocalPins, runSpatialStereoLocalAmbiguity } from './spatial-stereo-local-ambiguity.ts'
import { runStereoLocalAmbiguityWorker } from './spatial-stereo-local-ambiguity-worker.ts'
import { createStereoConfidenceCases } from '../packages/test-fixtures/stereo-confidence.ts'
import { LOCAL_SCREEN_VARIANTS } from '../packages/spatial-stereo-local-screen.ts'
import { LOCAL_AMBIGUITY_RULE } from '../packages/spatial-stereo-local-ambiguity.ts'
import { STEREO_SETTINGS } from '../packages/spatial-stereo-types.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { runStereoResourceChild } from './lib/stereo-resource-runner.ts'
import * as files from './lib/stereo-files.ts'
import { prepareStereoConfidenceCase } from './lib/stereo-confidence-files.ts'
import * as confidenceScoring from '../packages/spatial-stereo-confidence.ts'

vi.mock('./lib/stereo-resource-runner.ts', () => ({ runStereoResourceChild: vi.fn() }))

function fakeWorker(command: readonly string[]) {
  const caseId = command[command.indexOf('--case') + 1]!
  const variantId = command[command.indexOf('--variant') + 1]!
  const control = createStereoConfidenceCases().find(item => item.fixture.id === caseId)!
  const prepared = prepareStereoConfidenceCase(control)
  const variant = LOCAL_SCREEN_VARIANTS.find(item => item.id === variantId)!
  const record = {
    format: 'cha-stereo-local-result-v1', developmentOnly: true, caseId, variant,
    localAmbiguityRule: variant.id === 'local-ambiguity-proposal' ? LOCAL_AMBIGUITY_RULE : null,
    inputSha256: files.sha256(prepared.manifestBytes),
    sourceHashes: { left: prepared.manifest.left.sha256, right: prepared.manifest.right.sha256 },
    censusSettings: variant.id === 'sad-baseline' ? null : STEREO_SGM_SETTINGS,
    reconstruction: {
      status: 'empty', width: 160, height: 120, baselineM: 0.3, settings: STEREO_SETTINGS,
      outcomes: Array(19200).fill(0),
      counts: { border: 19200, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 },
      points: [],
    },
  }
  const checkpoint = { format: 'cha-stereo-local-resource-v1', peakRssBytes: 32 * 1024 * 1024, reconstructionMs: 0, rssCheckpoint: 'after-result-serialization-and-stdout-flush', runtime: 'mock synthetic worker', platform: 'test', architecture: 'test' }
  return { status: 'completed' as const, exitCode: 0, wallTimeMs: 10, sampledPeakRssBytes: 30 * 1024 * 1024, stdout: JSON.stringify(record) + '\n' + JSON.stringify(checkpoint) + '\n', stderr: '' }
}

function pinReader() {
  const originalRead = files.readBounded
  return vi.spyOn(files, 'readBounded').mockImplementation((path, maximum) => path.endsWith('/stereo-local-ambiguity.json')
    ? Promise.resolve(files.jsonBytes({}))
    : originalRead(path, maximum))
}

describe('local ambiguity workflow boundaries and trial retention', () => {
  it('prints fixed pins without estimating and rejects arbitrary or evaluation options', async () => {
    const pins = await createStereoLocalPins()
    const bytes = files.jsonBytes(pins)
    expect(pins.variants.map(item => item.id)).toEqual(['sad-baseline', 'census-sgm', 'local-ambiguity-proposal'])
    expect(pins.cases).toHaveLength(9)
    expect(pins.confidenceDataPinSha256).toBe('a16437db6d648aa454df23b05c8ab465997f40720728f85f89a3cefe9ff15879')
    expect(await runSpatialStereoLocalAmbiguity(['--pins'])).toBe(new TextDecoder().decode(bytes))
    expect(await runSpatialStereoLocalAmbiguity(['--help'])).toMatch(/^Usage:/)
    for (const args of [[], ['--output'], ['--output', 'a', '--output', 'b'], ['--input', 'real.json', '--output', 'x'], ['--split', 'evaluation', '--output', 'x']]) {
      await expect(runSpatialStereoLocalAmbiguity(args)).rejects.toThrow()
    }
    expect(runStereoResourceChild).not.toHaveBeenCalled()
  })

  it('rejects changed frozen pins before starting any worker', async () => {
    const mockedReader = pinReader()
    try {
      await expect(runSpatialStereoLocalAmbiguity(['--output', '/tmp/never-installed-local-screen'])).rejects.toThrow(/Frozen local-ambiguity/)
      expect(runStereoResourceChild).not.toHaveBeenCalled()
    } finally {
      mockedReader.mockRestore()
    }
  })

  it('retains all 27 trials and keeps result hashes separate from runtime measurements', async () => {
    const pinBytes = files.jsonBytes(await createStereoLocalPins())
    const originalRead = files.readBounded
    const mockedReader = vi.spyOn(files, 'readBounded').mockImplementation((path, maximum) => path.endsWith('/stereo-local-ambiguity.json')
      ? Promise.resolve(pinBytes)
      : originalRead(path, maximum))
    const root = await mkdtemp(join(tmpdir(), 'local-stereo-cli-test-'))
    const mocked = vi.mocked(runStereoResourceChild)
    mocked.mockImplementation(async options => fakeWorker(options.command))
    mocked.mockImplementationOnce(async () => ({ status: 'timeout', exitCode: null, wallTimeMs: 30_000, sampledPeakRssBytes: 1024, stdout: '', stderr: 'controlled timeout' }))
    const originalScore = confidenceScoring.scoreStereoConfidence
    let injectScoringFailure = true
    const scoreSpy = vi.spyOn(confidenceScoring, 'scoreStereoConfidence').mockImplementation((control, result, reference) => {
      if (injectScoringFailure && control.fixture.id === 'dev-textured-tilt-occluder-a') {
        injectScoringFailure = false
        throw new Error('controlled scoring failure')
      }
      return originalScore(control, result, reference)
    })
    try {
      const output = join(root, 'result')
      const summary = JSON.parse(await runSpatialStereoLocalAmbiguity(['--output', output]))
      expect(mocked).toHaveBeenCalledTimes(27)
      expect(summary.eligible).toBe(false)
      const scoreBytes = await readFile(join(output, 'scores.json'))
      const scores = JSON.parse(scoreBytes.toString('utf8'))
      const runtimeBytes = await readFile(join(output, 'resource-runtime.json'))
      const runtime = JSON.parse(runtimeBytes.toString('utf8'))
      const decision = JSON.parse(await readFile(join(output, 'decision.json'), 'utf8'))
      expect(scores.format).toBe('cha-stereo-local-scores-v1')
      expect(scores.cases).toHaveLength(9)
      expect(scores.cases.flatMap((item: { variants: unknown[] }) => item.variants)).toHaveLength(27)
      expect(scores.cases[0].variants[0].score).toBeNull()
      expect(runtime).toHaveLength(27)
      expect(runtime.filter((trial: { completed: boolean }) => trial.completed)).toHaveLength(25)
      expect(runtime[0].workerStatus).toBe('timeout')
      expect(summary.gates.everyTrialResource).toBe(false)
      expect(runtime[1].completed).toBe(false)
      expect(runtime[1].error).toBe('controlled scoring failure')
      expect(runtime[1].osCheckpointPeakRssBytes).toBe(32 * 1024 * 1024)
      expect(runtime[1].sampledPeakRssBytes).toBe(30 * 1024 * 1024)
      expect(runtime[1].peakRssBytes).toBe(32 * 1024 * 1024)
      expect(runtime[1].rssCheckpoint).toBe('after-result-serialization-and-stdout-flush')
      expect(scores).not.toHaveProperty('resourceSummary')
      expect(scoreBytes.toString('utf8')).not.toContain('wallTimeMs')
      expect(scoreBytes.toString('utf8')).not.toContain('sampledPeakRssBytes')
      expect(decision.localPinsSha256).toBe(files.sha256(pinBytes))
      expect(decision.scoresSha256).toBe(files.sha256(scoreBytes))
      expect(decision.runtimeSha256).toBe(files.sha256(runtimeBytes))
      expect(await readFile(join(output, 'dev-textured-tilt-occluder-a-sad-baseline.stderr.txt'), 'utf8')).toBe('controlled timeout')
      expect(await readFile(join(output, 'dev-textured-tilt-occluder-a-census-sgm.stdout.txt'), 'utf8')).toContain('cha-stereo-local-result-v1')
      for (const item of scores.cases) for (const artifact of item.artifacts) {
        expect(files.sha256(await readFile(join(output, artifact.fileName))).toString()).toBe(artifact.sha256)
      }
      await expect(runSpatialStereoLocalAmbiguity(['--output', output])).rejects.toThrow()
      expect((await readFile(join(output, 'scores.json'))).equals(scoreBytes)).toBe(true)
    } finally {
      mocked.mockReset()
      scoreSpy.mockRestore()
      mockedReader.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('rejects unknown internal cases, variants and hashes before reconstruction', () => {
    const validHash = '0'.repeat(64)
    for (const args of [
      [],
      ['--case', 'holdout-c-textured-tilt', '--variant', 'census-sgm', '--input-sha256', validHash],
      ['--case', 'confidence-positive-low-contrast', '--variant', 'unknown', '--input-sha256', validHash],
      ['--case', 'confidence-positive-low-contrast', '--variant', 'census-sgm', '--input-sha256', 'invalid'],
    ]) expect(() => runStereoLocalAmbiguityWorker(args)).toThrow()
  })
})
