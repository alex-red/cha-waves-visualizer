import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStereoDevelopmentCases } from '../packages/test-fixtures/stereo-development.ts'
import { createStereoHoldoutCases } from '../packages/test-fixtures/stereo-holdout.ts'
import { runStereoAblationCase, STEREO_ABLATION_VARIANTS, summarizeStereoAblations } from '../packages/spatial-stereo-ablation.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { STEREO_SETTINGS } from '../packages/spatial-stereo-types.ts'
import { STEREO_COMPARISON_GATES } from '../packages/spatial-stereo-comparison.ts'
import { STEREO_GEOMETRY_GATES } from '../packages/spatial-stereo-geometry.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, readBounded, serializeResult, sha256 } from './lib/stereo-files.ts'
import { pinStereoReferenceCase, prepareStereoReferenceCase } from './lib/stereo-reference-files.ts'

export const STEREO_FUTURE_EVALUATION_BUDGET = Object.freeze({ maxWidth: 256, maxHeight: 192, maxDisparityLabels: 64, maxWallTimeMsPerCaseVariant: 30_000, maxPeakRssBytes: 512 * 1024 * 1024, status: 'planned-unmeasured' })
const DATA = '../docs/data/'
const SOURCES = ['packages/spatial-stereo.ts', 'packages/spatial-stereo-sgm.ts', 'packages/spatial-stereo-types.ts', 'packages/spatial-stereo-geometry.ts', 'packages/spatial-stereo-comparison.ts', 'packages/spatial-stereo-ablation.ts', 'packages/spatial-ppm.ts', 'packages/test-fixtures/stereo-development.ts', 'packages/test-fixtures/stereo-holdout.ts', 'scripts/lib/stereo-files.ts', 'scripts/lib/stereo-reference-files.ts', 'scripts/spatial-stereo-ablate.ts'] as const

/** Generate data hashes only. No holdout estimator or geometry evaluation is called. */
export function createStereoHoldoutPins() {
  return { format: 'cha-stereo-holdout-pins-v1', split: 'evaluation', status: 'unopened-for-estimation', settings: STEREO_SETTINGS, relativeGates: STEREO_COMPARISON_GATES, geometryGates: STEREO_GEOMETRY_GATES, budget: STEREO_FUTURE_EVALUATION_BUDGET, cases: createStereoHoldoutCases().map(pinStereoReferenceCase) }
}

export async function createStereoAblationPins() {
  const originalBytes = await readBounded(fileURLToPath(new URL(`${DATA}stereo-comparison-cases.json`, import.meta.url)), 32 * 1024)
  const implementationSources = []
  for (const path of SOURCES) implementationSources.push({ path, sha256: sha256(await readBounded(fileURLToPath(new URL(`../${path}`, import.meta.url)), 128 * 1024)) })
  const cases = createStereoDevelopmentCases('development').map(pinStereoReferenceCase)
  const original = JSON.parse(new TextDecoder().decode(originalBytes)) as { cases: { split: string }[] }
  if (JSON.stringify(cases) !== JSON.stringify(original.cases.filter(item => item.split === 'development'))) throw new Error('Original development inputs changed; ablation requires their exact pinned bytes.')
  return { format: 'cha-stereo-ablation-pins-v1', split: 'development', diagnosticOnly: true, originalComparisonPinsSha256: sha256(originalBytes), freshHoldoutPinsSha256: sha256(jsonBytes(createStereoHoldoutPins())), settings: STEREO_SETTINGS, censusSettings: STEREO_SGM_SETTINGS, variants: STEREO_ABLATION_VARIANTS, implementationSources, cases }
}

