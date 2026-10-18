import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStereoLocalAttritionPins, runSpatialStereoLocalAttrition } from './spatial-stereo-local-attrition.ts'
import { STEREO_LOCAL_ATTRITION_PINS } from './lib/stereo-local-attrition-files.ts'
import * as savedFiles from './lib/stereo-local-attrition-files.ts'
import * as files from './lib/stereo-files.ts'
import { inspectStereoLocalEvidence, poolStereoLocalAttrition, scoreStereoLocalAttrition } from '../packages/spatial-stereo-local-attrition.ts'

vi.mock('../packages/spatial-stereo-local-attrition.ts', () => ({
  inspectStereoLocalEvidence: vi.fn(() => [{ pixelIndex: 11, retainedByEvidence: true }]),
  scoreStereoLocalAttrition: vi.fn((evidence: unknown[]) => ({ format: 'cha-stereo-local-attrition-v1', evidenceCount: evidence.length, partitions: {}, directions: {}, regions: {}, unsupported: {} })),
  poolStereoLocalAttrition: vi.fn((scores: unknown[]) => ({ format: 'cha-stereo-local-attrition-pooled-v1', caseCount: scores.length, pointCount: scores.length })),
}))

function mockLoadedCases() {
  return [
    ['dev-textured-tilt-occluder-a', 'positive'],
    ['dev-weak-stripe-repeated-a', 'positive'],
    ['dev-exposure-tilt-occluder-a', 'positive'],
    ['confidence-positive-exposure-noise', 'positive'],
    ['confidence-positive-low-contrast', 'positive'],
    ['confidence-negative-uniform', 'negative'],
    ['confidence-negative-independent-noise', 'negative'],
    ['confidence-negative-periodic-stripes', 'negative'],
    ['confidence-negative-right-patch', 'negative'],
  ].map(([id, role]) => ({
    id, role, input: {} as never, truth: {} as never, regions: {}, unsupportedPixels: [], base: {} as never, filtered: {} as never,
    lineage: { inputSha256: '1'.repeat(64), leftSha256: '2'.repeat(64), rightSha256: '3'.repeat(64), truthSha256: '4'.repeat(64), regionsSha256: '5'.repeat(64), unsupportedSha256: '6'.repeat(64), confidenceResultSha256: '7'.repeat(64), localResultSha256: '8'.repeat(64) },
  }))
}

function mockPinReader(bytes: Uint8Array<ArrayBuffer>) {
  const originalRead = files.readBounded
  return vi.spyOn(files, 'readBounded').mockImplementation((path, maximum) => path.endsWith('/stereo-local-attrition.json')
    ? Promise.resolve(bytes)
    : originalRead(path, maximum))
}

describe('saved-array local attrition workflow', () => {
  it('hashes fixed metadata without loading saved outputs or running estimators', async () => {
    const pins = await createStereoLocalAttritionPins()
    const loadSpy = vi.spyOn(savedFiles, 'loadStereoLocalAttritionCases')
    expect(pins.format).toBe('cha-stereo-local-attrition-pins-v1')
    expect(pins.sourceInputs).toHaveLength(9)
    expect(pins.confidenceScoresSha256).toBe(STEREO_LOCAL_ATTRITION_PINS.confidenceScores)
    expect(pins.localScoresSha256).toBe(STEREO_LOCAL_ATTRITION_PINS.localScores)
    expect(await runSpatialStereoLocalAttrition(['--pins'])).toBe(new TextDecoder().decode(files.jsonBytes(pins)))
    expect(inspectStereoLocalEvidence).not.toHaveBeenCalled()
    expect(scoreStereoLocalAttrition).not.toHaveBeenCalled()
    expect(loadSpy).not.toHaveBeenCalled()
    loadSpy.mockRestore()
  })

  it('enforces strict paired-input arguments and frozen pin verification before loading directories', async () => {
    await expect(runSpatialStereoLocalAttrition(['--help'])).resolves.toMatch(/^Usage:/)
    for (const args of [
      [], ['--confidence', 'a'], ['--confidence', 'a', '--local', 'b'],
      ['--confidence', 'a', '--local', 'b', '--output', 'c', '--output', 'd'],
      ['--confidence', 'a', '--local', 'b', '--output', 'c', '--split', 'evaluation'],
    ]) await expect(runSpatialStereoLocalAttrition(args)).rejects.toThrow()
    const badPin = mockPinReader(files.jsonBytes({ changed: true }))
    const loadSpy = vi.spyOn(savedFiles, 'loadStereoLocalAttritionCases')
    try {
      await expect(runSpatialStereoLocalAttrition(['--confidence', 'saved-a', '--local', 'saved-b', '--output', '/tmp/unused-attrition-output'])).rejects.toThrow(/Frozen local attrition/)
      expect(loadSpy).not.toHaveBeenCalled()
    } finally {
      loadSpy.mockRestore()
      badPin.mockRestore()
    }
  })

  it('scores all nine saved pairs, pools only the five positives, and writes deterministic non-overwriting reports', async () => {
    const pins = await createStereoLocalAttritionPins()
    const pinReader = mockPinReader(files.jsonBytes(pins))
    const loadSpy = vi.spyOn(savedFiles, 'loadStereoLocalAttritionCases').mockResolvedValue(mockLoadedCases() as never)
    const root = await mkdtemp(join(tmpdir(), 'stereo-local-attrition-test-'))
    try {
      const first = join(root, 'first'), second = join(root, 'second')
      const args = (output: string) => ['--confidence', '/saved/confidence', '--local', '/saved/local', '--output', output]
      const summaryA = JSON.parse(await runSpatialStereoLocalAttrition(args(first)))
      const summaryB = JSON.parse(await runSpatialStereoLocalAttrition(args(second)))
      expect(summaryA.cases).toBe(9)
      expect(summaryA.estimatorInvoked).toBe(false)
      expect(summaryB.reportSha256).toBe(summaryA.reportSha256)
      expect(loadSpy).toHaveBeenCalledTimes(2)
      expect(loadSpy).toHaveBeenCalledWith('/saved/confidence', '/saved/local', expect.any(Object), expect.any(Object))
      expect(inspectStereoLocalEvidence).toHaveBeenCalledTimes(18)
      expect(scoreStereoLocalAttrition).toHaveBeenCalledTimes(18)
      expect(poolStereoLocalAttrition).toHaveBeenNthCalledWith(1, expect.arrayContaining([expect.any(Object)]))
      expect(vi.mocked(poolStereoLocalAttrition).mock.calls[0]![0]).toHaveLength(5)

      const reportA = await readFile(join(first, 'report.json'))
      const reportB = await readFile(join(second, 'report.json'))
      expect(reportA.equals(reportB)).toBe(true)
      const report = JSON.parse(reportA.toString('utf8'))
      expect(report.format).toBe('cha-stereo-local-attrition-report-v1')
      expect(report.cases).toHaveLength(9)
      expect(report.pooledPositive.caseCount).toBe(5)
      expect(report).not.toHaveProperty('eligibility')
      expect(report).not.toHaveProperty('resourceSummary')
      const evidenceA = await readFile(join(first, 'dev-textured-tilt-occluder-a-evidence.json'))
      const evidenceB = await readFile(join(second, 'dev-textured-tilt-occluder-a-evidence.json'))
      expect(evidenceA.equals(evidenceB)).toBe(true)
      await expect(runSpatialStereoLocalAttrition(args(first))).rejects.toThrow()
    } finally {
      loadSpy.mockRestore()
      pinReader.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })
})
