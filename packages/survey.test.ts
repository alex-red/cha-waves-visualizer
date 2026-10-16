import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings, evaluatePoint } from './engine'
import {
  compareSurvey,
  exportSurveyCsv,
  exportSurveyTemplate,
  parseSurveyCsv,
  validateSurvey,
  type RfSurvey,
} from './survey'

const metadata = { id: 'survey-1', name: 'Office walk', notes: '', createdAt: '2026-10-15T12:00:00.000Z' }
const scene = createDemoScene()
const settings = defaultSettings('radio')
const source = scene.emitters.find(emitter => emitter.domain === 'radio')!
const context = {
  sceneId: scene.id,
  levelId: source.levelId,
  frequencyHz: settings.frequencyHz,
  sourceId: source.id,
  sourcePosition: [...source.position] as [number, number, number],
  eirpDbm: source.eirpDbm!,
}

function surveyWith(observations: RfSurvey['observations']): RfSurvey {
  return validateSurvey({ ...metadata, context, observations })
}

function csvRow(overrides: Partial<Record<string, string>> = {}) {
  const cells = [
    'reading-1', 'Kitchen', '3', '7', '1.5', '-48', String(context.frequencyHz), context.sceneId,
    context.levelId, context.sourceId, ...context.sourcePosition.map(String), String(context.eirpDbm),
  ]
  const headers = ['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm']
  return cells.map((value, index) => overrides[headers[index]!] ?? value)
}

function csv(rows: string[][], lineEnding = '\r\n') {
  return rows.map(row => row.join(',')).join(lineEnding)
}

