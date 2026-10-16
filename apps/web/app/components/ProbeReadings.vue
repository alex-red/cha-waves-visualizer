<script setup lang="ts">
import { computed } from 'vue'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import { explainProbeInvalidReason, exportProbeReadingsCsv, summarizeProbes } from '../../../../packages/probes'

const props = defineProps<{
  scene: Scene
  settings: SolverSettings
  baseline?: { scene: Scene; settings: SolverSettings } | undefined
  selectedId?: string | undefined
}>()

const emit = defineEmits<{
  select: [probeId: string]
  close: []
  export: []
}>()

const summary = computed(() => summarizeProbes(props.scene, props.settings, props.baseline))
const modeName = computed(() => summary.value.domain === 'acoustics' ? 'Sound field' : 'Wi-Fi field')
const bandLabel = computed(() => summary.value.domain === 'acoustics'
  ? `${formatFrequency(summary.value.frequencyHz)} acoustic band`
  : `${formatFrequency(summary.value.frequencyHz)} radio band`)
const sourceLabel = computed(() => {
  const source = props.scene.emitters.find(item => item.active && item.domain === summary.value.domain)
  return source ? `Active source · ${source.domain === 'acoustics' ? 'acoustic' : 'radio'}` : 'No active source'
})

function formatFrequency(value: number): string {
  if (value >= 1e9) return `${trim(value / 1e9)} GHz`
  if (value >= 1e6) return `${trim(value / 1e6)} MHz`
  if (value >= 1e3) return `${trim(value / 1e3)} kHz`
  return `${trim(value)} Hz`
}
function trim(value: number): string { return Number(value.toFixed(2)).toString() }
function levelName(levelId: string): string {
  return props.scene.levels.find(level => level.id === levelId)?.name ?? levelId
}
function number(value: number): string { return value.toFixed(2) }
function readingValue(value: number | undefined, unit: string): string {
  return value === undefined ? '—' : `${value.toFixed(1)} ${unit}`
}
function invalidReason(reason: string | undefined): string {
  if (!reason) return 'The solver could not produce a valid reading.'
  return explainProbeInvalidReason(reason as Parameters<typeof explainProbeInvalidReason>[0])
}
function downloadCsv() {
  const csv = exportProbeReadingsCsv(summary.value)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `probe-readings-${summary.value.domain}.csv`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  emit('export')
}
</script>

<template>
  <section class="probe-panel" aria-labelledby="probe-title" data-testid="probe-readings-panel">
    <header class="panel-head">
      <div class="heading-copy">
        <div class="eyebrow">FIELD NOTES <span class="eyebrow-rule" /></div>
        <h2 id="probe-title">Probe readings</h2>
        <p class="panel-deck">Exact point solver · {{ modeName }}</p>
      </div>
      <div class="head-actions">
        <button class="export-button" type="button" data-testid="readings-export" aria-label="Export probe readings CSV" @click="downloadCsv">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 1.7v8.1m0 0 3-3m-3 3-3-3M2.5 10.5v3h11v-3" /></svg>
          <span>Export CSV</span>
        </button>
        <button class="close-button" type="button" aria-label="Close probe readings" autofocus @click="emit('close')">×</button>
      </div>
    </header>

    <div class="context-strip" aria-label="Current solver context">
      <span class="context-mark" aria-hidden="true">◉</span>
      <span class="context-source">{{ sourceLabel }}</span>
      <span class="context-divider" aria-hidden="true" />
      <span>{{ bandLabel }}</span>
      <span class="context-spacer" />
      <span class="context-quantity">{{ summary.quantity === 'relative-direct-level-db' ? 'Relative level' : 'Received power' }} · {{ summary.unit }}</span>
    </div>

    <div v-if="summary.readings.length" class="reading-list" aria-label="Saved probe readings">
      <article
        v-for="reading in summary.readings"
        :key="reading.id"
        class="reading-card"
        :class="{ selected: reading.id === selectedId, invalid: !reading.result.valid }"
        :aria-current="reading.id === selectedId ? 'true' : undefined"
        data-testid="probe-reading-row"
        :data-probe-id="reading.id"
      >
        <div class="reading-main">
          <div class="probe-index" aria-hidden="true"><span /></div>
          <div class="probe-title-block">
            <div class="probe-name-line">
              <h3>{{ reading.name }}</h3>
              <span v-if="reading.id === selectedId" class="selected-tag">Selected</span>
            </div>
            <p class="level-label">{{ levelName(reading.levelId) }} <span>·</span> {{ reading.id }}</p>
          </div>
          <button class="locate-button" type="button" :aria-label="`Choose ${reading.name} on the plan`" @click="emit('select', reading.id)">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 14s4.5-4.3 4.5-8A4.5 4.5 0 0 0 3.5 6c0 3.7 4.5 8 4.5 8Z" /><circle cx="8" cy="6" r="1.5" /></svg>
            <span>Locate</span>
          </button>
        </div>

        <div class="reading-details">
          <div class="coordinates" aria-label="Probe coordinates in metres">
            <span class="detail-label">POSITION <small>m</small></span>
            <span class="coordinate-values"><b>X</b> {{ number(reading.position[0]) }} <b>Y</b> {{ number(reading.position[1]) }} <b>Z</b> {{ number(reading.position[2]) }}</span>
            <span class="floor-height">{{ number(reading.position[2] - (scene.levels.find(level => level.id === reading.levelId)?.floorZ ?? 0)) }} m above floor</span>
          </div>
          <div class="result-cell">
            <span class="detail-label">EXACT READING</span>
            <strong v-if="reading.result.valid" class="value">{{ readingValue(reading.result.value, reading.result.unit) }}</strong>
            <strong v-else class="value unavailable">Unavailable</strong>
          </div>
          <div class="result-cell baseline-cell">
            <span class="detail-label">BASELINE CHANGE</span>
            <template v-if="baseline">
              <strong v-if="reading.baseline?.delta !== undefined" class="value delta">{{ reading.baseline.delta > 0 ? '+' : '' }}{{ reading.baseline.delta.toFixed(1) }} dB</strong>
              <strong v-else class="value unavailable">Unavailable</strong>
            </template>
            <strong v-else class="value no-baseline">No baseline</strong>
            <span v-if="baseline && reading.baseline?.reason" class="baseline-reason">{{ reading.baseline.reason }}</span>
            <span v-else-if="baseline && reading.baseline?.delta !== undefined" class="delta-caption">Current − baseline</span>
          </div>
        </div>

        <p v-if="!reading.result.valid" class="invalid-note" role="status">
          <span class="invalid-dot" aria-hidden="true">!</span>{{ invalidReason(reading.result.reason) }}
        </p>
      </article>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon" aria-hidden="true">⌖</div>
      <h3>No probes in this scene</h3>
      <p>Add a probe on the plan to capture an exact reading at that position.</p>
    </div>

    <footer class="panel-foot">
      <span><i aria-hidden="true" /> {{ summary.readings.length }} saved probe{{ summary.readings.length === 1 ? '' : 's' }}</span>
      <span>Coordinates and readings update with the current scene</span>
    </footer>
  </section>
