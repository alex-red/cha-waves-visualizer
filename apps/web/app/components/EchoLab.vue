<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import QRCode from 'qrcode'
import EchoResponseReview from './EchoResponseReview.vue'
import EchoProbeBatchReview from './EchoProbeBatchReview.vue'
import { reconstructEchoRoom, simulateEchoCaptures, type EchoCapture, type EchoPeak, type EchoPosition, type EchoRoom } from '../../../../packages/echo'
import { ECHO_SCAN_MAX_BYTES, createSyntheticEchoScan, parseEchoScan, serializeEchoScan, type EchoScanDocument } from '../../../../packages/echo-scan'
import { useSatelliteHost } from '../composables/useSatelliteHost'
import { useEchoScan } from '../composables/useEchoScan'

const emit = defineEmits<{ close: [] }>()
const mode = ref<'synthetic' | 'phone'>('synthetic')
const width = ref(6.4), depth = ref(4.8), noise = ref(0.08)
const room = shallowRef<EchoRoom>({ widthM: 6.4, depthM: 4.8 })
const captures = shallowRef<EchoCapture[]>([])
const importedFixture = ref(false)
const selected = ref(0), reveal = ref(false), error = ref(''), pulse = ref(0)
const host = useSatelliteHost()
const { token, joined, deviceLabel, captures: receivedRecordings, batches: receivedBatches, busy: pairingBusy, error: pairingError, suggestedOrigins } = host
const scan = useEchoScan()
const { recordings, batches, reviews, activeCaptureId, error: reviewError } = scan
const phoneOrigin = ref(typeof window === 'undefined' ? '' : window.location.origin)
const connection = ref<'wireless' | 'usb'>('wireless')
const usbPort = typeof window === 'undefined' ? '4175' : window.location.port || (window.location.protocol === 'https:' ? '443' : '80')
const usbAvailable = typeof window !== 'undefined' && window.location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
const usbOrigin = `http://localhost:${usbPort}`
const pairingOrigin = computed(() => connection.value === 'usb' ? usbOrigin : phoneOrigin.value)
const qrImage = ref(''), copied = ref(false)
const livePeaks = computed(() => Object.values(reviews.value).map(review => ({ id: review.captureId, peaks: review.peaks })))
const chosenPeaks = computed(() => Object.fromEntries(Object.values(reviews.value).map(review => [review.captureId, review.wallPeakIndices])))
const directPeaks = computed(() => Object.fromEntries(Object.values(reviews.value).map(review => [review.captureId, review.directPeakIndex === null ? '' : String(review.directPeakIndex)])))
const analyzing = ref(false), analysisError = ref('')
const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false), scanNotice = ref('')
type LabSnapshot = {
  synthetic: EchoScanDocument; recorded: EchoScanDocument; mode: 'synthetic' | 'phone'
  selected: number; reveal: boolean; importedFixture: boolean; activeCaptureId: string | null
}
const previousScan = shallowRef<LabSnapshot | null>(null)
let analysisWorker: Worker | undefined
let analysisId = 0, qrGeneration = 0, importGeneration = 0

const poses = computed<EchoPosition[]>(() => [
  [0.18, 0.23], [0.40, 0.43], [0.76, 0.28], [0.29, 0.76], [0.77, 0.69],
].map(([x, y]) => ({ xM: (room.value.originXM ?? 0) + room.value.widthM * x!, yM: (room.value.originYM ?? 0) + room.value.depthM * y! })))
const liveCaptures = computed(() => scan.readyCaptures.value.map(item => item.capture))
const activeCaptures = computed(() => mode.value === 'synthetic' ? captures.value : liveCaptures.value)
const reconstruction = computed(() => reconstructEchoRoom(activeCaptures.value))
const estimate = computed(() => reconstruction.value.status === 'ok' ? reconstruction.value.room : undefined)
const activePoseIndex = computed(() => mode.value === 'synthetic' ? selected.value : recordings.value.findIndex(item => item.id === activeCaptureId.value))
const activeCapture = computed(() => mode.value === 'synthetic'
  ? captures.value[Math.min(selected.value, captures.value.length - 1)]
  : scan.readyCaptures.value.find(item => item.captureId === activeCaptureId.value)?.capture)
const plotPoses = computed(() => mode.value === 'synthetic'
  ? importedFixture.value ? captures.value.map(item => item.position) : poses.value
  : recordings.value.map(item => item.position))
