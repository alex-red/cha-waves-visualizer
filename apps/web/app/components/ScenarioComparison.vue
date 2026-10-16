<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { evaluatePoint, type FieldResult, type PointResult, type Scene, type SolverSettings } from '../../../../packages/engine'
import { compareCompatibility, describeChanges } from '../../../../packages/comparison'
import { FIELD_PAPER_HEX, FIELD_SCALES, fieldCssColor } from '../../../../packages/field-display'

type Snapshot = { scene: Scene; settings: SolverSettings; field: FieldResult }
const props = defineProps<{ baseline: Snapshot; current: Snapshot; probePosition: [number, number, number] }>()

const leftCanvas = ref<HTMLCanvasElement | null>(null)
const rightCanvas = ref<HTMLCanvasElement | null>(null)
const mobileSide = ref<'A' | 'B'>('A')
const probeA = computed<PointResult>(() => evaluatePoint(props.baseline.scene, props.baseline.settings, props.probePosition))
const probeB = computed<PointResult>(() => evaluatePoint(props.current.scene, props.current.settings, props.probePosition))
const displayMode = computed(() => props.current.field.unit === 'dBm' ? 'wifi' : 'sound')
const quantityLabel = computed(() => FIELD_SCALES[displayMode.value].quantity)
const range = computed<[number, number]>(() => {
  const scale = FIELD_SCALES[displayMode.value]
  return [scale.min, scale.max]
})
const compatibility = computed(() => compareCompatibility(props.baseline, props.current))
const changes = computed(() => describeChanges(props.baseline.scene, props.current.scene, props.baseline.settings, props.current.settings))
const changeLabels = computed(() => [
  ...changes.value.objects.map(change => `${change.kind} ${change.id} ${change.action}`),
  ...changes.value.settings.map(change => `${change.key}: ${String(change.before)} → ${String(change.after)}`),
])

