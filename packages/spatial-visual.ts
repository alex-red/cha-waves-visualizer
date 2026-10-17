import { VISUAL_LIMITS, VISUAL_MANIFEST_FORMAT, type VisualAssetStats, type VisualCamera, type VisualManifest, type VisualRegistration } from './spatial-visual-types.ts'
import { applyRigidTransform, type Vector3 } from './spatial-registration.ts'

const UNIT_TOLERANCE = 1e-6
const MIN_SCALE_M_PER_UNIT = 1e-6
const MAX_SCALE_M_PER_UNIT = 1_000_000
const MAX_SPLAT_SCALE = 10_000
const MAX_CAMERA_DIMENSION = 32_768
const MAX_METADATA_TEXT = 2_048
const MIN_FOCAL_LENGTH = 1e-3

function fail(path: string, issue: string): never {
  throw new Error(`${path} ${issue}.`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, 'contains an unsupported field')
}

function string(value: unknown, path: string, max = MAX_METADATA_TEXT): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    fail(path, `must contain 1–${max} printable characters`)
  }
  return value
}

function nullableHttpsUrl(value: unknown, path: string): string | null {
  if (value === null) return null
  const text = string(value, path, 2_048)
  let parsed: URL
  try { parsed = new URL(text) } catch { return fail(path, 'must be an HTTPS URL or null') }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) fail(path, 'must be an HTTPS URL or null')
  return text
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function vector3(value: unknown, path: string): Vector3 {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'must contain exactly three coordinates')
  return [
    finite(value[0], `${path}[0]`, -VISUAL_LIMITS.coordinate, VISUAL_LIMITS.coordinate),
    finite(value[1], `${path}[1]`, -VISUAL_LIMITS.coordinate, VISUAL_LIMITS.coordinate),
    finite(value[2], `${path}[2]`, -VISUAL_LIMITS.coordinate, VISUAL_LIMITS.coordinate),
  ]
}

function quaternion(value: unknown, path: string): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) fail(path, 'must contain exactly four quaternion components')
  const q: [number, number, number, number] = [
    finite(value[0], `${path}[0]`, -1, 1),
    finite(value[1], `${path}[1]`, -1, 1),
    finite(value[2], `${path}[2]`, -1, 1),
    finite(value[3], `${path}[3]`, -1, 1),
  ]
  if (Math.abs(Math.hypot(...q) - 1) > UNIT_TOLERANCE) fail(path, 'must have unit norm within 1e-6')
  return q
}

function method(value: unknown, path: string): 'supplied' | 'estimated' | 'synthetic' {
  if (value !== 'supplied' && value !== 'estimated' && value !== 'synthetic') fail(path, 'must be supplied, estimated or synthetic')
  return value
}

function registration(input: unknown): VisualRegistration {
  const value = object(input, 'registration')
  if (value.status === 'unknown') {
    exactKeys(value, ['status', 'reason'], 'registration')
    return { status: 'unknown', reason: string(value.reason, 'registration.reason', 240) }
  }
  if (value.status !== 'known') fail('registration.status', 'must be known or unknown')
  exactKeys(value, ['status', 'scaleMPerUnit', 'rotationXyzw', 'translationM', 'method'], 'registration')
  return {
    status: 'known',
    scaleMPerUnit: finite(value.scaleMPerUnit, 'registration.scaleMPerUnit', MIN_SCALE_M_PER_UNIT, MAX_SCALE_M_PER_UNIT),
    rotationXyzw: quaternion(value.rotationXyzw, 'registration.rotationXyzw'),
    translationM: vector3(value.translationM, 'registration.translationM'),
    method: method(value.method, 'registration.method'),
  }
}

