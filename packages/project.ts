import { z } from 'zod'
import { SurveySchema, type RfSurvey } from './survey'
import { FloorPlanReferenceSchema, type FloorPlanReference } from './floorplan'
export type { FloorPlanReference } from './floorplan'
import { SceneSchema, SOLVER_VERSION, validatePlacement, validateWallGeometry, type Scene, type SolverSettings } from './engine'

export const PROJECT_FORMAT = 'cha-waves-project' as const
export const PROJECT_FORMAT_VERSION = 3 as const
export const PROJECT_MAX_BYTES = 5 * 1024 * 1024
export const PROJECT_MAX_DEPTH = 32
export const MAX_PROJECT_EXPERIMENTS = 20
const PROJECT_MAX_NODES = 100_000
const PROJECT_MAX_ARRAY_LENGTH = 10_000

const settingsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('acoustics'), frequencyHz: z.number().positive().finite(), referenceDistanceM: z.number().positive().finite(), minValidDistanceM: z.number().positive().finite(), speedOfSoundMps: z.number().positive().finite(), transmissionEnabled: z.boolean() }).strict(),
  z.object({ mode: z.literal('radio'), frequencyHz: z.number().positive().finite(), receiverGainDbi: z.number().finite(), minValidDistanceM: z.number().positive().finite(), otherLossDb: z.number().finite() }).strict(),
])
const metadataSchema = z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(256), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict()
const baselineSchema = z.object({ scene: SceneSchema, settings: settingsSchema, solverVersion: z.string().min(1) }).strict()
const experimentSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(2000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  scene: SceneSchema,
  settings: settingsSchema,
  solverVersion: z.string().min(1),
  referenceImage: FloorPlanReferenceSchema.optional(),
}).strict()
const currentV1Schema = z.object({
  format: z.literal(PROJECT_FORMAT), formatVersion: z.literal(1), solverVersion: z.string().min(1), metadata: metadataSchema,
  scene: SceneSchema, settings: settingsSchema, baseline: baselineSchema.optional(), referenceImage: FloorPlanReferenceSchema.optional(),
}).strict()
const currentV2Schema = z.object({
  format: z.literal(PROJECT_FORMAT), formatVersion: z.literal(2), solverVersion: z.string().min(1), metadata: metadataSchema,
  scene: SceneSchema, settings: settingsSchema, baseline: baselineSchema.optional(), referenceImage: FloorPlanReferenceSchema.optional(),
  experiments: z.array(experimentSchema).max(MAX_PROJECT_EXPERIMENTS).default([]), baselineExperimentId: z.string().trim().min(1).max(128).optional(),
}).strict()

const documentSchema = currentV2Schema.extend({ formatVersion: z.literal(PROJECT_FORMAT_VERSION), survey: SurveySchema.optional() }).strict()

export type ProjectSettings = SolverSettings
export type ProjectScene = Scene
export type BaselineSnapshot = Readonly<{ scene: Readonly<Scene>; settings: Readonly<SolverSettings>; solverVersion: string }>
export type ProjectBaseline = BaselineSnapshot
export type ProjectMetadata = Readonly<{ id: string; name: string; createdAt: string; updatedAt: string }>
export type ProjectExperiment = Readonly<{
  id: string; name: string; notes: string; createdAt: string; updatedAt: string
  scene: Readonly<Scene>; settings: Readonly<SolverSettings>; solverVersion: string; referenceImage?: FloorPlanReference
}>
export type ProjectDocument = Readonly<{
  format: typeof PROJECT_FORMAT; formatVersion: typeof PROJECT_FORMAT_VERSION; solverVersion: string; metadata: ProjectMetadata
  scene: Readonly<Scene>; settings: Readonly<SolverSettings>; baseline?: ProjectBaseline; referenceImage?: FloorPlanReference
  experiments: readonly ProjectExperiment[]; baselineExperimentId?: string; survey?: RfSurvey
}>