function paint(canvas: HTMLCanvasElement | null, snapshot: Snapshot, label: 'A' | 'B') {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  const width = rect.width, height = rect.height, field = snapshot.field, grid = field.grid
  ctx.fillStyle = FIELD_PAPER_HEX; ctx.fillRect(0, 0, width, height)
  const level = snapshot.scene.levels.find(item => item.id === grid.levelId) ?? snapshot.scene.levels[0]
  if (!level) return
  const xs = level.boundary.map(point => point[0]), ys = level.boundary.map(point => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = 30, scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY))
  const offsetX = (width - (maxX - minX) * scale) / 2, offsetY = (height - (maxY - minY) * scale) / 2
  const sx = (x: number) => offsetX + (x - minX) * scale
  const sy = (y: number) => height - (offsetY + (y - minY) * scale)

  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
    const index = row * grid.cols + col
    if (field.validity[index] !== 1) continue
    ctx.fillStyle = fieldCssColor(field.values[index]!, displayMode.value)
    const x = grid.originXY[0] + col * grid.cellSizeM, y = grid.originXY[1] + row * grid.cellSizeM
    ctx.fillRect(sx(x), sy(y + grid.cellSizeM), Math.max(0, scale * grid.cellSizeM + .35), Math.max(0, scale * grid.cellSizeM + .35))
  }
  ctx.strokeStyle = '#263535'; ctx.lineWidth = 3
  ctx.beginPath(); level.boundary.forEach((point, index) => index ? ctx.lineTo(sx(point[0]), sy(point[1])) : ctx.moveTo(sx(point[0]), sy(point[1]))); ctx.closePath(); ctx.stroke()
  for (const wall of snapshot.scene.walls) {
    const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1]
    const cutouts = snapshot.scene.openings.filter(opening => opening.wallId === wall.id && (opening.kind === 'passage' || opening.kind === 'door'))
      .map(opening => ({ opening, from: opening.fromT, to: opening.toT })).sort((a, b) => a.from - b.from)
    const gaps = cutouts
    const segments: Array<[number, number]> = []
    let cursor = 0
    for (const gap of gaps) { if (gap.from > cursor) segments.push([cursor, gap.from]); cursor = Math.max(cursor, gap.to) }
    if (cursor < 1) segments.push([cursor, 1])
    ctx.lineCap = 'square'; ctx.lineWidth = Math.max(4, wall.thicknessM * scale); ctx.strokeStyle = '#b9aa95'
    ctx.beginPath()
    for (const [from, to] of segments) {
      ctx.moveTo(sx(wall.start[0] + dx * from), sy(wall.start[1] + dy * from))
      ctx.lineTo(sx(wall.start[0] + dx * to), sy(wall.start[1] + dy * to))
    }
    ctx.stroke()
    ctx.lineWidth = 1; ctx.strokeStyle = '#6f716a'; ctx.stroke()
    for (const { opening } of cutouts) {
      if (opening.kind !== 'door') continue
      const ax = wall.start[0] + dx * opening.fromT, ay = wall.start[1] + dy * opening.fromT
      const bx = wall.start[0] + dx * opening.toT, by = wall.start[1] + dy * opening.toT
      ctx.lineCap = 'square'; ctx.lineWidth = 2; ctx.strokeStyle = '#a47650'
      ctx.beginPath()
      if (opening.isOpen) {
        const hingeX = sx(ax), hingeY = sy(ay), leaf = Math.min(18, Math.max(7, scale * Math.hypot(bx - ax, by - ay)))
        const length = Math.hypot(dx, dy) || 1, sign = dx * (by - ay) - dy * (bx - ax) >= 0 ? 1 : -1
        ctx.moveTo(hingeX, hingeY); ctx.lineTo(hingeX - (dy / length) * leaf * sign, hingeY - (dx / length) * leaf * sign)
      } else {
        ctx.moveTo(sx(ax), sy(ay)); ctx.lineTo(sx(bx), sy(by))
      }
      ctx.stroke()
    }
  }
  for (const source of snapshot.scene.emitters.filter(item => item.active && item.domain === snapshot.settings.mode)) {
    ctx.beginPath(); ctx.arc(sx(source.position[0]), sy(source.position[1]), 4, 0, Math.PI * 2); ctx.fillStyle = '#a84e29'; ctx.fill()
  }
  const px = props.probePosition[0], py = props.probePosition[1]
  ctx.beginPath(); ctx.arc(sx(px), sy(py), 5, 0, Math.PI * 2); ctx.fillStyle = '#fffdf8'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#176d70'; ctx.stroke()
  ctx.fillStyle = '#33413e'; ctx.font = '600 11px ui-sans-serif, system-ui'; ctx.fillText(label, 10, 17)
}

function draw() { paint(leftCanvas.value, props.baseline, 'A'); paint(rightCanvas.value, props.current, 'B') }
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  resizeObserver = new ResizeObserver(draw)
  if (leftCanvas.value) resizeObserver.observe(leftCanvas.value)
  if (rightCanvas.value) resizeObserver.observe(rightCanvas.value)
  draw()
})
onBeforeUnmount(() => resizeObserver?.disconnect())
watch(() => [props.baseline.scene, props.baseline.settings, props.baseline.field, props.current.scene, props.current.settings, props.current.field, ...props.probePosition], draw, { flush: 'post' })
watch(mobileSide, async () => { await nextTick(); draw() }, { flush: 'post' })

function shown(result: PointResult): string { return result.valid && result.value !== undefined ? `${result.value.toFixed(1)} ${result.unit}` : 'Unavailable' }
const delta = computed(() => probeA.value.valid && probeB.value.valid && probeA.value.unit === probeB.value.unit
  ? `${(probeB.value.value! - probeA.value.value!).toFixed(1)} dB` : 'Unavailable')
</script>

