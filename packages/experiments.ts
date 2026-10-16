import { SOLVER_VERSION, type Scene, type SolverSettings } from './engine'
import type { FloorPlanReference } from './floorplan'
import { validateProjectExperiment, type ProjectExperiment } from './project'

export type ExperimentInputChange = { key: string; label: string; before: string; after: string }

const copy = <T>(value: T): T => structuredClone(value)

export function captureExperiment(input: { id: string; name: string; notes: string; scene: Scene; settings: SolverSettings; referenceImage?: FloorPlanReference; now?: string }): ProjectExperiment {
  const now = input.now ?? new Date().toISOString()
  return validateProjectExperiment({
    id: input.id, name: input.name, notes: input.notes, createdAt: now,
    updatedAt: now, scene: copy(input.scene), settings: copy(input.settings),
    solverVersion: SOLVER_VERSION, ...(input.referenceImage === undefined ? {} : { referenceImage: copy(input.referenceImage) }),
  })
}

export function duplicateExperiment(source: ProjectExperiment, id: string, existing: readonly ProjectExperiment[], now = new Date().toISOString()): ProjectExperiment {
  if (existing.some(item => item.id === id)) throw new RangeError(`An experiment with id "${id}" already exists.`)
  const occupied = new Set(existing.map(item => item.name.toLowerCase()))
  let suffix = ' copy'
  let name = fitName(source.name, suffix)
  let n = 2
  while (occupied.has(name.toLowerCase())) { suffix = ` copy ${n++}`; name = fitName(source.name, suffix) }
  return validateProjectExperiment({ ...copy(source), id, name, createdAt: now, updatedAt: now })
}

function fitName(base: string, suffix: string, max = 80): string {
  const prefix = base.slice(0, max - suffix.length).trimEnd()
  return `${prefix}${suffix}`
}

export function updateExperimentMetadata(source: ProjectExperiment, metadata: { name: string; notes: string }, now = new Date().toISOString()): ProjectExperiment {
  return validateProjectExperiment({ ...copy(source), name: metadata.name, notes: metadata.notes, updatedAt: now })
}

function stable(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' && Object.is(value, -0)) return '0'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function display(value: unknown): string {
  if (value === undefined) return 'None'
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'dataUrl' in value) return 'Embedded image'
  return JSON.stringify(value)
}

export function describeExperimentChanges(saved: ProjectExperiment, current: { scene: Scene; settings: SolverSettings; referenceImage?: FloorPlanReference }): ExperimentInputChange[] {
  const changes: ExperimentInputChange[] = []
  const add = (key: string, label: string, before: unknown, after: unknown) => {
    if (stable(before) !== stable(after)) changes.push({ key, label, before: display(before), after: display(after) })
  }
  const left = saved.scene as Scene, right = current.scene
  add('scene.id', 'Scene', left.id, right.id)
  const collections: { key: string; label: string; a: {id:string}[]; b: {id:string}[] }[] = [
    { key:'levels', label:'Level', a:left.levels, b:right.levels }, { key:'zones', label:'Zone', a:left.zones, b:right.zones },
    { key:'materials', label:'Material', a:left.materials, b:right.materials }, { key:'walls', label:'Wall', a:left.walls, b:right.walls },
    { key:'openings', label:'Opening', a:left.openings, b:right.openings }, { key:'emitters', label:'Emitter', a:left.emitters, b:right.emitters },
    { key:'probes', label:'Probe', a:left.probes, b:right.probes },
  ]
  for (const group of collections) {
    const before = new Map(group.a.map(item => [item.id, item])), after = new Map(group.b.map(item => [item.id, item]))
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(id), b = after.get(id), base = `${group.key}.${id}`
      if (!a || !b) { add(base, `${group.label} ${id}`, a, b); continue }
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const field of [...keys].sort()) add(`${base}.${field}`, `${group.label} ${id} · ${field}`, (a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field])
    }
  }
  const settingsKeys = new Set([...Object.keys(saved.settings), ...Object.keys(current.settings)])
  for (const key of [...settingsKeys].sort()) add(`settings.${key}`, `Setting · ${key}`, (saved.settings as unknown as Record<string, unknown>)[key], (current.settings as unknown as Record<string, unknown>)[key])
  const beforeImage = saved.referenceImage, afterImage = current.referenceImage
  if (!beforeImage && afterImage) changes.push({ key:'referenceImage', label:'Guide image', before:'None', after:`Embedded image · ${afterImage.pixelWidth}×${afterImage.pixelHeight}, ${afterImage.widthM}×${afterImage.heightM} m at ${display(afterImage.originXY)}` })
  else if (beforeImage && !afterImage) changes.push({ key:'referenceImage', label:'Guide image', before:`Embedded image · ${beforeImage.pixelWidth}×${beforeImage.pixelHeight}, ${beforeImage.widthM}×${beforeImage.heightM} m at ${display(beforeImage.originXY)}`, after:'None' })
  else if (beforeImage && afterImage) {
    for (const field of ['dataUrl', 'pixelWidth', 'pixelHeight', 'widthM', 'heightM', 'originXY', 'opacity'] as const) {
      const before = beforeImage[field], after = afterImage[field]
      if (stable(before) === stable(after)) continue
      const asset = field === 'dataUrl'
      changes.push({
        key:`referenceImage.${field}`, label:asset ? 'Guide image asset' : `Guide image · ${field}`,
        before:asset ? 'Embedded image' : display(before), after:asset ? 'Different embedded image' : display(after),
      })
    }
  }
  return changes
}