function camera(input: unknown, index: number): VisualCamera {
  const path = `cameras[${index}]`
  const value = object(input, path)
  exactKeys(value, ['id', 'role', 'position', 'orientationXyzw', 'intrinsics', 'imageSha256'], path)
  const id = string(value.id, `${path}.id`, 80)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) fail(`${path}.id`, 'must be a safe identifier')
  if (value.role !== 'training' && value.role !== 'held-out' && value.role !== 'illustrative') fail(`${path}.role`, 'is unsupported')
  const intrinsicsInput = object(value.intrinsics, `${path}.intrinsics`)
  exactKeys(intrinsicsInput, ['width', 'height', 'fx', 'fy', 'cx', 'cy'], `${path}.intrinsics`)
  const width = finite(intrinsicsInput.width, `${path}.intrinsics.width`, 1, MAX_CAMERA_DIMENSION)
  const height = finite(intrinsicsInput.height, `${path}.intrinsics.height`, 1, MAX_CAMERA_DIMENSION)
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail(`${path}.intrinsics`, 'width and height must be integers')
  const fx = finite(intrinsicsInput.fx, `${path}.intrinsics.fx`, MIN_FOCAL_LENGTH, MAX_CAMERA_DIMENSION * 4)
  const fy = finite(intrinsicsInput.fy, `${path}.intrinsics.fy`, MIN_FOCAL_LENGTH, MAX_CAMERA_DIMENSION * 4)
  const cx = finite(intrinsicsInput.cx, `${path}.intrinsics.cx`, 0, width)
  const cy = finite(intrinsicsInput.cy, `${path}.intrinsics.cy`, 0, height)
  let imageSha256: string | null = null
  if (value.imageSha256 !== null) {
    imageSha256 = string(value.imageSha256, `${path}.imageSha256`, 64)
    if (!/^[a-f0-9]{64}$/.test(imageSha256)) fail(`${path}.imageSha256`, 'must be a lowercase SHA-256 or null')
  }
  return {
    id, role: value.role,
    position: vector3(value.position, `${path}.position`),
    orientationXyzw: quaternion(value.orientationXyzw, `${path}.orientationXyzw`),
    intrinsics: { width, height, fx, fy, cx, cy }, imageSha256,
  }
}

function rejectRepeatedIds(cameras: VisualCamera[]): void {
  const ids = new Set<string>()
  for (const item of cameras) {
    if (ids.has(item.id)) fail('cameras', 'contains duplicate IDs')
    ids.add(item.id)
  }
}

