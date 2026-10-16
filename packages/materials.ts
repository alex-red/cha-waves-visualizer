import { parseScene, type Scene } from './engine'

export type Material = Scene['materials'][number]
export type MaterialBand = Material['acousticTransmissionDb'][number]

/** The editable, user-facing portion of a material profile. */
export type MaterialUpdate = {
  materialId: string
  name: string
  provenance: Material['provenance']
  acousticTransmissionDb: Material['acousticTransmissionDb']
  radioLossDb: Material['radioLossDb']
}

export type MaterialFrequencyCoverage = {
  frequencyHz: number
  missingMaterialIds: string[]
}

/**
 * Return a new scene with the supplied complete profile applied to one existing
 * material. Identity, display settings, absorption, geometry, and all other
 * scene inputs are retained.
 */
export function applyMaterialUpdate(sceneInput: Scene, update: MaterialUpdate): Scene {
  const scene = parseScene(sceneInput)
  const index = scene.materials.findIndex(material => material.id === update.materialId)
  if (index < 0) throw new Error(`Unknown material ${update.materialId}`)
  if (typeof update.name !== 'string') throw new Error('Material name must contain 1 to 80 characters')
  const name = update.name.trim()
  if (name.length < 1 || name.length > 80) throw new Error('Material name must contain 1 to 80 characters')

  const acousticTransmissionDb = copyAndCheckBands(update.acousticTransmissionDb)
  const radioLossDb = copyAndCheckBands(update.radioLossDb)
  const next = structuredClone(scene)
  const existing = next.materials[index]!
  next.materials[index] = {
    ...existing,
    name,
    provenance: update.provenance,
    acousticTransmissionDb,
    radioLossDb,
  }
  return parseScene(next)
}

function copyAndCheckBands(bands: Material['acousticTransmissionDb']): Material['acousticTransmissionDb'] {
  if (!Array.isArray(bands)) throw new Error('Material bands must be an array')
  const result = structuredClone(bands)
  const frequencies = new Set<number>()
  for (const band of result) {
    if (frequencies.has(band.frequencyHz)) throw new Error(`Duplicate material frequency ${band.frequencyHz}`)
    frequencies.add(band.frequencyHz)
    if (band.notes !== undefined && (typeof band.notes !== 'string' || band.notes.length > 2000)) {
      throw new Error('Band notes must contain at most 2000 characters')
    }
  }
  result.sort((a, b) => a.frequencyHz - b.frequencyHz)
  // parseScene validates the existing schema, including positive finite
  // frequencies, finite signed dB values, and provenance.
  return result
}

/** Exact frequencies supported by every potentially charged referenced profile. */
export function availableMaterialFrequencies(sceneInput: Scene, mode: 'acoustics' | 'radio'): number[] {
  const scene = parseScene(sceneInput)
  const materials = referencedAttenuatingMaterials(scene)
  if (materials.length === 0) return []
  const bandsFor = (material: Material) => mode === 'acoustics' ? material.acousticTransmissionDb : material.radioLossDb
  const candidateFrequencies = new Set(bandsFor(materials[0]!).map(band => band.frequencyHz))
  return [...candidateFrequencies]
    .filter(frequencyHz => materials.every(material => bandsFor(material).some(band => band.frequencyHz === frequencyHz)))
    .sort((a, b) => a - b)
}

/** Identify referenced materials without an exact coefficient at a frequency. */
export function materialFrequencyCoverage(
  sceneInput: Scene,
  mode: 'acoustics' | 'radio',
  frequencyHz: number,
): MaterialFrequencyCoverage {
  const scene = parseScene(sceneInput)
  const bandsFor = (material: Material) => mode === 'acoustics' ? material.acousticTransmissionDb : material.radioLossDb
  const missingMaterialIds = referencedAttenuatingMaterials(scene)
    .filter(material => !bandsFor(material).some(band => band.frequencyHz === frequencyHz))
    .map(material => material.id)
    .sort((a, b) => a.localeCompare(b))
  return { frequencyHz, missingMaterialIds }
}

/**
 * The engine charges each wall material, a closed door leaf, and a window
 * material when present. Open doors and passages resolve to the wall material;
 * openable doors are included conservatively because they can be closed.
 */
function referencedAttenuatingMaterials(scene: Scene): Material[] {
  const ids = new Set(scene.walls.map(wall => wall.materialId))
  for (const opening of scene.openings) {
    if ((opening.kind === 'door' || opening.kind === 'window') && opening.materialId) ids.add(opening.materialId)
  }
  return scene.materials.filter(material => ids.has(material.id))
}
