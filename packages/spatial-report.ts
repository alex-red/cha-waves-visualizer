import { SPATIAL_BUNDLE_MAX_BYTES, SPATIAL_BUNDLE_LIMITS, validateSpatialBundle, type SpatialBundle, type SpatialMethod, type SpatialPose, type SpatialTime } from './spatial-bundle.ts'
import { applyRigidTransform, composeRigidTransforms, type Quaternion, type Vector3 } from './spatial-registration.ts'
import type { EchoScanDocument, EchoScanReview } from './echo-scan.ts'
import { ECHO_SCAN_MAX_BYTES } from './echo-scan.ts'
import { inspectEchoSignal, type EchoSignalInspection } from './echo-diagnostics.ts'
import { decodePcm16Base64 } from './satellite.ts'
import type { AcquisitionMetadata } from './acquisition.ts'

export interface SpatialSourceInput {
  sourceId: string
  sha256: string
  byteLength: number
  document: EchoScanDocument
  notices: string[]
}

export interface SpatialManifestInput { sha256: string; byteLength: number }

export type SpatialWorldPose =
  | { status: 'known'; positionM: Vector3; orientationXyzw: Quaternion; poseMethod: SpatialMethod; registrationMethod: SpatialMethod | 'world-frame' }
  | { status: 'unknown'; reason: string }

export interface SpatialObservationReport {
  id: string
  sourceId: string
  sourceSha256: string
  captureRef: SpatialBundle['observations'][number]['captureRef']
  originalPositionXYM: { xM: number; yM: number }
  time: SpatialTime
  speaker: { input: SpatialPose; world: SpatialWorldPose }
  microphone: { input: SpatialPose; world: SpatialWorldPose }
  measurement:
    | { mode: 'synthetic'; arrivalTimesMs: number[] }
    | { mode: 'recorded'; sampleRate: number; sampleCount: number; durationMs: number; signal: EchoSignalInspection; continuity: AcquisitionMetadata['continuity'] | null; review: EchoScanReview | null }
}

export interface SpatialInspectionReport {
  reportFormat: 'cha-spatial-inspection-v1'
  manifest: SpatialManifestInput & { id: string; format: SpatialBundle['format'] }
  worldFrame: SpatialBundle['worldFrame']
  frames: SpatialBundle['frames']
  clocks: SpatialBundle['clocks']
  sources: Array<{ id: string; sha256: string; byteLength: number; scanFormat: EchoScanDocument['format']; mode: EchoScanDocument['mode']; captureCount: number; notices: string[] }>
  observations: SpatialObservationReport[]
  summary: { sourceCount: number; observationCount: number; syntheticCount: number; recordedCount: number; knownSpeakerWorldPoseCount: number; knownMicrophoneWorldPoseCount: number; knownTimeCount: number }
  limitations: string[]
}

function metadata(value: SpatialManifestInput, maxBytes: number, context: string): void {
  if (!/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > maxBytes) {
    throw new Error(`${context} must have a SHA256 and a bounded positive byte length.`)
  }
}

function resolvePose(pose: SpatialPose, bundle: SpatialBundle): SpatialWorldPose {
  if (pose.status === 'unknown') return { status: 'unknown', reason: pose.reason }
  if (pose.frameId === bundle.worldFrame.id) return {
    status: 'known', positionM: [...pose.positionM], orientationXyzw: [...pose.orientationXyzw],
    poseMethod: pose.method, registrationMethod: 'world-frame',
  }
  const frame = bundle.frames.find(item => item.id === pose.frameId)
  if (!frame) throw new Error('Pose references an undeclared frame.')
  if (frame.toWorld.status === 'unknown') return { status: 'unknown', reason: frame.toWorld.reason }
  const transform = frame.toWorld.transform
  const orientation = composeRigidTransforms(transform, { translationM: [0, 0, 0], rotationXyzw: pose.orientationXyzw }).rotationXyzw
  return {
    status: 'known', positionM: applyRigidTransform(pose.positionM, transform), orientationXyzw: orientation,
    poseMethod: pose.method, registrationMethod: frame.toWorld.method,
  }
}

