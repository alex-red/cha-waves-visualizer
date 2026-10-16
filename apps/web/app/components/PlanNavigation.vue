<script setup lang="ts">
import { MAX_PLAN_ZOOM, MIN_PLAN_ZOOM } from '../lib/plan-viewport'
const props = defineProps<{
  zoom: number
  panMode: boolean
  disabled?: boolean
  testIdPrefix?: string
}>()

const emit = defineEmits<{
  zoom: [factor: number]
  fit: []
  pan: []
}>()

const zoomPercentage = () => `${Math.round(props.zoom * 100)}%`
const testId = (part: string) => `${props.testIdPrefix ?? 'plan'}-${part}`
</script>

<template>
  <div class="plan-navigation" role="group" aria-label="Plan navigation" :data-testid="testId('navigation')">
    <button
      type="button"
      class="nav-button pan-button"
      :data-testid="testId('pan')"
      aria-label="Pan plan"
      :aria-pressed="panMode"
      :disabled="disabled"
      @click="emit('pan')"
    >
      <span class="pan-glyph" aria-hidden="true">✣</span>
      <span>Pan</span>
    </button>
    <button
      type="button"
      class="nav-button zoom-button"
      :data-testid="testId('zoom-out')"
      aria-label="Zoom out"
      :disabled="disabled || zoom <= MIN_PLAN_ZOOM"
      @click="emit('zoom', 0.8)"
    >−</button>
    <output
      class="zoom-label"
      :data-testid="testId('zoom-label')"
      :data-zoom="zoom"
      :aria-label="`Zoom level ${zoomPercentage()} of fit`"
    >{{ zoomPercentage() }}</output>
    <button
      type="button"
      class="nav-button zoom-button"
      :data-testid="testId('zoom-in')"
      aria-label="Zoom in"
      :disabled="disabled || zoom >= MAX_PLAN_ZOOM"
      @click="emit('zoom', 1.25)"
    >+</button>
    <button
      type="button"
      class="nav-button fit-button"
      :data-testid="testId('fit')"
      aria-label="Fit home"
      :disabled="disabled"
      @click="emit('fit')"
    >Fit</button>
  </div>
</template>

<style scoped>
.plan-navigation {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  padding: 4px;
  border: 1px solid #d8d0c3;
  border-radius: 7px;
  background: rgba(250, 248, 242, 0.96);
  box-shadow: 0 3px 12px rgba(33, 47, 44, 0.13), 0 1px 2px rgba(33, 47, 44, 0.08);
  color: #263a38;
  white-space: nowrap;
}

.nav-button {
  display: inline-flex;
  min-width: 36px;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #304743;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.nav-button:hover:not(:disabled) {
  border-color: #d7ddd4;
  background: #f0eee6;
}

.nav-button[aria-pressed="true"] {
  border-color: #8fa9a0;
  background: #e3eee8;
  color: #155d5e;
}

.zoom-button {
  width: 36px;
  padding: 0;
  font: 500 21px/1 Georgia, serif;
}

.pan-button {
  min-width: 52px;
}

.pan-glyph {
  color: #315d54;
  font: 15px/1 Georgia, serif;
}

.zoom-label {
  min-width: 43px;
  color: #61706a;
  font: 600 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.fit-button {
  min-width: 42px;
  border-color: #e1dbcf;
  background: #f7f4ec;
  color: #345b55;
}

.nav-button:disabled {
  color: #a6aaa2;
  cursor: not-allowed;
}

.nav-button:focus-visible {
  outline: 2px solid #176d70;
  outline-offset: 2px;
}

@media (max-width: 360px) {
  .plan-navigation {
    gap: 1px;
    padding: 3px;
  }

  .pan-button {
    min-width: 44px;
    gap: 3px;
    padding: 0 4px;
  }

  .zoom-label {
    min-width: 38px;
  }

  .fit-button {
    min-width: 38px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .nav-button { transition: none; }
}
</style>