/** Parse and validate a small, strict JSON visual manifest, returning fresh nested values. */
export function parseVisualManifest(text: string): VisualManifest {
  if (typeof text !== 'string') fail('manifest', 'must be UTF-8 text')
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength > VISUAL_LIMITS.manifestBytes) fail('manifest', `exceeds ${VISUAL_LIMITS.manifestBytes} bytes`)
  // TextEncoder replaces lone surrogates; round-trip equality makes that lossy conversion invalid.
  if (new TextDecoder('utf-8', { fatal: true }).decode(encoded) !== text) fail('manifest', 'must contain valid UTF-8 text')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return fail('manifest', 'is not valid JSON') }

  const value = object(parsed, '$')
  exactKeys(value, ['format', 'id', 'label', 'asset', 'assetFrame', 'worldFrame', 'registration', 'provenance', 'cameras'], '$')
  if (value.format !== VISUAL_MANIFEST_FORMAT) fail('format', 'has an unsupported version')
  const id = string(value.id, 'id', 80)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) fail('id', 'must be a safe identifier')
  const label = string(value.label, 'label', 160)

  const assetInput = object(value.asset, 'asset')
  exactKeys(assetInput, ['fileName', 'format', 'sha256', 'splatCount'], 'asset')
  const fileName = string(assetInput.fileName, 'asset.fileName', 255)
  if (fileName === '.' || fileName === '..' || /[/\\:]/.test(fileName) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)) {
    fail('asset.fileName', 'must be a simple basename without path characters')
  }
  if (assetInput.format !== 'splat32') fail('asset.format', 'must be splat32')
  const sha256 = string(assetInput.sha256, 'asset.sha256', 64)
  if (!/^[a-f0-9]{64}$/.test(sha256)) fail('asset.sha256', 'must be a lowercase SHA-256')
  const splatCount = finite(assetInput.splatCount, 'asset.splatCount', 1, VISUAL_LIMITS.splatCount)
  if (!Number.isInteger(splatCount)) fail('asset.splatCount', 'must be an integer')

  const frameInput = object(value.assetFrame, 'assetFrame')
  exactKeys(frameInput, ['handedness', 'up', 'cameraConvention'], 'assetFrame')
  if (frameInput.handedness !== 'right') fail('assetFrame.handedness', 'must be right')
  if (frameInput.up !== '+y' && frameInput.up !== '-y' && frameInput.up !== '+z' && frameInput.up !== '-z') fail('assetFrame.up', 'must be +y, -y, +z or -z')
  if (frameInput.cameraConvention !== 'opengl') fail('assetFrame.cameraConvention', 'must be opengl')

  const worldInput = object(value.worldFrame, 'worldFrame')
  exactKeys(worldInput, ['units', 'axes'], 'worldFrame')
  if (worldInput.units !== 'm') fail('worldFrame.units', 'must be m')
  if (worldInput.axes !== 'right-handed-z-up') fail('worldFrame.axes', 'must be right-handed-z-up')

  const registrationValue = registration(value.registration)
  const provenanceInput = object(value.provenance, 'provenance')
  exactKeys(provenanceInput, ['kind', 'creator', 'sourceUrl', 'license', 'method', 'version', 'notes'], 'provenance')
  if (!['synthetic', 'image-reconstruction', 'generated', 'mesh-conversion'].includes(String(provenanceInput.kind))) fail('provenance.kind', 'is unsupported')
  const licenseInput = object(provenanceInput.license, 'provenance.license')
  exactKeys(licenseInput, ['name', 'url'], 'provenance.license')
  const provenance = {
    kind: provenanceInput.kind as VisualManifest['provenance']['kind'],
    creator: string(provenanceInput.creator, 'provenance.creator', 160),
    sourceUrl: nullableHttpsUrl(provenanceInput.sourceUrl, 'provenance.sourceUrl'),
    license: { name: string(licenseInput.name, 'provenance.license.name', 160), url: nullableHttpsUrl(licenseInput.url, 'provenance.license.url') },
    method: string(provenanceInput.method, 'provenance.method', 320),
    version: string(provenanceInput.version, 'provenance.version', 80),
    notes: string(provenanceInput.notes, 'provenance.notes', MAX_METADATA_TEXT),
  }

  if (!Array.isArray(value.cameras) || value.cameras.length > VISUAL_LIMITS.cameras) fail('cameras', `must be an array with at most ${VISUAL_LIMITS.cameras} items`)
  const cameras = value.cameras.map((entry, index) => camera(entry, index))
  rejectRepeatedIds(cameras)

  // Validate that known registration can actually place every declared camera in the bounded world frame.
  if (registrationValue.status === 'known') {
    for (const item of cameras) {
      const scaled: Vector3 = item.position.map(component => component * registrationValue.scaleMPerUnit) as Vector3
      if (scaled.some(component => !Number.isFinite(component) || Math.abs(component) > VISUAL_LIMITS.coordinate)) {
        fail(`cameras[${cameras.indexOf(item)}].position`, 'transforms outside the bounded world coordinates')
      }
      const world = applyRigidTransform(scaled, { translationM: registrationValue.translationM, rotationXyzw: registrationValue.rotationXyzw })
      if (world.some(component => Math.abs(component) > VISUAL_LIMITS.coordinate)) fail(`cameras[${cameras.indexOf(item)}].position`, 'transforms outside the bounded world coordinates')
    }
  }

  return {
    format: VISUAL_MANIFEST_FORMAT, id, label,
    asset: { fileName, format: 'splat32', sha256, splatCount },
    assetFrame: { handedness: 'right', up: frameInput.up, cameraConvention: 'opengl' },
    worldFrame: { units: 'm', axes: 'right-handed-z-up' }, registration: registrationValue,
    provenance, cameras,
  }
}

