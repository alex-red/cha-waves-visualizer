import type { Quaternion, RigidTransform, Vector3 } from './spatial-registration.ts'

export const SPATIAL_BUNDLE_FORMAT = 'cha-spatial-bundle-v1' as const
export const SPATIAL_BUNDLE_MAX_BYTES = 256 * 1024

export const SPATIAL_BUNDLE_LIMITS = {
  maxBytes: SPATIAL_BUNDLE_MAX_BYTES,
  maxFrames: 16,
  maxClocks: 32,
  maxSources: 4,
  maxObservations: 48,
  maxSourceBytes: 10 * 1024 * 1024,
  maxCombinedSourceBytes: 40 * 1024 * 1024,
  maxCoordinateM: 1_000_000,
  maxJsonDepth: 64,
  maxJsonNodes: 200_000,
} as const

export type SpatialMethod = 'supplied' | 'estimated' | 'synthetic'

export type SpatialRegistration =
  | { status: 'known'; transform: RigidTransform; method: SpatialMethod }
  | { status: 'unknown'; reason: string }

export type SpatialPose =
  | { status: 'known'; frameId: string; positionM: Vector3; orientationXyzw: Quaternion; method: SpatialMethod }
  | { status: 'unknown'; reason: string }

export type SpatialTime =
  | { status: 'known'; clockId: string; timeMs: number; method: SpatialMethod }
  | { status: 'unknown'; reason: string }

export type SpatialBundle = {
  format: typeof SPATIAL_BUNDLE_FORMAT
  id: string
  worldFrame: { id: string; units: 'm'; axes: 'right-handed-z-up' }
  frames: Array<{ id: string; toWorld: SpatialRegistration }>
  clocks: Array<{ id: string; units: 'ms' }>
  sources: Array<{ id: string; path: string; sha256: string }>
  observations: Array<{
    id: string
    sourceId: string
    captureRef: { kind: 'recorded'; captureId: string } | { kind: 'synthetic'; index: number }
    time: SpatialTime
    speakerPose: SpatialPose
    microphonePose: SpatialPose
  }>
}

function fail(path: string, issue: string): never {
  throw new Error(`${path} ${issue}.`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(path, 'contains an unsupported field')
  }
}

function array(value: unknown, path: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array')
  if (value.length < minimum) fail(path, `must contain at least ${minimum} item${minimum === 1 ? '' : 's'}`)
  if (value.length > maximum) fail(path, `may contain at most ${maximum} items`)
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string')
  return value
}

function identifier(value: unknown, path: string): string {
  const result = string(value, path)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(result)) fail(path, 'must be 1–80 ASCII letters, digits, periods, underscores or hyphens, starting with a letter or digit')
  return result
}

function printable(value: unknown, path: string, maximum: number): string {
  const result = string(value, path)
  if (result.length < 1 || result.length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(result)) {
    fail(path, `must contain 1–${maximum} printable characters`)
  }
  return result
}

function method(value: unknown, path: string): SpatialMethod {
  if (value !== 'supplied' && value !== 'estimated' && value !== 'synthetic') fail(path, 'must be supplied, estimated or synthetic')
  return value
}

function finiteNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function triple(value: unknown, path: string): Vector3 {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'must contain exactly three coordinates')
  return [
    finiteNumber(value[0], `${path}[0]`, -SPATIAL_BUNDLE_LIMITS.maxCoordinateM, SPATIAL_BUNDLE_LIMITS.maxCoordinateM),
    finiteNumber(value[1], `${path}[1]`, -SPATIAL_BUNDLE_LIMITS.maxCoordinateM, SPATIAL_BUNDLE_LIMITS.maxCoordinateM),
    finiteNumber(value[2], `${path}[2]`, -SPATIAL_BUNDLE_LIMITS.maxCoordinateM, SPATIAL_BUNDLE_LIMITS.maxCoordinateM),
  ]
}

