import { describe, expect, it } from 'vitest'
import { applySceneCommand, SceneCommandError, type SceneCommand } from './commands'
import {
  createDemoScene,
  defaultSettings,
  evaluatePoint,
  type Scene,
} from './engine'
import { applyMaterialUpdate, availableMaterialFrequencies, materialFrequencyCoverage } from './materials'
import { captureExperiment } from './experiments'
import { createProject, parseProject, serializeProject } from './project'

const updatedMaterial = (
  scene: Scene,
  overrides: Partial<Omit<Extract<SceneCommand, { type: 'update-material' }>, 'type' | 'materialId'>> = {},
): Extract<SceneCommand, { type: 'update-material' }> => {
  const material = scene.materials.find(item => item.id === 'partition')!
  return {
    type: 'update-material' as const,
    materialId: material.id,
    name: 'Updated partition',
    provenance: 'user-entered' as const,
    acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: 12, provenance: 'user-entered' as const, notes: 'Measured in room' }],
    radioLossDb: [
      { frequencyHz: 2.4e9, valueDb: 5, provenance: 'manufacturer-measured' as const, notes: 'Datasheet rev 2' },
      { frequencyHz: 5e9, valueDb: 8, provenance: 'literature-derived' as const },
    ],
    ...overrides,
  }
}