/** Inspect the bounded standard 32-byte .splat record layout without retaining its contents. */
export function inspectSplatAsset(bytes: Uint8Array, expectedCount?: number): VisualAssetStats {
  if (!(bytes instanceof Uint8Array)) fail('asset', 'must be a byte array')
  if (bytes.byteLength === 0 || bytes.byteLength > VISUAL_LIMITS.assetBytes) fail('asset', `must contain 1–${VISUAL_LIMITS.assetBytes} bytes`)
  if (bytes.byteLength % 32 !== 0) fail('asset', 'length must be a multiple of 32 bytes')
  const splatCount = bytes.byteLength / 32
  if (splatCount > VISUAL_LIMITS.splatCount) fail('asset', `may contain at most ${VISUAL_LIMITS.splatCount} splats`)
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount !== splatCount)) fail('asset', 'splat count does not match the manifest')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const min: Vector3 = [Infinity, Infinity, Infinity]
  const max: Vector3 = [-Infinity, -Infinity, -Infinity]
  let visibleSplatCount = 0
  for (let index = 0; index < splatCount; index += 1) {
    const offset = index * 32
    const center: Vector3 = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)]
    const scales: Vector3 = [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true)]
    for (let axis = 0; axis < 3; axis += 1) {
      const c = center[axis]!
      const scale = scales[axis]!
      if (!Number.isFinite(c) || Math.abs(c) > VISUAL_LIMITS.coordinate) fail(`asset.splats[${index}].center`, 'contains a non-finite or out-of-bounds coordinate')
      if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_SPLAT_SCALE) fail(`asset.splats[${index}].scale`, 'must be finite, positive and bounded')
    }
    if (view.getUint8(offset + 27) > 0) visibleSplatCount += 1
    const qOffset = offset + 28
    // Standard .splat stores a four-byte wxyz quaternion encoded in [0,255] bytes.
    const q = [0, 1, 2, 3].map(component => (view.getUint8(qOffset + component) - 128) / 128)
    const qNorm = Math.hypot(...q)
    if (!Number.isFinite(qNorm) || qNorm === 0) fail(`asset.splats[${index}].rotation`, 'must have a non-zero finite quaternion')
    // Normalize the quantized wxyz quaternion, then project diagonal covariance
    // into each asset axis to get the rotated Gaussian's exact 3-sigma envelope.
    const [w, x, y, z] = q.map(component => component / qNorm)
    const rotation = [
      [1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!)],
      [2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!)],
      [2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)],
    ]
    for (let axis = 0; axis < 3; axis += 1) {
      const projectedSigma = Math.sqrt(
        rotation[axis]!.reduce((sum, component, sourceAxis) => sum + (component * scales[sourceAxis]!) ** 2, 0),
      )
      const envelope = 3 * projectedSigma
      const lower = center[axis]! - envelope
      const upper = center[axis]! + envelope
      if (!Number.isFinite(projectedSigma) || !Number.isFinite(lower) || !Number.isFinite(upper) || Math.abs(lower) > VISUAL_LIMITS.coordinate || Math.abs(upper) > VISUAL_LIMITS.coordinate) {
        fail(`asset.splats[${index}]`, 'rotated 3-sigma bounds exceed the coordinate limit')
      }
      min[axis] = Math.min(min[axis]!, lower)
      max[axis] = Math.max(max[axis]!, upper)
    }
  }

  return {
    splatCount, visibleSplatCount, sourceBytes: bytes.byteLength,
    localBounds: { min, max },
    decodedAttributeBytes: splatCount * (3 + 6) * 4 + splatCount * 4,
  }
}

/** Apply the explicitly known asset-to-world scale then rigid transform. */
export function visualPointToWorld(point: Vector3, registrationValue: VisualRegistration): Vector3 | null {
  if (registrationValue.status === 'unknown') return null
  const local = vector3(point, 'point')
  const scale = finite(registrationValue.scaleMPerUnit, 'registration.scaleMPerUnit', MIN_SCALE_M_PER_UNIT, MAX_SCALE_M_PER_UNIT)
  const scaled: Vector3 = local.map(value => value * scale) as Vector3
  if (scaled.some(value => !Number.isFinite(value) || Math.abs(value) > VISUAL_LIMITS.coordinate)) fail('point', 'scales outside the bounded world coordinates')
  const result = applyRigidTransform(scaled, {
    translationM: vector3(registrationValue.translationM, 'registration.translationM'),
    rotationXyzw: quaternion(registrationValue.rotationXyzw, 'registration.rotationXyzw'),
  })
  if (result.some(value => Math.abs(value) > VISUAL_LIMITS.coordinate)) fail('point', 'transforms outside the bounded world coordinates')
  return result
}
