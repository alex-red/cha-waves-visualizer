<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FieldResult, Scene, SolverSettings } from '../../../../packages/engine'
import { summarizeRfCoverage } from '../../../../packages/coverage'
import type { PlacementCandidate, PlacementObjective, PlacementOptions, PlacementResult } from '../../../../packages/placement'
import { createPlanTransform, type PlanPoint } from '../lib/plan-viewport'

const props = defineProps<{
  scene: Scene
  settings: SolverSettings
  field: FieldResult | null
  running: boolean
  progress: { done: number; total: number }
  result: PlacementResult | null
  error: string
  notice?: string
  disabled: boolean
}>()

const emit = defineEmits<{
  configure: [options: PlacementOptions]
  run: []
  cancel: []
  apply: [candidate: PlacementCandidate]
  close: []
}>()

const selectedProbeIds = ref<string[]>([])
const objective = ref<PlacementObjective>(props.settings.mode === 'radio' ? 'maximize-weakest' : 'minimize-loudest')
const objectiveTouched = ref(false)
const maxCandidates = ref(144)
const threshold = ref(-67)

const activeSource = computed(() => props.scene.emitters.find(item => item.active && item.domain === props.settings.mode))
const availableProbes = computed(() => props.scene.probes.filter(probe => probe.levelId === activeSource.value?.levelId).slice(0, 64))
const canRun = computed(() => !props.disabled && !props.running && !!activeSource.value && selectedProbeIds.value.length > 0)
const coverage = computed(() => {
  if (props.settings.mode !== 'radio' || !props.field || !Number.isFinite(threshold.value)) return null
  try { return summarizeRfCoverage(props.field, threshold.value) } catch { return null }
})
const coverageThresholdValid = computed(() => Number.isFinite(threshold.value))
const coverageUnavailable = computed(() => props.settings.mode === 'radio' && !coverage.value && coverageThresholdValid.value)
const progressLabel = computed(() => props.progress.total > 0
  ? `Checking placement ${Math.min(props.progress.done, props.progress.total)} of ${props.progress.total}`
  : 'Preparing placement search')
const result = computed(() => props.result)
const currentPosition = computed(() => activeSource.value?.position)
const plan = computed(() => {
  const boundary = props.scene.levels.find(level => level.id === activeSource.value?.levelId)?.boundary
  if (!boundary?.length) return null
  const xs = boundary.map(point => point[0]), ys = boundary.map(point => point[1])
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return null
  return { boundary, transform: createPlanTransform(bounds, 600, 280, { zoom: 1, center: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2] }) }
})
function screen(point: PlanPoint): string {
  const projected = plan.value?.transform.worldToScreen(point)
  return projected ? `${projected[0]},${projected[1]}` : '0,0'
}
function screenX(point: PlanPoint): number { return plan.value?.transform.worldToScreen(point)[0] ?? 0 }
function screenY(point: PlanPoint): number { return plan.value?.transform.worldToScreen(point)[1] ?? 0 }
const selectedProbes = computed(() => props.scene.probes.filter(probe => selectedProbeIds.value.includes(probe.id)))

watch(() => availableProbes.value.map(probe => probe.id), (ids, previous = []) => {
  const previousSet = new Set(previous)
  const selectedSet = new Set(selectedProbeIds.value)
  const next = ids.filter(id => selectedSet.has(id) || !previousSet.has(id))
  selectedProbeIds.value = next
}, { immediate: true })

watch(() => props.settings.mode, mode => {
  if (!objectiveTouched.value) objective.value = mode === 'radio' ? 'maximize-weakest' : 'minimize-loudest'
}, { immediate: true })

watch([selectedProbeIds, objective, maxCandidates], () => {
  emit('configure', {
    probeIds: [...selectedProbeIds.value],
    objective: objective.value,
    maxCandidates: maxCandidates.value,
  })
}, { deep: true, immediate: true })

function samePosition(position: [number, number, number]): boolean {
  return !!currentPosition.value && position.every((value, index) => value === currentPosition.value![index])
}
function display(value: number, digits = 2): string { return Number(value.toFixed(digits)).toString() }
function formatReading(value: number | undefined, unit: string): string {
  return value === undefined ? 'Unavailable' : `${display(value, 1)} ${unit}`
}
function reasonText(reason?: string): string {
  const labels: Record<string, string> = {
    'outside-floor': 'Outside the floor boundary',
    'inside-solid': 'Inside a solid wall or object',
    'below-model-distance': 'Too close for this model',
    'missing-parameter': 'A required material value is missing',
    'unsupported-geometry': 'The model cannot estimate this geometry',
  }
  return reason ? labels[reason] ?? reason : 'No valid estimate was produced.'
}
function improvement(candidateScore: number): number | null {
  const baselineScore = result.value?.baseline.score
  if (baselineScore == null || !Number.isFinite(baselineScore)) return null
  return objective.value === 'maximize-weakest' ? candidateScore - baselineScore : baselineScore - candidateScore
}
function improvementLabel(candidateScore: number): string {
  const delta = improvement(candidateScore)
  if (delta === null) return 'Baseline unavailable'
  return `${delta >= 0 ? '+' : ''}${display(delta, 1)} dB ${delta >= 0 ? 'better' : 'worse'}`
}
function coverageReasonName(reason: string): string {
  const names: Record<string, string> = {
    outsideFloor: 'outside floor', insideSolid: 'inside solid', belowModelDistance: 'too close to source',
    missingParameter: 'missing material data', unsupportedGeometry: 'unsupported geometry',
  }
  return names[reason] ?? reason
}
</script>