export class ProjectError extends Error {
  constructor(public readonly code: 'INVALID_PROJECT' | 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_VERSION' | 'PROJECT_TOO_LARGE' | 'STORAGE_UNAVAILABLE' | 'STORAGE_FAILED', message: string, public readonly path: readonly (string | number)[] = []) {
    super(message); this.name = 'ProjectError'
  }
}

type BaselineInput = { scene: Scene; settings: SolverSettings }
export type CreateProjectExtras = { experiments?: readonly ProjectExperiment[]; baselineExperimentId?: string; survey?: RfSurvey }

export function createProject(scene: Scene, settings: SolverSettings, baseline?: BaselineInput, referenceImage?: FloorPlanReference, extras: CreateProjectExtras = {}): ProjectDocument {
  const now = new Date().toISOString()
  const metadata = { id: makeId(), name: scene.id, createdAt: now, updatedAt: now }
  return validateDocument({
    format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION, solverVersion: SOLVER_VERSION, metadata, scene, settings,
    ...(referenceImage ? { referenceImage } : {}),
    ...(baseline ? { baseline: { scene: baseline.scene, settings: baseline.settings, solverVersion: SOLVER_VERSION } } : {}),
    experiments: extras.experiments ?? [], ...(extras.baselineExperimentId !== undefined ? { baselineExperimentId: extras.baselineExperimentId } : {}),
    ...(extras.survey ? { survey: extras.survey } : {}),
  })
}

export function serializeProject(doc: ProjectDocument): string {
  const checked = validateDocument(doc); const text = JSON.stringify(checked)
  if (utf8Size(text) > PROJECT_MAX_BYTES) throw new ProjectError('PROJECT_TOO_LARGE', `Project JSON exceeds the ${PROJECT_MAX_BYTES}-byte limit`)
  return text
}

export function parseProject(text: string): ProjectDocument {
  if (typeof text !== 'string') throw new ProjectError('INVALID_PROJECT', 'Project input must be JSON text')
  if (utf8Size(text) > PROJECT_MAX_BYTES) throw new ProjectError('PROJECT_TOO_LARGE', `Project JSON exceeds the ${PROJECT_MAX_BYTES}-byte limit`)
  let value: unknown
  try { value = JSON.parse(text) as unknown } catch (error) { throw new ProjectError('INVALID_PROJECT', `Invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`) }
  inspectJson(value)
  return validateDocument(value)
}

export function validateProjectDocument(value: unknown): ProjectDocument { return validateDocument(value) }

export function validateProjectExperiment(value: unknown): ProjectExperiment {
  inspectJson(value)
  const parsed = experimentSchema.safeParse(value)
  if (!parsed.success) { const issue = parsed.error.issues[0]!; throw new ProjectError('INVALID_PROJECT', issue.message, issue.path as (string | number)[]) }
  if (parsed.data.solverVersion !== SOLVER_VERSION) throw new ProjectError('UNSUPPORTED_VERSION', `Unsupported solver version: ${parsed.data.solverVersion}`, ['solverVersion'])
  validateSceneSolids(parsed.data.scene, ['scene'])
  if (utf8Size(JSON.stringify(parsed.data)) > PROJECT_MAX_BYTES) throw new ProjectError('PROJECT_TOO_LARGE', `Project JSON exceeds the ${PROJECT_MAX_BYTES}-byte limit`)
  return freezeDeep(parsed.data) as ProjectExperiment
}

