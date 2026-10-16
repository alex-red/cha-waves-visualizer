import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { applySceneCommand } from '../../../../packages/commands'
import { createDemoScene, defaultSettings, type Scene, type SolverSettings } from '../../../../packages/engine'
import { captureExperiment } from '../../../../packages/experiments'
import { createProject, MAX_PROJECT_EXPERIMENTS, type FloorPlanReference, type ProjectExperiment } from '../../../../packages/project'
import type { BaselineState, HistoryContext } from '../lib/workspace-types'
import { clone } from '../lib/clone'
import { useSceneHistory } from './useSceneHistory'
import { useExperiments } from './useExperiments'

function workspace() {
  const scene = shallowRef<Scene>(createDemoScene()), settings = shallowRef<SolverSettings>(defaultSettings('acoustics'))
  const experiments = shallowRef<readonly ProjectExperiment[]>([]), baseline = shallowRef<BaselineState>(null)
  const baselineExperimentId = ref<string | null>(null), referenceImage = shallowRef<FloorPlanReference | undefined>()
  const disabled = ref(false), onLoaded = vi.fn(), onComputeChange = vi.fn()
  function context(): HistoryContext {
    return { settings: settings.value, domain: settings.value.mode === 'acoustics' ? 'sound' : 'wifi', baseline: baseline.value,
      experiments: experiments.value, baselineExperimentId: baselineExperimentId.value, referenceImage: referenceImage.value,
      selectedId: '', selectedObjectId: '', selectedDoorId: '' }
  }
  const history = useSceneHistory(scene, { onRestore: onComputeChange, restoreContext: saved => {
    settings.value = saved.settings; baseline.value = saved.baseline; experiments.value = saved.experiments ?? []
    baselineExperimentId.value = saved.baselineExperimentId ?? null; referenceImage.value = saved.referenceImage
  } })
  const currentDocument = () => createProject(scene.value, settings.value,
    baseline.value ? { scene: baseline.value.scene, settings: baseline.value.settings } : undefined,
    referenceImage.value, { experiments: experiments.value, ...(baselineExperimentId.value ? { baselineExperimentId: baselineExperimentId.value } : {}) })
  const service = useExperiments({ scene, settings, experiments, baseline, baselineExperimentId, referenceImage, disabled, currentDocument,
    commit: action => { const previous = clone(scene.value), before = clone(context()); action(); history.record(previous, { before, after: context() }) },
    onLoaded, onComputeChange,
  })
  return { scene, settings, experiments, baseline, baselineExperimentId, referenceImage, disabled, currentDocument, service, history, onLoaded, onComputeChange }
}

describe('experiment workspace actions', () => {
  it('captures immutable inputs and restores loading plus settings atomically through undo/redo', () => {
    const state = workspace()
    state.service.save({ name: 'Sound reference', notes: 'Original inputs' })
    const saved = state.experiments.value[0]!
    state.history.commit(applySceneCommand(state.scene.value, { type: 'move-emitter', emitterId: 'speaker', position: [4, 2, 1.2] }))
    state.settings.value = defaultSettings('radio')
    state.service.load(saved.id)
    expect(state.scene.value.emitters[0]!.position[0]).toBe(2)
    expect(state.settings.value.mode).toBe('acoustics')
    expect(state.onLoaded).toHaveBeenCalledOnce()
    expect(state.experiments.value).toHaveLength(1)
    state.history.undo()
    expect(state.scene.value.emitters[0]!.position[0]).toBe(4)
    expect(state.settings.value.mode).toBe('radio')
    state.history.redo()
    expect(state.scene.value.emitters[0]!.position[0]).toBe(2)
    expect(state.settings.value.mode).toBe('acoustics')
    expect(saved.scene.emitters[0]!.position[0]).toBe(2)
  })

  it('keeps baseline inputs when its named record is removed and restores the link on undo', () => {
    const state = workspace()
    state.service.save({ name: 'Reference', notes: '' })
    const id = state.experiments.value[0]!.id
    state.service.useBaseline(id)
    expect(state.baselineExperimentId.value).toBe(id)
    expect(state.baseline.value?.field).toBeNull()
    const copiedBaseline = clone(state.baseline.value)
    state.service.remove(id)
    expect(state.baselineExperimentId.value).toBeNull()
    expect(state.baseline.value).toEqual(copiedBaseline)
    expect(state.currentDocument().baseline).toBeDefined()
    state.history.undo()
    expect(state.baselineExperimentId.value).toBe(id)
    expect(state.currentDocument().baselineExperimentId).toBe(id)
  })

  it('records metadata and duplication without calculating or changing working inputs', () => {
    const state = workspace(), initial = clone(state.scene.value)
    state.service.save({ name: 'Reference', notes: 'Initial' })
    const source = state.experiments.value[0]!
    state.service.duplicate(source.id)
    expect(state.experiments.value.map(item => item.name)).toEqual(['Reference', 'Reference copy'])
    state.service.update({ id: source.id, name: 'Renamed', notes: 'New notes' })
    expect(source.name).toBe('Reference')
    expect(state.experiments.value[0]!.notes).toBe('New notes')
    expect(state.onComputeChange).not.toHaveBeenCalled()
    expect(state.scene.value).toEqual(initial)
    state.history.undo()
    expect(state.experiments.value[0]!.name).toBe('Reference')
    state.history.undo()
    expect(state.experiments.value).toHaveLength(1)
  })

  it('validates duplicate names and disabled actions before mutating state or history', () => {
    const state = workspace()
    vi.stubGlobal('crypto', {})
    try { state.service.save({ name: 'Reference', notes: '' }) } finally { vi.unstubAllGlobals() }
    expect(state.experiments.value[0]!.id).toMatch(/^experiment-/)
    const before = state.currentDocument(), entries = state.history.undoStack.value.length
    state.service.save({ name: ' REFERENCE ', notes: 'Rejected' })
    expect(state.service.error.value).toContain('unique')
    expect(state.experiments.value).toEqual(before.experiments)
    expect(state.history.undoStack.value).toHaveLength(entries)
    state.disabled.value = true
    state.service.load(state.experiments.value[0]!.id)
    expect(state.service.error.value).toContain('Finish')
    expect(state.onLoaded).not.toHaveBeenCalled()
    expect(state.history.undoStack.value).toHaveLength(entries)
  })

  it('rejects expanded libraries beyond the project cap without recording a change', () => {
    const state = workspace()
    state.experiments.value = Array.from({ length: MAX_PROJECT_EXPERIMENTS }, (_, i) => captureExperiment({ id: `saved-${i}`, name: `Saved ${i}`, notes: '', scene: state.scene.value, settings: state.settings.value }))
    state.service.save({ name: 'One too many', notes: '' })
    expect(state.service.error.value).not.toBe('')
    expect(state.experiments.value).toHaveLength(MAX_PROJECT_EXPERIMENTS)
    expect(state.history.undoStack.value).toHaveLength(0)
  })
})
