import { searchPlacements } from '../../../../packages/placement'
import type { PlacementRequest, PlacementResponse } from '../lib/placement-protocol'

function send(message: PlacementResponse) { self.postMessage(message) }
self.onmessage = async ({ data }: MessageEvent<PlacementRequest>) => {
  try {
    const result = await searchPlacements(data.scene, data.settings, data.options, {
      onProgress: (done, total) => send({ id: data.id, type: 'progress', done, total }),
    })
    send({ id: data.id, type: 'result', result })
  } catch (error) {
    send({ id: data.id, type: 'error', error: error instanceof Error ? error.message : 'Placement search failed' })
  }
}
