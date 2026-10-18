<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { createSyntheticVisualAsset, createSyntheticVisualManifest } from '../../../../packages/test-fixtures/visual-example'
import type { LoadedVisualBundle } from '../../../../packages/spatial-visual-types'
import { inspectVisualBrowserFiles, visualSha256 } from '../lib/visual-browser'

const SpatialSplatViewer = defineAsyncComponent(() => import('./SpatialSplatViewer.vue'))
const props = defineProps<{ active: boolean }>()
const uid = useId()
const manifestFile = shallowRef<File | null>(null)
const assetFile = shallowRef<File | null>(null)
const bundle = shallowRef<LoadedVisualBundle | null>(null)
const importing = ref(false)
const error = ref('')
const message = ref('Load a bundled example or select a visual manifest and its .splat file.')
const showAsset = ref(true)
const showCameras = ref(true)
const selectedCameraId = ref('')
const rendererError = ref('')
const rendererStatus = ref('Preparing renderer…')
const viewerKey = ref(0)
let generation = 0

function invalidate(): void {
  generation += 1
  if (importing.value) {
    error.value = ''
    message.value = bundle.value ? 'Import cancelled. The earlier scene is retained.' : 'Import cancelled. Load an example or select both files to try again.'
  }
  importing.value = false
}
function selectManifest(event: Event): void { invalidate(); manifestFile.value = (event.target as HTMLInputElement).files?.[0] ?? null }
function selectAsset(event: Event): void { invalidate(); assetFile.value = (event.target as HTMLInputElement).files?.[0] ?? null }

async function install(read: () => Promise<LoadedVisualBundle>): Promise<void> {
  if (!props.active || importing.value) return
  const current = ++generation
  importing.value = true
  error.value = ''
  message.value = 'Checking local bytes, provenance and registration…'
  try {
    const next = await read()
    if (current !== generation || !props.active) return
    // Disposing Three's WebGL backend loses its canvas context. Replacements
    // need a fresh component/canvas rather than reinitializing the old context.
    viewerKey.value += 1
    bundle.value = next
    rendererError.value = ''
    rendererStatus.value = 'Preparing renderer…'
    showAsset.value = true
    showCameras.value = true
    selectedCameraId.value = ''
    message.value = `Ready · ${next.stats.splatCount.toLocaleString()} Gaussians · ${next.manifest.cameras.length} supplied camera poses.`
  } catch (issue) {
    if (current !== generation || !props.active) return
    error.value = issue instanceof Error ? issue.message : 'The visual bundle could not be opened.'
    message.value = 'The earlier scene is retained.'
  } finally { if (current === generation) importing.value = false }
}

function loadRoom(): void {
  void install(async () => {
    const asset = createSyntheticVisualAsset()
    const manifest = createSyntheticVisualManifest(await visualSha256(asset))
    return inspectVisualBrowserFiles(
      new File([JSON.stringify(manifest, null, 2) + '\n'], 'synthetic-study-room.visual.json'),
      new File([asset], manifest.asset.fileName),
    )
  })
}

function loadViolin(): void {
  void install(async () => {
    // Fixed same-origin bundled assets only. URLs in imported manifests are never fetched.
    const manifestResponse = await fetch('/research/violin/manifest.json')
    const assetResponse = await fetch('/research/violin/violin_10k.splat')
    if (!manifestResponse.ok || !assetResponse.ok) throw new Error('The bundled violin files are unavailable. Retry or import local files.')
    const manifest = await manifestResponse.arrayBuffer()
    const asset = await assetResponse.arrayBuffer()
    return inspectVisualBrowserFiles(new File([manifest], 'violin.visual.json'), new File([asset], 'violin_10k.splat'))
  })
}

function importSelected(): void {
  const manifest = manifestFile.value, asset = assetFile.value
  if (manifest && asset) void install(() => inspectVisualBrowserFiles(manifest, asset))
}

