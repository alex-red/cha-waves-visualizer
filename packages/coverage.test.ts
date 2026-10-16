import { describe, expect, it } from 'vitest'
import { MASK_REASON, type FieldResult } from './engine'
import { summarizeRfCoverage } from './coverage'

function field(overrides: Partial<FieldResult> = {}): FieldResult {
  return {
    identity: { workspaceGeneration: 0, requestId: 0, queryHash: 'q', solverId: 'rf-fspl-multiwall-v1', solverVersion: '1' },
    sceneRevision: 0, quantity: 'received-power-dbm', unit: 'dBm',
    grid: { levelId: 'main', originXY: [0, 0], cols: 2, rows: 2, cellSizeM: 0.5, receiverZM: 1.5, quality: 'custom' },
    values: new Float32Array([-50, -70, 0, Number.NaN]),
    validity: new Uint8Array([MASK_REASON.valid, MASK_REASON.valid, MASK_REASON.insideSolid, MASK_REASON.outsideFloor]),
    assumptions: [], computeMs: 1, ...overrides,
  }
}

describe('RF coverage summary', () => {
  it('counts threshold equality inclusively and estimates area from sampled cells', () => {
    expect(summarizeRfCoverage(field(), -50)).toEqual({
      thresholdDbm: -50, totalCount: 4, validCount: 2, aboveCount: 1, excludedCount: 2,
      validAreaM2: 0.5, aboveAreaM2: 0.25, excludedAreaM2: 0.5,
      percentOfValid: 50, cellSizeM: 0.5, receiverZM: 1.5,
      excludedByReason: { insideSolid: 1, outsideFloor: 1 },
    })
  })

  it('keeps zero received power as data and returns null percentage when every cell is excluded', () => {
    const allValid = field({ grid: { ...field().grid, cols: 2, rows: 1 }, values: new Float32Array([0, -80]), validity: new Uint8Array([1, 1]) })
    expect(summarizeRfCoverage(allValid, 0).aboveCount).toBe(1)
    const allExcluded = field({ grid: { ...field().grid, cols: 2, rows: 1 }, validity: new Uint8Array([0, 3]), values: new Float32Array([NaN, NaN]) })
    expect(summarizeRfCoverage(allExcluded, -90)).toMatchObject({ validCount: 0, excludedCount: 2, percentOfValid: null, excludedByReason: { outsideFloor: 1, belowModelDistance: 1 } })
  })

  it('rejects wrong solver quantity and unit', () => {
    expect(() => summarizeRfCoverage(field({ quantity: 'relative-direct-level-db' }), -60)).toThrow(/RF received-power/)
    expect(() => summarizeRfCoverage(field({ unit: 'dB' }), -60)).toThrow(/RF received-power/)
    expect(() => summarizeRfCoverage(field({ identity: { ...field().identity, solverId: 'acoustic-direct-v1' } }), -60)).toThrow(/RF received-power/)
  })

  it('rejects invalid thresholds, grid dimensions, cell sizes and array lengths', () => {
    expect(() => summarizeRfCoverage(field(), Infinity)).toThrow(/threshold/)
    expect(() => summarizeRfCoverage(field({ grid: { ...field().grid, cols: 0 } }), -60)).toThrow(/dimensions/)
    expect(() => summarizeRfCoverage(field({ grid: { ...field().grid, cellSizeM: 0 } }), -60)).toThrow(/cell size/)
    expect(() => summarizeRfCoverage(field({ values: new Float32Array(1) }), -60)).toThrow(/arrays/)
    expect(() => summarizeRfCoverage(field({ grid: { ...field().grid, cellSizeM: 1e200 } }), -60)).toThrow(/Cell area must be finite/)
    expect(() => summarizeRfCoverage(field({ grid: { ...field().grid, cellSizeM: 1e154 } }), -60)).toThrow(/Coverage areas must be finite/)
  })

  it('rejects unknown masks and non-finite values in valid cells', () => {
    expect(() => summarizeRfCoverage(field({ validity: new Uint8Array([1, 1, 6, 0]) }), -60)).toThrow(/Unknown validity mask/)
    expect(() => summarizeRfCoverage(field({ values: new Float32Array([NaN, -70, 0, 0]), validity: new Uint8Array([1, 1, 0, 0]) }), -60)).toThrow(/finite values/)
  })
})
