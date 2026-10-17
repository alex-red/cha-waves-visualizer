<script setup lang="ts">
import { computed } from 'vue'
import type { AcquisitionMetadata } from '../../../../packages/acquisition'

const props = defineProps<{ acquisition: AcquisitionMetadata | undefined }>()
const processing = [
  { key: 'echoCancellation', label: 'Echo cancellation' },
  { key: 'noiseSuppression', label: 'Noise suppression' },
  { key: 'autoGainControl', label: 'Automatic gain' },
] as const
const state = (value: boolean | undefined) => value === undefined ? 'Not reported' : value ? 'On' : 'Off'
const milliseconds = (frames: number) => `${(frames * 1000 / props.acquisition!.timing.contextSampleRate).toFixed(2)} ms`
const scheduledOffset = computed(() => {
  const timing = props.acquisition?.timing
  return timing?.captureStartFrame === undefined || timing.captureStartFrame === null
    ? null : milliseconds(timing.scheduledChirpStartFrame - timing.captureStartFrame)
})
const processingEnabled = computed(() => processing.some(({ key }) => props.acquisition?.applied[key] === true))
const inputInterrupted = computed(() => {
  const continuity = props.acquisition?.continuity
  return continuity?.status === 'observed' && (continuity.missingInputFrames > 0 || continuity.unobservedFrames > 0)
})
</script>

<template>
  <p v-if="!acquisition" class="ea-unknown" data-testid="echo-acquisition-unknown">Acquisition conditions unknown · this recording has no telemetry.</p>
  <details v-else class="ea-details" data-testid="echo-acquisition-details">
    <summary>Recording conditions <span>{{ acquisition.continuity.status === 'unavailable' ? 'Continuity unknown' : inputInterrupted ? 'Input interruption' : 'Input observed' }}</span></summary>
    <p v-if="processingEnabled" class="ea-warning" role="status">The browser reports audio processing enabled. Reflections may be altered.</p>
    <p v-if="inputInterrupted" class="ea-warning" role="status">Part of the capture window has missing or unobserved input. Review the frame counts before using this recording.</p>
    <dl class="ea-settings">
      <template v-for="item in processing" :key="item.key"><dt>{{ item.label }}</dt><dd>Requested {{ state(acquisition.requested[item.key]).toLowerCase() }} · reported {{ state(acquisition.applied[item.key]).toLowerCase() }}</dd></template>
      <dt>Microphone / analysis rate</dt><dd>{{ acquisition.applied.sampleRate === undefined ? 'Not reported' : `${acquisition.applied.sampleRate} Hz` }} / {{ acquisition.timing.contextSampleRate }} Hz</dd>
    </dl>
    <template v-if="acquisition.continuity.status === 'observed'">
      <dl class="ea-counts">
        <dt>Missing input</dt><dd>{{ acquisition.continuity.missingInputFrames }} frames · {{ milliseconds(acquisition.continuity.missingInputFrames) }}</dd>
        <dt>Unobserved window</dt><dd>{{ acquisition.continuity.unobservedFrames }} frames · {{ milliseconds(acquisition.continuity.unobservedFrames) }}</dd>
        <dt>Present zero samples</dt><dd>{{ acquisition.continuity.presentZeroFrames }} frames · {{ milliseconds(acquisition.continuity.presentZeroFrames) }}</dd>
        <dt>Longest present zero run</dt><dd>{{ milliseconds(acquisition.continuity.longestPresentZeroRunFrames) }}</dd>
      </dl>
      <p>Present zeros arrived as input samples. Their hardware or processing cause is unknown. Missing and unobserved frames retain their original positions in the recording.</p>
    </template>
    <p v-else>Input continuity was not observed. Zero samples alone cannot establish whether input was missing.</p>
    <dl class="ea-clock"><dt>Timing</dt><dd>{{ acquisition.timing.precision === 'sample-frame' ? 'AudioContext sample frames' : 'Approximate compatibility timing' }}</dd><dt>Scheduled sweep</dt><dd>{{ scheduledOffset === null ? 'Capture start is unaligned' : `${scheduledOffset} after planned capture start` }}</dd></dl>
    <p>These are software schedules and browser-reported settings. They do not measure acoustic arrival time or verify unprocessed hardware audio.</p>
  </details>
</template>

<style scoped>
.ea-unknown{margin:10px 0 0;color:#72644f;font:10px/1.6 ui-sans-serif,system-ui,sans-serif}.ea-details{margin-top:12px;padding:10px 0;border-top:1px solid #cbd5bf;color:#35513b;font:10px/1.65 ui-sans-serif,system-ui,sans-serif}.ea-details summary{cursor:pointer;font-weight:600;line-height:1.8}.ea-details summary>span{display:block;color:#6a725c;font:9px/1.6 ui-monospace,monospace}.ea-details p{margin:10px 0 0;font:10px/1.65 ui-sans-serif,system-ui,sans-serif;color:#6a664e}.ea-details .ea-warning{padding:8px 10px;background:#f4e7d6;border-left:2px solid #ac603c;color:#805136}.ea-details dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:7px 12px;margin:12px 0 0;padding-top:10px;border-top:1px solid #d8dece}.ea-details dt{color:#53664c}.ea-details dd{margin:0;overflow-wrap:anywhere;color:#36543d;font:9px/1.7 ui-monospace,monospace}
</style>
