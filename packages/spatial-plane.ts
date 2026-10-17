import type { Vector3 } from './spatial-registration.ts'

const SPEED_OF_SOUND_MPS = 343
const MAX_COORDINATE_M = 1_000_000
const MAX_OBSERVATIONS = 48
const MAX_CANDIDATES = 16
const MAX_DELAY_MS = 1_000_000
const DEFAULT_MAX_RESIDUAL_MS = 0.05
const UNIT_TOLERANCE = 1e-6
const MIN_PLANE_DISTANCE_M = 1e-8
const MIN_RELATIVE_QR_DIAGONAL = 1e-8

export type SpatialPlane = { normal: Vector3; offsetM: number }

export type PlaneObservation = {
  id: string
  speakerPositionM: Vector3
  microphonePositionM: Vector3
  arrivalCandidatesMs: number[]
}

export type PlaneOutcome = { id: string; status: 'eligible' | 'missing' | 'ambiguous' }

export type PlaneFitResult = {
  status: 'ok' | 'invalid-data' | 'insufficient-data' | 'unsupported-source-motion' | 'no-solution'
  message: string
  outcomes: PlaneOutcome[]
  eligibleCount: number
  plane?: SpatialPlane
  imageSourceM?: Vector3
  rmsResidualMs?: number
  maxResidualMs?: number
}

type FitOptions = { maxResidualMs?: number }
type NormalizedObservation = { id: string; speaker: Vector3; microphone: Vector3; candidates: number[] }