const pendingAnalysisCount = computed(() => recordings.value.filter(recording => !reviews.value[recording.id]?.peaks.length).length)
const resultMessage = computed(() => {
  if (mode.value === 'synthetic' || liveCaptures.value.length >= 3) return reconstruction.value.message
  if (!recordings.value.length) return 'Record at least three positions spread across both axes.'
  if (pendingAnalysisCount.value) return 'Analyze the recordings, then identify a direct arrival and four later wall candidates per position.'
  if (recordings.value.some(recording => (reviews.value[recording.id]?.peaks.length ?? 0) < 5)) return 'Too few detected candidates for four wall arrivals. Keep the raw recordings for further analysis; a rectangle cannot yet be fitted.'
  return 'Choose the direct arrival and four later wall candidates at three positions before fitting a rectangle.'
})
const mapBounds = computed(() => {
  const fitted = estimate.value
  const xs = plotPoses.value.map(p => p.xM), ys = plotPoses.value.map(p => p.yM)
  const boundary = fitted ?? (mode.value === 'synthetic' ? room.value : undefined)
  if (boundary) {
    const ox = boundary.originXM ?? 0, oy = boundary.originYM ?? 0
    xs.push(ox, ox + boundary.widthM); ys.push(oy, oy + boundary.depthM)
  }
  if (!xs.length) { xs.push(0, 8); ys.push(0, 6) }
  return { minX: Math.min(...xs) - 0.8, minY: Math.min(...ys) - 0.8, maxX: Math.max(...xs) + 0.8, maxY: Math.max(...ys) + 0.8 }
})
const scale = computed(() => Math.min(610 / (mapBounds.value.maxX - mapBounds.value.minX), 345 / (mapBounds.value.maxY - mapBounds.value.minY)))
const px = (x: number) => 45 + (x - mapBounds.value.minX) * scale.value
const py = (y: number) => 400 - (y - mapBounds.value.minY) * scale.value
const gridX = computed(() => Array.from({ length: Math.min(40, Math.ceil(mapBounds.value.maxX - mapBounds.value.minX) + 1) }, (_, i) => Math.floor(mapBounds.value.minX) + i))
const gridY = computed(() => Array.from({ length: Math.min(40, Math.ceil(mapBounds.value.maxY - mapBounds.value.minY) + 1) }, (_, i) => Math.floor(mapBounds.value.minY) + i))
const timelineMax = computed(() => Math.max(45, ...(activeCapture.value?.arrivalTimesMs ?? []).map(value => value + 6)))
const dimensionErrorCm = computed(() => estimate.value ? 100 * Math.hypot(estimate.value.widthM - room.value.widthM, estimate.value.depthM - room.value.depthM) : null)
const pairingUrl = computed(() => {
  if (!token.value) return ''
  try {
    const base = new URL(pairingOrigin.value)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) return ''
    return `${base.origin}/?satellite=1${connection.value === 'usb' ? '&transport=usb' : ''}#${token.value}`
  } catch { return '' }
})
const phoneUsesHttps = computed(() => { try { return new URL(phoneOrigin.value).protocol === 'https:' } catch { return false } })
const phoneConnectionHint = computed(() => {
  try {
    const url = new URL(phoneOrigin.value)
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'For wireless use, enter this computer’s LAN address or hostname. Android USB uses a forwarded localhost address instead.'
    if (url.protocol !== 'https:') return 'A phone microphone needs HTTPS trusted by the phone. Plain LAN HTTP can pair, but cannot record.'
    return 'Open the same HTTPS server on both devices. The certificate must be trusted by your phone.'
  } catch { return 'Enter the reachable origin of this satellite server, including https:// and its port.' }
})

