import { ref, type Ref } from 'vue'
import { parseSurveyCsv, type RfSurvey } from '../../../../packages/survey'
import { validateProjectDocument, type ProjectDocument } from '../../../../packages/project'

/** Raw observations participate in project history; predictions remain derived. */
export function useSurvey(options: {
  survey: Ref<RfSurvey | null>
  disabled: Readonly<Ref<boolean>>
  currentDocument: () => ProjectDocument
  commit: (action: () => void) => void
}) {
  const error = ref('')
  const notice = ref('')
  function reset() { error.value = ''; notice.value = '' }
  function run(action: () => void): boolean {
    reset()
    if (options.disabled.value) { error.value = 'Finish the current project action before updating the survey.'; return false }
    try { action(); return true }
    catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not update the measurement survey.'; return false }
  }
  function importText(payload: { text: string; name: string; notes: string }): boolean {
    return run(() => {
      const survey = parseSurveyCsv(payload.text, {
        id: globalThis.crypto?.randomUUID?.() ?? `survey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        name: payload.name, notes: payload.notes, createdAt: new Date().toISOString(),
      })
      const candidate = validateProjectDocument({ ...options.currentDocument(), survey })
      options.commit(() => { options.survey.value = candidate.survey ?? null })
      notice.value = `Imported ${survey.observations.length} observations. One Undo restores the previous survey.`
    })
  }
  function remove(): boolean {
    return run(() => {
      if (!options.survey.value) { notice.value = 'There is no survey to remove.'; return }
      validateProjectDocument({ ...options.currentDocument(), survey: undefined })
      options.commit(() => { options.survey.value = null })
      notice.value = 'Survey removed. Undo restores the observations.'
    })
  }
  return { error, notice, reset, importText, remove }
}
