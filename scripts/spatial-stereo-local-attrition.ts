import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_AMBIGUITY_RULE } from '../packages/spatial-stereo-local-ambiguity.ts'
import { LOCAL_SCREEN_VARIANTS } from '../packages/spatial-stereo-local-screen.ts'
import { inspectStereoLocalEvidence, poolStereoLocalAttrition, scoreStereoLocalAttrition } from '../packages/spatial-stereo-local-attrition.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, parseJson, readBounded, sha256 } from './lib/stereo-files.ts'
import { loadStereoLocalAttritionCases, STEREO_LOCAL_ATTRITION_PINS, type StereoLocalPinnedCase } from './lib/stereo-local-attrition-files.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CONFIDENCE_PIN = fileURLToPath(new URL('../docs/data/stereo-confidence.json', import.meta.url))
const LOCAL_PIN = fileURLToPath(new URL('../docs/data/stereo-local-ambiguity.json', import.meta.url))
const HOLDOUT = fileURLToPath(new URL('../docs/data/stereo-holdout-c.json', import.meta.url))
const ATTRITION_PIN = fileURLToPath(new URL('../docs/data/stereo-local-attrition.json', import.meta.url))
const SOURCES = [
  'packages/spatial-stereo-local-attrition.ts',
  'packages/spatial-stereo-local-ambiguity.ts',
  'packages/spatial-stereo-local-screen.ts',
  'packages/spatial-stereo-confidence.ts',
  'packages/spatial-stereo.ts',
  'packages/spatial-stereo-sgm.ts',
  'packages/spatial-stereo-types.ts',
  'packages/spatial-stereo-geometry.ts',
  'packages/spatial-stereo-comparison.ts',
  'packages/spatial-stereo-ablation.ts',
  'packages/spatial-ppm.ts',
  'scripts/lib/stereo-files.ts',
  'scripts/lib/stereo-reference-files.ts',
  'scripts/lib/stereo-confidence-files.ts',
  'scripts/lib/stereo-local-attrition-files.ts',
  'scripts/spatial-stereo-local-attrition.ts',
] as const

function decodeJson(bytes: Uint8Array, path: string): any {
  try { return parseJson(bytes) } catch { throw new Error(`Invalid JSON in ${path}.`) }
}

function assertPinnedCases(confidence: any, local: any): StereoLocalPinnedCase[] {
  if (!Array.isArray(confidence.cases) || !Array.isArray(local.cases) || confidence.cases.length !== 9 || local.cases.length !== 9) throw new Error('Both frozen data pins must contain exactly nine cases.')
  const cases = confidence.cases as StereoLocalPinnedCase[]
  if (JSON.stringify(cases) !== JSON.stringify(local.cases)) throw new Error('Confidence and local pins disagree about fixed case inputs or masks.')
  return cases
}

/** Hash only fixed pins and source code. This mode never opens saved reports or invokes estimators. */
export async function createStereoLocalAttritionPins() {
  const [confidenceBytes, localBytes, holdoutBytes] = await Promise.all([
    readBounded(CONFIDENCE_PIN, 64 * 1024), readBounded(LOCAL_PIN, 64 * 1024), readBounded(HOLDOUT, 32 * 1024),
  ])
  if (sha256(confidenceBytes) !== STEREO_LOCAL_ATTRITION_PINS.confidenceData || sha256(localBytes) !== STEREO_LOCAL_ATTRITION_PINS.localData || sha256(holdoutBytes) !== STEREO_LOCAL_ATTRITION_PINS.holdout) throw new Error('One or more frozen stereo source pins changed.')
  const confidence = decodeJson(confidenceBytes, 'confidence data pin')
  const local = decodeJson(localBytes, 'local ambiguity data pin')
  const cases = assertPinnedCases(confidence, local)
  const implementationSources = []
  for (const path of SOURCES) implementationSources.push({ path, sha256: sha256(await readBounded(resolve(ROOT, path), 128 * 1024)) })
  return {
    format: 'cha-stereo-local-attrition-pins-v1',
    split: 'development',
    confidenceDataPinSha256: STEREO_LOCAL_ATTRITION_PINS.confidenceData,
    confidenceScoresSha256: STEREO_LOCAL_ATTRITION_PINS.confidenceScores,
    localDataPinSha256: STEREO_LOCAL_ATTRITION_PINS.localData,
    localScoresSha256: STEREO_LOCAL_ATTRITION_PINS.localScores,
    reservedHoldoutSha256: STEREO_LOCAL_ATTRITION_PINS.holdout,
    localAmbiguityRule: LOCAL_AMBIGUITY_RULE,
    settings: local.settings,
    censusSettings: local.censusSettings,
    variants: { confidence: confidence.variants, local: LOCAL_SCREEN_VARIANTS },
    sourceInputs: cases,
    implementationSources,
  }
}

