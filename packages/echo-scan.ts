import type { EchoCapture, EchoPeak, EchoRoom } from './echo.ts'
import { validateSatelliteCapture, type SatelliteCapture } from './satellite.ts'
import { validateProbeBatch, type ProbeBatch } from './probe-batch.ts'

export const ECHO_SCAN_FORMAT = 'cha-echo-scan-v3' as const
export const ECHO_SCAN_MAX_BYTES = 10 * 1024 * 1024
export const ECHO_SCAN_MAX_JSON_BYTES = ECHO_SCAN_MAX_BYTES

export type EchoScanReview = {
  captureId: string
  peaks: EchoPeak[]
  directPeakIndex: number | null
  wallPeakIndices: number[]
}

export type SyntheticEchoScanDocument = {
  format: typeof ECHO_SCAN_FORMAT
  mode: 'synthetic'
  fixture: EchoRoom
  captures: EchoCapture[]
}

export type RecordedEchoScanDocument = {
  format: typeof ECHO_SCAN_FORMAT
  mode: 'recorded'
  recordings: SatelliteCapture[]
  reviews: EchoScanReview[]
  batches?: ProbeBatch[]
}

export type EchoScanDocument = SyntheticEchoScanDocument | RecordedEchoScanDocument
export type ParsedEchoScan = { document: EchoScanDocument; notices: string[] }

const MAX_CAPTURE_COUNT = 12
const MAX_PEAK_COUNT = 16
const MAX_REVIEW_WALL_COUNT = 4
const MAX_JSON_NODES = 200_000
const MAX_JSON_DEPTH = 64

