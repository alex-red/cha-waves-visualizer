/** Numerical utilities for a first-order, axis-aligned rectangular-room echo lab.
 * Arrival times in EchoCapture are delays after the direct sound, in milliseconds.
 */

export const ECHO_SPEED_OF_SOUND_MPS = 343

export interface EchoRoom {
  widthM: number
  depthM: number
  /** West and south wall coordinates; omitted means the origin (0, 0). */
  originXM?: number
  originYM?: number
}

export interface EchoPosition {
  xM: number
  yM: number
}

export type EchoWall = 'west' | 'east' | 'south' | 'north'

/** Unlabeled first-order arrivals, synchronized to the direct arrival. */
export interface EchoCapture {
  position: EchoPosition
  arrivalTimesMs: number[]
}

export interface SimulateEchoOptions {
  seed?: number
  /** Standard deviation of independent Gaussian timing noise. Defaults to 0. */
  timingNoiseStdMs?: number
}

export interface ReconstructEchoOptions {
  minDimensionM?: number
  maxDimensionM?: number
}

export interface EchoReconstruction {
  status: 'ok' | 'insufficient-data' | 'invalid-data' | 'no-solution'
  room?: EchoRoom
  quality?: 'high' | 'medium' | 'low'
  rmsResidualMs?: number
  maxResidualMs?: number
  ambiguity?: boolean
  captureCount: number
  echoCount: number
  message?: string
}

/** Generate wall-echo delays without exposing wall labels to the inverse solver. */
export function simulateEchoCaptures(room: EchoRoom, positions: readonly EchoPosition[], options: SimulateEchoOptions = {}): EchoCapture[] {
  if (!validRoom(room) || positions.length === 0 || positions.some(p => !validPosition(p, room))) throw new RangeError('Room and positions must be finite, positive, and inside the room')
  const noise = options.timingNoiseStdMs ?? 0
  if (!Number.isFinite(noise) || noise < 0) throw new RangeError('timingNoiseStdMs must be finite and nonnegative')
  const random = seededRandom(options.seed ?? 1)
  return positions.map(position => {
    const west = room.originXM ?? 0, south = room.originYM ?? 0
    const distances = [position.xM - west, west + room.widthM - position.xM, position.yM - south, south + room.depthM - position.yM]
    const arrivalTimesMs = distances.map(distance => 2000 * distance / ECHO_SPEED_OF_SOUND_MPS + gaussian(random) * noise)
      .filter(time => time > 0)
      .sort((a, b) => a - b)
    return { position: { ...position }, arrivalTimesMs }
  })
}

