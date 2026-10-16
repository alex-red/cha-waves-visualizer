<script setup lang="ts">
import { computed } from 'vue'
import type { DimensionMark } from '../lib/drafting'

const props = defineProps<{
  width: number
  height: number
  dimensions: DimensionMark[]
  snap?: { raw: [number, number]; point: [number, number]; kind: 'endpoint' | 'grid' } | null
}>()

const overlayWidth = computed(() => Number.isFinite(props.width) ? Math.max(1, props.width) : 1)
const overlayHeight = computed(() => Number.isFinite(props.height) ? Math.max(1, props.height) : 1)
const snapHasLeader = computed(() => !!props.snap && (Math.abs(props.snap.raw[0] - props.snap.point[0]) > 0.5 || Math.abs(props.snap.raw[1] - props.snap.point[1]) > 0.5))

function dimensionGeometry(mark: DimensionMark) {
  const dx = mark.end[0] - mark.start[0], dy = mark.end[1] - mark.start[1]
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length, ny = dx / length
  return {
    startExtension: mark.wallStart,
    endExtension: mark.wallEnd,
    startTickA: [mark.start[0] - nx * 5, mark.start[1] - ny * 5] as [number, number],
    startTickB: [mark.start[0] + nx * 5, mark.start[1] + ny * 5] as [number, number],
    endTickA: [mark.end[0] - nx * 5, mark.end[1] - ny * 5] as [number, number],
    endTickB: [mark.end[0] + nx * 5, mark.end[1] + ny * 5] as [number, number],
  }
}

function labelWidth(label: string) { return Math.max(54, label.length * 7 + 12) }
</script>

<template>
  <svg
    class="drafting-overlay"
    data-testid="drafting-overlay"
    :viewBox="`0 0 ${overlayWidth} ${overlayHeight}`"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <g
      v-for="mark in dimensions"
      :key="`${mark.draft ? 'draft' : 'wall'}:${mark.id}`"
      class="dimension-mark"
      :class="{ selected: mark.selected, draft: mark.draft }"
      data-testid="dimension-label"
      :data-wall-id="mark.id"
      :data-length-m="mark.lengthM"
      :data-draft="mark.draft ? 'true' : 'false'"
    >
      <line class="dimension-accent" :x1="dimensionGeometry(mark).startExtension[0]" :y1="dimensionGeometry(mark).startExtension[1]" :x2="mark.start[0]" :y2="mark.start[1]" />
      <line class="dimension-accent" :x1="dimensionGeometry(mark).endExtension[0]" :y1="dimensionGeometry(mark).endExtension[1]" :x2="mark.end[0]" :y2="mark.end[1]" />
      <line class="dimension-extension" :x1="mark.start[0]" :y1="mark.start[1]" :x2="mark.end[0]" :y2="mark.end[1]" />
      <line v-if="Math.hypot(mark.labelAt[0] - mark.labelAnchor[0], mark.labelAt[1] - mark.labelAnchor[1]) > 20" class="dimension-accent" :x1="mark.labelAnchor[0]" :y1="mark.labelAnchor[1]" :x2="mark.labelAt[0]" :y2="mark.labelAt[1]" />
      <line class="dimension-tick" :x1="dimensionGeometry(mark).startTickA[0]" :y1="dimensionGeometry(mark).startTickA[1]" :x2="dimensionGeometry(mark).startTickB[0]" :y2="dimensionGeometry(mark).startTickB[1]" />
      <line class="dimension-tick" :x1="dimensionGeometry(mark).endTickA[0]" :y1="dimensionGeometry(mark).endTickA[1]" :x2="dimensionGeometry(mark).endTickB[0]" :y2="dimensionGeometry(mark).endTickB[1]" />
      <g class="dimension-label" :transform="`translate(${mark.labelAt[0]} ${mark.labelAt[1]})`">
        <rect :x="-labelWidth(mark.label) / 2" y="-9" :width="labelWidth(mark.label)" height="18" rx="4" />
        <text text-anchor="middle" dominant-baseline="central">{{ mark.label }}</text>
      </g>
    </g>

    <g
      v-if="snap"
      class="snap-indicator"
      :class="snap.kind"
      data-testid="snap-indicator"
      :data-snap-kind="snap.kind"
      :data-screen-x="snap.point[0]"
      :data-screen-y="snap.point[1]"
    >
      <line
        v-if="snapHasLeader"
        class="snap-leader"
        :x1="snap.raw[0]"
        :y1="snap.raw[1]"
        :x2="snap.point[0]"
        :y2="snap.point[1]"
      />
      <rect v-if="snap.kind === 'endpoint'" class="snap-endpoint" :x="snap.point[0] - 6" :y="snap.point[1] - 6" width="12" height="12" rx="1" />
      <circle v-else class="snap-grid" :cx="snap.point[0]" :cy="snap.point[1]" r="5.5" />
      <circle class="snap-core" :cx="snap.point[0]" :cy="snap.point[1]" r="1.5" />
    </g>
  </svg>
</template>

<style scoped>
.drafting-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.dimension-mark,
.snap-indicator {
  pointer-events: none;
}

.dimension-extension,
.dimension-accent,
.dimension-tick,
.snap-leader,
.snap-endpoint,
.snap-grid,
.snap-core {
  vector-effect: non-scaling-stroke;
}

.dimension-extension {
  fill: none;
  stroke: #688078;
  stroke-width: 1.25px;
}

.dimension-accent {
  stroke: #a9b8ac;
  stroke-width: 1px;
}

.dimension-tick {
  stroke: #688078;
  stroke-width: 1.5px;
  stroke-linecap: square;
}

.dimension-label rect {
  fill: #faf8f2;
  fill-opacity: .96;
  stroke: #d6ddd3;
  stroke-width: 1px;
}

.dimension-label text {
  fill: #294d49;
  font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: .05px;
}

.dimension-mark.selected .dimension-extension,
.dimension-mark.selected .dimension-accent,
.dimension-mark.selected .dimension-tick {
  stroke: #176d70;
  stroke-width: 1.8px;
}

.dimension-mark.selected .dimension-label rect {
  fill: #e7f0e9;
  stroke: #176d70;
  stroke-width: 1.25px;
}

.dimension-mark.selected .dimension-label text {
  fill: #174f50;
  font-weight: 700;
}

.dimension-mark.draft .dimension-extension,
.dimension-mark.draft .dimension-accent,
.dimension-mark.draft .dimension-tick {
  stroke: #ad603b;
  stroke-dasharray: 4 3;
}

.dimension-mark.draft .dimension-label rect {
  fill: #fff4eb;
  stroke: #bd7655;
  stroke-dasharray: 3 2;
}

.dimension-mark.draft .dimension-label text {
  fill: #874326;
}

.snap-leader {
  stroke: #966143;
  stroke-width: 1.1px;
  stroke-dasharray: 3 3;
}

.snap-endpoint {
  fill: #fffaf2;
  stroke: #ad603b;
  stroke-width: 2px;
}

.snap-grid {
  fill: #fffaf2;
  stroke: #176d70;
  stroke-width: 2px;
}

.snap-core {
  fill: #263f3d;
}
</style>
