import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { createDemoScene, defaultSettings, type Scene, type SolverSettings } from '../../../../packages/engine'
import { createProject, type ProjectDocument } from '../../../../packages/project'
import { exportSurveyCsv, validateSurvey, type RfSurvey } from '../../../../packages/survey'
import { clone } from '../lib/clone'
import type { HistoryContext } from '../lib/workspace-types'
import { useSceneHistory } from './useSceneHistory'
import { useSurvey } from './useSurvey'

const metadata = { id: 'source-survey', name: 'Walk', notes: 'Imported notes', createdAt: '2026-10-15T12:00:00.000Z' }

function makeSurvey(scene: Scene, settings: SolverSettings): RfSurvey {
  const source = scene.emitters.find(emitter => emitter.domain === 'radio')!
  return validateSurvey({
    ...metadata,
    context: { sceneId: scene.id, levelId: source.levelId, frequencyHz: settings.frequencyHz, sourceId: source.id, sourcePosition: [...source.position], eirpDbm: source.eirpDbm },
    observations: [{ id: 'reading-1', label: 'Kitchen', position: [3, 7, 1.5], rssiDbm: -48 }],
  })
}

function workspace(initialSurvey: RfSurvey | null = null) {
  const scene = shallowRef(createDemoScene())
  const settings = shallowRef<SolverSettings>(defaultSettings('radio'))
  const survey = shallowRef(initialSurvey)
  const disabled = ref(false)
  const onComputeChange = vi.fn()
  const history = useSceneHistory(scene, { onRestore: onComputeChange, restoreContext: context => {
    settings.value = context.settings
    survey.value = context.survey ?? null
  } })
  function context(): HistoryContext {
    return {
      settings: settings.value, domain: 'wifi', baseline: null, selectedId: '', selectedObjectId: '', selectedDoorId: '',
      referenceImage: undefined, survey: survey.value,
    }
  }
  const currentDocument = () => createProject(scene.value, settings.value, undefined, undefined, { ...(survey.value ? { survey: survey.value } : {}) })
  const service = useSurvey({ survey, disabled, currentDocument, commit: action => {
    const previousScene = clone(scene.value), before = clone(context())
    action()
    history.record(previousScene, { before, after: context() })
  } })
  return { scene, settings, survey, disabled, currentDocument, service, history, onComputeChange }
}

function validCsv(scene: Scene, settings: SolverSettings) {
  return exportSurveyCsv(makeSurvey(scene, settings))
}

describe('RF survey workspace actions', () => {
  it('imports raw observations as one undoable project change and restores them on redo', () => {
    const state = workspace()
    const originalScene = clone(state.scene.value), originalSettings = clone(state.settings.value)
    expect(state.service.importText({ text: validCsv(state.scene.value, state.settings.value), name: 'Imported walk', notes: 'North wing' })).toBe(true)
    expect(state.survey.value).toMatchObject({ name: 'Imported walk', notes: 'North wing', observations: [{ id: 'reading-1', rssiDbm: -48 }] })
    expect(state.history.undoStack.value).toHaveLength(1)
    expect(state.currentDocument().survey).toEqual(state.survey.value)
    expect(state.survey.value?.observations[0]).not.toHaveProperty('predictedDbm')
    expect(state.survey.value?.observations[0]).not.toHaveProperty('residualDb')
    expect(state.scene.value).toEqual(originalScene)
    expect(state.settings.value).toEqual(originalSettings)

    state.history.undo()
    expect(state.survey.value).toBeNull()
    state.history.redo()
    expect(state.survey.value?.observations[0]?.rssiDbm).toBe(-48)
    expect(state.onComputeChange).toHaveBeenCalledTimes(2)
  })

  it('removes a survey in one history entry and restores it on undo', () => {
    const imported = makeSurvey(createDemoScene(), defaultSettings('radio'))
    const state = workspace(imported)
    expect(state.service.remove()).toBe(true)
    expect(state.survey.value).toBeNull()
    expect(state.history.undoStack.value).toHaveLength(1)
    state.history.undo()
    expect(state.survey.value).toEqual(imported)
    expect(state.history.redoStack.value).toHaveLength(1)
  })

  it('rejects malformed and mixed-context CSV without changing the survey or history', () => {
    const existing = makeSurvey(createDemoScene(), defaultSettings('radio'))
    const state = workspace(existing)
    const before = state.currentDocument(), historyBefore = state.history.undoStack.value
    const mixed = `${validCsv(state.scene.value, state.settings.value).trimEnd()}\nreading-2,Hall,4,8,1.5,-50,5000000000,${existing.context.sceneId},${existing.context.levelId},${existing.context.sourceId},${existing.context.sourcePosition.join(',')},${existing.context.eirpDbm}`
    expect(state.service.importText({ text: mixed, name: 'Rejected', notes: '' })).toBe(false)
    expect(state.service.error.value).toMatch(/context/i)
    expect(state.survey.value).toEqual(existing)
    expect(state.currentDocument().scene).toEqual(before.scene)
    expect(state.currentDocument().settings).toEqual(before.settings)
    expect(state.currentDocument().survey).toEqual(before.survey)
    expect(state.history.undoStack.value).toBe(historyBefore)

    expect(state.service.importText({ text: 'id,label,x_m', name: 'Malformed', notes: '' })).toBe(false)
    expect(state.survey.value).toEqual(existing)
    expect(state.history.undoStack.value).toBe(historyBefore)
  })

  it('validates the complete candidate project before adding a history entry', () => {
    const state = workspace()
    const validProject = state.currentDocument()
    const invalidProject = {
      ...validProject,
      experiments: [
        { id: 'same', name: 'One', notes: '', createdAt: metadata.createdAt, updatedAt: metadata.createdAt, scene: state.scene.value, settings: state.settings.value, solverVersion: validProject.solverVersion },
        { id: 'same', name: 'Two', notes: '', createdAt: metadata.createdAt, updatedAt: metadata.createdAt, scene: state.scene.value, settings: state.settings.value, solverVersion: validProject.solverVersion },
      ],
    } as ProjectDocument
    const currentDocument = () => invalidProject
    const service = useSurvey({ survey: state.survey, disabled: state.disabled, currentDocument, commit: action => {
      const before = clone({ ...state.scene.value })
      action()
      state.history.record(before)
    } })

    expect(service.importText({ text: validCsv(state.scene.value, state.settings.value), name: 'Should fail', notes: '' })).toBe(false)
    expect(service.error.value).toMatch(/unique/i)
    expect(state.survey.value).toBeNull()
    expect(state.history.undoStack.value).toHaveLength(0)
  })

  it('blocks import and removal while the workspace is disabled', () => {
    const state = workspace()
    state.disabled.value = true
    expect(state.service.importText({ text: validCsv(state.scene.value, state.settings.value), name: 'Blocked', notes: '' })).toBe(false)
    expect(state.service.remove()).toBe(false)
    expect(state.service.error.value).toMatch(/Finish/)
    expect(state.survey.value).toBeNull()
    expect(state.history.undoStack.value).toHaveLength(0)
  })

  it('does not alter solver inputs or trigger field recomputation', () => {
    const state = workspace()
    const sceneBefore = clone(state.scene.value), settingsBefore = clone(state.settings.value)
    state.service.importText({ text: validCsv(state.scene.value, state.settings.value), name: 'Raw measurements', notes: '' })
    expect(state.scene.value).toEqual(sceneBefore)
    expect(state.settings.value).toEqual(settingsBefore)
    expect(state.onComputeChange).not.toHaveBeenCalled()
  })
})