describe('RF survey CSV', () => {
  it('parses the exact fourteen-column format with a BOM, CRLF, and quoted commas, quotes, and newlines', () => {
    const row = csvRow({ label: '"North, ""quiet"" wing\r\nsecond floor"' })
    const text = `\uFEFF${csv([[
      'id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm',
    ], row])}`
    const parsed = parseSurveyCsv(text, metadata)
    expect(parsed.context).toEqual(context)
    expect(parsed.observations).toEqual([{ id: 'reading-1', label: 'North, "quiet" wing\r\nsecond floor', position: [3, 7, 1.5], rssiDbm: -48 }])
  })

  it.each([
    ['blank numeric cells', csv([['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow({ rssi_dbm: '' })])],
    ['infinite numeric cells', csv([['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow({ rssi_dbm: 'Infinity' })])],
    ['hexadecimal numeric cells', csv([['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow({ x_m: '0x10' })])],
    ['binary numeric cells', csv([['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow({ rssi_dbm: '0b101' })])],
    ['malformed quotes', 'id,label,x_m,y_m,z_m,rssi_dbm,frequency_hz,scene_id,level_id,source_id,source_x_m,source_y_m,source_z_m,eirp_dbm\r\nr1,"bad quote,x,1,2,-40,2400000000,scene,main,ap,2,7,1,18'],
    ['reordered headers', csv([['label', 'id', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow()])],
    ['extra columns', csv([['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], [...csvRow(), 'extra']])],
    ['truncated rows', csv([['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow().slice(0, 13)])],
    ['duplicate headers', csv([['id', 'id', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm'], csvRow()])],
  ])('rejects %s', (_description, text) => {
    expect(() => parseSurveyCsv(text, metadata)).toThrow()
  })

  it('rejects data rows with mixed capture context', () => {
    const headers = ['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm']
    const first = csvRow()
    const second = csvRow({ source_x_m: '2.5' })
    expect(() => parseSurveyCsv(csv([headers, first, second]), metadata)).toThrow(/context/)
  })

  it('accepts decimal and scientific notation for numeric cells', () => {
    const headers = ['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm']
    const parsed = parseSurveyCsv(csv([headers, csvRow({
      x_m: '1.25', y_m: '-3e-1', z_m: '1e0', rssi_dbm: '-4.8e1', frequency_hz: '2.4e9',
      source_x_m: '2e0', source_y_m: '7.8', source_z_m: '1.2e0', eirp_dbm: '1.8e1',
    })]), metadata)
    expect(parsed.observations[0]).toMatchObject({ position: [1.25, -0.3, 1], rssiDbm: -48 })
    expect(parsed.context).toMatchObject({ frequencyHz: 2.4e9, sourcePosition: [2, 7.8, 1.2], eirpDbm: 18 })
  })

  it('enforces the 500-row and 1 MiB input limits', () => {
    const headers = ['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm']
    const rows = Array.from({ length: 501 }, (_, index) => [String(index), ...csvRow(index === 500 ? { rssi_dbm: 'Infinity' } : {}).slice(1)])
    expect(() => parseSurveyCsv(csv([headers, ...rows]), metadata)).toThrow(/500/)
    expect(() => parseSurveyCsv('x'.repeat(1_048_577), metadata)).toThrow(/1 MiB/)
  })

  it('validates finite measurements and unique observation IDs, then freezes the parsed data', () => {
    const duplicate = [
      { id: 'same', label: 'A', position: [1, 2, 1] as [number, number, number], rssiDbm: -50 },
      { id: 'same', label: 'B', position: [2, 3, 1] as [number, number, number], rssiDbm: -49 },
    ]
    expect(() => surveyWith(duplicate)).toThrow(/Duplicate observation id/)
    expect(() => surveyWith([{ id: 'bad', label: '', position: [1, Infinity, 1], rssiDbm: Number.NaN }])).toThrow()
    const accepted = surveyWith([{ id: 'one', label: 'Hall', position: [3, 7, 1.5], rssiDbm: -48 }])
    expect(Object.isFrozen(accepted)).toBe(true)
    expect(Object.isFrozen(accepted.context.sourcePosition)).toBe(true)
    expect(Object.isFrozen(accepted.observations)).toBe(true)
    expect(Object.isFrozen(accepted.observations[0])).toBe(true)
    expect(Object.isFrozen(accepted.observations[0]!.position)).toBe(true)
  })

  it('round trips survey CSV, keeps blank template RSSI blank, and protects formula-like text cells', () => {
    const value = surveyWith([{ id: '=2+2', label: '@receiver', position: [3, 7, 1.5], rssiDbm: -48 }])
    const serialized = exportSurveyCsv(value)
    expect(serialized).toContain("\"'=2+2\"")
    expect(serialized).toContain("\"'@receiver\"")
    const imported = parseSurveyCsv(serialized, metadata)
    expect(imported.observations[0]?.rssiDbm).toBe(-48)
    expect(imported.observations[0]?.id).toBe('=2+2')

    const template = exportSurveyTemplate(scene, settings)
    const dataLine = template.split('\r\n')[1]!
    expect(dataLine.split(',')[5]).toBe('""')
    expect(() => parseSurveyCsv(template, metadata)).toThrow(/must not be blank/)
  })

  it('reversibly escapes formula-like text across observation IDs, labels, and context strings', () => {
    const strings = ['=id', '+id', '-id', '@id', ' =id', ' \t=id', '\u00a0=id', '\n=id', '\t=id', '\r=id', "'plain", "'=id"]
    const specialContext = { ...context, sceneId: ' =scene', levelId: '\nlevel', sourceId: "'source" }
    const original = validateSurvey({
      ...metadata,
      context: specialContext,
      observations: strings.map((id, index) => ({
        id,
        label: strings[(index + 3) % strings.length]!,
        position: [index, 2, 1],
        rssiDbm: -20 - index,
      })),
    })
    const escaped = exportSurveyCsv(original)
    expect(escaped).toContain("\"' \t=id\"")
    expect(escaped).toContain("\"'\u00a0=id\"")
    const roundTrip = parseSurveyCsv(escaped, metadata)
    expect(roundTrip.context).toEqual(specialContext)
    expect(roundTrip.observations.map(({ id, label }) => [id, label])).toEqual(original.observations.map(({ id, label }) => [id, label]))
    expect(roundTrip.observations.map(observation => observation.rssiDbm)).toEqual(original.observations.map(observation => observation.rssiDbm))
  })

  it('keeps signed numeric fields numeric in the CSV representation', () => {
    const value = validateSurvey({
      ...metadata,
      context: { ...context, sourcePosition: [-2, -7.8, -1.2], eirpDbm: -18 },
      observations: [{ id: 'negative', label: 'Negative values', position: [-3, -7, -1.5], rssiDbm: -48 }],
    })
    const text = exportSurveyCsv(value)
    expect(text).toContain('"-3","-7","-1.5","-48"')
    expect(text).toContain('"-2","-7.8","-1.2","-18"')
    expect(text).not.toContain("' -48")
  })
})

describe('compareSurvey', () => {
  it('compares the solver at every measurement coordinate and reports hand-computed residual metrics', () => {
    const positions: [number, number, number][] = [[3, 7, 1.5], [10, 7, 1.5], [12, 2.5, 1.5]]
    const residuals = [2, -1, 4]
    const observations = positions.map((position, index) => {
      const independent = evaluatePoint(scene, settings, position)
      expect(independent.valid).toBe(true)
      return { id: `p${index}`, label: `Point ${index}`, position, rssiDbm: independent.value! - residuals[index]! }
    })
    const result = compareSurvey(scene, settings, surveyWith(observations))
    expect(result.compatible).toBe(true)
    expect(result.rows.map(row => row.predictedDbm)).toEqual(positions.map(position => evaluatePoint(scene, settings, position).value))
    expect(result.rows.map(row => row.residualDb)).toEqual(residuals)
    expect(result.summary).toEqual({ totalCount: 3, validCount: 3, excludedCount: 0, biasDb: 5 / 3, maeDb: 7 / 3, rmseDb: Math.sqrt(7) })
  })

  it('excludes invalid model locations from metrics instead of treating them as zero', () => {
    const observations: RfSurvey['observations'] = [
      { id: 'valid', label: 'Open area', position: [3, 7, 1.5], rssiDbm: -50 },
      { id: 'outside', label: 'Outside', position: [-1, 7, 1.5], rssiDbm: -50 },
      { id: 'wall', label: 'Inside partition', position: [6, 5, 1.5], rssiDbm: -50 },
    ]
    const result = compareSurvey(scene, settings, surveyWith(observations))
    expect(result.rows[0]?.valid).toBe(true)
    expect(result.rows[1]?.valid).toBe(false)
    expect(result.rows[2]?.valid).toBe(false)
    expect(result.summary).toMatchObject({ totalCount: 3, validCount: 1, excludedCount: 2 })
    expect(result.summary.biasDb).toBe(result.rows[0]?.residualDb)
    expect(result.summary.maeDb).toBe(result.rows[0]?.residualDb && Math.abs(result.rows[0].residualDb!))
  })

  it.each([
    ['scene ID', (copy: typeof scene) => { copy.id = 'other-scene' }],
    ['source ID', (copy: typeof scene) => { copy.emitters.find(item => item.domain === 'radio')!.id = 'different-ap' }],
    ['source position', (copy: typeof scene) => { copy.emitters.find(item => item.domain === 'radio')!.position = [2.1, 7.8, 1.2] }],
    ['source EIRP', (copy: typeof scene) => { copy.emitters.find(item => item.domain === 'radio')!.eirpDbm! += 1 }],
  ])('marks a changed %s incompatible with no fabricated scores', (_label, mutate) => {
    const changed = structuredClone(scene)
    mutate(changed)
    const survey = surveyWith([{ id: 'r1', label: 'Point', position: [3, 7, 1.5], rssiDbm: -48 }])
    const result = compareSurvey(changed, settings, survey)
    expect(result.compatible).toBe(false)
    expect(result.rows[0]).toMatchObject({ valid: false })
    expect(result.rows[0]?.predictedDbm).toBeUndefined()
    expect(result.rows[0]?.residualDb).toBeUndefined()
    expect(result.summary).toEqual({ totalCount: 1, validCount: 0, excludedCount: 1, biasDb: null, maeDb: null, rmseDb: null })
  })

  it('rejects mismatched radio band and solver domain without scores', () => {
    const survey = surveyWith([{ id: 'r1', label: 'Point', position: [3, 7, 1.5], rssiDbm: -48 }])
    for (const incompatibleSettings of [
      { ...settings, frequencyHz: 5e9 },
      defaultSettings('acoustics'),
    ]) {
      const result = compareSurvey(scene, incompatibleSettings, survey)
      expect(result.compatible).toBe(false)
      expect(result.summary.biasDb).toBeNull()
      expect(result.summary.maeDb).toBeNull()
      expect(result.summary.rmseDb).toBeNull()
      expect(result.rows.every(row => row.predictedDbm === undefined && row.residualDb === undefined)).toBe(true)
    }
  })

  it('marks the comparison incompatible when current solver settings make evaluation throw', () => {
    const survey = surveyWith([{ id: 'r1', label: 'Point', position: [3, 7, 1.5], rssiDbm: -48 }])
    const invalidSettings = [
      { ...settings, minValidDistanceM: Number.NaN },
      { ...settings, minValidDistanceM: -1 },
    ]
    for (const invalid of invalidSettings) {
      const result = compareSurvey(scene, invalid, survey)
      expect(result.compatible).toBe(false)
      expect(result.rows[0]).toMatchObject({ valid: false })
      expect(result.rows[0]?.predictedDbm).toBeUndefined()
      expect(result.rows[0]?.residualDb).toBeUndefined()
      expect(result.summary).toEqual({ totalCount: 1, validCount: 0, excludedCount: 1, biasDb: null, maeDb: null, rmseDb: null })
    }
  })

  it('reports null metrics when every otherwise compatible point is invalid', () => {
    const survey = surveyWith([
      { id: 'outside-a', label: 'Outside A', position: [-1, 7, 1.5], rssiDbm: -48 },
      { id: 'outside-b', label: 'Outside B', position: [15, 7, 1.5], rssiDbm: -42 },
    ])
    const result = compareSurvey(scene, settings, survey)
    expect(result.compatible).toBe(true)
    expect(result.summary).toEqual({ totalCount: 2, validCount: 0, excludedCount: 2, biasDb: null, maeDb: null, rmseDb: null })
  })

  it('excludes finite RSSI values whose residual would overflow and keeps aggregate metrics finite', () => {
    const extremeScene = structuredClone(scene)
    extremeScene.emitters.find(emitter => emitter.domain === 'radio')!.eirpDbm = Number.MAX_VALUE
    const extremeSource = extremeScene.emitters.find(emitter => emitter.domain === 'radio')!
    const extremeSurvey = validateSurvey({
      ...metadata,
      context: { ...context, sceneId: extremeScene.id, sourceId: extremeSource.id, sourcePosition: [...extremeSource.position], eirpDbm: Number.MAX_VALUE },
      observations: [{ id: 'extreme', label: 'Extreme receiver', position: [3, 7, 1.5], rssiDbm: -Number.MAX_VALUE }],
    })
    const result = compareSurvey(extremeScene, settings, extremeSurvey)
    expect(result.compatible).toBe(true)
    expect(result.rows[0]?.valid).toBe(false)
    expect(result.rows[0]?.residualDb).toBeUndefined()
    expect(result.summary).toEqual({ totalCount: 1, validCount: 0, excludedCount: 1, biasDb: null, maeDb: null, rmseDb: null })
  })

  it('preserves intentional prediction changes when the current geometry or material changes', () => {
    const position: [number, number, number] = [10, 2.5, 1.5]
    const baseline = evaluatePoint(scene, settings, position)
    const survey = surveyWith([{ id: 'r1', label: 'Across partition', position, rssiDbm: baseline.value! }])
    const current = structuredClone(scene)
    current.materials.find(material => material.id === 'partition')!.radioLossDb[0]!.valueDb += 8
    const changedPrediction = evaluatePoint(current, settings, position)
    const result = compareSurvey(current, settings, survey)
    expect(result.compatible).toBe(true)
    expect(result.rows[0]?.predictedDbm).toBe(changedPrediction.value)
    expect(result.rows[0]?.predictedDbm).not.toBe(baseline.value)
  })
})
