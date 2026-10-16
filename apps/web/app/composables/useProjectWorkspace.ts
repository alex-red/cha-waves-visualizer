import { watch, type Ref } from 'vue'
import { createProject, parseProject, PROJECT_MAX_BYTES, serializeProject, type FloorPlanReference, type ProjectDocument, type ProjectExperiment } from '../../../../packages/project'
import type { RfSurvey } from '../../../../packages/survey'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import type { BaselineState } from '../lib/workspace-types'
import { loadProject, saveProject } from '../lib/project-storage'

type ProjectStatus = 'loading' | 'saved' | 'saving' | 'failed'
export type ProjectSource = 'home' | 'restore' | 'import'

export type ProjectWorkspaceOptions = {
  scene: Ref<Scene>
  settings: Ref<SolverSettings>
  baseline: Ref<BaselineState>
  referenceImage: Ref<FloorPlanReference | undefined>
  experiments: Ref<readonly ProjectExperiment[]>
  survey?: Ref<RfSurvey | null>
  baselineExperimentId: Ref<string | null>
  projectName: Ref<string>
  projectDoc: Ref<ProjectDocument | null>
  projectStatus: Ref<ProjectStatus>
  projectNotice: Ref<string>
  storageNotice: Ref<string>
  projectFlowGeneration: Ref<number>
  appMounted: Ref<boolean>
  drag: Ref<unknown | null>
  previewScene: Ref<Scene | null>
  onInstall(document: ProjectDocument, source: ProjectSource): void
}

/** Owns saved project documents and their browser persistence lifecycle. */
export function useProjectWorkspace(options: ProjectWorkspaceOptions) {
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  let autosaveChain: Promise<void> = Promise.resolve()
  let autosaveSequence = 0

  function currentDocument(): ProjectDocument {
    const fresh = createProject(
      options.scene.value,
      options.settings.value,
      options.baseline.value
        ? { scene: options.baseline.value.scene, settings: options.baseline.value.settings }
        : undefined,
      options.referenceImage.value,
      { experiments: options.experiments.value, ...(options.baselineExperimentId.value ? { baselineExperimentId: options.baselineExperimentId.value } : {}), ...(options.survey?.value ? { survey: options.survey.value } : {}) },
    )
    const previous = options.projectDoc.value
    return {
      ...fresh,
      metadata: {
        ...fresh.metadata,
        ...(previous ? { id: previous.metadata.id, createdAt: previous.metadata.createdAt } : {}),
        name: options.projectName.value.trim() || 'Untitled home',
      },
    }
  }

  function scheduleAutosave() {
    if (options.projectStatus.value === 'loading') return
    if (autosaveTimer) clearTimeout(autosaveTimer)
    const sequence = ++autosaveSequence
    options.projectStatus.value = 'saving'
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined
      if (!options.appMounted.value) return
      try {
        const document = currentDocument()
        options.projectDoc.value = document
        autosaveChain = autosaveChain.then(() => saveProject(document)).then(() => {
          if (options.appMounted.value && sequence === autosaveSequence) {
            options.projectStatus.value = 'saved'
            options.storageNotice.value = ''
          }
        }).catch(error => {
          if (options.appMounted.value && sequence === autosaveSequence) {
            options.projectStatus.value = 'failed'
            options.storageNotice.value = error instanceof Error ? error.message : 'Could not save this project locally.'
          }
        })
      } catch (error) {
        if (options.appMounted.value && sequence === autosaveSequence) {
          options.projectStatus.value = 'failed'
          options.storageNotice.value = error instanceof Error ? error.message : 'Could not prepare this project for local storage.'
        }
      }
    }, 250)
  }

  async function preserveCurrentProject() {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = undefined
    ++autosaveSequence
    const document = currentDocument()
    options.projectDoc.value = document
    await autosaveChain
    try {
      await saveProject(document)
      options.storageNotice.value = ''
      if (options.appMounted.value) options.projectStatus.value = 'saved'
    } catch (error) {
      options.storageNotice.value = error instanceof Error ? error.message : 'Could not save previous project. Export it before leaving if you need a backup.'
      throw error
    }
  }

  /** Install only a validated document; callers validate before invoking this method. */
  function installDocument(document: ProjectDocument, source: ProjectSource = 'home') {
    // Restore may finish while a user-selected import is still being read. Only
    // an explicit workspace replacement supersedes that pending user action.
    if (source !== 'restore') options.projectFlowGeneration.value++
    options.onInstall(document, source)
    options.projectDoc.value = document
    options.projectName.value = document.metadata.name
    options.referenceImage.value = document.referenceImage
    options.projectStatus.value = 'saved'
    if (source === 'import') {
      options.projectStatus.value = 'saving'
      options.projectNotice.value = 'Imported project replaces the current scene and its baseline.'
    }
    if (source !== 'restore') scheduleAutosave()
  }

  async function restoreProject(): Promise<void> {
    const flow = options.projectFlowGeneration.value
    try {
      const saved = await loadProject()
      if (!options.appMounted.value || flow !== options.projectFlowGeneration.value) return
      if (saved) installDocument(saved, 'restore')
      else {
        options.projectStatus.value = 'saved'
        scheduleAutosave()
      }
    } catch (error) {
      if (!options.appMounted.value || flow !== options.projectFlowGeneration.value) return
      options.projectStatus.value = 'failed'
      options.storageNotice.value = error instanceof Error ? error.message : 'Could not restore the saved local project.'
    }
  }

  async function importProjectFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const flow = options.projectFlowGeneration.value
    try {
      if (file.size > PROJECT_MAX_BYTES) throw new Error(`Project JSON exceeds the ${PROJECT_MAX_BYTES}-byte limit`)
      const text = await file.text()
      if (!options.appMounted.value || flow !== options.projectFlowGeneration.value) return
      const parsed = parseProject(text)
      installDocument(parsed, 'import')
    } catch (error) {
      if (options.appMounted.value && flow === options.projectFlowGeneration.value) {
        options.projectNotice.value = error instanceof Error ? `Import failed: ${error.message}` : 'Import failed. The current project is unchanged.'
      }
    } finally {
      input.value = ''
    }
  }

  function exportProjectFile(): void {
    if (options.projectStatus.value === 'loading' || options.drag.value || options.previewScene.value) {
      options.projectNotice.value = 'Finish the current project action before exporting.'
      return
    }
    try {
      const document = currentDocument()
      const blob = new Blob([serializeProject(document)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = `${options.scene.value.id}.cha-waves.json`
      anchor.click()
      URL.revokeObjectURL(url)
      options.projectDoc.value = document
      options.projectNotice.value = ''
    } catch (error) {
      options.projectNotice.value = error instanceof Error ? `Export failed: ${error.message}` : 'Could not export this project.'
    }
  }

  const stopAutosaveWatch = watch(
    [options.scene, options.settings, options.baseline, options.referenceImage, options.projectName, options.experiments, options.baselineExperimentId, ...(options.survey ? [options.survey] : [])],
    scheduleAutosave,
    { deep: false },
  )

  function dispose() {
    stopAutosaveWatch()
    ++autosaveSequence
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }

  return { currentDocument, scheduleAutosave, preserveCurrentProject, installDocument, restoreProject, importProjectFile, exportProjectFile, dispose }
}
