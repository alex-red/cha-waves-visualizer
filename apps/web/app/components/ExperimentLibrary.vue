<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import { MAX_PROJECT_EXPERIMENTS, type ProjectExperiment } from '../../../../packages/project'
import type { FloorPlanReference } from '../../../../packages/floorplan'
import { describeExperimentChanges } from '../../../../packages/experiments'

const props = defineProps<{
  experiments: readonly ProjectExperiment[]
  scene: Scene
  settings: SolverSettings
  referenceImage?: FloorPlanReference | undefined
  baselineExperimentId: string | null
  disabled: boolean
  error: string
  notice: string
}>()

const emit = defineEmits<{
  save: [payload: { name: string; notes: string }]
  open: [id: string]
  baseline: [id: string]
  duplicate: [id: string]
  update: [payload: { id: string; name: string; notes: string }]
  remove: [id: string]
  close: []
}>()

const selectedId = ref('')
const captureName = ref('')
const captureNotes = ref('')
const editName = ref('')
const editNotes = ref('')
const selected = computed(() => props.experiments.find(item => item.id === selectedId.value))
const atCapacity = computed(() => props.experiments.length >= MAX_PROJECT_EXPERIMENTS)
const changes = computed(() => selected.value
  ? describeExperimentChanges(selected.value, { scene: props.scene, settings: props.settings, ...(props.referenceImage ? { referenceImage: props.referenceImage } : {}) })
  : [])

watch(() => props.experiments.map(item => item.id), (ids, previous = []) => {
  const added = ids.filter(id => !previous.includes(id))
  if (added.length) selectedId.value = added.at(-1)!
  else if (!ids.includes(selectedId.value)) selectedId.value = ids[0] ?? ''
}, { immediate: true })

// Keep in-progress edits intact while the live scene changes. Only a selection or
// saved metadata change should replace these local drafts.
watch([() => selected.value?.id, () => selected.value?.name, () => selected.value?.notes], ([, name, notes]) => {
  editName.value = name ?? ''
  editNotes.value = notes ?? ''
}, { immediate: true })

async function saveCurrent() {
  const name = captureName.value.trim()
  if (props.disabled || atCapacity.value || !name) return
  emit('save', { name, notes: captureNotes.value })
  await nextTick()
  if (!props.error) { captureName.value = ''; captureNotes.value = '' }
}

