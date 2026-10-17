import { inspectSplatAsset, parseVisualManifest, visualPointToWorld } from '../../../../packages/spatial-visual'
import { VISUAL_LIMITS, type LoadedVisualBundle } from '../../../../packages/spatial-visual-types'
import type { SpatialBrowserFile } from './spatial-browser'

async function readFile(file: SpatialBrowserFile, limit: number, label: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit) {
    throw new Error(`${label} must be a readable file of 1–${limit} bytes.`)
  }
  let buffer: ArrayBuffer
  try { buffer = await file.arrayBuffer() } catch { throw new Error(`${label} could not be read.`) }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1 || buffer.byteLength > limit) throw new Error(`${label} exceeds its byte limit or is empty.`)
  return new Uint8Array(buffer)
}

export async function visualSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  try {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
  } catch { throw new Error('Local SHA256 requires a secure browser context with Web Crypto.') }
}

/** Read only the two explicitly selected files; never fetch manifest URLs. */
export async function inspectVisualBrowserFiles(manifestFile: SpatialBrowserFile, assetFile: SpatialBrowserFile): Promise<LoadedVisualBundle> {
  const start = performance.now()
  const manifestBytes = await readFile(manifestFile, VISUAL_LIMITS.manifestBytes, 'Visual manifest')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes) }
  catch { throw new Error('Visual manifest must be valid UTF-8.') }
  const manifest = parseVisualManifest(text)
  if (assetFile?.name !== manifest.asset.fileName) throw new Error('Selected splat filename does not match the manifest.')
  const assetBytes = await readFile(assetFile, VISUAL_LIMITS.assetBytes, 'Splat asset')
  const readMs = performance.now() - start
  const inspectionStart = performance.now()
  const assetSha256 = await visualSha256(assetBytes)
  if (assetSha256 !== manifest.asset.sha256) throw new Error('Splat SHA256 does not match the manifest. The earlier scene is still available.')
  const stats = inspectSplatAsset(assetBytes, manifest.asset.splatCount)
  // Registration must stay representable even when both the asset and transform
  // individually pass their own bounds. Check every corner of the display bound.
  if (manifest.registration.status === 'known') {
    for (let bits = 0; bits < 8; bits += 1) {
      visualPointToWorld([
        (bits & 1 ? stats.localBounds.max : stats.localBounds.min)[0],
        (bits & 2 ? stats.localBounds.max : stats.localBounds.min)[1],
        (bits & 4 ? stats.localBounds.max : stats.localBounds.min)[2],
      ], manifest.registration)
    }
    for (const camera of manifest.cameras) visualPointToWorld(camera.position, manifest.registration)
  }
  return {
    manifest, manifestBytes, manifestSha256: await visualSha256(manifestBytes), assetSha256, assetBytes, stats,
    timing: { readMs, inspectMs: performance.now() - inspectionStart },
  }
}