function quaternion(value: unknown, path: string): Quaternion {
  if (!Array.isArray(value) || value.length !== 4) fail(path, 'must contain exactly four quaternion components')
  const q: Quaternion = [
    finiteNumber(value[0], `${path}[0]`, -1, 1),
    finiteNumber(value[1], `${path}[1]`, -1, 1),
    finiteNumber(value[2], `${path}[2]`, -1, 1),
    finiteNumber(value[3], `${path}[3]`, -1, 1),
  ]
  const norm = Math.hypot(...q)
  if (Math.abs(norm - 1) > 1e-6) fail(path, 'must have unit norm within 1e-6')
  return q
}

function transform(input: unknown, path: string): RigidTransform {
  const value = object(input, path)
  exactKeys(value, ['translationM', 'rotationXyzw'], path)
  return { translationM: triple(value.translationM, `${path}.translationM`), rotationXyzw: quaternion(value.rotationXyzw, `${path}.rotationXyzw`) }
}

function registration(input: unknown, path: string): SpatialRegistration {
  const value = object(input, path)
  if (value.status === 'unknown') {
    exactKeys(value, ['status', 'reason'], path)
    return { status: 'unknown', reason: printable(value.reason, `${path}.reason`, 240) }
  }
  if (value.status === 'known') {
    exactKeys(value, ['status', 'transform', 'method'], path)
    return { status: 'known', transform: transform(value.transform, `${path}.transform`), method: method(value.method, `${path}.method`) }
  }
  return fail(`${path}.status`, 'must be known or unknown')
}

function pose(input: unknown, path: string, frameIds: ReadonlySet<string>): SpatialPose {
  const value = object(input, path)
  if (value.status === 'unknown') {
    exactKeys(value, ['status', 'reason'], path)
    return { status: 'unknown', reason: printable(value.reason, `${path}.reason`, 240) }
  }
  if (value.status === 'known') {
    exactKeys(value, ['status', 'frameId', 'positionM', 'orientationXyzw', 'method'], path)
    const frameId = identifier(value.frameId, `${path}.frameId`)
    if (!frameIds.has(frameId)) fail(`${path}.frameId`, 'must refer to the world frame or a declared local frame')
    return {
      status: 'known', frameId,
      positionM: triple(value.positionM, `${path}.positionM`),
      orientationXyzw: quaternion(value.orientationXyzw, `${path}.orientationXyzw`),
      method: method(value.method, `${path}.method`),
    }
  }
  return fail(`${path}.status`, 'must be known or unknown')
}

function time(input: unknown, path: string, clockIds: ReadonlySet<string>): SpatialTime {
  const value = object(input, path)
  if (value.status === 'unknown') {
    exactKeys(value, ['status', 'reason'], path)
    return { status: 'unknown', reason: printable(value.reason, `${path}.reason`, 240) }
  }
  if (value.status === 'known') {
    exactKeys(value, ['status', 'clockId', 'timeMs', 'method'], path)
    const clockId = identifier(value.clockId, `${path}.clockId`)
    if (!clockIds.has(clockId)) fail(`${path}.clockId`, 'must refer to a declared clock')
    return { status: 'known', clockId, timeMs: finiteNumber(value.timeMs, `${path}.timeMs`, 0, Number.MAX_SAFE_INTEGER), method: method(value.method, `${path}.method`) }
  }
  return fail(`${path}.status`, 'must be known or unknown')
}

