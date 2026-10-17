import type { EchoPeak, EchoPosition } from './echo'

export interface EchoZeroRun {
  /** Inclusive start time, measured from the beginning of the captured samples. */
  startMs: number
  /** Exclusive end time, measured from the beginning of the captured samples. */
  endMs: number
  durationMs: number
}

export interface EchoSignalInspection {
  /** Exact digital-zero runs lasting at least 5 ms. */
  zeroRuns: EchoZeroRun[]
  longestZeroRunMs: number
  /** Samples whose normalized absolute amplitude is at least 0.999. */
  clippedSampleCount: number
}

export interface EchoResponseCapture {
  captureId: string
  position: EchoPosition
  peaks: readonly EchoPeak[]
}

export interface EchoPeakReference {
  captureId: string
  peakIndex: number
  /** Absolute matched-filter offset in the capture. */
  delayMs: number
}

export interface EchoStationaryTrack {
  /** Mean peak delay relative to each capture's strongest peak. */
  meanDelayMs: number
  spreadMs: number
  /** Matched peaks, with delays relative to each capture's strongest peak. */
  arrivals: Array<{ captureId: string; peakIndex: number; delayMs: number }>
}

export interface EchoResponseComparison {
  references: EchoPeakReference[]
  /** True when capture poses provide 2-D coverage with at least a 0.5 m baseline. */
  hasSpatialCoverage: boolean
  /** Fixed-delay features only; these may be device response or room paths. */
  stationaryTracks: EchoStationaryTrack[]
}

const MAX_ECHO_SAMPLE_RATE = 96_000
const MAX_ECHO_CAPTURE_MS = 2_000
const MIN_ZERO_RUN_MS = 5
const CLIPPING_AMPLITUDE = 0.999
const MAX_DIAGNOSTIC_CAPTURES = 12
const MAX_DIAGNOSTIC_PEAKS = 16
const MIN_POSITION_SPAN_M = 0.5
const MIN_TRIANGLE_AREA_M2 = 0.125
const MIN_TRACK_DELAY_MS = 1
const MAX_STATIONARY_SPREAD_MS = 0.3
const FLOAT_TOLERANCE = 1e-12

/** Inspect bounded normalized PCM without changing or filtering the samples. */
export function inspectEchoSignal(samples: ArrayLike<number>, sampleRate: number): EchoSignalInspection {
  validateSampleRate(sampleRate)
  if (!samples || !Number.isSafeInteger(samples.length) || samples.length <= 0 || samples.length > sampleRate * MAX_ECHO_CAPTURE_MS / 1_000) {
    throw new RangeError('Samples must contain between one sample and two seconds of audio.')
  }

  const zeroRuns: EchoZeroRun[] = []
  let zeroStart = -1
  let clippedSampleCount = 0
  let longestZeroRunSamples = 0
  for (let i = 0; i <= samples.length; i++) {
    if (i < samples.length) {
      const sample = samples[i]
      if (!Number.isFinite(sample)) throw new RangeError('Samples must all be finite numbers.')
      if (Math.abs(sample!) >= CLIPPING_AMPLITUDE) clippedSampleCount++
      if (sample === 0) {
        if (zeroStart < 0) zeroStart = i
        continue
      }
    }

    if (zeroStart >= 0) {
      const runLength = i - zeroStart
      longestZeroRunSamples = Math.max(longestZeroRunSamples, runLength)
      if (runLength * 1_000 >= sampleRate * MIN_ZERO_RUN_MS) {
        const startMs = zeroStart * 1_000 / sampleRate
        const endMs = i * 1_000 / sampleRate
        zeroRuns.push({ startMs, endMs, durationMs: endMs - startMs })
      }
      zeroStart = -1
    }
  }

  return {
    zeroRuns,
    longestZeroRunMs: longestZeroRunSamples * 1_000 / sampleRate,
    clippedSampleCount,
  }
}

/**
 * Compare relative peak delays across captures as a diagnostic only. The
 * strongest peak is a timing reference, not a verified direct arrival. Fixed
 * delays can come from device response or from paths parallel to movement.
 */
