import { createHash } from 'node:crypto'
import { extractEchoPeaks, type EchoPeak } from '../../packages/echo'
import { compareEchoResponses, inspectEchoSignal, type EchoResponseComparison } from '../../packages/echo-diagnostics'
import { ECHO_SCAN_MAX_BYTES, parseEchoScan, type EchoScanDocument, type EchoScanReview } from '../../packages/echo-scan'
import { decodePcm16Base64, type SatelliteCapture } from '../../packages/satellite'
import type { AcquisitionMetadata } from '../../packages/acquisition'
import type { ProbeBatch, ProbeAttempt } from '../../packages/probe-batch'

export const ECHO_REPORT_VERSION = 1 as const
export const ECHO_CHIRP_DURATION_MS = 80
export const ECHO_REPORT_THRESHOLDS = [0.08, 0.04, 0.02, 0.01] as const
export const ECHO_REPORT_MAX_PEAKS = 16
export const ECHO_REPORT_MAX_INPUT_BYTES = ECHO_SCAN_MAX_BYTES

export interface EchoInspectOptions {
  threshold: number
  spacingMs: number
}

export interface EchoInspectArguments extends EchoInspectOptions {
  input: string
  format: 'json' | 'markdown'
}

export interface EchoReportedPeak {
  absoluteMs: number
  relativeToStrongestMs: number
  strength: number
  overlapsZeroRun: boolean
  overlappingZeroRuns: number[]
}

export interface EchoThresholdResult {
  threshold: number
  peaks: EchoReportedPeak[]
}

export interface EchoCaptureReport {
  captureId: string
  capturedAt: string
  position: { xM: number; yM: number }
  sampleRate: number
  sampleCount: number
  pcmSha256: string
  signal: ReturnType<typeof inspectEchoSignal> & { computedPeakAmplitude: number; computedRmsAmplitude: number }
  strongestReference: { peakIndex: number; absoluteMs: number; strength: number } | null
  candidates: EchoReportedPeak[]
  thresholdSensitivity: EchoThresholdResult[]
  existingReview: EchoScanReview | null
  acquisition: AcquisitionMetadata | null
  timingComparison: { scheduledChirpOffsetMs: number | null; strongestReferenceMinusScheduleMs: number | null; note: string }
}

export interface EchoBatchAttemptReport {
  index: number
  status: ProbeAttempt['status']
  captureId: string | null
  captureLinkStatus: 'linked' | 'interrupted' | 'not-started' | 'missing'
  strongestReferenceMinusScheduleMs: number | null
  eligible: boolean
  exclusionReason: string | null
  hasPcmZeroRuns: boolean | null
  hasClippedSamples: boolean | null
}

export interface EchoBatchReport {
  batch: ProbeBatch
  repeatability: {
    attempts: EchoBatchAttemptReport[]
    completedProbeCount: number
    eligibleProbeCount: number
    spreadMs: number | null
    spreadStatus: 'computed' | 'insufficient-eligible-probes'
    note: string
  }
}

export interface EchoInspectionReport {
  reportFormat: 'cha-echo-inspection-v1'
  reportVersion: typeof ECHO_REPORT_VERSION
  source: { sha256: string; byteLength: number }
  analysis: { chirpDurationMs: typeof ECHO_CHIRP_DURATION_MS; maxPeaks: typeof ECHO_REPORT_MAX_PEAKS; threshold: number; spacingMs: number; thresholdSensitivity: number[] }
  scan: { format: EchoScanDocument['format']; sourceFormat: string; mode: EchoScanDocument['mode']; notices: string[] }
  captures: EchoCaptureReport[]
  batches: EchoBatchReport[]
  crossPosition: EchoResponseComparison | null
}

