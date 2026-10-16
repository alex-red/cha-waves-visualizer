import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { clone } from '../lib/clone'
import type { BaselineState, SceneDrag } from '../lib/workspace-types'
import { planSceneSampling } from '../../../../packages/sampling'
import type { FieldResult, Scene, SolverSettings } from '../../../../packages/engine'

type Quality = 'preview' | 'balanced'
type Lane = 'working' | 'baseline'
type WorkerMessage = { id: number; lane: Lane; quality: Quality; result?: FieldResult; error?: string }

type FieldJobsOptions = {
  scene: ShallowRef<Scene>
  settings: ShallowRef<SolverSettings>
  baseline: ShallowRef<BaselineState>
  previewScene: ShallowRef<Scene | null>
  drag: ShallowRef<SceneDrag | null>
  canvas: Ref<HTMLCanvasElement | null>
  fixedReceiverHeightAboveFloor: number
  inspectProbe: () => void
  draw: () => void
}

export function useFieldJobs(options: FieldJobsOptions) {
  const field = shallowRef<FieldResult | null>(null)
  const previewField = shallowRef<FieldResult | null>(null)
  const previewRequestId = ref(0)
  const activeQuality = ref<Quality>('balanced')
  const acceptedQuality = ref<Quality | null>(null)
  const acceptedStep = ref<number | null>(null)
  const lastComputeMs = ref<number | null>(null)
  const lastRequestToPaintMs = ref<number | null>(null)
  const previewVersion = ref(0)
  const busy = ref(false)
  const workerError = ref('')
  const worker = shallowRef<Worker | null>(null)
  const requestId = ref(0)
  const ready = ref(false)
  const generation = ref(0)
  const activeBaselineRequest = ref(0)
  const activeFieldRequest = ref(0)

  let previewTimer: ReturnType<typeof setTimeout> | undefined
  let latestPreviewScene: Scene | null = null
  let latestPreviewIntent = 0
  let disposed = false
  const requestStartedAt = new Map<number, number>()
  const requestGenerations = new Map<number, number>()
  const requestPreviewVersions = new Map<number, number>()

  function invalidateWorkerRequests() {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = undefined
    latestPreviewScene = null
    latestPreviewIntent++
    generation.value++
    previewVersion.value++
    previewRequestId.value = 0
    activeFieldRequest.value = 0
    activeBaselineRequest.value = 0
    requestGenerations.clear()
    requestPreviewVersions.clear()
    requestStartedAt.clear()
    try {
      if (options.drag.value && options.canvas.value?.hasPointerCapture(options.drag.value.pointerId)) {
        options.canvas.value.releasePointerCapture(options.drag.value.pointerId)
      }
    } catch { /* Pointer capture may already have been lost alongside the worker. */ }
    options.drag.value = null
    options.previewScene.value = null
    previewField.value = null
    field.value = null
    acceptedQuality.value = null
    acceptedStep.value = null
    lastComputeMs.value = null
    lastRequestToPaintMs.value = null
    busy.value = false
  }

  function fieldWorkerFailed(message: string, failedWorker?: Worker) {
    if (failedWorker && worker.value !== failedWorker) return
    invalidateWorkerRequests()
    const crashedWorker = worker.value
    worker.value = null
    crashedWorker?.terminate()
    workerError.value = message
    options.inspectProbe()
    options.draw()
  }

  function handleWorker(event: MessageEvent<WorkerMessage>) {
    if (disposed) return
    const message = event.data
    if (message.id === activeBaselineRequest.value && message.lane === 'baseline') {
      if (message.error) {
        workerError.value = message.error
        requestGenerations.delete(message.id)
        requestStartedAt.delete(message.id)
        return
      }
      const received = message.result
      if (!received || received.identity.requestId !== message.id
        || received.identity.workspaceGeneration !== requestGenerations.get(message.id)) return
      if (options.baseline.value) options.baseline.value = { ...options.baseline.value, field: received }
      requestGenerations.delete(message.id)
      requestStartedAt.delete(message.id)
      options.draw()
      return
    }
    const expectedQuality = message.quality
    const expectedId = expectedQuality === 'preview' ? previewRequestId.value : activeFieldRequest.value
    if (message.id !== expectedId || message.lane !== 'working' || expectedQuality !== activeQuality.value) return
    if (message.error) { busy.value = false; workerError.value = message.error; return }
    const received = message.result
    if (!received || received.identity.requestId !== message.id
      || received.identity.workspaceGeneration !== requestGenerations.get(message.id)) return
    if (expectedQuality === 'preview' && requestPreviewVersions.get(message.id) !== previewVersion.value) return
    busy.value = false
    lastComputeMs.value = received.computeMs
    const started = requestStartedAt.get(message.id)
    const acceptedPreviewIntent = requestPreviewVersions.get(message.id)
    requestStartedAt.delete(message.id)
    requestGenerations.delete(message.id)
    requestPreviewVersions.delete(message.id)
    if (expectedQuality === 'preview') previewField.value = received
    else { field.value = received; acceptedQuality.value = 'balanced'; acceptedStep.value = received.grid.cellSizeM; previewField.value = null }
    ready.value = true
    options.inspectProbe()
    requestAnimationFrame(() => {
      const stillCurrent = message.id === (expectedQuality === 'preview' ? previewRequestId.value : activeFieldRequest.value)
        && expectedQuality === activeQuality.value
        && (expectedQuality !== 'preview' || acceptedPreviewIntent === previewVersion.value)
      if (!stillCurrent || disposed) return
      options.draw()
      if (started !== undefined) lastRequestToPaintMs.value = performance.now() - started
      window.dispatchEvent(new CustomEvent('cha-waves:field-diagnostic', { detail: {
        quality: expectedQuality,
        computeMs: received.computeMs,
        requestToPaintMs: lastRequestToPaintMs.value,
        requestId: message.id,
        queryHash: received.identity.queryHash,
        solverId: received.identity.solverId,
        solverVersion: received.identity.solverVersion,
        sceneRevision: received.sceneRevision,
        grid: received.grid,
      } }))
    })
  }

  function createFieldWorker() {
    if (disposed) throw new Error('Field jobs have been disposed')
    const createdWorker = new Worker(new URL('../workers/field.worker.ts', import.meta.url), { type: 'module' })
    createdWorker.onmessage = handleWorker
    createdWorker.onerror = event => {
      event.preventDefault()
      fieldWorkerFailed('The field worker stopped unexpectedly. Restart the calculation to try again.', createdWorker)
    }
    createdWorker.addEventListener('messageerror', () => fieldWorkerFailed('The field worker returned a message that could not be read. Restart the calculation to try again.', createdWorker))
    worker.value = createdWorker
  }

  function restartFieldWorker() {
    invalidateWorkerRequests()
    const previousWorker = worker.value
    worker.value = null
    previousWorker?.terminate()
    workerError.value = ''
    try {
      createFieldWorker()
      requestField(true)
    } catch (error) {
      fieldWorkerFailed(error instanceof Error ? `Could not restart the field worker: ${error.message}` : 'This browser could not restart the local field worker.')
    }
  }

  function fieldSamplingStep(targetScene: Scene, quality: Quality) {
    const samplingScenes = [targetScene, options.scene.value]
    if (options.baseline.value) samplingScenes.push(options.baseline.value.scene)
    return planSceneSampling(samplingScenes, quality === 'preview' ? 0.5 : 0.25).stepM
  }

  function postField(targetScene: Scene, quality: Quality, lane: Lane = 'working', previewIntent?: number) {
    if (!worker.value) return
    const currentGeneration = ++generation.value
    const id = ++requestId.value
    requestGenerations.set(id, currentGeneration)
    if (lane === 'working') {
      requestPreviewVersions.delete(activeFieldRequest.value)
      requestGenerations.delete(activeFieldRequest.value)
      requestGenerations.set(id, currentGeneration)
      if (previewIntent !== undefined) requestPreviewVersions.set(id, previewIntent)
      activeFieldRequest.value = id
      activeQuality.value = quality
    } else {
      requestGenerations.delete(activeBaselineRequest.value)
      activeBaselineRequest.value = id
    }
    if (lane === 'working' && quality === 'preview') previewRequestId.value = id
    if (lane === 'working') requestStartedAt.clear()
    try {
      const step = fieldSamplingStep(targetScene, quality)
      const startedAt = performance.now()
      requestStartedAt.set(id, startedAt)
      worker.value.postMessage({
        id, lane, quality, scene: clone(targetScene),
        settings: clone(lane === 'baseline' && options.baseline.value ? options.baseline.value.settings : options.settings.value),
        options: { step, receiverZ: (targetScene.levels[0]?.floorZ ?? 0) + options.fixedReceiverHeightAboveFloor, workspaceGeneration: currentGeneration, requestId: id },
      })
      if (lane === 'working') {
        if (quality === 'preview') previewField.value = null
        else { field.value = null; acceptedQuality.value = null; acceptedStep.value = null }
        busy.value = true
        workerError.value = ''
      }
    } catch (error) {
      requestGenerations.delete(id)
      requestPreviewVersions.delete(id)
      requestStartedAt.delete(id)
      if (lane === 'working') {
        busy.value = false
        if (quality === 'preview') previewField.value = null
        else { field.value = null; acceptedQuality.value = null; acceptedStep.value = null }
      }
      workerError.value = error instanceof Error ? error.message : 'Could not prepare the field calculation.'
    }
  }

  function requestField(rebuildBaseline = false) {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = undefined
    latestPreviewScene = null
    previewField.value = null
    postField(options.scene.value, 'balanced')
    if (rebuildBaseline) {
      invalidateBaselineRequest()
      if (options.baseline.value) options.baseline.value = { ...options.baseline.value, field: null }
    }
    const savedBaseline = options.baseline.value
    if (!savedBaseline) return
    let samplingChanged = false
    try { samplingChanged = savedBaseline.field?.grid.cellSizeM !== fieldSamplingStep(options.scene.value, 'balanced') }
    catch { /* postField reports invalid sampling extents through the worker error state. */ }
    if (rebuildBaseline || !savedBaseline.field || samplingChanged) {
      options.baseline.value = { ...savedBaseline, field: null }
      postField(savedBaseline.scene, 'balanced', 'baseline')
    }
  }

  function schedulePreview(targetScene: Scene, intent: number) {
    latestPreviewScene = targetScene
    latestPreviewIntent = intent
    if (previewTimer) return
    previewTimer = setTimeout(() => {
      previewTimer = undefined
      const snapshot = latestPreviewScene
      if (options.drag.value?.valid && options.previewScene.value && snapshot) postField(snapshot, 'preview', 'working', latestPreviewIntent)
    }, 80)
  }

  function clearScheduledPreview() {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = undefined
    latestPreviewScene = null
  }

  function cancelWorkingJobs() {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = undefined
    latestPreviewScene = null
    previewVersion.value++
    previewRequestId.value = 0
    busy.value = false
    if (activeFieldRequest.value) worker.value?.postMessage({ type: 'cancel', id: activeFieldRequest.value })
  }

  function invalidateBaselineRequest() {
    requestGenerations.delete(activeBaselineRequest.value)
    requestStartedAt.delete(activeBaselineRequest.value)
    activeBaselineRequest.value = 0
  }

  function dispose() {
    if (disposed) return
    disposed = true
    invalidateWorkerRequests()
    worker.value?.terminate()
    worker.value = null
  }

  return {
    field, previewField, previewRequestId, activeQuality, acceptedQuality, acceptedStep,
    lastComputeMs, lastRequestToPaintMs, previewVersion, busy, workerError, requestId,
    ready, generation, activeBaselineRequest, activeFieldRequest,
    createFieldWorker, requestField, restartFieldWorker, schedulePreview, cancelWorkingJobs,
    clearScheduledPreview, invalidateBaselineRequest, dispose,
  }
}