describe('material profiles', () => {
  it('updates one material atomically and preserves unrelated scene and material properties', () => {
    const scene = createDemoScene()
    scene.emitters.push({ id: 'inactive-backup', levelId: 'main', domain: 'radio', position: [12, 8, 1.2], active: false, eirpDbm: 10 })
    scene.materials.find(item => item.id === 'partition')!.display = { color: '#abc123' }
    scene.materials.find(item => item.id === 'partition')!.acousticAbsorption = [
      { frequencyHz: 1000, value: 0.25, provenance: 'site-measured', notes: 'Kept separately' },
    ]
    const before = structuredClone(scene)
    const changed = applySceneCommand(scene, updatedMaterial(scene))
    const material = changed.materials.find(item => item.id === 'partition')!

    expect(changed).not.toBe(scene)
    expect(changed.revision).toBe(scene.revision + 1)
    expect(material).toMatchObject({
      id: 'partition', name: 'Updated partition', provenance: 'user-entered',
      display: { color: '#abc123' },
      acousticAbsorption: [{ frequencyHz: 1000, value: 0.25, provenance: 'site-measured', notes: 'Kept separately' }],
      acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: 12, provenance: 'user-entered', notes: 'Measured in room' }],
      radioLossDb: [
        { frequencyHz: 2.4e9, valueDb: 5, provenance: 'manufacturer-measured', notes: 'Datasheet rev 2' },
        { frequencyHz: 5e9, valueDb: 8, provenance: 'literature-derived' },
      ],
    })
    expect(changed.walls).toEqual(scene.walls)
    expect(changed.openings).toEqual(scene.openings)
    expect(changed.emitters).toEqual(scene.emitters)
    expect(changed.probes).toEqual(scene.probes)
    expect(scene).toEqual(before)
    material.radioLossDb[0]!.notes = 'Edited history entry'
    expect(scene.materials.find(item => item.id === 'partition')!.radioLossDb[0]!.notes).toBeUndefined()
  })

  it('sorts bands and rejects blank metadata, duplicate frequencies, or malformed bands atomically', () => {
    const scene = createDemoScene()
    const before = structuredClone(scene)
    const sorted = applySceneCommand(scene, updatedMaterial(scene, { acousticTransmissionDb: [
      { frequencyHz: 2000, valueDb: 2, provenance: 'user-entered' },
      { frequencyHz: 1000, valueDb: 1, provenance: 'user-entered' },
    ] }))
    expect(sorted.materials.find(item => item.id === 'partition')!.acousticTransmissionDb.map(band => band.frequencyHz)).toEqual([1000, 2000])
    const invalid = [
      updatedMaterial(scene, { name: '   ' }),
      updatedMaterial(scene, { name: 'x'.repeat(81) }),
      { ...updatedMaterial(scene), acousticTransmissionDb: [{ frequencyHz: 0, valueDb: 1, provenance: 'user-entered' }] } as never,
      { ...updatedMaterial(scene), acousticTransmissionDb: [{ frequencyHz: Number.NaN, valueDb: 1, provenance: 'user-entered' }] } as never,
      { ...updatedMaterial(scene), radioLossDb: [{ frequencyHz: Number.POSITIVE_INFINITY, valueDb: 1, provenance: 'user-entered' }] } as never,
      { ...updatedMaterial(scene), acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: Number.POSITIVE_INFINITY, provenance: 'user-entered' }] } as never,
      { ...updatedMaterial(scene), radioLossDb: [{ frequencyHz: 2.4e9, valueDb: 1, provenance: 'user-entered', notes: 'x'.repeat(2001) }] } as never,
      updatedMaterial(scene, { radioLossDb: [
        { frequencyHz: 2.4e9, valueDb: 1, provenance: 'user-entered' },
        { frequencyHz: 2.4e9, valueDb: 2, provenance: 'user-entered' },
      ] }),
      { ...updatedMaterial(scene), acousticTransmissionDb: [
        { frequencyHz: 1000, valueDb: 1, provenance: 'unknown-source' },
      ] } as never,
    ]

    for (const command of invalid) {
      expect(() => applySceneCommand(scene, command as never)).toThrow(SceneCommandError)
      expect(scene).toEqual(before)
    }
  })

  it('changes the exact crossed acoustic and RF ray by the edited band loss, including signed losses', () => {
    const scene = createDemoScene()
    const acoustic = defaultSettings('acoustics')
    const acousticPoint: [number, number, number] = [2, 2.5, 1.2]
    const acousticBefore = evaluatePoint(scene, acoustic, acousticPoint)
    const acousticAfterScene = applySceneCommand(scene, updatedMaterial(scene, {
      acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: 13, provenance: 'user-entered' }],
    }))
    const acousticAfter = evaluatePoint(acousticAfterScene, acoustic, acousticPoint)
    expect(acousticBefore.valid).toBe(true)
    expect(acousticAfter.valid).toBe(true)
    expect(acousticBefore.crossings.map(item => item.materialId)).toEqual(['partition'])
    expect(acousticAfter.value).toBeCloseTo(acousticBefore.value! - 5, 10)

    const radioScene = structuredClone(scene)
    radioScene.emitters = radioScene.emitters.filter(emitter => emitter.domain !== 'acoustics')
    radioScene.emitters.find(emitter => emitter.domain === 'radio')!.position = [2, 7.8, 1.2]
    const radioSettings = defaultSettings('radio')
    const radioPoint: [number, number, number] = [2, 2.5, 1.2]
    const radioBefore = evaluatePoint(radioScene, radioSettings, radioPoint)
    const radioAfterScene = applySceneCommand(radioScene, updatedMaterial(radioScene, {
      acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: 12, provenance: 'user-entered' }],
      radioLossDb: [{ frequencyHz: 2.4e9, valueDb: -4, provenance: 'user-entered' }],
    }))
    const radioAfter = evaluatePoint(radioAfterScene, radioSettings, radioPoint)
    expect(radioBefore.valid).toBe(true)
    expect(radioAfter.valid).toBe(true)
    expect(radioBefore.crossings.map(item => item.materialId)).toEqual(['partition'])
    expect(radioAfter.value).toBeCloseTo(radioBefore.value! + 7, 10)
  })

  it('keeps a missing requested band invalid instead of using a nearby profile', () => {
    const scene = createDemoScene()
    const changed = applySceneCommand(scene, updatedMaterial(scene, {
      acousticTransmissionDb: [{ frequencyHz: 500, valueDb: 12, provenance: 'user-entered' }],
    }))
    const result = evaluatePoint(changed, defaultSettings('acoustics'), [2, 2.5, 1.2])
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing-parameter')
  })

  it('offers only frequencies present on every referenced wall and opening material', () => {
    const scene = createDemoScene()
    scene.materials.find(item => item.id === 'door-leaf')!.radioLossDb = [
      { frequencyHz: 2.4e9, valueDb: 2, provenance: 'fixture-assumed' },
    ]
    scene.materials.push({
      id: 'unused', name: 'Unused material', provenance: 'user-entered',
      acousticTransmissionDb: [{ frequencyHz: 500, valueDb: 1, provenance: 'user-entered' }],
      radioLossDb: [{ frequencyHz: 500, valueDb: 1, provenance: 'user-entered' }],
      acousticAbsorption: [],
    })

    expect(availableMaterialFrequencies(scene, 'acoustics')).toEqual([1000])
    expect(availableMaterialFrequencies(scene, 'radio')).toEqual([2.4e9])
    expect(materialFrequencyCoverage(scene, 'radio', 2.4e9)).toEqual({ frequencyHz: 2.4e9, missingMaterialIds: [] })
    expect(materialFrequencyCoverage(scene, 'radio', 5e9).missingMaterialIds).toContain('door-leaf')

    const openDoor = structuredClone(scene)
    openDoor.openings.find(opening => opening.id === 'hall-door')!.isOpen = true
    openDoor.materials.find(item => item.id === 'door-leaf')!.radioLossDb = []
    expect(materialFrequencyCoverage(openDoor, 'radio', 5e9).missingMaterialIds).toContain('door-leaf')

    const passage = structuredClone(scene)
    passage.openings[0]!.kind = 'passage'
    passage.materials.find(item => item.id === 'door-leaf')!.radioLossDb = []
    expect(materialFrequencyCoverage(passage, 'radio', 5e9).missingMaterialIds).not.toContain('door-leaf')
    expect(availableMaterialFrequencies(passage, 'radio')).toEqual([2.4e9, 5e9, 6e9])

    const window = structuredClone(scene)
    window.openings[0]!.kind = 'window'
    window.openings[0]!.fixed = true
    window.materials.find(item => item.id === 'door-leaf')!.radioLossDb = []
    expect(materialFrequencyCoverage(window, 'radio', 5e9).missingMaterialIds).toContain('door-leaf')

    scene.materials.find(item => item.id === 'door-leaf')!.acousticTransmissionDb = []
    expect(availableMaterialFrequencies(scene, 'acoustics')).toEqual([])
  })

  it('runs profile helpers against frozen snapshots without mutating them', () => {
    const source = createDemoScene()
    const snapshot = createProject(source, defaultSettings('acoustics')).scene
    const before = JSON.stringify(snapshot)
    expect(Object.isFrozen(snapshot)).toBe(true)

    expect(availableMaterialFrequencies(snapshot, 'radio')).toEqual([2.4e9, 5e9, 6e9])
    expect(materialFrequencyCoverage(snapshot, 'acoustics', 1000).missingMaterialIds).toEqual([])
    const changed = applyMaterialUpdate(snapshot, updatedMaterial(source))
    expect(changed.materials.find(item => item.id === 'partition')?.name).toBe('Updated partition')
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('isolates baseline and experiment material profiles and round trips optional band notes in the current project format', () => {
    const baselineScene = createDemoScene()
    const currentScene = applySceneCommand(baselineScene, updatedMaterial(baselineScene))
    const settings = defaultSettings('acoustics')
    const experiment = captureExperiment({
      id: 'materials-v2', name: 'Material revision', notes: 'Measured partition profile',
      scene: currentScene, settings, now: '2026-10-15T12:00:00.000Z',
    })
    const doc = createProject(currentScene, settings, { scene: baselineScene, settings }, undefined, { experiments: [experiment] })
    baselineScene.materials.find(item => item.id === 'partition')!.acousticTransmissionDb[0]!.valueDb = 99
    currentScene.materials.find(item => item.id === 'partition')!.acousticTransmissionDb[0]!.valueDb = 88

    const restored = parseProject(serializeProject(doc))
    expect(restored.formatVersion).toBe(3)
    expect(restored.baseline?.scene.materials.find(item => item.id === 'partition')?.acousticTransmissionDb[0]?.valueDb).toBe(8)
    expect(restored.scene.materials.find(item => item.id === 'partition')?.acousticTransmissionDb[0]).toMatchObject({
      frequencyHz: 1000, valueDb: 12, provenance: 'user-entered', notes: 'Measured in room',
    })
    expect(restored.experiments[0]?.notes).toBe('Measured partition profile')
    expect(restored.experiments[0]?.scene.materials.find(item => item.id === 'partition')?.radioLossDb[0]).toMatchObject({
      frequencyHz: 2.4e9, valueDb: 5, provenance: 'manufacturer-measured', notes: 'Datasheet rev 2',
    })
  })
})
