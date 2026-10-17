import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ECHO_SCAN_MAX_JSON_BYTES, parseEchoScan } from '../packages/echo-scan'
import { parseSpatialBundle, SPATIAL_BUNDLE_MAX_BYTES } from '../packages/spatial-bundle'
import { createSpatialInspectionReport, renderSpatialInspectionReport } from '../packages/spatial-report'

export const SPATIAL_INSPECT_USAGE = [
  'Usage: bun run spatial:inspect -- --input <bundle.json> [--format json|markdown]',
  '',
  'Replay a spatial bundle using its immutable Echo scan sources.',
  'The manifest is limited to 256 KiB; scans are limited to 10 MiB each and 40 MiB combined.',
  '',
  'Options:',
  '  --input <path>       Required spatial bundle manifest',
  '  --format <format>    json or markdown (default: json)',
  '  --help               Show this help',
].join('\n') + '\n'

export type SpatialInspectFormat = 'json' | 'markdown'
export type SpatialInspectArguments = { input: string; format: SpatialInspectFormat } | { help: true }

const MAX_COMBINED_SOURCE_BYTES = 40 * 1024 * 1024

/** Parse CLI arguments without performing filesystem work. */
export function parseSpatialInspectArguments(args: readonly string[]): SpatialInspectArguments {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--help') return { help: true }

  let input: string | undefined
  let format: SpatialInspectFormat = 'json'
  const seen = new Set<string>()
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index]!
    if (option !== '--input' && option !== '--format') {
      if (option === '--help') throw new Error('--help must be used by itself.')
      throw new Error('Unknown option.')
    }
    if (seen.has(option)) throw new Error(`Repeated option "${option}".`)
    seen.add(option)
    const value = values[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Option "${option}" requires a value.`)
    index += 1
    if (option === '--input') {
      if (value.length === 0) throw new Error('Option "--input" requires a path.')
      input = value
    } else {
      if (value !== 'json' && value !== 'markdown') throw new Error('Option "--format" must be "json" or "markdown".')
      format = value
    }
  }
  if (!input) throw new Error('Required option "--input" is missing.')
  return { input, format }
}

/** Read and replay a manifest. Importing this module never runs the CLI. */
export async function runSpatialInspect(args: readonly string[]): Promise<string> {
  const options = parseSpatialInspectArguments(args)
  if ('help' in options) return SPATIAL_INSPECT_USAGE

  const manifestPath = resolve(options.input)
  const manifestBytes = await readRegularFile(manifestPath, SPATIAL_BUNDLE_MAX_BYTES, 'Manifest')
  const manifestRealPath = await safeRealpath(manifestPath, 'Manifest')
  const manifestText = decodeUtf8(manifestBytes, 'Manifest')
  const bundle = parseSpatialBundle(manifestText)
  const bundleDirectory = dirname(manifestRealPath)
  const sources = []
  let combinedBytes = 0

  for (const source of bundle.sources) {
    const sourcePath = await resolveContainedSource(bundleDirectory, source.path, source.id)
    const remainingBytes = MAX_COMBINED_SOURCE_BYTES - combinedBytes
    const bytes = await readRegularFile(sourcePath, Math.min(ECHO_SCAN_MAX_JSON_BYTES, remainingBytes), `Source "${source.id}"`)
    combinedBytes += bytes.byteLength
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== source.sha256) throw new Error(`Source "${source.id}" SHA256 does not match the manifest.`)
    let document
    let notices: string[]
    try {
      const parsed = parseEchoScan(decodeUtf8(bytes, `Source "${source.id}"`))
      document = parsed.document
      notices = parsed.notices
    } catch (error) {
      throw sanitizedError(`Source "${source.id}"`, error)
    }
    sources.push({ sourceId: source.id, sha256, byteLength: bytes.byteLength, document, notices })
  }

  const manifest = {
    sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    byteLength: manifestBytes.byteLength,
  }
  return renderSpatialInspectionReport(createSpatialInspectionReport(bundle, sources, manifest), options.format)
}

async function resolveContainedSource(baseDirectory: string, portablePath: string, sourceId: string): Promise<string> {
  // The manifest validator rejects non-portable paths. Repeat the boundary check here
  // before touching the filesystem so this module remains safe if called with a bad value.
  if (!portablePath || portablePath.includes('\\') || isAbsolute(portablePath) || /^[a-z][a-z0-9+.-]*:/i.test(portablePath)) {
    throw new Error(`Source "${sourceId}" has an invalid relative path.`)
  }
  const segments = portablePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Source "${sourceId}" has an invalid relative path.`)
  }
  const candidate = resolve(baseDirectory, ...segments)
  const realPath = await safeRealpath(candidate, `Source "${sourceId}"`)
  const fromBase = relative(baseDirectory, realPath)
  if (fromBase === '..' || fromBase.startsWith(`..${sep}`) || isAbsolute(fromBase)) {
    throw new Error(`Source "${sourceId}" resolves outside the manifest directory.`)
  }
  return realPath
}

async function safeRealpath(path: string, label: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    throw new Error(`${label} could not be accessed.`)
  }
}

async function readRegularFile(path: string, maxBytes: number, label: string): Promise<Uint8Array> {
  let handle
  try {
    // Non-blocking open means a FIFO cannot hang the inspector before fstat rejects it.
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0))
  } catch {
    throw new Error(`${label} could not be opened.`)
  }
  try {
    let metadata
    try { metadata = await handle.stat() } catch { throw new Error(`${label} metadata could not be read.`) }
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file.`)
    if (metadata.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`)
    const bytes = new Uint8Array(maxBytes + 1)
    let total = 0
    while (total < bytes.length) {
      let bytesRead: number
      try { ({ bytesRead } = await handle.read(bytes, total, bytes.length - total, null)) }
      catch { throw new Error(`${label} could not be read.`) }
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`)
    return bytes.slice(0, total)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must be valid UTF-8.`)
  }
}

function sanitizedError(label: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Invalid input.'
  // Parser diagnostics are field-oriented; strip any accidental filesystem path details.
  return new Error(`${label}: ${message.replace(/(?:\/[^\s:'"]+)+/g, '[path]').slice(0, 500)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialInspect(process.argv.slice(2)).then(
    output => process.stdout.write(output),
    error => {
      process.stderr.write(`spatial:inspect: ${error instanceof Error ? error.message : 'Inspection failed.'}\n`)
      process.exitCode = 1
    },
  )
}
