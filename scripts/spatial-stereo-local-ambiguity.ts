import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStereoConfidenceCases } from '../packages/test-fixtures/stereo-confidence.ts'
import { evaluateStereoLocalEligibility, LOCAL_SCREEN_VARIANTS, type LocalScreenCaseScore, type LocalScreenResource } from '../packages/spatial-stereo-local-screen.ts'
import { scoreStereoConfidence } from '../packages/spatial-stereo-confidence.ts'
import { LOCAL_AMBIGUITY_RULE } from '../packages/spatial-stereo-local-ambiguity.ts'
import { STEREO_SETTINGS } from '../packages/spatial-stereo-types.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { STEREO_GEOMETRY_GATES } from '../packages/spatial-stereo-geometry.ts'
import { STEREO_COMPARISON_GATES } from '../packages/spatial-stereo-comparison.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, readBounded, sha256, stereoResultSchema } from './lib/stereo-files.ts'
import { pinStereoConfidenceCase, prepareStereoConfidenceCase } from './lib/stereo-confidence-files.ts'
import { runStereoResourceChild, type StereoResourceChildResult } from './lib/stereo-resource-runner.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PIN = fileURLToPath(new URL('../docs/data/stereo-local-ambiguity.json', import.meta.url))
const CONFIDENCE_PIN = fileURLToPath(new URL('../docs/data/stereo-confidence.json', import.meta.url))
const HOLDOUT = fileURLToPath(new URL('../docs/data/stereo-holdout-c.json', import.meta.url))
const CONFIDENCE_SHA = 'a16437db6d648aa454df23b05c8ab465997f40720728f85f89a3cefe9ff15879'
const HOLDOUT_SHA = '8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781'
const WORKER = fileURLToPath(new URL('./spatial-stereo-local-ambiguity-worker.ts', import.meta.url))
const EXPECTED_VARIANTS = ['sad-baseline', 'census-sgm', 'local-ambiguity-proposal']
const SOURCES = [
  'packages/spatial-stereo-local-screen.ts',
  'packages/spatial-stereo-local-ambiguity.ts',
  'packages/spatial-stereo-confidence.ts',
  'packages/test-fixtures/stereo-confidence.ts',
  'packages/test-fixtures/stereo-development.ts',
  'packages/spatial-stereo.ts',
  'packages/spatial-stereo-sgm.ts',
  'packages/spatial-stereo-types.ts',
  'packages/spatial-stereo-geometry.ts',
  'packages/spatial-stereo-comparison.ts',
  'packages/spatial-stereo-ablation.ts',
  'packages/spatial-ppm.ts',
  'scripts/lib/stereo-reference-files.ts',
  'scripts/lib/stereo-confidence-files.ts',
  'scripts/lib/stereo-files.ts',
  'scripts/lib/stereo-resource-runner.ts',
  'scripts/spatial-stereo-local-ambiguity.ts',
  'scripts/spatial-stereo-local-ambiguity-worker.ts',
] as const