/** Replay validated observations and supplied registration, without estimating geometry or clock synchronization. */
export function createSpatialInspectionReport(
  input: SpatialBundle,
  sources: readonly SpatialSourceInput[],
  manifest: SpatialManifestInput,
): SpatialInspectionReport {
  const bundle = validateSpatialBundle(input)
  metadata(manifest, SPATIAL_BUNDLE_MAX_BYTES, 'manifest')
  if (sources.length !== bundle.sources.length || new Set(sources.map(source => source.sourceId)).size !== sources.length) {
    throw new Error('sources must provide exactly one input for every declared source.')
  }
  let totalBytes = 0
  const sourceReports = bundle.sources.map(declared => {
    const source = sources.find(item => item.sourceId === declared.id)
    if (!source) throw new Error('sources contain a missing or undeclared source ID.')
    metadata(source, ECHO_SCAN_MAX_BYTES, 'source')
    if (source.sha256 !== declared.sha256) throw new Error('Source SHA256 does not match the manifest.')
    totalBytes += source.byteLength
    return {
      id: declared.id, sha256: source.sha256, byteLength: source.byteLength,
      scanFormat: source.document.format, mode: source.document.mode,
      captureCount: source.document.mode === 'synthetic' ? source.document.captures.length : source.document.recordings.length,
      notices: [...source.notices],
    }
  })
  if (totalBytes > SPATIAL_BUNDLE_LIMITS.maxCombinedSourceBytes) throw new Error('Combined sources exceed the byte limit.')

  const observations = bundle.observations.map<SpatialObservationReport>(observation => {
    const source = sources.find(item => item.sourceId === observation.sourceId)!
    const document = source.document
    const reference = observation.captureRef
    let originalPositionXYM: { xM: number; yM: number }
    let measurement: SpatialObservationReport['measurement']
    if (document.mode === 'synthetic' && reference.kind === 'synthetic') {
      const capture = document.captures[reference.index]
      if (!capture) throw new Error('Observation references a missing synthetic capture.')
      originalPositionXYM = { ...capture.position }
      measurement = { mode: 'synthetic', arrivalTimesMs: [...capture.arrivalTimesMs] }
    } else if (document.mode === 'recorded' && reference.kind === 'recorded') {
      const capture = document.recordings.find(item => item.id === reference.captureId)
      if (!capture) throw new Error('Observation references a missing recorded capture.')
      const samples = decodePcm16Base64(capture.pcm16Base64)
      originalPositionXYM = { ...capture.position }
      measurement = {
        mode: 'recorded', sampleRate: capture.sampleRate, sampleCount: samples.length, durationMs: capture.durationMs,
        signal: inspectEchoSignal(samples, capture.sampleRate),
        continuity: capture.acquisition ? structuredClone(capture.acquisition.continuity) : null,
        review: structuredClone(document.reviews.find(item => item.captureId === capture.id) ?? null),
      }
    } else throw new Error('Observation capture kind does not match source scan mode.')
    return {
      id: observation.id, sourceId: observation.sourceId, sourceSha256: source.sha256,
      captureRef: { ...reference }, originalPositionXYM, time: structuredClone(observation.time),
      speaker: { input: structuredClone(observation.speakerPose), world: resolvePose(observation.speakerPose, bundle) },
      microphone: { input: structuredClone(observation.microphonePose), world: resolvePose(observation.microphonePose, bundle) },
      measurement,
    }
  })

  return {
    reportFormat: 'cha-spatial-inspection-v1',
    manifest: { sha256: manifest.sha256, byteLength: manifest.byteLength, id: bundle.id, format: bundle.format },
    worldFrame: { ...bundle.worldFrame }, frames: structuredClone(bundle.frames), clocks: structuredClone(bundle.clocks),
    sources: sourceReports, observations,
    summary: {
      sourceCount: sourceReports.length, observationCount: observations.length,
      syntheticCount: observations.filter(item => item.measurement.mode === 'synthetic').length,
      recordedCount: observations.filter(item => item.measurement.mode === 'recorded').length,
      knownSpeakerWorldPoseCount: observations.filter(item => item.speaker.world.status === 'known').length,
      knownMicrophoneWorldPoseCount: observations.filter(item => item.microphone.world.status === 'known').length,
      knownTimeCount: observations.filter(item => item.time.status === 'known').length,
    },
    limitations: [
      'This report replays supplied registration; it does not reconstruct geometry or identify a wall.',
      'Synthetic arrivals are numerical fixtures, not physical mapping evidence.',
      'Original X/Y and manual batch context are not promoted to calibrated 3D sensor poses.',
      'Clock offsets are declared time coordinates, not acoustic emission times; different clocks are not synchronized.',
      'Unknown pose or frame registration remains unavailable; method labels do not establish accuracy.',
    ],
  }
}

