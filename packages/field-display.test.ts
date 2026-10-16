import { describe, expect, it } from 'vitest'
import { fieldColorRgb, fieldCssColor, fieldTexturePixels, overFieldPaper } from './field-display'
import type { FieldResult } from './engine'

function field(values: number[], validity = values.map(() => 1)): FieldResult {
  return {
    identity: { workspaceGeneration: 0, requestId: 0, queryHash: 'display-test', solverId: 'acoustic-direct-v1', solverVersion: '1.0.0' },
    sceneRevision: 1, quantity: 'relative-direct-level-db', unit: 'dB',
    grid: { levelId: 'main', originXY: [0, 0], cols: values.length, rows: 1, cellSizeM: 0.25, receiverZM: 1.5, quality: 'custom' },
    values: new Float32Array(values), validity: new Uint8Array(validity), assumptions: [], computeMs: 0,
  }
}

describe('shared field display', () => {
  it('preserves absolute endpoints, clamping and the neutral delta color', () => {
    expect(fieldColorRgb(-1000, 'sound')).toEqual([248, 220, 170])
    expect(fieldColorRgb(1000, 'sound')).toEqual([152, 65, 34])
    expect(fieldColorRgb(-90, 'wifi')).toEqual([213, 232, 226])
    expect(fieldColorRgb(-30, 'wifi')).toEqual([23, 97, 110])
    expect(fieldColorRgb(0, 'delta')).toEqual([247, 243, 233])
    expect(fieldCssColor(-30, 'wifi')).toBe('rgba(23,97,110,0.82)')
  })

  it('uses the same paper-composited colors in the texture and CSS field', () => {
    const pixels = fieldTexturePixels(field([-36, -9]), 'sound', false)
    expect(Array.from(pixels.slice(0, 4))).toEqual([246, 222, 180, 255])
    expect(Array.from(pixels.slice(4, 8))).toEqual([...overFieldPaper(fieldColorRgb(-9, 'sound')), 255])
  })

  it('masks cells invalid in either delta input and subtracts current minus baseline', () => {
    const current = field([-12, -12, -12], [1, 1, 2]), baseline = field([-24, -12, -12], [1, 2, 1])
    const pixels = fieldTexturePixels(current, 'sound', true, baseline)
    expect(Array.from(pixels.slice(0, 4))).toEqual([...overFieldPaper(fieldColorRgb(12, 'delta')), 255])
    expect(Array.from(pixels.slice(4))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('does not subtract fields sampled on different receiver planes', () => {
    const current = field([-12]), baseline = field([-24])
    baseline.grid.receiverZM = 2
    expect(fieldTexturePixels(current, 'sound', true, baseline)).toEqual(fieldTexturePixels(current, 'sound', false))
  })
})