function sourcePath(value: unknown, path: string): string {
  const result = string(value, path)
  if (!result || Array.from(result).length > 1024 || /[\u0000-\u001f\u007f-\u009f]/.test(result)) {
    fail(path, 'must contain 1–1024 printable path characters')
  }
  if (result.startsWith('/') || result.includes('\\') || /[:?#]/.test(result)) fail(path, 'must be a portable relative POSIX path within the bundle directory')
  const segments = result.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) fail(path, 'must not contain empty, dot or traversal segments')
  return result
}

function checkJsonShape(input: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]
  const seen = new Set<object>()
  let visited = 0
  while (pending.length) {
    const item = pending.pop()!
    visited += 1
    if (visited > SPATIAL_BUNDLE_LIMITS.maxJsonNodes) fail('$', `contains more than ${SPATIAL_BUNDLE_LIMITS.maxJsonNodes} values`)
    if (!item.value || typeof item.value !== 'object') continue
    if (item.depth > SPATIAL_BUNDLE_LIMITS.maxJsonDepth) fail('$', `nesting exceeds ${SPATIAL_BUNDLE_LIMITS.maxJsonDepth} levels`)
    if (seen.has(item.value)) fail('$', 'must not contain cycles or repeated object references')
    seen.add(item.value)
    const entries = Object.entries(item.value)
    if (visited + pending.length + entries.length > SPATIAL_BUNDLE_LIMITS.maxJsonNodes) fail('$', `contains more than ${SPATIAL_BUNDLE_LIMITS.maxJsonNodes} values`)
    for (const [, value] of entries) pending.push({ value, depth: item.depth + 1 })
  }
}

