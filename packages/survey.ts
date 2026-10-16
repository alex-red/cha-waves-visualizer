import { z } from 'zod'
import { evaluatePoints, type Scene, type SolverSettings } from './engine'

const idSchema = z.string().min(1).max(128)
const pointSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const observationSchema = z.object({
  id: z.string().min(1).max(80), label: z.string().max(80), position: pointSchema, rssiDbm: z.number().finite(),
}).strict()

export const SurveySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(2000),
  createdAt: z.iso.datetime(),
  context: z.object({
    sceneId: idSchema, levelId: idSchema, frequencyHz: z.number().positive().finite(), sourceId: idSchema,
    sourcePosition: pointSchema, eirpDbm: z.number().finite(),
  }).strict(),
  observations: z.array(observationSchema).min(1).max(500),
}).strict().superRefine((survey, ctx) => {
  const ids = new Set<string>()
  survey.observations.forEach((observation, index) => {
    if (ids.has(observation.id)) ctx.addIssue({ code: 'custom', path: ['observations', index, 'id'], message: `Duplicate observation id: ${observation.id}` })
    ids.add(observation.id)
  })
})

export type RfSurvey = z.infer<typeof SurveySchema>
export type SurveyMetadata = Pick<RfSurvey, 'id' | 'name' | 'notes' | 'createdAt'>

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** Parse and deeply freeze an RF survey at an untrusted-data boundary. */
export function validateSurvey(value: unknown): RfSurvey { return deepFreeze(SurveySchema.parse(value)) }

const csvHeaders = [
  'id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id',
  'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm',
] as const

type CsvRecord = string[]

function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let record: string[] = [], cell = '', quoted = false, afterQuote = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++ }
        else { quoted = false; afterQuote = true }
      } else cell += char
      continue
    }
    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n') throw new Error('Malformed CSV: unexpected character after a quoted field.')
    if (char === '"') {
      if (cell.length || afterQuote) throw new Error('Malformed CSV: quote inside an unquoted field.')
      quoted = true
    } else if (char === ',') {
      record.push(cell); cell = ''; afterQuote = false
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++
      record.push(cell); records.push(record); record = []; cell = ''; afterQuote = false
    } else cell += char
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field.')
  if (record.length || cell.length || afterQuote) { record.push(cell); records.push(record) }
  return records
}

function finiteNumber(cell: string, field: string, row: number): number {
  const text = cell.trim()
  if (!text) throw new Error(`CSV row ${row}: ${field} must not be blank.`)
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(text)) throw new Error(`CSV row ${row}: ${field} must be a decimal or scientific-notation number.`)
  const value = Number(text)
  if (!Number.isFinite(value)) throw new Error(`CSV row ${row}: ${field} must be finite.`)
  return value
}