function validateDocument(value: unknown): ProjectDocument {
  inspectJson(value)
  const format = isRecord(value) ? value.format : undefined
  if (format !== PROJECT_FORMAT) throw new ProjectError('UNSUPPORTED_FORMAT', `Expected format "${PROJECT_FORMAT}"`, ['format'])
  const version = isRecord(value) ? value.formatVersion : undefined
  if (version === 1) return migrateV1(value)
  if (version === 2) return migrateV2(value)
  if (version !== PROJECT_FORMAT_VERSION) throw new ProjectError('UNSUPPORTED_VERSION', `Unsupported project format version: ${String(version)}`, ['formatVersion'])
  if (isRecord(value) && value.solverVersion !== SOLVER_VERSION) throw new ProjectError('UNSUPPORTED_VERSION', `Unsupported solver version: ${String(value.solverVersion)}`, ['solverVersion'])
  const parsed = documentSchema.safeParse(value)
  if (!parsed.success) { const issue = parsed.error.issues[0]!; throw new ProjectError('INVALID_PROJECT', issue.message, issue.path as (string | number)[]) }
  validateSceneSolids(parsed.data.scene, ['scene'])
  if (parsed.data.baseline) {
    if (parsed.data.baseline.solverVersion !== SOLVER_VERSION) throw new ProjectError('UNSUPPORTED_VERSION', `Unsupported baseline solver version: ${parsed.data.baseline.solverVersion}`, ['baseline', 'solverVersion'])
    validateSceneSolids(parsed.data.baseline.scene, ['baseline', 'scene'])
  }
  validateExperiments(parsed.data.experiments as unknown as readonly ProjectExperiment[], parsed.data.baselineExperimentId, parsed.data.baseline as unknown as ProjectBaseline | undefined)
  const canonicalJson = JSON.stringify(parsed.data)
  if (utf8Size(canonicalJson) > PROJECT_MAX_BYTES) throw new ProjectError('PROJECT_TOO_LARGE', `Project JSON exceeds the ${PROJECT_MAX_BYTES}-byte limit`)
  return freezeDeep(parsed.data) as ProjectDocument
}

function migrateV1(value: unknown): ProjectDocument {
  if (!isRecord(value) || value.formatVersion !== 1) throw new ProjectError('INVALID_PROJECT', 'Invalid version 1 project')
  if (value.solverVersion !== SOLVER_VERSION) throw new ProjectError('UNSUPPORTED_VERSION', `Unsupported solver version: ${String(value.solverVersion)}`, ['solverVersion'])
  const parsed = currentV1Schema.safeParse(value)
  if (!parsed.success) { const issue = parsed.error.issues[0]!; throw new ProjectError('INVALID_PROJECT', issue.message, issue.path as (string | number)[]) }
  const old = parsed.data
  return validateDocument({ ...old, formatVersion: PROJECT_FORMAT_VERSION, experiments: [] })
}

function migrateV2(value: unknown): ProjectDocument {
  if (!isRecord(value) || value.formatVersion !== 2) throw new ProjectError('INVALID_PROJECT', 'Invalid version 2 project')
  const parsed = currentV2Schema.safeParse(value)
  if (!parsed.success) { const issue = parsed.error.issues[0]!; throw new ProjectError('INVALID_PROJECT', issue.message, issue.path as (string | number)[]) }
  return validateDocument({ ...parsed.data, formatVersion: PROJECT_FORMAT_VERSION })
}

function validateExperiments(experiments: readonly ProjectExperiment[], baselineId?: string, baselineSnapshot?: ProjectBaseline): void {
  if (experiments.length > MAX_PROJECT_EXPERIMENTS) throw new ProjectError('INVALID_PROJECT', `A project may contain at most ${MAX_PROJECT_EXPERIMENTS} experiments`, ['experiments'])
  const ids = new Set<string>(); const names = new Set<string>()
  for (const [i, experiment] of experiments.entries()) {
    if (ids.has(experiment.id)) throw new ProjectError('INVALID_PROJECT', 'Experiment IDs must be unique', ['experiments', i, 'id'])
    if (names.has(experiment.name.trim().toLowerCase())) throw new ProjectError('INVALID_PROJECT', 'Experiment names must be unique ignoring case', ['experiments', i, 'name'])
    ids.add(experiment.id); names.add(experiment.name.trim().toLowerCase())
    if (experiment.solverVersion !== SOLVER_VERSION) throw new ProjectError('UNSUPPORTED_VERSION', `Unsupported solver version: ${experiment.solverVersion}`, ['experiments', i, 'solverVersion'])
    validateSceneSolids(experiment.scene, ['experiments', i, 'scene'])
  }
  if (baselineId !== undefined) {
    const index = experiments.findIndex(experiment => experiment.id === baselineId)
    if (index < 0) throw new ProjectError('INVALID_PROJECT', 'Baseline experiment must reference an existing experiment', ['baselineExperimentId'])
    const baseline = experiments[index]!
    if (!baselineSnapshot) throw new ProjectError('INVALID_PROJECT', 'A baseline experiment requires a project baseline snapshot', ['baselineExperimentId'])
    const canonical = (scene: Scene, settings: SolverSettings, solverVersion: string) => JSON.stringify({ scene, settings, solverVersion })
    if (canonical(baseline.scene, baseline.settings, baseline.solverVersion) !== canonical(baselineSnapshot.scene, baselineSnapshot.settings, baselineSnapshot.solverVersion)) {
      throw new ProjectError('INVALID_PROJECT', 'Baseline experiment must match the project baseline snapshot', ['baselineExperimentId'])
    }
  }
}