export async function runSpatialStereoAblate(args: readonly string[]): Promise<string> {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--pins') return new TextDecoder().decode(jsonBytes(await createStereoAblationPins()))
  if (values.length === 1 && values[0] === '--holdout-pins') return new TextDecoder().decode(jsonBytes(createStereoHoldoutPins()))
  const options = parseFileArguments(values, ['--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo:ablate -- --output <new-directory>\nFixed development diagnostics only; no input or evaluation split option.\nUse --pins or --holdout-pins alone to generate hashes without estimation.\n'
  const pinBytes = await readBounded(fileURLToPath(new URL(`${DATA}stereo-ablation.json`, import.meta.url)), 64 * 1024)
  const holdoutBytes = await readBounded(fileURLToPath(new URL(`${DATA}stereo-holdout-c.json`, import.meta.url)), 32 * 1024)
  const pins = await createStereoAblationPins()
  if (sha256(pinBytes) !== sha256(jsonBytes(pins)) || sha256(holdoutBytes) !== pins.freshHoldoutPinsSha256) throw new Error('Frozen ablation sources, controls or holdout hashes changed; freeze a new protocol before estimation.')
  const files: Record<string, Uint8Array | string> = {}
  const runtime: { caseId: string; variantId: string; reconstructionMs: number }[] = []
  const cases = createStereoDevelopmentCases('development').map(fixture => {
    const prepared = prepareStereoReferenceCase(fixture)
    files[`${fixture.id}-input.json`] = prepared.manifestBytes
    files[prepared.manifest.left.fileName] = prepared.left
    files[prepared.manifest.right.fileName] = prepared.right
    files[`${fixture.id}-truth.json`] = jsonBytes(fixture.truth)
    files[`${fixture.id}-regions.json`] = jsonBytes(fixture.regions)
    const comparison = runStereoAblationCase(fixture, STEREO_SETTINGS, (variantId, reconstructionMs) => runtime.push({ caseId: fixture.id, variantId, reconstructionMs }))
    const results = comparison.results.map(item => {
      const configuration = STEREO_ABLATION_VARIANTS.find(variant => variant.id === item.id)!
      const record = { format: 'cha-stereo-ablation-result-v1', diagnosticOnly: true, variant: configuration, censusSettings: configuration.family === 'census' ? STEREO_SGM_SETTINGS : null, inputSha256: sha256(prepared.manifestBytes), sourceHashes: { left: prepared.manifest.left.sha256, right: prepared.manifest.right.sha256 }, reconstruction: serializeResult(item.result) }
      const bytes = jsonBytes(record), fileName = `${fixture.id}-${item.id}.json`
      files[fileName] = bytes
      return { id: item.id, fileName, sha256: sha256(bytes) }
    })
    return { ...pinStereoReferenceCase(fixture), ...comparison.score, results }
  })
  const summary = summarizeStereoAblations(cases)
  const report = { format: 'cha-stereo-ablation-report-v1', diagnosticOnly: true, split: 'development', ablationPinsSha256: sha256(pinBytes), freshHoldoutPinsSha256: sha256(holdoutBytes), settings: STEREO_SETTINGS, censusSettings: STEREO_SGM_SETTINGS, variants: STEREO_ABLATION_VARIANTS, implementationSources: pins.implementationSources, summary, cases, limitations: ['Development diagnostics only; no candidate selection, default promotion, held-out estimation or real-scene claim.', 'Controls disable one factor at a time. SAD versus Census also changes matching/refinement details; it is not a pure descriptor ablation.', 'Gained/lost accepted support is classified with evaluator-only truth; >1 px is bad, <=1 px correct, missing truth unknown.', 'Regions overlap and first rejection outcomes can change when an earlier gate is bypassed. Neither is an additive causal decomposition.', 'Elapsed time is separate and excludes evaluation/I/O. Planned future wall-time/RSS gates are not measured or enforced by this command.', 'Unknown, estimated and generated content remain distinct. No hole filling, Gaussian training, acoustic contribution or world registration is introduced.'] }
  const bytes = jsonBytes(report)
  files['ablation.json'] = bytes
  files['runtime.json'] = jsonBytes(runtime)
  await installNewDirectory(options['--output']!, files)
  return JSON.stringify({ format: report.format, diagnosticOnly: true, ablationPinsSha256: report.ablationPinsSha256, freshHoldoutPinsSha256: report.freshHoldoutPinsSha256, reportSha256: sha256(bytes), summary }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoAblate(process.argv.slice(2)).then(output => process.stdout.write(output), error => {
    process.stderr.write(`spatial:stereo:ablate: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