</template>

<style scoped>
.probe-panel{--ink:#263735;--muted:#52645b;--line:#e5dfd3;--paper:#fbf9f3;--teal:#176d70;color:var(--ink);background:var(--paper);border:1px solid #ddd6c9;border-radius:8px;overflow:hidden;box-shadow:0 18px 55px #182c2817;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 24px 19px}.eyebrow{display:flex;align-items:center;gap:9px;color:#52645b;font-size:9px;font-weight:800;letter-spacing:1.65px}.eyebrow-rule{width:24px;height:1px;background:#8fa9a0}h2{margin:7px 0 0;font:400 27px/1.1 Georgia,"Times New Roman",serif;letter-spacing:-.6px}.panel-deck{margin:6px 0 0;color:#52645b;font-size:11px;letter-spacing:.1px}.head-actions{display:flex;align-items:center;gap:9px}.export-button,.close-button{display:inline-flex;align-items:center;justify-content:center;border:1px solid #d8d2c6;background:#fffdf8;color:#394b45;cursor:pointer;transition:background .16s,border-color .16s,transform .16s}.export-button span{color:inherit}.export-button{height:35px;gap:8px;padding:0 12px;border-radius:4px;font:600 10px ui-sans-serif,system-ui,sans-serif;letter-spacing:.2px}.export-button svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}.close-button{width:35px;height:35px;border-radius:4px;font:300 22px/1 Georgia,serif;color:#52645b}.export-button:hover,.close-button:hover{background:#edf3ee;border-color:#9cb5aa}.export-button:active,.close-button:active{transform:translateY(1px)}button:focus-visible{outline:2px solid #257d7e;outline-offset:2px}
.context-strip{min-height:38px;display:flex;align-items:center;gap:9px;padding:0 24px;background:#f1eee5;border-top:1px solid #ebe6dc;border-bottom:1px solid #e5dfd3;color:#52645b;font-size:10px}.context-mark{font-size:12px;color:var(--teal)}.context-source{font-weight:650;color:#40554e}.context-divider{width:1px;height:13px;background:#d6d2c8}.context-spacer{flex:1}.context-quantity{color:#52645b;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
.reading-list{display:grid;gap:9px;padding:13px 16px 15px;max-height:min(60vh,570px);overflow:auto;overscroll-behavior:contain}.reading-card{position:relative;min-width:0;border:1px solid var(--line);border-radius:5px;background:#fffdf9;transition:border-color .16s,box-shadow .16s}.reading-card.selected{border-color:#8fb5aa;box-shadow:inset 3px 0 0 #277777,0 2px 8px #27645b0d}.reading-main{display:flex;align-items:center;gap:11px;padding:12px 14px 10px}.probe-index{flex:0 0 27px;width:27px;height:27px;display:grid;place-items:center;border:1px solid #b8ccc1;border-radius:50%;background:#f0f5ee}.probe-index span{width:7px;height:7px;border:2px solid var(--teal);border-radius:50%;background:#fff}.probe-title-block{min-width:0;flex:1}.probe-name-line{display:flex;align-items:center;gap:8px;min-width:0}.probe-name-line h3{overflow:hidden;margin:0;color:#2b3e39;text-overflow:ellipsis;white-space:nowrap;font:600 13px/1.25 Georgia,"Times New Roman",serif}.selected-tag{flex:none;padding:2px 5px;border-radius:2px;background:#e3efea;color:#286965;font-size:8px;font-weight:750;letter-spacing:.45px;text-transform:uppercase}.level-label{overflow:hidden;margin:3px 0 0;color:#52645b;text-overflow:ellipsis;white-space:nowrap;font:9px ui-monospace,SFMono-Regular,Menlo,monospace}.level-label span{padding:0 3px;color:#52645b}.locate-button{flex:none;display:flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid #e0e4dc;border-radius:3px;background:#f7f8f1;color:#4c6f67;cursor:pointer;font:600 9px ui-sans-serif,system-ui,sans-serif}.locate-button svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}.locate-button:hover{border-color:#9db8ad;background:#edf4ed}.reading-details{display:grid;grid-template-columns:minmax(180px,1.35fr) minmax(115px,.8fr) minmax(135px,1fr);gap:10px;align-items:stretch;padding:0 14px 12px 52px}.coordinates,.result-cell{display:flex;min-width:0;flex-direction:column;justify-content:center;gap:4px;padding:8px 9px;border-radius:3px;background:#f5f2ea}.detail-label{color:#52645b;font-size:8px;font-weight:800;letter-spacing:.9px}.detail-label small{font:inherit;font-size:8px;letter-spacing:0;text-transform:none}.coordinate-values{color:#394c47;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.coordinate-values b{margin-right:2px;color:#52645b;font-size:8px;font-weight:700}.coordinate-values b:not(:first-child){margin-left:5px}.floor-height{color:#52645b;font-size:9px}.value{color:#293d38;font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.value.delta{color:#187276}.value.unavailable{color:#a04d35;font:600 11px ui-sans-serif,system-ui,sans-serif}.value.no-baseline{color:#52645b;font:500 10px ui-sans-serif,system-ui,sans-serif}.delta-caption,.baseline-reason{overflow:hidden;color:#52645b;text-overflow:ellipsis;font-size:9px;line-height:1.3}.baseline-reason{color:#975238}.invalid-note{display:flex;align-items:flex-start;gap:7px;margin:0;padding:8px 14px 9px 52px;border-top:1px solid #f0e1d7;background:#fff8f2;color:#925039;font-size:10px;line-height:1.35}.invalid-dot{display:inline-grid;flex:none;width:13px;height:13px;place-items:center;border-radius:50%;background:#f2dfd1;color:#914a31;font-size:9px;font-weight:800}.empty-state{display:grid;justify-items:center;padding:43px 20px 46px;text-align:center}.empty-icon{display:grid;width:38px;height:38px;place-items:center;border:1px solid #bed0c5;border-radius:50%;color:#52645b;font-size:22px}.empty-state h3{margin:13px 0 4px;font:400 18px Georgia,"Times New Roman",serif}.empty-state p{max-width:260px;margin:0;color:#52645b;font-size:11px;line-height:1.55}.panel-foot{display:flex;justify-content:space-between;gap:14px;padding:10px 20px;border-top:1px solid #e9e4da;color:#52645b;font-size:9px}.panel-foot>span:first-child{display:flex;align-items:center;gap:6px;color:#52645b;font-weight:650}.panel-foot i{width:6px;height:6px;border-radius:50%;background:#3d897d}
@media(max-width:540px){.panel-head{padding:18px 16px 15px}.eyebrow{font-size:8px}h2{font-size:24px}.head-actions{gap:6px}.export-button{width:35px;padding:0}.export-button span{display:none}.context-strip{flex-wrap:wrap;gap:7px;padding:8px 16px;font-size:9px}.context-quantity{width:100%;padding-left:20px}.context-spacer{display:none}.reading-list{padding:10px;max-height:65vh}.reading-main{gap:8px;padding:11px 10px 9px}.probe-index{width:24px;height:24px;flex-basis:24px}.probe-name-line h3{font-size:12px}.level-label{font-size:8px}.locate-button{padding:6px}.locate-button span{display:none}.reading-details{grid-template-columns:1fr 1fr;gap:6px;padding:0 10px 10px 42px}.coordinates{grid-column:1/-1}.coordinate-values{font-size:10px}.baseline-cell{grid-column:1/-1;min-height:54px}.invalid-note{padding-left:42px}.panel-foot{padding:9px 12px;font-size:8px}.panel-foot>span:last-child{text-align:right}}
@media(max-width:350px){.panel-head{gap:8px;padding-right:12px;padding-left:12px}.reading-details{padding-left:10px}.reading-main{padding-right:8px;padding-left:8px}.panel-foot{gap:8px}.context-strip{padding-right:12px;padding-left:12px}}
</style>
