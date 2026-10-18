import { describe, expect, it } from 'vitest'
import { decodePpm, encodePpm } from './spatial-ppm.ts'

describe('spatial PPM codec', () => {
  it('round-trips RGB bytes including whitespace and # at the raster boundary', () => {
    const image = { width: 2, height: 1, rgb: new Uint8Array([0x20, 0x0a, 0x23, 0xff, 0, 128]) }
    const encoded = encodePpm(image)
    expect(new TextDecoder().decode(encoded.subarray(0, 11))).toBe('P6\n2 1\n255\n')
    const decoded = decodePpm(encoded)
    expect(decoded).toEqual(image)
    expect(decoded.rgb).not.toBe(image.rgb)
  })

  it('accepts ordinary header whitespace and a CRLF raster separator without eating raster bytes', () => {
    const header = new TextEncoder().encode('P6\r\n 2\t1 \r\n255\r\n')
    const bytes = new Uint8Array(header.length + 6)
    bytes.set(header)
    bytes.set([0x0a, 0x20, 0x23, 1, 2, 3], header.length)
    expect([...decodePpm(bytes).rgb]).toEqual([0x0a, 0x20, 0x23, 1, 2, 3])
  })

  it('rejects malformed headers, comments, non-ASCII header bytes, and non-RGB formats', () => {
    for (const header of ['P3\n1 1\n255\n', 'P6\n#comment\n1 1\n255\n', 'P6\n1 1\n254\n', 'P6\n1 1\n255\u00e9']) {
      expect(() => decodePpm(new TextEncoder().encode(header))).toThrow()
    }
    const header = new TextEncoder().encode('P6\n1 1\n255\n')
    const nonAscii = new Uint8Array(header.length + 3)
    nonAscii.set(header)
    nonAscii[2] = 0xff
    expect(() => decodePpm(nonAscii)).toThrow()
  })

  it('rejects invalid dimensions, max sizes, truncated and trailing raster data', () => {
    for (const header of ['P6\n0 1\n255\n', 'P6\n257 1\n255\n', 'P6\n1 193\n255\n']) {
      expect(() => decodePpm(new TextEncoder().encode(header))).toThrow()
    }
    const encoded = encodePpm({ width: 1, height: 1, rgb: new Uint8Array([1, 2, 3]) })
    expect(() => decodePpm(encoded.subarray(0, encoded.length - 1))).toThrow()
    const trailing = new Uint8Array(encoded.length + 1)
    trailing.set(encoded)
    expect(() => decodePpm(trailing)).toThrow()
    expect(() => encodePpm({ width: 1, height: 1, rgb: new Uint8Array(2) })).toThrow()
  })

  it('bounds source size and decimal token length before parsing', () => {
    const longToken = new TextEncoder().encode('P6\n999999 1\n255\n')
    expect(() => decodePpm(longToken)).toThrow(/five digits/i)
    const oversized = new Uint8Array(256 * 192 * 3 + 1025)
    expect(() => decodePpm(oversized)).toThrow(/size/i)
    const longHeader = new Uint8Array(1025)
    longHeader.set(new TextEncoder().encode('P6\n'))
    longHeader.fill(0x20, 3)
    expect(() => decodePpm(longHeader)).toThrow()
  })
})
