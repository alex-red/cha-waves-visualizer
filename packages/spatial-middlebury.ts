import type { StereoCamera, StereoImage } from './spatial-stereo-types.ts'

const MAX_SOURCE_DIMENSION = 4096
const MAX_SOURCE_PIXELS = 16_000_000
const MAX_OUTPUT_WIDTH = 256
const MAX_OUTPUT_HEIGHT = 192
const MAX_BASELINE_MM = 10_000

export type MiddleburyCalibration = {
  width: number
  height: number
  fx: number
  fy: number
  cx0: number
  cx1: number
  cy: number
  baselineM: number
  ndisp: number
}

export type MiddleburyPfm = { width: number; height: number; values: Float32Array<ArrayBuffer> }
export type MiddleburyTruth = { disparityPx: (number | null)[]; depthM: (number | null)[] }

function fail(field: string, message: string): never {
  throw new Error(`${field} ${message}.`)
}

function finiteNumber(text: string | undefined, field: string, min = -Infinity, max = Infinity): number {
  if (text === undefined || text.trim() === '') fail(field, 'is missing')
  const value = Number(text)
  if (!Number.isFinite(value) || value < min || value > max) fail(field, 'must be a finite supported number')
  return value
}

function dimension(value: number, name: string, maximum = MAX_SOURCE_DIMENSION): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail(name, `must be an integer from 1 through ${maximum}`)
  return value
}

function validateOutputSize(width: number, height: number, sourceWidth: number, sourceHeight: number): void {
  dimension(width, 'output width', MAX_OUTPUT_WIDTH)
  dimension(height, 'output height', MAX_OUTPUT_HEIGHT)
  if (width > sourceWidth || height > sourceHeight) fail('output dimensions', 'must not upsample the source')
}

function validateCalibration(calib: MiddleburyCalibration): void {
  if (!calib || typeof calib !== 'object') fail('calibration', 'must be parsed calibration data')
  dimension(calib.width, 'calibration.width')
  dimension(calib.height, 'calibration.height')
  if (calib.width * calib.height > MAX_SOURCE_PIXELS) fail('calibration dimensions', 'exceed the pixel limit')
  for (const [name, value] of [['fx', calib.fx], ['fy', calib.fy]] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) fail(`calibration.${name}`, 'must be positive and bounded')
  }
  for (const [name, value] of [['cx0', calib.cx0], ['cx1', calib.cx1], ['cy', calib.cy]] as const) {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) fail(`calibration.${name}`, 'must be finite and bounded')
  }
  if (!Number.isFinite(calib.baselineM) || calib.baselineM <= 0 || calib.baselineM > 10) fail('calibration.baselineM', 'must be positive and bounded')
  dimension(calib.ndisp, 'calibration.ndisp')
}