function download(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadManifest(): void {
  if (bundle.value) download(bundle.value.manifestBytes, `${bundle.value.manifest.id}.visual.json`, 'application/json')
}
function downloadAsset(): void {
  if (bundle.value) download(bundle.value.assetBytes, bundle.value.manifest.asset.fileName, 'application/octet-stream')
}
function rendererReady(backend: 'webgpu' | 'webgl', renderMs: number): void {
  rendererError.value = ''
  rendererStatus.value = `${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · first render ${renderMs.toFixed(1)} ms`
}
function retryRenderer(): void { rendererError.value = ''; rendererStatus.value = 'Preparing renderer…'; viewerKey.value += 1 }
watch(() => props.active, active => {
  if (!active) invalidate()
  else if (bundle.value) { rendererError.value = ''; rendererStatus.value = 'Preparing renderer…' }
})
onBeforeUnmount(invalidate)
</script>

<template>
  <section class="visual-lab" aria-label="Visual splat baseline" data-testid="visual-lab">
    <header class="visual-heading"><div><p class="eyebrow">APPEARANCE / EXPLICIT REGISTRATION</p><h3>Visual splat baseline</h3></div><span class="stamp">LOCAL + BUNDLED FILES</span></header>
    <p class="intro">Inspect precomputed Gaussian splats in a declared coordinate frame. Appearance assets, camera poses and metric registration retain their own provenance.</p>
    <div class="examples"><button type="button" data-testid="visual-example-room" :disabled="importing" @click="loadRoom">Load metric room <span aria-hidden="true">↗</span><small>Synthetic geometry · illustrative cameras</small></button><button type="button" data-testid="visual-example-violin" :disabled="importing" @click="loadViolin">Load CC0 violin <span aria-hidden="true">↗</span><small>Mesh conversion · metric scale unknown</small></button></div>
    <details class="import-panel"><summary>Open your own visual bundle</summary><div class="file-grid"><label :for="`${uid}-manifest`">Visual manifest JSON</label><input :id="`${uid}-manifest`" data-testid="visual-manifest-input" type="file" accept=".json,application/json" @change="selectManifest"><label :for="`${uid}-asset`">Standard .splat file</label><input :id="`${uid}-asset`" data-testid="visual-asset-input" type="file" accept=".splat" @change="selectAsset"><button class="primary" type="button" data-testid="visual-import" :disabled="importing || !manifestFile || !assetFile" @click="importSelected">Inspect selected files</button></div><p>Two explicit files, up to 8 MiB / 262,144 splats. No remote URLs are followed. PLY, SPZ and compressed formats require conversion before import.</p></details>
    <div class="import-status" :class="{ error }" role="status" data-testid="visual-import-status">{{ error || message }}<small v-if="error">{{ message }}</small></div>

    <template v-if="bundle">
      <div class="asset-heading"><div><p class="eyebrow">{{ bundle.manifest.provenance.kind }}</p><h4 data-testid="visual-title">{{ bundle.manifest.label }}</h4></div><span class="stamp" data-testid="visual-frame-label">{{ bundle.manifest.registration.status === 'known' ? 'WORLD / METRES / Z UP' : 'ASSET FRAME / LOCAL UNITS' }}</span></div>
      <p v-if="bundle.manifest.registration.status === 'unknown'" class="registration-note" data-testid="visual-unknown-registration">World placement unavailable: {{ bundle.manifest.registration.reason }}</p>
      <p v-else class="registration-note" data-testid="visual-registration">{{ bundle.manifest.registration.method }} registration · {{ bundle.manifest.registration.scaleMPerUnit }} m per asset unit · translation [{{ bundle.manifest.registration.translationM.join(', ') }}] m · rotation XYZW [{{ bundle.manifest.registration.rotationXyzw.map(value => value.toFixed(4)).join(', ') }}]</p>
      <div class="viewer-layout">
        <div class="visual-viewport">
          <div class="layer-controls"><label><input v-model="showAsset" type="checkbox" data-testid="visual-toggle-asset"> Appearance</label><label><input v-model="showCameras" type="checkbox" data-testid="visual-toggle-cameras"> Camera frustums</label><label :for="`${uid}-camera`">View</label><select :id="`${uid}-camera`" v-model="selectedCameraId" data-testid="visual-camera-select"><option value="">Free orbit</option><option v-for="camera in bundle.manifest.cameras" :key="camera.id" :value="camera.id">{{ camera.id }} · {{ camera.role }}</option></select></div>
          <SpatialSplatViewer v-if="props.active" :key="viewerKey" :bundle="bundle" :active="props.active" :show-asset="showAsset" :show-cameras="showCameras" :selected-camera-id="selectedCameraId || null" @ready="rendererReady" @unavailable="rendererError = $event" @reset="selectedCameraId = ''" />
          <div v-if="rendererError" class="renderer-error" role="status" data-testid="visual-renderer-error"><strong>{{ rendererError }}</strong><p>The verified source and metadata remain available for inspection and export.</p><button type="button" @click="retryRenderer">Retry renderer</button></div>
          <p v-else class="renderer-status" data-testid="visual-renderer-status">{{ rendererStatus }}</p>
          <p class="boundary">Rendering a splat does not validate room geometry. Frustum depth is illustrative. Camera roles and image hashes are supplied claims, without image-quality evaluation here.</p>
        </div>
        <aside class="evidence" aria-label="Visual asset evidence">
          <p class="eyebrow">ASSET RECORD</p><h4>Provenance &amp; cost</h4><dl><div><dt>Gaussians</dt><dd>{{ bundle.stats.splatCount.toLocaleString() }}</dd></div><div><dt>Visible alpha</dt><dd>{{ bundle.stats.visibleSplatCount.toLocaleString() }}</dd></div><div><dt>Source bytes</dt><dd>{{ bundle.stats.sourceBytes.toLocaleString() }}</dd></div><div><dt>Decoded attributes</dt><dd>{{ bundle.stats.decodedAttributeBytes.toLocaleString() }} bytes</dd></div><div><dt>Local read</dt><dd>{{ bundle.timing.readMs.toFixed(1) }} ms</dd></div><div><dt>Hash + inspection</dt><dd>{{ bundle.timing.inspectMs.toFixed(1) }} ms</dd></div></dl><p class="cost-note">Decoded size is a minimum for center/covariance/color arrays; GPU, sorting and renderer memory are additional. Timings describe this load only.</p>
          <p><b>{{ bundle.manifest.provenance.creator }}</b><br>{{ bundle.manifest.provenance.method }} · {{ bundle.manifest.provenance.version }}</p><p>{{ bundle.manifest.provenance.notes }}</p><p><a v-if="bundle.manifest.provenance.license.url" :href="bundle.manifest.provenance.license.url" target="_blank" rel="noopener noreferrer">{{ bundle.manifest.provenance.license.name }}</a><span v-else>{{ bundle.manifest.provenance.license.name }}</span><a v-if="bundle.manifest.provenance.sourceUrl" :href="bundle.manifest.provenance.sourceUrl" target="_blank" rel="noopener noreferrer">Source &amp; attribution ↗</a></p>
          <details><summary>Exact input hashes</summary><p>Manifest SHA256</p><code>{{ bundle.manifestSha256 }}</code><p>Asset SHA256</p><code data-testid="visual-asset-hash">{{ bundle.assetSha256 }}</code></details>
          <div class="downloads"><button type="button" data-testid="visual-download-manifest" @click="downloadManifest">Save manifest ↓</button><button type="button" data-testid="visual-download-asset" @click="downloadAsset">Save original splat ↓</button></div><p class="cost-note">Save both files to reopen this scene. No automatic storage or upload. Closing Research Lab retains the accepted scene in this tab; refreshing clears it.</p>
        </aside>
      </div>
    </template>
    <p v-else class="empty-note">Start with the metric room to test registered poses, or the violin to inspect a reusable external asset with unknown world placement.</p>
  </section>
</template>

<style scoped>
.visual-lab{padding:27px 34px 32px;color:#263c35;background:#f8f6ee}.visual-heading,.asset-heading{display:flex;justify-content:space-between;align-items:center;gap:14px}.eyebrow{margin:0;color:#52664f;font:9px/1.5 ui-monospace,monospace;letter-spacing:1px;text-transform:uppercase}h3{margin:5px 0;font:400 27px Georgia,serif}h4{margin:6px 0 11px;font:400 22px Georgia,serif}.stamp{padding:6px 8px;border:1px solid #bdc9b5;color:#4e634a;font:8px ui-monospace,monospace;letter-spacing:.5px}.intro,.empty-note{max-width:820px;font-size:12px;color:#53634f;line-height:1.7}.examples{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.examples button{display:grid;grid-template-columns:1fr auto;gap:7px;text-align:left;padding:15px 17px;border:1px solid #bac9af;background:#eef1e7;color:#2f513b;font:400 19px Georgia,serif}.examples small{grid-column:1/-1;color:#53664d;font:10px ui-sans-serif,system-ui}.examples button:hover{background:#e3ebdc}button,summary,select{cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}.import-panel{padding:12px 0;border-top:1px solid #d0d8c6;border-bottom:1px solid #d0d8c6}.import-panel summary,.evidence summary{font:13px Georgia,serif;color:#36573c}.import-panel p,.cost-note{font-size:10px;color:#58694f;line-height:1.65}.file-grid{display:grid;grid-template-columns:170px 1fr;gap:10px;align-items:center;margin:15px 0}.file-grid label{font-size:11px}.file-grid input{min-width:0;max-width:100%;font-size:11px;color:#52634e}.primary{grid-column:2;justify-self:start;padding:10px 14px;background:#315641;border:1px solid #315641;color:#fff9ec;font-size:11px}.import-status{margin:15px 0;padding:12px 14px;border-left:3px solid #6b865e;background:#edf1e6;color:#35523b;font-size:11px;line-height:1.6}.import-status.error{border-color:#a15b38;background:#f4e9dd;color:#774a32}.import-status small{display:block}.asset-heading{margin:23px 0 0}.registration-note{font:10px/1.65 ui-monospace,monospace;color:#6c583e;overflow-wrap:anywhere}.viewer-layout{display:grid;grid-template-columns:minmax(0,1fr) 285px;border:1px solid #cbd4c1}.visual-viewport{min-width:0;background:#edf1e7}.layer-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px;border-bottom:1px solid #cbd4c1;color:#385a3c;font-size:10px}.layer-controls label{display:flex;align-items:center;gap:4px}.layer-controls select{min-width:0;max-width:100%;padding:6px;border:1px solid #b5c4ab;background:#fffdf4;color:#38573b;font-size:10px}.layer-controls input{accent-color:#315641}.renderer-status,.boundary{margin:10px 14px;color:#53664e;font:9px/1.6 ui-monospace,monospace}.boundary{padding-top:10px;border-top:1px solid #d1d9c7}.renderer-error{margin:12px;padding:13px;border:1px solid #b27d57;color:#774a32;background:#f5e9dc;font-size:11px;line-height:1.6}.renderer-error button,.downloads button{padding:9px 10px;border:1px solid #a8b89d;background:#fffdf5;color:#31533d;font-size:10px}.evidence{min-width:0;padding:19px;border-left:1px solid #cbd4c1;background:#fbf9f2}.evidence h4{font-size:21px}.evidence dl{margin:12px 0}.evidence dl div{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #e0e4d6}.evidence dt{color:#55674f;font:9px ui-monospace,monospace}.evidence dd{margin:0;color:#31523a;font:10px ui-monospace,monospace}.evidence p{font-size:10px;color:#52634c;line-height:1.65;overflow-wrap:anywhere}.evidence a{display:block;color:#3c6549;text-underline-offset:3px}.evidence code{color:#415d3e;font:9px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.evidence details{padding:12px 0;border-top:1px solid #d2dbc7;border-bottom:1px solid #d2dbc7}.downloads{display:grid;gap:7px;margin-top:15px}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid #2d7770;outline-offset:3px}@media(max-width:850px){.viewer-layout{grid-template-columns:1fr}.evidence{border-left:0;border-top:1px solid #cbd4c1}.evidence dl{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.downloads{grid-template-columns:1fr 1fr}}@media(max-width:620px){.visual-lab{padding:22px 18px 25px}.visual-heading,.asset-heading{align-items:flex-start;flex-direction:column;gap:5px}.examples{grid-template-columns:1fr;gap:8px}.examples button{font-size:18px}.file-grid{grid-template-columns:1fr;gap:7px}.file-grid input{margin-bottom:7px}.primary{grid-column:1}.layer-controls{gap:9px}.evidence dl{grid-template-columns:1fr}.downloads{grid-template-columns:1fr}.intro{font-size:11px}}
</style>
