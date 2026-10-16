import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings, evaluatePoint, type Scene } from './engine'
import { buildLossBreakdown, LOSS_BREAKDOWN_TOLERANCE_DB } from './loss-breakdown'

describe('buildLossBreakdown', () => {
  it('explains the acoustic reference, configurable reference distance, and wall terms', () => {
    const scene = createDemoScene()
    const settings = { ...defaultSettings('acoustics'), referenceDistanceM: 2 }
    const result = evaluatePoint(scene, settings, [12, 2.5, 1.5])
    const breakdown = buildLossBreakdown(scene, settings, result)

    expect(breakdown.available).toBe(true)
    expect(breakdown.unit).toBe('dB')
    expect(breakdown.terms[0]).toMatchObject({ kind: 'reference', contributionDb: 0 })
    expect(breakdown.terms[1]).toMatchObject({ kind: 'distance', contributionDb: -20 * Math.log10(result.distanceM / 2) })
    expect(breakdown.terms.some(term => term.kind === 'crossing' && term.crossing?.hit)).toBe(true)
    expect(breakdown.terms.reduce((sum, term) => sum + term.contributionDb, 0)).toBeCloseTo(result.value!, 9)
    expect(Math.abs(breakdown.residualDb!)).toBeLessThanOrEqual(LOSS_BREAKDOWN_TOLERANCE_DB)
    expect(breakdown.terms.some(term => term.detail.includes('fixture assumed'))).toBe(true)
  })

  it('uses radio EIRP, receiver gain, FSPL, other loss, and frequency-specific material loss', () => {
    const scene = createDemoScene()
    const settings = { ...defaultSettings('radio'), receiverGainDbi: -2.5, otherLossDb: -3 }
    const result = evaluatePoint(scene, settings, [12, 2.5, 1.5])
    const breakdown = buildLossBreakdown(scene, settings, result)

    expect(breakdown.available).toBe(true)
    expect(breakdown.unit).toBe('dBm')
    expect(breakdown.terms).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source', contributionDb: 18 }),
      expect.objectContaining({ kind: 'gain', contributionDb: -2.5 }),
      expect.objectContaining({ kind: 'other', contributionDb: 3 }),
    ]))
    expect(breakdown.terms.find(term => term.kind === 'distance')?.contributionDb).toBeCloseTo(-20 * Math.log10(4 * Math.PI * result.distanceM * settings.frequencyHz / 299792458), 12)
    expect(breakdown.terms.reduce((sum, term) => sum + term.contributionDb, 0)).toBeCloseTo(result.value!, 9)
    expect(breakdown.terms.find(term => term.kind === 'crossing')?.detail).toContain('2.4 GHz')
  })

  it('retains exact crossing hits and reports open and closed doors distinctly', () => {
    const closedScene = createDemoScene()
    const settings = defaultSettings('acoustics')
    const point: [number, number, number] = [12, 2.5, 1.5]
    const closed = evaluatePoint(closedScene, settings, point)
    const closedBreakdown = buildLossBreakdown(closedScene, settings, closed)
    expect(closedBreakdown.available).toBe(true)
    const closedTerm = closedBreakdown.terms.find(term => term.kind === 'crossing')!
    expect(closedTerm.crossing).toEqual(closed.crossings[0])
    expect(closedTerm.label).toContain('Demo closed interior door')
    expect(closedTerm.contributionDb).toBeLessThan(0)

    const openScene: Scene = structuredClone(closedScene)
    openScene.openings[0]!.isOpen = true
    const open = evaluatePoint(openScene, settings, point)
    const openBreakdown = buildLossBreakdown(openScene, settings, open)
    expect(openBreakdown.available).toBe(true)
    expect(openBreakdown.terms.find(term => term.kind === 'crossing')).toMatchObject({ contributionDb: 0, detail: expect.stringContaining('Open door') })
  })

  it('preserves signed coefficients and describes disabled transmission without implying measured loss', () => {
    const scene = createDemoScene()
    scene.materials.find(material => material.id === 'door-leaf')!.acousticTransmissionDb[0]!.valueDb = -2
    const settings = defaultSettings('acoustics')
    const point: [number, number, number] = [12, 2.5, 1.5]
    const result = evaluatePoint(scene, settings, point)
    const breakdown = buildLossBreakdown(scene, settings, result)
    expect(breakdown.available).toBe(true)
    expect(breakdown.terms.find(term => term.kind === 'crossing')).toMatchObject({
      contributionDb: 2,
      detail: expect.stringContaining('configured coefficient -2.0 dB yields +2.0 dB contribution'),
    })

    const disabledSettings = { ...settings, transmissionEnabled: false }
    const disabledResult = evaluatePoint(scene, disabledSettings, point)
    const disabledBreakdown = buildLossBreakdown(scene, disabledSettings, disabledResult)
    expect(disabledBreakdown.available).toBe(true)
    expect(disabledBreakdown.terms.find(term => term.kind === 'crossing')).toMatchObject({
      contributionDb: 0,
      detail: expect.stringContaining('Sound transmission disabled'),
    })
  })

  it('lists each crossing separately for a path through multiple walls', () => {
    const scene = createDemoScene()
    scene.walls = scene.walls.filter(wall => wall.id !== 'hall-partition')
    scene.openings = []
    scene.walls.push(
      { id: 'test-wall-a', levelId: 'main', start: [5, 2], end: [5, 9], thicknessM: .12, baseZ: 0, heightM: 2.7, materialId: 'partition' },
      { id: 'test-wall-b', levelId: 'main', start: [9, 2], end: [9, 9], thicknessM: .12, baseZ: 0, heightM: 2.7, materialId: 'masonry' },
    )
    const result = evaluatePoint(scene, defaultSettings('acoustics'), [12, 8, 1.2])
    const breakdown = buildLossBreakdown(scene, defaultSettings('acoustics'), result)
    expect(result.valid).toBe(true)
    expect(breakdown.available).toBe(true)
    expect(breakdown.terms.filter(term => term.kind === 'crossing')).toHaveLength(2)
    expect(breakdown.terms.filter(term => term.kind === 'crossing').map(term => term.crossing?.wallId)).toEqual(expect.arrayContaining(['test-wall-a', 'test-wall-b']))
  })

  it('returns explicit unavailable states for absent, invalid, stale, and missing-parameter results', () => {
    const scene = createDemoScene()
    const settings = defaultSettings('acoustics')
    expect(buildLossBreakdown(scene, settings, null)).toMatchObject({ available: false, reason: expect.any(String), terms: [] })
    const invalid = evaluatePoint(scene, settings, [2.1, 7.8, 1.2])
    expect(buildLossBreakdown(scene, settings, invalid)).toMatchObject({ available: false, reason: expect.stringContaining('invalid') })
    const valid = evaluatePoint(scene, settings, [12, 2.5, 1.5])
    expect(buildLossBreakdown(scene, { ...settings, referenceDistanceM: 2 }, valid)).toMatchObject({ available: false, reason: expect.stringContaining('older scene') })
    const malformed = { ...valid, crossings: null } as unknown as typeof valid
    expect(buildLossBreakdown(scene, settings, malformed)).toMatchObject({ available: false, reason: expect.stringContaining('details'), terms: [] })
    const missingProvenance = { ...valid, assumptions: [{ ...valid.assumptions[0], provenance: undefined }] } as unknown as typeof valid
    expect(buildLossBreakdown(scene, settings, missingProvenance)).toMatchObject({ available: false, reason: expect.stringContaining('details'), terms: [] })

    scene.materials.find(material => material.id === 'door-leaf')!.acousticTransmissionDb = []
    const missing = evaluatePoint(scene, settings, [12, 2.5, 1.5])
    expect(buildLossBreakdown(scene, settings, missing)).toMatchObject({ available: false, reason: expect.any(String) })
  })
})