/** Parse Middlebury's rectified calibration matrices; visualization range hints are deliberately discarded. */
export function parseMiddleburyCalibration(text: string): MiddleburyCalibration {
  if (typeof text !== 'string' || text.length > 64_000) fail('calibration', 'must be bounded text')
  const values = new Map<string, string>()
  const allowed = new Set(['cam0', 'cam1', 'doffs', 'baseline', 'width', 'height', 'ndisp', 'isint', 'vmin', 'vmax', 'dyavg', 'dymax'])
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) fail('calibration', 'contains a malformed field')
    const name = match[1]!
    if (!allowed.has(name)) fail('calibration', 'contains an unsupported field')
    if (values.has(name)) fail(`calibration.${name}`, 'is repeated')
    values.set(name, match[2]!)
  }

  const matrix = (key: 'cam0' | 'cam1') => {
    const raw = values.get(key)
    if (!raw) fail(`calibration.${key}`, 'is missing')
    const match = /^\[\s*([^;]+);\s*([^;]+);\s*([^;]+)\s*\]$/.exec(raw)
    if (!match) fail(`calibration.${key}`, 'must be a 3 by 3 matrix')
    const rows = [match[1]!, match[2]!, match[3]!].map(row => row.trim().split(/\s+/))
    if (rows.some(row => row.length !== 3)) fail(`calibration.${key}`, 'must be a 3 by 3 matrix')
    const parsed = rows.map((row, rowIndex) => row.map((part, columnIndex) => finiteNumber(part, `${key}[${rowIndex},${columnIndex}]`)))
    const [a, b, c] = parsed
    if (a![1] !== 0 || b![0] !== 0 || c![0] !== 0 || c![1] !== 0 || c![2] !== 1) {
      fail(`calibration.${key}`, 'must have form [f 0 cx; 0 f cy; 0 0 1]')
    }
    if (a![0]! <= 0 || b![1]! <= 0) fail(`calibration.${key}`, 'focal lengths must be positive')
    if (a![0]! > 1_000_000 || b![1]! > 1_000_000 || Math.abs(a![2]!) > 1_000_000 || Math.abs(b![2]!) > 1_000_000) {
      fail(`calibration.${key}`, 'parameters exceed the supported magnitude')
    }
    return { fx: a![0]!, fy: b![1]!, cx: a![2]!, cy: b![2]! }
  }

  const left = matrix('cam0')
  const right = matrix('cam1')
  if (left.fx !== left.fy || right.fx !== right.fy || left.fx !== right.fx || left.cy !== right.cy) {
    fail('calibration', 'rectified cameras must share focal lengths and vertical principal point')
  }
  const width = dimension(finiteNumber(values.get('width'), 'calibration.width'), 'calibration.width')
  const height = dimension(finiteNumber(values.get('height'), 'calibration.height'), 'calibration.height')
  if (width * height > MAX_SOURCE_PIXELS) fail('calibration dimensions', 'exceed the pixel limit')
  const ndisp = dimension(finiteNumber(values.get('ndisp'), 'calibration.ndisp'), 'calibration.ndisp', MAX_SOURCE_DIMENSION)
  const baselineMm = finiteNumber(values.get('baseline'), 'calibration.baseline', 0.001, MAX_BASELINE_MM)
  // doffs is part of some calibration files. Principal points are authoritative,
  // so no separately supplied value can alter depth conversion.
  if (values.has('doffs')) {
    const doffs = finiteNumber(values.get('doffs'), 'calibration.doffs')
    if (Math.abs(doffs - (right.cx - left.cx)) > 1e-5) fail('calibration.doffs', 'must match the camera principal-point difference')
  }
  for (const optional of ['isint', 'vmin', 'vmax', 'dyavg', 'dymax']) {
    if (values.has(optional)) {
      const value = finiteNumber(values.get(optional), `calibration.${optional}`)
      if (optional === 'isint' && value !== 0 && value !== 1) fail('calibration.isint', 'must be 0 or 1')
      if ((optional === 'dyavg' || optional === 'dymax') && value < 0) fail(`calibration.${optional}`, 'must be nonnegative')
    }
  }
  return { width, height, fx: left.fx, fy: left.fy, cx0: left.cx, cx1: right.cx, cy: left.cy, baselineM: baselineMm / 1000, ndisp }
}

function decodeAsciiHeader(bytes: Uint8Array<ArrayBuffer>): { tokens: string[]; offset: number } {
  const tokens: string[] = []
  let offset = 0
  while (tokens.length < 4) {
    while (offset < bytes.length && (bytes[offset] === 0x20 || bytes[offset] === 0x09 || bytes[offset] === 0x0a || bytes[offset] === 0x0d)) offset += 1
    if (offset > 256) fail('PFM header', 'exceeds the header size limit')
    const start = offset
    while (offset < bytes.length && bytes[offset] !== 0x20 && bytes[offset] !== 0x09 && bytes[offset] !== 0x0a && bytes[offset] !== 0x0d) {
      if (offset - start > 128) fail('PFM header', 'contains an oversized token')
      const byte = bytes[offset]!
      if (byte < 0x21 || byte > 0x7e) fail('PFM header', 'must contain ASCII tokens')
      offset += 1
    }
    if (start === offset) fail('PFM header', 'is incomplete')
    tokens.push(String.fromCharCode(...bytes.subarray(start, offset)))
  }
  if (offset >= bytes.length || ![0x20, 0x09, 0x0a, 0x0d].includes(bytes[offset]!)) fail('PFM header', 'must end with whitespace')
  // Consume one line-ending sequence or one separating whitespace byte. Raster
  // bytes are binary and must not be skipped as generic whitespace.
  const separator = bytes[offset++]!
  if (separator === 0x0d && bytes[offset] === 0x0a) offset += 1
  return { tokens, offset }
}

