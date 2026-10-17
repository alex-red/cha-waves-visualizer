import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { ECHO_SCAN_FORMAT, createRecordedEchoScan, parseEchoScan, type EchoScanDocument, type EchoScanReview } from '../../../../packages/echo-scan'
import { reconstructEchoRoom, type EchoCapture, type EchoPeak, type EchoReconstruction } from '../../../../packages/echo'
import { validateSatelliteCapture, type SatelliteCapture } from '../../../../packages/satellite'
import type { ProbeBatch } from '../../../../packages/probe-batch'

export const MAX_ECHO_SCAN_RECORDINGS = 12
export const MAX_ECHO_SCAN_PEAKS = 16
export const MAX_ECHO_WALL_DELAY_MS = 175

export interface ReadyEchoCapture {
  captureId: string
  capture: EchoCapture
}

export interface UseEchoScan {
  recordings: ShallowRef<SatelliteCapture[]>
  batches: ShallowRef<ProbeBatch[]>
  reviews: Ref<Record<string, EchoScanReview>>
  activeCaptureId: Ref<string | null>
  readyCaptures: ComputedRef<ReadyEchoCapture[]>
  reconstruction: ComputedRef<EchoReconstruction>
  error: Ref<string>
  notice: Ref<string>
  mergeRecordings(incoming: readonly unknown[], incomingBatches?: readonly unknown[]): boolean
  setPeaks(captureId: string, peaks: readonly EchoPeak[]): boolean
  setDirect(captureId: string, index: number | null): boolean
  toggleWall(captureId: string, index: number): boolean
  selectRecording(captureId: string | null): boolean
  removeRecording(captureId: string): boolean
  clear(): void
  installRecordedScan(document: EchoScanDocument): void
  document(): EchoScanDocument
}

