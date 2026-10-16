import { shallowRef, type ShallowRef } from 'vue'
import type { Scene } from '../../../../packages/engine'
import { clone } from '../lib/clone'
import type { HistoryChange, HistoryContext } from '../lib/workspace-types'

type HistoryEntry = { scene: Scene; change: HistoryChange | null }

export function useSceneHistory(
  scene: ShallowRef<Scene>,
  options: { restoreContext: (context: HistoryContext) => void; onRestore: () => void },
) {
  const undoStack = shallowRef<HistoryEntry[]>([])
  const redoStack = shallowRef<HistoryEntry[]>([])

  function record(previousScene: Scene, contextChange: HistoryChange | null = null) {
    undoStack.value = [...undoStack.value.slice(-99), { scene: clone(previousScene), change: contextChange ? clone(contextChange) : null }]
    redoStack.value = []
  }

  function commit(nextScene: Scene) {
    record(scene.value)
    scene.value = clone(nextScene)
  }

  function undo() {
    const entry = undoStack.value.at(-1)
    if (!entry) return
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value.slice(-99), { scene: clone(scene.value), change: entry.change ? clone(entry.change) : null }]
    scene.value = clone(entry.scene)
    if (entry.change) options.restoreContext(clone(entry.change.before))
    options.onRestore()
  }

  function redo() {
    const entry = redoStack.value.at(-1)
    if (!entry) return
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value.slice(-99), { scene: clone(scene.value), change: entry.change ? clone(entry.change) : null }]
    scene.value = clone(entry.scene)
    if (entry.change) options.restoreContext(clone(entry.change.after))
    options.onRestore()
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  return { undoStack, redoStack, commit, record, undo, redo, clear }
}
