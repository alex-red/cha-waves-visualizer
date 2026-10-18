import { describe, expect, it } from 'vitest'
import {
  createMiddleburyCameras,
  parseMiddleburyCalibration,
  parseMiddleburyPfm,
  resizeMiddleburyRgb,
  resizeMiddleburyTruth,
} from './spatial-middlebury.ts'

function calibration(overrides = ''): string {
  return [
    'cam0=[8 0 1.25; 0 8 0.75; 0 0 1]',
    'cam1=[8 0 2.25; 0 8 0.75; 0 0 1]',
    'doffs=1', 'baseline=100', 'width=4', 'height=2', 'ndisp=16',
    overrides,
  ].filter(Boolean).join('\n') + '\n'
}

function pfm(values: readonly number[], width: number, height: number, endian: 'little' | 'big' = 'little', scale = 1): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(`Pf\n${width} ${height}\n${endian === 'little' ? -scale : scale}\n`)
  const result = new Uint8Array(header.length + values.length * 4)
  result.set(header)
  const view = new DataView(result.buffer)
  values.forEach((value, index) => view.setFloat32(header.length + index * 4, value, endian === 'little'))
  return result
}

describe('Middlebury input adaptation', () => {
  it('parses calibration and discards visualization disparity bounds', () => {
    const parsed = parseMiddleburyCalibration(calibration('isint=0\nvmin=2\nvmax=12\ndyavg=0.1\ndymax=0.5'))
    expect(parsed).toEqual({ width: 4, height: 2, fx: 8, fy: 8, cx0: 1.25, cx1: 2.25, cy: 0.75, baselineM: 0.1, ndisp: 16 })
    expect(parsed).not.toHaveProperty('vmin')
    expect(parsed).not.toHaveProperty('vmax')
    expect(() => parseMiddleburyCalibration(calibration().replace('cam1=[8 0 2.25; 0 8 0.75', 'cam1=[8 0 2.25; 0 7 0.75'))).toThrow(/share focal lengths/)
    expect(() => parseMiddleburyCalibration(calibration('vmin=1\nvmin=2'))).toThrow(/repeated/)
  })

  it('uses PFM scale sign for endianness only and flips bottom-up rows to top-down', () => {
    const little = parseMiddleburyPfm(pfm([3, 4, 1, Number.NaN], 2, 2, 'little', 2))
    expect(little.width).toBe(2)
    expect([...little.values.slice(0, 1)]).toEqual([1])
    expect(little.values[1]).toBeNaN()
    expect([...little.values.slice(2)]).toEqual([3, 4])
    const big = parseMiddleburyPfm(pfm([9, 10], 2, 1, 'big', 0.5))
    expect([...big.values]).toEqual([9, 10])
    // This is the non-unit scale value used by the pinned Middlebury PFM.
    expect(parseMiddleburyPfm(pfm([120], 1, 1, 'little', 0.003922)).values[0]).toBe(120)
    expect(parseMiddleburyPfm(pfm([120], 1, 1, 'big', 0.003922)).values[0]).toBe(120)
  })

  it('preserves positive infinity as missing, rejects negative infinity and malformed raster sizes', () => {
    const parsed = parseMiddleburyPfm(pfm([Infinity, 3], 2, 1))
    expect(parsed.values[0]).toBe(Infinity)
    expect(() => parseMiddleburyPfm(pfm([-Infinity], 1, 1))).toThrow(/negative infinity/)
    expect(() => parseMiddleburyPfm(pfm([1], 1, 1).subarray(0, 10))).toThrow()
    expect(() => parseMiddleburyPfm(new TextEncoder().encode('PF\n1 1\n-1\n' + '\0'.repeat(12)))).toThrow(/grayscale Pf/)
    expect(() => parseMiddleburyPfm(new TextEncoder().encode(`${'X'.repeat(300)}\n1 1\n-1\n`))).toThrow(/oversized token/)
    expect(parseMiddleburyPfm(pfm([3.4e38], 1, 1, 'little', 0.003922)).values[0]).toBe(Math.fround(3.4e38))
    expect(() => parseMiddleburyPfm(new TextEncoder().encode('Pf\n1 1\n0\n\0\0\0\0'))).toThrow(/nonzero/)
  })

  it('area-averages RGB with deterministic rounding and rejects upsampling or malformed bytes', () => {
    const image = { width: 2, height: 2, rgb: new Uint8Array([0, 1, 2, 10, 11, 12, 20, 21, 22, 30, 31, 32]) }
    expect(resizeMiddleburyRgb(image, 1, 1)).toEqual({ width: 1, height: 1, rgb: new Uint8Array([15, 16, 17]) })
    expect(() => resizeMiddleburyRgb(image, 3, 1)).toThrow(/upsample/)
    expect(() => resizeMiddleburyRgb({ ...image, rgb: new Uint8Array(2) }, 1, 1)).toThrow(/exactly match/)
  })

  it('maps edge-centered intrinsics and baseline, and nearest-resamples truth with Middlebury doffs sign', () => {
    const calib = parseMiddleburyCalibration(calibration('vmin=40\nvmax=80'))
    const cameras = createMiddleburyCameras(calib, 2, 1)
    expect(cameras.left.positionM).toEqual([0, 0, 0])
    expect(cameras.right.positionM).toEqual([0.1, 0, 0])
    expect(cameras.left.intrinsics).toEqual({ width: 2, height: 1, fx: 4, fy: 4, cx: 0.875, cy: 0.625 })
    expect(cameras.right.intrinsics.cx).toBe(1.375)

    // PFM rows are bottom-up. Truth resampling selects the second source row,
    // then source columns 1 and 3 for the 2x reduction.
    const truth = resizeMiddleburyTruth(parseMiddleburyPfm(pfm([6, 7, 8, 9, 2, 3, 4, 5], 4, 2)), calib, 2, 1)
    expect(truth.disparityPx).toEqual([3.5, 4.5])
    expect(truth.depthM).toEqual([8 * 0.1 / 8, 8 * 0.1 / 10])
  })

  it('keeps missing truth null, rejects invalid finite disparities, and never uses vmin/vmax', () => {
    const calib = parseMiddleburyCalibration(calibration('vmin=99\nvmax=100'))
    const parsed = parseMiddleburyPfm(pfm([5, 6, 7, 8, 2, Number.NaN, Infinity, 4], 4, 2))
    const result = resizeMiddleburyTruth(parsed, calib, 4, 2)
    expect(result.disparityPx).toEqual([2, null, null, 4, 5, 6, 7, 8])
    expect(result.depthM).toEqual([8 * 0.1 / 3, null, null, 8 * 0.1 / 5, 8 * 0.1 / 6, 8 * 0.1 / 7, 8 * 0.1 / 8, 8 * 0.1 / 9])

    const badNegative = { width: 4, height: 2, values: new Float32Array([-1, 2, 2, 2, 2, 2, 2, 2]) }
    expect(() => resizeMiddleburyTruth(badNegative, calib, 4, 2)).toThrow(/nonnegative finite or unknown/)
    const negativeDoffs = { ...calib, cx1: calib.cx0 - 3 }
    const tooSmall = { width: 4, height: 2, values: new Float32Array(8).fill(2) }
    expect(() => resizeMiddleburyTruth(tooSmall, negativeDoffs, 4, 2)).toThrow(/must be positive/)
  })

  it('enforces source and target dimension limits', () => {
    expect(() => parseMiddleburyCalibration(calibration().replace('width=4', 'width=5000'))).toThrow(/integer/)
    expect(() => parseMiddleburyPfm(pfm([1], 1, 1).subarray(0, 7))).toThrow()
    const calib = parseMiddleburyCalibration(calibration())
    expect(() => createMiddleburyCameras(calib, 5, 2)).toThrow(/upsample/)
    expect(() => resizeMiddleburyTruth(parseMiddleburyPfm(pfm(new Array(8).fill(1), 4, 2)), calib, 257, 1)).toThrow(/through 256/)
  })
})
