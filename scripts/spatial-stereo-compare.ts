import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStereoDevelopmentCases } from '../packages/test-fixtures/stereo-development.ts'
import { compareStereoCase, summarizeStereoComparison, STEREO_COMPARISON_GATES } from '../packages/spatial-stereo-comparison.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { STEREO_SETTINGS } from '../packages/spatial-stereo-types.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, readBounded, serializeResult, sha256, stereoResultSchema } from './lib/stereo-files.ts'
import { pinStereoReferenceCase, prepareStereoReferenceCase } from './lib/stereo-reference-files.ts'

/** Freeze sources/splits without invoking either estimator or evaluating its results. */
export function createStereoComparisonPins() {
  return {
    format: 'cha-stereo-comparison-pins-v1', settings: STEREO_SETTINGS, candidateSettings: STEREO_SGM_SETTINGS, relativeGates: STEREO_COMPARISON_GATES,
    cases: (['development', 'evaluation'] as const).flatMap(split => createStereoDevelopmentCases(split).map(pinStereoReferenceCase)),
  }
}

export async function runSpatialStereoCompare(args: readonly string[]): Promise<string> {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--pins') return JSON.stringify(createStereoComparisonPins(), null, 2) + '\n'
  const options = parseFileArguments(values, ['--split', '--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo:compare -- --split development|evaluation --output <new-directory>\nUse --pins alone to generate source/split hashes without estimation.\n'
  const split = options['--split']
  if (split !== 'development' && split !== 'evaluation') throw new Error('Split must be development or evaluation.')
  const pinBytes = await readBounded(fileURLToPath(new URL('../docs/data/stereo-comparison-cases.json', import.meta.url)), 32 * 1024)
  if (sha256(pinBytes) !== sha256(jsonBytes(createStereoComparisonPins()))) throw new Error('Frozen comparison inputs/settings changed; create a new protocol before evaluation.')
  const sourcePins = JSON.parse(new TextDecoder().decode(pinBytes)) as ReturnType<typeof createStereoComparisonPins>
  const files: Record<string, Uint8Array | string> = {}
  const runtime: { id: string; comparisonMs: number }[] = []
  const cases = createStereoDevelopmentCases(split).map(fixture => {
    const prepared = prepareStereoReferenceCase(fixture)
    files[`${fixture.id}-input.json`] = prepared.manifestBytes
    files[prepared.manifest.left.fileName] = prepared.left
    files[prepared.manifest.right.fileName] = prepared.right
    files[`${fixture.id}-truth.json`] = jsonBytes(fixture.truth)
    files[`${fixture.id}-regions.json`] = jsonBytes(fixture.regions)
    const started = performance.now()
    const comparison = compareStereoCase(fixture)
    runtime.push({ id: fixture.id, comparisonMs: performance.now() - started })
    const encode = (kind: 'baseline' | 'candidate') => {
      const record = stereoResultSchema.parse({ format: 'cha-stereo-result-v1', inputSha256: sha256(prepared.manifestBytes), algorithm: kind === 'baseline' ? 'rectified-rgb-sad-v1' : 'rectified-census-sgm-v1', sourceHashes: { left: prepared.manifest.left.sha256, right: prepared.manifest.right.sha256 }, reconstruction: serializeResult(comparison[kind]), ...(kind === 'candidate' ? { algorithmSettings: STEREO_SGM_SETTINGS } : {}) })
      const bytes = jsonBytes(record)
      files[`${fixture.id}-${kind}.json`] = bytes
      return sha256(bytes)
    }
    return { ...sourcePins.cases.find(item => item.id === fixture.id)!, ...comparison.score, baselineResultSha256: encode('baseline'), candidateResultSha256: encode('candidate') }
  })
  const summary = summarizeStereoComparison(cases)
  const report = { format: 'cha-stereo-comparison-report-v1', split, sourcePinsSha256: sha256(pinBytes), settings: STEREO_SETTINGS, candidateSettings: STEREO_SGM_SETTINGS, relativeGates: STEREO_COMPARISON_GATES, summary, cases, limitations: ['Synthetic reference: supplied poses and known generated surfaces; no physical accuracy or acoustic contribution claim.', 'Diagnostic masks/truth are evaluator-only. Occlusion includes right-view bounds; left-visible truth remains known.', 'Both algorithms retain every outcome and omit rejected points; candidate spatial regularization can propagate wrong estimates.', 'Relative comparison does not promote the default or pass the full SPATIAL-05 gate. Runtime is separate from deterministic result bytes.'] }
  const reportBytes = jsonBytes(report)
  files['comparison.json'] = reportBytes
  files['runtime.json'] = jsonBytes(runtime)
  await installNewDirectory(options['--output']!, files)
  return JSON.stringify({ format: report.format, split, sourcePinsSha256: report.sourcePinsSha256, reportSha256: sha256(reportBytes), summary }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoCompare(process.argv.slice(2)).then(output => {
    process.stdout.write(output)
    if (!output.startsWith('Usage:') && !process.argv.includes('--pins') && !JSON.parse(output).summary.passed) process.exitCode = 2
  }, error => {
    process.stderr.write(`spatial:stereo:compare: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