/** Decode grayscale Pf float raster to top-down rows, preserving unknown NaN/+Inf samples. */
export function parseMiddleburyPfm(input: Uint8Array): MiddleburyPfm {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_SOURCE_PIXELS * 4 + 256) fail('PFM bytes', 'exceed the supported size')
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength) as Uint8Array<ArrayBuffer>
  const { tokens, offset } = decodeAsciiHeader(bytes)
  if (tokens[0] !== 'Pf') fail('PFM magic', 'must be grayscale Pf')
  const width = dimension(finiteNumber(tokens[1], 'PFM width'), 'PFM width')
  const height = dimension(finiteNumber(tokens[2], 'PFM height'), 'PFM height')
  if (width * height > MAX_SOURCE_PIXELS) fail('PFM dimensions', 'exceed the pixel limit')
  const signedScale = finiteNumber(tokens[3], 'PFM scale metadata')
  if (signedScale === 0) fail('PFM scale metadata', 'must be nonzero')
  const byteLength = width * height * 4
  if (input.byteLength - offset !== byteLength) fail('PFM raster', 'must contain exactly one float per pixel')
  const littleEndian = signedScale < 0
  const sourceView = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const values = new Float32Array(width * height)
  for (let sourceIndex = 0; sourceIndex < values.length; sourceIndex += 1) {
    const rawValue = sourceView.getFloat32(offset + sourceIndex * 4, littleEndian)
    // Middlebury disparity PFM uses the scale sign for byte order only; its
    // absolute magnitude is ignored and samples already represent pixel units.
    if (rawValue === -Infinity) fail('PFM raster', 'contains negative infinity')
    const sourceRow = Math.floor(sourceIndex / width)
    const column = sourceIndex % width
    const targetRow = height - sourceRow - 1
    values[targetRow * width + column] = rawValue
  }
  return { width, height, values }
}

/** Deterministically area-average RGB pixels without upsampling. */
export function resizeMiddleburyRgb(image: { width: number; height: number; rgb: Uint8Array }, width: number, height: number): StereoImage {
  if (!image || !(image.rgb instanceof Uint8Array)) fail('image.rgb', 'must be an 8-bit byte array')
  const sourceWidth = dimension(image.width, 'image.width')
  const sourceHeight = dimension(image.height, 'image.height')
  if (sourceWidth * sourceHeight > MAX_SOURCE_PIXELS || image.rgb.byteLength !== sourceWidth * sourceHeight * 3) {
    fail('image.rgb', 'must exactly match bounded RGB dimensions')
  }
  validateOutputSize(width, height, sourceWidth, sourceHeight)
  const rgb = new Uint8Array(width * height * 3)
  const sx = sourceWidth / width
  const sy = sourceHeight / height
  for (let oy = 0; oy < height; oy += 1) {
    const y0 = oy * sy, y1 = (oy + 1) * sy
    for (let ox = 0; ox < width; ox += 1) {
      const x0 = ox * sx, x1 = (ox + 1) * sx
      let totalArea = 0
      const sums = [0, 0, 0]
      for (let iy = Math.floor(y0); iy < Math.ceil(y1) && iy < sourceHeight; iy += 1) {
        const overlapY = Math.min(y1, iy + 1) - Math.max(y0, iy)
        if (overlapY <= 0) continue
        for (let ix = Math.floor(x0); ix < Math.ceil(x1) && ix < sourceWidth; ix += 1) {
          const area = overlapY * (Math.min(x1, ix + 1) - Math.max(x0, ix))
          if (area <= 0) continue
          const source = (iy * sourceWidth + ix) * 3
          totalArea += area
          for (let channel = 0; channel < 3; channel += 1) sums[channel] = sums[channel]! + image.rgb[source + channel]! * area
        }
      }
      const target = (oy * width + ox) * 3
      for (let channel = 0; channel < 3; channel += 1) rgb[target + channel] = Math.round(sums[channel]! / totalArea)
    }
  }
  return { width, height, rgb }
}