/** Owns the desktop's ephemeral recording review without replacing earlier captures on polling. */
export function useEchoScan(): UseEchoScan {
  const recordings = shallowRef<SatelliteCapture[]>([])
  const batches = shallowRef<ProbeBatch[]>([])
  const reviews = ref<Record<string, EchoScanReview>>(Object.create(null) as Record<string, EchoScanReview>)
  const activeCaptureId = ref<string | null>(null)
  const error = ref('')
  const notice = ref('')
  const removedIds = new Set<string>()
  const removedBatchIds = new Set<string>()

  const readyCaptures = computed<ReadyEchoCapture[]>(() => recordings.value.flatMap(recording => {
    const review = reviews.value[recording.id]
    if (!review || review.directPeakIndex === null || review.wallPeakIndices.length !== 4) return []
    const direct = review.peaks[review.directPeakIndex]
    if (!direct) return []
    const arrivalTimesMs = review.wallPeakIndices.map(index => review.peaks[index]!.delayMs - direct.delayMs).sort((a, b) => a - b)
    if (arrivalTimesMs.some(delay => !validWallDelay(delay))) return []
    return [{ captureId: recording.id, capture: { position: { ...recording.position }, arrivalTimesMs } }]
  }))
  const reconstruction = computed(() => reconstructEchoRoom(readyCaptures.value.map(item => item.capture)))

  function fail(message: string): false { error.value = message; notice.value = ''; return false }
  function reviewFor(captureId: string): EchoScanReview | undefined { return reviews.value[captureId] }
  function hasRecording(captureId: string): boolean { return recordings.value.some(recording => recording.id === captureId) }

  function mergeRecordings(incoming: readonly unknown[], incomingBatches: readonly unknown[] = []): boolean {
    error.value = ''; notice.value = ''
    if (!Array.isArray(incoming)) return fail('Received recordings must be a list.')
    const validated: SatelliteCapture[] = []
    for (const input of incoming) {
      const result = validateSatelliteCapture(input)
      if (!result.ok) return fail(`A received recording was rejected: ${result.reason}`)
      validated.push(result.value)
    }
    const known = new Map(recordings.value.map(capture => [capture.id, capture]))
    const additions: SatelliteCapture[] = []
    for (const capture of validated) {
      if (removedIds.has(capture.id)) continue
      const previous = known.get(capture.id)
      if (previous) {
        if (!sameCapture(previous, capture)) return fail(`Recording id “${capture.id}” arrived with changed audio or metadata; the existing review was preserved.`)
        continue
      }
      known.set(capture.id, capture)
      additions.push(capture)
    }
    if (recordings.value.length + additions.length > MAX_ECHO_SCAN_RECORDINGS) {
      return fail('The desktop already holds 12 recordings. Export or remove a recording before accepting more.')
    }
    let normalizedBatches: ProbeBatch[]
    try {
      // Validate both parts before installing either; a broken manifest cannot
      // append orphan audio or replace a previously reviewed series.
      if (!Array.isArray(incomingBatches)) return fail('Received series must be a list.')
      const combined = [...recordings.value, ...additions]
      const candidate = parseEchoScan(JSON.stringify({
        format: ECHO_SCAN_FORMAT, mode: 'recorded', recordings: combined, reviews: [],
        batches: incomingBatches.filter(input => {
          const id = (input as { id?: unknown } | null)?.id
          return typeof id !== 'string' || !removedBatchIds.has(id)
        }),
      })).document
      if (candidate.mode !== 'recorded') return fail('Received series data must belong to a recorded scan.')
      const knownBatches = new Map(batches.value.map(batch => [batch.id, batch]))
      for (const batch of candidate.batches ?? []) {
        const previous = knownBatches.get(batch.id)
        if (previous && JSON.stringify(previous) !== JSON.stringify(batch)) return fail(`Series id “${batch.id}” arrived with changed metadata; the existing scan was preserved.`)
        knownBatches.set(batch.id, batch)
      }
      const joined = parseEchoScan(JSON.stringify(createRecordedEchoScan(combined, [], [...knownBatches.values()]))).document
      if (joined.mode !== 'recorded') return fail('Invalid received series data.')
      normalizedBatches = joined.batches ?? []
    } catch (cause) {
      return fail(cause instanceof Error ? `Received series data was rejected: ${cause.message}` : 'Received series data was rejected.')
    }
    if (additions.length) recordings.value = [...recordings.value, ...additions]
    if (JSON.stringify(batches.value) !== JSON.stringify(normalizedBatches)) batches.value = normalizedBatches
    for (const capture of additions) reviews.value[capture.id] = emptyReview(capture.id)
    if (activeCaptureId.value === null && additions.length) activeCaptureId.value = additions[0]!.id
    return true
  }

  function setPeaks(captureId: string, input: readonly EchoPeak[]): boolean {
    error.value = ''; notice.value = ''
    if (!hasRecording(captureId)) return fail('Select a received recording before reviewing its peaks.')
    if (!Array.isArray(input) || input.length > MAX_ECHO_SCAN_PEAKS || input.some((peak, index) => !peak || !Number.isFinite(peak.delayMs) || peak.delayMs < 0 || peak.delayMs > 2_000 || !Number.isFinite(peak.strength) || peak.strength < 0 || (index > 0 && peak.delayMs < input[index - 1]!.delayMs))) {
      return fail('Peak analysis must contain at most 16 finite, nonnegative peaks.')
    }
    const peaks = input.map(peak => ({ delayMs: peak.delayMs, strength: peak.strength }))
    const existing = reviewFor(captureId)
    if (existing && samePeaks(existing.peaks, peaks)) return true
    reviews.value[captureId] = { captureId, peaks, directPeakIndex: null, wallPeakIndices: [] }
    return true
  }

  function setDirect(captureId: string, index: number | null): boolean {
    error.value = ''; notice.value = ''
    const review = reviewFor(captureId)
    if (!review) return fail('Analyze this recording before choosing a direct arrival.')
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= review.peaks.length)) return fail('The selected direct arrival is not available.')
    if (index === review.directPeakIndex) return true
    reviews.value[captureId] = { ...review, directPeakIndex: index, wallPeakIndices: [] }
    return true
  }

  function toggleWall(captureId: string, index: number): boolean {
    error.value = ''; notice.value = ''
    const review = reviewFor(captureId)
    if (!review) return fail('Analyze this recording before choosing wall arrivals.')
    if (!Number.isInteger(index) || index < 0 || index >= review.peaks.length) return fail('The selected wall arrival is not available.')
    const direct = review.directPeakIndex === null ? undefined : review.peaks[review.directPeakIndex]
    const wall = review.peaks[index]
    if (!direct || !wall || index === review.directPeakIndex || !validWallDelay(wall.delayMs - direct.delayMs)) {
      return fail('Choose a later arrival within 175 ms after the selected direct sound.')
    }
    const selected = review.wallPeakIndices
    if (selected.includes(index)) reviews.value[captureId] = { ...review, wallPeakIndices: selected.filter(value => value !== index) }
    else if (selected.length >= 4) return fail('Choose at most four wall arrivals for each capture.')
    else reviews.value[captureId] = { ...review, wallPeakIndices: [...selected, index] }
    return true
  }

  function selectRecording(captureId: string | null): boolean {
    error.value = ''; notice.value = ''
    if (captureId !== null && !hasRecording(captureId)) return fail('That recording is not available.')
    activeCaptureId.value = captureId
    return true
  }

  function removeRecording(captureId: string): boolean {
    error.value = ''; notice.value = ''
    if (!hasRecording(captureId)) return false
    if (batches.value.some(batch => batch.attempts.some(attempt => attempt.status === 'captured' && attempt.captureId === captureId))) return fail('This recording belongs to a probe series. Export the series and start a new scan to preserve its outcome history.')
    const previousIndex = recordings.value.findIndex(recording => recording.id === captureId)
    removedIds.add(captureId)
    recordings.value = recordings.value.filter(recording => recording.id !== captureId)
    const nextReviews = Object.assign(Object.create(null) as Record<string, EchoScanReview>, reviews.value)
    delete nextReviews[captureId]
    reviews.value = nextReviews
    if (activeCaptureId.value === captureId) activeCaptureId.value = recordings.value[Math.min(previousIndex, recordings.value.length - 1)]?.id ?? null
    return true
  }

  function clear(): void {
    for (const recording of recordings.value) removedIds.add(recording.id)
    for (const batch of batches.value) removedBatchIds.add(batch.id)
    recordings.value = []
    batches.value = []
    reviews.value = Object.create(null) as Record<string, EchoScanReview>
    activeCaptureId.value = null
    error.value = ''; notice.value = ''
  }

  function installRecordedScan(document: EchoScanDocument): void {
    if (!document || document.format !== ECHO_SCAN_FORMAT || document.mode !== 'recorded') throw new Error('Only a valid recorded Echo Scan document can be installed here.')
    // Factory validation is the import boundary. Build local state only after it succeeds.
    const candidate = createRecordedEchoScan(document.recordings, document.reviews, document.batches)
    const parsed = parseEchoScan(JSON.stringify(candidate)).document
    if (parsed.mode !== 'recorded') throw new Error('Only a recorded Echo Scan document can be installed here.')
    const normalized = parsed
    if (normalized.recordings.length > MAX_ECHO_SCAN_RECORDINGS) throw new Error('A recorded Echo Scan can contain at most 12 recordings.')
    const validated: SatelliteCapture[] = []
    for (const input of normalized.recordings) {
      const result = validateSatelliteCapture(input)
      if (!result.ok) throw new Error(`A recorded capture was rejected: ${result.reason}`)
      validated.push(result.value)
    }
    const nextReviews = Object.create(null) as Record<string, EchoScanReview>
    const ids = new Set(validated.map(capture => capture.id))
    for (const review of normalized.reviews) {
      if (!ids.has(review.captureId) || !validReview(review)) throw new Error(`Review for capture “${review.captureId}” is invalid.`)
      nextReviews[review.captureId] = cloneReview(review)
    }
    for (const capture of validated) nextReviews[capture.id] ??= emptyReview(capture.id)
    recordings.value = validated
    batches.value = normalized.batches ?? []
    reviews.value = nextReviews
    activeCaptureId.value = validated[0]?.id ?? null
    removedIds.clear()
    removedBatchIds.clear()
    error.value = ''; notice.value = ''
  }

  function document(): EchoScanDocument {
    return createRecordedEchoScan(recordings.value, Object.values(reviews.value), batches.value.length ? batches.value : undefined)
  }

  return { recordings, batches, reviews, activeCaptureId, readyCaptures, reconstruction, error, notice, mergeRecordings, setPeaks, setDirect, toggleWall, selectRecording, removeRecording, clear, installRecordedScan, document }
}