export function parseEchoInspectArguments(args: readonly string[]): EchoInspectArguments {
  let input: string | undefined
  let format: EchoInspectArguments['format'] = 'json'
  let threshold = 0.08
  let spacingMs = 1.5
  const values = [...args]
  if (values[0] === '--') values.shift()
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index]!
    if (option === '--input' || option === '--format' || option === '--threshold' || option === '--spacing-ms') {
      const value = values[++index]
      if (value === undefined || value.startsWith('--')) throw new Error(`Option ${option} requires a value.`)
      if (option === '--input') input = value
      else if (option === '--format') {
        if (value !== 'json' && value !== 'markdown') throw new Error('--format must be json or markdown.')
        format = value
      } else {
        const number = Number(value)
        if (!Number.isFinite(number)) throw new Error(`${option} must be a finite number.`)
        if (option === '--threshold') threshold = number
        else spacingMs = number
      }
    } else {
      throw new Error(`Unknown option: ${option}`)
    }
  }
  if (!input) throw new Error('Required option: --input <scan.json>.')
  if (threshold <= 0 || threshold > 1) throw new Error('--threshold must be greater than 0 and at most 1.')
  if (spacingMs < 1) throw new Error('--spacing-ms must be at least 1.')
  return { input, format, threshold, spacingMs }
}

