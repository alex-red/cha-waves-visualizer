import type { Vector3 } from './spatial-registration.ts'
import type { StereoCamera, StereoResult } from './spatial-stereo-types.ts'

const MAX_WORLD_COORDINATE_M = 1_000_000
const MAX_DEPTH_M = 1_000_000
const MAX_SCALED_SPLAT = 10_000
const MAX_SPLAT_RECORDS = 262_144
const MAX_SPLAT_BYTES = 8 * 1024 * 1024

function fail(path: string, issue: string): never {
  throw new Error(`${path} ${issue}.`)
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function validateResult(result: StereoResult): number {
  if (!result || typeof result !== 'object') fail('result', 'must be an object')
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1) fail('result', 'must have positive integer dimensions')
  const pixels = result.width * result.height
  if (!Number.isSafeInteger(pixels)) fail('result', 'dimensions exceed safe bounds')
  if (!Array.isArray(result.points)) fail('result.points', 'must be an array')
  if (result.points.length > MAX_SPLAT_RECORDS || result.points.length * 32 > MAX_SPLAT_BYTES) fail('result.points', `may export at most ${MAX_SPLAT_RECORDS} splats`)
  const seen = new Set<number>()
  for (let index = 0; index < result.points.length; index += 1) {
    if (!Object.hasOwn(result.points, index)) fail(`result.points[${index}]`, 'is missing')
    const point = result.points[index]!
    const path = `result.points[${index}]`
    if (!point || typeof point !== 'object') fail(path, 'must be an object')
    if (!Number.isInteger(point.pixelIndex) || point.pixelIndex < 0 || point.pixelIndex >= pixels) fail(`${path}.pixelIndex`, 'is outside the reference image')
    if (seen.has(point.pixelIndex)) fail(`${path}.pixelIndex`, 'duplicates another point')
    seen.add(point.pixelIndex)
    if (!Array.isArray(point.positionM) || point.positionM.length !== 3) fail(`${path}.positionM`, 'must contain three finite coordinates')
    for (let axis = 0; axis < 3; axis += 1) finite(point.positionM[axis], `${path}.positionM[${axis}]`, -MAX_WORLD_COORDINATE_M, MAX_WORLD_COORDINATE_M)
    if (!Array.isArray(point.color) || point.color.length !== 3) fail(`${path}.color`, 'must contain three RGB bytes')
    for (let axis = 0; axis < 3; axis += 1) {
      const channel = point.color[axis]
      if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255) fail(`${path}.color[${axis}]`, 'must be an integer byte')
    }
  }
  return pixels
}

function validateCamera(camera: StereoCamera, result: StereoResult): void {
  if (!camera || typeof camera !== 'object' || !camera.intrinsics) fail('referenceCamera', 'must be a camera object')
  if (camera.intrinsics.width !== result.width || camera.intrinsics.height !== result.height) fail('referenceCamera', 'dimensions must match the reconstruction')
  if (!Array.isArray(camera.positionM) || camera.positionM.length !== 3) fail('referenceCamera.positionM', 'must contain three finite coordinates')
  camera.positionM.forEach((coordinate, axis) => finite(coordinate, `referenceCamera.positionM[${axis}]`, -MAX_WORLD_COORDINATE_M, MAX_WORLD_COORDINATE_M))
  finite(camera.intrinsics.fx, 'referenceCamera.intrinsics.fx', 1e-3, 1e6)
  finite(camera.intrinsics.fy, 'referenceCamera.intrinsics.fy', 1e-3, 1e6)
}

/** Export reconstructed world-coordinate points as a deterministic ASCII PLY point cloud. */
export function encodeStereoPly(result: StereoResult): string {
  validateResult(result)
  const header = [
    'ply', 'format ascii 1.0', 'comment Stereo-derived points in metres from supplied calibration',
    `element vertex ${result.points.length}`,
    'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue', 'end_header',
  ]
  const rows = result.points.map(point => {
    const coordinates = point.positionM.map((value, axis) => {
      const bounded = finite(value, `result.points[${point.pixelIndex}].positionM[${axis}]`, -MAX_WORLD_COORDINATE_M, MAX_WORLD_COORDINATE_M)
      return Object.is(bounded, -0) ? '0' : String(bounded)
    })
    return [...coordinates, ...point.color].join(' ')
  })
  return `${header.join('\n')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`
}

/** Export metric-frame centers, with tangent-size heuristics derived from the reference camera. */
export function encodeStereoSplats(result: StereoResult, referenceCamera: StereoCamera): Uint8Array<ArrayBuffer> {
  validateResult(result)
  validateCamera(referenceCamera, result)
  if (result.points.length === 0) fail('result.points', 'must contain at least one point to export as a splat asset')
  const bytes = new Uint8Array(result.points.length * 32)
  const view = new DataView(bytes.buffer)
  const { fx, fy } = referenceCamera.intrinsics
  for (let index = 0; index < result.points.length; index += 1) {
    const point = result.points[index]!
    const depth = referenceCamera.positionM[2] - point.positionM[2]
    finite(depth, `result.points[${index}].depth`, Number.MIN_VALUE, MAX_DEPTH_M)
    const centers: Vector3 = point.positionM
    const scales: Vector3 = [0.6 * depth / fx, 0.6 * depth / fy, 0.003]
    for (let axis = 0; axis < 3; axis += 1) {
      finite(centers[axis], `result.points[${index}].center[${axis}]`, -MAX_WORLD_COORDINATE_M, MAX_WORLD_COORDINATE_M)
      finite(scales[axis], `result.points[${index}].scale[${axis}]`, Number.MIN_VALUE, MAX_SCALED_SPLAT)
    }
    const offset = index * 32
    centers.forEach((value, axis) => view.setFloat32(offset + axis * 4, value, true))
    scales.forEach((value, axis) => view.setFloat32(offset + 12 + axis * 4, value, true))
    bytes[offset + 24] = point.color[0]
    bytes[offset + 25] = point.color[1]
    bytes[offset + 26] = point.color[2]
    bytes[offset + 27] = 255
    // Quantized standard .splat quaternion encoding is WXYZ identity: [1,0,0,0].
    bytes[offset + 28] = 255
    bytes[offset + 29] = 128
    bytes[offset + 30] = 128
    bytes[offset + 31] = 128
  }
  return bytes
}