function markdown(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#!|~]/g, character => `\\${character}`).replace(/[\r\n]/g, ' ')
}

function poseText(pose: SpatialWorldPose): string {
  if (pose.status === 'unknown') return `Unavailable: ${markdown(pose.reason)}`
  return `position [${pose.positionM.join(', ')}] m; quaternion XYZW [${pose.orientationXyzw.join(', ')}]; pose ${pose.poseMethod}, registration ${pose.registrationMethod}`
}

export function renderSpatialInspectionReport(report: SpatialInspectionReport, format: 'json' | 'markdown'): string {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n'
  if (format !== 'markdown') throw new Error('Report format must be json or markdown.')
  const lines = [
    '# Spatial inspection', '',
    `Bundle: ${markdown(report.manifest.id)} (${report.manifest.format})`,
    `Manifest SHA256: ${report.manifest.sha256}; bytes: ${report.manifest.byteLength}`, '',
    `World frame: ${markdown(report.worldFrame.id)}; metres; right-handed, Z up.`,
    `Sources: ${report.summary.sourceCount}; observations: ${report.summary.observationCount} (${report.summary.syntheticCount} synthetic, ${report.summary.recordedCount} recorded).`,
    `Available world poses: speaker ${report.summary.knownSpeakerWorldPoseCount}, microphone ${report.summary.knownMicrophoneWorldPoseCount}. Known time coordinates: ${report.summary.knownTimeCount}.`, '',
    '## Sources', '',
  ]
  for (const source of report.sources) {
    lines.push(`- ${markdown(source.id)}: ${source.mode}; ${source.scanFormat}; ${source.captureCount} captures; ${source.byteLength} bytes; SHA256 ${source.sha256}`)
    for (const notice of source.notices) lines.push(`  - ${markdown(notice)}`)
  }
  for (const observation of report.observations) {
    const capture = observation.captureRef.kind === 'recorded' ? `capture ID ${markdown(observation.captureRef.captureId)}` : `synthetic index ${observation.captureRef.index}`
    const time = observation.time.status === 'known'
      ? `${observation.time.timeMs} ms in clock ${markdown(observation.time.clockId)} (${observation.time.method}); no cross-clock alignment inferred`
      : `Unavailable: ${markdown(observation.time.reason)}`
    lines.push('', `## Observation ${markdown(observation.id)}`, '',
      `Source: ${markdown(observation.sourceId)}; ${capture}; SHA256 ${observation.sourceSha256}`,
      `Original plan position: X ${observation.originalPositionXYM.xM} m, Y ${observation.originalPositionXYM.yM} m.`,
      `Time: ${time}`, `Speaker world pose: ${poseText(observation.speaker.world)}`, `Microphone world pose: ${poseText(observation.microphone.world)}`)
    if (observation.measurement.mode === 'synthetic') {
      lines.push(`Synthetic direct-relative arrival delays: [${observation.measurement.arrivalTimesMs.join(', ')}] ms.`)
    } else {
      const measurement = observation.measurement
      lines.push(`Recorded PCM: ${measurement.sampleCount} samples at ${measurement.sampleRate} Hz; ${measurement.durationMs} ms.`,
        `Near-full-scale samples: ${measurement.signal.clippedSampleCount}; longest exact-zero run: ${measurement.signal.longestZeroRunMs} ms.`,
        `Acquisition continuity: ${measurement.continuity ? markdown(measurement.continuity.status) : 'unknown'}. Reviewed arrivals: ${measurement.review?.peaks.length ?? 0}; identities are user selections.`)
      for (const run of measurement.signal.zeroRuns) lines.push(`- Exact-zero interval: [${run.startMs}, ${run.endMs}) ms from capture start.`)
    }
  }
  lines.push('', '## Limits', '', ...report.limitations.map(value => `- ${markdown(value)}`), '')
  return lines.join('\n')
}
