import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createDemoScene, defaultSettings, type Scene, type SolverSettings } from '../../../../packages/engine'
import type { PlacementCandidate, PlacementOptions, PlacementResult } from '../../../../packages/placement'
import type { PlacementResponse } from '../lib/placement-protocol'
import { usePlacementSearch } from './usePlacementSearch'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<PlacementResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  messages: unknown[] = []
  terminated = false

  constructor() { FakeWorker.instances.push(this) }
  postMessage(message: unknown) { this.messages.push(message) }
  terminate() { this.terminated = true }
  reply(data: PlacementResponse) { this.onmessage?.({ data } as MessageEvent<PlacementResponse>) }
  fail(message = 'worker failed') {
    const event = { message, preventDefault: vi.fn() } as unknown as ErrorEvent
    this.onerror?.(event)
  }
}

const options: PlacementOptions = { probeIds: ['hallway-probe'], objective: 'maximize-weakest', maxCandidates: 16 }

function candidate(position: [number, number, number] = [5, 7, 1.2]): PlacementCandidate {
  return { position, score: -12, weakest: -12, loudest: -12, distanceM: 3, readings: [{ id: 'hallway-probe', name: 'Across the hall', valid: true, value: -12 }] }
}

function result(value = candidate()): PlacementResult {
  return {
    sourceId: 'speaker', objective: 'maximize-weakest', unit: 'dB',
    baseline: { position: [2, 7.8, 1.2], score: -20, readings: [{ id: 'hallway-probe', name: 'Across the hall', valid: true, value: -20 }] },
    candidates: [value], sampledCount: 16, validCount: 1, excludedPlacementCount: 0, excludedEstimateCount: 0, spacingM: [2, 2],
  }
}

function setup() {
  const scene = ref<Scene>(createDemoScene())
  const settings = ref<SolverSettings>(defaultSettings('acoustics'))
  const disabled = ref(false)
  const commit = vi.fn((position: PlacementCandidate, sourceId: string) => {
    scene.value = { ...scene.value, emitters: scene.value.emitters.map(emitter => emitter.id === sourceId ? { ...emitter, position: position.position } : emitter) }
    return true
  })
  const search = usePlacementSearch({ scene, settings, disabled, commit })
  search.configure(options)
  return { scene, settings, disabled, commit, search }
}

function installWorker() {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
}

