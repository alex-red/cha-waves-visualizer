import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'
import { createDemoScene, defaultSettings } from '../../../../packages/engine'
import { createProject, serializeProject } from '../../../../packages/project'
import type { ProjectDocument } from '../../../../packages/project'
import { loadProject, saveProject } from '../lib/project-storage'
import { useProjectWorkspace, type ProjectWorkspaceOptions } from './useProjectWorkspace'

vi.mock('../lib/project-storage', () => ({ loadProject: vi.fn(), saveProject: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

function document(name: string): ProjectDocument {
  const project = createProject(createDemoScene(), defaultSettings('acoustics'))
  return { ...project, metadata: { ...project.metadata, name } }
}

function workspace() {
  const onInstall = vi.fn()
  const options: ProjectWorkspaceOptions = {
    scene: shallowRef(createDemoScene()), settings: shallowRef(defaultSettings('acoustics')),
    baseline: shallowRef(null), referenceImage: shallowRef(undefined),
    experiments: shallowRef([]), baselineExperimentId: ref(null),
    projectName: ref('Initial home'), projectDoc: shallowRef(null), projectStatus: ref('loading'),
    projectNotice: ref(''), storageNotice: ref(''), projectFlowGeneration: ref(0), appMounted: ref(true),
    drag: shallowRef(null), previewScene: shallowRef(null), onInstall,
  }
  const service = useProjectWorkspace(options)
  return { service, options, onInstall }
}

const disposers: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(saveProject).mockResolvedValue(undefined)
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.useRealTimers()
})

describe('project workspace installation ordering', () => {
  it('finishes a user-selected import even when startup restore finishes during its file read', async () => {
    const restored = deferred<ProjectDocument | null>(), text = deferred<string>()
    vi.mocked(loadProject).mockReturnValue(restored.promise)
    const { service, options, onInstall } = workspace()
    disposers.push(service.dispose)
    const restoring = service.restoreProject()
    const input = { files: [{ size: 100, text: () => text.promise }], value: 'selected-file' }
    const importing = service.importProjectFile({ target: input } as unknown as Event)

    restored.resolve(document('Saved home'))
    await restoring
    expect(options.projectName.value).toBe('Saved home')
    text.resolve(serializeProject(document('Imported home')))
    await importing

    expect(options.projectName.value).toBe('Imported home')
    expect(onInstall.mock.calls.map(call => call[1])).toEqual(['restore', 'import'])
    expect(input.value).toBe('')
  })

  it('ignores a late startup restore after an explicit home switch', async () => {
    const restored = deferred<ProjectDocument | null>()
    vi.mocked(loadProject).mockReturnValue(restored.promise)
    const { service, options, onInstall } = workspace()
    disposers.push(service.dispose)
    const restoring = service.restoreProject()
    service.installDocument(document('New home'), 'home')
    restored.resolve(document('Old saved home'))
    await restoring

    expect(options.projectName.value).toBe('New home')
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it('suppresses late restore and scheduled saves when its owner unmounts', async () => {
    const restored = deferred<ProjectDocument | null>()
    vi.mocked(loadProject).mockReturnValue(restored.promise)
    const { service, options, onInstall } = workspace()
    disposers.push(service.dispose)
    const restoring = service.restoreProject()
    options.projectStatus.value = 'saved'
    options.projectName.value = 'Pending edit'
    await nextTick()
    options.appMounted.value = false
    options.projectFlowGeneration.value++
    service.dispose()
    restored.resolve(document('Late home'))
    await restoring
    await vi.advanceTimersByTimeAsync(300)

    expect(onInstall).not.toHaveBeenCalled()
    expect(saveProject).not.toHaveBeenCalled()
    expect(options.projectName.value).toBe('Pending edit')
  })
})
