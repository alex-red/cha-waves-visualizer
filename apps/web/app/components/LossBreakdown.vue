<script setup lang="ts">
import { computed } from 'vue'
import type { LossBreakdown as LossBreakdownBudget, LossTerm } from '../../../../packages/loss-breakdown'

const props = defineProps<{
  budget: LossBreakdownBudget
  selectedTermId?: string
}>()

const emit = defineEmits<{
  select: [term: LossTerm]
  clear: []
}>()

const unavailableReason = computed(() => {
  if (!props.budget.available) return props.budget.reason || 'A loss breakdown is unavailable for this reading.'
  if (!props.budget.terms.length) return props.budget.reason || 'No additive terms are available for this reading.'
  if (props.budget.terms.some(term => !Number.isFinite(term.contributionDb))) return 'A loss term could not be reconstructed as a finite value.'
  if (props.budget.total === undefined || !Number.isFinite(props.budget.total)) return 'The reconstructed total is unavailable for this reading.'
  return ''
})
const largestMagnitude = computed(() => Math.max(0, ...props.budget.terms.map(term => Math.abs(term.contributionDb))))
const selectedTerm = computed(() => props.budget.terms.find(term => term.id === props.selectedTermId && term.kind === 'crossing'))

function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`
}

function termUnit(term: LossTerm): string {
  return term.kind === 'source' && props.budget.unit === 'dBm' ? 'dBm' : 'dB'
}

function barWidth(value: number): string {
  if (!value || !largestMagnitude.value) return '0%'
  return `${Math.max(3, Math.abs(value) / largestMagnitude.value * 100)}%`
}

function closeBreakdown(event: Event) {
  if (!(event.currentTarget as HTMLDetailsElement).open) emit('clear')
}
</script>

<template>
  <details class="loss-breakdown" data-testid="loss-breakdown" @toggle="closeBreakdown">
    <summary data-testid="loss-breakdown-toggle">
      <span class="summary-mark" aria-hidden="true">±</span>
      <span>Why this reading</span>
      <span class="summary-chevron" aria-hidden="true">⌄</span>
    </summary>

    <div class="breakdown-content">
      <div class="breakdown-heading">
        <div>
          <span class="eyebrow">DIRECT PATH · ADDITIVE MODEL</span>
          <h2>Loss breakdown</h2>
        </div>
        <span v-if="!unavailableReason && budget.total !== undefined" class="total-chip" data-testid="loss-budget-total" :data-value="budget.total">
          {{ signed(budget.total) }} <small>{{ budget.unit }}</small>
        </span>
      </div>

      <p v-if="unavailableReason" class="unavailable-note" data-testid="loss-budget-unavailable" role="status">
        {{ unavailableReason }}
      </p>

      <template v-else>
        <ol class="term-list" aria-label="Additive reading contributions">
          <li v-for="term in budget.terms" :key="term.id" class="term-item" :class="{ crossing: term.kind === 'crossing', selected: term.id === selectedTermId }">
            <button
              v-if="term.kind === 'crossing'"
              type="button"
              class="term-row crossing-button"
              data-testid="loss-term"
              :data-term-id="term.id"
              :data-wall-id="term.crossing?.wallId"
              :data-opening-id="term.crossing?.openingId"
              :data-contribution-db="term.contributionDb"
              :aria-pressed="term.id === selectedTermId"
              @click="emit('select', term)"
            >
              <span class="term-copy">
                <span class="term-label">{{ term.label }}</span>
                <span class="term-detail">{{ term.detail }}</span>
              </span>
              <span class="term-value">{{ signed(term.contributionDb) }} <small>{{ termUnit(term) }}</small></span>
              <span class="term-bar" aria-hidden="true"><span :class="term.contributionDb < 0 ? 'negative' : 'positive'" :style="{ width: barWidth(term.contributionDb) }"></span></span>
            </button>
            <div
              v-else
              class="term-row static-row"
              :data-contribution-db="term.contributionDb"
            >
              <span class="term-copy">
                <span class="term-label">{{ term.label }}</span>
                <span class="term-detail">{{ term.detail }}</span>
              </span>
              <span class="term-value">{{ signed(term.contributionDb) }} <small>{{ termUnit(term) }}</small></span>
              <span class="term-bar" aria-hidden="true"><span :class="term.contributionDb < 0 ? 'negative' : 'positive'" :style="{ width: barWidth(term.contributionDb) }"></span></span>
            </div>
          </li>
        </ol>

        <div v-if="selectedTerm" class="selected-explanation" aria-live="polite">
          <div class="selected-heading"><span>HIGHLIGHTED ASSEMBLY</span><button type="button" data-testid="loss-highlight-clear" @click="emit('clear')">Clear highlight</button></div>
          <p><strong>{{ selectedTerm.label }}</strong> · {{ selectedTerm.detail }}</p>
          <p v-if="selectedTerm.crossing" class="hit-location">Plan highlight · ray hit at X {{ selectedTerm.crossing.hit[0].toFixed(2) }}, Y {{ selectedTerm.crossing.hit[1].toFixed(2) }}, Z {{ selectedTerm.crossing.hit[2].toFixed(2) }} m</p>
        </div>
      </template>

      <button v-if="selectedTermId && (unavailableReason || !selectedTerm)" type="button" class="clear-highlight" data-testid="loss-highlight-clear" @click="emit('clear')">Clear highlight</button>

      <p class="model-note">Configured direct-path estimate. Select an assembly to highlight its crossing on the plan.<span v-if="!unavailableReason"> Contributions are signed; displayed rounding can differ from the total.</span></p>
    </div>
  </details>
</template>

<style scoped>
.loss-breakdown {
  --paper: #f8f5ed;
  --ink: #253735;
  --muted: #52645b;
  --teal: #28645e;
  --clay: #a45135;
  margin: 18px 0;
  border: 1px solid #d8d3c6;
  border-radius: 8px;
  background: linear-gradient(135deg, #fbf9f3 0%, var(--paper) 100%);
  color: var(--ink);
  box-shadow: 0 5px 14px #273a3210;
  font: 12px/1.45 ui-sans-serif, system-ui, sans-serif;
}

.loss-breakdown summary {
  display: flex;
  min-height: 43px;
  align-items: center;
  gap: 10px;
  padding: 0 13px;
  cursor: pointer;
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
  list-style: none;
}
.loss-breakdown summary::-webkit-details-marker { display: none; }
.loss-breakdown summary:focus-visible { outline: 2px solid var(--teal); outline-offset: -3px; border-radius: 8px; }
.summary-mark { display: grid; width: 23px; height: 23px; place-items: center; border: 1px solid #b9c9bc; border-radius: 50%; color: var(--teal); font: 16px/1 Georgia, serif; }
.summary-chevron { margin-left: auto; color: var(--clay); font: 18px/1 Georgia, serif; transition: transform 150ms ease; }
details[open] .summary-chevron { transform: rotate(180deg); }

.breakdown-content { padding: 0 13px 13px; border-top: 1px solid #ded9cd; }
.breakdown-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; padding: 13px 0 10px; }
.eyebrow, .selected-heading > span { color: #52645b; font-size: 9px; font-weight: 750; letter-spacing: .11em; }
.breakdown-heading h2 { margin: 3px 0 0; color: var(--ink); font: 600 19px/1.15 Georgia, 'Times New Roman', serif; letter-spacing: -.025em; }
.total-chip { flex: none; padding: 6px 9px; border: 1px solid #a8c0b5; border-radius: 5px; background: #e8f0e9; color: #1f534c; font: 700 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.total-chip small, .term-value small { font: 700 9px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .04em; }

.unavailable-note { margin: 2px 0 10px; padding: 10px 11px; border-left: 3px solid var(--clay); background: #f3e8df; color: #593f34; }
.term-list { display: grid; gap: 2px; max-height: 226px; margin: 0; padding: 0; overflow: auto; list-style: none; scrollbar-color: #b8c5bc transparent; scrollbar-width: thin; }
.term-item { min-width: 0; border-bottom: 1px solid #e6e1d6; }
.term-row { position: relative; display: grid; width: 100%; min-height: 48px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 9px; padding: 7px 7px 11px; border: 0; background: transparent; color: inherit; text-align: left; }
.crossing-button { cursor: pointer; }
.crossing-button:hover { background: #ecefe7; }
.crossing-button:focus-visible { z-index: 1; outline: 2px solid var(--teal); outline-offset: -2px; border-radius: 4px; }
.term-item.selected .crossing-button { background: #e6eee7; box-shadow: inset 3px 0 var(--teal); }
.term-copy { display: grid; min-width: 0; gap: 1px; }
.term-label { overflow-wrap: anywhere; color: #293b38; font-weight: 650; }
.term-detail { overflow-wrap: anywhere; color: var(--muted); font-size: 10px; line-height: 1.35; }
.term-value { align-self: start; padding-top: 1px; color: #36534b; font: 650 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.term-bar { position: absolute; right: 7px; bottom: 4px; left: 7px; height: 2px; overflow: hidden; background: #dedfd5; }
.term-bar > span { display: block; height: 100%; transition: width 150ms ease; }
.term-bar .negative { background: var(--clay); }
.term-bar .positive { background: var(--teal); }

.selected-explanation { margin-top: 10px; padding: 9px 10px; border: 1px solid #c4d1c5; border-radius: 5px; background: #edf2ea; }
.selected-heading { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
.selected-heading button, .clear-highlight { flex: none; padding: 0; border: 0; background: transparent; color: var(--teal); cursor: pointer; font: 650 10px/1.4 ui-sans-serif, system-ui, sans-serif; text-decoration: underline; text-underline-offset: 2px; }
.selected-heading button:focus-visible, .clear-highlight:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; border-radius: 2px; }
.selected-explanation p { margin: 5px 0 0; color: #40564e; overflow-wrap: anywhere; font-size: 11px; }
.clear-highlight { margin: 9px 0 0; }
.model-note { margin: 11px 0 0; color: #52645b; font-size: 10px; line-height: 1.45; }

@media (max-width: 360px) {
  .loss-breakdown { margin: 13px 0; }
  .breakdown-content { padding-right: 10px; padding-left: 10px; }
  .term-row { column-gap: 6px; padding-right: 4px; padding-left: 4px; }
  .term-value { font-size: 11px; }
  .term-bar { right: 4px; left: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .summary-chevron, .term-bar > span { transition: none; }
}
</style>