<template>
  <section class="scenario-comparison" aria-label="Baseline and current scenario comparison" data-testid="comparison-panel" :data-compatible="compatibility.compatible">
    <div class="comparison-heading">
      <div><span class="eyebrow">SCENARIO COMPARISON</span><h2>{{ quantityLabel }} · {{ current.field.unit }}</h2></div>
      <div class="range-note" data-testid="comparison-shared-scale">Shared absolute scale {{ range[0] }} to {{ range[1] }} {{ current.field.unit }}</div>
    </div>
    <div v-if="!compatibility.compatible" class="incompatible" data-testid="comparison-incompatible">
      <strong>Fields cannot be compared yet.</strong>
      <span v-for="reason in compatibility.reasons" :key="reason">{{ reason }}</span>
    </div>
    <template v-else>
      <div class="mobile-switch" role="group" aria-label="Scenario map">
        <button data-testid="baseline-mobile-tab" :aria-pressed="mobileSide === 'A'" :class="{ active: mobileSide === 'A' }" @click="mobileSide = 'A'">A · Baseline</button>
        <button data-testid="current-mobile-tab" :aria-pressed="mobileSide === 'B'" :class="{ active: mobileSide === 'B' }" @click="mobileSide = 'B'">B · Current</button>
      </div>
      <div class="maps">
        <figure :class="{ 'mobile-hidden': mobileSide !== 'A' }"><figcaption><strong>A</strong> Baseline</figcaption><canvas ref="leftCanvas" data-testid="comparison-baseline-canvas" aria-label="Baseline field map" /></figure>
        <figure :class="{ 'mobile-hidden': mobileSide !== 'B' }"><figcaption><strong>B</strong> Current</figcaption><canvas ref="rightCanvas" data-testid="comparison-current-canvas" aria-label="Current field map" /></figure>
      </div>
      <div class="change-list" data-testid="comparison-changes"><span>Changes</span><template v-if="changeLabels.length"><b v-for="item in changeLabels" :key="item">{{ item }}</b></template><b v-else>No physical object or setting changes</b></div>
      <div class="probe-readout">
        <div><span>Probe at {{ probePosition.map(value => value.toFixed(1)).join(', ') }} m</span><strong data-testid="comparison-probe-a">A {{ shown(probeA) }}</strong></div>
        <div><span>Same coordinate</span><strong data-testid="comparison-probe-b">B {{ shown(probeB) }}</strong></div>
        <div class="probe-delta"><span>Change · B − A (dB)</span><strong data-testid="comparison-probe-delta">{{ delta }}</strong></div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.scenario-comparison{background:#f8f5ee;border:1px solid #ded8cd;border-radius:6px;padding:14px;color:#263735}.comparison-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.eyebrow{font-size:9px;letter-spacing:1.2px;color:#77817a;font-weight:700}.comparison-heading h2{font:400 18px Georgia,serif;margin:4px 0 0}.range-note{font:10px ui-monospace,monospace;color:#76817a}.incompatible{display:grid;gap:6px;padding:13px;background:#fff1e5;border:1px solid #dfb597;border-radius:4px;color:#814022;font-size:10px}.incompatible strong{font-size:11px}.maps{display:grid;grid-template-columns:1fr 1fr;gap:10px}.maps figure{min-width:0;margin:0;border:1px solid #ddd7cc;background:#eee9df;border-radius:4px;overflow:hidden}.maps figcaption{height:30px;background:#faf8f2;padding:8px 10px;font-size:10px;color:#64716a}.maps figcaption strong{display:inline-grid;place-items:center;width:15px;height:15px;margin-right:5px;border-radius:50%;background:#dce8e2;color:#315b57}.maps canvas{display:block;width:100%;height:220px}.change-list{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:9px;color:#77817a;font-size:9px}.change-list b{padding:4px 6px;background:#f0ece3;border-radius:3px;color:#54645e;font-weight:500}.probe-readout{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}.probe-readout>div{display:grid;gap:5px;padding:9px;background:#f0ece3;border-radius:4px}.probe-readout span{font-size:9px;color:#78837b}.probe-readout strong{font:11px ui-monospace,monospace;color:#30413d}.probe-delta strong{color:#176d70}.mobile-switch{display:none}
@media(max-width:600px){.comparison-heading{align-items:flex-start;flex-direction:column}.maps{grid-template-columns:1fr}.maps figure.mobile-hidden{display:none}.maps canvas{height:250px}.mobile-switch{display:grid;grid-template-columns:1fr 1fr;padding:3px;background:#ebe7dd;border-radius:5px;margin-bottom:9px}.mobile-switch button{height:30px;border:0;border-radius:4px;background:transparent;color:#66716b;font-size:10px}.mobile-switch button.active{background:#fffdf8;color:#203434;box-shadow:0 1px 3px #2738321c}.probe-readout{grid-template-columns:1fr 1fr}.probe-delta{grid-column:1/-1}}
</style>