function parseArguments(args: readonly string[]): { pins: true } | { help: true } | { confidence: string; local: string; output: string } {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--pins') return { pins: true }
  const parsed = parseFileArguments(values, ['--confidence', '--local', '--output'])
  if ('help' in parsed) return { help: true }
  const confidence = parsed['--confidence'], local = parsed['--local'], output = parsed['--output']
  if (!confidence || !local || !output) throw new Error('Missing required option. Use --help.')
  return { confidence, local, output }
}

export async function runSpatialStereoLocalAttrition(args: readonly string[]): Promise<string> {
  const options = parseArguments(args)
  if ('pins' in options) return new TextDecoder().decode(jsonBytes(await createStereoLocalAttritionPins()))
  if ('help' in options) return 'Usage: bun run spatial:stereo:attrition -- --confidence <saved-confidence-directory> --local <saved-local-directory> --output <new-directory>\nOffline analysis of the pinned no-variance and local-ambiguity result arrays; no estimator is run.\nUse --pins alone to hash source/rule/input metadata without loading result directories.\n'

  const pinBytes = await readBounded(ATTRITION_PIN, 64 * 1024)
  const pins = await createStereoLocalAttritionPins()
  if (sha256(pinBytes) !== sha256(jsonBytes(pins))) throw new Error('Frozen local attrition data, source or rule pin changed.')
  const confidencePinBytes = await readBounded(CONFIDENCE_PIN, 64 * 1024)
  const localPinBytes = await readBounded(LOCAL_PIN, 64 * 1024)
  const confidencePin = decodeJson(confidencePinBytes, 'confidence data pin')
  const localPin = decodeJson(localPinBytes, 'local data pin')
  const loaded = await loadStereoLocalAttritionCases(options.confidence, options.local, confidencePin, localPin)
  if (loaded.length !== 9) throw new Error('Offline attrition requires every pinned case.')
  const files: Record<string, Uint8Array | string> = {}
  const cases = []
  const positiveScores = []
  for (const item of loaded) {
    const evidence = inspectStereoLocalEvidence(item.input, item.base)
    const evidenceBytes = jsonBytes({
      format: 'cha-stereo-local-attrition-evidence-v1', developmentOnly: true, caseId: item.id,
      inputSha256: item.lineage.inputSha256, baseResultSha256: item.lineage.confidenceResultSha256,
      attritionPinsSha256: sha256(pinBytes), settings: pins.settings, censusSettings: pins.censusSettings,
      localAmbiguityRule: pins.localAmbiguityRule,
      evidence,
    })
    const evidenceFile = `${item.id}-evidence.json`
    files[evidenceFile] = evidenceBytes
    const diagnostics = scoreStereoLocalAttrition(evidence, item.base, item.filtered, item.truth, item.regions, item.unsupportedPixels)
    if (item.role === 'positive') positiveScores.push(diagnostics)
    cases.push({
      id: item.id, role: item.role, lineage: item.lineage,
      evidence: { fileName: evidenceFile, sha256: sha256(evidenceBytes), rows: evidence.length },
      diagnostics,
    })
  }
  if (cases.length !== 9 || positiveScores.length !== 5) throw new Error('Attrition report requires all nine cases and a separate five-positive pool.')
  const report = {
    format: 'cha-stereo-local-attrition-report-v1',
    developmentOnly: true,
    estimatorInvoked: false,
    confidenceDataPinSha256: STEREO_LOCAL_ATTRITION_PINS.confidenceData,
    confidenceScoresSha256: STEREO_LOCAL_ATTRITION_PINS.confidenceScores,
    localDataPinSha256: STEREO_LOCAL_ATTRITION_PINS.localData,
    localScoresSha256: STEREO_LOCAL_ATTRITION_PINS.localScores,
    attritionPinsSha256: sha256(pinBytes),
    cases,
    pooledPositive: poolStereoLocalAttrition(positiveScores),
    limitations: ['Saved-development diagnostic only; no candidate eligibility, benchmark, parameter selection, production promotion or held-out estimate.', 'Evidence arrays contain correspondence-local matcher evidence; truth, regions and unsupported masks are used only in the separate evaluator diagnostics.', 'This command reads frozen result arrays and does not invoke any estimator.'],
  }
  const reportBytes = jsonBytes(report)
  files['report.json'] = reportBytes
  await installNewDirectory(options.output, files)
  return JSON.stringify({ format: report.format, cases: cases.length, estimatorInvoked: false, attritionPinsSha256: report.attritionPinsSha256, reportSha256: sha256(reportBytes) }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoLocalAttrition(process.argv.slice(2)).then(output => process.stdout.write(output), error => {
    process.stderr.write(`spatial:stereo:attrition: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