/** Create rectified cameras with edge-centered intrinsics expected by the estimator. */
export function createMiddleburyCameras(calib: MiddleburyCalibration, width: number, height: number): { left: StereoCamera; right: StereoCamera } {
  validateCalibration(calib)
  validateOutputSize(width, height, calib.width, calib.height)
  const sx = width / calib.width
  const sy = height / calib.height
  const make = (id: string, x: number, cx: number): StereoCamera => ({
    id,
    positionM: [x, 0, 0],
    intrinsics: {
      width, height, fx: calib.fx * sx, fy: calib.fy * sy,
      cx: (cx + 0.5) * sx, cy: (calib.cy + 0.5) * sy,
    },
  })
  if (calib.fx * sx > 1e4 || calib.fy * sy > 1e4) fail('output intrinsics', 'exceed the supported focal length')
  return { left: make('middlebury-left', 0, calib.cx0), right: make('middlebury-right', calib.baselineM, calib.cx1) }
}

/** Nearest-neighbour resample of evaluator-only disparity truth; no interpolation or range hints. */
export function resizeMiddleburyTruth(pfm: MiddleburyPfm, calib: MiddleburyCalibration, width: number, height: number): MiddleburyTruth {
  validateCalibration(calib)
  if (!pfm || typeof pfm !== 'object' || !(pfm.values instanceof Float32Array)) fail('truth raster', 'must be parsed PFM data')
  dimension(pfm.width, 'truth width')
  dimension(pfm.height, 'truth height')
  if (pfm.width * pfm.height > MAX_SOURCE_PIXELS) fail('truth dimensions', 'exceed the pixel limit')
  if (pfm.width !== calib.width || pfm.height !== calib.height || pfm.values.length !== pfm.width * pfm.height) {
    fail('truth dimensions', 'must match the calibration raster')
  }
  validateOutputSize(width, height, pfm.width, pfm.height)
  const sx = width / pfm.width
  const sy = height / pfm.height
  const disparityPx: (number | null)[] = new Array(width * height).fill(null)
  const depthM: (number | null)[] = new Array(width * height).fill(null)
  const doffs = calib.cx1 - calib.cx0
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(pfm.height - 1, Math.floor((y + 0.5) / sy))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(pfm.width - 1, Math.floor((x + 0.5) / sx))
      const sourceDisparity = pfm.values[sourceY * pfm.width + sourceX]!
      if (Number.isNaN(sourceDisparity) || sourceDisparity === Infinity) continue
      if (!Number.isFinite(sourceDisparity) || sourceDisparity < 0) fail('truth disparity', 'must be nonnegative finite or unknown')
      const effective = sourceDisparity + doffs
      if (!(effective > 0) || !Number.isFinite(effective)) fail('truth disparity', 'plus principal-point offset must be positive')
      const scaled = sourceDisparity * sx
      const depth = calib.fx * calib.baselineM / effective
      if (!Number.isFinite(scaled) || !Number.isFinite(depth) || depth <= 0) fail('truth depth', 'must be positive finite')
      const target = y * width + x
      disparityPx[target] = scaled
      depthM[target] = depth
    }
  }
  return { disparityPx, depthM }
}