function updateDetails() {
  if (!selected.value || props.disabled || !editName.value.trim()) return
  emit('update', { id: selected.value.id, name: editName.value.trim(), notes: editNotes.value })
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <section class="experiment-library" aria-labelledby="experiment-title" data-testid="experiment-library">
    <header class="library-header">
      <div><span class="library-kicker">WORKSPACE ARCHIVE · {{ experiments.length }} / {{ MAX_PROJECT_EXPERIMENTS }}</span><h1 id="experiment-title">Named experiments</h1></div>
      <button class="close-button" type="button" aria-label="Close experiments" @click="emit('close')">×</button>
    </header>

    <p v-if="error" class="feedback error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="feedback notice" role="status">{{ notice }}</p>

    <form class="capture-card" @submit.prevent="saveCurrent">
      <div class="section-heading"><span class="section-index">01</span><div><h2>Keep this state</h2><p>Save the current room, solver settings, and floor plan reference.</p></div></div>
      <label class="field-label" for="experiment-name">Name</label>
      <input id="experiment-name" v-model="captureName" data-testid="experiment-name" maxlength="80" required placeholder="e.g. Soft panels on north wall" :disabled="disabled || atCapacity">
      <label class="field-label" for="experiment-notes">Notes <span>Optional · up to 2,000 characters</span></label>
      <textarea id="experiment-notes" v-model="captureNotes" data-testid="experiment-notes" maxlength="2000" rows="3" placeholder="What changed, and what are you looking for?" :disabled="disabled || atCapacity" />
      <div class="capture-footer"><p v-if="atCapacity" class="capacity-note">All 20 experiment slots are in use. Remove one to save another.</p><p v-else class="quiet-note">Saving and loading are recorded in workspace history.</p><button class="primary-action" type="submit" data-testid="experiment-save" :disabled="disabled || atCapacity || !captureName.trim()">Save current state <span aria-hidden="true">↗</span></button></div>
    </form>

    <section class="saved-section" aria-labelledby="saved-heading">
      <div class="section-heading saved-heading"><span class="section-index">02</span><div><h2 id="saved-heading">Saved experiments</h2><p>Select a study to inspect changes against the live workspace.</p></div></div>
      <label class="field-label" for="experiment-select">Saved experiment</label>
      <select id="experiment-select" v-model="selectedId" data-testid="experiment-select" :disabled="experiments.length === 0">
        <option value="" disabled>{{ experiments.length ? 'Choose an experiment' : 'No experiments saved yet' }}</option>
        <option v-for="item in experiments" :key="item.id" :value="item.id">{{ item.name }}{{ baselineExperimentId === item.id ? ' · BASELINE' : '' }}</option>
      </select>

      <div v-if="!selected" class="empty-state"><span class="empty-mark" aria-hidden="true">⌁</span><strong>Your first experiment starts here.</strong><p>Save a named state to keep a reference as you tune the room.</p></div>
      <template v-else>
        <div class="metadata-card">
          <div class="metadata-top"><span class="record-label">EXPERIMENT RECORD</span><span v-if="baselineExperimentId === selected.id" class="baseline-badge">A · BASELINE</span></div>
          <label class="field-label" :for="`edit-name-${selected.id}`">Name</label>
          <input :id="`edit-name-${selected.id}`" v-model="editName" data-testid="experiment-edit-name" maxlength="80" :disabled="disabled">
          <label class="field-label" :for="`edit-notes-${selected.id}`">Notes</label>
          <textarea :id="`edit-notes-${selected.id}`" v-model="editNotes" data-testid="experiment-edit-notes" maxlength="2000" rows="3" :disabled="disabled" placeholder="Add a note about this state" />
          <div class="update-row"><span class="saved-date">Updated {{ new Date(selected.updatedAt).toLocaleDateString() }}</span><button type="button" class="quiet-action" data-testid="experiment-update" :disabled="disabled || !editName.trim() || (editName.trim() === selected.name && editNotes === selected.notes)" @click="updateDetails">Update details</button></div>
        </div>

        <details class="change-details" open data-testid="experiment-changes">
          <summary><span>Current workspace changes</span><span class="change-count">{{ changes.length }} {{ changes.length === 1 ? 'change' : 'changes' }}</span></summary>
          <p class="change-caption">Live workspace compared with “{{ selected.name }}”.</p>
          <div v-if="changes.length" class="change-table-wrap">
            <table class="change-table"><thead><tr><th scope="col">What changed</th><th scope="col">Saved</th><th scope="col">Current</th></tr></thead><tbody><tr v-for="change in changes" :key="change.key"><th scope="row">{{ change.label }}</th><td>{{ display(change.before) }}</td><td>{{ display(change.after) }}</td></tr></tbody></table>
          </div>
          <p v-else class="no-changes">The live workspace matches this saved experiment.</p>
        </details>

        <div class="action-grid" aria-label="Experiment actions">
          <button type="button" class="primary-action" data-testid="experiment-open" :disabled="disabled" @click="emit('open', selected.id)">Load experiment <span aria-hidden="true">↗</span></button>
          <button type="button" class="quiet-action" data-testid="experiment-baseline" :disabled="disabled" @click="emit('baseline', selected.id)">{{ baselineExperimentId === selected.id ? 'Baseline selected' : 'Use as baseline' }}</button>
          <button type="button" class="quiet-action" data-testid="experiment-duplicate" :disabled="disabled || atCapacity" @click="emit('duplicate', selected.id)">Duplicate experiment</button>
          <button type="button" class="remove-action" data-testid="experiment-remove" :disabled="disabled" @click="emit('remove', selected.id)">Remove experiment</button>
        </div>
        <p v-if="baselineExperimentId === selected.id" class="baseline-note">This study anchors A / B comparison when its solver settings match the current domain.</p>
      </template>
    </section>
  </section>
</template>

<style scoped>
.experiment-library{--ink:#263735;--muted:#52645b;--line:#ded8cd;--paper:#faf8f2;--wash:#f2eee5;--teal:#176d70;--clay:#a84e29;box-sizing:border-box;width:100%;min-width:0;padding:clamp(18px,4vw,34px);background:var(--paper);color:var(--ink);font:13px/1.45 ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}
.library-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:18px}.library-kicker,.record-label{font:700 10px/1.2 ui-monospace,monospace;letter-spacing:1.15px;color:#52645b}.library-header h1{font:400 clamp(25px,5vw,34px)/1.1 Georgia,serif;letter-spacing:-.55px;margin:7px 0 0;color:#203432}.close-button{flex:none;width:38px;height:38px;border:1px solid #d8d2c7;border-radius:50%;background:#fffdf8;color:#586760;font:24px/1 Georgia,serif;cursor:pointer}.close-button:hover{background:#eee9df;color:#203432}.feedback{margin:0 0 14px;padding:10px 12px;border-radius:4px;font-size:13px}.error{background:#fff0e7;color:#813b22;border:1px solid #dfb39b}.notice{background:#e9f1ec;color:#315e53;border:1px solid #bfd1c5}
.capture-card,.metadata-card{min-width:0;background:#f5f1e8;border:1px solid #e2dcd0;border-radius:6px;padding:16px}.section-heading{display:flex;align-items:flex-start;gap:11px;margin:0 0 16px}.section-index{display:grid;place-items:center;flex:none;width:26px;height:26px;border:1px solid #c8d6cc;border-radius:50%;color:#35645e;font:11px ui-monospace,monospace}.section-heading h2{font:400 19px/1.2 Georgia,serif;margin:1px 0 3px}.section-heading p{margin:0;color:#52645b;font-size:12px;line-height:1.45}.field-label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:12px 0 5px;color:#45554f;font-size:12px;font-weight:650}.field-label span{font-size:11px;font-weight:400;color:#52645b}.experiment-library input,.experiment-library textarea,.experiment-library select{display:block;width:100%;min-width:0;box-sizing:border-box;border:1px solid #d8d2c7;border-radius:4px;background:#fffdf8;color:#293a36;padding:9px 10px;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}.experiment-library input,.experiment-library select{min-height:40px}.experiment-library textarea{resize:vertical;min-height:70px}.experiment-library input:focus,.experiment-library textarea:focus,.experiment-library select:focus{outline:2px solid #176d70;outline-offset:2px}.experiment-library input::placeholder,.experiment-library textarea::placeholder{color:#52645b}.capture-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.quiet-note,.capacity-note{font-size:11px;line-height:1.45;color:#52645b;margin:0}.capacity-note{color:#85432a}.primary-action,.quiet-action,.remove-action{min-height:40px;border-radius:4px;padding:8px 12px;font:650 12px/1.3 ui-sans-serif,system-ui,sans-serif;cursor:pointer}.primary-action{border:1px solid #294d4a;background:#254744;color:#fffaf1}.primary-action span{margin-left:9px;font-size:15px}.primary-action:hover:not(:disabled){background:#176d70}.quiet-action{border:1px solid #cbd3ca;background:#f9f7f1;color:#34534d}.quiet-action:hover:not(:disabled){background:#e7eee8}.remove-action{border:1px solid #dfc8ba;background:#fff9f4;color:#8c4529}.remove-action:hover:not(:disabled){background:#f8e8dd}.experiment-library button:disabled,.experiment-library select:disabled,.experiment-library input:disabled,.experiment-library textarea:disabled{opacity:.55;cursor:not-allowed}.saved-section{margin-top:24px}.saved-heading{margin-bottom:14px}.saved-section>select{margin-bottom:12px}.empty-state{display:grid;justify-items:center;text-align:center;gap:7px;padding:30px 18px;border:1px dashed #d8d1c5;border-radius:5px;background:#f6f2e9}.empty-mark{font:28px Georgia,serif;color:#a5b4aa}.empty-state strong{font:400 17px Georgia,serif;color:#34443f}.empty-state p{max-width:290px;margin:0;color:#52645b;font-size:12px}.metadata-card{background:#fffdf8;padding:14px}.metadata-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px}.baseline-badge{padding:4px 7px;background:#dce9e1;color:#315f55;border-radius:3px;font:700 10px ui-monospace,monospace;letter-spacing:.5px}.saved-date{font-size:11px;color:#52645b}.update-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:11px}.change-details{margin-top:14px;border:1px solid var(--line);border-radius:5px;background:#f5f1e8;overflow:hidden}.change-details summary{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 12px;cursor:pointer;color:#394943;font-size:12px;font-weight:650;list-style:none}.change-details summary::-webkit-details-marker{display:none}.change-details summary::after{content:'⌄';margin-left:auto;color:#52645b}.change-details:not([open]) summary::after{content:'›'}.change-count{padding:3px 6px;background:#e9e5db;color:#52645b;border-radius:10px;font:10px ui-monospace,monospace}.change-caption{margin:0;padding:0 12px 8px;color:#52645b;font-size:11px}.change-table-wrap{width:100%;overflow-x:auto}.change-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}.change-table th,.change-table td{padding:8px 9px;border-top:1px solid #e3ddd2;text-align:left;vertical-align:top;overflow-wrap:anywhere}.change-table thead th{color:#52645b;font-size:10px;font-weight:650}.change-table tbody th{width:34%;font-weight:600;color:#475750}.change-table td{color:#5f6d65}.no-changes{padding:4px 12px 12px;margin:0;color:#68776e;font-size:12px}.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.action-grid button{min-width:0}.baseline-note{padding:9px 10px;margin:10px 0 0;border-left:2px solid #6b9382;background:#edf2eb;color:#5d7166;font-size:11px;line-height:1.5}
@media(max-width:420px){.experiment-library{padding:16px}.capture-card{padding:13px}.capture-footer{align-items:stretch;flex-direction:column}.capture-footer .primary-action{width:100%}.action-grid{grid-template-columns:1fr}.change-table{font-size:11px}.change-table th,.change-table td{padding:7px 6px}.change-table tbody th{width:30%}.library-kicker{font-size:9px;letter-spacing:.7px}}
@media(min-width:800px){.experiment-library{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);column-gap:24px}.library-header,.feedback{grid-column:1/-1}.capture-card{align-self:start}.saved-section{margin-top:0}}
</style>