function validateSceneSolids(scene: Scene, prefix: (string | number)[]): void {
  const levels = new Map(scene.levels.map(level => [level.id, level]))
  for (const [i, wall] of scene.walls.entries()) { const level = levels.get(wall.levelId); if (level && wall.baseZ < level.floorZ - 1e-6) throw new ProjectError('INVALID_PROJECT', 'Wall base must not be below its level floor', [...prefix, 'walls', i, 'baseZ']) }
  const wallGeometry = validateWallGeometry(scene)
  if (!wallGeometry.valid) throw new ProjectError('INVALID_PROJECT', wallGeometry.reason, [...prefix, 'walls'])
  for (const [kind, entities] of [['emitters', scene.emitters], ['probes', scene.probes]] as const) for (const [i, entity] of entities.entries()) {
    const placement = validatePlacement(scene, entity.position, entity.levelId)
    if (!placement.valid) { const explanation = placement.reason === 'inside-solid' ? 'cannot be inside a wall solid' : placement.reason === 'outside-floor' ? 'must be within its level bounds and height' : 'references an invalid level or scene'; throw new ProjectError('INVALID_PROJECT', `${kind === 'emitters' ? 'Emitter' : 'Probe'} ${explanation}`, [...prefix, kind, i, 'position']) }
  }
}

function inspectJson(value: unknown): void {
  let nodeCount = 0
  const visit = (node: unknown, depth: number, path: (string | number)[]): void => {
    nodeCount++; if (nodeCount > PROJECT_MAX_NODES) throw new ProjectError('INVALID_PROJECT', `Project contains more than ${PROJECT_MAX_NODES} JSON values`, path)
    if (depth > PROJECT_MAX_DEPTH) throw new ProjectError('INVALID_PROJECT', `Maximum nesting depth ${PROJECT_MAX_DEPTH} exceeded`, path)
    if (node === null || typeof node !== 'object') return
    if (ArrayBuffer.isView(node)) throw new ProjectError('INVALID_PROJECT', 'Typed arrays and binary fields are not supported in project JSON', path)
    if (Array.isArray(node)) {
      const key = path.at(-1); const semanticLimit = key === 'levels' ? 1 : key === 'walls' || key === 'openings' ? 256 : key === 'materials' ? 64 : key === 'probes' || key === 'emitters' ? 64 : key === 'zones' ? 256 : key === 'boundary' || key === 'polygon' ? 256 : key === 'experiments' ? MAX_PROJECT_EXPERIMENTS : undefined
      const limit = semanticLimit ?? PROJECT_MAX_ARRAY_LENGTH
      if (node.length > limit) throw new ProjectError('INVALID_PROJECT', `Array exceeds the ${limit}-item limit`, path)
      for (let i = 0; i < node.length; i++) visit(node[i], depth + 1, [...path, i]); return
    }
    for (const [key, child] of Object.entries(node)) { if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new ProjectError('INVALID_PROJECT', `Forbidden object key: ${key}`, [...path, key]); visit(child, depth + 1, [...path, key]) }
  }
  visit(value, 0, [])
}

function freezeDeep<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child); Object.freeze(value) } return value }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function utf8Size(value: string): number { return new TextEncoder().encode(value).byteLength }
function makeId(): string { return globalThis.crypto?.randomUUID?.() ?? `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }
