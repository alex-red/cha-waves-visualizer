<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import type { RfSurvey, SurveyComparison } from '../../../../packages/survey'
import { createPlanTransform } from '../lib/plan-viewport'

const props = defineProps<{
  scene: Scene
  settings: SolverSettings
  survey: RfSurvey | null
  comparison: SurveyComparison | null
  disabled: boolean
  error: string
  notice?: string
}>()

const emit = defineEmits<{
  import: [payload: { text: string; name: string; notes: string }]
  clear: []
  template: []
  export: []
  close: []
}>()

const draftName = ref('RSSI survey')
const draftNotes = ref('')
const draftCsv = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const localError = ref('')
const readingFile = ref(false)
let fileReadGeneration = 0

onBeforeUnmount(() => { fileReadGeneration++ })

const radioSource = computed(() => props.scene.emitters.find(item => item.domain === 'radio' && item.active) ?? null)
const activeSource = computed(() => props.scene.emitters.find(item => item.domain === props.settings.mode && item.active) ?? null)
const domainLabel = computed(() => props.settings.mode === 'radio' ? 'Wi-Fi field' : 'Sound field')
const sourceLabel = computed(() => activeSource.value ? `${activeSource.value.id} · ${activeSource.value.domain}` : 'No active source')
function formatFrequency(value: number) {
  const units = value >= 1e9 ? [1e9, 'GHz'] as const : value >= 1e6 ? [1e6, 'MHz'] as const : value >= 1e3 ? [1e3, 'kHz'] as const : [1, 'Hz'] as const
  return `${value / units[0]} ${units[1]}`
}
const frequencyLabel = computed(() => formatFrequency(props.settings.frequencyHz))
const selectedLevel = computed(() => props.scene.levels[0])
const coordinates = (point: readonly number[]) => `X ${point[0]?.toFixed(2)} · Y ${point[1]?.toFixed(2)} · Z ${point[2]?.toFixed(2)} m`
const currentAssumptions = computed(() => props.settings.mode === 'radio'
  ? `Receiver gain ${props.settings.receiverGainDbi.toFixed(1)} dBi · Other loss ${props.settings.otherLossDb.toFixed(1)} dB · Minimum distance ${props.settings.minValidDistanceM.toFixed(2)} m`
  : `Reference distance ${props.settings.referenceDistanceM.toFixed(2)} m · Minimum distance ${props.settings.minValidDistanceM.toFixed(2)} m · Transmission ${props.settings.transmissionEnabled ? 'on' : 'off'}`)
const comparisonRows = computed(() => props.comparison?.rows.slice(0, 500) ?? [])
const summary = computed(() => props.comparison?.summary ?? null)

function metric(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(2)} dB`
}
function residual(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)} dB`
}
function displayReason(value: string | undefined): string {
  if (!value) return 'Excluded from residual summary.'
  const reasonLabels: Record<string, string> = {
    'outside-floor': 'Observation is outside the modeled floor.',
    'inside-solid': 'Observation falls inside a modeled solid.',
    'below-model-distance': 'Observation is closer than the model minimum distance.',
    'missing-parameter': 'The model is missing a required material parameter.',
    'unsupported-geometry': 'The model cannot evaluate this geometry.',
  }
  for (const [code, label] of Object.entries(reasonLabels)) if (value.includes(code)) return label
  return value
}
function submitImport() {
  localError.value = ''
  emit('import', { text: draftCsv.value, name: draftName.value.trim() || 'RSSI survey', notes: draftNotes.value.trim() })
}
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const generation = ++fileReadGeneration
  if (!file) return
  readingFile.value = false
  if (file.size > 1024 * 1024) {
    localError.value = 'Choose a CSV file smaller than 1 MiB.'
    input.value = ''
    return
  }
  readingFile.value = true
  localError.value = ''
  try {
    const text = await file.text()
    if (generation !== fileReadGeneration) return
    if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
      localError.value = 'Choose a CSV file smaller than 1 MiB.'
      return
    }
    draftCsv.value = text
  } catch {
    if (generation === fileReadGeneration) localError.value = 'This file could not be read. Try another CSV file.'
  } finally {
    if (generation === fileReadGeneration) { readingFile.value = false; input.value = '' }
  }
}