/** Parse a bounded UTF-8 CSV export. Every data row must carry the same survey context. */
export function parseSurveyCsv(text: string, metadata: SurveyMetadata): RfSurvey {
  if (new TextEncoder().encode(text).byteLength > 1_048_576) throw new Error('Survey CSV exceeds the 1 MiB limit.')
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ''))
  if (!records.length) throw new Error('Survey CSV is empty.')
  const headers = records[0]!
  if (new Set(headers).size !== headers.length) throw new Error('Survey CSV contains duplicate headers.')
  if (headers.length !== csvHeaders.length || headers.some((header, index) => header !== csvHeaders[index])) throw new Error('Survey CSV headers do not match the required survey format.')
  const observations: RfSurvey['observations'] = []
  let context: RfSurvey['context'] | undefined
  for (let index = 1; index < records.length; index++) {
    const cells = records[index]!, rowNumber = index + 1
    if (observations.length >= 500) throw new Error('Survey CSV exceeds the 500 observation limit.')
    if (cells.length !== csvHeaders.length) throw new Error(`CSV row ${rowNumber} has ${cells.length} columns; expected ${csvHeaders.length}.`)
    for (const column of [0, 1, 7, 8, 9]) cells[column] = decodeTextCell(cells[column]!)
    const rowContext = {
      frequencyHz: finiteNumber(cells[6]!, 'frequency_hz', rowNumber), sceneId: cells[7]!, levelId: cells[8]!, sourceId: cells[9]!,
      sourcePosition: [finiteNumber(cells[10]!, 'source_x_m', rowNumber), finiteNumber(cells[11]!, 'source_y_m', rowNumber), finiteNumber(cells[12]!, 'source_z_m', rowNumber)] as [number, number, number],
      eirpDbm: finiteNumber(cells[13]!, 'eirp_dbm', rowNumber),
    }
    if (!(rowContext.frequencyHz > 0)) throw new Error(`CSV row ${rowNumber}: frequency_hz must be positive.`)
    if (context && JSON.stringify(context) !== JSON.stringify(rowContext)) throw new Error(`CSV row ${rowNumber} does not match the survey context in the first data row.`)
    context ??= rowContext
    observations.push({
      id: cells[0]!, label: cells[1]!,
      position: [finiteNumber(cells[2]!, 'x_m', rowNumber), finiteNumber(cells[3]!, 'y_m', rowNumber), finiteNumber(cells[4]!, 'z_m', rowNumber)],
      rssiDbm: finiteNumber(cells[5]!, 'rssi_dbm', rowNumber),
    })
  }
  if (!context) throw new Error('Survey CSV must contain at least one data row.')
  return validateSurvey({ ...metadata, context, observations })
}

