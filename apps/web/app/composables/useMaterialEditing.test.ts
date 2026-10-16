import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { createDemoScene, defaultSettings, type Scene } from '../../../../packages/engine'
import { createProject, type ProjectDocument, type ProjectExperiment } from '../../../../packages/project'
import type { MaterialUpdate } from '../../../../packages/materials'
import { useSceneHistory } from './useSceneHistory'
import { useMaterialEditing } from './useMaterialEditing'

function workspace(currentDocument?: () => ProjectDocument) {
  const scene = shallowRef<Scene>(createDemoScene())
  const disabled = ref(false)
  const settings = defaultSettings('radio')
  const document = currentDocument ?? (() => createProject(scene.value, settings))
  const history = useSceneHistory(scene, { restoreContext: vi.fn(), onRestore: vi.fn() })
  const commit = vi.fn((next: Scene) => history.commit(next))
  const editing = useMaterialEditing({ scene, disabled, currentDocument: document, commit })
  return { scene, disabled, history, commit, editing }
}

function updateFor(scene: Scene, overrides: Partial<MaterialUpdate> = {}): MaterialUpdate {
  const material = scene.materials.find(item => item.id === 'partition')!
  return {
    materialId: material.id,
    name: '  Updated partition  ',
    provenance: 'site-measured',
    acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: 12, provenance: 'site-measured' }],
    radioLossDb: [
      { frequencyHz: 5e9, valueDb: 8, provenance: 'site-measured' },
      { frequencyHz: 2.4e9, valueDb: 4, provenance: 'site-measured' },
    ],
    ...overrides,
  }
}

function largeReferenceImage() {
  // The project validator checks the PNG signature and IHDR dimensions. A
  // padded payload keeps this valid reference image large without a fixture.
  const bytes = new Uint8Array(1_500_000)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  bytes.set([0, 0, 0, 1, 0, 0, 0, 1], 16)
  let binary = ''
  const chunkSize = 0x8000
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize))
  }
  return {
    dataUrl: `data:image/png;base64,${btoa(binary)}`,
    pixelWidth: 1,
    pixelHeight: 1,
    widthM: 1,
    heightM: 1,
    originXY: [0, 0] as [number, number],
    opacity: 0.5,
  }
}

describe('useMaterialEditing', () => {
  it('commits one validated profile update and one undo restores the prior material', () => {
    const state = workspace()
    const before = structuredClone(state.scene.value)
    const draft = updateFor(state.scene.value)

    expect(state.editing.apply(draft)).toBe(true)
    expect(state.commit).toHaveBeenCalledOnce()
    expect(state.history.undoStack.value).toHaveLength(1)
    expect(state.scene.value.materials.find(item => item.id === 'partition')).toMatchObject({
      name: 'Updated partition',
      provenance: 'site-measured',
      acousticTransmissionDb: [{ frequencyHz: 1000, valueDb: 12, provenance: 'site-measured' }],
      radioLossDb: [
        { frequencyHz: 2.4e9, valueDb: 4, provenance: 'site-measured' },
        { frequencyHz: 5e9, valueDb: 8, provenance: 'site-measured' },
      ],
    })
    expect(state.scene.value.materials.find(item => item.id === 'masonry')).toEqual(before.materials.find(item => item.id === 'masonry'))
    expect(draft.name).toBe('  Updated partition  ')
    expect(draft.radioLossDb.map(band => band.frequencyHz)).toEqual([5e9, 2.4e9])
    expect(state.editing.notice.value).toContain('One Undo')

    state.history.undo()
    expect(state.scene.value).toEqual(before)
    expect(state.history.redoStack.value).toHaveLength(1)
    state.history.redo()
    expect(state.scene.value.materials.find(item => item.id === 'partition')?.name).toBe('Updated partition')
  })

  it('rejects an invalid draft atomically and leaves the caller-owned draft unchanged', () => {
    const state = workspace()
    const before = structuredClone(state.scene.value)
    const draft = updateFor(state.scene.value, {
      acousticTransmissionDb: [
        { frequencyHz: 1000, valueDb: 12, provenance: 'site-measured' },
        { frequencyHz: 1000, valueDb: 13, provenance: 'site-measured' },
      ],
    })
    const draftBefore = structuredClone(draft)

    expect(state.editing.apply(draft)).toBe(false)
    expect(state.editing.error.value).toContain('Duplicate material frequency')
    expect(state.scene.value).toEqual(before)
    expect(state.commit).not.toHaveBeenCalled()
    expect(state.history.undoStack.value).toHaveLength(0)
    expect(draft).toEqual(draftBefore)
  })

  it('reports a no-op without committing or adding history', () => {
    const state = workspace()
    const material = state.scene.value.materials.find(item => item.id === 'partition')!
    const same = updateFor(state.scene.value, {
      name: material.name,
      provenance: material.provenance,
      acousticTransmissionDb: structuredClone(material.acousticTransmissionDb),
      radioLossDb: structuredClone(material.radioLossDb),
    })

    expect(state.editing.apply(same)).toBe(true)
    expect(state.editing.notice.value).toContain('already matches')
    expect(state.commit).not.toHaveBeenCalled()
    expect(state.history.undoStack.value).toHaveLength(0)
  })

  it('ignores changes while editing is disabled', () => {
    const state = workspace()
    const before = structuredClone(state.scene.value)
    state.disabled.value = true

    expect(state.editing.apply(updateFor(state.scene.value))).toBe(false)
    expect(state.scene.value).toEqual(before)
    expect(state.commit).not.toHaveBeenCalled()
    expect(state.history.undoStack.value).toHaveLength(0)
  })

  it('rejects a valid project whose full serialized payload exceeds 5 MiB', () => {
    const base = createProject(createDemoScene(), defaultSettings('radio'))
    const referenceImage = largeReferenceImage()
    const experiments = Array.from({ length: 3 }, (_, index) => ({
      id: `large-${index}`,
      name: `Large snapshot ${index}`,
      notes: '',
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
      scene: base.scene,
      settings: base.settings,
      solverVersion: base.solverVersion,
      referenceImage,
    })) as ProjectExperiment[]
    const oversized = () => ({ ...base, experiments }) as ProjectDocument
    const state = workspace(oversized)
    const before = structuredClone(state.scene.value)

    expect(state.editing.apply(updateFor(state.scene.value))).toBe(false)
    expect(state.editing.error.value).toContain('5242880-byte limit')
    expect(state.scene.value).toEqual(before)
    expect(state.commit).not.toHaveBeenCalled()
    expect(state.history.undoStack.value).toHaveLength(0)
  })

  it('rejects an invalid full project document before committing the scene update', () => {
    const base = createProject(createDemoScene(), defaultSettings('radio'))
    const invalidDocument = () => ({
      ...base,
      experiments: [{ id: 'invalid', name: 'Invalid', notes: 'x'.repeat(2001) }],
    }) as unknown as ProjectDocument
    const state = workspace(invalidDocument)
    const before = structuredClone(state.scene.value)

    expect(state.editing.apply(updateFor(state.scene.value))).toBe(false)
    expect(state.editing.error.value).not.toBe('')
    expect(state.scene.value).toEqual(before)
    expect(state.commit).not.toHaveBeenCalled()
    expect(state.history.undoStack.value).toHaveLength(0)
  })
})
