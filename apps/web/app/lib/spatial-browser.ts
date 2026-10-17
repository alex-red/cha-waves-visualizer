import { ECHO_SCAN_MAX_JSON_BYTES, parseEchoScan } from '../../../../packages/echo-scan'
import { parseSpatialBundle, SPATIAL_BUNDLE_LIMITS, SPATIAL_BUNDLE_MAX_BYTES } from '../../../../packages/spatial-bundle'
import { createSpatialInspectionReport, type SpatialInspectionReport } from '../../../../packages/spatial-report'

export type SpatialBrowserFile = {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

const MAX_COMBINED_SOURCE_BYTES = SPATIAL_BUNDLE_LIMITS.maxCombinedSourceBytes

/** Inspect explicitly selected local files in the browser without fetching or writing data. */
export async function inspectSpatialBrowserFiles(
  manifestFile: SpatialBrowserFile,
  sourceFiles: readonly SpatialBrowserFile[],
): Promise<SpatialInspectionReport> {
  validateSelection(manifestFile, sourceFiles)
  validateReportedSize(manifestFile, SPATIAL_BUNDLE_MAX_BYTES, 'Manifest')
  const manifestBytes = await readSelectedFile(manifestFile, SPATIAL_BUNDLE_MAX_BYTES, 'Manifest')
  const manifestText = decodeUtf8(manifestBytes, 'Manifest')
  const bundle = parseSpatialBundle(manifestText)

  const filesByName = new Map<string, SpatialBrowserFile>()
  for (const file of sourceFiles) {
    if (filesByName.has(file.name)) throw new Error('Selected source filenames must be unique.')
    filesByName.set(file.name, file)
  }

  const declaredBasenames = new Set<string>()
  let declaredBytes = 0
  for (const source of bundle.sources) {
    const basename = source.path.split('/').at(-1)!
    if (declaredBasenames.has(basename)) throw new Error(`Manifest source IDs are ambiguous by filename near "${source.id}".`)
    declaredBasenames.add(basename)
    const file = filesByName.get(basename)
    if (!file) throw new Error(`Selected file for source "${source.id}" is missing.`)
    validateReportedSize(file, ECHO_SCAN_MAX_JSON_BYTES, `Source "${source.id}"`)
    declaredBytes += file.size
    if (declaredBytes > MAX_COMBINED_SOURCE_BYTES) throw new Error('Selected source files exceed the combined byte limit.')
  }

  const sources = []
  let actualCombinedBytes = 0
  for (const source of bundle.sources) {
    const basename = source.path.split('/').at(-1)!
    const file = filesByName.get(basename)!
    const bytes = await readSelectedFile(file, ECHO_SCAN_MAX_JSON_BYTES, `Source "${source.id}"`)
    actualCombinedBytes += bytes.byteLength
    if (actualCombinedBytes > MAX_COMBINED_SOURCE_BYTES) throw new Error('Selected source files exceed the combined byte limit.')
    const sha256 = await sha256Hex(bytes, `Source "${source.id}"`)
    if (sha256 !== source.sha256) throw new Error(`Source "${source.id}" SHA256 does not match the manifest.`)
    let document
    let notices: string[]
    try {
      const parsed = parseEchoScan(decodeUtf8(bytes, `Source "${source.id}"`))
      document = parsed.document
      notices = parsed.notices
    } catch (error) {
      throw sanitizeParserError(`Source "${source.id}"`, error)
    }
    sources.push({ sourceId: source.id, sha256, byteLength: bytes.byteLength, document, notices })
  }

  return createSpatialInspectionReport(bundle, sources, {
    sha256: await sha256Hex(manifestBytes, 'Manifest'),
    byteLength: manifestBytes.byteLength,
  })
}

function validateSelection(manifestFile: SpatialBrowserFile, sourceFiles: readonly SpatialBrowserFile[]): void {
  if (!manifestFile || typeof manifestFile !== 'object' || typeof manifestFile.arrayBuffer !== 'function') {
    throw new Error('A readable manifest file must be selected.')
  }
  if (!Array.isArray(sourceFiles) || sourceFiles.length > SPATIAL_BUNDLE_LIMITS.maxSources) {
    throw new Error(`Select at most ${SPATIAL_BUNDLE_LIMITS.maxSources} source files.`)
  }
  const names = new Set<string>()
  for (const file of sourceFiles) {
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string' || file.name.length === 0) {
      throw new Error('Every selected source must have a filename.')
    }
    if (names.has(file.name)) throw new Error('Selected source filenames must be unique.')
    names.add(file.name)
  }
}

function validateReportedSize(file: SpatialBrowserFile, maximum: number, label: string): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`${label} has an invalid reported size.`)
  if (file.size > maximum) throw new Error(`${label} exceeds the ${maximum}-byte limit.`)
}

async function readSelectedFile(file: SpatialBrowserFile, maximum: number, label: string): Promise<Uint8Array<ArrayBuffer>> {
  validateReportedSize(file, maximum, label)
  let buffer: ArrayBuffer
  try { buffer = await file.arrayBuffer() } catch { throw new Error(`${label} could not be read.`) }
  if (!(buffer instanceof ArrayBuffer)) throw new Error(`${label} did not provide an ArrayBuffer.`)
  if (buffer.byteLength > maximum) throw new Error(`${label} exceeds the ${maximum}-byte limit.`)
  return new Uint8Array(buffer)
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error(`${label} must be valid UTF-8.`) }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>, label: string): Promise<string> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  } catch {
    throw new Error(`${label} SHA256 could not be computed.`)
  }
}

function sanitizeParserError(label: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Invalid input.'
  return new Error(`${label}: ${message.replace(/(?:\/[^\s:'"]+)+/g, '[path]').slice(0, 500)}`)
}
