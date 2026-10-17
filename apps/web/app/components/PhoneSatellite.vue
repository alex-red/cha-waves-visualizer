<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { captureAcousticProbeBatch, captureAcousticSweep, encodePcm16Base64, getCaptureSupport, type AcousticCapture } from '../lib/satellite-audio'
import { prepareProbeBatch, serializeProbeBatch, type ProbeBatchUpload } from '../lib/probe-batch-capture'
import type { ProbeContext } from '../../../../packages/probe-batch'
import EchoAcquisitionDetails from './EchoAcquisitionDetails.vue'
import EchoProbeBatchReview from './EchoProbeBatchReview.vue'

const props = withDefaults(defineProps<{ token: string; transport?: 'wireless' | 'usb' }>(), { transport: 'wireless' })
const emit = defineEmits<{ leave: [] }>()

type Stage = 'unpaired' | 'ready' | 'warming' | 'recording' | 'review' | 'uploading' | 'success'
const stage = ref<Stage>('unpaired')
const deviceLabel = ref('Phone microphone')
const xText = ref<string | number>('')
const yText = ref<string | number>('')
const captureMode = ref<'series' | 'single'>('series')
const heightText = ref<string | number>('')
const headingText = ref<string | number>('')
const volumeText = ref<string | number>('')
const orientation = ref<ProbeContext['orientation'] | ''>('')
const series = shallowRef<ProbeBatchUpload | null>(null)
const probeIndex = ref(0)
const capture = ref<AcousticCapture | null>(null)
const capturePosition = ref<{ xM: number; yM: number } | null>(null)
const capturedAt = ref('')
const message = ref('')
const error = ref('')
const captureSupport = ref({ supported: false, message: 'Checking microphone availability…' })
let abortController: AbortController | undefined
let requestController: AbortController | undefined
let operationGeneration = 0
let pendingCaptureId: string | null = null
let disposed = false
const REQUEST_TIMEOUT_MS = 10_000

const xM = computed(() => Number(xText.value))
const yM = computed(() => Number(yText.value))
const positionValid = computed(() => {
  return String(xText.value).trim() !== '' && String(yText.value).trim() !== '' &&
    Number.isFinite(xM.value) && Number.isFinite(yM.value) &&
    xM.value >= -200 && yM.value >= -200 && xM.value <= 200 && yM.value <= 200
})
const positionHint = computed(() => positionValid.value
  ? `X ${xM.value.toFixed(2)} m · Y ${yM.value.toFixed(2)} m`
  : 'Use known room coordinates from −200 to 200 metres.')
const capturing = computed(() => stage.value === 'warming' || stage.value === 'recording')
const poseLocked = computed(() => capturing.value || stage.value === 'review' || stage.value === 'uploading')
const seriesContext = computed<ProbeContext | null>(() => {
  if ([heightText.value, headingText.value, volumeText.value].some(value => String(value).trim() === '') || !orientation.value) return null
  const heightM = Number(heightText.value), headingDeg = Number(headingText.value), speakerVolumePercent = Number(volumeText.value)
  if (!Number.isFinite(heightM) || heightM < 0 || heightM > 5 || !Number.isFinite(headingDeg) || headingDeg < 0 || headingDeg >= 360 || !Number.isInteger(speakerVolumePercent) || speakerVolumePercent < 0 || speakerVolumePercent > 100) return null
  return { heightM, headingDeg, speakerVolumePercent, orientation: orientation.value }
})
const canRecord = computed(() => positionValid.value && captureSupport.value.supported && (captureMode.value === 'single' || seriesContext.value !== null))
const statusLabel = computed(() => ({
  unpaired: 'Awaiting pairing', ready: 'Paired · ready', warming: 'Warming microphone', recording: 'Recording sweep', review: 'Capture held on phone',
  uploading: 'Sending capture', success: 'Capture received',
}[stage.value]))

onBeforeUnmount(() => {
  disposed = true
  operationGeneration++
  abortController?.abort()
  requestController?.abort()
  window.removeEventListener('pagehide', abortInFlight)
  capture.value = null
  series.value = null
  capturePosition.value = null
})

onMounted(() => {
  captureSupport.value = getCaptureSupport()
  window.addEventListener('pagehide', abortInFlight)
})

function abortInFlight() {
  abortController?.abort('hidden')
  requestController?.abort()
}

