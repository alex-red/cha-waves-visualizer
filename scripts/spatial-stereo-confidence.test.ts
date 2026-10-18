import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStereoConfidencePins, runSpatialStereoConfidence } from './spatial-stereo-confidence.ts'
import { runStereoConfidenceWorker } from './spatial-stereo-confidence-worker.ts'
import { createStereoConfidenceCases } from '../packages/test-fixtures/stereo-confidence.ts'
import { STEREO_CONFIDENCE_VARIANTS } from '../packages/spatial-stereo-confidence.ts'
import { STEREO_SETTINGS } from '../packages/spatial-stereo-types.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { runStereoResourceChild } from './lib/stereo-resource-runner.ts'
import * as files from './lib/stereo-files.ts'
import { prepareStereoConfidenceCase } from './lib/stereo-confidence-files.ts'

vi.mock('./lib/stereo-resource-runner.ts', () => ({ runStereoResourceChild: vi.fn() }))

let preparedFakeCases: Map<string, ReturnType<typeof prepareStereoConfidenceCase>> | undefined

function fakeCaseData(caseId: string) {
  if (!preparedFakeCases) {
    preparedFakeCases = new Map(createStereoConfidenceCases().map(control => [control.fixture.id, prepareStereoConfidenceCase(control)]))
  }
  const prepared = preparedFakeCases.get(caseId)
  if (!prepared) throw new Error(`Unknown mocked confidence case: ${caseId}`)
  return prepared
}

function fakeWorker(command: readonly string[]) {
  const caseId = command[command.indexOf('--case') + 1]!, variantId = command[command.indexOf('--variant') + 1]!
  const prepared = fakeCaseData(caseId)
  const variant = STEREO_CONFIDENCE_VARIANTS.find(item => item.id === variantId)!
  const record = { format: 'cha-stereo-confidence-result-v1', developmentOnly: true, caseId, variant, inputSha256: files.sha256(prepared.manifestBytes), sourceHashes: { left: prepared.manifest.left.sha256, right: prepared.manifest.right.sha256 }, censusSettings: variant.id === 'sad-baseline' ? null : STEREO_SGM_SETTINGS, reconstruction: { status: 'empty', width: 160, height: 120, baselineM: 0.3, settings: STEREO_SETTINGS, outcomes: Array(19200).fill(0), counts: { border: 19200, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 }, points: [] } }
  const checkpoint = { format: 'cha-stereo-confidence-resource-v1', peakRssBytes: 32 * 1024 * 1024, reconstructionMs: 0, rssCheckpoint: 'after-result-serialization-and-stdout-flush', runtime: 'mock synthetic worker', platform: 'test', architecture: 'test' }
  return { status: 'completed' as const, exitCode: 0, wallTimeMs: 10, sampledPeakRssBytes: 30 * 1024 * 1024, stdout: JSON.stringify(record) + '\n' + JSON.stringify(checkpoint) + '\n', stderr: '' }
}

describe('confidence workflow boundaries and trial retention', () => {
  it('reproduces the pinned sources/rules without estimators and forbids arbitrary input or holdout options', async () => {
    expect(files.jsonBytes(await createStereoConfidencePins())).toEqual(new Uint8Array(await readFile(new URL('../docs/data/stereo-confidence.json', import.meta.url))))
    expect(await runSpatialStereoConfidence(['--help'])).toMatch(/^Usage:/)
    expect(await runSpatialStereoConfidence(['--pins'])).toBe(new TextDecoder().decode(files.jsonBytes(await createStereoConfidencePins())))
    for (const args of [[], ['--output'], ['--output', 'a', '--output', 'b'], ['--input', 'real.json', '--output', 'x'], ['--split', 'evaluation', '--output', 'x']]) await expect(runSpatialStereoConfidence(args)).rejects.toThrow()
    expect(runStereoResourceChild).not.toHaveBeenCalled()
  })

  it('rejects changed implementation/rule pins before starting a worker', async () => {
    const originalRead = files.readBounded
    vi.spyOn(files, 'readBounded').mockImplementation((path, maximum) => path.endsWith('/stereo-confidence.json') ? Promise.resolve(new TextEncoder().encode('{}')) : originalRead(path, maximum))
    try { await expect(runSpatialStereoConfidence(['--output', '/tmp/never-installed-confidence'])).rejects.toThrow(/Frozen confidence/); expect(runStereoResourceChild).not.toHaveBeenCalled() }
    finally { vi.restoreAllMocks() }
  })

  it('retains all 27 slots and a failed child while keeping resources separate from scores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'confidence-cli-test-'))
    const mocked = vi.mocked(runStereoResourceChild)
    mocked.mockImplementation(async options => fakeWorker(options.command))
    mocked.mockImplementationOnce(async () => ({ status: 'timeout', exitCode: null, wallTimeMs: 30000, sampledPeakRssBytes: 1024, stdout: '', stderr: 'controlled timeout' }))
    try {
      const output = join(root, 'result')
      const summary = JSON.parse(await runSpatialStereoConfidence(['--output', output]))
      expect(mocked).toHaveBeenCalledTimes(27)
      expect(summary.eligible).toBe(false)
      const scoreBytes = await readFile(join(output, 'scores.json')), scores = JSON.parse(scoreBytes.toString('utf8'))
      const runtime = JSON.parse(await readFile(join(output, 'resource-runtime.json'), 'utf8'))
      const decision = JSON.parse(await readFile(join(output, 'decision.json'), 'utf8'))
      expect(scores.cases).toHaveLength(9)
      expect(scores.cases.flatMap((item: { variants: unknown[] }) => item.variants)).toHaveLength(27)
      expect(scores.cases[0].variants[0].score).toBeNull()
      expect(runtime).toHaveLength(27)
      expect(runtime.filter((trial: { completed: boolean }) => trial.completed)).toHaveLength(26)
      expect(runtime[0].workerStatus).toBe('timeout')
      expect(summary.gates.everyTrialResource).toBe(false)
      expect(scores).not.toHaveProperty('resourceSummary')
      expect(scoreBytes.toString('utf8')).not.toContain('wallTimeMs')
      expect(scoreBytes.toString('utf8')).not.toContain('sampledPeakRssBytes')
      expect(decision.scoresSha256).toBe(files.sha256(scoreBytes))
      expect(decision.runtimeSha256).toBe(files.sha256(await readFile(join(output, 'resource-runtime.json'))))
      expect(await readFile(join(output, 'dev-textured-tilt-occluder-a-sad-baseline.stderr.txt'), 'utf8')).toBe('controlled timeout')
      for (const item of scores.cases) for (const artifact of item.artifacts) expect(files.sha256(await readFile(join(output, artifact.fileName)))).toBe(artifact.sha256)
      await expect(runSpatialStereoConfidence(['--output', output])).rejects.toThrow()
      expect((await readFile(join(output, 'scores.json'))).equals(scoreBytes)).toBe(true)
    } finally { mocked.mockReset(); await rm(root, { recursive: true, force: true }) }
  }, 20_000)

  it('rejects an unknown internal worker case, proposal or hash without reconstructing', () => {
    for (const args of [[], ['--case', 'holdout-c-textured-tilt', '--variant', 'census-sgm', '--input-sha256', '0'.repeat(64)], ['--case', 'x', '--variant', 'unknown', '--input-sha256', '0'.repeat(64)], ['--case', 'dev-textured-tilt-occluder-a', '--variant', 'census-sgm', '--input-sha256', 'invalid']]) expect(() => runStereoConfidenceWorker(args)).toThrow()
  })
})