function complete(worker: FakeWorker, id: number, answer = result()) {
  worker.reply({ id, type: 'result', result: answer })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('usePlacementSearch', () => {
  it.each(['scene', 'probes', 'settings', 'options'] as const)('discards a reply after %s changes', changed => {
    installWorker()
    const { scene, settings, search, commit } = setup()
    search.run()
    const worker = FakeWorker.instances[0]!
    const id = (worker.messages[0] as { id: number }).id

    if (changed === 'scene') scene.value = { ...scene.value, revision: scene.value.revision + 1 }
    if (changed === 'probes') scene.value = { ...scene.value, probes: scene.value.probes.map(probe => ({ ...probe, position: [probe.position[0] + 1, probe.position[1], probe.position[2]] as [number, number, number] })) }
    if (changed === 'settings') settings.value = { ...settings.value, frequencyHz: settings.value.frequencyHz + 100 }
    if (changed === 'options') search.configure({ ...options, maxCandidates: options.maxCandidates + 1 })

    expect(worker.terminated).toBe(true)
    expect(search.running.value).toBe(false)
    expect(search.result.value).toBeNull()
    complete(worker, id)
    expect(search.result.value).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })

  it('reports progress, stores a current result, and leaves scene mutation to the apply callback', () => {
    installWorker()
    const { scene, search, commit } = setup()
    const before = JSON.stringify(scene.value)
    search.run()
    const worker = FakeWorker.instances[0]!
    const id = (worker.messages[0] as { id: number }).id
    worker.reply({ id, type: 'progress', done: 80, total: 16 })
    expect(search.progress.value).toEqual({ done: 16, total: 16 })
    complete(worker, id)

    expect(search.running.value).toBe(false)
    expect(search.result.value).toEqual(result())
    expect(JSON.stringify(scene.value)).toBe(before)
    expect(commit).not.toHaveBeenCalled()
    const acceptedCandidate = search.result.value!.candidates[0]!
    expect(search.apply({ ...candidate() })).toBe(false)
    expect(search.apply(acceptedCandidate)).toBe(true)
    expect(commit).toHaveBeenCalledWith(acceptedCandidate, 'speaker')
    expect(scene.value.emitters.find(emitter => emitter.id === 'speaker')!.position).toEqual([5, 7, 1.2])
    expect(JSON.stringify(scene.value)).not.toBe(before)
  })

  it('cancels an active run, ignores its late result, and allows a fresh run', () => {
    installWorker()
    const { search, commit } = setup()
    search.run()
    const cancelled = FakeWorker.instances[0]!
    const oldId = (cancelled.messages[0] as { id: number }).id
    search.cancel()
    expect(cancelled.terminated).toBe(true)
    expect(search.notice.value).toContain('cancelled')
    complete(cancelled, oldId)
    expect(search.result.value).toBeNull()

    search.run()
    const retry = FakeWorker.instances[1]!
    complete(retry, (retry.messages[0] as { id: number }).id)
    expect(search.result.value).not.toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })

  it('recovers from worker failures and reports constructor failures', () => {
    installWorker()
    const { search } = setup()
    search.run()
    const crashed = FakeWorker.instances[0]!
    crashed.fail()
    expect(crashed.terminated).toBe(true)
    expect(search.error.value).toContain('failed')
    search.run()
    const retry = FakeWorker.instances[1]!
    complete(retry, (retry.messages[0] as { id: number }).id)
    expect(search.result.value).not.toBeNull()

    vi.stubGlobal('Worker', class { constructor() { throw new Error('worker unavailable') } })
    search.run()
    expect(search.running.value).toBe(false)
    expect(search.error.value).toBe('worker unavailable')
  })

  it('rejects stale, malformed, disabled, and disposed candidates without committing', () => {
    installWorker()
    const { scene, disabled, commit, search } = setup()
    search.run()
    const worker = FakeWorker.instances[0]!
    const id = (worker.messages[0] as { id: number }).id
    complete(worker, id)
    const accepted = search.result.value!.candidates[0]!

    const originalPosition = [...accepted.position] as [number, number, number]
    accepted.position[0] = Number.NaN
    expect(search.apply(accepted)).toBe(false)
    accepted.position = [5, 7, 9]
    expect(search.apply(accepted)).toBe(false)
    accepted.position = [2, 7.8, 1.2]
    expect(search.apply(accepted)).toBe(false)
    accepted.position = originalPosition
    disabled.value = true
    expect(search.apply(accepted)).toBe(false)
    disabled.value = false
    scene.value = { ...scene.value, revision: scene.value.revision + 1 }
    expect(search.apply(accepted)).toBe(false)
    expect(commit).not.toHaveBeenCalled()

    search.run()
    const later = FakeWorker.instances[1]!
    const laterId = (later.messages[0] as { id: number }).id
    complete(later, laterId)
    const finalCandidate = search.result.value!.candidates[0]!
    search.dispose()
    expect(later.terminated).toBe(true)
    expect(search.apply(finalCandidate)).toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })

  it('clears search state when disabled and ignores replies after disposal', () => {
    installWorker()
    const { disabled, search, commit } = setup()
    search.run()
    const worker = FakeWorker.instances[0]!
    const id = (worker.messages[0] as { id: number }).id
    disabled.value = true
    expect(worker.terminated).toBe(true)
    expect(search.result.value).toBeNull()
    complete(worker, id)
    expect(search.result.value).toBeNull()
    search.dispose()
    expect(commit).not.toHaveBeenCalled()
  })
})
