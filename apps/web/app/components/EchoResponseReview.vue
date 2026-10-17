<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { compareEchoResponses, type inspectEchoSignal } from '../../../../packages/echo-diagnostics'
import type { EchoScanReview } from '../../../../packages/echo-scan'
import type { SatelliteCapture } from '../../../../packages/satellite'
import EchoAcquisitionDetails from './EchoAcquisitionDetails.vue'

const props = defineProps<{ recordings: readonly SatelliteCapture[]; reviews: Record<string, EchoScanReview> }>()
type SignalQuality = ReturnType<typeof inspectEchoSignal>
const quality = shallowRef<Record<string, SignalQuality>>({})
const qualityError = ref(''), checking = ref(false)
let worker: Worker | undefined, generation = 0
const comparison = computed(() => compareEchoResponses(props.recordings.map(recording => ({
  captureId: recording.id, position: recording.position, peaks: props.reviews[recording.id]?.peaks ?? [],
}))))
const rows = computed(() => props.recordings.map((recording, index) => {
  const peaks = props.reviews[recording.id]?.peaks ?? []
  const reference = comparison.value.references.find(item => item.captureId === recording.id)
  const strength = reference ? peaks[reference.peakIndex]!.strength : 0
  return {
    recording, index, reference,
    peaks: reference ? peaks.flatMap((peak, peakIndex) => {
      const relativeMs = peak.delayMs - reference.delayMs
      return relativeMs < 0 || relativeMs > 175 ? [] : [{
        peakIndex, relativeMs, strength: strength > 0 ? peak.strength / strength : 0,
        stationary: comparison.value.stationaryTracks.some(track => track.arrivals.some(arrival => arrival.captureId === recording.id && arrival.peakIndex === peakIndex)),
      }]
    }) : [],
  }
}))
const maxDelay = computed(() => Math.max(12, ...rows.value.flatMap(row => row.peaks.map(peak => peak.relativeMs * 1.1))))
const plotHeight = computed(() => 72 + rows.value.length * 48)
const plotX = (delay: number) => 124 + delay / maxDelay.value * 468
const firstTrack = computed(() => comparison.value.stationaryTracks[0])
const allAnalyzed = computed(() => rows.value.every(row => !!row.reference))

watch(() => props.recordings, recordings => {
  const id = ++generation
  worker?.terminate(); worker = undefined
  quality.value = {}; qualityError.value = ''; checking.value = recordings.length > 0
  if (!recordings.length) return
  try {
    const current = new Worker(new URL('../workers/echo-quality.worker.ts', import.meta.url), { type: 'module' })
    worker = current
    current.onmessage = (event: MessageEvent<{ id: number; error?: string; results?: { id: string; quality: SignalQuality }[] }>) => {
      if (id !== generation || event.data.id !== id) return
      checking.value = false
      if (event.data.error) qualityError.value = event.data.error
      else quality.value = Object.fromEntries((event.data.results ?? []).map(result => [result.id, result.quality]))
      current.terminate(); if (worker === current) worker = undefined
    }
    current.onerror = () => {
      if (id === generation) { checking.value = false; qualityError.value = 'Signal checks are unavailable. Export the raw recordings for review.' }
      current.terminate(); if (worker === current) worker = undefined
    }
    current.postMessage({ id, captures: recordings.map(recording => ({ ...recording, position: { ...recording.position } })) })
  } catch { checking.value = false; qualityError.value = 'This browser could not start the signal checks.' }
}, { immediate: true })
onBeforeUnmount(() => { generation++; worker?.terminate() })
</script>

