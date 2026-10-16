import { ref, type Ref } from 'vue'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import { captureExperiment, duplicateExperiment, updateExperimentMetadata } from '../../../../packages/experiments'
import { validateProjectDocument, type FloorPlanReference, type ProjectDocument, type ProjectExperiment } from '../../../../packages/project'
import { clone } from '../lib/clone'
import type { BaselineState } from '../lib/workspace-types'

export type ExperimentOptions = {
  scene: Ref<Scene>
  settings: Ref<SolverSettings>
  referenceImage: Ref<FloorPlanReference | undefined>
  experiments: Ref<readonly ProjectExperiment[]>
  baseline: Ref<BaselineState>
  baselineExperimentId: Ref<string | null>
  disabled: Readonly<Ref<boolean>>
  currentDocument(): ProjectDocument
  commit(action: () => void): void
  onLoaded(): void
  onComputeChange(): void
}

/** Validate full project candidates before committing any library or working-state change. */
export function useExperiments(options: ExperimentOptions) {
  const error = ref('')
  const notice = ref('')

  function run(action: () => void) {
    error.value = ''; notice.value = ''
    if (options.disabled.value) { error.value = 'Finish the current project action before using experiments.'; return }
    try { action() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not update experiments.' }
  }
  function find(id: string): ProjectExperiment {
    const experiment = options.experiments.value.find(item => item.id === id)
    if (!experiment) throw new Error('The saved experiment could not be found.')
    return experiment
  }
  function candidate(changes: Record<string, unknown>): ProjectDocument {
    return validateProjectDocument({ ...options.currentDocument(), ...changes })
  }
  function installCatalog(document: ProjectDocument) {
    options.experiments.value = document.experiments
    options.baselineExperimentId.value = document.baselineExperimentId ?? null
  }
  function newId() { return globalThis.crypto?.randomUUID?.() ?? `experiment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }

  function save(payload: { name: string; notes: string }) { run(() => {
    const experiment = captureExperiment({ id: newId(), ...payload, scene: options.scene.value, settings: options.settings.value, ...(options.referenceImage.value ? { referenceImage: options.referenceImage.value } : {}) })
    const document = candidate({ experiments: [...options.experiments.value, experiment] })
    options.commit(() => installCatalog(document))
    notice.value = `Saved “${experiment.name}”.`
  }) }

  function update(payload: { id: string; name: string; notes: string }) { run(() => {
    const original = find(payload.id)
    if (original.name === payload.name.trim() && original.notes === payload.notes) return
    const experiment = updateExperimentMetadata(original, payload)
    const document = candidate({ experiments: options.experiments.value.map(item => item.id === payload.id ? experiment : item) })
    options.commit(() => installCatalog(document))
    notice.value = `Updated “${experiment.name}”.`
  }) }

  function duplicate(id: string) { run(() => {
    const experiment = duplicateExperiment(find(id), newId(), options.experiments.value)
    const document = candidate({ experiments: [...options.experiments.value, experiment] })
    options.commit(() => installCatalog(document))
    notice.value = `Created “${experiment.name}”.`
  }) }

  function remove(id: string) { run(() => {
    const experiment = find(id)
    const document = candidate({ experiments: options.experiments.value.filter(item => item.id !== id), baselineExperimentId: options.baselineExperimentId.value === id ? undefined : options.baselineExperimentId.value ?? undefined })
    options.commit(() => installCatalog(document))
    notice.value = `Removed “${experiment.name}”. Undo restores it.`
  }) }

  function load(id: string) { run(() => {
    const experiment = find(id)
    const document = candidate({ scene: experiment.scene, settings: experiment.settings, referenceImage: experiment.referenceImage })
    options.commit(() => {
      options.scene.value = clone(document.scene as Scene)
      options.settings.value = clone(document.settings as SolverSettings)
      options.referenceImage.value = document.referenceImage
      options.onLoaded()
    })
    options.onComputeChange()
    notice.value = `Loaded “${experiment.name}”. Undo restores the previous workspace.`
  }) }

  function useBaseline(id: string) { run(() => {
    const experiment = find(id)
    if (options.baselineExperimentId.value === id) return
    const document = candidate({ baseline: { scene: experiment.scene, settings: experiment.settings, solverVersion: experiment.solverVersion }, baselineExperimentId: id })
    options.commit(() => {
      options.baseline.value = { scene: clone(document.baseline!.scene as Scene), settings: clone(document.baseline!.settings as SolverSettings), field: null }
      options.baselineExperimentId.value = id
    })
    options.onComputeChange()
    notice.value = `Baseline set to “${experiment.name}”. A/B requires compatible solver settings.`
  }) }

  return { error, notice, save, update, duplicate, remove, load, useBaseline }
}
