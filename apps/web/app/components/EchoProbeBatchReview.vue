<script setup lang="ts">
import type { ProbeBatch, ProbeInterruption } from '../../../../packages/probe-batch'

defineProps<{ batches: readonly ProbeBatch[] }>()
const reasons: Record<ProbeInterruption, string> = {
  cancelled: 'Stopped by user', hidden: 'Page hidden', 'microphone-ended': 'Microphone stopped',
  'audio-context': 'Audio clock stopped', 'capture-error': 'Capture failed', timeout: 'Capture timed out',
}
const orientations = { 'screen-up': 'Screen up', 'screen-down': 'Screen down', upright: 'Upright' }
</script>

<template>
  <section v-if="batches.length" class="pb-review" aria-label="Repeated probe series" data-testid="echo-probe-batches">
    <article v-for="batch in batches" :key="batch.id" class="pb-batch" data-testid="echo-probe-batch">
      <div class="pb-title"><h3>Five sweeps, one position</h3><span>{{ batch.attempts.filter(a => a.status === 'captured').length }} / 5 captured</span></div>
      <p>X {{ batch.position.xM.toFixed(2) }} · Y {{ batch.position.yM.toFixed(2) }} m · {{ batch.context.heightM.toFixed(2) }} m high</p>
      <ol aria-label="Probe outcomes">
        <li v-for="attempt in batch.attempts" :key="attempt.index" :class="`pb-${attempt.status}`">
          <b>{{ String(attempt.index).padStart(2, '0') }}</b>
          <span>{{ attempt.status === 'captured' ? 'Captured' : attempt.status === 'interrupted' ? reasons[attempt.reason] : 'Not started' }}</span>
        </li>
      </ol>
      <details><summary>Series context</summary><dl>
        <dt>Phone</dt><dd>{{ orientations[batch.context.orientation] }} · heading {{ batch.context.headingDeg }}° clockwise from +X ({{ batch.context.orientation === 'upright' ? 'screen direction' : 'top edge' }})</dd>
        <dt>Reported volume</dt><dd>{{ batch.context.speakerVolumePercent }}%</dd>
        <dt>Probe gain</dt><dd>{{ batch.playbackGain }} · software playback</dd>
        <dt>Observed warm-up clock</dt><dd>{{ ((batch.warmupEndFrame - batch.warmupStartFrame) * 1000 / batch.sampleRate).toFixed(0) }} ms of {{ batch.warmupMs }} ms planned</dd>
        <dt>Started</dt><dd>{{ batch.startedAt }}</dd>
        <dt>Series ID</dt><dd>{{ batch.id }}</dd>
      </dl><p>Pose and volume are manual reports. Warm-up and probe windows use the software clock; they do not establish stable hardware gain or acoustic timing.</p></details>
    </article>
  </section>
</template>

<style scoped>
.pb-review{padding:20px 22px;border-top:1px solid #ccd5c3;color:#294c40;background:#f1f2e7}.pb-batch+.pb-batch{margin-top:22px;padding-top:20px;border-top:1px solid #ccd5c3}.pb-title{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}.pb-title h3{margin:0;font:400 22px/1.2 Georgia,serif;letter-spacing:-.4px}.pb-title>span{font:10px ui-monospace,monospace}.pb-batch p{font:11px/1.7 ui-sans-serif,system-ui,sans-serif;color:#5a6858;margin:9px 0}.pb-batch ol{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;list-style:none;margin:16px 0;padding:0}.pb-batch li{padding:10px 6px;min-width:0;background:#e3eadc;border-top:2px solid #426d4a}.pb-batch li b{display:block;font:14px Georgia,serif}.pb-batch li span{display:block;font:9px/1.5 ui-sans-serif,system-ui,sans-serif;margin-top:5px;overflow-wrap:anywhere}.pb-batch .pb-interrupted{border-color:#a55a38;background:#f0e1cf;color:#7c472c}.pb-batch .pb-not-started{border-color:#a5ad9b;background:#e8e9df;color:#606958}.pb-batch details{font:11px/1.7 ui-sans-serif,system-ui,sans-serif}.pb-batch summary{cursor:pointer;text-decoration:underline;text-underline-offset:3px}.pb-batch dl{display:grid;grid-template-columns:1fr 1.5fr;gap:8px;margin:12px 0}.pb-batch dt{color:#5a6858}.pb-batch dd{margin:0;font:10px/1.7 ui-monospace,monospace;overflow-wrap:anywhere}@media(max-width:360px){.pb-review{padding:18px 14px}.pb-title h3{font-size:20px}.pb-batch ol{gap:3px}.pb-batch li{padding:8px 4px}.pb-batch li span{font-size:8px}}
</style>

<style scoped>
@media(max-width:480px){.pb-batch ol{grid-template-columns:1fr;gap:5px}.pb-batch li{display:flex;align-items:baseline;gap:12px;padding:7px 10px;border-top:0;border-left:2px solid #426d4a}.pb-batch li b{font-size:13px}.pb-batch li span{font-size:10px;margin:0}.pb-batch .pb-interrupted{border-left-color:#a55a38}.pb-batch .pb-not-started{border-left-color:#a5ad9b}}
</style>