<template>
  <section class="placement-explorer" aria-labelledby="placement-title" data-testid="placement-explorer">
    <header class="panel-head">
      <div>
        <div class="eyebrow">SOURCE POSITION STUDY <span class="eyebrow-rule" /></div>
        <h2 id="placement-title">Placement explorer</h2>
        <p class="panel-deck">Compare sampled source positions against the selected probes.</p>
      </div>
      <button class="close-button" type="button" aria-label="Close placement explorer" @click="emit('close')">×</button>
    </header>

    <div class="context-strip">
      <span class="context-mark" aria-hidden="true">◉</span>
      <span>{{ settings.mode === 'acoustics' ? 'Acoustic' : 'Radio' }} source</span>
      <span class="divider" aria-hidden="true" />
      <span>{{ activeSource ? `Level ${activeSource.levelId}` : 'No active source in this mode' }}</span>
      <span class="spacer" />
      <span class="metadata">{{ settings.mode === 'acoustics' ? `${display(settings.frequencyHz)} Hz` : `${display(settings.frequencyHz / 1e9, 2)} GHz` }}</span>
    </div>

    <div class="explorer-body">
      <div class="control-column">
        <section class="control-section" aria-labelledby="objective-label">
          <label id="objective-label" class="field-label" for="placement-objective">Search goal</label>
          <select id="placement-objective" v-model="objective" data-testid="placement-objective" :disabled="disabled" @change="objectiveTouched = true">
            <option value="maximize-weakest">Improve weakest selected probe</option>
            <option value="minimize-loudest">Reduce loudest selected probe</option>
          </select>
          <p class="help-copy">Each candidate is ranked by the weakest or loudest selected reading.</p>
        </section>

        <section class="control-section">
          <label class="field-label" for="placement-budget">Positions to sample</label>
          <select id="placement-budget" v-model.number="maxCandidates" data-testid="placement-budget" :disabled="disabled">
            <option :value="64">64 positions · faster</option>
            <option :value="144">144 positions · balanced</option>
            <option :value="256">256 positions · finer</option>
          </select>
          <p class="help-copy">A regular grid covers the current source level.</p>
        </section>

        <fieldset class="placement-probes control-section">
          <legend class="field-label">Probes to include</legend>
          <p v-if="availableProbes.length === 0" class="help-copy">{{ activeSource ? 'Add probes on this level to compare their readings.' : 'Activate a source to choose probes on its level.' }}</p>
          <div v-if="availableProbes.length" class="probe-options">
            <label v-for="probe in availableProbes" :key="probe.id" class="probe-choice" :data-probe-id="probe.id" data-testid="placement-probe">
              <input v-model="selectedProbeIds" type="checkbox" :value="probe.id" :disabled="disabled || (!selectedProbeIds.includes(probe.id) && selectedProbeIds.length >= 64)">
              <span class="probe-marker" aria-hidden="true" />
              <span class="probe-copy"><strong>{{ probe.name || probe.id }}</strong><small>{{ probe.id }}</small></span>
            </label>
          </div>
        </fieldset>
        <p v-if="availableProbes.length" class="help-copy probe-cap-note">Choose up to 64 probes on the active source level.</p>

        <div class="action-row">
          <button v-if="running" class="secondary-button" type="button" data-testid="placement-cancel" @click="emit('cancel')">Cancel search</button>
          <button v-else class="primary-button" type="button" data-testid="placement-run" :disabled="!canRun" @click="emit('run')">Find positions <span aria-hidden="true">↗</span></button>
        </div>
        <p v-if="!activeSource" class="inline-note">Activate a {{ settings.mode === 'acoustics' ? 'sound' : 'radio' }} source in this mode to search.</p>
        <p v-else-if="availableProbes.length && !selectedProbeIds.length" class="inline-note">Select at least one probe to start a search.</p>
      </div>

      <div class="results-column">
        <div v-if="running" class="progress-card" role="status" aria-live="polite" data-testid="placement-progress">
          <span class="progress-glyph" aria-hidden="true">⌖</span>
          <div class="progress-copy"><strong>Sampling the floor</strong><span>{{ progressLabel }}</span></div>
          <progress :value="progress.total ? progress.done : undefined" :max="progress.total || undefined">{{ progress.done }} of {{ progress.total }}</progress>
        </div>
        <div v-if="error" class="error-card" role="alert"><span aria-hidden="true">!</span>{{ error }}</div>
        <div v-if="notice" class="notice-card" role="status">{{ notice }}</div>

        <template v-if="result">
          <section class="baseline-card" aria-label="Current source baseline">
            <div class="card-kicker">CURRENT POSITION <span>BASELINE</span></div>
            <div class="baseline-main">
              <div><strong class="metric">{{ result.baseline.score === null ? 'Unavailable' : `${display(result.baseline.score, 1)} ${result.unit}` }}</strong><span class="metric-caption">{{ objective === 'maximize-weakest' ? 'Weakest probe' : 'Loudest probe' }}</span></div>
              <div class="position-chip">X {{ display(result.baseline.position[0]) }} · Y {{ display(result.baseline.position[1]) }} · Z {{ display(result.baseline.position[2]) }} m</div>
            </div>
            <div v-if="result.baseline.score === null" class="baseline-reasons">
              <span v-for="reading in result.baseline.readings.filter(item => !item.valid)" :key="reading.id">{{ reading.name }}: {{ reasonText(reading.reason) }}</span>
            </div>
          </section>

          <div class="search-meta" aria-label="Search summary">
            <span><b>{{ result.validCount }}</b> of {{ result.sampledCount }} valid positions</span>
            <span>{{ result.excludedPlacementCount }} excluded by placement</span>
            <span>{{ result.excludedEstimateCount }} excluded by estimates</span>
            <span>Grid {{ display(result.spacingM[0]) }} × {{ display(result.spacingM[1]) }} m</span>
          </div>

          <figure v-if="plan" class="plan-preview">
            <svg viewBox="0 0 600 280" role="img" :aria-label="`Plan preview: ${scene.walls.length} walls, ${selectedProbes.length} selected probes, current source, and ${result.candidates.length} ranked candidate positions`" preserveAspectRatio="xMidYMid meet">
              <polygon :points="plan.boundary.map(point => screen(point)).join(' ')" class="plan-boundary" />
              <line v-for="wall in scene.walls" :key="wall.id" :x1="screenX(wall.start)" :y1="screenY(wall.start)" :x2="screenX(wall.end)" :y2="screenY(wall.end)" class="plan-wall" />
              <g v-for="probe in selectedProbes" :key="probe.id" class="plan-probe">
                <circle :cx="screenX([probe.position[0], probe.position[1]])" :cy="screenY([probe.position[0], probe.position[1]])" r="7" />
                <circle :cx="screenX([probe.position[0], probe.position[1]])" :cy="screenY([probe.position[0], probe.position[1]])" r="2" class="probe-core" />
              </g>
              <g v-if="currentPosition" class="plan-source">
                <circle :cx="screenX([currentPosition[0], currentPosition[1]])" :cy="screenY([currentPosition[0], currentPosition[1]])" r="9" />
                <path :d="`M ${screenX([currentPosition[0], currentPosition[1]]) - 5} ${screenY([currentPosition[0], currentPosition[1]])} H ${screenX([currentPosition[0], currentPosition[1]]) + 5} M ${screenX([currentPosition[0], currentPosition[1]])} ${screenY([currentPosition[0], currentPosition[1]]) - 5} V ${screenY([currentPosition[0], currentPosition[1]]) + 5}`" />
              </g>
              <g v-for="(candidate, index) in result.candidates" :key="candidate.position.join(':')" class="plan-candidate">
                <circle :cx="screenX([candidate.position[0], candidate.position[1]])" :cy="screenY([candidate.position[0], candidate.position[1]])" r="11" />
                <text :x="screenX([candidate.position[0], candidate.position[1]])" :y="screenY([candidate.position[0], candidate.position[1]])">{{ index + 1 }}</text>
              </g>
            </svg>
            <figcaption><span><i class="legend-source" />Current source</span><span><i class="legend-probe" />Selected probe</span><span><i class="legend-candidate">1</i>Ranked candidate</span><span>Plan preview · position height is fixed</span></figcaption>
          </figure>

          <section v-if="result.candidates.length" class="candidate-section" aria-labelledby="candidate-heading">
            <div class="candidate-heading-row"><h3 id="candidate-heading">Best sampled positions</h3><span>Top {{ result.candidates.length }}</span></div>
            <article v-for="(candidate, index) in result.candidates" :key="`${candidate.position.join(':')}`" class="candidate-card" data-testid="placement-candidate" :data-x="candidate.position[0]" :data-y="candidate.position[1]" :data-z="candidate.position[2]" :data-score="candidate.score">
              <div class="candidate-topline">
                <span class="rank">{{ String(index + 1).padStart(2, '0') }}</span>
                <div class="candidate-metric"><strong>{{ display(candidate.score, 1) }} {{ result.unit }}</strong><span>{{ objective === 'maximize-weakest' ? 'Weakest' : 'Loudest' }} · {{ improvementLabel(candidate.score) }}</span></div>
                <button class="apply-button" type="button" data-testid="placement-apply" :disabled="running || disabled || samePosition(candidate.position)" @click="emit('apply', candidate)">{{ samePosition(candidate.position) ? 'Current position' : 'Apply position' }}</button>
              </div>
              <div class="candidate-details">
                <span class="candidate-position">X {{ display(candidate.position[0]) }} · Y {{ display(candidate.position[1]) }} · Z {{ display(candidate.position[2]) }} m</span>
                <span>{{ display(candidate.distanceM) }} m movement</span>
                <span>Range {{ display(candidate.weakest, 1) }}–{{ display(candidate.loudest, 1) }} {{ result.unit }}</span>
              </div>
              <div class="tradeoff-list" aria-label="Probe readings at this position">
                <div v-for="reading in candidate.readings" :key="reading.id" class="tradeoff-row">
                  <span>{{ reading.name }}</span>
                  <span class="tradeoff-baseline">{{ formatReading(result.baseline.readings.find(item => item.id === reading.id)?.value, result.unit) }}</span>
                  <span class="tradeoff-arrow" aria-hidden="true">→</span>
                  <span :class="{ unavailable: !reading.valid }">{{ reading.valid ? formatReading(reading.value, result.unit) : reasonText(reading.reason) }}</span>
                </div>
              </div>
            </article>
          </section>
          <div v-else class="empty-results"><span aria-hidden="true">⌖</span><strong>No valid sampled positions</strong><p>All {{ result.sampledCount }} sampled placements were excluded by geometry or incomplete probe estimates.</p></div>
          <p class="limit-note">Best positions are from this sampled grid. Source height stays fixed, and results use the current model and its limits.</p>
        </template>
        <div v-else-if="!running && !error" class="empty-results intro-state"><span aria-hidden="true">⌖</span><strong>Ready to explore</strong><p>Choose a goal and probes, then sample positions across the source level.</p></div>

        <section v-if="settings.mode === 'radio'" class="coverage-section" aria-labelledby="coverage-title">
          <div class="coverage-head"><div><div class="eyebrow">SAMPLED FIELD AREA</div><h3 id="coverage-title">RF coverage threshold</h3></div>
          <label class="threshold-control" for="coverage-threshold"><span>Coverage threshold</span><span class="threshold-input"><input id="coverage-threshold" v-model.number="threshold" type="number" step="1" data-testid="coverage-threshold" :disabled="disabled"> <b>dBm</b></span></label>
          </div>
          <div v-if="coverage" class="coverage-summary" data-testid="coverage-summary" :data-valid="coverage.validCount" :data-above="coverage.aboveCount" :data-excluded-count="coverage.excludedCount">
            <div class="coverage-primary"><strong>{{ coverage.percentOfValid === null ? 'Unavailable' : `${display(coverage.percentOfValid, 1)}%` }}</strong><span>of valid sampled area at or above threshold</span></div>
            <div class="area-stats"><span><b>{{ display(coverage.aboveAreaM2) }} m²</b> above</span><span><b>{{ display(coverage.validAreaM2) }} m²</b> valid</span><span><b>{{ display(coverage.excludedAreaM2) }} m²</b> excluded</span></div>
            <div class="mask-counts"><span>{{ coverage.validCount }} valid cells</span><span>{{ coverage.aboveCount }} above</span><span>{{ coverage.excludedCount }} excluded cells</span><span v-for="(count, reason) in coverage.excludedByReason" :key="reason">{{ count }} {{ coverageReasonName(reason) }}</span></div>
            <div class="grid-footnote">Grid estimate at {{ display(coverage.receiverZM) }} m receiver height · {{ display(coverage.cellSizeM) }} m cells</div>
          </div>
          <div v-else class="coverage-unavailable" data-testid="coverage-summary">{{ !coverageThresholdValid ? 'Enter a finite coverage threshold to calculate the summary.' : coverageUnavailable ? 'No current RF field is available for this scene and model.' : 'Coverage summary unavailable.' }}</div>
          <p class="coverage-note">Area is estimated from the current sampled grid at its receiver height. A custom threshold describes received power, not a throughput promise.</p>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.placement-explorer{--ink:#263735;--muted:#52645b;--line:#e5dfd3;--paper:#fbf9f3;--teal:#176d70;--clay:#9c543b;color:var(--ink);background:var(--paper);border:1px solid #ddd6c9;border-radius:8px;overflow:hidden;box-shadow:0 18px 55px #182c2817;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 24px 19px}.eyebrow{color:#52645b;font-size:10px;font-weight:800;letter-spacing:1.45px}.eyebrow-rule{display:inline-block;width:24px;height:1px;margin:0 0 3px 7px;background:#8fa9a0}h2{margin:7px 0 0;font:400 27px/1.1 Georgia,"Times New Roman",serif;letter-spacing:-.6px}.panel-deck{margin:6px 0 0;color:#52645b;font-size:12px}.close-button{display:grid;width:38px;height:38px;place-items:center;border:1px solid #d8d2c6;border-radius:4px;background:#fffdf8;color:#52645b;cursor:pointer;font:300 24px/1 Georgia,serif}.close-button:hover{background:#edf3ee;border-color:#9cb5aa}.context-strip{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 24px;background:#f1eee5;border-block:1px solid #e5dfd3;color:#40554e;font-size:12px}.context-mark{color:var(--teal)}.divider{width:1px;height:14px;background:#d6d2c8}.spacer{flex:1}.metadata{color:#52645b;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.explorer-body{display:grid;grid-template-columns:minmax(230px, .72fr) minmax(0, 1.65fr);gap:18px;padding:17px}.control-column{align-self:start;border:1px solid var(--line);border-radius:5px;background:#fffdf9;padding:15px}.control-section{margin:0 0 15px;padding:0;border:0}.field-label{display:block;margin-bottom:7px;color:#394c47;font-size:13px;font-weight:750}.control-column select{width:100%;min-height:40px;padding:8px 32px 8px 10px;border:1px solid #d6d3c7;border-radius:3px;background:#fbfaf4;color:#263735;font:13px ui-sans-serif,system-ui,sans-serif}.help-copy{margin:6px 0 0;color:#52645b;font-size:12px;line-height:1.45}.placement-probes{min-width:0}.placement-probes legend{float:none;width:auto;padding:0;margin-bottom:7px}.probe-options{max-height:230px;overflow:auto;overscroll-behavior:contain}.probe-choice{display:flex;align-items:flex-start;gap:9px;min-height:43px;padding:8px 3px;border-bottom:1px solid #efede5;cursor:pointer}.probe-choice input{width:17px;height:17px;margin:0;accent-color:#176d70}.probe-marker{width:9px;height:9px;border:2px solid #34817b;border-radius:50%;background:#fff}.probe-copy{display:flex;min-width:0;flex-direction:column;gap:2px}.probe-copy strong{overflow:visible;color:#394c47;font-size:13px;text-overflow:clip;white-space:normal;overflow-wrap:anywhere}.probe-copy small{overflow-wrap:anywhere;color:#52645b;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.action-row{display:flex;margin-top:6px}.primary-button,.secondary-button{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:44px;padding:9px 12px;border:1px solid #176d70;border-radius:4px;background:#176d70;color:white;cursor:pointer;font:700 13px ui-sans-serif,system-ui,sans-serif}.primary-button span{font-size:18px}.primary-button:disabled{border-color:#c5c9bf;background:#e8e8df;color:#707c72;cursor:not-allowed}.secondary-button{border-color:#c9856d;background:#fff8f2;color:#8f4e38}.inline-note{margin:8px 0 0;color:#9c543b;font-size:12px;line-height:1.4}
.results-column{min-width:0}.progress-card{display:grid;grid-template-columns:38px 1fr;gap:10px;align-items:center;margin-bottom:10px;padding:12px;border:1px solid #b5cdc1;border-radius:5px;background:#f0f5ee}.progress-glyph{display:grid;width:34px;height:34px;place-items:center;border:1px solid #b5cdc1;border-radius:50%;color:#176d70;font-size:21px}.progress-copy{display:flex;flex-direction:column;gap:3px}.progress-copy strong{font-size:13px}.progress-copy span{color:#52645b;font-size:12px}.progress-card progress{grid-column:1/-1;width:100%;height:7px;accent-color:#176d70}.error-card{display:flex;gap:9px;align-items:flex-start;margin-bottom:10px;padding:11px;border:1px solid #e2bba9;border-radius:4px;background:#fff5ed;color:#8f4e38;font-size:13px;line-height:1.45}.error-card>span{font-weight:800}.baseline-card{padding:13px 15px;border:1px solid #d9d2c4;border-radius:5px;background:#f4f0e7}.card-kicker{display:flex;align-items:center;justify-content:space-between;color:#52645b;font-size:10px;font-weight:800;letter-spacing:1px}.card-kicker span{padding:3px 6px;border:1px solid #d5d7c9;border-radius:2px;color:#557168;font-size:9px;letter-spacing:.7px}.baseline-main{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.baseline-main>div:first-child{display:flex;flex-direction:column;gap:3px}.metric{font:600 21px ui-monospace,SFMono-Regular,Menlo,monospace}.metric-caption{color:#52645b;font-size:12px}.position-chip{padding:7px 8px;border:1px solid #e2ddd1;border-radius:3px;background:#fffdf8;color:#52645b;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.baseline-reasons{display:grid;gap:4px;margin-top:10px;padding-top:8px;border-top:1px solid #e5dfd3;color:#9c543b;font-size:12px}.search-meta{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 15px}.search-meta span{padding:5px 7px;border:1px solid #e8e3d8;border-radius:3px;background:#fffdf8;color:#52645b;font-size:11px}.search-meta b{color:#334c45}.candidate-heading-row{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}.candidate-heading-row h3,.coverage-head h3{margin:0;font:400 19px Georgia,"Times New Roman",serif}.candidate-heading-row>span{color:#52645b;font-size:11px}.candidate-card{margin-bottom:9px;border:1px solid #e5dfd3;border-radius:5px;background:#fffdf9;overflow:hidden}.candidate-topline{display:flex;align-items:center;gap:10px;padding:10px 11px}.rank{display:grid;flex:none;width:29px;height:29px;place-items:center;border-radius:50%;background:#e8f0e9;color:#26716e;font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace}.candidate-metric{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}.candidate-metric strong{font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace}.candidate-metric span{color:#52645b;font-size:11px;white-space:normal;overflow-wrap:anywhere}.apply-button{flex:none;min-height:36px;padding:7px 10px;border:1px solid #9db8ad;border-radius:3px;background:#f1f6ef;color:#286965;cursor:pointer;font:700 12px ui-sans-serif,system-ui,sans-serif}.apply-button:hover:not(:disabled){background:#e2eee6}.apply-button:disabled{border-color:#e2ded4;background:#f2f0e9;color:#52645b;cursor:default}.candidate-details{display:flex;flex-wrap:wrap;gap:6px 13px;padding:0 11px 9px 50px;color:#52645b;font-size:11px}.candidate-position{color:#394c47;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.tradeoff-list{border-top:1px solid #efebe2}.tradeoff-row{display:grid;grid-template-columns:minmax(70px,1fr) minmax(76px,.75fr) 14px minmax(100px,1fr);gap:5px;align-items:center;min-height:31px;padding:4px 11px;color:#344942;font-size:12px}.tradeoff-row+.tradeoff-row{border-top:1px solid #f2efe9}.tradeoff-row>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.tradeoff-baseline{color:#52645b}.tradeoff-arrow{color:#8ca39a}.tradeoff-row .unavailable{color:#9c543b;font-size:11px}.limit-note{margin:9px 1px 15px;color:#52645b;font-size:12px;line-height:1.45}.empty-results{display:grid;justify-items:center;gap:7px;min-height:140px;align-content:center;padding:18px;border:1px dashed #d9d5c9;border-radius:5px;background:#f8f6ef;text-align:center}.empty-results>span{color:#43817a;font-size:25px}.empty-results strong{font:400 17px Georgia,"Times New Roman",serif}.empty-results p{max-width:360px;margin:0;color:#52645b;font-size:12px;line-height:1.5}.intro-state{min-height:170px}
.plan-preview{margin:0 0 14px;padding:8px;border:1px solid #e5dfd3;border-radius:5px;background:#f7f5ee}.plan-preview svg{display:block;width:100%;height:auto;max-height:260px;border-radius:3px;background-color:#fbfaf4;background-image:linear-gradient(#e9e7dd 1px,transparent 1px),linear-gradient(90deg,#e9e7dd 1px,transparent 1px);background-size:24px 24px}.plan-boundary{fill:#f2efe5;stroke:#9eaa9d;stroke-width:1.5;vector-effect:non-scaling-stroke}.plan-wall{stroke:#435a52;stroke-width:5;stroke-linecap:round;vector-effect:non-scaling-stroke}.plan-probe circle{fill:#fbfaf4;stroke:#14767d;stroke-width:2.5;vector-effect:non-scaling-stroke}.plan-probe .probe-core{fill:#14767d;stroke:none}.plan-source circle{fill:#fff4ec;stroke:#a75135;stroke-width:2.5;vector-effect:non-scaling-stroke}.plan-source path{fill:none;stroke:#a75135;stroke-width:2;stroke-linecap:round;vector-effect:non-scaling-stroke}.plan-candidate circle{fill:#176d70;stroke:#fffdf6;stroke-width:1.5;vector-effect:non-scaling-stroke}.plan-candidate text{fill:white;text-anchor:middle;dominant-baseline:central;font:700 10px ui-sans-serif,system-ui,sans-serif;pointer-events:none}.plan-preview figcaption{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:8px 3px 1px;color:#52645b;font-size:11px}.plan-preview figcaption span{display:inline-flex;align-items:center;gap:5px}.plan-preview figcaption span:last-child{margin-left:auto}.legend-source,.legend-probe{display:inline-block;width:10px;height:10px;border:2px solid #a75135;border-radius:50%}.legend-probe{border-color:#14767d;background:#fbfaf4}.legend-candidate{display:inline-grid;width:15px;height:15px;place-items:center;border-radius:50%;background:#176d70;color:white;font:700 9px ui-sans-serif,system-ui,sans-serif}
.coverage-section{margin-top:12px;padding:14px;border:1px solid #d9d2c4;border-radius:5px;background:#f4f1e8}.coverage-head{display:flex;justify-content:space-between;align-items:end;gap:14px}.coverage-head .eyebrow{margin-bottom:5px;font-size:9px}.coverage-head h3{font-size:18px}.threshold-control{display:flex;flex-direction:column;gap:5px;color:#52645b;font-size:11px;font-weight:700}.threshold-input{display:flex;align-items:center;border:1px solid #d6d3c7;border-radius:3px;background:#fffdf8}.threshold-input input{width:74px;min-height:35px;padding:5px 7px;border:0;background:transparent;color:#263735;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}.threshold-input b{padding-right:8px;color:#52645b;font-size:11px}.coverage-summary{margin-top:12px;padding:12px;border:1px solid #e4dfd4;border-radius:4px;background:#fffdf9}.coverage-primary{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.coverage-primary strong{color:#176d70;font:600 24px ui-monospace,SFMono-Regular,Menlo,monospace}.coverage-primary span{color:#52645b;font-size:12px}.area-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}.area-stats span{display:flex;flex-direction:column;gap:3px;padding:7px;border-radius:3px;background:#f5f2ea;color:#52645b;font-size:11px}.area-stats b{color:#394c47;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace}.mask-counts{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.mask-counts span{padding:3px 6px;border:1px solid #e8e3d8;border-radius:3px;color:#52645b;font-size:10px}.grid-footnote{margin-top:8px;color:#52645b;font-size:11px}.coverage-unavailable{margin-top:12px;padding:13px;border:1px dashed #d9d5c9;border-radius:4px;background:#fffdf9;color:#52645b;font-size:12px;line-height:1.45}.coverage-note{margin:8px 1px 0;color:#52645b;font-size:11px;line-height:1.4}
.probe-cap-note{margin:-9px 0 13px}.notice-card{margin-bottom:10px;padding:10px 12px;border:1px solid #b5cdc1;border-radius:4px;background:#f0f5ee;color:#405e53;font-size:12px;line-height:1.45}
button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #277d7c;outline-offset:2px}button:disabled{cursor:not-allowed}
@media(max-width:760px){.explorer-body{grid-template-columns:1fr;gap:12px;padding:12px}.control-column{padding:12px}.placement-probes{max-height:none}.panel-head{padding:18px 17px 15px}.context-strip{padding:0 17px}}
@media(max-width:420px){.panel-head{padding:15px 12px}.context-strip{flex-wrap:wrap;gap:7px;padding:8px 12px;font-size:11px}.spacer{display:none}.metadata{margin-left:auto}.explorer-body{padding:9px}.baseline-main{align-items:flex-start;flex-direction:column}.position-chip{max-width:100%;overflow-wrap:anywhere}.candidate-topline{gap:7px;padding:9px}.apply-button{padding:6px 7px;font-size:11px}.candidate-details{padding-left:44px}.tradeoff-row{grid-template-columns:minmax(55px,.8fr) minmax(68px,.7fr) 12px minmax(80px,1fr);font-size:11px}.coverage-head{align-items:flex-start;flex-direction:column}.threshold-control{width:100%}.threshold-input{width:max-content}.area-stats{grid-template-columns:1fr}.area-stats span{flex-direction:row;justify-content:space-between}}
.candidate-metric span{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere}
@media(max-width:420px){.candidate-topline{align-items:start}.candidate-metric{min-width:0}.candidate-metric span{line-height:1.35}.tradeoff-row{grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr);align-items:start}.tradeoff-row>span:first-child{grid-column:1/-1;overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere}.tradeoff-baseline{grid-column:1}.tradeoff-arrow{grid-column:2}.tradeoff-row>span:last-child{grid-column:3;overflow-wrap:anywhere}}
</style>
