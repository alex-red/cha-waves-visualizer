import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCAL_AMBIGUITY_RULE } from '../../packages/spatial-stereo-local-ambiguity.ts'
import { STEREO_SETTINGS } from '../../packages/spatial-stereo-types.ts'
import { STEREO_SGM_SETTINGS } from '../../packages/spatial-stereo-sgm.ts'
import { decodeStereoLocalAttritionResult, loadStereoLocalAttritionCases } from './stereo-local-attrition-files.ts'

const hash = (digit: string) => digit.repeat(64)
const confidenceVariant = { id: 'no-variance-proposal', method: 'development-only-no-variance-proposal', textureGate: false }
const localVariant = { id: 'local-ambiguity-proposal', method: 'development-only-local-ambiguity-proposal', textureGate: false, localAmbiguityGate: true }

function record(source: 'confidence' | 'local') {
  const variant = source === 'confidence' ? confidenceVariant : localVariant
  const result = {
    status: 'empty', width: 160, height: 120, baselineM: 0.3, settings: { ...STEREO_SETTINGS },
    outcomes: new Array(160 * 120).fill(0),
    counts: { border: 160 * 120, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: 0 },
    points: [],
  }
  return {
    format: source === 'confidence' ? 'cha-stereo-confidence-result-v1' : 'cha-stereo-local-result-v1',
    developmentOnly: true, caseId: 'tiny-fixture', variant,
    inputSha256: hash('1'), sourceHashes: { left: hash('2'), right: hash('3') },
    censusSettings: { ...STEREO_SGM_SETTINGS },
    ...(source === 'local' ? { localAmbiguityRule: { ...LOCAL_AMBIGUITY_RULE } } : {}),
    reconstruction: result,
  }
}

function options(source: 'confidence' | 'local') {
  return {
    caseId: 'tiny-fixture', variantId: source === 'confidence' ? 'no-variance-proposal' as const : 'local-ambiguity-proposal' as const,
    expectedVariant: source === 'confidence' ? confidenceVariant : localVariant,
    inputSha256: hash('1'), leftSha256: hash('2'), rightSha256: hash('3'), source,
  }
}

describe('local attrition saved-result validation', () => {
  it('decodes the valid frozen confidence and local result envelopes', () => {
    for (const source of ['confidence', 'local'] as const) {
      const decoded = decodeStereoLocalAttritionResult(record(source), options(source))
      expect(decoded.status).toBe('empty')
      expect(decoded.outcomes).toHaveLength(160 * 120)
      expect(decoded.counts.accepted).toBe(0)
    }
  })

  it('rejects changed variant, lineage, rule, settings, and point/outcome accounting', () => {
    const mutations: ((value: ReturnType<typeof record>) => void)[] = [
      value => { value.variant = { ...value.variant, id: 'other-variant' } },
      value => { value.inputSha256 = hash('9') },
      value => { value.localAmbiguityRule = { ...LOCAL_AMBIGUITY_RULE, maxRawCensusCost: 5 } as unknown as typeof LOCAL_AMBIGUITY_RULE },
      value => { value.reconstruction.settings = { ...STEREO_SETTINGS, minDisparity: 5 } },
      value => { value.reconstruction.counts.border -= 1 },
      value => { value.reconstruction.outcomes[0] = 5 },
    ]
    for (const mutate of mutations) {
      const changed = record('local')
      mutate(changed)
      expect(() => decodeStereoLocalAttritionResult(changed, options('local'))).toThrow()
    }
    const changedConfidence = record('confidence')
    changedConfidence.variant = { ...confidenceVariant, id: 'local-ambiguity-proposal' }
    expect(() => decodeStereoLocalAttritionResult(changedConfidence, options('confidence'))).toThrow()
  })

  it('rejects placeholder score roots against the frozen score hash before loading case artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stereo-local-attrition-loader-'))
    const confidenceDirectory = join(root, 'confidence'), localDirectory = join(root, 'local')
    await Promise.all([mkdir(confidenceDirectory), mkdir(localDirectory)])
    try {
      await Promise.all([
        writeFile(join(confidenceDirectory, 'scores.json'), '{}'),
        writeFile(join(localDirectory, 'scores.json'), '{}'),
      ])
      const [confidencePin, localPin] = await Promise.all([
        readFile(new URL('../../docs/data/stereo-confidence.json', import.meta.url), 'utf8').then(JSON.parse),
        readFile(new URL('../../docs/data/stereo-local-ambiguity.json', import.meta.url), 'utf8').then(JSON.parse),
      ])
      await expect(loadStereoLocalAttritionCases(confidenceDirectory, localDirectory, confidencePin, localPin))
        .rejects.toThrow(/Saved scores\.json does not match the frozen score hash/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
