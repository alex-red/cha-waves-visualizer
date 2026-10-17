import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEchoInspectionReport,
  ECHO_REPORT_MAX_INPUT_BYTES,
  parseEchoInspectArguments,
  renderEchoInspectionReport,
} from './lib/echo-report'

export const ECHO_INSPECT_USAGE = [
  'Usage: bun run echo:inspect -- --input <scan.json> [--format json|markdown] [--threshold 0.08] [--spacing-ms 1.5]',
  '',
  'Inspect a saved echo scan locally. Reports include source and PCM hashes, signal diagnostics,',
  'matched-peak threshold sensitivity, and existing reviews. Raw PCM and session secrets are omitted.',
  '',
  'Options:',
  '  --input <path>       Required scan JSON file (maximum 10 MiB)',
  '  --format <format>    json or markdown (default: json)',
  '  --threshold <ratio>  Primary matched-peak threshold (default: 0.08)',
  '  --spacing-ms <ms>    Minimum peak spacing (default: 1.5; minimum: 1)',
  '  --help, -h           Show this help',
].join('\n') + '\n'

export function isEchoInspectHelpRequest(args: readonly string[]): boolean {
  const values = args[0] === '--' ? args.slice(1) : args
  return values.length === 1 && (values[0] === '--help' || values[0] === '-h')
}

export async function runEchoInspect(args: readonly string[]): Promise<string> {
  if (isEchoInspectHelpRequest(args)) return ECHO_INSPECT_USAGE
  const options = parseEchoInspectArguments(args)
  const inputPath = resolve(options.input)
  const inputBytes = await readBoundedInput(inputPath)
  return renderEchoInspectionReport(createEchoInspectionReport(inputBytes, options), options.format)
}

export async function readBoundedInput(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error('Input must be a regular file.')
    if (metadata.size > ECHO_REPORT_MAX_INPUT_BYTES) throw new Error(`Input exceeds the ${ECHO_REPORT_MAX_INPUT_BYTES}-byte limit.`)
    const buffer = new Uint8Array(ECHO_REPORT_MAX_INPUT_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > ECHO_REPORT_MAX_INPUT_BYTES) throw new Error(`Input exceeds the ${ECHO_REPORT_MAX_INPUT_BYTES}-byte limit.`)
    return buffer.slice(0, total)
  } finally {
    await handle.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEchoInspect(process.argv.slice(2)).then(
    output => process.stdout.write(output),
    error => {
      process.stderr.write(`echo:inspect: ${error instanceof Error ? error.message : 'Inspection failed.'}\n`)
      process.exitCode = 1
    },
  )
}
