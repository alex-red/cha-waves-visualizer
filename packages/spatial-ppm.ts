import type { StereoImage } from './spatial-stereo-types.ts'

const MAX_WIDTH = 256
const MAX_HEIGHT = 192
const MAX_HEADER_BYTES = 1024
const MAX_SOURCE_BYTES = MAX_WIDTH * MAX_HEIGHT * 3 + MAX_HEADER_BYTES

function validateDimensions(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new RangeError(`PPM dimensions must be integers within 1..${MAX_WIDTH} by 1..${MAX_HEIGHT}`)
  }
  return width * height * 3
}

/** Encode a bounded RGB8 image as a canonical binary P6 PPM. */
export function encodePpm(image: StereoImage): Uint8Array<ArrayBuffer> {
  const rasterLength = validateDimensions(image.width, image.height)
  if (!(image.rgb instanceof Uint8Array) || image.rgb.length !== rasterLength) {
    throw new RangeError('PPM RGB raster length must equal width × height × 3')
  }
  const header = new TextEncoder().encode(`P6\n${image.width} ${image.height}\n255\n`)
  const result = new Uint8Array(header.length + rasterLength)
  result.set(header)
  result.set(image.rgb, header.length)
  return result
}

const isWhitespace = (byte: number) => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d)

/** Decode bounded binary P6 RGB8. Comments are deliberately unsupported. */
export function decodePpm(bytes: Uint8Array): StereoImage {
  if (bytes.length > MAX_SOURCE_BYTES) throw new RangeError('PPM source exceeds the maximum raster and header size')
  let cursor = 0
  const fail = (): never => { throw new TypeError('Invalid or unsupported P6 PPM') }

  const expect = (value: number) => {
    if (bytes[cursor] !== value) fail()
    cursor += 1
  }
  const skipWhitespace = () => {
    while (cursor < bytes.length && isWhitespace(bytes[cursor]!)) cursor += 1
    if (cursor > MAX_HEADER_BYTES) throw new RangeError('PPM header exceeds 1024 bytes')
  }
  const token = () => {
    const start = cursor
    while (cursor < bytes.length && bytes[cursor]! >= 0x30 && bytes[cursor]! <= 0x39) cursor += 1
    if (cursor === start) fail()
    if (cursor - start > 5) throw new RangeError('PPM header number exceeds five digits')
    if (cursor > MAX_HEADER_BYTES) throw new RangeError('PPM header exceeds 1024 bytes')
    return Number(String.fromCharCode(...bytes.subarray(start, cursor)))
  }

  expect(0x50) // P
  expect(0x36) // 6
  if (cursor >= bytes.length || !isWhitespace(bytes[cursor]!)) fail()
  skipWhitespace()
  const width = token()
  if (cursor >= bytes.length || !isWhitespace(bytes[cursor]!)) fail()
  skipWhitespace()
  const height = token()
  if (cursor >= bytes.length || !isWhitespace(bytes[cursor]!)) fail()
  skipWhitespace()
  const maxValue = token()
  if (maxValue !== 255 || cursor >= bytes.length || !isWhitespace(bytes[cursor]!)) fail()

  // Consume one header/raster separator only. CRLF is one line-ending; any
  // following whitespace belongs to the raster and must be preserved.
  const separator = bytes[cursor++]!
  if (separator === 0x0d && bytes[cursor] === 0x0a) cursor += 1
  if (cursor > MAX_HEADER_BYTES) throw new RangeError('PPM header exceeds 1024 bytes')

  const rasterLength = validateDimensions(width, height)
  if (bytes.length !== cursor + rasterLength) fail()
  const rgb = new Uint8Array(rasterLength)
  rgb.set(bytes.subarray(cursor))
  return { width, height, rgb }
}
