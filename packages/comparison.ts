import { evaluatePoint, MASK_REASON, type FieldResult, type PointResult, type Scene, type SolverSettings } from './engine'

export type ComparisonSnapshot = { scene: Scene; settings: SolverSettings; field: FieldResult }

export type Compatibility = { compatible: boolean; reasons: string[] }

function stable(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' && Object.is(value, -0)) return '0'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function compareCompatibility(snapshotA: ComparisonSnapshot, snapshotB: ComparisonSnapshot): Compatibility {
  const a = snapshotA.field, b = snapshotB.field
  const reasons: string[] = []
  if (a.identity.solverId !== b.identity.solverId) reasons.push('Solver models differ.')
  if (a.identity.solverVersion !== b.identity.solverVersion) reasons.push('Solver versions differ.')
  const solverForMode = (mode: SolverSettings['mode']) => mode === 'acoustics' ? 'acoustic-direct-v1' : 'rf-fspl-multiwall-v1'
  if (a.identity.solverId !== solverForMode(snapshotA.settings.mode) || b.identity.solverId !== solverForMode(snapshotB.settings.mode)) reasons.push('A field does not match its snapshot solver mode.')
  if (a.quantity !== b.quantity || a.unit !== b.unit) reasons.push('Field quantities or units differ.')
  if (snapshotA.settings.mode !== snapshotB.settings.mode) reasons.push('Physical domains differ.')
  const quantityForMode = (mode: SolverSettings['mode']) => mode === 'acoustics' ? 'relative-direct-level-db' : 'received-power-dbm'
  if (a.quantity !== quantityForMode(snapshotA.settings.mode) || b.quantity !== quantityForMode(snapshotB.settings.mode)) reasons.push('A field quantity does not match its snapshot domain.')
  if (snapshotA.settings.frequencyHz !== snapshotB.settings.frequencyHz) reasons.push('Frequencies differ.')
  if (stable(snapshotA.settings) !== stable(snapshotB.settings)) reasons.push('Solver settings differ.')
  const ga = a.grid, gb = b.grid
  if (ga.levelId !== gb.levelId || ga.cols !== gb.cols || ga.rows !== gb.rows || ga.cellSizeM !== gb.cellSizeM
    || ga.receiverZM !== gb.receiverZM || ga.originXY[0] !== gb.originXY[0] || ga.originXY[1] !== gb.originXY[1]) {
    reasons.push('Sampling grids differ; recompute both fields on the same grid before comparing.')
  }
  if (a.values.length !== a.validity.length || b.values.length !== b.validity.length
    || a.values.length !== ga.cols * ga.rows || b.values.length !== gb.cols * gb.rows) reasons.push('Field arrays do not match their grid dimensions.')
  else {
    const malformedMask = [a, b].some(field => field.validity.some(mask => mask > 5))
    if (malformedMask) reasons.push('Field validity masks contain an unknown code.')
    const nonFiniteValidValue = [a, b].some(field => field.validity.some((mask, index) => mask === MASK_REASON.valid && !Number.isFinite(field.values[index])))
    if (nonFiniteValidValue) reasons.push('A valid field cell contains a non-finite value.')
  }
  return { compatible: reasons.length === 0, reasons }
}

export type ObjectChange = { kind: 'wall' | 'door' | 'opening' | 'material' | 'source' | 'level'; id: string; action: 'added' | 'removed' | 'changed'; fields: string[] }
export type SettingChange = { key: string; before: unknown; after: unknown }
export type ChangeDescription = { objects: ObjectChange[]; settings: SettingChange[] }

function comparable(value: unknown): string { return stable(value) }