function createCaptureId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `phone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string | { message?: string }; message?: string }
    if (response.status === 410) return 'This pairing session has expired. Return to the computer and create a new session.'
    return (typeof body.error === 'string' ? body.error : body.error?.message) ?? body.message ?? `The server returned ${response.status}. Try again.`
  } catch {
    return response.status === 410 ? 'This pairing session has expired. Return to the computer and create a new session.' : `The server returned ${response.status}. Try again.`
  }
}

async function pair() {
  if (disposed) return
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  const generation = ++operationGeneration
  let timedOut = false
  const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
  error.value = ''
  message.value = ''
  const label = deviceLabel.value.trim().slice(0, 80) || 'Phone microphone'
  try {
    const response = await fetch('/api/satellite/join', {
      method: 'POST',
      headers: { Authorization: `Bearer ${props.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceLabel: label }),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (disposed || generation !== operationGeneration) return
    if (!response.ok) throw new Error(await responseError(response))
    if (disposed || generation !== operationGeneration) return
    stage.value = 'ready'
    message.value = 'This phone is paired. Microphone access is requested only when you record.'
  } catch (cause) {
    if (disposed || generation !== operationGeneration) return
    error.value = timedOut
      ? 'Pairing timed out. Check the connection to the computer and try again.'
      : cause instanceof TypeError
      ? 'Could not reach the computer. Keep both devices on the same network and try again.'
      : cause instanceof Error ? cause.message : 'Pairing failed. Try again.'
  } finally {
    window.clearTimeout(timeoutId)
    if (generation === operationGeneration) requestController = undefined
  }
}

function captureMessage(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') return 'Microphone access was denied. Allow microphone access in the browser site settings, then try again.'
  if (cause instanceof DOMException && cause.name === 'NotFoundError') return 'No microphone was found. Connect or enable a microphone and try again.'
  if (cause instanceof DOMException && cause.name === 'AbortError') return ''
  return cause instanceof Error ? cause.message : 'Capture failed. Check microphone access and try again.'
}