export function compareEchoResponses(captures: readonly EchoResponseCapture[]): EchoResponseComparison {
  if (!Array.isArray(captures) || captures.length > MAX_DIAGNOSTIC_CAPTURES) {
    throw new RangeError('A response comparison is limited to 12 captures.')
  }
  const ids = new Set<string>()
  for (const capture of captures) {
    if (!capture || typeof capture.captureId !== 'string' || capture.captureId.length === 0 || ids.has(capture.captureId)) {
      throw new RangeError('Captures need unique, nonempty IDs.')
    }
    ids.add(capture.captureId)
    if (!capture.position || !Number.isFinite(capture.position.xM) || !Number.isFinite(capture.position.yM)) {
      throw new RangeError('Capture positions must have finite coordinates.')
    }
    if (!Array.isArray(capture.peaks) || capture.peaks.length > MAX_DIAGNOSTIC_PEAKS) {
      throw new RangeError('Each capture may contain at most 16 peaks.')
    }
    for (const peak of capture.peaks) {
      if (!peak || !Number.isFinite(peak.delayMs) || peak.delayMs < 0 || !Number.isFinite(peak.strength) || peak.strength < 0) {
        throw new RangeError('Peaks need finite, nonnegative delays and strengths.')
      }
    }
  }

  const references: EchoPeakReference[] = []
  const analyzed = captures.map<AnalyzedCapture>(capture => {
    if (capture.peaks.length === 0) return { capture, hasPositiveReference: false, candidates: [] }
    let peakIndex = 0
    for (let i = 1; i < capture.peaks.length; i++) {
      if (capture.peaks[i]!.strength > capture.peaks[peakIndex]!.strength) peakIndex = i
    }
    const peak = capture.peaks[peakIndex]!
    const reference: EchoPeakReference = { captureId: capture.captureId, peakIndex, delayMs: peak.delayMs }
    references.push(reference)
    const peaks: readonly EchoPeak[] = capture.peaks
    const candidates = peak.strength > 0
      ? peaks.flatMap((candidate: EchoPeak, candidateIndex: number) => {
        const relativeDelayMs = candidate.delayMs - peak.delayMs
        return candidateIndex !== peakIndex && candidate.strength > 0 && relativeDelayMs >= MIN_TRACK_DELAY_MS
          ? [{ captureId: capture.captureId, peakIndex: candidateIndex, delayMs: relativeDelayMs }]
          : []
      })
      : []
    return { capture, reference, hasPositiveReference: peak.strength > 0, candidates }
  })

  const hasSpatialCoverage = hasCoverage(analyzed.map(item => item.capture.position))
  const eligible = analyzed.filter(item => item.hasPositiveReference)
  const trackCoverage = hasCoverage(eligible.map(item => item.capture.position))
  const stationaryTracks = hasSpatialCoverage && trackCoverage ? findStationaryTracks(eligible) : []

  return { references, hasSpatialCoverage, stationaryTracks }
}

interface Candidate { captureId: string; peakIndex: number; delayMs: number }
interface AnalyzedCapture { capture: EchoResponseCapture; reference?: EchoPeakReference; hasPositiveReference: boolean; candidates: Candidate[] }

function findStationaryTracks(eligible: AnalyzedCapture[]): EchoStationaryTrack[] {
  if (eligible.length < 3 || eligible.some(item => item.candidates.length === 0)) return []
  const first = eligible[0]!
  const proposed: EchoStationaryTrack[] = []
  const signatures = new Set<string>()

  for (const seed of first.candidates) {
    const arrivals: Candidate[] = [seed]
    for (const item of eligible.slice(1)) {
      let nearest: Candidate | undefined
      let nearestDifference = Infinity
      for (const candidate of item.candidates) {
        const difference = Math.abs(candidate.delayMs - seed.delayMs)
        if (difference < nearestDifference || (difference === nearestDifference && candidate.peakIndex < (nearest?.peakIndex ?? Infinity))) {
          nearest = candidate
          nearestDifference = difference
        }
      }
      if (!nearest || nearestDifference > MAX_STATIONARY_SPREAD_MS + FLOAT_TOLERANCE) break
      arrivals.push(nearest)
    }
    if (arrivals.length !== eligible.length) continue
    const delays = arrivals.map(arrival => arrival.delayMs)
    const minDelay = Math.min(...delays), maxDelay = Math.max(...delays)
    const spreadMs = maxDelay - minDelay
    if (spreadMs > MAX_STATIONARY_SPREAD_MS + FLOAT_TOLERANCE) continue
    const signature = arrivals.map(arrival => `${arrival.captureId}:${arrival.peakIndex}`).join('|')
    if (signatures.has(signature)) continue
    signatures.add(signature)
    proposed.push({
      meanDelayMs: delays.reduce((sum, delay) => sum + delay, 0) / delays.length,
      spreadMs,
      arrivals: arrivals.map(arrival => ({ ...arrival })),
    })
  }

  proposed.sort((a, b) => a.spreadMs - b.spreadMs || a.meanDelayMs - b.meanDelayMs)
  const used = new Set<string>()
  const result: EchoStationaryTrack[] = []
  for (const track of proposed) {
    const keys = track.arrivals.map(arrival => `${arrival.captureId}:${arrival.peakIndex}`)
    if (keys.some(key => used.has(key))) continue
    for (const key of keys) used.add(key)
    result.push(track)
  }
  return result.sort((a, b) => a.meanDelayMs - b.meanDelayMs)
}

function hasCoverage(positions: readonly EchoPosition[]): boolean {
  const distinct = positions.filter((point, index, all) => all.findIndex(candidate => candidate.xM === point.xM && candidate.yM === point.yM) === index)
  if (distinct.length < 3) return false
  const xs = distinct.map(point => point.xM), ys = distinct.map(point => point.yM)
  if (Math.max(...xs) - Math.min(...xs) < MIN_POSITION_SPAN_M || Math.max(...ys) - Math.min(...ys) < MIN_POSITION_SPAN_M) return false
  for (let a = 0; a < distinct.length; a++) for (let b = a + 1; b < distinct.length; b++) for (let c = b + 1; c < distinct.length; c++) {
    const p = distinct[a]!, q = distinct[b]!, r = distinct[c]!
    const area = Math.abs((q.xM - p.xM) * (r.yM - p.yM) - (q.yM - p.yM) * (r.xM - p.xM)) / 2
    if (area + FLOAT_TOLERANCE >= MIN_TRIANGLE_AREA_M2) return true
  }
  return false
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > MAX_ECHO_SAMPLE_RATE) {
    throw new RangeError('Sample rate must be an integer from 8–96 kHz.')
  }
}