function emptyReview(captureId: string): EchoScanReview { return { captureId, peaks: [], directPeakIndex: null, wallPeakIndices: [] } }
function validWallDelay(delay: number): boolean { return Number.isFinite(delay) && delay > 0 && delay <= MAX_ECHO_WALL_DELAY_MS }
function validReview(review: EchoScanReview): boolean {
  if (!review || typeof review.captureId !== 'string' || !Array.isArray(review.peaks) || review.peaks.length > MAX_ECHO_SCAN_PEAKS || !Array.isArray(review.wallPeakIndices) || review.wallPeakIndices.length > 4) return false
  if (review.peaks.some(peak => !peak || !Number.isFinite(peak.delayMs) || peak.delayMs < 0 || peak.delayMs > 2_000 || !Number.isFinite(peak.strength) || peak.strength < 0)) return false
  if (review.directPeakIndex !== null && (!Number.isInteger(review.directPeakIndex) || review.directPeakIndex < 0 || review.directPeakIndex >= review.peaks.length)) return false
  if (new Set(review.wallPeakIndices).size !== review.wallPeakIndices.length || review.wallPeakIndices.some(index => !Number.isInteger(index) || index < 0 || index >= review.peaks.length)) return false
  const direct = review.directPeakIndex === null ? undefined : review.peaks[review.directPeakIndex]
  return review.wallPeakIndices.every(index => index !== review.directPeakIndex && direct !== undefined && validWallDelay(review.peaks[index]!.delayMs - direct.delayMs))
}
function sameCapture(a: SatelliteCapture, b: SatelliteCapture): boolean {
  // Both captures have passed the shared validator, which normalizes acquisition key order.
  return a.id === b.id && a.capturedAt === b.capturedAt && a.position.xM === b.position.xM && a.position.yM === b.position.yM && a.sampleRate === b.sampleRate && a.pcm16Base64 === b.pcm16Base64 && a.durationMs === b.durationMs && a.deviceLabel === b.deviceLabel && a.captureBackend === b.captureBackend && sameSignal(a.signal, b.signal) && JSON.stringify(a.acquisition) === JSON.stringify(b.acquisition)
}
function sameSignal(a: SatelliteCapture['signal'], b: SatelliteCapture['signal']): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.peak === b.peak && a.rms === b.rms && a.clippedFraction === b.clippedFraction
}
function samePeaks(a: readonly EchoPeak[], b: readonly EchoPeak[]): boolean { return a.length === b.length && a.every((peak, index) => peak.delayMs === b[index]?.delayMs && peak.strength === b[index]?.strength) }
function cloneReview(review: EchoScanReview): EchoScanReview { return { captureId: review.captureId, peaks: review.peaks.map(peak => ({ ...peak })), directPeakIndex: review.directPeakIndex, wallPeakIndices: [...review.wallPeakIndices] } }