/** Fit four axis-aligned wall distances from unlabeled first-order arrivals at several poses. */
export function reconstructEchoRoom(captures: readonly EchoCapture[], options: ReconstructEchoOptions = {}): EchoReconstruction {
  const echoCount = captures.reduce((sum, capture) => sum + (Array.isArray(capture?.arrivalTimesMs) ? capture.arrivalTimesMs.length : 0), 0)
  const base = { captureCount: captures.length, echoCount }
  if (captures.length > 12) return { ...base, status: 'invalid-data', message: 'A fit is limited to 12 captures.' }
  if (captures.length < 3) return { ...base, status: 'insufficient-data', message: 'Use at least three captures at distinct, non-collinear positions.' }
  const minDimension = options.minDimensionM ?? 2
  const maxDimension = options.maxDimensionM ?? 30
  if (!Number.isFinite(minDimension) || !Number.isFinite(maxDimension) || minDimension <= 0 || maxDimension <= minDimension) return { ...base, status: 'invalid-data', message: 'Room dimension bounds must be finite, positive, and increasing.' }
  for (const capture of captures) {
    if (!capture || !capture.position || !Number.isFinite(capture.position.xM) || !Number.isFinite(capture.position.yM) ||
      !Array.isArray(capture.arrivalTimesMs) || capture.arrivalTimesMs.some(t => !Number.isFinite(t) || t <= 0)) {
      return { ...base, status: 'invalid-data', message: 'Captures need finite positions and positive finite arrival delays.' }
    }
    if (capture.arrivalTimesMs.length !== 4) return { ...base, status: 'invalid-data', message: 'A fit needs exactly four first-order arrivals per capture; remove extra peaks or review missed echoes.' }
  }

  if (!hasThreeNonCollinearPositions(captures)) return { ...base, status: 'insufficient-data', message: 'Move the speaker to at least three distinct, non-collinear positions.' }

  const measured = captures.map(c => ({
    x: c.position.xM,
    y: c.position.yM,
    distances: c.arrivalTimesMs.map(t => t * ECHO_SPEED_OF_SOUND_MPS / 2000),
  }))
  const fits: Fit[] = []
  // Every permutation at every capture is a seed; assignment then becomes a small
  // alternating least-squares problem with one distinct arrival for each wall.
  for (const capture of measured) for (const assignment of permutations) {
    const initial = wallsFromAssignment(capture, assignment)
    if (isValidWalls(initial, minDimension, maxDimension) && enclosesPositions(initial, measured)) fits.push(refineFit(measured, initial, minDimension, maxDimension))
  }
  fits.sort((a, b) => a.score - b.score)
  const best = fits.find(fit => Number.isFinite(fit.score))
  const second = best && fits.find(fit => differentWalls(fit.walls, best.walls))
  if (!best || best.residuals.length !== echoCount) return { ...base, status: 'no-solution', message: 'The arrivals did not support a stable four-wall fit.' }
  const rmsDistanceM = Math.sqrt(best.score)
  const rmsResidualMs = rmsDistanceM * 2000 / ECHO_SPEED_OF_SOUND_MPS
  const maxResidualMs = Math.max(...best.residuals) * 2000 / ECHO_SPEED_OF_SOUND_MPS
  const ambiguity = !!second && second.score <= best.score + Math.max(0.0004, best.score * 0.15)
  if (rmsDistanceM > 0.5) return { ...base, status: 'no-solution', rmsResidualMs, maxResidualMs, ambiguity: true, message: 'Arrival times are inconsistent with one rectangular room; review the selected peaks.' }
  const [west, east, south, north] = best.walls
  return {
    ...base, status: 'ok', room: { widthM: east - west, depthM: north - south, originXM: west, originYM: south }, quality: rmsResidualMs < 0.15 && !ambiguity ? 'high' : rmsResidualMs < 0.8 ? 'medium' : 'low',
    rmsResidualMs, maxResidualMs, ambiguity,
  }
}

/** Create the deterministic logarithmic sweep used by the matched-filter recorder. */
export function generateChirp(sampleRate: number, durationMs = 80): Float32Array {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(durationMs) || durationMs < 10 || durationMs > 500) {
    throw new RangeError('Use a sample rate from 8–192 kHz and a chirp duration from 10–500 ms.')
  }
  const count = Math.round(sampleRate * durationMs / 1000)
  const result = new Float32Array(count)
  const startHz = 350, endHz = Math.min(9000, sampleRate * 0.42)
  const logarithm = Math.log(endHz / startHz), durationSeconds = count / sampleRate
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate
    const phase = 2 * Math.PI * startHz * durationSeconds / logarithm * (Math.exp(logarithm * t / durationSeconds) - 1)
    const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, count - 1))
    result[i] = Math.sin(phase) * envelope
  }
  return result
}

export interface ExtractEchoPeaksOptions {
  chirpDurationMs?: number
  maxPeaks?: number
  /** Correlation amplitude as a fraction of the strongest peak. Defaults to 0.2. */
  thresholdRatio?: number
  /** Subtract the first accepted peak time from every returned peak. Defaults to true. */
  relativeToFirstPeak?: boolean
  /** Minimum spacing between accepted peaks. Defaults to 8 ms. */
  minimumSpacingMs?: number
}

export interface EchoPeak {
  delayMs: number
  strength: number
}

