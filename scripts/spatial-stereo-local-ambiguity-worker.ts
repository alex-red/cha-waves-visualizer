import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStereoConfidenceCases } from '../packages/test-fixtures/stereo-confidence.ts'
import { reconstructStereoLocalScreen, LOCAL_SCREEN_VARIANTS } from '../packages/spatial-stereo-local-screen.ts'
import { LOCAL_AMBIGUITY_RULE } from '../packages/spatial-stereo-local-ambiguity.ts'
import { STEREO_SGM_SETTINGS } from '../packages/spatial-stereo-sgm.ts'
import { parseFileArguments, serializeResult, sha256 } from './lib/stereo-files.ts'
import { prepareStereoConfidenceCase } from './lib/stereo-confidence-files.ts'

export function runStereoLocalAmbiguityWorker(args: readonly string[]) {
  const options = parseFileArguments(args, ['--case', '--variant', '--input-sha256'])
  if ('help' in options) throw new Error('Internal local-screen worker requires explicit pinned case, variant and input hash.')
  const variant = LOCAL_SCREEN_VARIANTS.find(item => item.id === options['--variant'])
  if (!variant || !/^[a-f0-9]{64}$/.test(options['--input-sha256']!)) throw new Error('Unsupported worker variant or input hash.')
  const control = createStereoConfidenceCases().find(item => item.fixture.id === options['--case'])
  if (!control) throw new Error('Unsupported development local-screen case.')
  const prepared = prepareStereoConfidenceCase(control)
  if (sha256(prepared.manifestBytes) !== options['--input-sha256']) throw new Error('Worker input hash mismatch.')
  const started = performance.now()
  const result = reconstructStereoLocalScreen(control.fixture.input, variant.id)
  const reconstructionMs = performance.now() - started
  const record = {
    format: 'cha-stereo-local-result-v1',
    developmentOnly: true,
    caseId: control.fixture.id,
    variant,
    localAmbiguityRule: variant.id === 'local-ambiguity-proposal' ? LOCAL_AMBIGUITY_RULE : null,
    inputSha256: options['--input-sha256'],
    sourceHashes: { left: prepared.manifest.left.sha256, right: prepared.manifest.right.sha256 },
    censusSettings: variant.id === 'sad-baseline' ? null : STEREO_SGM_SETTINGS,
    reconstruction: serializeResult(result),
  }
  return { record, reconstructionMs }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { record, reconstructionMs } = runStereoLocalAmbiguityWorker(process.argv.slice(2))
    const serialized = JSON.stringify(record) + '\n'
    await new Promise<void>((accept, reject) => process.stdout.write(serialized, error => error ? reject(error) : accept()))
    const usage = process.resourceUsage()
    const peakRssBytes = Number.isFinite(usage.maxRSS) && usage.maxRSS > 0 ? usage.maxRSS * 1024 : null
    process.stdout.write(JSON.stringify({ format: 'cha-stereo-local-resource-v1', peakRssBytes, reconstructionMs, rssCheckpoint: 'after-result-serialization-and-stdout-flush', runtime: `Bun ${process.versions.bun ?? 'unknown'}`, platform: process.platform, architecture: process.arch }) + '\n')
  } catch (error) {
    process.stderr.write(`local stereo worker: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  }
}