export function createEchoInspectionReport(inputBytes: Uint8Array, options: EchoInspectOptions): EchoInspectionReport {
  if (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength > ECHO_REPORT_MAX_INPUT_BYTES) {
    throw new Error(`Input must be at most ${ECHO_REPORT_MAX_INPUT_BYTES} bytes.`)
  }
  if (!Number.isFinite(options.threshold) || options.threshold <= 0 || options.threshold > 1 || !Number.isFinite(options.spacingMs) || options.spacingMs < 1) {
    throw new Error('Threshold or spacing is outside supported bounds.')
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(inputBytes)
  const parsed = parseEchoScan(text)
  const document = parsed.document
  const reviews = document.mode === 'recorded' ? new Map(document.reviews.map(review => [review.captureId, review])) : new Map<string, EchoScanReview>()
  const captures: EchoCaptureReport[] = []
  const capturesById = new Map<string, EchoCaptureReport>()
  const workletCaptureIds = new Set<string>()
  const comparisonInputs: Array<{ captureId: string; position: { xM: number; yM: number }; peaks: EchoPeak[] }> = []

  if (document.mode === 'recorded') {
    for (const recording of document.recordings) {
      const decoded = decodePcm16(recording)
      const signal = { ...inspectEchoSignal(decoded.samples, recording.sampleRate), ...measureAmplitude(decoded.samples) }
      const sensitivityThresholds = uniqueThresholds(options.threshold)
      const sensitivity = sensitivityThresholds.map(threshold => ({
        threshold,
        peaks: analyzePeaks(decoded.samples, recording.sampleRate, threshold, options.spacingMs, signal.zeroRuns),
      }))
      const primary = sensitivity.find(result => result.threshold === options.threshold)!
      const strongestIndex = strongestPeakIndex(primary.peaks)
      const strongest = strongestIndex === null ? null : primary.peaks[strongestIndex]!
      const timing = recording.acquisition?.timing
      const scheduledChirpOffsetMs = timing && timing.captureStartFrame !== null
        ? (timing.scheduledChirpStartFrame - timing.captureStartFrame) * 1000 / timing.contextSampleRate : null
      const captureReport: EchoCaptureReport = {
        captureId: recording.id,
        capturedAt: recording.capturedAt,
        position: { ...recording.position },
        sampleRate: recording.sampleRate,
        sampleCount: decoded.samples.length,
        pcmSha256: sha256(decoded.raw),
        signal,
        strongestReference: strongest && strongestIndex !== null
          ? { peakIndex: strongestIndex, absoluteMs: strongest.absoluteMs, strength: strongest.strength }
          : null,
        candidates: primary.peaks,
        thresholdSensitivity: sensitivity,
        existingReview: reviews.get(recording.id) ?? null,
        acquisition: recording.acquisition ?? null,
        timingComparison: {
          scheduledChirpOffsetMs,
          strongestReferenceMinusScheduleMs: strongest && scheduledChirpOffsetMs !== null ? strongest.absoluteMs - scheduledChirpOffsetMs : null,
          note: 'Software schedule relative to planned capture start; the strongest peak is unverified. This is not an acoustic latency calibration.',
        },
      }
      captures.push(captureReport)
      capturesById.set(recording.id, captureReport)
      if (recording.captureBackend === 'audio-worklet') workletCaptureIds.add(recording.id)
      comparisonInputs.push({
        captureId: recording.id,
        position: recording.position,
        peaks: primary.peaks.map(peak => ({ delayMs: peak.absoluteMs, strength: peak.strength })),
      })
    }
  }

  const batches = document.mode === 'recorded' ? (document.batches ?? []).map(batch => createBatchReport(batch, capturesById, workletCaptureIds)) : []

  return {
    reportFormat: 'cha-echo-inspection-v1',
    reportVersion: ECHO_REPORT_VERSION,
    source: { sha256: sha256(inputBytes), byteLength: inputBytes.byteLength },
    analysis: {
      chirpDurationMs: ECHO_CHIRP_DURATION_MS,
      maxPeaks: ECHO_REPORT_MAX_PEAKS,
      threshold: options.threshold,
      spacingMs: options.spacingMs,
      thresholdSensitivity: uniqueThresholds(options.threshold),
    },
    scan: { format: document.format, sourceFormat: (JSON.parse(text) as { format: string }).format, mode: document.mode, notices: parsed.notices },
    captures,
    batches,
    crossPosition: document.mode === 'recorded' ? compareEchoResponses(comparisonInputs) : null,
  }
}

export function renderEchoInspectionReport(report: EchoInspectionReport, format: EchoInspectArguments['format']): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`
  const lines = [
    '# Echo inspection report',
    '',
    `- Report: ${report.reportFormat} (version ${report.reportVersion})`,
    `- Source SHA-256: \`${report.source.sha256}\` (${report.source.byteLength} bytes)`,
    `- Scan: ${report.scan.mode}; source ${report.scan.sourceFormat}; normalized ${report.scan.format}`,
    `- Analysis: ${report.analysis.chirpDurationMs} ms chirp, max ${report.analysis.maxPeaks} peaks, threshold ${report.analysis.threshold}, spacing ${report.analysis.spacingMs} ms`,
    '',
  ]
  for (const notice of report.scan.notices) lines.push(`> Notice: ${escapeMarkdown(notice)}`, '')
  if (report.scan.mode === 'synthetic') lines.push('Synthetic scan: this report contains no recorded PCM analysis.', '')
  for (const capture of report.captures) {
    lines.push(`## Capture ${escapeMarkdown(capture.captureId)}`, '')
    lines.push(`- Captured: ${escapeMarkdown(capture.capturedAt)}`)
    lines.push(`- Pose: (${capture.position.xM}, ${capture.position.yM}) m`)
    lines.push(`- PCM: ${capture.sampleRate} Hz, ${capture.sampleCount} samples; SHA-256 \`${capture.pcmSha256}\``)
    lines.push(`- Computed PCM signal: peak ${capture.signal.computedPeakAmplitude.toFixed(6)}, RMS ${capture.signal.computedRmsAmplitude.toFixed(6)}; ${capture.signal.clippedSampleCount} samples near full scale; longest exact-zero run ${capture.signal.longestZeroRunMs.toFixed(3)} ms`)
    lines.push(`- Zero intervals: ${capture.signal.zeroRuns.length ? capture.signal.zeroRuns.map(run => `[${run.startMs.toFixed(3)}, ${run.endMs.toFixed(3)}) ms`).join(', ') : 'none ≥5 ms'}`)
    lines.push(`- Strongest matched peak (reference only; not verified direct): ${capture.strongestReference ? `${capture.strongestReference.absoluteMs.toFixed(3)} ms, strength ${capture.strongestReference.strength.toFixed(6)}` : 'none'}`)
    if (!capture.acquisition) lines.push('- Acquisition telemetry: unknown; this recording has no acquisition record.')
    else {
      const acquisition = capture.acquisition
      const setting = (value: boolean | undefined) => value === undefined ? 'not reported' : value ? 'on' : 'off'
      lines.push(`- Acquisition v${acquisition.version}: ${acquisition.timing.precision}; settings are browser-reported, not hardware verification.`)
      for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const) lines.push(`  - ${key}: requested ${setting(acquisition.requested[key])}; reported ${setting(acquisition.applied[key])}`)
      if (acquisition.continuity.status === 'unavailable') lines.push('- Input continuity: unavailable; zero samples do not identify missing input.')
      else {
        const continuity = acquisition.continuity
        lines.push(`- Input continuity: ${continuity.presentInputFrames} present, ${continuity.missingInputFrames} missing, ${continuity.unobservedFrames} unobserved frames.`)
        lines.push(`- Present input zeros: ${continuity.presentZeroFrames} frames; longest run ${continuity.longestPresentZeroRunFrames} frames. These differ from zeros inferred after PCM encoding.`)
      }
      lines.push(`- Planned sweep offset: ${capture.timingComparison.scheduledChirpOffsetMs === null ? 'unknown (capture start unaligned)' : `${capture.timingComparison.scheduledChirpOffsetMs.toFixed(3)} ms`}. Strongest reference minus planned sweep: ${capture.timingComparison.strongestReferenceMinusScheduleMs === null ? 'unknown' : `${capture.timingComparison.strongestReferenceMinusScheduleMs.toFixed(3)} ms`}.`)
      lines.push(`- ${capture.timingComparison.note}`)
    }
    lines.push('')
    lines.push('| Threshold | Candidates (absolute ms / relative to strongest ms / strength / zero overlap) |')
    lines.push('|---:|---|')
    for (const result of capture.thresholdSensitivity) {
      const entries = result.peaks.length ? result.peaks.map(peak => `${peak.absoluteMs.toFixed(3)} / ${peak.relativeToStrongestMs.toFixed(3)} / ${peak.strength.toFixed(6)} / ${peak.overlapsZeroRun ? `yes (${peak.overlappingZeroRuns.join(',')})` : 'no'}`).join('<br>') : 'none'
      lines.push(`| ${result.threshold} | ${entries} |`)
    }
    lines.push('')
    if (capture.existingReview) {
      lines.push(`- Existing review preserved separately: direct index ${capture.existingReview.directPeakIndex ?? 'none'}, wall indices [${capture.existingReview.wallPeakIndices.join(', ')}], ${capture.existingReview.peaks.length} reviewed peaks.`, '')
    } else {
      lines.push('- Existing review: none.', '')
    }
  }
  lines.push('## Repeated probe batches', '')
  if (report.batches.length === 0) lines.push('No recorded probe batches.', '')
  for (const entry of report.batches) {
    const batch = entry.batch
    const repeatability = entry.repeatability
    lines.push(`### Batch ${escapeMarkdown(batch.id)}`, '')
    lines.push(`- Started: ${escapeMarkdown(batch.startedAt)}; ended: ${escapeMarkdown(batch.endedAt)}`)
    lines.push(`- Position: (${batch.position.xM}, ${batch.position.yM}) m; height ${batch.context.heightM} m; orientation ${batch.context.orientation}; heading ${batch.context.headingDeg}°; speaker volume ${batch.context.speakerVolumePercent}%`)
    lines.push(`- Playback gain: ${batch.playbackGain}; warmup ${batch.warmupMs} ms; probe interval ${batch.probeIntervalMs} ms; planned probes ${batch.plannedProbeCount}`)
    lines.push(`- Outcomes: ${repeatability.completedProbeCount} captured, ${batch.attempts.filter(attempt => attempt.status === 'interrupted').length} interrupted, ${batch.attempts.filter(attempt => attempt.status === 'not-started').length} not started; ${repeatability.eligibleProbeCount} eligible for repeat-spread calculation.`)
    for (const attempt of repeatability.attempts) {
      const label = attempt.status === 'captured' ? `capture ${escapeMarkdown(attempt.captureId ?? '')} (${attempt.captureLinkStatus})` : attempt.status === 'interrupted' ? 'interrupted' : 'not started'
      const timing = attempt.strongestReferenceMinusScheduleMs === null ? 'strongest-reference minus schedule unavailable' : `strongest-reference minus schedule ${attempt.strongestReferenceMinusScheduleMs.toFixed(3)} ms`
      const diagnostics = attempt.hasPcmZeroRuns === null ? '' : `; PCM zero runs ${attempt.hasPcmZeroRuns ? 'present' : 'absent'}; clipped samples ${attempt.hasClippedSamples ? 'present' : 'absent'}`
      const exclusion = attempt.exclusionReason ? `; excluded: ${escapeMarkdown(attempt.exclusionReason)}` : ''
      lines.push(`  - Attempt ${attempt.index}: ${label}; ${timing}${diagnostics}${exclusion}.`)
    }
    lines.push(`- Strongest-reference-minus-schedule spread: ${repeatability.spreadMs === null ? 'unavailable (fewer than two eligible probes)' : `${repeatability.spreadMs.toFixed(3)} ms`}.`)
    lines.push(`- ${repeatability.note}`, '')
  }
  if (report.crossPosition) {
    lines.push('## Cross-position comparison', '')
    lines.push(`- Geometric coverage: ${report.crossPosition.hasSpatialCoverage ? 'yes' : 'no'}`)
    lines.push('- Strongest peaks are comparison references only; they are not verified direct arrivals.')
    lines.push(`- Stationary relative-delay tracks: ${report.crossPosition.stationaryTracks.length}`)
    report.crossPosition.stationaryTracks.forEach(track => lines.push(`  - mean ${track.meanDelayMs.toFixed(3)} ms, spread ${track.spreadMs.toFixed(3)} ms (${track.arrivals.map(arrival => `${escapeMarkdown(arrival.captureId)} #${arrival.peakIndex}`).join(', ')})`))
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function createBatchReport(batch: ProbeBatch, capturesById: ReadonlyMap<string, EchoCaptureReport>, workletCaptureIds: ReadonlySet<string>): EchoBatchReport {
  const attempts: EchoBatchAttemptReport[] = batch.attempts.map(attempt => {
    if (attempt.status !== 'captured') return {
      index: attempt.index, status: attempt.status, captureId: null,
      captureLinkStatus: attempt.status, strongestReferenceMinusScheduleMs: null,
      eligible: false, exclusionReason: attempt.status === 'interrupted' ? `probe interrupted (${attempt.reason})` : 'probe was not started',
      hasPcmZeroRuns: null, hasClippedSamples: null,
    }
    const captureId = attempt.captureId
    const capture = capturesById.get(captureId)
    if (!capture) return {
      index: attempt.index, status: attempt.status, captureId, captureLinkStatus: 'missing',
      strongestReferenceMinusScheduleMs: null, eligible: false, exclusionReason: 'linked capture report is missing',
      hasPcmZeroRuns: null, hasClippedSamples: null,
    }
    const acquisition = capture.acquisition
    let exclusionReason: string | null = null
    if (!workletCaptureIds.has(captureId)) exclusionReason = 'audio-worklet capture provenance is unavailable'
    else if (!acquisition || acquisition.timing.precision !== 'sample-frame' || acquisition.timing.captureStartFrame === null) exclusionReason = 'sample-frame acquisition timing is unavailable'
    else if (acquisition.continuity.status !== 'observed') exclusionReason = 'input continuity was not observed'
    else if (acquisition.continuity.missingInputFrames !== 0 || acquisition.continuity.unobservedFrames !== 0) exclusionReason = 'input continuity reports missing or unobserved frames'
    else if (capture.strongestReference === null) exclusionReason = 'no strongest matched-peak reference is available'
    else if (capture.timingComparison.strongestReferenceMinusScheduleMs === null) exclusionReason = 'scheduled capture reference is unavailable'
    else if (capture.sampleRate !== batch.sampleRate) exclusionReason = 'capture sample rate differs from the batch'
    return {
      index: attempt.index, status: attempt.status, captureId, captureLinkStatus: 'linked',
      strongestReferenceMinusScheduleMs: capture.timingComparison.strongestReferenceMinusScheduleMs,
      eligible: exclusionReason === null, exclusionReason,
      hasPcmZeroRuns: capture.signal.zeroRuns.length > 0,
      hasClippedSamples: capture.signal.clippedSampleCount > 0,
    }
  })
  const eligibleValues = attempts.flatMap(attempt => attempt.eligible && attempt.strongestReferenceMinusScheduleMs !== null ? [attempt.strongestReferenceMinusScheduleMs] : [])
  const spreadMs = eligibleValues.length >= 2 ? Math.max(...eligibleValues) - Math.min(...eligibleValues) : null
  return {
    batch,
    repeatability: {
      attempts,
      completedProbeCount: batch.attempts.filter(attempt => attempt.status === 'captured').length,
      eligibleProbeCount: eligibleValues.length,
      spreadMs,
      spreadStatus: spreadMs === null ? 'insufficient-eligible-probes' : 'computed',
      note: 'This reports strongest unverified clock-lag variation relative to the software schedule only. It is not a verified wall arrival or acoustic latency measurement.',
    },
  }
}

export function decodePcm16(recording: SatelliteCapture): { raw: Uint8Array; samples: Float32Array } {
  return { raw: Buffer.from(recording.pcm16Base64, 'base64'), samples: decodePcm16Base64(recording.pcm16Base64) }
}

function analyzePeaks(samples: Float32Array, sampleRate: number, threshold: number, spacingMs: number, zeroRuns: ReturnType<typeof inspectEchoSignal>['zeroRuns']): EchoReportedPeak[] {
  const peaks = extractEchoPeaks(samples, sampleRate, {
    chirpDurationMs: ECHO_CHIRP_DURATION_MS,
    maxPeaks: ECHO_REPORT_MAX_PEAKS,
    thresholdRatio: threshold,
    minimumSpacingMs: spacingMs,
    relativeToFirstPeak: false,
  })
  const strongest = peaks.reduce((best, peak) => Math.max(best, peak.strength), 0)
  return peaks.map(peak => {
    const overlappingZeroRuns = zeroRuns.flatMap((run, index) => {
      const windowStartMs = peak.delayMs
      const windowEndMs = windowStartMs + ECHO_CHIRP_DURATION_MS
      return run.startMs < windowEndMs && run.endMs > windowStartMs ? [index] : []
    })
    return {
      absoluteMs: peak.delayMs,
      relativeToStrongestMs: peak.delayMs - (peaks.find(candidate => candidate.strength === strongest)?.delayMs ?? peak.delayMs),
      strength: peak.strength,
      overlapsZeroRun: overlappingZeroRuns.length > 0,
      overlappingZeroRuns,
    }
  })
}

function strongestPeakIndex(peaks: readonly EchoReportedPeak[]): number | null {
  if (peaks.length === 0) return null
  let index = 0
  for (let i = 1; i < peaks.length; i += 1) if (peaks[i]!.strength > peaks[index]!.strength) index = i
  return index
}

function uniqueThresholds(primary: number): number[] {
  return [...new Set([primary, ...ECHO_REPORT_THRESHOLDS])]
}

function measureAmplitude(samples: Float32Array): { computedPeakAmplitude: number; computedRmsAmplitude: number } {
  let peak = 0
  let sumSquares = 0
  for (const sample of samples) {
    const magnitude = Math.abs(sample)
    if (magnitude > peak) peak = magnitude
    sumSquares += sample * sample
  }
  return { computedPeakAmplitude: peak, computedRmsAmplitude: Math.sqrt(sumSquares / samples.length) }
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function escapeMarkdown(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\`*_\[\]{}()#!|]/g, '\\$&').replace(/[\r\n]/g, ' ')
}