<template>
  <section class="er-review" aria-label="Recording comparison and signal checks" data-testid="echo-response-review">
    <header><span>RECORDING CHECK</span><h3>Does the response move?</h3><p>Compare each recording relative to its strongest peak. This reference is for comparison; choose the direct sound separately for reconstruction.</p></header>
    <svg :viewBox="`0 0 620 ${plotHeight}`" role="img" aria-label="Candidate delays relative to each recording’s strongest peak">
      <g class="er-axis"><line v-for="tick in [0, .25, .5, .75, 1]" :key="tick" :x1="plotX(tick * maxDelay)" y1="18" :x2="plotX(tick * maxDelay)" :y2="plotHeight - 32" /><text v-for="tick in [0, .25, .5, .75, 1]" :key="tick" :x="plotX(tick * maxDelay)" :y="plotHeight - 14" text-anchor="middle">{{ (tick * maxDelay).toFixed(0) }}</text><text x="592" :y="plotHeight - 1" text-anchor="end">ms after strongest peak</text></g>
      <g v-for="row in rows" :key="row.recording.id">
        <text x="8" :y="36 + row.index * 48" class="er-position">P{{ row.index + 1 }}</text>
        <text x="8" :y="49 + row.index * 48" class="er-coordinates">{{ row.recording.position.xM.toFixed(2) }}, {{ row.recording.position.yM.toFixed(2) }} m</text>
        <line x1="124" :y1="49 + row.index * 48" x2="592" :y2="49 + row.index * 48" class="er-baseline" />
        <text v-if="!row.reference" x="136" :y="42 + row.index * 48" class="er-coordinates">{{ props.reviews[row.recording.id]?.peaks.length === 0 ? 'No candidates · analyze sweep to compare' : 'No usable reference' }}</text>
        <g v-for="peak in row.peaks" :key="peak.peakIndex" :class="['er-peak', { 'er-stationary': peak.stationary }]">
          <title>P{{ row.index + 1 }} · +{{ peak.relativeMs.toFixed(2) }} ms{{ peak.stationary ? ' · similar delay across positions' : '' }}</title>
          <line :x1="plotX(peak.relativeMs)" :x2="plotX(peak.relativeMs)" :y1="49 + row.index * 48" :y2="39 + row.index * 48 - Math.sqrt(peak.strength) * 16" />
          <circle :cx="plotX(peak.relativeMs)" :cy="39 + row.index * 48 - Math.sqrt(peak.strength) * 16" r="3" />
        </g>
      </g>
    </svg>
    <div v-if="firstTrack" class="er-finding" role="status" data-testid="echo-stationary-response"><strong>Similar delay across positions</strong><p>A response near +{{ firstTrack.meanDelayMs.toFixed(2) }} ms varies by {{ firstTrack.spreadMs.toFixed(2) }} ms across {{ firstTrack.arrivals.length }} recordings. A fixed delay may come from the phone, floor or ceiling. It does not establish a vertical wall reflection.</p></div>
    <p v-else class="er-comparison-note">{{ !allAnalyzed ? 'Analyze recorded sweeps to compare the candidates.' : !comparison.hasSpatialCoverage ? 'Compare at least three positions spread across both axes to check for fixed responses.' : 'No shared fixed-delay candidate was found. This alone does not verify wall reflections.' }}</p>
    <details class="er-quality" open>
      <summary>Signal integrity <span>{{ checking ? 'Checking…' : `${Object.keys(quality).length} checked` }}</span></summary>
      <p v-if="qualityError" class="er-quality-note" role="status">{{ qualityError }}</p>
      <ul v-else>
        <li v-for="row in rows" :key="row.recording.id" :data-testid="`echo-quality-${row.index + 1}`">
          <b>P{{ row.index + 1 }}</b>
          <div v-if="quality[row.recording.id]">
            <span v-if="quality[row.recording.id]!.zeroRuns.length" class="er-gap">{{ quality[row.recording.id]!.longestZeroRunMs.toFixed(1) }} ms exact silence</span><span v-else>No zero runs ≥5 ms</span>
            <small>{{ quality[row.recording.id]!.clippedSampleCount }} {{ quality[row.recording.id]!.clippedSampleCount === 1 ? 'sample' : 'samples' }} near full scale</small>
            <small v-for="run in quality[row.recording.id]!.zeroRuns.slice(0, 3)" :key="run.startMs">{{ run.startMs.toFixed(1) }}–{{ run.endMs.toFixed(1) }} ms from recording start</small>
            <EchoAcquisitionDetails :acquisition="row.recording.acquisition" />
          </div>
          <span v-else>{{ checking ? 'Checking original PCM…' : 'Check unavailable' }}</span>
        </li>
      </ul>
      <p class="er-quality-note">Exact silence can mean missing input or zero samples supplied by the audio system. These checks cannot distinguish the cause. Samples are preserved as recorded.</p>
    </details>
  </section>
</template>

<style scoped>
.er-review{padding:24px 23px 26px;border-top:1px solid #cbd5c2;background:#f3f3e9;color:#294336}.er-review header>span{font:8px/1.5 ui-monospace,monospace;letter-spacing:1.3px;color:#64725b}.er-review h3{font:400 25px/1.15 Georgia,serif;letter-spacing:-.5px;margin:8px 0 10px}.er-review p{font-size:11px;line-height:1.7;margin:0;color:#566650}.er-review svg{display:block;width:100%;height:auto;margin:18px 0}.er-axis line{stroke:#c8d3bd;stroke-dasharray:2 4;stroke-width:.7}.er-axis text,.er-coordinates{fill:#5d6d54;font:9px ui-monospace,monospace}.er-position{fill:#294e38;font:600 11px ui-monospace,monospace}.er-baseline{stroke:#b7c4aa;stroke-width:.7}.er-peak line{stroke:#3f6a4d;stroke-width:1.5}.er-peak circle{fill:#3f6a4d}.er-stationary line{stroke:#ac603c;stroke-width:2}.er-stationary circle{fill:#ac603c}.er-finding{border-left:3px solid #ac603c;background:#f0e8d9;padding:12px 14px}.er-finding strong{font:400 16px Georgia,serif;color:#754b33}.er-finding p{margin-top:6px;color:#6d5b43}.er-comparison-note{padding:10px 0}.er-quality{border-top:1px solid #ccd5bf;margin-top:20px;padding-top:14px}.er-quality summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer;font:400 16px Georgia,serif}.er-quality summary>span{font:9px/1.7 ui-monospace,monospace;color:#5d7053}.er-quality ul{list-style:none;margin:12px 0;padding:0}.er-quality li{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid #d9dece;font:10px/1.6 ui-monospace,monospace}.er-quality li>b{flex:none;color:#35573b}.er-quality li>div{display:grid;gap:2px}.er-quality small{display:block;color:#657159;font:9px/1.7 ui-monospace,monospace}.er-quality .er-gap{color:#8a4c30}.er-quality .er-quality-note{margin-top:10px;font-size:10px;color:#6d624a}@media(max-width:760px){.er-review{padding:22px}.er-review h3{font-size:24px}}@media(max-width:360px){.er-review{padding:20px}.er-review svg{margin-left:-6px;width:calc(100% + 12px)}}
</style>