const recordingKeysV2 = ['id', 'capturedAt', 'position', 'sampleRate', 'pcm16Base64', 'durationMs', 'deviceLabel', 'captureBackend', 'signal'] as const
const recordingKeysV3 = [...recordingKeysV2, 'acquisition'] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context} must be an object.`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown) fail(`${context} contains unsupported field "${unknown}".`)
}

function finiteNumber(value: unknown, context: string, minimum?: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    fail(`${context} must be a finite number${minimum !== undefined ? ` at least ${minimum}` : ''}${maximum !== undefined ? ` and at most ${maximum}` : ''}.`)
  }
  return value
}

function boundedArray(value: unknown, context: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail(`${context} must be an array.`)
  if (value.length > maximum) fail(`${context} may contain at most ${maximum} items.`)
  return value
}

function scanForSecrets(input: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]
  let visited = 0
  while (pending.length) {
    const { value, depth } = pending.pop()!
    visited += 1
    if (visited > MAX_JSON_NODES) fail(`Document contains more than ${MAX_JSON_NODES} values.`)
    if (!value || typeof value !== 'object') continue
    if (depth > MAX_JSON_DEPTH) fail(`Document nesting exceeds the ${MAX_JSON_DEPTH}-level limit.`)
    const entries = Object.entries(value)
    if (visited + pending.length + entries.length > MAX_JSON_NODES) fail(`Document contains more than ${MAX_JSON_NODES} values.`)
    for (const [key, child] of entries) {
      if (/(?:token|secret|authorization|credential)/i.test(key)) fail(`Documents cannot contain session or authorization field "${key}".`)
      pending.push({ value: child, depth: depth + 1 })
    }
  }
}

function parseFixture(input: unknown): EchoRoom {
  const value = record(input, 'fixture')
  exactKeys(value, ['widthM', 'depthM', 'originXM', 'originYM'], 'fixture')
  const widthM = finiteNumber(value.widthM, 'fixture.widthM', Number.MIN_VALUE, 30)
  const depthM = finiteNumber(value.depthM, 'fixture.depthM', Number.MIN_VALUE, 30)
  const originXM = value.originXM === undefined ? undefined : finiteNumber(value.originXM, 'fixture.originXM', -1_000_000, 1_000_000)
  const originYM = value.originYM === undefined ? undefined : finiteNumber(value.originYM, 'fixture.originYM', -1_000_000, 1_000_000)
  return { widthM, depthM, ...(originXM === undefined ? {} : { originXM }), ...(originYM === undefined ? {} : { originYM }) }
}

function parseSyntheticCaptures(input: unknown): EchoCapture[] {
  return boundedArray(input, 'captures', MAX_CAPTURE_COUNT).map((capture, index) => {
    const value = record(capture, `captures[${index}]`)
    exactKeys(value, ['position', 'arrivalTimesMs'], `captures[${index}]`)
    const position = record(value.position, `captures[${index}].position`)
    exactKeys(position, ['xM', 'yM'], `captures[${index}].position`)
    const xM = finiteNumber(position.xM, `captures[${index}].position.xM`, -1_000_000, 1_000_000)
    const yM = finiteNumber(position.yM, `captures[${index}].position.yM`, -1_000_000, 1_000_000)
    const arrivals = boundedArray(value.arrivalTimesMs, `captures[${index}].arrivalTimesMs`, 4)
    if (arrivals.length !== 4) fail(`captures[${index}].arrivalTimesMs must contain exactly four arrivals.`)
    const arrivalTimesMs = arrivals.map((time, arrivalIndex) => finiteNumber(time, `captures[${index}].arrivalTimesMs[${arrivalIndex}]`, Number.MIN_VALUE, 1_000_000))
    return { position: { xM, yM }, arrivalTimesMs }
  })
}

function parseRecordings(input: unknown, version: 2 | 3): SatelliteCapture[] {
  const recordings = boundedArray(input, 'recordings', MAX_CAPTURE_COUNT).map((recording, index) => {
    const value = record(recording, `recordings[${index}]`)
    exactKeys(value, version === 2 ? recordingKeysV2 : recordingKeysV3, `recordings[${index}]`)
    const validated = validateSatelliteCapture(value)
    if (!validated.ok) fail(`recordings[${index}] is invalid: ${validated.reason}`)
    const position = record(value.position, `recordings[${index}].position`)
    exactKeys(position, ['xM', 'yM'], `recordings[${index}].position`)
    return validated.value
  })
  const ids = new Set<string>()
  for (const recording of recordings) {
    if (ids.has(recording.id)) fail(`Recordings contain duplicate capture id "${recording.id}".`)
    ids.add(recording.id)
  }
  return recordings
}

function parseReviews(input: unknown, recordings: readonly SatelliteCapture[]): EchoScanReview[] {
  const reviews = boundedArray(input, 'reviews', MAX_CAPTURE_COUNT).map((review, index) => {
    const value = record(review, `reviews[${index}]`)
    exactKeys(value, ['captureId', 'peaks', 'directPeakIndex', 'wallPeakIndices'], `reviews[${index}]`)
    if (typeof value.captureId !== 'string' || value.captureId.length < 1 || value.captureId.length > 128) fail(`reviews[${index}].captureId must be 1–128 characters.`)
    const capture = recordings.find(recording => recording.id === value.captureId)
    if (!capture) fail(`reviews[${index}] refers to missing capture "${value.captureId}".`)
    const peaks = boundedArray(value.peaks, `reviews[${index}].peaks`, MAX_PEAK_COUNT).map((peak, peakIndex) => {
      const peakRecord = record(peak, `reviews[${index}].peaks[${peakIndex}]`)
      exactKeys(peakRecord, ['delayMs', 'strength'], `reviews[${index}].peaks[${peakIndex}]`)
      return {
        delayMs: finiteNumber(peakRecord.delayMs, `reviews[${index}].peaks[${peakIndex}].delayMs`, 0, 2_000),
        strength: finiteNumber(peakRecord.strength, `reviews[${index}].peaks[${peakIndex}].strength`, 0),
      }
    })
    for (let peakIndex = 1; peakIndex < peaks.length; peakIndex += 1) {
      if (peaks[peakIndex]!.delayMs < peaks[peakIndex - 1]!.delayMs) fail(`reviews[${index}].peaks must be ordered by nondecreasing delay.`)
    }
    const directPeakIndex = value.directPeakIndex
    if (directPeakIndex !== null && (!Number.isInteger(directPeakIndex) || (directPeakIndex as number) < 0 || (directPeakIndex as number) >= peaks.length)) {
      fail(`reviews[${index}].directPeakIndex must be null or an existing peak index.`)
    }
    const wallPeakIndices = boundedArray(value.wallPeakIndices, `reviews[${index}].wallPeakIndices`, MAX_REVIEW_WALL_COUNT)
      .map((peakIndex, wallIndex) => {
        if (!Number.isInteger(peakIndex) || (peakIndex as number) < 0 || (peakIndex as number) >= peaks.length) {
          fail(`reviews[${index}].wallPeakIndices[${wallIndex}] must refer to an existing peak.`)
        }
        return peakIndex as number
      })
    if (new Set(wallPeakIndices).size !== wallPeakIndices.length) fail(`reviews[${index}].wallPeakIndices must be distinct.`)
    if (directPeakIndex === null && wallPeakIndices.length > 0) fail(`reviews[${index}] cannot select wall arrivals before a direct peak.`)
    if (directPeakIndex !== null) {
      const directDelayMs = peaks[directPeakIndex as number]!.delayMs
      for (const wallPeakIndex of wallPeakIndices) {
        if (wallPeakIndex === directPeakIndex) fail(`reviews[${index}] cannot use the direct peak as a wall arrival.`)
        const relativeDelayMs = peaks[wallPeakIndex]!.delayMs - directDelayMs
        if (relativeDelayMs <= 0 || relativeDelayMs > 175) fail(`reviews[${index}] wall arrivals must be after the direct peak and within 175 ms.`)
      }
    }
    return { captureId: value.captureId, peaks, directPeakIndex: directPeakIndex as number | null, wallPeakIndices }
  })
  const ids = new Set<string>()
  for (const review of reviews) {
    if (ids.has(review.captureId)) fail(`Reviews contain duplicate capture id "${review.captureId}".`)
    ids.add(review.captureId)
  }
  return reviews
}

function parseBatches(input: unknown, recordings: readonly SatelliteCapture[]): ProbeBatch[] {
  const batches = boundedArray(input, 'batches', MAX_CAPTURE_COUNT).map((batch, index) => {
    const checked = validateProbeBatch(batch, recordings)
    if (!checked.ok) fail(`batches[${index}] is invalid: ${checked.reason}`)
    return checked.value
  })
  const batchIds = new Set<string>()
  const captureIds = new Set<string>()
  for (const batch of batches) {
    if (batchIds.has(batch.id)) fail(`Batches contain duplicate batch id "${batch.id}".`)
    batchIds.add(batch.id)
    for (const attempt of batch.attempts) {
      if (attempt.status !== 'captured') continue
      if (captureIds.has(attempt.captureId)) fail(`Batches share capture id "${attempt.captureId}".`)
      captureIds.add(attempt.captureId)
    }
  }
  return batches
}

function parseDocument(value: Record<string, unknown>, version: 2 | 3): EchoScanDocument {
  if (value.mode === 'synthetic') {
    exactKeys(value, ['format', 'mode', 'fixture', 'captures'], 'synthetic document')
    return { format: ECHO_SCAN_FORMAT, mode: 'synthetic', fixture: parseFixture(value.fixture), captures: parseSyntheticCaptures(value.captures) }
  }
  if (value.mode === 'recorded') {
    exactKeys(value, version === 3 ? ['format', 'mode', 'recordings', 'reviews', 'batches'] : ['format', 'mode', 'recordings', 'reviews'], 'recorded document')
    const recordings = parseRecordings(value.recordings, version)
    const reviews = parseReviews(value.reviews, recordings)
    const batches = value.batches === undefined ? undefined : parseBatches(value.batches, recordings)
    return { format: ECHO_SCAN_FORMAT, mode: 'recorded', recordings, reviews, ...(batches === undefined ? {} : { batches }) }
  }
  return fail('mode must be "synthetic" or "recorded".')
}

function parseV1(value: Record<string, unknown>): ParsedEchoScan {
  const notices: string[] = []
  if (value.mode === 'synthetic') {
    exactKeys(value, ['format', 'mode', 'fixture', 'captures', 'reconstruction'], 'legacy synthetic document')
    notices.push('Imported a v1 synthetic scan. Derived reconstruction data was discarded and will be recomputed.')
    return {
      document: { format: ECHO_SCAN_FORMAT, mode: 'synthetic', fixture: parseFixture(value.fixture), captures: parseSyntheticCaptures(value.captures) },
      notices,
    }
  }
  if (value.mode === 'recorded') {
    exactKeys(value, ['format', 'mode', 'recordings', 'detectedPeaks', 'directPeakIndices', 'selectedWallArrivals', 'reconstruction'], 'legacy recorded document')
    const recordings = parseRecordings(value.recordings, 2)
    notices.push('Imported raw v1 recordings. Peak and wall selections were reset because the old format did not link each review to a stable capture id.')
    return { document: { format: ECHO_SCAN_FORMAT, mode: 'recorded', recordings, reviews: [] }, notices }
  }
  return fail('mode must be "synthetic" or "recorded".')
}

/** Parse a bounded v3 scan, migrate v2/v1 documents, and preserve raw observations. */
export function parseEchoScan(text: string): ParsedEchoScan {
  if (typeof text !== 'string') fail('Scan document must be text.')
  if (text.length > ECHO_SCAN_MAX_JSON_BYTES || new TextEncoder().encode(text).byteLength > ECHO_SCAN_MAX_JSON_BYTES) {
    fail(`Scan document exceeds the ${ECHO_SCAN_MAX_JSON_BYTES}-byte limit.`)
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return fail('Scan document must contain valid JSON.') }
  scanForSecrets(parsed)
  const value = record(parsed, 'scan document')
  if (value.format === ECHO_SCAN_FORMAT) return { document: parseDocument(value, 3), notices: [] }
  if (value.format === 'cha-echo-scan-v2') return {
    document: parseDocument(value, 2),
    notices: ['Imported a v2 scan. Raw recordings and capture-linked reviews were preserved; acquisition telemetry was not available.'],
  }
  if (value.format === 'cha-echo-scan-v1') return parseV1(value)
  return fail('Unsupported echo scan format.')
}

/** Validate and serialize a v3 scan without derived reconstruction results or session secrets. */
export function serializeEchoScan(document: EchoScanDocument): string {
  let input: string
  try { input = JSON.stringify(document) } catch { return fail('Scan document could not be serialized as JSON.') }
  const { document: checked } = parseEchoScan(input)
  return JSON.stringify(checked, null, 2)
}

export function createRecordedEchoScan(recordings: readonly SatelliteCapture[], reviews: readonly EchoScanReview[], batches?: readonly ProbeBatch[]): RecordedEchoScanDocument {
  return { format: ECHO_SCAN_FORMAT, mode: 'recorded', recordings: [...recordings], reviews: [...reviews], ...(batches === undefined ? {} : { batches: [...batches] }) }
}

export function createSyntheticEchoScan(fixture: EchoRoom, captures: readonly EchoCapture[]): SyntheticEchoScanDocument {
  return { format: ECHO_SCAN_FORMAT, mode: 'synthetic', fixture: { ...fixture }, captures: [...captures] }
}