/** Match recorded PCM against the emitted chirp and report separated arrival peaks. */
export function extractEchoPeaks(samples: ArrayLike<number>, sampleRate: number, options: ExtractEchoPeaksOptions = {}): EchoPeak[] {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || samples.length === 0 || samples.length > sampleRate * 2 ||
    Array.from(samples).some(sample => !Number.isFinite(sample))) throw new RangeError('Samples must be finite, sampled at 8–96 kHz, and no longer than two seconds.')
  const chirp = generateChirp(sampleRate, options.chirpDurationMs ?? 80)
  if (samples.length < chirp.length) return []
  const maxPeaks = options.maxPeaks ?? 12, thresholdRatio = options.thresholdRatio ?? 0.2, spacingMs = options.minimumSpacingMs ?? 8
  if (!Number.isSafeInteger(maxPeaks) || maxPeaks < 1 || maxPeaks > 32 || !Number.isFinite(thresholdRatio) || thresholdRatio <= 0 || thresholdRatio > 1 || !Number.isFinite(spacingMs) || spacingMs < 1) {
    throw new RangeError('Peak limits, threshold, and spacing are outside supported bounds.')
  }
  const positions = samples.length - chirp.length + 1
  let energy = 0
  for (const sample of chirp) energy += sample * sample
  const correlations = matchedCorrelation(samples, chirp, energy)
  let strongest = 0
  for (const correlation of correlations) if (correlation > strongest) strongest = correlation
  if (strongest <= 1e-7) return []
  const threshold = strongest * thresholdRatio, minimumSpacing = Math.max(1, Math.round(sampleRate * spacingMs / 1000))
  const found: { offset: number; strength: number }[] = []
  for (let i = 1; i < correlations.length - 1; i++) {
    const value = correlations[i]!
    if (value < threshold || value < correlations[i - 1]! || value <= correlations[i + 1]!) continue
    found.push({ offset: i, strength: value })
  }
  found.sort((a, b) => b.strength - a.strength)
  const selected: typeof found = []
  for (const peak of found) {
    if (selected.every(other => Math.abs(other.offset - peak.offset) >= minimumSpacing)) selected.push(peak)
    if (selected.length >= maxPeaks) break
  }
  selected.sort((a, b) => a.offset - b.offset)
  const origin = options.relativeToFirstPeak === false ? 0 : selected[0]?.offset ?? 0
  return selected.map(peak => ({ delayMs: (peak.offset - origin) * 1000 / sampleRate, strength: peak.strength }))
}

interface Fit { walls: [number, number, number, number]; score: number; residuals: number[] }
interface CaptureDistances { x: number; y: number; distances: number[] }

const permutations: number[][] = []
function permute(values: number[], index = 0): void {
  if (index === values.length) { permutations.push([...values]); return }
  for (let i = index; i < values.length; i++) { [values[index], values[i]] = [values[i]!, values[index]!]; permute(values, index + 1); [values[index], values[i]] = [values[i]!, values[index]!] }
}
permute([0, 1, 2, 3])

function wallsFromAssignment(capture: CaptureDistances, assignment: number[]): [number, number, number, number] {
  const wallPositions = [0, 0, 0, 0]
  for (let wall = 0; wall < 4; wall++) {
    const distance = capture.distances[assignment[wall]!]!
    wallPositions[wall] = wall === 0 ? capture.x - distance : wall === 1 ? capture.x + distance : wall === 2 ? capture.y - distance : capture.y + distance
  }
  return wallPositions as [number, number, number, number]
}

function refineFit(data: CaptureDistances[], seed: [number, number, number, number], min: number, max: number): Fit {
  let walls = seed, assignments: number[][] = []
  for (let iteration = 0; iteration < 12; iteration++) {
    assignments = data.map(capture => {
      let best = permutations[0]!, bestError = Infinity
      for (const permutation of permutations) {
        const candidate = wallsFromAssignment(capture, permutation)
        const error = candidate.reduce((sum, value, i) => sum + (value - walls[i]!) ** 2, 0)
        if (error < bestError) { best = permutation; bestError = error }
      }
      return best
    })
    const accum = [0, 0, 0, 0], counts = [0, 0, 0, 0]
    for (let i = 0; i < data.length; i++) {
      const capture = data[i]!, assignment = assignments[i]!
      const candidate = wallsFromAssignment(capture, assignment)
      for (let wall = 0; wall < 4; wall++) { accum[wall] = accum[wall]! + candidate[wall]!; counts[wall] = counts[wall]! + 1 }
    }
    const updated = accum.map((value, i) => value / counts[i]!) as [number, number, number, number]
    if (!isValidWalls(updated, min, max) || !enclosesPositions(updated, data)) return { walls: updated, score: Infinity, residuals: [] }
    const movement = updated.reduce((sum, value, i) => sum + Math.abs(value - walls[i]!), 0)
    walls = updated
    if (movement < 1e-7) break
  }
  assignments = data.map(capture => bestAssignment(capture, walls))
  const residuals = data.flatMap((capture, index) => assignments[index]!.map((arrivalIndex, wall) => Math.abs(wallsFromAssignment(capture, assignments[index]!)[wall]! - walls[wall]!)))
  return { walls, score: residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length, residuals }
}