function finiteNumber(value: unknown, label: string, min = -MAX_COORDINATE_M, max = MAX_COORDINATE_M): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be finite and within its allowed range.`)
  return value
}

function vector(value: unknown, label: string): Vector3 {
  if (!Array.isArray(value) || value.length !== 3) throw new RangeError(`${label} must contain three coordinates.`)
  return [
    finiteNumber(value[0], `${label}[0]`),
    finiteNumber(value[1], `${label}[1]`),
    finiteNumber(value[2], `${label}[2]`),
  ]
}

function dot(a: Vector3, b: Vector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function subtract(a: Vector3, b: Vector3): Vector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function add(a: Vector3, b: Vector3): Vector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function scale(a: Vector3, amount: number): Vector3 { return [a[0] * amount, a[1] * amount, a[2] * amount] }
function norm(a: Vector3): number { return Math.hypot(a[0], a[1], a[2]) }
function distance(a: Vector3, b: Vector3): number { return norm(subtract(a, b)) }

function failResult(
  status: PlaneFitResult['status'], message: string, outcomes: PlaneOutcome[], eligibleCount: number,
  residuals?: { rmsResidualMs: number; maxResidualMs: number },
): PlaneFitResult {
  return { status, message, outcomes, eligibleCount, ...(residuals ?? {}) }
}

function validatePlane(input: SpatialPlane): SpatialPlane {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('plane must be an object.')
  const normal = vector(input.normal, 'plane.normal')
  const offsetM = finiteNumber(input.offsetM, 'plane.offsetM')
  const length = norm(normal)
  if (Math.abs(length - 1) > UNIT_TOLERANCE) throw new RangeError('plane.normal must have unit norm within 1e-6.')
  return { normal: scale(normal, 1 / length), offsetM: offsetM / length }
}

/** Predict the reflected-minus-direct path delay for one infinite plane in metres. */
export function predictPlaneDelayMs(planeInput: SpatialPlane, speakerInput: Vector3, microphoneInput: Vector3): number {
  const plane = validatePlane(planeInput)
  const speaker = vector(speakerInput, 'speakerPositionM')
  const microphone = vector(microphoneInput, 'microphonePositionM')
  const speakerSide = dot(plane.normal, speaker) - plane.offsetM
  const microphoneSide = dot(plane.normal, microphone) - plane.offsetM
  if (Math.abs(speakerSide) <= MIN_PLANE_DISTANCE_M) throw new RangeError('Speaker on the plane is a degenerate reflection configuration.')
  if (Math.abs(microphoneSide) <= MIN_PLANE_DISTANCE_M || speakerSide * microphoneSide <= 0) {
    throw new RangeError('Speaker and microphone must lie on the same side of the plane.')
  }
  const imageSource = add(speaker, scale(plane.normal, -2 * speakerSide))
  const reflectedDistance = distance(imageSource, microphone)
  const directDistance = distance(speaker, microphone)
  const difference = reflectedDistance - directDistance
  if (!Number.isFinite(difference) || difference < -1e-8) throw new RangeError('Plane geometry produced an invalid reflected path.')
  return Math.max(0, difference) * 1000 / SPEED_OF_SOUND_MPS
}

function parseObservations(input: readonly PlaneObservation[]): { observations: NormalizedObservation[]; outcomes: PlaneOutcome[] } {
  if (!Array.isArray(input)) throw new RangeError('observations must be an array.')
  if (input.length > MAX_OBSERVATIONS) throw new RangeError(`observations may contain at most ${MAX_OBSERVATIONS} items.`)
  const ids = new Set<string>()
  const observations: NormalizedObservation[] = []
  const outcomes: PlaneOutcome[] = []
  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RangeError(`observations[${index}] must be an object.`)
    const value = raw as PlaneObservation
    if (Object.keys(value).some(key => !['id', 'speakerPositionM', 'microphonePositionM', 'arrivalCandidatesMs'].includes(key))) {
      throw new RangeError(`observations[${index}] contains an unsupported field.`)
    }
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.id)) {
      throw new RangeError(`observations[${index}].id must be a valid 1–80 character ASCII identifier.`)
    }
    if (ids.has(value.id)) throw new RangeError(`observations[${index}].id is duplicated.`)
    ids.add(value.id)
    const speaker = vector(value.speakerPositionM, `observations[${index}].speakerPositionM`)
    const microphone = vector(value.microphonePositionM, `observations[${index}].microphonePositionM`)
    if (!Array.isArray(value.arrivalCandidatesMs) || value.arrivalCandidatesMs.length > MAX_CANDIDATES) {
      throw new RangeError(`observations[${index}].arrivalCandidatesMs must be an array of at most ${MAX_CANDIDATES} candidates.`)
    }
    const candidates = Array.from(value.arrivalCandidatesMs, (candidate, candidateIndex) =>
      finiteNumber(candidate, `observations[${index}].arrivalCandidatesMs[${candidateIndex}]`, Number.MIN_VALUE, MAX_DELAY_MS))
    observations.push({ id: value.id, speaker, microphone, candidates })
    outcomes.push({ id: value.id, status: candidates.length === 0 ? 'missing' : candidates.length === 1 ? 'eligible' : 'ambiguous' })
  }
  return { observations, outcomes }
}

/** Solve the fixed-source, one-infinite-plane reference from uniquely supplied candidates. */
export function fitSinglePlane(input: readonly PlaneObservation[], options: FitOptions = {}): PlaneFitResult {
  let parsed: ReturnType<typeof parseObservations>
  let maxResidualMs: number
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'maxResidualMs')) {
      throw new RangeError('options must contain only maxResidualMs.')
    }
    maxResidualMs = finiteNumber(options.maxResidualMs === undefined ? DEFAULT_MAX_RESIDUAL_MS : options.maxResidualMs, 'maxResidualMs', 0, 10)
    parsed = parseObservations(input)
  } catch (error) {
    return failResult('invalid-data', error instanceof Error ? error.message : 'Input data is invalid.', [], 0)
  }

  const { observations, outcomes } = parsed
  const eligible = observations.filter(item => item.candidates.length === 1)
  if (observations.length > 0) {
    const referenceSpeaker = observations[0]!.speaker
    if (observations.some(item => distance(item.speaker, referenceSpeaker) > 1e-8)) {
      return failResult('unsupported-source-motion', 'Speaker positions vary; this solver requires one fixed source.', outcomes, eligible.length)
    }
  }
  if (eligible.length < 4) return failResult('insufficient-data', 'At least four uniquely eligible microphone positions are required.', outcomes, eligible.length)

  const speaker = eligible[0]!.speaker
  const localMicrophones = eligible.map(item => subtract(item.microphone, speaker))
  const reflectedRanges = eligible.map(item => distance(item.speaker, item.microphone) + item.candidates[0]! * SPEED_OF_SOUND_MPS / 1000)
  const base = localMicrophones[0]!
  const baseRange = reflectedRanges[0]!
  const rows: number[][] = []
  const rhs: number[] = []
  for (let index = 1; index < eligible.length; index += 1) {
    const position = localMicrophones[index]!
    const delta = subtract(position, base)
    rows.push(scale(delta, 2))
    rhs.push(dot(position, position) - dot(base, base) - reflectedRanges[index]! ** 2 + baseRange ** 2)
  }

  const solved = solveCenteredLeastSquares(rows, rhs)
  if (!solved) return failResult('insufficient-data', 'Microphone positions lack well-conditioned three-dimensional diversity.', outcomes, eligible.length)
  const imageSource = add(speaker, solved)
  const separation = distance(speaker, imageSource)
  if (!Number.isFinite(separation) || separation <= 2 * MIN_PLANE_DISTANCE_M) {
    return failResult('no-solution', 'The fitted image source is degenerate with the speaker.', outcomes, eligible.length)
  }
  const normal = scale(subtract(speaker, imageSource), 1 / separation)
  const midpoint = add(speaker, scale(subtract(imageSource, speaker), 0.5))
  const offsetM = dot(normal, midpoint)
  if (!Number.isFinite(offsetM) || Math.abs(offsetM) > MAX_COORDINATE_M) {
    return failResult('no-solution', 'The fitted plane offset is outside the supported coordinate range.', outcomes, eligible.length)
  }
  const plane: SpatialPlane = { normal, offsetM }
  const planeDistance = dot(normal, speaker) - offsetM
  if (planeDistance <= MIN_PLANE_DISTANCE_M) return failResult('no-solution', 'The fitted plane has an invalid source-side orientation.', outcomes, eligible.length)

  const residuals: number[] = []
  try {
    for (const item of eligible) {
      const side = dot(normal, item.microphone) - offsetM
      if (side <= MIN_PLANE_DISTANCE_M) return failResult('no-solution', 'A microphone lies on the opposite side of the fitted plane.', outcomes, eligible.length)
      residuals.push(predictPlaneDelayMs(plane, item.speaker, item.microphone) - item.candidates[0]!)
    }
  } catch {
    return failResult('no-solution', 'The fitted plane does not support valid same-side reflections.', outcomes, eligible.length)
  }
  const rmsResidualMs = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length)
  const maxObservedResidualMs = Math.max(...residuals.map(Math.abs))
  const residualSummary = { rmsResidualMs, maxResidualMs: maxObservedResidualMs }
  if (maxObservedResidualMs > maxResidualMs) {
    return failResult('no-solution', `Fit residual exceeds the ${maxResidualMs} ms limit.`, outcomes, eligible.length, residualSummary)
  }
  const fittedImageSource = add(speaker, scale(normal, -2 * planeDistance))
  return {
    status: 'ok', message: 'Single-plane fit passed the configured synthetic residual screen.', outcomes, eligibleCount: eligible.length,
    plane, imageSourceM: fittedImageSource, rmsResidualMs, maxResidualMs: maxObservedResidualMs,
  }
}

/** Column-scaled, column-pivoted Householder QR; null means rank deficient or ill-conditioned. */
function solveCenteredLeastSquares(rows: readonly number[][], rhs: readonly number[]): Vector3 | null {
  if (rows.length !== rhs.length || rows.length < 3) return null
  // Apply one common scale only. Per-column scaling would make a 1e-12 m
  // physical lever arm look as informative as a 1 m lever arm and hide poor
  // spatial conditioning from the rank test below.
  let matrixScale = 0
  for (const row of rows) for (const value of row) matrixScale = Math.max(matrixScale, Math.abs(value))
  if (!Number.isFinite(matrixScale) || matrixScale === 0) return null
  const matrix = rows.map(row => row.map(value => value / matrixScale))
  const transformed = rhs.map(value => value / matrixScale)
  const permutation = [0, 1, 2]
  const diagonal: number[] = []

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let bestColumn = pivot
    let bestNorm = -1
    for (let column = pivot; column < 3; column += 1) {
      let columnNorm = 0
      for (let row = pivot; row < matrix.length; row += 1) columnNorm = Math.hypot(columnNorm, matrix[row]![column]!)
      if (columnNorm > bestNorm) { bestNorm = columnNorm; bestColumn = column }
    }
    if (bestColumn !== pivot) {
      for (const row of matrix) [row[pivot], row[bestColumn]] = [row[bestColumn]!, row[pivot]!]
      ;[permutation[pivot], permutation[bestColumn]] = [permutation[bestColumn]!, permutation[pivot]!]
    }
    let length = 0
    for (let row = pivot; row < matrix.length; row += 1) length = Math.hypot(length, matrix[row]![pivot]!)
    if (!Number.isFinite(length) || length === 0) return null
    const first = matrix[pivot]![pivot]!
    const alpha = first >= 0 ? -length : length
    const reflector: number[] = []
    for (let row = pivot; row < matrix.length; row += 1) reflector.push(matrix[row]![pivot]!)
    reflector[0] = reflector[0]! - alpha
    let reflectorSquaredNorm = 0
    for (const value of reflector) reflectorSquaredNorm += value * value
    if (!Number.isFinite(reflectorSquaredNorm) || reflectorSquaredNorm === 0) return null
    const beta = 2 / reflectorSquaredNorm
    for (let column = pivot; column < 3; column += 1) {
      let projection = 0
      for (let row = pivot; row < matrix.length; row += 1) projection += reflector[row - pivot]! * matrix[row]![column]!
      projection *= beta
      for (let row = pivot; row < matrix.length; row += 1) matrix[row]![column] = matrix[row]![column]! - projection * reflector[row - pivot]!
    }
    let rhsProjection = 0
    for (let row = pivot; row < matrix.length; row += 1) rhsProjection += reflector[row - pivot]! * transformed[row]!
    rhsProjection *= beta
    for (let row = pivot; row < matrix.length; row += 1) transformed[row] = transformed[row]! - rhsProjection * reflector[row - pivot]!
    diagonal.push(Math.abs(matrix[pivot]![pivot]!))
  }

  const maxDiagonal = Math.max(...diagonal)
  if (!Number.isFinite(maxDiagonal) || diagonal.some(value => value / maxDiagonal < MIN_RELATIVE_QR_DIAGONAL)) return null
  const pivotedSolution: Vector3 = [0, 0, 0]
  for (let row = 2; row >= 0; row -= 1) {
    let value = transformed[row]!
    for (let column = row + 1; column < 3; column += 1) value -= matrix[row]![column]! * pivotedSolution[column]!
    pivotedSolution[row] = value / matrix[row]![row]!
  }
  const solution: Vector3 = [0, 0, 0]
  for (let column = 0; column < 3; column += 1) solution[permutation[column]!] = pivotedSolution[column]!
  return solution.every(Number.isFinite) ? solution : null
}
