import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStereoConfidenceCases } from '../packages/test-fixtures/stereo-confidence.ts'
import { evaluateStereoConfidenceEligibility, scoreStereoConfidence, STEREO_CONFIDENCE_GATES, STEREO_CONFIDENCE_VARIANTS, type StereoConfidenceCaseScore, type StereoConfidenceResource } from '../packages/spatial-stereo-confidence.ts'
import { STEREO_SETTINGS, type StereoResult } from '../packages/spatial-stereo-types.ts'
import { STEREO_SGM_ABLATIONS, STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { STEREO_GEOMETRY_GATES } from '../packages/spatial-stereo-geometry.ts'
import { STEREO_COMPARISON_GATES } from '../packages/spatial-stereo-comparison.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, readBounded, sha256, stereoResultSchema } from './lib/stereo-files.ts'
import { pinStereoConfidenceCase, prepareStereoConfidenceCase } from './lib/stereo-confidence-files.ts'
import { runStereoResourceChild, type StereoResourceChildResult } from './lib/stereo-resource-runner.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PIN = fileURLToPath(new URL('../docs/data/stereo-confidence.json', import.meta.url))
const HOLDOUT = fileURLToPath(new URL('../docs/data/stereo-holdout-c.json', import.meta.url))
const HOLDOUT_SHA = '8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781'
const WORKER = fileURLToPath(new URL('./spatial-stereo-confidence-worker.ts', import.meta.url))
const SOURCES = ['packages/spatial-stereo-confidence.ts', 'packages/test-fixtures/stereo-confidence.ts', 'packages/test-fixtures/stereo-development.ts', 'packages/spatial-stereo.ts', 'packages/spatial-stereo-sgm.ts', 'packages/spatial-stereo-types.ts', 'packages/spatial-stereo-geometry.ts', 'packages/spatial-stereo-comparison.ts', 'packages/spatial-stereo-ablation.ts', 'packages/spatial-ppm.ts', 'scripts/lib/stereo-reference-files.ts', 'scripts/lib/stereo-confidence-files.ts', 'scripts/lib/stereo-files.ts', 'scripts/lib/stereo-resource-runner.ts', 'scripts/spatial-stereo-confidence.ts', 'scripts/spatial-stereo-confidence-worker.ts'] as const

/** Renders/hashes development controls only; no estimator or held-out fixture is opened. */
export async function createStereoConfidencePins() {
  const holdout = await readBounded(HOLDOUT, 32 * 1024)
  if (sha256(holdout) !== HOLDOUT_SHA) throw new Error('Reserved holdout pin changed.')
  const implementationSources = []
  for (const path of SOURCES) implementationSources.push({ path, sha256: sha256(await readBounded(resolve(ROOT, path), 128 * 1024)) })
  const cases = createStereoConfidenceCases().map(pinStereoConfidenceCase)
  return { format: 'cha-stereo-confidence-pins-v1', split: 'development', reservedHoldoutSha256: HOLDOUT_SHA, settings: STEREO_SETTINGS, censusSettings: STEREO_SGM_SETTINGS, proposalConfiguration: STEREO_SGM_ABLATIONS.find(variant => variant.id === 'without-texture')!, variants: STEREO_CONFIDENCE_VARIANTS, absoluteGates: STEREO_GEOMETRY_GATES, relativeGates: STEREO_COMPARISON_GATES, confidenceGates: STEREO_CONFIDENCE_GATES, implementationSources, cases }
}

/** Worker output is two compact JSON lines: bounded result, then its resource checkpoint. */
function decodeWorker(output: StereoResourceChildResult, caseId: string, variant: typeof STEREO_CONFIDENCE_VARIANTS[number], prepared: ReturnType<typeof prepareStereoConfidenceCase>) {
  if (output.exitCode !== 0 || (output.status !== 'completed' && output.status !== 'measurement-unavailable')) throw new Error(`Worker ${output.status}.`)
  const lines = output.stdout.trim().split('\n')
  if (lines.length !== 2) throw new Error('Incomplete worker result/resource records.')
  const record = JSON.parse(lines[0]!)
  const resource = JSON.parse(lines[1]!)
  if (record.format !== 'cha-stereo-confidence-result-v1' || record.developmentOnly !== true || record.caseId !== caseId || JSON.stringify(record.variant) !== JSON.stringify(variant) || record.inputSha256 !== sha256(prepared.manifestBytes) || record.sourceHashes?.left !== prepared.manifest.left.sha256 || record.sourceHashes?.right !== prepared.manifest.right.sha256 || JSON.stringify(record.censusSettings) !== JSON.stringify(variant.id === 'sad-baseline' ? null : STEREO_SGM_SETTINGS)) throw new Error('Worker lineage/configuration mismatch.')
  // Reuse bounded structural validation internally, without exporting diagnostic results under a production ID.
  const checked = stereoResultSchema.parse({ format: 'cha-stereo-result-v1', inputSha256: record.inputSha256, sourceHashes: record.sourceHashes, algorithm: variant.id === 'sad-baseline' ? 'rectified-rgb-sad-v1' : 'rectified-census-sgm-v1', ...(variant.id === 'sad-baseline' ? {} : { algorithmSettings: STEREO_SGM_SETTINGS }), reconstruction: record.reconstruction })
  if (JSON.stringify(checked.reconstruction.settings) !== JSON.stringify(STEREO_SETTINGS)) throw new Error('Worker matching settings changed.')
  if (resource.format !== 'cha-stereo-confidence-resource-v1' || resource.rssCheckpoint !== 'after-result-serialization-and-stdout-flush' || !Number.isFinite(resource.peakRssBytes) || resource.peakRssBytes <= 0 || !Number.isFinite(resource.reconstructionMs) || resource.reconstructionMs < 0) throw new Error('Worker OS resource measurement unavailable.')
  const result: StereoResult = { ...checked.reconstruction, outcomes: Uint8Array.from(checked.reconstruction.outcomes) }
  return { record, result, resource: resource as { peakRssBytes: number; reconstructionMs: number; rssCheckpoint: string; runtime: string; platform: string; architecture: string } }
}

export async function runSpatialStereoConfidence(args: readonly string[]): Promise<string> {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--pins') return new TextDecoder().decode(jsonBytes(await createStereoConfidencePins()))
  const options = parseFileArguments(values, ['--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo:confidence -- --output <new-directory>\nFixed development controls and proposal only. No arbitrary input/evaluation option.\nUse --pins alone to generate data/settings/source hashes without estimation.\n'
  const pinBytes = await readBounded(PIN, 64 * 1024), pins = await createStereoConfidencePins()
  if (sha256(pinBytes) !== sha256(jsonBytes(pins))) throw new Error('Frozen confidence data, rules or implementation sources changed.')
  const files: Record<string, Uint8Array | string> = {}
  const cases: (StereoConfidenceCaseScore & { inputSha256: string; artifacts: { variantId: string; fileName: string; sha256: string }[] })[] = []
  const runtime: (StereoConfidenceResource & { workerStatus: StereoResourceChildResult['status']; exitCode: number | null; osCheckpointPeakRssBytes: number | null; reconstructionMs: number | null; error: string | null; rssCheckpoint: string | null; workerRuntime: string | null; platform: string | null; architecture: string | null })[] = []
  for (const control of createStereoConfidenceCases()) {
    const fixture = control.fixture, prepared = prepareStereoConfidenceCase(control), inputSha256 = sha256(prepared.manifestBytes)
    files[`${fixture.id}-input.json`] = prepared.manifestBytes
    files[prepared.manifest.left.fileName] = prepared.left
    files[prepared.manifest.right.fileName] = prepared.right
    files[`${fixture.id}-truth.json`] = jsonBytes(fixture.truth)
    files[`${fixture.id}-regions.json`] = jsonBytes(fixture.regions)
    files[`${fixture.id}-unsupported.json`] = jsonBytes(control.unsupportedPixels)
    const results = new Map<string, StereoResult>()
    const artifacts: { variantId: string; fileName: string; sha256: string }[] = []
    for (const variant of STEREO_CONFIDENCE_VARIANTS) {
      const child = await runStereoResourceChild({ command: ['bun', WORKER, '--case', fixture.id, '--variant', variant.id, '--input-sha256', inputSha256], cwd: ROOT, timeoutMs: STEREO_CONFIDENCE_GATES.maxWallTimeMs, maxRssBytes: STEREO_CONFIDENCE_GATES.maxPeakRssBytes, maxOutputBytes: 20 * 1024 * 1024 })
      let decoded: ReturnType<typeof decodeWorker> | null = null, error: string | null = null
      try {
        decoded = decodeWorker(child, fixture.id, variant, prepared)
        // Validate geometry/outcome conservation before declaring this trial completed.
        scoreStereoConfidence(control, decoded.result)
        results.set(variant.id, decoded.result)
        const fileName = `${fixture.id}-${variant.id}.json`, bytes = jsonBytes(decoded.record)
        files[fileName] = bytes
        artifacts.push({ variantId: variant.id, fileName, sha256: sha256(bytes) })
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Invalid worker output.'
        files[`${fixture.id}-${variant.id}.stdout.txt`] = child.stdout
        files[`${fixture.id}-${variant.id}.stderr.txt`] = child.stderr
        decoded = null
      }
      runtime.push({ caseId: fixture.id, variantId: variant.id, completed: decoded !== null, workerStatus: child.status, exitCode: child.exitCode, wallTimeMs: child.wallTimeMs, peakRssBytes: decoded ? Math.max(decoded.resource.peakRssBytes, child.sampledPeakRssBytes ?? 0) : null, sampledPeakRssBytes: child.sampledPeakRssBytes, osCheckpointPeakRssBytes: decoded?.resource.peakRssBytes ?? null, reconstructionMs: decoded?.resource.reconstructionMs ?? null, rssCheckpoint: decoded?.resource.rssCheckpoint ?? null, workerRuntime: decoded?.resource.runtime ?? null, platform: decoded?.resource.platform ?? null, architecture: decoded?.resource.architecture ?? null, error })
    }
    cases.push({ id: fixture.id, role: control.role, inputSha256, artifacts, variants: STEREO_CONFIDENCE_VARIANTS.map(variant => { const result = results.get(variant.id); return { id: variant.id, score: result ? scoreStereoConfidence(control, result, results.get('census-sgm')) : null } }) })
  }
  const eligibility = evaluateStereoConfidenceEligibility(cases, runtime)
  const { everyTrialResource: _resource, ...scoreGates } = eligibility.gates
  const scores = { format: 'cha-stereo-confidence-scores-v1', developmentOnly: true, confidencePinsSha256: sha256(pinBytes), reservedHoldoutSha256: HOLDOUT_SHA, rules: { absolute: pins.absoluteGates, relative: pins.relativeGates, confidence: pins.confidenceGates }, variants: STEREO_CONFIDENCE_VARIANTS, cases, scoreGates, relative: eligibility.relative, positiveAbsolute: eligibility.positiveAbsolute, negativeUnsupported: eligibility.negativeUnsupported, limitations: ['Development eligibility only; no parameter search, production default promotion, real-scene claim or held-out estimation.', 'Unsupported correspondence acceptance is separate from disparity error; null geometry truth remains unknown.', 'Successful result/score bytes exclude nondeterministic resource measurements. Failed-trial availability can vary with host resources.', 'OS high-water is sampled by the worker after result serialization/flush; parent RSS sampling can miss transients between 25 ms observations.', 'Resource gating uses the larger of the worker OS checkpoint and observed parent samples; the last small resource-record write follows that checkpoint.'] }
  const scoreBytes = jsonBytes(scores), runtimeBytes = jsonBytes(runtime)
  const decision = { format: 'cha-stereo-confidence-decision-v1', developmentOnly: true, confidencePinsSha256: sha256(pinBytes), scoresSha256: sha256(scoreBytes), runtimeSha256: sha256(runtimeBytes), eligibility, resourceSummary: { trials: runtime.length, completed: runtime.filter(trial => trial.completed).length, maximumWallTimeMs: Math.max(...runtime.map(trial => trial.wallTimeMs)), maximumPeakRssBytes: runtime.every(trial => trial.peakRssBytes !== null) ? Math.max(...runtime.map(trial => trial.peakRssBytes!)) : null, sampledTrials: runtime.filter(trial => trial.sampledPeakRssBytes !== null).length } }
  const decisionBytes = jsonBytes(decision)
  files['scores.json'] = scoreBytes
  files['resource-runtime.json'] = runtimeBytes
  files['decision.json'] = decisionBytes
  await installNewDirectory(options['--output']!, files)
  return JSON.stringify({ format: decision.format, eligible: eligibility.eligible, confidencePinsSha256: sha256(pinBytes), scoresSha256: sha256(scoreBytes), decisionSha256: sha256(decisionBytes), gates: eligibility.gates, positiveAbsolute: eligibility.positiveAbsolute, negativeUnsupported: eligibility.negativeUnsupported, relative: eligibility.relative, resourceSummary: decision.resourceSummary }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoConfidence(process.argv.slice(2)).then(output => {
    process.stdout.write(output)
    if (!output.startsWith('Usage:') && !process.argv.includes('--pins') && !JSON.parse(output).eligible) process.exitCode = 2
  }, error => {
    process.stderr.write(`spatial:stereo:confidence: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