function bestAssignment(capture: CaptureDistances, walls: number[]): number[] {
  let best = permutations[0]!, bestError = Infinity
  for (const permutation of permutations) {
    const candidate = wallsFromAssignment(capture, permutation)
    const error = candidate.reduce((sum, value, i) => sum + (value - walls[i]!) ** 2, 0)
    if (error < bestError) { best = permutation; bestError = error }
  }
  return best
}
function isValidWalls(walls: number[], min: number, max: number): boolean { return walls[1]! - walls[0]! >= min && walls[1]! - walls[0]! <= max && walls[3]! - walls[2]! >= min && walls[3]! - walls[2]! <= max }
function enclosesPositions(walls: number[], data: CaptureDistances[]): boolean { return data.every(capture => capture.x > walls[0]! && capture.x < walls[1]! && capture.y > walls[2]! && capture.y < walls[3]!) }
function differentWalls(a: number[], b: number[]): boolean { return a.some((value, i) => Math.abs(value - b[i]!) > 0.15) }
function hasThreeNonCollinearPositions(captures: readonly EchoCapture[]): boolean {
  const points = captures.map(c => c.position).filter((p, i, all) => all.findIndex(q => q.xM === p.xM && q.yM === p.yM) === i)
  if (points.length < 3) return false
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) for (let c = b + 1; c < points.length; c++) {
    const p = points[a]!, q = points[b]!, r = points[c]!
    if (Math.abs((q.xM - p.xM) * (r.yM - p.yM) - (q.yM - p.yM) * (r.xM - p.xM)) > 1e-5) return true
  }
  return false
}
function validRoom(room: EchoRoom): boolean { return Number.isFinite(room.widthM) && Number.isFinite(room.depthM) && room.widthM > 0 && room.depthM > 0 && Number.isFinite(room.originXM ?? 0) && Number.isFinite(room.originYM ?? 0) }
function validPosition(position: EchoPosition, room: EchoRoom): boolean { const x = room.originXM ?? 0, y = room.originYM ?? 0; return Number.isFinite(position.xM) && Number.isFinite(position.yM) && position.xM > x && position.yM > y && position.xM < x + room.widthM && position.yM < y + room.depthM }
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function gaussian(random: () => number): number { return Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random()) }

function matchedCorrelation(samples: ArrayLike<number>, chirp: Float32Array, energy: number): Float32Array {
  const convolutionLength = samples.length + chirp.length - 1
  let fftLength = 1
  while (fftLength < convolutionLength) fftLength <<= 1
  const real = new Float64Array(fftLength), imaginary = new Float64Array(fftLength)
  const kernelReal = new Float64Array(fftLength), kernelImaginary = new Float64Array(fftLength)
  for (let i = 0; i < samples.length; i++) real[i] = samples[i]!
  for (let i = 0; i < chirp.length; i++) kernelReal[i] = chirp[chirp.length - 1 - i]!
  fft(real, imaginary, false); fft(kernelReal, kernelImaginary, false)
  for (let i = 0; i < fftLength; i++) {
    const r = real[i]! * kernelReal[i]! - imaginary[i]! * kernelImaginary[i]!
    const im = real[i]! * kernelImaginary[i]! + imaginary[i]! * kernelReal[i]!
    real[i] = r; imaginary[i] = im
  }
  fft(real, imaginary, true)
  const result = new Float32Array(samples.length - chirp.length + 1)
  for (let offset = 0; offset < result.length; offset++) result[offset] = Math.abs(real[offset + chirp.length - 1]!) / energy
  return result
}

function fft(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [real[i], real[j]] = [real[j]!, real[i]!]; [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!] }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = 2 * Math.PI / length * (inverse ? 1 : -1), stepReal = Math.cos(angle), stepImaginary = Math.sin(angle)
    for (let start = 0; start < n; start += length) {
      let wr = 1, wi = 0
      for (let j = 0; j < length / 2; j++) {
        const even = start + j, odd = even + length / 2
        const tr = wr * real[odd]! - wi * imaginary[odd]!, ti = wr * imaginary[odd]! + wi * real[odd]!
        real[odd] = real[even]! - tr; imaginary[odd] = imaginary[even]! - ti
        real[even] = real[even]! + tr; imaginary[even] = imaginary[even]! + ti
        const nextWr = wr * stepReal - wi * stepImaginary
        wi = wr * stepImaginary + wi * stepReal; wr = nextWr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] = real[i]! / n; imaginary[i] = imaginary[i]! / n }
}
