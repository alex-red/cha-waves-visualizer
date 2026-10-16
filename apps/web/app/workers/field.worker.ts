import { computeField } from '../../../../packages/engine'

type Lane = 'working' | 'baseline'
type Quality = 'preview' | 'balanced'
type FieldRequest = { id: number; lane: Lane; quality: Quality; scene: unknown; settings: unknown; options: { step: number; receiverZ: number; workspaceGeneration: number; requestId: number } }
type CancelRequest = { type: 'cancel'; id: number }
const cancelled = new Set<number>()
const pending: Partial<Record<Lane, FieldRequest>> = {}
let active: FieldRequest | null = null

function enqueue(request: FieldRequest) {
  const lane = request.lane ?? 'working'
  request.lane = lane
  // A newer working field supersedes the in-flight working field, while a
  // baseline calculation keeps its own slot and can finish independently.
  if (active?.lane === lane) cancelled.add(active.id)
  const replaced = pending[lane]
  if (replaced) cancelled.delete(replaced.id)
  pending[lane] = request
  void pump()
}

async function pump() {
  if (active) return
  const request = pending.working ?? pending.baseline
  if (!request) return
  delete pending[request.lane]
  active = request
  try {
    const result = await computeField(request.scene as never, request.settings as never, request.options, () => cancelled.has(request.id))
    if (!cancelled.has(request.id)) {
      const transfer: Transferable[] = []
      if (result.values instanceof Float32Array) transfer.push(result.values.buffer)
      if (result.validity instanceof Uint8Array) transfer.push(result.validity.buffer)
      self.postMessage({ id: request.id, lane: request.lane, quality: request.quality, result }, transfer)
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'CANCELLED')) {
      self.postMessage({ id: request.id, lane: request.lane, quality: request.quality, error: error instanceof Error ? error.message : 'Field calculation failed' })
    }
  } finally {
    cancelled.delete(request.id)
    active = null
    void pump()
  }
}

self.onmessage = (event: MessageEvent<FieldRequest | CancelRequest>) => {
  if ('type' in event.data && event.data.type === 'cancel') {
    if (active?.id === event.data.id) cancelled.add(event.data.id)
    for (const lane of ['working', 'baseline'] as const) {
      if (pending[lane]?.id === event.data.id) { delete pending[lane]; cancelled.delete(event.data.id) }
    }
    return
  }
  enqueue(event.data as FieldRequest)
}