/** Validate and return a defensive, normalized spatial bundle. */
export function validateSpatialBundle(input: unknown): SpatialBundle {
  checkJsonShape(input)
  const value = object(input, '$')
  exactKeys(value, ['format', 'id', 'worldFrame', 'frames', 'clocks', 'sources', 'observations'], '$')
  if (value.format !== SPATIAL_BUNDLE_FORMAT) fail('format', 'has an unsupported version')
  const id = identifier(value.id, 'id')

  const worldInput = object(value.worldFrame, 'worldFrame')
  exactKeys(worldInput, ['id', 'units', 'axes'], 'worldFrame')
  const worldFrameId = identifier(worldInput.id, 'worldFrame.id')
  if (worldInput.units !== 'm') fail('worldFrame.units', 'must be m')
  if (worldInput.axes !== 'right-handed-z-up') fail('worldFrame.axes', 'must be right-handed-z-up')

  const frames = array(value.frames, 'frames', SPATIAL_BUNDLE_LIMITS.maxFrames).map((inputFrame, index) => {
    const path = `frames[${index}]`
    const frame = object(inputFrame, path)
    exactKeys(frame, ['id', 'toWorld'], path)
    const frameId = identifier(frame.id, `${path}.id`)
    if (frameId === worldFrameId) fail(`${path}.id`, 'must not duplicate the world frame id')
    return { id: frameId, toWorld: registration(frame.toWorld, `${path}.toWorld`) }
  })
  const frameIds = new Set([worldFrameId])
  for (const frame of frames) {
    if (frameIds.has(frame.id)) fail('frames', 'contains duplicate frame ids')
    frameIds.add(frame.id)
  }

  const clocks = array(value.clocks, 'clocks', SPATIAL_BUNDLE_LIMITS.maxClocks).map((inputClock, index) => {
    const path = `clocks[${index}]`
    const clock = object(inputClock, path)
    exactKeys(clock, ['id', 'units'], path)
    const clockId = identifier(clock.id, `${path}.id`)
    if (clock.units !== 'ms') fail(`${path}.units`, 'must be ms')
    return { id: clockId, units: 'ms' as const }
  })
  const clockIds = new Set<string>()
  for (const clock of clocks) {
    if (clockIds.has(clock.id)) fail('clocks', 'contains duplicate clock ids')
    clockIds.add(clock.id)
  }

  const sources = array(value.sources, 'sources', SPATIAL_BUNDLE_LIMITS.maxSources, 1).map((inputSource, index) => {
    const path = `sources[${index}]`
    const source = object(inputSource, path)
    exactKeys(source, ['id', 'path', 'sha256'], path)
    const sourceId = identifier(source.id, `${path}.id`)
    const filePath = sourcePath(source.path, `${path}.path`)
    const sha256 = string(source.sha256, `${path}.sha256`)
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail(`${path}.sha256`, 'must be 64 lowercase hexadecimal characters')
    return { id: sourceId, path: filePath, sha256 }
  })
  const sourceIds = new Set<string>()
  const sourcePaths = new Set<string>()
  for (const source of sources) {
    if (sourceIds.has(source.id)) fail('sources', 'contains duplicate source ids')
    if (sourcePaths.has(source.path)) fail('sources', 'contains duplicate paths')
    sourceIds.add(source.id)
    sourcePaths.add(source.path)
  }

  const observations = array(value.observations, 'observations', SPATIAL_BUNDLE_LIMITS.maxObservations, 1).map((inputObservation, index) => {
    const path = `observations[${index}]`
    const observation = object(inputObservation, path)
    exactKeys(observation, ['id', 'sourceId', 'captureRef', 'time', 'speakerPose', 'microphonePose'], path)
    const observationId = identifier(observation.id, `${path}.id`)
    const sourceId = identifier(observation.sourceId, `${path}.sourceId`)
    if (!sourceIds.has(sourceId)) fail(`${path}.sourceId`, 'must refer to a declared source')
    const refInput = object(observation.captureRef, `${path}.captureRef`)
    let captureRef: SpatialBundle['observations'][number]['captureRef']
    if (refInput.kind === 'recorded') {
      exactKeys(refInput, ['kind', 'captureId'], `${path}.captureRef`)
      captureRef = { kind: 'recorded', captureId: printable(refInput.captureId, `${path}.captureRef.captureId`, 128) }
    } else if (refInput.kind === 'synthetic') {
      exactKeys(refInput, ['kind', 'index'], `${path}.captureRef`)
      const indexValue = finiteNumber(refInput.index, `${path}.captureRef.index`, 0, Number.MAX_SAFE_INTEGER)
      if (!Number.isInteger(indexValue)) fail(`${path}.captureRef.index`, 'must be a zero-based integer')
      captureRef = { kind: 'synthetic', index: indexValue }
    } else {
      fail(`${path}.captureRef.kind`, 'must be recorded or synthetic')
    }
    return {
      id: observationId,
      sourceId,
      captureRef,
      time: time(observation.time, `${path}.time`, clockIds),
      speakerPose: pose(observation.speakerPose, `${path}.speakerPose`, frameIds),
      microphonePose: pose(observation.microphonePose, `${path}.microphonePose`, frameIds),
    }
  })
  const observationIds = new Set<string>()
  const captureRefs = new Set<string>()
  for (const observation of observations) {
    if (observationIds.has(observation.id)) fail('observations', 'contains duplicate observation ids')
    observationIds.add(observation.id)
    const ref = observation.captureRef.kind === 'recorded' ? `recorded:${observation.captureRef.captureId}` : `synthetic:${observation.captureRef.index}`
    const key = `${observation.sourceId}\u0000${ref}`
    if (captureRefs.has(key)) fail('observations', 'contains duplicate source/capture references')
    captureRefs.add(key)
  }

  return { format: SPATIAL_BUNDLE_FORMAT, id, worldFrame: { id: worldFrameId, units: 'm', axes: 'right-handed-z-up' }, frames, clocks, sources, observations }
}

/** Parse bounded JSON, then apply the same strict contract as validateSpatialBundle. */
export function parseSpatialBundle(json: string): SpatialBundle {
  if (typeof json !== 'string') fail('$', 'must be JSON text')
  if (new TextEncoder().encode(json).byteLength > SPATIAL_BUNDLE_MAX_BYTES) fail('$', `exceeds the ${SPATIAL_BUNDLE_MAX_BYTES}-byte limit`)
  let value: unknown
  try { value = JSON.parse(json) }
  catch { return fail('$', 'must contain valid JSON') }
  return validateSpatialBundle(value)
}