const plot = computed(() => {
  const level = selectedLevel.value
  if (!level) return null
  const xs = level.boundary.map(point => point[0])
  const ys = level.boundary.map(point => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const transform = createPlanTransform({ minX, maxX, minY, maxY }, 100, 100, { zoom: 1, center: [(minX + maxX) / 2, (minY + maxY) / 2] })
  const project = (point: readonly number[]) => { const result = transform.worldToScreen([point[0]!, point[1]!]); return { x: result[0], y: result[1] } }
  const polygon = level.boundary.map(point => project(point)).map(point => `${point.x},${point.y}`).join(' ')
  const markers = (props.survey?.observations ?? []).filter(row => row.position && row.position.length >= 2).map(row => {
    const match = props.comparison?.rows.find(result => result.id === row.id)
    return { ...project(row.position), id: row.id, label: row.label, valid: match?.valid ?? false, residual: match?.residualDb }
  })
  return { polygon, markers }
})

function markerKind(row: { valid: boolean; residual?: number | undefined }) {
  if (!row.valid) return 'excluded'
  return (row.residual ?? 0) > 0 ? 'positive' : 'negative'
}
function downloadExport() { emit('export') }
</script>

<template>
  <section class="sv-panel" aria-labelledby="sv-title" data-testid="survey-panel">
    <header class="sv-header">
      <div class="sv-title-copy">
        <div class="sv-eyebrow">FIELD NOTES <span class="sv-eyebrow-rule" /></div>
        <h2 id="sv-title">Measurement survey</h2>
        <p class="sv-deck">Compare measured RSSI with the current direct-path estimate.</p>
      </div>
      <button class="sv-close" type="button" aria-label="Close measurement survey" @click="emit('close')">×</button>
    </header>

    <div class="sv-current-context" aria-label="Current solver context">
      <span class="sv-current-dot" aria-hidden="true" />
      <span><b>{{ domainLabel }}</b> · {{ sourceLabel }}</span>
      <span class="sv-current-band">{{ frequencyLabel }}</span>
    </div>
    <p v-if="settings.mode !== 'radio'" class="sv-warning" data-testid="survey-context-warning">
      <strong>Comparison paused in acoustics mode.</strong> Switch to Wi-Fi to compare measured RSSI. Imports remain available in either mode.
    </p>
    <p v-else-if="!radioSource" class="sv-warning" data-testid="survey-context-warning">
      <strong>No active radio source.</strong> Your survey stays saved. Activate a Wi-Fi source to compare its measured RSSI.
    </p>
    <p v-if="error" class="sv-error" role="alert">{{ error }}</p>
    <p v-if="localError" class="sv-error" role="alert">{{ localError }}</p>
    <p v-if="notice" class="sv-notice" role="status">{{ notice }}</p>

    <div v-if="!survey" class="sv-empty-actions">
      <button type="button" class="sv-button sv-button-quiet" data-testid="survey-template" :disabled="disabled || settings.mode !== 'radio' || !radioSource" @click="emit('template')">Download CSV template</button>
    </div>
    <div v-if="survey" class="sv-stored">
      <div class="sv-section-heading"><div><span class="sv-eyebrow">IMPORTED OBSERVATIONS</span><h3>{{ survey.name }}</h3></div><span class="sv-row-count">{{ survey.observations.length }} readings</span></div>
      <p v-if="survey.notes" class="sv-notes">{{ survey.notes }}</p>
      <dl class="sv-context-grid">
        <div><dt>Source</dt><dd>{{ survey.context.sourceId }}</dd></div>
        <div><dt>Survey band</dt><dd>{{ formatFrequency(survey.context.frequencyHz) }}</dd></div>
        <div><dt>Transmitter</dt><dd>{{ coordinates(survey.context.sourcePosition) }}</dd></div>
        <div><dt>Recorded EIRP</dt><dd>{{ survey.context.eirpDbm.toFixed(1) }} dBm</dd></div>
        <div><dt>Level</dt><dd>{{ survey.context.levelId }}<span v-if="selectedLevel?.id === survey.context.levelId"> · {{ selectedLevel.name }}</span></dd></div>
        <div><dt>Scene</dt><dd>{{ survey.context.sceneId }}</dd></div>
      </dl>

      <div v-if="comparison?.compatible && summary" class="sv-comparison">
        <div class="sv-section-heading sv-comparison-heading"><div><span class="sv-eyebrow">MODEL COMPARISON</span><h3>Residual summary</h3></div><span class="sv-definition">Predicted − measured</span></div>
        <div class="sv-metrics" data-testid="survey-summary" :data-valid="summary.validCount" :data-excluded="summary.excludedCount" :data-bias="summary.biasDb ?? ''" :data-mae="summary.maeDb ?? ''" :data-rmse="summary.rmseDb ?? ''">
          <div><span>Valid / excluded</span><strong>{{ summary.validCount }} / {{ summary.excludedCount }}</strong><small>of {{ summary.totalCount }} measured</small></div>
          <div><span>Bias</span><strong>{{ metric(summary.biasDb) }}</strong><small>signed mean residual</small></div>
          <div><span>MAE</span><strong>{{ metric(summary.maeDb) }}</strong><small>mean absolute residual</small></div>
          <div><span>RMSE</span><strong>{{ metric(summary.rmseDb) }}</strong><small>root mean square residual</small></div>
        </div>
        <p class="sv-assumptions">Current model assumptions · {{ currentAssumptions }}</p>

        <div class="sv-map-and-legend">
          <figure v-if="plot" class="sv-plot">
            <svg viewBox="0 0 100 100" role="img" aria-label="Measured observation locations on the survey level">
              <polygon :points="plot.polygon" class="sv-floor-shape" />
              <g v-for="marker in plot.markers" :key="marker.id" :class="`sv-marker sv-marker-${markerKind(marker)}`">
                <circle :cx="marker.x" :cy="marker.y" r="2.2"><title>{{ marker.label || marker.id }} — {{ marker.valid ? residual(marker.residual) : 'excluded' }}</title></circle>
              </g>
            </svg>
            <figcaption>{{ selectedLevel?.name ?? 'Current level' }} · measured observation positions</figcaption>
          </figure>
          <div class="sv-legend" aria-label="Map legend"><b>Marker key</b><span><i class="sv-key sv-key-positive" /> Model above measurement</span><span><i class="sv-key sv-key-negative" /> Model at or below measurement</span><span><i class="sv-key sv-key-excluded" /> Excluded or unavailable</span><small>Location map only · not a predicted heatmap</small></div>
        </div>

        <div class="sv-table-scroll" role="region" aria-label="Measured and predicted survey observations" tabindex="0">
          <table class="sv-table">
            <thead><tr><th scope="col">Observation</th><th scope="col">Position</th><th scope="col">Measured</th><th scope="col">Predicted</th><th scope="col">Residual</th></tr></thead>
            <tbody>
              <tr v-for="row in comparisonRows" :key="row.id" :data-testid="`survey-row`" :data-id="row.id" :data-valid="row.valid" :data-residual="row.residualDb ?? ''" :class="{ 'sv-row-excluded': !row.valid }">
                <th scope="row"><span class="sv-observation-label">{{ row.label || row.id }}</span><small v-if="!row.valid">{{ displayReason(row.reason) }}</small></th>
                <td>{{ coordinates(row.position) }}</td><td class="sv-measured">{{ row.measuredDbm.toFixed(1) }} dBm</td>
                <td>{{ row.predictedDbm === undefined ? 'Unavailable' : `${row.predictedDbm.toFixed(1)} dBm` }}</td><td class="sv-residual">{{ residual(row.residualDb) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="comparisonRows.length < comparison.rows.length" class="sv-truncation">Showing first 500 of {{ comparison.rows.length }} observations.</p>
        <p class="sv-method-note">This is a descriptive comparison with the current configured model. It does not fit parameters or claim calibration or accuracy.</p>
      </div>
      <div v-else-if="comparison && !comparison.compatible" class="sv-incompatible" role="status">
        <strong>Survey and current model contexts differ.</strong>
        <ul><li v-for="reason in comparison.incompatibilities" :key="reason">{{ reason }}</li></ul>
        <p>Predictions and residuals are unavailable until the context is compatible.</p>
      </div>
      <div v-else class="sv-waiting">Comparison results will appear when an active Wi-Fi source and compatible context are available.</div>

      <footer class="sv-actions sv-stored-actions">
        <button type="button" class="sv-button sv-button-quiet" data-testid="survey-template" :disabled="disabled || settings.mode !== 'radio' || !radioSource" @click="emit('template')">Download CSV template</button>
        <button type="button" class="sv-button sv-button-quiet" data-testid="survey-export" :disabled="disabled || survey.observations.length === 0" @click="downloadExport">Export observations</button>
        <button type="button" class="sv-button sv-button-danger" data-testid="survey-clear" :disabled="disabled" @click="emit('clear')">Remove survey</button>
      </footer>
    </div>

    <details class="sv-import" :open="!survey">
      <summary><span class="sv-eyebrow">BRING IN MEASUREMENTS</span><b>{{ survey ? 'Replace survey' : 'Import a CSV survey' }}</b></summary>
      <div class="sv-import-body">
        <p class="sv-import-note">Import measured RSSI in dBm. Template cells for RSSI are blank for your actual measurements; model output is never inserted as an observation.</p>
        <label class="sv-field-label" for="survey-name">Survey name</label>
        <input id="survey-name" v-model="draftName" class="sv-input" type="text" maxlength="100" autocomplete="off" placeholder="RSSI survey" />
        <label class="sv-field-label" for="survey-notes">Notes <span>optional</span></label>
        <textarea id="survey-notes" v-model="draftNotes" class="sv-input sv-notes-input" maxlength="2000" rows="2" placeholder="Collection conditions, device, date…" />
        <label class="sv-field-label" for="survey-csv">CSV data</label>
        <textarea id="survey-csv" v-model="draftCsv" class="sv-input sv-csv-input" rows="7" spellcheck="false" placeholder="Paste the template filled with measured RSSI values" />
        <details class="sv-headers-help"><summary>Required CSV columns (14)</summary><p>id, label, x_m, y_m, z_m, rssi_dbm, frequency_hz, scene_id, level_id, source_id, source_x_m, source_y_m, source_z_m, eirp_dbm</p></details>
        <div class="sv-import-actions">
          <input ref="fileInput" class="sv-file-input" type="file" accept=".csv,text/csv" aria-label="Choose CSV survey file" data-testid="survey-file" @change="readFile" />
          <button type="button" class="sv-button sv-button-quiet" :disabled="disabled || readingFile" @click="fileInput?.click()">{{ readingFile ? 'Reading…' : 'Choose CSV file' }}</button>
          <button type="button" class="sv-button sv-button-primary" data-testid="survey-import" :disabled="disabled || !draftCsv.trim() || readingFile" @click="submitImport">Import survey</button>
        </div>
      </div>
    </details>
  </section>
</template>

<style scoped>
.sv-panel{--sv-ink:#263735;--sv-muted:#52645b;--sv-line:#e5dfd3;--sv-paper:#fbf9f3;--sv-teal:#176d70;--sv-clay:#a45135;color:var(--sv-ink);background:linear-gradient(145deg,#fbf9f3,#f4f1e8);border:1px solid #ddd6c9;border-radius:8px;overflow:hidden;box-shadow:0 18px 55px #182c2817;font:12px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.sv-header{display:flex;align-items:start;justify-content:space-between;gap:16px;padding:21px 23px 16px}.sv-title-copy{min-width:0}.sv-eyebrow{display:flex;align-items:center;gap:8px;color:#65746a;font-size:9px;font-weight:750;letter-spacing:.12em}.sv-eyebrow-rule{width:25px;height:1px;background:#bd8b70}.sv-header h2{margin:6px 0 3px;font:600 22px/1.12 Georgia,"Times New Roman",serif;letter-spacing:-.025em}.sv-deck{margin:0;color:var(--sv-muted);font-size:12px}.sv-close{flex:none;width:32px;height:32px;border:1px solid #d9d1c3;border-radius:50%;background:#fffdf8;color:#50645c;font-size:22px;line-height:1;cursor:pointer}.sv-close:hover{background:#efece2}.sv-close:focus-visible,.sv-button:focus-visible,.sv-file-input:focus-visible{outline:2px solid var(--sv-teal);outline-offset:2px}
.sv-current-context{display:flex;align-items:center;gap:9px;min-height:36px;padding:5px 23px;border-block:1px solid #e4ded2;background:#f1efe6;color:#52645b;overflow-wrap:anywhere}.sv-current-context b{color:#314842}.sv-current-dot{width:8px;height:8px;flex:none;border:2px solid #478176;border-radius:50%;box-shadow:0 0 0 3px #dce7dd}.sv-current-band{margin-left:auto;color:#374f48;font:650 11px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.sv-warning,.sv-error,.sv-notice{margin:12px 20px;padding:10px 12px;border-left:3px solid #ae6647;background:#f2e9df;color:#604439;font-size:12px}.sv-warning strong{display:block;margin-bottom:2px}.sv-error{border-color:#a33d2d;background:#f5e6df;color:#71392d}.sv-notice{border-color:#498071;background:#e9f0e7;color:#35574d}
.sv-stored{padding:18px 20px 4px}.sv-section-heading{display:flex;align-items:end;justify-content:space-between;gap:10px}.sv-section-heading h3{margin:3px 0 0;font:600 17px/1.15 Georgia,"Times New Roman",serif;overflow-wrap:anywhere}.sv-row-count{padding:4px 8px;border:1px solid #c8d3c6;border-radius:99px;background:#edf1e8;color:#496158;font-size:10px;white-space:nowrap}.sv-notes{margin:9px 0;color:#57665e;overflow-wrap:anywhere}.sv-context-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px;margin:14px 0 18px;padding:10px 0;border-block:1px solid var(--sv-line)}.sv-context-grid div{min-width:0;padding:5px 0}.sv-context-grid dt{margin-bottom:2px;color:#68756b;font-size:10px;font-weight:650}.sv-context-grid dd{margin:0;color:#334943;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.sv-context-grid dd span{color:#728076}
.sv-comparison{border-top:1px solid #dcd6c9;padding-top:15px}.sv-comparison-heading{margin-bottom:11px}.sv-definition{padding:5px 7px;border-radius:4px;background:#e6ece4;color:#39574e;font-size:10px;white-space:nowrap}.sv-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #ddd8cb;border-radius:6px;overflow:hidden;background:#fffdf8}.sv-metrics>div{display:grid;min-width:0;gap:3px;padding:10px;border-right:1px solid #e7e1d5}.sv-metrics>div:last-child{border:0}.sv-metrics span{color:#66746b;font-size:10px}.sv-metrics strong{color:#28463f;font:650 15px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.sv-metrics small{color:#778178;font-size:9px;line-height:1.3}.sv-assumptions{margin:8px 0 12px;color:#647268;font-size:10px;overflow-wrap:anywhere}.sv-map-and-legend{display:grid;grid-template-columns:minmax(100px,170px) 1fr;align-items:center;gap:15px;margin-bottom:12px;padding:10px;border:1px solid #e1dccf;border-radius:6px;background:#f5f2e9}.sv-plot{min-width:0;margin:0}.sv-plot svg{display:block;width:100%;max-height:145px;aspect-ratio:1;border:1px solid #d5d0c3;border-radius:4px;background:#fbf9f3}.sv-floor-shape{fill:#e6e9df;stroke:#84968a;stroke-width:1.2;stroke-linejoin:round}.sv-marker circle{stroke:#fbf9f3;stroke-width:.9}.sv-marker-positive circle{fill:#b15d3e}.sv-marker-negative circle{fill:#247276}.sv-marker-excluded circle{fill:#90938a}.sv-plot figcaption{margin-top:4px;color:#70796f;font-size:9px}.sv-legend{display:grid;gap:6px;color:#4f625a;font-size:10px}.sv-legend>b{color:#334b44;font-size:11px}.sv-legend>span{display:flex;align-items:center;gap:7px}.sv-key{width:9px;height:9px;flex:none;border-radius:50%}.sv-key-positive{background:#b15d3e}.sv-key-negative{background:#247276}.sv-key-excluded{background:#90938a}.sv-legend small{margin-top:2px;color:#788077;line-height:1.35}
.sv-table-scroll{max-height:320px;overflow:auto;border:1px solid #ddd8cb;border-radius:5px;background:#fffdf8;overscroll-behavior:contain;scrollbar-color:#b8c5bc transparent;scrollbar-width:thin}.sv-table-scroll:focus-visible{outline:2px solid var(--sv-teal);outline-offset:2px}.sv-table{width:100%;min-width:650px;border-collapse:collapse;text-align:left;font-size:11px}.sv-table th,.sv-table td{padding:8px 9px;border-bottom:1px solid #ece7dc;vertical-align:top}.sv-table thead{position:sticky;top:0;z-index:1;background:#f0eee5;color:#596b62;font-size:9px;letter-spacing:.05em;text-transform:uppercase}.sv-table tbody th{min-width:120px;color:#334a43;font-weight:650}.sv-table tbody td{white-space:nowrap;color:#465950}.sv-table tbody th small{display:block;max-width:180px;margin-top:3px;color:#9a563c;font-size:9px;font-weight:500;white-space:normal}.sv-table tbody tr:last-child>*{border-bottom:0}.sv-observation-label{overflow-wrap:anywhere}.sv-row-excluded{background:#f4f0e9}.sv-measured{color:#2d645f!important;font-weight:700}.sv-residual{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:650}.sv-truncation{margin:6px 0;color:#7b6f60;font-size:10px}.sv-method-note{margin:10px 0 14px;color:#6b756b;font-size:10px;line-height:1.45}.sv-incompatible,.sv-waiting{margin:15px 0;padding:11px 12px;border:1px solid #d7c8b9;border-radius:5px;background:#f3ebe2;color:#5f473b;font-size:11px}.sv-incompatible ul{margin:8px 0;padding-left:18px}.sv-incompatible li{margin:3px 0}.sv-incompatible p{margin:7px 0 0}.sv-waiting{border-color:#d9ddcf;background:#f0f0e8;color:#607066}
.sv-actions{display:flex;flex-wrap:wrap;gap:7px}.sv-stored-actions{padding:12px 0;border-top:1px solid #ded8cc}.sv-button{min-height:34px;padding:7px 11px;border:1px solid #c9d3c8;border-radius:5px;background:#f5f6ee;color:#34564d;font:650 11px/1.2 ui-sans-serif,system-ui,sans-serif;cursor:pointer}.sv-button:hover:not(:disabled){background:#e8eee5}.sv-button:disabled{opacity:.52;cursor:not-allowed}.sv-button-primary{border-color:#226c6b;background:#286f70;color:white}.sv-button-primary:hover:not(:disabled){background:#1c5d60}.sv-button-danger{margin-left:auto;border-color:#d9c2b6;background:#f7eee8;color:#874d3b}.sv-button-danger:hover:not(:disabled){background:#f0e0d6}
.sv-import{margin:0 20px 18px;border:1px solid #ddd7ca;border-radius:6px;background:#f7f5ed}.sv-import>summary{display:grid;gap:3px;padding:11px 12px;cursor:pointer;list-style:none}.sv-import>summary::-webkit-details-marker,.sv-headers-help summary::-webkit-details-marker{display:none}.sv-import>summary::after{content:"＋";grid-column:2;grid-row:1/3;align-self:center;color:#a05c40;font-size:16px}.sv-import[open]>summary::after{content:"−"}.sv-import>summary b{color:#334a43;font-size:12px}.sv-import>summary:focus-visible,.sv-headers-help summary:focus-visible{outline:2px solid var(--sv-teal);outline-offset:2px;border-radius:4px}.sv-import-body{padding:0 12px 12px}.sv-import-note{margin:2px 0 10px;color:#637168;font-size:10px;line-height:1.45}.sv-field-label{display:block;margin:9px 0 4px;color:#43574e;font-size:11px;font-weight:650}.sv-field-label span{color:#52645b;font-weight:450}.sv-input{display:block;width:100%;min-height:36px;box-sizing:border-box;padding:8px 9px;border:1px solid #d5d0c4;border-radius:4px;background:#fffdf8;color:#293d38;font:12px/1.4 ui-sans-serif,system-ui,sans-serif}.sv-input:focus{outline:2px solid #43827c;outline-offset:1px}.sv-notes-input{resize:vertical}.sv-csv-input{min-height:120px;resize:vertical;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}.sv-headers-help{margin:7px 0;color:#53675d;font-size:10px}.sv-headers-help summary{width:fit-content;cursor:pointer;text-decoration:underline;text-underline-offset:2px}.sv-headers-help p{margin:6px 0;padding:7px;border-radius:4px;background:#ebece3;color:#526359;overflow-wrap:anywhere;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.sv-import-actions{display:flex;justify-content:end;flex-wrap:wrap;gap:7px;margin-top:10px}.sv-file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}
@media(max-width:520px){.sv-header{padding:17px 15px 13px}.sv-header h2{font-size:20px}.sv-current-context{padding-inline:15px}.sv-stored{padding:15px 13px 3px}.sv-context-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 9px}.sv-context-grid dd{font-size:10px}.sv-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sv-metrics>div:nth-child(2){border-right:0}.sv-metrics>div:nth-child(-n+2){border-bottom:1px solid #e7e1d5}.sv-map-and-legend{grid-template-columns:minmax(80px,120px) 1fr;gap:9px;padding:7px}.sv-legend{font-size:9px}.sv-legend>b{font-size:10px}.sv-table-scroll{margin-inline:-2px}.sv-stored-actions{gap:6px}.sv-button{padding-inline:8px;font-size:10px}.sv-button-danger{margin-left:0}.sv-import{margin-inline:13px}.sv-import-actions{justify-content:stretch}.sv-import-actions .sv-button{flex:1}}
@media(max-width:340px){.sv-map-and-legend{grid-template-columns:1fr}.sv-plot{width:110px}.sv-current-band{font-size:10px}.sv-current-context{gap:7px;font-size:11px}}
.sv-empty-actions{padding:14px 20px}.sv-metrics small,.sv-plot figcaption,.sv-legend small,.sv-method-note,.sv-import-note,.sv-context-grid dt,.sv-context-grid dd span{color:#52645b}.sv-assumptions,.sv-method-note,.sv-import-note{font-size:12px}
</style>