function needsTextEscape(text: string): boolean {
  return /^(?:'|[\t\r\n]|\s*[=+\-@])/.test(text)
}

function decodeTextCell(text: string): string {
  return text.startsWith("'") && needsTextEscape(text.slice(1)) ? text.slice(1) : text
}

function quoteCell(value: unknown, formulaSafeText = false): string {
  let text = value === undefined || value === null ? '' : String(value)
  if (formulaSafeText && needsTextEscape(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function csvRows(rows: readonly (readonly unknown[])[], textColumns: ReadonlySet<number>): string {
  return rows.map(row => row.map((value, index) => quoteCell(value, textColumns.has(index))).join(',')).join('\r\n')
}

/** Export a blank measurement template for the active radio source and current probes. */
export function exportSurveyTemplate(scene: Scene, settings: SolverSettings): string {
  const source = scene.emitters.find(emitter => emitter.domain === 'radio' && emitter.active)
  if (settings.mode !== 'radio' || !source || source.eirpDbm === undefined) throw new Error('A radio solver and active radio source with EIRP are required for a survey template.')
  const probes = scene.probes.length ? scene.probes : [{ id: '', name: '', position: ['', '', ''] as unknown as [number, number, number] }]
  const rows = probes.map(probe => [
    probe.id, probe.name ?? probe.id, ...probe.position, '', settings.frequencyHz, scene.id, source.levelId,
    source.id, ...source.position, source.eirpDbm,
  ])
  return csvRows([csvHeaders, ...rows], new Set([0, 1, 7, 8, 9]))
}

/** Export the survey's original observations, keeping signed numeric fields numeric. */
export function exportSurveyCsv(surveyInput: RfSurvey): string {
  const survey = SurveySchema.parse(surveyInput), context = survey.context
  const rows = survey.observations.map(observation => [
    observation.id, observation.label, ...observation.position, observation.rssiDbm,
    context.frequencyHz, context.sceneId, context.levelId, context.sourceId, ...context.sourcePosition, context.eirpDbm,
  ])
  return csvRows([csvHeaders, ...rows], new Set([0, 1, 7, 8, 9]))
}

export type SurveyComparisonRow = {
  id: string; label: string; position: [number, number, number]; measuredDbm: number
  predictedDbm?: number; residualDb?: number; valid: boolean; reason?: string
}
export type SurveyComparison = {
  compatible: boolean; incompatibilities: string[]; rows: SurveyComparisonRow[]
  summary: { totalCount: number; validCount: number; excludedCount: number; biasDb: number | null; maeDb: number | null; rmseDb: number | null }
}

function robustMean(values: readonly number[]): number | null {
  if (!values.length) return null
  const scale = Math.max(...values.map(Math.abs))
  if (scale === 0) return 0
  return scale * (values.reduce((sum, value) => sum + value / scale, 0) / values.length)
}

function metrics(residuals: readonly number[]) {
  if (!residuals.length) return { biasDb: null, maeDb: null, rmseDb: null }
  const scale = Math.max(...residuals.map(Math.abs))
  if (scale === 0) return { biasDb: 0, maeDb: 0, rmseDb: 0 }
  const normalized = residuals.map(value => value / scale)
  return {
    biasDb: robustMean(residuals),
    maeDb: scale * (normalized.reduce((sum, value) => sum + Math.abs(value), 0) / normalized.length),
    rmseDb: scale * Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0) / normalized.length),
  }
}

/** Compare field estimates with measured RSSI. Residuals are predicted minus measured. */
export function compareSurvey(scene: Scene, settings: SolverSettings, surveyInput: RfSurvey): SurveyComparison {
  const survey = SurveySchema.parse(surveyInput), context = survey.context
  const source = scene.emitters.find(emitter => emitter.domain === 'radio' && emitter.active)
  const incompatibilities: string[] = []
  if (settings.mode !== 'radio') incompatibilities.push('Current solver mode is not radio.')
  if (scene.id !== context.sceneId) incompatibilities.push('Scene ID does not match the survey.')
  if (scene.levels[0]?.id !== context.levelId) incompatibilities.push('Level ID does not match the survey.')
  if (!source) incompatibilities.push('There is no active radio source in the current scene.')
  else {
    if (source.id !== context.sourceId) incompatibilities.push('Active source ID does not match the survey.')
    if (source.levelId !== context.levelId) incompatibilities.push('Active source level does not match the survey.')
    if (source.position.some((value, index) => value !== context.sourcePosition[index])) incompatibilities.push('Active source position does not match the survey.')
    if (source.eirpDbm !== context.eirpDbm) incompatibilities.push('Active source EIRP does not match the survey.')
  }
  if (settings.frequencyHz !== context.frequencyHz) incompatibilities.push('Frequency does not match the survey.')

  let compatible = incompatibilities.length === 0
  let estimates: ReturnType<typeof evaluatePoints> = []
  if (compatible) {
    try { estimates = evaluatePoints(scene, settings, survey.observations.map(observation => observation.position)) }
    catch (error) {
      incompatibilities.push(error instanceof Error ? error.message : 'The current model could not be evaluated.')
      compatible = false
    }
  }
  const evaluable = compatible && estimates.length === survey.observations.length
  const rows: SurveyComparisonRow[] = survey.observations.map((observation, index) => {
    const base = { id: observation.id, label: observation.label, position: [...observation.position] as [number, number, number], measuredDbm: observation.rssiDbm }
    if (!evaluable) return { ...base, valid: false, reason: incompatibilities.join(' ') || 'The current model could not be evaluated.' }
    const estimate = estimates[index]!
    if (!estimate.valid || estimate.value === undefined || !Number.isFinite(estimate.value)) {
      return { ...base, valid: false, reason: estimate.reason ? `Model estimate excluded: ${estimate.reason}.` : 'Model estimate is invalid or non-finite.' }
    }
    const residualDb = estimate.value - observation.rssiDbm
    if (!Number.isFinite(residualDb)) return { ...base, valid: false, reason: 'Residual is non-finite and was excluded.' }
    return { ...base, predictedDbm: estimate.value, residualDb, valid: true }
  })
  const residuals = rows.flatMap(row => row.valid && row.residualDb !== undefined ? [row.residualDb] : [])
  return { compatible, incompatibilities, rows, summary: { totalCount: rows.length, validCount: residuals.length, excludedCount: rows.length - residuals.length, ...metrics(residuals) } }
}
