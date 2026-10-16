import { ref, type Ref } from 'vue'
import { applySceneCommand } from '../../../../packages/commands'
import type { Scene } from '../../../../packages/engine'
import type { MaterialUpdate } from '../../../../packages/materials'
import { serializeProject, type ProjectDocument } from '../../../../packages/project'

export function useMaterialEditing(inputs: {
  scene: Readonly<Ref<Scene>>
  disabled: Readonly<Ref<boolean>>
  currentDocument: () => ProjectDocument
  commit: (next: Scene) => void
}) {
  const error = ref('')
  const notice = ref('')
  function reset() { error.value = ''; notice.value = '' }
  function apply(update: MaterialUpdate): boolean {
    if (inputs.disabled.value) return false
    reset()
    try {
      const next = applySceneCommand(inputs.scene.value, { type: 'update-material', ...update })
      // Validate the whole portable project, including existing snapshots/images,
      // before recording history or scheduling autosave.
      serializeProject({ ...inputs.currentDocument(), scene: next })
      if (JSON.stringify(next.materials) === JSON.stringify(inputs.scene.value.materials)) {
        notice.value = 'This material already matches these values.'
        return true
      }
      inputs.commit(next)
      notice.value = 'Material applied. One Undo restores the previous profile.'
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not apply this material.'
      return false
    }
  }
  return { error, notice, reset, apply }
}
