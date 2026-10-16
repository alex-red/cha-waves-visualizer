import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings, type FieldResult, type Scene, type SolverSettings } from './engine'
import { compareCompatibility, compareProbeAt, computeDelta, describeChanges, type ComparisonSnapshot } from './comparison'

function field(overrides: Partial<FieldResult> = {}): FieldResult {
  const grid = { levelId: 'main', originXY: [0, 0] as [number, number], cols: 2, rows: 1, cellSizeM: 1, receiverZM: 1.5, quality: 'custom' as const }
  return { identity: { workspaceGeneration: 0, requestId: 0, queryHash: 'hash', solverId: 'acoustic-direct-v1', solverVersion: '1.0.0' }, sceneRevision: 1, quantity: 'relative-direct-level-db', unit: 'dB', grid, values: new Float32Array([1, 2]), validity: new Uint8Array([1, 1]), assumptions: [], computeMs: 0, ...overrides }
}
function snapshot(fieldValue = field(), settings: SolverSettings = defaultSettings('acoustics')): ComparisonSnapshot {
  return { scene: createDemoScene(), settings, field: fieldValue }
}

describe('compareCompatibility', () => {
  it('accepts matching solver, version, frequency, settings and grid independent of object key order', () => {
    const a = snapshot(field(), { mode: 'acoustics', frequencyHz: 1000, referenceDistanceM: 1, minValidDistanceM: 1, speedOfSoundMps: 343, transmissionEnabled: true })
    const b = snapshot(field(), { transmissionEnabled: true, speedOfSoundMps: 343, minValidDistanceM: 1, referenceDistanceM: 1, frequencyHz: 1000, mode: 'acoustics' })
    expect(compareCompatibility(a, b)).toEqual({ compatible: true, reasons: [] })
  })
  it.each([
    ['solver version', field({ identity: { ...field().identity, solverVersion: '2.0.0' } }), defaultSettings('acoustics')],
    ['grid', field({ grid: { ...field().grid, cellSizeM: 2 } }), defaultSettings('acoustics')],
    ['frequency', field(), { ...defaultSettings('acoustics'), frequencyHz: 2000 }],
  ])('rejects mismatched %s', (_label, otherField, otherSettings) => {
    expect(compareCompatibility(snapshot(), snapshot(otherField, otherSettings)).compatible).toBe(false)
  })
})

describe('describeChanges', () => {
  it('reports physical object and settings changes while ignoring names and presentation data', () => {
    const a = createDemoScene(), b = createDemoScene()
    b.openings[0]!.isOpen = true
    b.walls[4]!.end = [12, 5]
    b.materials[0]!.radioLossDb[0]!.valueDb = 4
    b.emitters[0]!.position = [3, 7.8, 1.2]
    b.materials[1]!.display = { color: '#ffffff' }
    b.zones[0]!.name = 'renamed room'
    const changes = describeChanges(a, b, defaultSettings('acoustics'), { ...defaultSettings('acoustics'), frequencyHz: 2000 })
    expect(changes.objects.map(change => `${change.kind}:${change.id}:${change.action}`)).toEqual([
      'wall:hall-partition:changed', 'door:hall-door:changed', 'material:partition:changed', 'source:speaker:changed',
    ])
    expect(changes.settings.map(change => change.key)).toEqual(['frequencyHz'])
  })
})

describe('computeDelta', () => {
  it('computes B minus A only where both source masks are valid', () => {
    const a = field({ values: new Float32Array([10, -2]), validity: new Uint8Array([1, 2]) })
    const b = field({ values: new Float32Array([7, 4]), validity: new Uint8Array([1, 1]) })
    const result = computeDelta(a, b)
    expect([...result.values]).toEqual([-3, 0])
    expect([...result.validity]).toEqual([1, 0])
    expect(result.sharedCount).toBe(1)
    expect(result.excludedCount).toBe(1)
    expect(result.maxAbs).toBe(3)
  })
  it('rejects fields from different solver versions or malformed valid cells', () => {
    const a = field()
    expect(() => computeDelta(a, field({ identity: { ...a.identity, solverVersion: '2.0.0' } }))).toThrow(/matching quantities/)
    expect(() => computeDelta(a, field({ validity: new Uint8Array([1, 9]) }))).toThrow(/unknown validity mask/)
    expect(() => computeDelta(a, field({ values: new Float32Array([Number.NaN, 2]) }))).toThrow(/non-finite/)
  })
})

describe('compareProbeAt', () => {
  it('reports radio power change in dB and rejects mismatched frequencies', () => {
    const settings = defaultSettings('radio')
    const sceneA = createDemoScene(), sceneB = createDemoScene()
    sceneB.emitters.find(item => item.domain === 'radio')!.eirpDbm! += 3
    const result = compareProbeAt(sceneA, settings, sceneB, settings, [8, 6, 1.5])
    expect(result.a.unit).toBe('dBm')
    expect(result.delta).toBeCloseTo(3)
    expect(() => compareProbeAt(sceneA, settings, sceneB, { ...settings, frequencyHz: 5e9 }, [8, 6, 1.5])).toThrow(/matching domains/)
  })
})
