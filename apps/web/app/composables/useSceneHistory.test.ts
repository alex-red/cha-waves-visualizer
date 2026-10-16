import { describe, expect, it, vi } from 'vitest'
import { createDemoScene, defaultSettings, type FieldResult, type Scene } from '../../../../packages/engine'
import type { HistoryChange, HistoryContext } from '../lib/workspace-types'
import { useSceneHistory } from './useSceneHistory'

function field(value: number): FieldResult {
  return {
    identity: { workspaceGeneration: 0, requestId: 0, queryHash: 'history-test', solverId: 'acoustic-direct-v1', solverVersion: '1.0.0' },
    sceneRevision: 1,
    quantity: 'relative-direct-level-db',
    unit: 'dB',
    grid: { levelId: 'main', originXY: [0, 0], cols: 1, rows: 1, cellSizeM: 1, receiverZM: 1.5, quality: 'custom' },
    values: new Float32Array([value]),
    validity: new Uint8Array([1]),
    assumptions: [],
    computeMs: 0,
  }
}

function context(overrides: Partial<HistoryContext> = {}): HistoryContext {
  const settings = defaultSettings('acoustics')
  return {
    settings,
    domain: 'sound',
    baseline: { scene: createDemoScene(), settings, field: field(1) },
    selectedId: 'hallway-probe',
    selectedObjectId: 'hallway-probe',
    selectedDoorId: 'hall-door',
    referenceImage: undefined,
    ...overrides,
  }
}

function changedScene(scene: Scene, revision: number): Scene {
  return { ...scene, revision }
}

function sceneRef(scene: Scene): Parameters<typeof useSceneHistory>[0] {
  return { value: scene } as Parameters<typeof useSceneHistory>[0]
}

describe('useSceneHistory', () => {
  it('keeps the latest 100 undoable states and makes eviction visible through undo', () => {
    const scene = sceneRef(createDemoScene())
    const onRestore = vi.fn()
    const history = useSceneHistory(scene, { restoreContext: vi.fn(), onRestore })

    for (let revision = 2; revision <= 106; revision++) history.commit(changedScene(scene.value, revision))
    expect(history.undoStack.value).toHaveLength(100)

    for (let index = 0; index < 100; index++) history.undo()
    expect(scene.value.revision).toBe(6)
    expect(history.undoStack.value).toHaveLength(0)
    expect(onRestore).toHaveBeenCalledTimes(100)
    history.undo()
    expect(scene.value.revision).toBe(6)
    expect(onRestore).toHaveBeenCalledTimes(100)
  })

  it('does not call restoration callbacks for empty undo or redo stacks', () => {
    const scene = sceneRef(createDemoScene())
    const restoreContext = vi.fn()
    const onRestore = vi.fn()
    const history = useSceneHistory(scene, { restoreContext, onRestore })

    history.undo()
    history.redo()
    expect(scene.value.revision).toBe(1)
    expect(restoreContext).not.toHaveBeenCalled()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('drops redo states when a new edit follows undo', () => {
    const scene = sceneRef(createDemoScene())
    const history = useSceneHistory(scene, { restoreContext: vi.fn(), onRestore: vi.fn() })
    history.commit(changedScene(scene.value, 2))
    history.undo()
    expect(history.redoStack.value).toHaveLength(1)

    history.commit(changedScene(scene.value, 3))
    expect(scene.value.revision).toBe(3)
    expect(history.redoStack.value).toHaveLength(0)
    history.redo()
    expect(scene.value.revision).toBe(3)
  })

  it('restores guided context in both directions with isolated scenes and field buffers', () => {
    const beforeScene = createDemoScene()
    const afterScene = changedScene(beforeScene, 2)
    const currentScene = sceneRef(afterScene)
    const before = context({ selectedId: 'before-probe', selectedObjectId: 'before-object', baseline: { scene: beforeScene, settings: defaultSettings('acoustics'), field: field(11) } })
    const after = context({
      settings: defaultSettings('radio'),
      domain: 'wifi',
      selectedId: 'after-probe',
      selectedObjectId: 'after-object',
      selectedDoorId: 'after-door',
      baseline: { scene: afterScene, settings: defaultSettings('radio'), field: field(22) },
    })
    const received: HistoryContext[] = []
    const onRestore = vi.fn()
    const history = useSceneHistory(currentScene, { restoreContext: value => received.push(value), onRestore })
    const change: HistoryChange = { before, after }

    history.record(beforeScene, change)
    before.baseline!.field!.values[0] = 101
    after.baseline!.field!.values[0] = 202
    beforeScene.revision = 44

    history.undo()
    expect(currentScene.value.revision).toBe(1)
    expect(received[0]).toMatchObject({ domain: 'sound', selectedId: 'before-probe', selectedObjectId: 'before-object', selectedDoorId: 'hall-door' })
    expect(received[0]!.baseline!.field!.values[0]).toBe(11)
    received[0]!.baseline!.field!.values[0] = 303

    history.redo()
    expect(currentScene.value.revision).toBe(2)
    expect(received[1]).toMatchObject({ domain: 'wifi', settings: { mode: 'radio' }, selectedId: 'after-probe', selectedObjectId: 'after-object', selectedDoorId: 'after-door' })
    expect(received[1]!.baseline!.field!.values[0]).toBe(22)
    expect(received[1]!.baseline!.field!.validity).not.toBe(after.baseline!.field!.validity)
    expect(onRestore).toHaveBeenCalledTimes(2)
  })

  it('clears both directions after a project switch', () => {
    const scene = sceneRef(createDemoScene())
    const history = useSceneHistory(scene, { restoreContext: vi.fn(), onRestore: vi.fn() })
    history.commit(changedScene(scene.value, 2))
    history.undo()
    expect(history.undoStack.value).toHaveLength(0)
    expect(history.redoStack.value).toHaveLength(1)

    history.clear()
    expect(history.undoStack.value).toHaveLength(0)
    expect(history.redoStack.value).toHaveLength(0)
    history.redo()
    expect(scene.value.revision).toBe(1)
  })
})