async function record() {
  if (captureMode.value === 'series') return recordSeries()
  if (!positionValid.value || (stage.value !== 'ready' && stage.value !== 'success')) return
  error.value = ''
  message.value = 'Keep the phone on this page and still while the short sweep plays.'
  capturePosition.value = { xM: xM.value, yM: yM.value }
  capturedAt.value = new Date().toISOString()
  pendingCaptureId = createCaptureId()
  stage.value = 'recording'
  abortController = new AbortController()
  let microphoneReady = false
  const handleVisibilityChange = () => {
    if (document.hidden && microphoneReady) abortController?.abort('hidden')
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  try {
    const result = await captureAcousticSweep({
      signal: abortController.signal,
      onMicrophoneReady: () => {
        microphoneReady = true
        if (document.hidden) abortController?.abort()
      },
    })
    if (disposed) return
    capture.value = result
    stage.value = 'review'
    message.value = 'Review the position, then send this recorded sweep to the computer.'
  } catch (cause) {
    if (disposed) return
    const detail = captureMessage(cause)
    if (detail) error.value = detail
    if (cause instanceof DOMException && cause.name === 'AbortError') message.value = 'Recording cancelled. This take was discarded; record again when ready.'
    capturePosition.value = null
    pendingCaptureId = null
    stage.value = 'ready'
  } finally {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    abortController = undefined
  }
}

async function recordSeries() {
  if (!canRecord.value || !seriesContext.value || (stage.value !== 'ready' && stage.value !== 'success')) return
  const position = { xM: xM.value, yM: yM.value }
  const context = { ...seriesContext.value }
  const startedAt = new Date().toISOString()
  const id = createCaptureId()
  const label = deviceLabel.value.trim().slice(0, 80) || 'Phone microphone'
  error.value = ''; capture.value = null; series.value = null; probeIndex.value = 0
  message.value = 'Keep the phone still and this page visible for all five sweeps. The microphone closes before review.'
  stage.value = 'warming'
  abortController = new AbortController()
  try {
    const result = await captureAcousticProbeBatch({
      signal: abortController.signal,
      onProgress: progress => {
        if (disposed) return
        stage.value = progress.phase === 'warming' ? 'warming' : 'recording'
        probeIndex.value = progress.index
      },
    })
    if (disposed) return
    series.value = prepareProbeBatch(result, { id, startedAt, endedAt: new Date().toISOString(), position, context, deviceLabel: label, createCaptureId })
    stage.value = 'review'
    const count = series.value.captures.length
    message.value = `${count} of 5 sweeps captured. Microphone stopped. Review or save the series before sending.`
  } catch (cause) {
    if (disposed) return
    error.value = captureMessage(cause) || 'Series cancelled before microphone setup completed.'
    stage.value = 'ready'
  } finally { abortController = undefined }
}

async function sendCapture() {
  if (disposed || (!series.value && (!capture.value || !capturePosition.value || !pendingCaptureId || !positionValid.value))) return
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  const generation = ++operationGeneration
  let timedOut = false
  const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS)
  const localSeries = series.value
  const localCapture = capture.value
  const body = localSeries ?? {
    id: pendingCaptureId, capturedAt: capturedAt.value, position: { ...capturePosition.value! },
    sampleRate: localCapture!.sampleRate, pcm16Base64: encodePcm16Base64(localCapture!.samples),
    durationMs: Math.round(localCapture!.samples.length * 1000 / localCapture!.sampleRate),
    captureBackend: localCapture!.backend, signal: localCapture!.signal, acquisition: localCapture!.acquisition,
    deviceLabel: deviceLabel.value.trim().slice(0, 80) || 'Phone microphone',
  }
  error.value = ''
  message.value = ''
  stage.value = 'uploading'
  try {
    const response = await fetch(localSeries ? '/api/satellite/batches' : '/api/satellite/captures', {
      method: 'POST',
      headers: { Authorization: `Bearer ${props.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (disposed || generation !== operationGeneration) return
    if (response.status === 409) {
      const conflict = await response.clone().json().catch(() => null) as { code?: string } | null
      if (!localSeries && conflict?.code === 'DUPLICATE_CAPTURE') {
        capture.value = null; series.value = null; capturePosition.value = null; pendingCaptureId = null
        stage.value = 'success'
        message.value = 'The computer already received this measurement.'
        return
      }
    }
    if (!response.ok) throw new Error(await responseError(response))
    if (disposed || generation !== operationGeneration) return
    capture.value = null
    series.value = null
    capturePosition.value = null
    pendingCaptureId = null
    stage.value = 'success'
    message.value = localSeries ? 'The computer received this series and its probe outcomes. Export before the session reaches 12 recordings.' : 'The computer received this capture. You can record another position when ready.'
  } catch (cause) {
    if (disposed || generation !== operationGeneration) return
    stage.value = capture.value || series.value ? 'review' : 'ready'
    error.value = timedOut
      ? 'Sending timed out. Your capture is still held in this page; retry the same capture.'
      : cause instanceof DOMException && cause.name === 'AbortError'
        ? 'Sending cancelled. Your capture is still held in this page; you can retry.'
        : cause instanceof TypeError
          ? 'Could not reach the computer. Your capture is still held in this page; try sending again.'
          : cause instanceof Error ? cause.message : 'Upload failed. Your capture is still held in this page.'
  } finally {
    window.clearTimeout(timeoutId)
    if (generation === operationGeneration) requestController = undefined
  }
}

function discardCapture() {
  capture.value = null
  series.value = null
  capturePosition.value = null
  pendingCaptureId = null
  error.value = ''
  message.value = 'The local capture was discarded. You can record again.'
  stage.value = 'ready'
}

function saveSeries() {
  if (!series.value) return
  try {
    const url = URL.createObjectURL(new Blob([serializeProbeBatch(series.value)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'cha-echo-probe-series.json'; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    message.value = 'Series JSON saved. The original series is still held in this page.'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'The series could not be saved.' }
}

function cancelRecording() {
  abortController?.abort()
}

function cancelSend() {
  requestController?.abort()
}
</script>

<template>
  <main class="phone-page" data-testid="phone-satellite">
    <div class="page-grain" aria-hidden="true" />
    <header class="masthead">
      <a class="wordmark" href="/" aria-label="Cha Waves home"><span class="mark">◒</span><span>CHA / WAVES</span></a>
      <span class="edition">FIELD INSTRUMENTS&nbsp; · &nbsp;NO. 04</span>
    </header>

    <section class="instrument" aria-labelledby="phone-title">
      <div class="instrument-topline"><span>ROOM ACOUSTICS LAB</span><span class="live-indicator" :class="{ active: stage !== 'unpaired' }"><i />{{ statusLabel }}</span></div>
      <div v-if="transport === 'usb'" class="notice usb-notice" data-testid="phone-usb-notice">
        <b>USB session</b><span>Keep the cable connected and open this link in Android Chrome. USB debugging and port forwarding must be started manually on the computer; this page does not configure the cable.</span>
      </div>
      <div class="hero">
        <div>
          <div class="eyebrow">SATELLITE RECEIVER <span /></div>
          <h1 id="phone-title">A room, heard<br><em>from here.</em></h1>
          <p class="intro">Hold one position. Let the microphone settle, then listen five times. Repeated sweeps help us check whether the response is stable.</p>
        </div>
        <div class="sound-plate" aria-hidden="true">
          <svg viewBox="0 0 180 150" role="presentation"><path d="M15 75h19l11-30 13 63 14-82 14 101 14-69 13 37 12-20 12 9 10-9h18"/><path class="wave-secondary" d="M15 75h150"/><circle cx="90" cy="75" r="55"/><circle cx="90" cy="75" r="37"/><circle cx="90" cy="75" r="18"/></svg>
          <span>350 — 9,000 Hz</span>
        </div>
      </div>

      <div class="step-ruler" aria-label="Capture steps">
        <span :class="{ current: stage === 'unpaired' }"><b>01</b> PAIR</span><i />
        <span :class="{ current: ['ready','warming','recording','review','uploading','success'].includes(stage) }"><b>02</b> POSITION</span><i />
        <span :class="{ current: ['warming','recording','review','uploading','success'].includes(stage) }"><b>03</b> RECORD</span><i />
        <span :class="{ current: stage === 'success' }"><b>04</b> SEND</span>
      </div>

      <div class="work-area">
        <section v-if="stage === 'unpaired'" class="step-card pair-card" aria-labelledby="pair-heading">
          <div class="card-index">01</div><div class="card-content">
            <div class="section-kicker">SECURE LINK <span>COMPUTER SESSION</span></div>
            <h2 id="pair-heading">Pair this phone</h2>
            <p>The link came from the computer. Pairing does not turn on the microphone.</p>
            <label class="field-label" for="device-label">DEVICE NAME</label>
            <input id="device-label" v-model="deviceLabel" maxlength="80" autocomplete="off" placeholder="Phone microphone">
            <button class="primary-button" type="button" :disabled="!token" @click="pair">Pair device <span>↗</span></button>
            <p v-if="!token" class="inline-error" role="alert">This pairing link is incomplete. Open the link shown on the computer.</p>
          </div>
        </section>

        <template v-else>
          <section class="step-card position-card" aria-labelledby="position-heading">
            <div class="card-index">02</div><div class="card-content">
              <div class="section-kicker">KNOWN POSE <span>MANUAL ENTRY</span></div>
              <h2 id="position-heading">Where is the phone?</h2>
              <p>Choose a fixed room-plan origin and axes parallel to the walls, then measure manually. The phone does not track or estimate its own position.</p>
              <div class="coordinate-fields">
                <label><span>X <small>METRES</small></span><input v-model="xText" aria-label="Phone X coordinate (m)" type="number" min="-200" max="200" step="0.01" inputmode="decimal" placeholder="e.g. 2.40" :disabled="poseLocked"></label>
                <label><span>Y <small>METRES</small></span><input v-model="yText" aria-label="Phone Y coordinate (m)" type="number" min="-200" max="200" step="0.01" inputmode="decimal" placeholder="e.g. 1.80" :disabled="poseLocked"></label>
              </div>
              <p class="position-note" :class="{ valid: positionValid }"><span aria-hidden="true">⌖</span>{{ positionHint }}</p>
              <fieldset class="probe-mode" :disabled="poseLocked"><legend>Capture method</legend><label><input v-model="captureMode" type="radio" value="series"> Five sweep series</label><label><input v-model="captureMode" type="radio" value="single"> Single sweep</label></fieldset>
              <fieldset v-if="captureMode === 'series'" class="probe-context" :disabled="poseLocked" data-testid="phone-probe-context">
                <legend>Keep these fixed for all five sweeps</legend>
                <div class="context-fields">
                  <label>Height above floor (m)<input v-model="heightText" aria-label="Phone height above floor (m)" type="number" min="0" max="5" step="0.01" inputmode="decimal" placeholder="e.g. 1.20"></label>
                  <label>Phone orientation<select v-model="orientation" aria-label="Phone orientation"><option value="">Choose orientation</option><option value="screen-up">Screen up</option><option value="screen-down">Screen down</option><option value="upright">Upright</option></select></label>
                  <label>Heading in room (°)<input v-model="headingText" aria-label="Phone heading in room (degrees)" type="number" min="0" max="359.99" step="0.01" inputmode="decimal" placeholder="e.g. 0"></label>
                  <label>Media volume (%)<input v-model="volumeText" aria-label="Reported media volume (%)" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="e.g. 50"></label>
                </div>
                <p>Measure heading clockwise from your +X axis: use the phone’s top edge when flat, or the direction its screen faces when upright. Use the built-in speaker. Enter the media volume you set; this page cannot read it.</p>
              </fieldset>
            </div>
          </section>

          <section class="step-card capture-card" aria-labelledby="capture-heading">
            <div class="card-index">03</div><div class="card-content">
              <div class="section-kicker">ACOUSTIC MEASUREMENT <span>{{ captureMode === 'series' ? '1 S WARM-UP · 5 PROBES' : '80 MS SWEEP · 700 MS LISTEN' }}</span></div>
              <h2 id="capture-heading">Listen for the room</h2>
              <p>The browser will ask for microphone permission and request echo cancellation, noise suppression, and automatic gain control off. The device may still alter audio.</p>
              <div class="capture-console" :class="`console-${stage}`">
                <div class="console-symbol" aria-hidden="true"><span v-if="capturing" class="pulse-ring" /><span class="mic-glyph">{{ stage === 'success' ? '✓' : capturing ? '◉' : '⌁' }}</span></div>
                <div class="console-copy" role="status"><b>{{ stage === 'warming' ? 'Letting the microphone settle' : stage === 'recording' ? captureMode === 'series' ? `Sweep ${probeIndex} of 5` : 'Take a still reading' : stage === 'review' ? series ? 'Series held locally' : 'Capture held locally' : stage === 'uploading' ? 'Sending measurement' : stage === 'success' ? 'Received by computer' : 'Ready when you are' }}</b><small>{{ capturing ? 'Keep the phone still; do not leave this page.' : stage === 'review' ? 'Microphone stopped. Nothing is sent until you choose Send.' : stage === 'success' ? 'This phone is ready for another position.' : 'Place the phone at the entered coordinates.' }}</small></div>
                <span v-if="capturing" class="recording-tag"><i /> LIVE</span>
                <span v-else class="console-time">{{ capture ? '0.70 s' : series ? `${series.captures.length}/5` : '— —' }}</span>
              </div>
              <p v-if="stage === 'review' && capture" class="capture-detail">
                <b>{{ capture.backend === 'audio-worklet' ? 'AudioWorklet · frame-aligned' : 'Compatibility recorder · callback timing approximate' }}</b>
                <span>Peak {{ (20 * Math.log10(Math.max(capture.signal.peak, 0.000001))).toFixed(1) }} dBFS · RMS {{ (20 * Math.log10(Math.max(capture.signal.rms, 0.000001))).toFixed(1) }} dBFS · clipped {{ (capture.signal.clippedFraction * 100).toFixed(2) }}%</span>
                <small>Room timing is experimental; these levels describe this recording only.</small>
              </p>
              <p v-else-if="!captureSupport.supported" class="capture-detail support-note" role="status">{{ captureSupport.message }}</p>
              <p v-else class="capture-detail support-note">{{ captureSupport.message }}</p>
              <EchoAcquisitionDetails v-if="stage === 'review' && capture" :acquisition="capture.acquisition" />
              <template v-if="stage === 'review' && series">
                <EchoProbeBatchReview :batches="[series.batch]" />
                <details class="series-telemetry"><summary>Recording conditions for each sweep</summary><div v-for="(recording, index) in series.captures" :key="recording.id"><b>Sweep {{ index + 1 }}</b><EchoAcquisitionDetails :acquisition="recording.acquisition" /></div></details>
                <p class="capture-detail">Each completed sweep uses one of the computer’s 12 recording slots. If the session is full, save this series JSON and export the computer scan before starting a new pairing session.</p>
              </template>
              <div class="capture-actions">
                <button v-if="stage === 'ready' || stage === 'success'" class="primary-button" type="button" :disabled="!canRecord" @click="record">{{ captureMode === 'series' ? 'Record five sweeps' : 'Record sweep' }} <span>↗</span></button>
                <button v-if="capturing" class="stop-button" type="button" @click="cancelRecording">{{ captureMode === 'series' ? 'Stop series' : 'Cancel recording' }}</button>
                <template v-if="stage === 'review'">
                  <button class="primary-button send-button" type="button" :disabled="!positionValid" @click="sendCapture">{{ series ? 'Send series' : 'Send capture' }} <span>↑</span></button>
                  <button v-if="series" class="quiet-button" type="button" @click="saveSeries">Save series JSON <span>↓</span></button>
                  <button class="quiet-button" type="button" @click="discardCapture">Discard</button>
                </template>
                <template v-if="stage === 'uploading'"><button class="primary-button" type="button" disabled><span class="spinner" />Sending…</button><button class="quiet-button cancel-send" type="button" @click="cancelSend">Cancel send</button></template>
              </div>
              <p v-if="stage === 'review'" class="local-note"><span>●</span> Held in this page until you send or discard it.</p>
            </div>
          </section>
        </template>
      </div>

      <p v-if="error" class="notice error-notice" role="alert"><b>!</b>{{ error }}</p>
      <p v-if="message && !error" class="notice" role="status"><b>·</b>{{ message }}</p>
      <div class="privacy-note"><span>◈</span><p><b>Microphone privacy</b> — access starts when you record and stops before review. A series keeps one microphone stream open for five short sweeps; raw audio stays in this page until you send or save it.</p></div>
    </section>

    <footer class="page-footer"><span>CHA / WAVES · EXPERIMENTAL ACOUSTICS</span><button type="button" @click="emit('leave')">Leave phone capture <span>↗</span></button></footer>
  </main>
</template>

<style scoped>
.phone-page .probe-mode input[type="radio"]{width:16px;height:16px;min-height:0;padding:0;margin:0;flex:none}.phone-page .probe-mode label{gap:8px}.console-warming{border-color:#bc896c;background:#fcf4eb}
.probe-mode,.probe-context{margin:20px 0 0;padding:16px 0 0;border:0;border-top:1px solid var(--line);min-width:0}.probe-mode legend,.probe-context legend{padding:0 6px 0 0;font:10px/1.6 ui-monospace,monospace;color:var(--forest)}.probe-mode{display:flex;flex-wrap:wrap;gap:12px 20px}.probe-mode label{display:flex;gap:7px;align-items:center;font:12px/1.5 ui-sans-serif,system-ui,sans-serif}.probe-mode input{accent-color:var(--forest)}.context-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}.context-fields label{display:grid;gap:6px;font:11px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--muted);min-width:0}.context-fields input,.context-fields select{box-sizing:border-box;min-width:0;width:100%;min-height:42px;border:1px solid #aaa995;border-radius:3px;background:#fffdf6;color:var(--ink);padding:8px;font:12px ui-monospace,monospace}.context-fields input:focus,.context-fields select:focus{outline:2px solid var(--forest);outline-offset:2px}.probe-context p{font-size:11px!important;margin:14px 0 0!important}.capture-actions{flex-wrap:wrap}.series-telemetry{margin:16px 0;font:11px/1.7 ui-sans-serif,system-ui,sans-serif;color:var(--forest)}.series-telemetry>summary{cursor:pointer;text-decoration:underline;text-underline-offset:3px}.series-telemetry>div{margin-top:16px}.series-telemetry>div>b{font:10px ui-monospace,monospace}.probe-context:disabled,.probe-mode:disabled{opacity:.7}@media(max-width:360px){.context-fields{grid-template-columns:1fr}.probe-mode{gap:12px}}
</style>

<style scoped>
.phone-page{--ink:#243833;--forest:#294c40;--muted:#66756b;--line:#ddd8ca;--paper:#faf8f0;--wash:#f1eee4;--copper:#ad6548;position:relative;isolation:isolate;min-height:100svh;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse at 78% 9%,#e8e4d8 0,transparent 30%),#f5f2e9;color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.page-grain{position:absolute;z-index:-1;inset:0;opacity:.13;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.15'/%3E%3C/svg%3E")}.masthead,.page-footer{width:min(100%,1030px);margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:22px 28px}.masthead{border-bottom:1px solid #d9d5c8}.wordmark{display:flex;align-items:center;gap:9px;color:#294c40;text-decoration:none;font-size:10px;font-weight:850;letter-spacing:1.5px}.mark{display:grid;width:25px;height:25px;place-items:center;border:1px solid #9aa99b;border-radius:50%;color:#51755f;font-size:15px}.edition,.page-footer>span{color:#7d867b;font:9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.8px}.instrument{width:min(100%,930px);margin:0 auto;padding:43px 28px 35px;flex:1}.instrument-topline{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid #cfcabd;color:#69796e;font:9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1.2px}.live-indicator{display:flex;align-items:center;gap:7px;color:#807e6f;letter-spacing:.15px}.live-indicator i,.recording-tag i{width:6px;height:6px;border-radius:50%;background:#b77a57}.live-indicator.active i{background:#397e63;box-shadow:0 0 0 3px #397e631b}.hero{display:grid;grid-template-columns:1fr 215px;gap:28px;align-items:center;padding:30px 0 27px}.eyebrow,.section-kicker{display:flex;align-items:center;gap:8px;color:#63766b;font-size:9px;font-weight:800;letter-spacing:1.2px}.eyebrow span{width:24px;height:1px;background:#b97758}h1{margin:12px 0 10px;color:#243c34;font:400 clamp(39px,7vw,58px)/.99 Georgia,"Times New Roman",serif;letter-spacing:-1.5px}h1 em{color:#9d6249;font-weight:400}.intro{max-width:530px;margin:0;color:#65746b;font:13px/1.65 Georgia,"Times New Roman",serif}.sound-plate{position:relative;display:grid;justify-items:center;gap:4px;padding:12px 10px 7px;border:1px solid #ddd7c9;background:#f8f6ee}.sound-plate svg{width:100%;max-width:180px;overflow:visible;fill:none;stroke:#728e79;stroke-width:.65}.sound-plate svg path:first-child{stroke:#a35f43;stroke-width:1.5}.sound-plate svg .wave-secondary{stroke:#d5d0c3;stroke-dasharray:2 3}.sound-plate svg circle{stroke:#d6d2c6;stroke-dasharray:1 2}.sound-plate span{color:#626356;font:8px ui-monospace,monospace;letter-spacing:.6px}.step-ruler{display:flex;align-items:center;gap:9px;padding:14px 0;border-block:1px solid #dfdbcf}.step-ruler span{display:flex;align-items:center;gap:6px;color:#9a9a8c;font-size:8px;font-weight:750;letter-spacing:.65px;white-space:nowrap}.step-ruler span b{color:#999687;font:9px ui-monospace,monospace}.step-ruler span.current{color:#365e4b}.step-ruler span.current b{color:#b06549}.step-ruler i{width:100%;height:1px;background:#dedace}.work-area{display:grid;grid-template-columns:1fr 1.08fr;gap:12px;margin-top:17px}.step-card{min-width:0;position:relative;display:grid;grid-template-columns:32px 1fr;gap:6px;align-content:start;padding:20px 19px 20px 16px;border:1px solid #dcd7ca;background:#fbf9f2;box-shadow:0 4px 18px #343c2d08}.card-index{color:#805139;font:11px ui-monospace,monospace}.section-kicker{justify-content:space-between;gap:8px;font-size:8px;letter-spacing:.9px}.section-kicker span{color:#66675d;font:8px ui-monospace,monospace;letter-spacing:0;text-align:right}.card-content h2{margin:9px 0 5px;color:#2a4237;font:400 23px/1.12 Georgia,"Times New Roman",serif;letter-spacing:-.4px}.card-content>p{margin:0;color:#566258;font-size:11px;line-height:1.55}.field-label{display:block;margin:16px 0 6px;color:#64776b;font-size:8px;font-weight:800;letter-spacing:.9px}.card-content input{width:100%;height:40px;padding:0 11px;border:1px solid #d9d5c9;border-radius:2px;outline:0;background:#f8f6ee;color:#314b3e;font:12px ui-monospace,monospace}.card-content input:focus{border-color:#73947c;box-shadow:0 0 0 2px #789a801f}.card-content input::placeholder{color:#aaa99b}.primary-button,.stop-button,.quiet-button{min-height:43px;padding:0 14px;border:1px solid #315c48;border-radius:2px;background:#315c48;color:#fffdf5;cursor:pointer;font:700 11px ui-sans-serif,system-ui,sans-serif;letter-spacing:.15px;transition:background .16s,border-color .16s,transform .16s}.primary-button{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;margin-top:11px}.primary-button>span{font-size:15px}.primary-button:hover:not(:disabled){border-color:#244634;background:#244634}.primary-button:active:not(:disabled),.quiet-button:active{transform:translateY(1px)}.primary-button:disabled{border-color:#c8c9bf;background:#e3e2d8;color:#898d80;cursor:not-allowed}.coordinate-fields{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.coordinate-fields label>span{display:flex;align-items:center;gap:6px;margin:0 0 6px;color:#5c7165;font-size:9px;font-weight:800;letter-spacing:.8px}.coordinate-fields label small{color:#a09f91;font-size:8px;font-weight:600;letter-spacing:0}.position-note{display:flex;align-items:center;gap:7px;margin-top:9px!important;color:#a0654a!important;font:9px ui-monospace,monospace!important}.position-note.valid{color:#4e765d!important}.position-note span{font-size:15px}.capture-console{display:flex;align-items:center;gap:11px;margin-top:15px;padding:11px;border:1px solid #dcd9cc;background:#f3f1e8}.console-recording{border-color:#bc896c;background:#fcf4eb}.console-success{border-color:#b4c9b4;background:#edf3e9}.console-symbol{position:relative;display:grid;flex:none;width:39px;height:39px;place-items:center;border:1px solid #c8d4c5;border-radius:50%;background:#f9f8f0}.mic-glyph{color:#54775e;font:20px Georgia,serif}.console-recording .mic-glyph,.recording-tag{color:#ac593e}.pulse-ring{position:absolute;inset:-5px;border:1px solid #b86043;border-radius:50%;animation:pulse 1.3s ease-out infinite}.console-copy{display:grid;min-width:0;gap:4px;flex:1}.console-copy b{color:#3c5245;font:600 11px Georgia,serif}.console-copy small{color:#788077;font-size:9px;line-height:1.35}.console-time{color:#9a9b8d;font:9px ui-monospace,monospace;white-space:nowrap}.recording-tag{display:flex;align-items:center;gap:5px;font:800 8px ui-monospace,monospace;letter-spacing:.5px}.recording-tag i{background:#b85d42;animation:blink 1.1s steps(2) infinite}.capture-actions{display:flex;align-items:center;gap:8px}.capture-actions .primary-button{flex:1}.stop-button{width:100%;margin-top:10px;border-color:#b46b50;background:#fff5ee;color:#92513a}.quiet-button{min-height:38px;margin-top:10px;border-color:#d7d4c8;background:transparent;color:#627166;font-size:10px}.capture-actions .quiet-button{flex:none;padding-inline:11px}.repeat-button{width:100%;border-color:#aec0ac;background:#f6f8f0;color:#476750}.send-button{border-color:#a75e42;background:#a75e42}.send-button:hover:not(:disabled){border-color:#8d4c35;background:#8d4c35}.local-note{margin-top:10px!important;color:#6b7c6e!important;font-size:9px!important}.local-note span{color:#4b8b68}.notice{display:flex;gap:8px;align-items:flex-start;margin:13px 0 0;padding:10px 12px;border:1px solid #bdcdbb;background:#eef3e9;color:#46644f;font-size:10px;line-height:1.45}.notice>b{color:#397c58}.error-notice{border-color:#e4c0ae;background:#fff3ea;color:#8b4e38}.error-notice>b{color:#ae5638}.privacy-note{display:flex;gap:9px;align-items:flex-start;margin-top:15px;padding:11px 13px;border-left:2px solid #b67a58;background:#eeeae0}.privacy-note>span{color:#a4684e;font-size:13px}.privacy-note p{margin:0;color:#73786c;font-size:9px;line-height:1.55}.privacy-note b{color:#556354;font-weight:750}.inline-error{margin-top:8px!important;color:#9b5036!important;font-size:10px!important}.page-footer{border-top:1px solid #dedace}.page-footer button{border:0;background:transparent;color:#647366;cursor:pointer;font-size:10px}.page-footer button span{padding-left:4px;color:#a76043}button:focus-visible{outline:2px solid #a96246;outline-offset:3px}@keyframes pulse{0%{transform:scale(.85);opacity:.9}100%{transform:scale(1.35);opacity:0}}@keyframes blink{50%{opacity:.35}}
.capture-detail{display:grid;gap:4px;margin:8px 0 0;color:#4e5e53;font-size:9px;line-height:1.45}.capture-detail b{color:#375b46;font-weight:750}.capture-detail span{font:8px ui-monospace,monospace;color:#58665a}.capture-detail small{color:#69766a;font-size:8px}.support-note{display:block;margin-top:8px;color:#59685d}
.usb-notice{margin-top:11px;align-items:flex-start}.usb-notice b{white-space:nowrap}.usb-notice span{line-height:1.45}.cancel-send{white-space:nowrap}
@media(max-width:650px){.masthead,.page-footer{padding:16px 18px}.edition{font-size:8px;letter-spacing:.35px}.instrument{padding:27px 18px 28px}.hero{grid-template-columns:minmax(0,1fr) 116px;gap:14px;padding:25px 0 22px}.sound-plate{padding:7px 5px}.sound-plate svg{max-width:120px}.sound-plate span{font-size:7px}h1{font-size:clamp(37px,10vw,50px)}.intro{font-size:12px}.step-ruler{gap:5px}.step-ruler span{gap:4px;font-size:7px;letter-spacing:.2px}.step-ruler span b{font-size:8px}.work-area{grid-template-columns:1fr;gap:9px;margin-top:12px}.step-card{padding:17px 15px 17px 13px}.capture-card .card-content>p{max-width:440px}.capture-console{margin-top:12px}}
@media(max-width:370px){.edition{display:none}.hero{grid-template-columns:1fr}.sound-plate{display:none}.instrument{padding-inline:13px}.step-ruler{gap:4px}.step-ruler span{font-size:6.5px}.step-ruler span b{font-size:7px}.section-kicker{font-size:7px}.section-kicker span{font-size:7px}.step-card{grid-template-columns:24px 1fr;padding-inline:10px}.page-footer{padding-inline:13px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
</style>