function reset() {
  if (![width.value, depth.value].every(value => Number.isFinite(value) && value >= 3 && value <= 15)) { error.value = 'Use room dimensions between 3 and 15 metres.'; return }
  room.value = { widthM: width.value, depthM: depth.value }
  captures.value = []; selected.value = 0; reveal.value = false; importedFixture.value = false; error.value = ''; scanNotice.value = ''
}
function takeCapture(all = false) {
  if (importedFixture.value) return
  error.value = ''
  if (!Number.isFinite(noise.value) || noise.value < 0 || noise.value > 0.5) { error.value = 'Timing noise must be between 0 and 0.5 ms.'; return }
  const count = all ? poses.value.length : Math.min(poses.value.length, captures.value.length + 1)
  captures.value = simulateEchoCaptures(room.value, poses.value.slice(0, count), { seed: 1729, timingNoiseStdMs: noise.value })
  selected.value = count - 1; pulse.value++
}
function choosePeak(id: string, index: number) {
  scan.selectRecording(id)
  scan.toggleWall(id, index)
}
function setDirect(id: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  scan.selectRecording(id)
  scan.setDirect(id, value === '' ? null : Number(value))
}
function relativePeakTime(id: string, index: number): number | null {
  const peaks = livePeaks.value.find(item => item.id === id)?.peaks ?? []
  const direct = directPeaks.value[id]
  if (direct === undefined || direct === '' || !peaks[Number(direct)] || !peaks[index]) return null
  return peaks[index]!.delayMs - peaks[Number(direct)]!.delayMs
}
function analyze() {
  const targets = recordings.value.filter(recording => !reviews.value[recording.id]?.peaks.length)
  if (!targets.length) return
  analysisWorker?.terminate(); analysisError.value = ''; analyzing.value = true
  const id = ++analysisId
  try {
    const worker = new Worker(new URL('../workers/echo.worker.ts', import.meta.url), { type: 'module' })
    analysisWorker = worker
    worker.onmessage = (event: MessageEvent<{ id: number; error?: string; results?: { id: string; peaks: EchoPeak[] }[] }>) => {
      if (id !== analysisId || event.data.id !== id) return
      analyzing.value = false
      if (event.data.error) analysisError.value = event.data.error
      else for (const result of event.data.results ?? []) scan.setPeaks(result.id, result.peaks)
      worker.terminate(); if (analysisWorker === worker) analysisWorker = undefined
    }
    worker.onerror = () => { if (id === analysisId) { analyzing.value = false; analysisError.value = 'Could not analyze recordings. Export your captures and retry.' }; worker.terminate() }
    worker.postMessage({ id, captures: targets })
  } catch { analyzing.value = false; analysisError.value = 'This browser could not start the echo analysis worker.' }
}
function currentScan(): EchoScanDocument {
  return mode.value === 'synthetic' ? createSyntheticEchoScan(room.value, captures.value) : scan.document()
}
function snapshot(): LabSnapshot {
  return {
    synthetic: parseEchoScan(serializeEchoScan(createSyntheticEchoScan(room.value, captures.value))).document,
    recorded: parseEchoScan(serializeEchoScan(scan.document())).document,
    mode: mode.value, selected: selected.value, reveal: reveal.value,
    importedFixture: importedFixture.value, activeCaptureId: activeCaptureId.value,
  }
}
function exportScan() {
  try {
    const url = URL.createObjectURL(new Blob([serializeEchoScan(currentScan())], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cha-echo-scan.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not export the scan.' }
}
function stopAnalysis() {
  analysisId++; analysisWorker?.terminate(); analysisWorker = undefined; analyzing.value = false; analysisError.value = ''
}
function installScan(document: EchoScanDocument) {
  stopAnalysis()
  void host.end()
  if (document.mode === 'recorded') scan.installRecordedScan(document)
  else {
    room.value = { ...document.fixture }; captures.value = document.captures
    width.value = document.fixture.widthM; depth.value = document.fixture.depthM
    importedFixture.value = true; selected.value = 0; reveal.value = false
  }
  mode.value = document.mode === 'recorded' ? 'phone' : 'synthetic'
}
async function importScan(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''; scanNotice.value = ''
  if (file.size > ECHO_SCAN_MAX_BYTES) { error.value = 'Scan JSON exceeds the 10 MiB limit.'; return }
  const generation = ++importGeneration; importing.value = true
  try {
    const parsed = parseEchoScan(await file.text())
    if (generation !== importGeneration) return
    // One retained snapshot makes replacing an unsaved scan reversible.
    const before = snapshot()
    installScan(parsed.document)
    previousScan.value = before
    scanNotice.value = ['Scan opened. Its reconstruction was recomputed from the observations.', ...parsed.notices].join(' ')
  } catch (cause) { if (generation === importGeneration) error.value = cause instanceof Error ? cause.message : 'Could not open the scan.' }
  finally { if (generation === importGeneration) importing.value = false }
}
function undoImport() {
  if (!previousScan.value) return
  const current = snapshot(), previous = previousScan.value
  stopAnalysis(); void host.end()
  scan.installRecordedScan(previous.recorded)
  if (previous.synthetic.mode === 'synthetic') {
    room.value = previous.synthetic.fixture; captures.value = previous.synthetic.captures
    width.value = room.value.widthM; depth.value = room.value.depthM
  }
  selected.value = previous.selected; reveal.value = previous.reveal; importedFixture.value = previous.importedFixture
  mode.value = previous.mode; scan.selectRecording(previous.activeCaptureId)
  previousScan.value = current
  scanNotice.value = 'Previous scan restored. The scan you just left is available from this same restore button.'; error.value = ''
}
function beginNewScan() {
  previousScan.value = snapshot()
  stopAnalysis(); void host.end()
  if (mode.value === 'phone') scan.clear()
  else { captures.value = []; selected.value = 0; reveal.value = false; importedFixture.value = false }
  error.value = ''; scanNotice.value = 'New scan started. Your previous scan is available to restore; export scans before closing the lab.'
}
async function copyLink() {
  try { await navigator.clipboard.writeText(pairingUrl.value); copied.value = true } catch { error.value = 'Clipboard unavailable. Scan the QR code or open the pairing link.' }
}
watch(pairingUrl, async value => {
  const generation = ++qrGeneration; qrImage.value = ''; copied.value = false
  if (!value) return
  try {
    const image = await QRCode.toDataURL(value, { width: 232, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#203d37', light: '#fffdf6' } })
    if (generation === qrGeneration) qrImage.value = image
  } catch { if (generation === qrGeneration) error.value = 'Could not generate the pairing code.' }
})
watch(suggestedOrigins, values => {
  // Keep an already-reachable hostname, whose HTTPS certificate may not cover IPs.
  try {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(phoneOrigin.value).hostname)) return
    const lan = values[0]
    if (lan) phoneOrigin.value = lan
  } catch { /* Let the user correct an invalid custom origin. */ }
})
watch([receivedRecordings, receivedBatches], ([incoming, incomingBatches]) => {
  // Ending a session keeps its raw host copies. Ignore queued polls after a
  // scan replacement so they cannot append those copies into the imported scan.
  if (token.value) scan.mergeRecordings(incoming, incomingBatches)
})
onBeforeUnmount(() => { importGeneration++; analysisId++; qrGeneration++; analysisWorker?.terminate() })
</script>

<template>
  <div class="echo-lab" data-testid="echo-lab">
    <header class="el-header">
      <div><span class="el-eyebrow">CHA WAVES / EXPERIMENTAL INSTRUMENT 01</span><h2 id="echo-lab-title">Explore a room<br>through echoes.</h2><p>Reconstruct a simulated room, or inspect phone recordings. Physical wall identification remains unvalidated.</p></div>
      <button class="el-close" aria-label="Close Echo Lab" @click="emit('close')">×</button>
    </header>
    <div class="el-tabs" role="group" aria-label="Echo Lab source">
      <button :aria-pressed="mode === 'synthetic'" :class="{ active: mode === 'synthetic' }" @click="mode = 'synthetic'">01 <span>Virtual scan</span></button>
      <button :aria-pressed="mode === 'phone'" :class="{ active: mode === 'phone' }" @click="mode = 'phone'">02 <span>Phone satellite</span><i v-if="joined" /></button>
      <span class="el-experimental">{{ mode === 'synthetic' ? 'SYNTHETIC DEMONSTRATION' : 'EXPERIMENTAL ACQUISITION' }}</span>
    </div>
    <div class="el-file-bar">
      <input ref="importInput" class="el-file-input" type="file" accept="application/json,.json" aria-label="Open an Echo Lab scan JSON" data-testid="echo-import" @change="importScan">
      <button class="el-secondary" :disabled="importing" data-testid="echo-import-open" @click="importInput?.click()">{{ importing ? 'Opening scan…' : 'Open scan JSON' }}</button>
      <button class="el-text-button" :disabled="importing" data-testid="echo-new-scan" @click="beginNewScan">New scan</button>
      <button v-if="previousScan" class="el-text-button" :disabled="importing" data-testid="echo-restore-scan" @click="undoImport">Restore previous scan</button>
      <span>Raw audio + reviewed echoes · saved when you export</span>
    </div>
    <p v-if="scanNotice" class="el-scan-notice" role="status" data-testid="echo-scan-notice">{{ scanNotice }}</p>
    <div class="el-layout">
      <section class="el-field" aria-label="Echo reconstruction plan">
        <div class="el-plot-heading"><span>{{ mode === 'synthetic' ? 'KNOWN POSITIONS · HIDDEN WALLS' : 'RECEIVED MEASUREMENT POSITIONS' }}</span><span>METRES / PLAN VIEW</span></div>
        <svg class="el-map" viewBox="0 0 700 450" role="img" aria-label="Known microphone positions and estimated rectangular room boundary">
          <defs><pattern id="echo-paper" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.45" fill="#8ba397" opacity=".14" /></pattern></defs>
          <rect width="700" height="450" fill="url(#echo-paper)" />
          <g class="el-grid"><line v-for="x in gridX" :key="`x${x}`" :x1="px(x)" y1="30" :x2="px(x)" y2="400" /><line v-for="y in gridY" :key="`y${y}`" x1="45" :y1="py(y)" x2="655" :y2="py(y)" /></g>
          <g class="el-axis"><text v-for="x in gridX" :key="x" :x="px(x)" y="423">{{ x }}</text><text v-for="y in gridY" :key="y" x="24" :y="py(y) + 3">{{ y }}</text></g>
          <rect v-if="mode === 'synthetic' && reveal" data-testid="echo-truth" :x="px(room.originXM ?? 0)" :y="py((room.originYM ?? 0) + room.depthM)" :width="room.widthM * scale" :height="room.depthM * scale" class="el-truth" />
          <rect v-if="estimate" data-testid="echo-estimate" :x="px(estimate.originXM ?? 0)" :y="py((estimate.originYM ?? 0) + estimate.depthM)" :width="estimate.widthM * scale" :height="estimate.depthM * scale" class="el-estimate" />
          <g v-if="mode === 'synthetic' && activeCapture && reveal" class="el-rays">
            <line :x1="px(activeCapture.position.xM)" :y1="py(activeCapture.position.yM)" :x2="px(room.originXM ?? 0)" :y2="py(activeCapture.position.yM)" />
            <line :x1="px(activeCapture.position.xM)" :y1="py(activeCapture.position.yM)" :x2="px((room.originXM ?? 0) + room.widthM)" :y2="py(activeCapture.position.yM)" />
            <line :x1="px(activeCapture.position.xM)" :y1="py(activeCapture.position.yM)" :x2="px(activeCapture.position.xM)" :y2="py(room.originYM ?? 0)" />
            <line :x1="px(activeCapture.position.xM)" :y1="py(activeCapture.position.yM)" :x2="px(activeCapture.position.xM)" :y2="py((room.originYM ?? 0) + room.depthM)" />
          </g>
          <g v-for="(pose, index) in plotPoses" :key="index"><circle :cx="px(pose.xM)" :cy="py(pose.yM)" :r="index === activePoseIndex ? 10 : 7" :class="['el-pose', { recorded: mode === 'phone' || index < captures.length }]" /><text :x="px(pose.xM) + 15" :y="py(pose.yM) + 4" class="el-pose-label">P{{ index + 1 }}</text></g>
          <circle v-if="mode === 'synthetic' && activeCapture" :key="pulse" :cx="px(activeCapture.position.xM)" :cy="py(activeCapture.position.yM)" r="10" class="el-pulse" />
          <text v-if="!activeCaptures.length && (mode === 'synthetic' || !recordings.length)" x="350" y="205" class="el-empty">{{ mode === 'synthetic' ? 'The room is waiting to be heard.' : 'Your phone becomes the instrument.' }}</text>
        </svg>
        <div class="el-map-legend"><span><i class="estimate" /> Estimated boundary</span><span v-if="mode === 'synthetic'"><i class="truth" /> {{ reveal ? 'Fixture boundary' : 'Fixture hidden' }}</span><span><i class="pose" /> Known capture position</span></div>
        <section class="el-timeline" aria-label="Echo arrival timeline">
          <div class="el-small-heading"><strong>Returning echoes</strong><span>{{ activeCapture ? `P${activePoseIndex + 1} · after direct sound` : mode === 'phone' ? 'Select four wall arrivals to see their delays' : 'Capture a position to see arrivals' }}</span></div>
          <svg viewBox="0 0 620 100" role="img" aria-label="Echo delays in milliseconds"><line x1="20" y1="66" x2="600" y2="66" stroke="#b9c5b7" /><g v-for="(time, index) in activeCapture?.arrivalTimesMs ?? []" :key="index"><line :x1="20 + time / timelineMax * 560" y1="22" :x2="20 + time / timelineMax * 560" y2="66" stroke="#b4633e" stroke-width="2" /><text :x="20 + time / timelineMax * 560" :y="index % 2 ? 33 : 17" text-anchor="middle">{{ time.toFixed(1) }}</text></g><text x="20" y="88">0</text><text x="600" y="88" text-anchor="end">{{ timelineMax.toFixed(0) }} ms</text></svg>
        </section>
        <EchoResponseReview v-if="mode === 'phone' && recordings.length" :recordings="recordings" :reviews="reviews" />
        <EchoProbeBatchReview v-if="mode === 'phone'" :batches="batches" />
      </section>
      <aside class="el-controls">
        <template v-if="mode === 'synthetic'">
          <span class="el-step-label">SIMULATED ARRIVALS · KNOWN POSITIONS</span><h3>Recover a rectangle.<br>Test the assumptions.</h3><p>The solver receives known positions and four simulated first-order echo times per pose. It estimates an axis-aligned rectangle without receiving the fixture dimensions.</p>
          <div class="el-actions">
            <button class="el-primary" data-testid="echo-capture" :disabled="importedFixture || captures.length >= poses.length" @click="takeCapture()">{{ importedFixture ? 'Imported scan' : captures.length >= poses.length ? 'Five positions captured' : captures.length ? `Capture position ${captures.length + 1}` : 'Send a virtual pulse' }} <span>↗</span></button>
            <button class="el-secondary" data-testid="echo-example" :disabled="importedFixture" @click="takeCapture(true)">Run all five positions</button>
          </div>
          <div class="el-capture-list" aria-label="Captured positions"><button v-for="(capture, index) in captures" :key="index" :aria-pressed="selected === index" :class="{ selected: selected === index }" @click="selected = index"><b>P{{ index + 1 }}</b><span>{{ capture.position.xM.toFixed(2) }}, {{ capture.position.yM.toFixed(2) }} m</span><small>4 echoes</small></button></div>
          <label class="el-check"><input v-model="reveal" type="checkbox" data-testid="echo-reveal"> Reveal the fixture and reflection paths</label>
          <details class="el-fixture"><summary>Configure the hidden fixture</summary><div class="el-input-row"><label>Width (m)<input v-model.number="width" type="number" min="3" max="15" step="0.1"></label><label>Depth (m)<input v-model.number="depth" type="number" min="3" max="15" step="0.1"></label></div><label>Timing noise (ms)<input v-model.number="noise" type="number" min="0" max="0.5" step="0.01"></label><button class="el-secondary" @click="reset">Reset room & captures</button></details>
        </template>
        <template v-else>
          <span class="el-step-label">PHONE CAPTURE · RESEARCH IN PROGRESS</span><h3>Capture a response.<br>Inspect the evidence.</h3><p>Pair a phone, enter its measured pose, then record five sweeps at that position. Complete input coverage does not establish an identified wall reflection.</p>
          <fieldset class="el-transport"><legend>Connection</legend>
            <label><input v-model="connection" type="radio" value="wireless" name="satellite-connection">Wireless HTTPS</label>
            <label><input v-model="connection" type="radio" value="usb" name="satellite-connection" :disabled="!usbAvailable" data-testid="satellite-usb">Android USB</label>
          </fieldset>
          <p v-if="!usbAvailable" class="el-hint">For Android USB, open the relay over HTTP at this computer’s localhost address.</p>
          <div v-if="connection === 'usb'" class="el-readiness el-usb-ready" data-testid="satellite-usb-readiness"><strong>A cable for your first scan</strong><p>Connect your Android phone with a data cable and set up USB forwarding below. Chrome will open <code>{{ usbOrigin }}</code>. Keep the cable connected while scanning.</p><p>USB setup is manual. This page cannot detect the cable or verify forwarding.</p></div>
          <div v-else-if="!phoneUsesHttps" class="el-readiness" data-testid="satellite-https-readiness"><strong>Recording needs trusted HTTPS</strong><p>For wireless Android Chrome recording, use the relay’s HTTPS address trusted by your phone. This HTTP preview can pair for a connection check. Android USB is another option for a first scan.</p></div>
          <button v-if="!token" class="el-primary" data-testid="satellite-pair" :disabled="pairingBusy" @click="host.start()">{{ pairingBusy ? 'Starting session…' : 'Pair a phone' }} <span>⌁</span></button>
          <div v-if="token" class="el-pairing">
            <div class="el-connection" role="status"><i :class="{ connected: joined }" />{{ joined ? `${deviceLabel || 'Phone'} joined` : 'Waiting for your phone' }}</div>
            <img v-if="qrImage" :src="qrImage" width="232" height="232" alt="Scan this QR code on your phone to join the recording session" data-testid="satellite-qr">
            <p v-if="connection === 'usb'" class="el-usb-origin">PHONE ADDRESS <code data-testid="satellite-usb-origin">{{ usbOrigin }}</code></p>
            <label v-else>Phone-accessible server origin<input v-model="phoneOrigin" type="url" placeholder="https://your-computer.local:4174" spellcheck="false" autocomplete="off" list="satellite-origins" data-testid="satellite-origin"><datalist id="satellite-origins"><option v-for="origin in suggestedOrigins" :key="origin" :value="origin" /></datalist></label>
            <p class="el-hint">{{ connection === 'usb' ? 'Scan the code with the connected phone, then open it in Chrome. Localhost reaches this computer only after USB forwarding is set up.' : phoneConnectionHint }}</p>
            <div class="el-link-actions"><button class="el-secondary" :disabled="!pairingUrl" @click="copyLink">{{ copied ? 'Copied' : 'Copy link' }}</button><a v-if="pairingUrl" :href="pairingUrl" target="_blank" rel="noopener noreferrer">Open phone view ↗</a></div>
            <button class="el-text-button" @click="host.end()">End phone session</button>
          </div>
          <div v-if="pairingError" class="el-error" role="alert">{{ pairingError }}<button v-if="token" class="el-text-button" @click="host.retry()">Retry connection</button></div>
          <details v-if="connection === 'usb'" class="el-fixture" data-testid="satellite-usb-setup"><summary>Set up Android USB</summary><ol><li>Connect a data cable. On the phone, enable USB debugging in Developer options and authorize this computer.</li><li>On this computer, run <code>bun run satellite:android -- --port {{ usbPort }}</code>.</li><li>Choose Pair a phone above, scan the QR code and open Chrome. Keep this page open on the computer.</li></ol><p>When finished, remove this port’s forwarding with <code>bun run satellite:android -- --port {{ usbPort }} --remove</code>.</p></details>
          <details v-if="!token" class="el-fixture"><summary>Set up the local satellite server</summary><p>Build with <code>bun run build</code>. For Android USB, run <code>bun run satellite -- --host 127.0.0.1 --port 4175</code> and open <code>http://127.0.0.1:4175</code>. For wireless, supply a trusted certificate with <code>--cert /path/cert.pem --key /path/key.pem</code> and open its HTTPS address.</p><p>The ordinary static preview supports the virtual lab and saved scan review. Phone sessions need this optional server.</p></details>
          <div v-if="recordings.length" class="el-recordings">
            <div class="el-small-heading"><strong>{{ recordings.length }} recordings received</strong><span>EXPORT TO KEEP</span></div>
            <button class="el-secondary" :disabled="analyzing || !pendingAnalysisCount" data-testid="echo-analyze" @click="analyze">{{ analyzing ? 'Matching sweep echoes…' : pendingAnalysisCount ? `Analyze recorded sweeps (${pendingAnalysisCount} new)` : 'All recordings analyzed' }}</button>
            <div v-for="(recording, index) in recordings" :key="recording.id" class="el-recording" :data-capture-id="recording.id">
              <button class="el-recording-select" :aria-pressed="activeCaptureId === recording.id" @click="scan.selectRecording(recording.id)">P{{ index + 1 }} · {{ recording.position.xM.toFixed(2) }}, {{ recording.position.yM.toFixed(2) }} m</button>
              <small>{{ recording.durationMs }} ms · {{ (recording.sampleRate / 1000).toFixed(1) }} kHz · {{ (chosenPeaks[recording.id] ?? []).length }}/4 wall arrivals selected</small>
              <small v-if="recording.captureBackend">{{ recording.captureBackend === 'audio-worklet' ? 'AudioWorklet capture' : 'Compatibility capture · timing approximate' }}<template v-if="recording.signal"> · Peak {{ (recording.signal.peak * 100).toFixed(1) }}% · Clipped {{ (recording.signal.clippedFraction * 100).toFixed(2) }}%</template></small>
              <label v-if="reviews[recording.id]?.peaks.length" class="el-direct">Direct sound arrival<select :value="directPeaks[recording.id] ?? ''" @change="setDirect(recording.id, $event)"><option value="">Choose the direct sound peak</option><option v-for="(peak, i) in reviews[recording.id]?.peaks ?? []" :key="i" :value="String(i)">{{ peak.delayMs.toFixed(2) }} ms from recording start</option></select></label>
              <div class="el-peaks"><button v-for="(peak, peakIndex) in reviews[recording.id]?.peaks ?? []" :key="peakIndex" :disabled="relativePeakTime(recording.id, peakIndex) === null || relativePeakTime(recording.id, peakIndex)! <= 0 || relativePeakTime(recording.id, peakIndex)! > 175" :aria-pressed="(chosenPeaks[recording.id] ?? []).includes(peakIndex)" @click="choosePeak(recording.id, peakIndex)">{{ relativePeakTime(recording.id, peakIndex) === null ? peak.delayMs.toFixed(2) : relativePeakTime(recording.id, peakIndex)!.toFixed(2) }} ms</button></div>
            </div>
            <p class="el-hint">Identify the direct sound peak, then select four later wall arrivals per capture. Times use your chosen direct peak. A weak direct peak, furniture, floor and ceiling echoes can produce incorrect candidates. Enter phone positions manually, with axes aligned to the room.</p>
          </div>
          <p v-if="analysisError" class="el-error" role="alert">{{ analysisError }}</p>
          <p v-if="reviewError" class="el-error" role="alert">{{ reviewError }} Export your scan, then use New scan to begin another set.</p>
        </template>
        <p v-if="error" class="el-error" role="alert">{{ error }}</p>
        <div class="el-result" aria-live="polite" data-testid="echo-result">
          <span class="el-step-label">{{ estimate ? 'RECONSTRUCTED RECTANGLE' : 'LISTENING FOR GEOMETRY' }}</span>
          <template v-if="estimate"><strong>{{ estimate.widthM.toFixed(2) }} <small>×</small> {{ estimate.depthM.toFixed(2) }} <small>m</small></strong><p>Origin {{ (estimate.originXM ?? 0).toFixed(2) }}, {{ (estimate.originYM ?? 0).toFixed(2) }} m · {{ activeCaptures.length }} positions</p><div class="el-result-metrics"><span>Timing fit <b>{{ reconstruction.rmsResidualMs?.toFixed(3) }} ms</b></span><span>{{ mode === 'synthetic' ? 'Fixture dimension error' : 'Fit quality / not accuracy' }} <b>{{ mode === 'synthetic' ? `${dimensionErrorCm?.toFixed(1)} cm` : reconstruction.quality }}</b></span></div><p v-if="reconstruction.ambiguity" class="el-hint">Several geometries fit similarly. Add positions spread across both axes.</p></template>
          <p v-else>{{ resultMessage }}</p>
        </div>
        <button class="el-secondary el-export" :disabled="mode === 'synthetic' ? !captures.length : !recordings.length && !batches.length" data-testid="echo-export" @click="exportScan">Export scan JSON <span>↓</span></button>
      </aside>
    </div>
    <footer class="el-footer"><span>MODEL BOUNDARY</span><p>First-order sound echoes in an axis-aligned rectangular room, using known positions and 343 m/s. Recorded scans are exploratory; a good timing fit does not establish physical accuracy. Export recordings and reviews before closing. Reopen scan JSON to resume; scans stay outside home autosave.</p></footer>
  </div>
</template>


<style scoped>
.echo-lab{background:#f8f6ee;color:#243c35;font-family:ui-sans-serif,system-ui,sans-serif;text-align:left}.el-header{display:flex;justify-content:space-between;gap:20px;padding:34px 36px 26px;background:radial-gradient(ellipse at 85% 20%,#dce5d580,transparent 60%),#f1f0e5;border-bottom:1px solid #d4d9c9}.el-eyebrow,.el-step-label{font:9px/1.5 ui-monospace,monospace;letter-spacing:1.5px;color:#506354}.el-header h2{margin:12px 0;font:400 clamp(34px,4vw,48px)/1.02 Georgia,serif;letter-spacing:-1.5px}.el-header p{max-width:475px;margin:0;font-size:12px;line-height:1.7;color:#546057}.el-close{align-self:flex-start;border:1px solid #c0cbb9;background:transparent;width:36px;height:36px;border-radius:50%;color:#355447;font-size:24px;cursor:pointer}.el-tabs{display:flex;gap:0;padding:0 34px;border-bottom:1px solid #d4d9c9;align-items:center}.el-tabs>button{display:flex;align-items:center;gap:10px;border:0;border-bottom:2px solid transparent;background:transparent;min-height:55px;padding:0 20px 0 0;margin-right:24px;font:10px ui-monospace,monospace;color:#566054;cursor:pointer}.el-tabs>button span{font:600 12px ui-sans-serif,system-ui,sans-serif}.el-tabs>button.active{border-bottom-color:#ac5e3b;color:#244d3c}.el-tabs i{width:6px;height:6px;background:#518966;border-radius:50%}.el-experimental{margin-left:auto;color:#81543f;font:8px ui-monospace,monospace;letter-spacing:1px}.el-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px}.el-field{min-width:0;border-right:1px solid #d4d9c9;background:#eef1e7}.el-plot-heading{display:flex;justify-content:space-between;gap:10px;padding:19px 22px 0;color:#546657;font:8px ui-monospace,monospace;letter-spacing:1px}.el-map{display:block;width:100%;height:auto;min-height:260px}.el-grid line{stroke:#9eb29c;stroke-width:.5;opacity:.4}.el-axis text{fill:#5c7255;font:9px ui-monospace,monospace;text-anchor:middle}.el-truth{fill:#466c4808;stroke:#5c7e60;stroke-width:5;opacity:.55}.el-estimate{fill:#b56b3c06;stroke:#af5c36;stroke-width:2.5;stroke-dasharray:8 5}.el-pose{fill:#eef1e7;stroke:#96aa8f;stroke-width:1.5}.el-pose.recorded{fill:#254e3d;stroke:#f6f5e9;stroke-width:3}.el-pose-label{fill:#5b735e;font:10px ui-monospace,monospace}.el-rays{stroke:#aa6749;stroke-dasharray:5 5;opacity:.65}.el-empty{fill:#6b806c;font:italic 18px Georgia,serif;text-anchor:middle}.el-pulse{fill:none;stroke:#af5c36;stroke-width:2;transform-box:fill-box;transform-origin:center;animation:echo-pulse 1.4s ease-out forwards;pointer-events:none}.el-map-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;padding:0 10px 24px;font:9px ui-monospace,monospace;color:#566252}.el-map-legend span{display:flex;align-items:center;gap:5px}.el-map-legend i{display:inline-block;width:14px;height:0;border-top:2px dashed #af5c36}.el-map-legend .truth{border-top:3px solid #6d8a66}.el-map-legend .pose{width:5px;height:5px;border:0;background:#254e3d;border-radius:50%}.el-timeline{padding:20px 23px 4px;border-top:1px solid #ccd7c4;background:#e7ecdf}.el-small-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.el-small-heading strong{font:400 16px Georgia,serif}.el-small-heading span{color:#596453;font:8px ui-monospace,monospace}.el-timeline svg{display:block;width:100%;margin-top:14px}.el-timeline text{fill:#516848;font:9px ui-monospace,monospace}.el-controls{padding:24px;background:#faf8f1;min-width:0}.el-controls h3{font:400 25px/1.12 Georgia,serif;letter-spacing:-.6px;margin:10px 0 12px}.el-controls p{font-size:11px;line-height:1.65;color:#566356;margin:0 0 16px}.el-primary,.el-secondary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:39px;padding:9px 12px;border:1px solid #b9c6ae;border-radius:4px;background:#fffdf6;color:#345c44;font:600 11px ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-align:left}.el-primary{background:#284b3b;border-color:#284b3b;color:#fff9e9}.el-primary span{font-size:18px}.el-primary:disabled,.el-secondary:disabled{opacity:.45;cursor:not-allowed}.el-actions{display:grid;gap:8px}.el-secondary:hover:not(:disabled){background:#edf0e4}.el-primary:hover:not(:disabled){background:#183c2b}.el-capture-list{display:grid;gap:5px;margin:15px 0}.el-capture-list button{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 8px;background:transparent;border:1px solid #dce1d2;border-radius:3px;color:#586450;font:10px ui-monospace,monospace;cursor:pointer}.el-capture-list button.selected{background:#e7ecdf;border-color:#9cb192}.el-capture-list b{color:#335b40}.el-capture-list small{margin-left:auto;font-size:8px;white-space:nowrap}.el-check{display:flex;align-items:flex-start;gap:7px;font-size:10px;line-height:1.6;margin:15px 0;color:#52654e}.el-check input{accent-color:#315c43;margin:2px 0 0}.el-fixture{border-top:1px solid #dce0d1;padding-top:12px;margin:18px 0}.el-fixture summary{cursor:pointer;font:11px Georgia,serif;color:#506449;margin-bottom:12px}.el-fixture label,.el-pairing label{display:grid;gap:5px;font-size:10px;color:#52644a;margin-bottom:10px}.el-fixture input,.el-pairing input{min-width:0;width:100%;box-sizing:border-box;height:34px;padding:0 9px;border:1px solid #c6cfba;border-radius:3px;background:#fffdf5;color:#344c35;font:11px ui-monospace,monospace}.el-input-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.el-fixture code{font:10px ui-monospace,monospace;overflow-wrap:anywhere}.el-fixture .el-secondary{width:100%}.el-result{border:1px solid #ccd5bd;background:#edf0e3;margin-top:20px;padding:15px}.el-result>strong{display:block;margin:9px 0;font:400 30px Georgia,serif;letter-spacing:-.6px}.el-result>strong small{font-size:16px;color:#536249}.el-result p{font-size:10px;margin:8px 0 0}.el-result-metrics{display:grid;gap:7px;padding-top:13px;margin-top:12px;border-top:1px solid #d3dbc6}.el-result-metrics span{display:flex;justify-content:space-between;gap:5px;font-size:9px;color:#58664c}.el-result-metrics b{color:#365834;font:10px ui-monospace,monospace}.el-export{width:100%;margin-top:12px}.el-footer{display:flex;align-items:flex-start;gap:20px;border-top:1px solid #d4d9c9;padding:20px 30px;background:#f1f0e5}.el-footer>span{white-space:nowrap;font:8px ui-monospace,monospace;letter-spacing:1px;color:#7d543b;padding-top:2px}.el-footer p{margin:0;color:#596252;font-size:10px;line-height:1.7}.el-pairing{margin-top:14px;padding:13px;background:#eef0e4;border:1px solid #d5ddc9;border-radius:5px}.el-pairing img{display:block;max-width:100%;height:auto;margin:8px auto 16px}.el-connection{display:flex;align-items:center;gap:7px;color:#516448;font:10px ui-monospace,monospace;overflow-wrap:anywhere}.el-connection i{width:6px;height:6px;flex:none;border-radius:50%;background:#c3985b}.el-connection i.connected{background:#4d8b55}.el-controls .el-hint{font-size:10px;line-height:1.6;color:#705e45;margin:9px 0 12px}.el-link-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.el-link-actions a{font-size:10px;color:#386849;text-underline-offset:3px}.el-text-button{border:0;background:transparent;padding:8px 0;color:#80543c;font-size:10px;text-decoration:underline;cursor:pointer}.el-error{padding:11px;margin-top:12px!important;border:1px solid #c99370;background:#f9e9da;color:#8e482d!important;font-size:11px;line-height:1.6;overflow-wrap:anywhere}.el-recordings{border-top:1px solid #d4dcc8;padding-top:17px;margin-top:20px}.el-recordings>.el-secondary{width:100%;margin-top:12px}.el-recording{padding:12px 0;border-bottom:1px solid #dce2d1}.el-recording>b,.el-recording>small{display:block}.el-recording>b{font:10px ui-monospace,monospace;color:#486840}.el-recording>small{font-size:9px;color:#56624d;margin-top:6px;line-height:1.6}.el-peaks{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.el-peaks button{border:1px solid #c0cdae;background:#fffdf5;color:#546247;padding:6px;font:9px ui-monospace,monospace;border-radius:3px;cursor:pointer}.el-direct{display:grid;gap:5px;margin-top:11px;font-size:10px;color:#4f6443}.el-direct select{width:100%;min-height:35px;border:1px solid #bfccae;border-radius:3px;background:#fffdf5;color:#3d6138;font-size:10px;padding:5px}.el-peaks button:disabled{opacity:.4;cursor:not-allowed}.el-peaks button[aria-pressed=true]{border-color:#956342;background:#f0deca;color:#804729}@keyframes echo-pulse{to{transform:scale(12);opacity:0}}@media(prefers-reduced-motion:reduce){.el-pulse{animation:none;display:none}}@media(min-width:1100px){.el-map{min-height:410px}}@media(max-width:760px){.el-layout{grid-template-columns:1fr}.el-field{border-right:0;border-bottom:1px solid #d4d9c9}.el-header{padding:26px 22px 23px}.el-tabs{padding:0 21px}.el-experimental{display:none}.el-tabs>button{margin-right:14px;padding-right:5px}.el-controls{padding:24px}.el-footer{padding:18px 22px;display:block}.el-footer>span{display:block;margin-bottom:8px}.el-plot-heading{font-size:7px;letter-spacing:.6px}.el-map{min-height:0}.el-pairing img{width:232px}.el-pairing{max-width:360px}.el-capture-list{grid-template-columns:1fr 1fr}.el-capture-list small{display:none}}@media(max-width:360px){.el-capture-list{grid-template-columns:1fr}.el-tabs>button{font-size:9px;gap:6px}.el-tabs>button span{font-size:11px}.el-controls{padding:20px}.el-map-legend{gap:8px;font-size:8px}}
</style>

<style scoped>
.el-file-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:13px 34px;border-bottom:1px solid #d4d9c9;background:#f3f2e8}.el-file-bar>.el-secondary{min-height:34px}.el-file-bar>span{margin-left:auto;color:#596d51;font:9px/1.6 ui-monospace,monospace}.el-file-input{display:none}.el-scan-notice{margin:0;padding:12px 34px;border-bottom:1px solid #c6d2b8;background:#e6eddc;color:#365431;font-size:11px;line-height:1.6}.el-readiness{padding:13px;margin-bottom:15px;border:1px solid #d2b68e;border-radius:4px;background:#f3e9d8}.el-readiness>strong{color:#794325;font:600 11px ui-sans-serif,system-ui,sans-serif}.el-controls .el-readiness p{color:#6b5238;font-size:10px;line-height:1.7;margin:6px 0 0}.el-transport{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 14px;padding:10px 12px;border:1px solid #c6cfba;border-radius:4px}.el-transport legend{padding:0 4px;color:#506449;font-size:10px}.el-transport label{display:flex;align-items:center;gap:5px;color:#385c31;font-size:10px}.el-transport input{margin:0;accent-color:#315c43}.el-controls .el-usb-origin{display:grid;gap:5px;margin:12px 0;font:9px/1.7 ui-monospace,monospace;color:#49633f}.el-readiness code,.el-usb-origin code{overflow-wrap:anywhere;font:10px ui-monospace,monospace}.el-usb-ready{border-color:#b2c5a6;background:#e7eddc}.el-usb-ready>strong{color:#375a32}.el-controls .el-usb-ready p{color:#4f6144}.el-fixture ol{padding-left:17px;color:#52644a;font-size:10px;line-height:1.8}.el-fixture li+li{margin-top:7px}.el-recording-select{display:block;width:100%;min-height:34px;padding:7px 4px;border:1px solid transparent;border-radius:3px;background:transparent;text-align:left;color:#385c31;font:10px ui-monospace,monospace;cursor:pointer}.el-recording-select[aria-pressed=true]{border-color:#b4c4a4;background:#e9eedf}.el-peaks button{min-height:30px}@media(max-width:760px){.el-file-bar{padding:12px 21px;gap:10px}.el-file-bar>span{margin-left:0;width:100%;font-size:8px}.el-scan-notice{padding:12px 21px}}
</style>