export function describeChanges(sceneA: Scene, sceneB: Scene, settingsA: SolverSettings, settingsB: SolverSettings): ChangeDescription {
  const objects: ObjectChange[] = []
  const collect = <T extends { id: string }>(kind: ObjectChange['kind'], left: T[], right: T[], fieldsFor: (value: T) => Record<string, unknown>) => {
    const before = new Map(left.map(item => [item.id, item])), after = new Map(right.map(item => [item.id, item]))
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(id), b = after.get(id)
      if (!a) { objects.push({ kind, id, action: 'added', fields: Object.keys(fieldsFor(b!)).sort() }); continue }
      if (!b) { objects.push({ kind, id, action: 'removed', fields: Object.keys(fieldsFor(a)).sort() }); continue }
      const fa = fieldsFor(a), fb = fieldsFor(b)
      const changed = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(key => comparable(fa[key]) !== comparable(fb[key])).sort()
      if (changed.length) objects.push({ kind, id, action: 'changed', fields: changed })
    }
  }
  collect('level', sceneA.levels, sceneB.levels, level => ({ boundary: level.boundary, floorZ: level.floorZ, ceilingHeightM: level.ceilingHeightM }))
  collect('wall', sceneA.walls, sceneB.walls, wall => ({ levelId: wall.levelId, start: wall.start, end: wall.end, thicknessM: wall.thicknessM, baseZ: wall.baseZ, heightM: wall.heightM, materialId: wall.materialId }))
  const openingsA = sceneA.openings.filter(item => item.kind !== 'door')
  const openingsB = sceneB.openings.filter(item => item.kind !== 'door')
  collect('opening', openingsA, openingsB, opening => ({ wallId: opening.wallId, fromT: opening.fromT, toT: opening.toT, sillAboveBaseM: opening.sillAboveBaseM, heightM: opening.heightM, kind: opening.kind, fixed: opening.fixed, materialId: opening.materialId }))
  collect('door', sceneA.openings.filter(item => item.kind === 'door'), sceneB.openings.filter(item => item.kind === 'door'), door => ({ wallId: door.wallId, fromT: door.fromT, toT: door.toT, sillAboveBaseM: door.sillAboveBaseM, heightM: door.heightM, isOpen: door.isOpen, materialId: door.materialId }))
  collect('material', sceneA.materials, sceneB.materials, material => ({ acousticTransmissionDb: material.acousticTransmissionDb, radioLossDb: material.radioLossDb, acousticAbsorption: material.acousticAbsorption, provenance: material.provenance }))
  collect('source', sceneA.emitters, sceneB.emitters, source => ({ domain: source.domain, levelId: source.levelId, position: source.position, active: source.active, eirpDbm: source.eirpDbm }))
  const settingsKeys = [...new Set([...Object.keys(settingsA), ...Object.keys(settingsB)])].sort()
  const settings = settingsKeys.filter(key => comparable((settingsA as unknown as Record<string, unknown>)[key]) !== comparable((settingsB as unknown as Record<string, unknown>)[key]))
    .map(key => ({ key, before: (settingsA as unknown as Record<string, unknown>)[key], after: (settingsB as unknown as Record<string, unknown>)[key] }))
  return { objects, settings }
}

export type DeltaField = { values: Float32Array; validity: Uint8Array; sharedCount: number; excludedCount: number; maxAbs: number }

export function computeDelta(fieldA: FieldResult, fieldB: FieldResult): DeltaField {
  const a = fieldA.grid, b = fieldB.grid
  if (a.levelId !== b.levelId || a.cols !== b.cols || a.rows !== b.rows || a.cellSizeM !== b.cellSizeM
    || a.receiverZM !== b.receiverZM || a.originXY[0] !== b.originXY[0] || a.originXY[1] !== b.originXY[1]
    || fieldA.quantity !== fieldB.quantity || fieldA.unit !== fieldB.unit
    || fieldA.identity.solverId !== fieldB.identity.solverId || fieldA.identity.solverVersion !== fieldB.identity.solverVersion) {
    throw new RangeError('Delta requires matching quantities and identical grids; interpolation is not supported.')
  }
  const size = a.cols * a.rows
  if (fieldA.values.length !== size || fieldA.validity.length !== size || fieldB.values.length !== size || fieldB.validity.length !== size) {
    throw new RangeError('Field arrays do not match the grid dimensions.')
  }
  for (const field of [fieldA, fieldB]) for (let i = 0; i < size; i++) {
    if (field.validity[i]! > MASK_REASON.unsupportedGeometry) throw new RangeError(`Field contains an unknown validity mask at cell ${i}.`)
    if (field.validity[i] === MASK_REASON.valid && !Number.isFinite(field.values[i])) throw new RangeError(`Valid field cell ${i} contains a non-finite value.`)
  }
  const values = new Float32Array(size), validity = new Uint8Array(size)
  let sharedCount = 0, maxAbs = 0
  for (let i = 0; i < size; i++) {
    if (fieldA.validity[i] !== MASK_REASON.valid || fieldB.validity[i] !== MASK_REASON.valid) continue
    const delta = fieldB.values[i]! - fieldA.values[i]!
    values[i] = delta; validity[i] = MASK_REASON.valid; sharedCount++; maxAbs = Math.max(maxAbs, Math.abs(delta))
  }
  return { values, validity, sharedCount, excludedCount: size - sharedCount, maxAbs }
}

export type ComparisonProbe = { a: PointResult; b: PointResult; delta?: number }
export function compareProbeAt(sceneA: Scene, settingsA: SolverSettings, sceneB: Scene, settingsB: SolverSettings, position: [number, number, number]): ComparisonProbe {
  if (settingsA.mode !== settingsB.mode || stable(settingsA) !== stable(settingsB)) {
    throw new RangeError('Point comparison requires matching domains, frequencies, reference conventions, and solver settings.')
  }
  const a = evaluatePoint(sceneA, settingsA, position), b = evaluatePoint(sceneB, settingsB, position)
  return { a, b, ...(a.valid && b.valid && a.unit === b.unit ? { delta: b.value! - a.value! } : {}) }
}