/** Hash the development-only controls and source contract; never opens holdout contents. */
export async function createStereoLocalPins() {
  const [holdoutBytes, confidenceBytes] = await Promise.all([readBounded(HOLDOUT, 32 * 1024), readBounded(CONFIDENCE_PIN, 64 * 1024)])
  if (sha256(holdoutBytes) !== HOLDOUT_SHA) throw new Error('Reserved holdout pin changed.')
  if (sha256(confidenceBytes) !== CONFIDENCE_SHA) throw new Error('Frozen confidence source data pin changed.')
  const confidencePin = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(confidenceBytes))
  if (JSON.stringify(confidencePin.settings) !== JSON.stringify(STEREO_SETTINGS) || JSON.stringify(confidencePin.censusSettings) !== JSON.stringify(STEREO_SGM_SETTINGS)
    || JSON.stringify(confidencePin.absoluteGates) !== JSON.stringify(STEREO_GEOMETRY_GATES) || JSON.stringify(confidencePin.relativeGates) !== JSON.stringify(STEREO_COMPARISON_GATES)
    || JSON.stringify(confidencePin.confidenceGates) !== JSON.stringify({ maximumUnsupportedFraction: 0.01, maxWallTimeMs: 30_000, maxPeakRssBytes: 512 * 1024 * 1024 })) throw new Error('Shared confidence settings or gates changed.')
  if (JSON.stringify(LOCAL_SCREEN_VARIANTS.map(variant => variant.id)) !== JSON.stringify(EXPECTED_VARIANTS)) throw new Error('Local-screen variant set or order changed.')
  const cases = createStereoConfidenceCases().map(pinStereoConfidenceCase)
  if (JSON.stringify(cases) !== JSON.stringify(confidencePin.cases)) throw new Error('Local-screen cases differ from the frozen confidence inputs or masks.')
  const implementationSources = []
  for (const path of SOURCES) implementationSources.push({ path, sha256: sha256(await readBounded(resolve(ROOT, path), 128 * 1024)) })
  return {
    format: 'cha-stereo-local-ambiguity-pins-v1',
    split: 'development',
    confidenceDataPinSha256: CONFIDENCE_SHA,
    reservedHoldoutSha256: HOLDOUT_SHA,
    settings: STEREO_SETTINGS,
    censusSettings: STEREO_SGM_SETTINGS,
    localAmbiguityRule: LOCAL_AMBIGUITY_RULE,
    variants: LOCAL_SCREEN_VARIANTS,
    absoluteGates: STEREO_GEOMETRY_GATES,
    relativeGates: STEREO_COMPARISON_GATES,
    confidenceGates: confidencePin.confidenceGates,
    implementationSources,
    cases,
  }
}

/** Decode the result/resource line pair and validate core result shape before scoring. */
function decodeWorker(output: StereoResourceChildResult, caseId: string, variant: typeof LOCAL_SCREEN_VARIANTS[number], prepared: ReturnType<typeof prepareStereoConfidenceCase>) {
  if (output.exitCode !== 0 || (output.status !== 'completed' && output.status !== 'measurement-unavailable')) throw new Error(`Worker ${output.status}.`)
  const lines = output.stdout.trim().split('\n')
  if (lines.length !== 2) throw new Error('Incomplete worker result/resource records.')
  const record = JSON.parse(lines[0]!)
  const resource = JSON.parse(lines[1]!)
  const proposalRule = variant.id === 'local-ambiguity-proposal' ? LOCAL_AMBIGUITY_RULE : null
  if (record.format !== 'cha-stereo-local-result-v1' || record.developmentOnly !== true || record.caseId !== caseId
    || JSON.stringify(record.variant) !== JSON.stringify(variant) || JSON.stringify(record.localAmbiguityRule) !== JSON.stringify(proposalRule)
    || record.inputSha256 !== sha256(prepared.manifestBytes) || record.sourceHashes?.left !== prepared.manifest.left.sha256 || record.sourceHashes?.right !== prepared.manifest.right.sha256
    || JSON.stringify(record.censusSettings) !== JSON.stringify(variant.id === 'sad-baseline' ? null : STEREO_SGM_SETTINGS)) throw new Error('Worker lineage/configuration mismatch.')
  const algorithm = variant.id === 'sad-baseline' ? 'rectified-rgb-sad-v1' : 'rectified-census-sgm-v1'
  const checked = stereoResultSchema.parse({ format: 'cha-stereo-result-v1', inputSha256: record.inputSha256, sourceHashes: record.sourceHashes, algorithm, ...(variant.id === 'sad-baseline' ? {} : { algorithmSettings: STEREO_SGM_SETTINGS }), reconstruction: record.reconstruction })
  if (JSON.stringify(checked.reconstruction.settings) !== JSON.stringify(STEREO_SETTINGS)) throw new Error('Worker matching settings changed.')
  if (resource.format !== 'cha-stereo-local-resource-v1' || resource.rssCheckpoint !== 'after-result-serialization-and-stdout-flush'
    || !Number.isFinite(resource.peakRssBytes) || resource.peakRssBytes <= 0 || !Number.isFinite(resource.reconstructionMs) || resource.reconstructionMs < 0) throw new Error('Worker OS resource measurement unavailable.')
  return {
    record,
    result: { ...checked.reconstruction, outcomes: Uint8Array.from(checked.reconstruction.outcomes) },
    resource: resource as { peakRssBytes: number; reconstructionMs: number; rssCheckpoint: string; runtime: string; platform: string; architecture: string },
  }
}

export async function runSpatialStereoLocalAmbiguity(args: readonly string[]): Promise<string> {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--pins') return new TextDecoder().decode(jsonBytes(await createStereoLocalPins()))
  const options = parseFileArguments(values, ['--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo:local -- --output <new-directory>\nFixed local-ambiguity proposal and development controls only. No arbitrary input/evaluation option.\nUse --pins alone to generate data/settings/source hashes without estimation.\n'
  const pinBytes = await readBounded(PIN, 64 * 1024)
  const pins = await createStereoLocalPins()
  if (sha256(pinBytes) !== sha256(jsonBytes(pins))) throw new Error('Frozen local-ambiguity data, rule or implementation sources changed.')
  const files: Record<string, Uint8Array | string> = {}
  const cases: (LocalScreenCaseScore & { inputSha256: string; artifacts: { variantId: string; fileName: string; sha256: string }[] })[] = []
  const runtime: (LocalScreenResource & { workerStatus: StereoResourceChildResult['status']; exitCode: number | null; osCheckpointPeakRssBytes: number | null; reconstructionMs: number | null; error: string | null; rssCheckpoint: string | null; workerRuntime: string | null; platform: string | null; architecture: string | null })[] = []
  for (const control of createStereoConfidenceCases()) {
    const fixture = control.fixture
    const prepared = prepareStereoConfidenceCase(control)
    const inputSha256 = sha256(prepared.manifestBytes)
    files[`${fixture.id}-input.json`] = prepared.manifestBytes
    files[prepared.manifest.left.fileName] = prepared.left
    files[prepared.manifest.right.fileName] = prepared.right
    files[`${fixture.id}-truth.json`] = jsonBytes(fixture.truth)
    files[`${fixture.id}-regions.json`] = jsonBytes(fixture.regions)
    files[`${fixture.id}-unsupported.json`] = jsonBytes(control.unsupportedPixels)
    const results = new Map<string, import('../packages/spatial-stereo-types.ts').StereoResult>()
    const artifacts: { variantId: string; fileName: string; sha256: string }[] = []
    for (const variant of LOCAL_SCREEN_VARIANTS) {
      const child = await runStereoResourceChild({
        command: ['bun', WORKER, '--case', fixture.id, '--variant', variant.id, '--input-sha256', inputSha256],
        cwd: ROOT, timeoutMs: 30_000, maxRssBytes: 512 * 1024 * 1024, maxOutputBytes: 20 * 1024 * 1024,
      })
      let decoded: ReturnType<typeof decodeWorker> | null = null
      let measured: ReturnType<typeof decodeWorker> | null = null
      let error: string | null = null
      try {
        measured = decodeWorker(child, fixture.id, variant, prepared)
        decoded = measured
        scoreStereoConfidence(control, decoded.result)
        results.set(variant.id, decoded.result)
        const fileName = `${fixture.id}-${variant.id}.json`
        const bytes = jsonBytes(decoded.record)
        files[fileName] = bytes
        artifacts.push({ variantId: variant.id, fileName, sha256: sha256(bytes) })
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Invalid worker output.'
        files[`${fixture.id}-${variant.id}.stdout.txt`] = child.stdout
        files[`${fixture.id}-${variant.id}.stderr.txt`] = child.stderr
        decoded = null
      }
      runtime.push({
        caseId: fixture.id, variantId: variant.id, completed: decoded !== null, workerStatus: child.status, exitCode: child.exitCode,
        wallTimeMs: child.wallTimeMs, peakRssBytes: measured ? Math.max(measured.resource.peakRssBytes, child.sampledPeakRssBytes ?? 0) : null,
        sampledPeakRssBytes: child.sampledPeakRssBytes, osCheckpointPeakRssBytes: measured?.resource.peakRssBytes ?? null,
        reconstructionMs: measured?.resource.reconstructionMs ?? null, rssCheckpoint: measured?.resource.rssCheckpoint ?? null,
        workerRuntime: measured?.resource.runtime ?? null, platform: measured?.resource.platform ?? null, architecture: measured?.resource.architecture ?? null, error,
      })
    }
    cases.push({ id: fixture.id, role: control.role, inputSha256, artifacts, variants: LOCAL_SCREEN_VARIANTS.map(variant => {
      const result = results.get(variant.id)
      return { id: variant.id, score: result ? scoreStereoConfidence(control, result, results.get('census-sgm')) : null }
    }) })
  }
  const eligibility = evaluateStereoLocalEligibility(cases, runtime)
  const { everyTrialResource: _resource, ...scoreGates } = eligibility.gates
  const scores = {
    format: 'cha-stereo-local-scores-v1', developmentOnly: true,
    confidenceDataPinSha256: CONFIDENCE_SHA, localPinsSha256: sha256(pinBytes), reservedHoldoutSha256: HOLDOUT_SHA,
    rules: { localAmbiguity: pins.localAmbiguityRule, absolute: pins.absoluteGates, relative: pins.relativeGates, confidence: pins.confidenceGates },
    variants: LOCAL_SCREEN_VARIANTS, cases, scoreGates, relative: eligibility.relative,
    positiveAbsolute: eligibility.positiveAbsolute, negativeUnsupported: eligibility.negativeUnsupported,
    limitations: ['Development-only local ambiguity screen; no parameter search, production default promotion, real-scene claim or held-out estimation.', 'Truth, diagnostic regions and unsupported correspondence masks are evaluator-only.', 'Successful result/score bytes exclude nondeterministic resource measurements; failed-trial availability can vary with host resources.', 'OS high-water is sampled after result serialization/flush; parent RSS sampling can miss transients between 25 ms observations.'],
  }
  const scoreBytes = jsonBytes(scores), runtimeBytes = jsonBytes(runtime)
  const decision = {
    format: 'cha-stereo-local-decision-v1', developmentOnly: true,
    confidenceDataPinSha256: CONFIDENCE_SHA, localPinsSha256: sha256(pinBytes), scoresSha256: sha256(scoreBytes), runtimeSha256: sha256(runtimeBytes),
    eligibility,
    resourceSummary: {
      trials: runtime.length, completed: runtime.filter(trial => trial.completed).length,
      maximumWallTimeMs: Math.max(...runtime.map(trial => trial.wallTimeMs)),
      maximumPeakRssBytes: runtime.every(trial => trial.peakRssBytes !== null) ? Math.max(...runtime.map(trial => trial.peakRssBytes!)) : null,
      sampledTrials: runtime.filter(trial => trial.sampledPeakRssBytes !== null).length,
    },
  }
  const decisionBytes = jsonBytes(decision)
  files['scores.json'] = scoreBytes
  files['resource-runtime.json'] = runtimeBytes
  files['decision.json'] = decisionBytes
  await installNewDirectory(options['--output']!, files)
  return JSON.stringify({
    format: decision.format, eligible: eligibility.eligible, confidenceDataPinSha256: CONFIDENCE_SHA,
    localPinsSha256: sha256(pinBytes), scoresSha256: sha256(scoreBytes), decisionSha256: sha256(decisionBytes),
    gates: eligibility.gates, positiveAbsolute: eligibility.positiveAbsolute, negativeUnsupported: eligibility.negativeUnsupported,
    relative: eligibility.relative, resourceSummary: decision.resourceSummary,
  }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoLocalAmbiguity(process.argv.slice(2)).then(output => {
    process.stdout.write(output)
    if (!output.startsWith('Usage:') && !process.argv.includes('--pins') && !JSON.parse(output).eligible) process.exitCode = 2
  }, error => {
    process.stderr.write(`spatial:stereo:local: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
