import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import type { PlacementCandidate, PlacementOptions, PlacementResult } from '../../../../packages/placement'
import type { PlacementRequest, PlacementResponse } from '../lib/placement-protocol'

type Inputs = {
  scene: Ref<Scene>
  settings: Ref<SolverSettings>
  disabled: Readonly<Ref<boolean>>
  commit: (candidate: PlacementCandidate, sourceId: string) => boolean
}

/** Search state is ephemeral. Only an accepted position reaches scene history. */
export function usePlacementSearch(inputs: Inputs) {
  const result = shallowRef<PlacementResult | null>(null)
  const running = ref(false)
  const progress = shallowRef({ done: 0, total: 0 })
  const error = ref('')
  const notice = ref('')
  const options = shallowRef<PlacementOptions | null>(null)
  // Probe positions are deliberately included: the field query hash omits them.
  const signature = computed(() => JSON.stringify([inputs.scene.value, inputs.settings.value, options.value]))
  let worker: Worker | null = null
  let requestId = 0
  let acceptedSignature = ''
  let disposed = false

  function stop() {
    worker?.terminate()
    worker = null
    running.value = false
  }
  function invalidate() {
    stop()
    result.value = null
    acceptedSignature = ''
    error.value = ''; notice.value = ''
    progress.value = { done: 0, total: 0 }
  }
  const stopInputs = watch(signature, invalidate, { flush: 'sync' })
  const stopDisabled = watch(inputs.disabled, disabled => { if (disabled) invalidate() }, { flush: 'sync' })

  function configure(next: PlacementOptions) {
    const copy = { ...next, probeIds: [...next.probeIds] }
    if (JSON.stringify(options.value) !== JSON.stringify(copy)) options.value = copy
  }
  function cancel() {
    if (!running.value) return
    invalidate()
    notice.value = 'Placement search cancelled. You can start another search.'
  }
  function run() {
    if (disposed || inputs.disabled.value || !options.value) return
    invalidate()
    const startedSignature = signature.value
    const id = ++requestId
    let active: Worker
    const current = () => !disposed && worker === active && id === requestId && signature.value === startedSignature && !inputs.disabled.value
    const fail = (message: string) => {
      if (!current()) return
      stop(); error.value = message
    }
    try {
      active = new Worker(new URL('../workers/placement.worker.ts', import.meta.url), { type: 'module' })
      worker = active
      running.value = true
      active.onmessage = ({ data }: MessageEvent<PlacementResponse>) => {
        if (!current() || data.id !== id) return
        if (data.type === 'progress') {
          if (Number.isFinite(data.done) && Number.isFinite(data.total) && data.total > 0) progress.value = { done: Math.max(0, Math.min(data.done, data.total)), total: data.total }
        } else if (data.type === 'error') fail(data.error)
        else if (data.type === 'result') {
          acceptedSignature = startedSignature
          result.value = data.result
          stop()
        }
      }
      active.onerror = event => { event.preventDefault(); fail('Placement search failed. Try finding positions again.') }
      active.onmessageerror = () => fail('Could not read placement results. Try finding positions again.')
      const request: PlacementRequest = { id, scene: inputs.scene.value, settings: inputs.settings.value, options: options.value }
      active.postMessage(request)
    } catch (cause) {
      stop()
      error.value = cause instanceof Error ? cause.message : 'Could not start placement search'
    }
  }
  function apply(candidate: PlacementCandidate): boolean {
    const accepted = result.value
    if (disposed || inputs.disabled.value || running.value || !accepted || signature.value !== acceptedSignature || !accepted.candidates.includes(candidate)) return false
    const source = inputs.scene.value.emitters.find(item => item.active && item.domain === inputs.settings.value.mode)
    if (!source || source.id !== accepted.sourceId || candidate.position.length !== 3 || !candidate.position.every(Number.isFinite) || candidate.position[2] !== source.position[2] || candidate.position.every((value, index) => value === source.position[index])) return false
    return inputs.commit(candidate, source.id)
  }
  function dispose() { disposed = true; stopInputs(); stopDisabled(); invalidate() }
  return { result, running, progress, error, notice, configure, run, cancel, apply, dispose }
}
