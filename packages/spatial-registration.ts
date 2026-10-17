export type Vector3 = [number, number, number]
export type Quaternion = [number, number, number, number]
export type RigidTransform = { translationM: Vector3; rotationXyzw: Quaternion }

const UNIT_TOLERANCE = 1e-6

function finiteVector(value: unknown, label: string): asserts value is Vector3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new RangeError(`${label} must contain three finite numbers.`)
  }
}

function finiteQuaternion(value: unknown, label: string): asserts value is Quaternion {
  if (!Array.isArray(value) || value.length !== 4 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new RangeError(`${label} must contain four finite numbers.`)
  }
  const norm = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!)
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > UNIT_TOLERANCE) {
    throw new RangeError(`${label} must be a unit quaternion.`)
  }
}

function validateTransform(transform: RigidTransform): Quaternion {
  if (!transform || typeof transform !== 'object') throw new RangeError('transform must be an object.')
  finiteVector(transform.translationM, 'transform.translationM')
  finiteQuaternion(transform.rotationXyzw, 'transform.rotationXyzw')
  const q = transform.rotationXyzw
  const norm = Math.hypot(q[0], q[1], q[2], q[3])
  // Inputs within the contract tolerance represent a rotation; use an exact unit
  // copy for the rigid math while preserving the caller's original tuple.
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm]
}

function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  const [x1, y1, z1, w1] = a, [x2, y2, z2, w2] = b
  return [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ]
}

function normalizeComputedQuaternion(q: Quaternion): Quaternion {
  const norm = Math.hypot(...q)
  if (!Number.isFinite(norm) || norm === 0) throw new RangeError('Transform composition produced an invalid rotation.')
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm]
}

function rotateVector(point: Vector3, q: Quaternion): Vector3 {
  // q * [point, 0] * conjugate(q), expanded to avoid temporary quaternion allocations.
  const [x, y, z, w] = q
  const tx = 2 * (y * point[2] - z * point[1])
  const ty = 2 * (z * point[0] - x * point[2])
  const tz = 2 * (x * point[1] - y * point[0])
  return [
    point[0] + w * tx + y * tz - z * ty,
    point[1] + w * ty + z * tx - x * tz,
    point[2] + w * tz + x * ty - y * tx,
  ]
}

function ensureFiniteResult(vector: Vector3): Vector3 {
  if (vector.some(value => !Number.isFinite(value))) throw new RangeError('Transform produced non-finite coordinates.')
  return vector
}

export function applyRigidTransform(point: Vector3, transform: RigidTransform): Vector3 {
  finiteVector(point, 'point')
  const rotation = validateTransform(transform)
  const rotated = rotateVector(point, rotation)
  return ensureFiniteResult([
    rotated[0] + transform.translationM[0],
    rotated[1] + transform.translationM[1],
    rotated[2] + transform.translationM[2],
  ])
}

export function invertRigidTransform(transform: RigidTransform): RigidTransform {
  const [x, y, z, w] = validateTransform(transform)
  const rotationXyzw: Quaternion = [-x, -y, -z, w]
  const rotatedTranslation = rotateVector(transform.translationM, rotationXyzw)
  return {
    translationM: ensureFiniteResult(rotatedTranslation.map(value => -value) as Vector3),
    rotationXyzw,
  }
}

export function composeRigidTransforms(outer: RigidTransform, inner: RigidTransform): RigidTransform {
  const outerRotation = validateTransform(outer)
  const innerRotation = validateTransform(inner)
  const rotationXyzw = normalizeComputedQuaternion(multiplyQuaternion(outerRotation, innerRotation))
  const translatedInner = rotateVector(inner.translationM, outerRotation)
  const translationM = ensureFiniteResult([
    translatedInner[0] + outer.translationM[0],
    translatedInner[1] + outer.translationM[1],
    translatedInner[2] + outer.translationM[2],
  ])
  return { translationM, rotationXyzw }
}
