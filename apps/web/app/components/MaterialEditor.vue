<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Scene, SolverSettings } from '../../../../packages/engine'
import { availableMaterialFrequencies, type MaterialUpdate } from '../../../../packages/materials'

type Provenance = Scene['materials'][number]['provenance']
type BandDraft = {
  frequencyHz: string | number
  valueDb: string | number
  provenance: Provenance
  notes: string
  hadNotes?: boolean
}

const props = defineProps<{
  scene: Scene
  settings: SolverSettings
  disabled: boolean
  error: string
  notice?: string
}>()

const emit = defineEmits<{
  apply: [update: MaterialUpdate]
  close: []
  clearFeedback: []
}>()

const provenanceOptions: { value: Provenance; label: string }[] = [
  { value: 'fixture-assumed', label: 'Fixture assumed' },
  { value: 'user-entered', label: 'User entered' },
  { value: 'literature-derived', label: 'Literature derived' },
  { value: 'manufacturer-measured', label: 'Manufacturer measured' },
  { value: 'site-measured', label: 'Site measured' },
]

const selectedMaterialId = ref(props.scene.materials[0]?.id ?? '')
const nameDraft = ref('')
const provenanceDraft = ref<Provenance>('fixture-assumed')
const acousticDraft = ref<BandDraft[]>([])
const radioDraft = ref<BandDraft[]>([])
const localAlert = ref('')
const editorForm = ref<HTMLFormElement | null>(null)

const selectedMaterial = computed(() => props.scene.materials.find(material => material.id === selectedMaterialId.value))
const supportedFrequencies = computed(() => availableMaterialFrequencies(props.scene, props.settings.mode))
const assemblyDataRequired = computed(() => props.scene.walls.length > 0 && !(props.settings.mode === 'acoustics' && !props.settings.transmissionEnabled))
const currentFrequencySupported = computed(() => !assemblyDataRequired.value || supportedFrequencies.value.includes(props.settings.frequencyHz))
const relatedAssemblies = computed(() => {
  const material = selectedMaterial.value
  if (!material) return []
  const walls = props.scene.walls.filter(wall => wall.materialId === material.id)
  const openings = props.scene.openings.filter(opening => opening.materialId === material.id || props.scene.walls.some(wall => wall.id === opening.wallId && wall.materialId === material.id))
  return [
    ...walls.map(wall => ({ key: `wall:${wall.id}`, label: `Wall ${wall.id}` })),
    ...openings.map(opening => ({ key: `opening:${opening.id}`, label: `${opening.kind[0]?.toUpperCase()}${opening.kind.slice(1)} ${opening.id}${opening.materialId === material.id ? '' : ' · host wall material'}` })),
  ]
})

function cloneBands(bands: Scene['materials'][number]['acousticTransmissionDb']): BandDraft[] {
  return bands.map(band => ({
    frequencyHz: String(band.frequencyHz),
    valueDb: String(band.valueDb),
    provenance: band.provenance,
    notes: band.notes ?? '',
    hadNotes: band.notes !== undefined,
  }))
}

function materialSignature(material: Scene['materials'][number] | undefined): string {
  return material ? JSON.stringify(material) : ''
}

function resetDrafts() {
  const material = selectedMaterial.value
  nameDraft.value = material?.name ?? ''
  provenanceDraft.value = material?.provenance ?? 'fixture-assumed'
  acousticDraft.value = material ? cloneBands(material.acousticTransmissionDb) : []
  radioDraft.value = material ? cloneBands(material.radioLossDb) : []
  localAlert.value = ''
}

let lastSceneId = props.scene.id
let lastMaterialSignature = materialSignature(selectedMaterial.value)
watch([selectedMaterialId, () => props.scene.id, () => materialSignature(selectedMaterial.value)], ([materialId, sceneId, signature], previous) => {
  const selectionChanged = previous && materialId !== previous[0]
  if (selectionChanged) emit('clearFeedback')
  const sceneChanged = sceneId !== lastSceneId
  const canonicalMaterialChanged = signature !== lastMaterialSignature
  lastSceneId = sceneId
  lastMaterialSignature = signature
  if (sceneChanged && !props.scene.materials.some(material => material.id === selectedMaterialId.value)) {
    selectedMaterialId.value = props.scene.materials[0]?.id ?? ''
  }
  if (!previous || selectionChanged || sceneChanged || (canonicalMaterialChanged && !props.error)) resetDrafts()
}, { immediate: true })

function addBand(profile: BandDraft[]) {
  profile.push({ frequencyHz: '', valueDb: '', provenance: 'user-entered', notes: '' })
}

function parseProfile(profile: BandDraft[], label: string): { frequencyHz: number; valueDb: number; provenance: Provenance; notes?: string }[] | undefined {
  const parsed: { frequencyHz: number; valueDb: number; provenance: Provenance; notes?: string }[] = []
  for (const [index, band] of profile.entries()) {
    const frequencyHz = Number(band.frequencyHz)
    const valueDb = Number(band.valueDb)
    if (String(band.frequencyHz).trim() === '' || !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
      localAlert.value = `${label} band ${index + 1} needs a positive, finite frequency in Hz.`
      return
    }
    if (String(band.valueDb).trim() === '' || !Number.isFinite(valueDb)) {
      localAlert.value = `${label} band ${index + 1} needs a finite loss in dB.`
      return
    }
    if (band.notes.length > 2000) {
      localAlert.value = `${label} band ${index + 1} notes must be 2,000 characters or fewer.`
      return
    }
    parsed.push({ frequencyHz, valueDb, provenance: band.provenance, ...(band.notes !== '' || band.hadNotes ? { notes: band.notes } : {}) })
  }
  parsed.sort((left, right) => left.frequencyHz - right.frequencyHz)
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index]!.frequencyHz === parsed[index - 1]!.frequencyHz) {
      localAlert.value = `${label} band frequencies must be unique.`
      return
    }
  }
  return parsed
}

function applyUpdate() {
  localAlert.value = ''
  const material = selectedMaterial.value
  if (!material) {
    localAlert.value = 'Choose an available material before applying changes.'
    return
  }
  const name = nameDraft.value.trim()
  if (name.length < 1 || name.length > 80) {
    localAlert.value = 'Material name must contain 1 to 80 characters.'
    return
  }
  const acousticTransmissionDb = parseProfile(acousticDraft.value, 'Acoustic')
  if (!acousticTransmissionDb) return
  const radioLossDb = parseProfile(radioDraft.value, 'Radio')
  if (!radioLossDb) return
  emit('apply', {
    materialId: material.id,
    name,
    provenance: provenanceDraft.value,
    acousticTransmissionDb,
    radioLossDb,
  })
}

function removeBand(profile: BandDraft[], index: number) {
  profile.splice(index, 1)
}
</script>

<template>
  <section class="me-editor" aria-labelledby="me-title" data-testid="material-editor">
    <header class="me-header">
      <div>
        <p class="me-eyebrow">MATERIAL LIBRARY · AUTHORED INPUTS</p>
        <h2 id="me-title">Material editor</h2>
      </div>
      <button type="button" class="me-close" aria-label="Close material editor" @click="emit('close')">×</button>
    </header>

    <form ref="editorForm" class="me-form" @submit.prevent="applyUpdate">
      <label class="me-field">
        <span>Material</span>
        <select id="material-select" v-model="selectedMaterialId" data-testid="material-select" :disabled="disabled || !scene.materials.length">
          <option v-for="material in scene.materials" :key="material.id" :value="material.id">{{ material.name }}</option>
        </select>
      </label>

      <p v-if="!selectedMaterial" class="me-empty" role="status">This scene has no materials to edit.</p>

      <template v-else>
        <div class="me-idline"><span>Material ID</span><code>{{ selectedMaterial.id }}</code></div>
        <label class="me-field">
          <span>Name</span>
          <input v-model="nameDraft" id="material-name" data-testid="material-name" required minlength="1" maxlength="80" :disabled="disabled" autocomplete="off">
        </label>
        <label class="me-field">
          <span>Material provenance</span>
          <select v-model="provenanceDraft" id="material-provenance" data-testid="material-provenance" :disabled="disabled">
            <option v-for="option in provenanceOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>

        <div class="me-scope">
          <strong>Scope</strong>
          <p>Changes every assembly using this material.</p>
          <ul v-if="relatedAssemblies.length" aria-label="Assemblies using this material">
            <li v-for="assembly in relatedAssemblies" :key="assembly.key">{{ assembly.label }}</li>
          </ul>
          <p v-else class="me-muted">No walls or openings currently reference this material.</p>
        </div>

        <section class="me-profile" aria-labelledby="me-acoustic-title">
          <div class="me-profile-heading">
            <div><span class="me-profile-mark" aria-hidden="true">A</span><h3 id="me-acoustic-title">Acoustic transmission</h3></div>
            <span class="me-profile-unit">dB</span>
          </div>
          <p class="me-explainer">Authored assembly loss by frequency. Wall thickness sets geometry; values here describe the assembly and are not scaled automatically. Signed values are allowed.</p>
          <p v-if="!acousticDraft.length" class="me-missing">No acoustic coefficients authored.</p>
          <div v-for="(band, index) in acousticDraft" :key="`a-${index}`" class="me-band" data-testid="material-acoustic-row">
            <div class="me-band-title"><span>Acoustic band {{ index + 1 }}</span><button type="button" class="me-remove" :aria-label="`Remove acoustic band ${index + 1}`" :disabled="disabled" @click="removeBand(acousticDraft, index)">Remove</button></div>
            <label class="me-field"><span>Frequency (Hz)</span><input v-model="band.frequencyHz" type="number" step="any" min="0" required :disabled="disabled"></label>
            <label class="me-field"><span>Loss (dB)</span><input v-model="band.valueDb" type="number" step="any" required :disabled="disabled"></label>
            <label class="me-field"><span>Provenance</span><select v-model="band.provenance" :disabled="disabled"><option v-for="option in provenanceOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            <label class="me-field"><span>Notes</span><textarea v-model="band.notes" rows="2" maxlength="2000" :disabled="disabled"></textarea></label>
          </div>
          <button type="button" class="me-add" data-testid="material-add-acoustic" :disabled="disabled" @click="addBand(acousticDraft)"><span aria-hidden="true">＋</span> Add acoustic band</button>
        </section>

        <section class="me-profile" aria-labelledby="me-radio-title">
          <div class="me-profile-heading">
            <div><span class="me-profile-mark me-radio-mark" aria-hidden="true">R</span><h3 id="me-radio-title">Radio loss</h3></div>
            <span class="me-profile-unit">dB</span>
          </div>
          <p class="me-explainer">Radio loss is authored per assembly at each frequency. Values can be signed.</p>
          <p v-if="!radioDraft.length" class="me-missing">No radio coefficients authored.</p>
          <div v-for="(band, index) in radioDraft" :key="`r-${index}`" class="me-band" data-testid="material-radio-row">
            <div class="me-band-title"><span>Radio band {{ index + 1 }}</span><button type="button" class="me-remove" :aria-label="`Remove radio band ${index + 1}`" :disabled="disabled" @click="removeBand(radioDraft, index)">Remove</button></div>
            <label class="me-field"><span>Frequency (Hz)</span><input v-model="band.frequencyHz" type="number" step="any" min="0" required :disabled="disabled"></label>
            <label class="me-field"><span>Loss (dB)</span><input v-model="band.valueDb" type="number" step="any" required :disabled="disabled"></label>
            <label class="me-field"><span>Provenance</span><select v-model="band.provenance" :disabled="disabled"><option v-for="option in provenanceOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            <label class="me-field"><span>Notes</span><textarea v-model="band.notes" rows="2" maxlength="2000" :disabled="disabled"></textarea></label>
          </div>
          <button type="button" class="me-add" data-testid="material-add-radio" :disabled="disabled" @click="addBand(radioDraft)"><span aria-hidden="true">＋</span> Add radio band</button>
        </section>

        <p class="me-absorption">Acoustic absorption data is preserved unchanged. The direct-path model uses transmission loss for acoustics.</p>
        <p class="me-coverage" data-testid="material-frequency-coverage">
          <strong>Shared {{ settings.mode === 'acoustics' ? 'acoustic' : 'radio' }} frequencies:</strong>
          <span v-if="supportedFrequencies.length">{{ supportedFrequencies.map(value => value.toLocaleString()).join(' · ') }} Hz</span>
          <span v-else>none authored across referenced assemblies</span>
          <span v-if="!assemblyDataRequired" class="me-current-coverage">Assembly loss data is not required for this setting.</span>
          <span class="me-current-coverage">Current setting {{ settings.frequencyHz.toLocaleString() }} Hz is {{ currentFrequencySupported ? 'covered' : 'not covered by every referenced material' }}.</span>
        </p>
      </template>

      <p v-if="localAlert" class="me-alert" role="alert">{{ localAlert }}</p>
      <p v-if="error" class="me-alert" role="alert">{{ error }}</p>
      <p v-if="notice" class="me-notice" role="status">{{ notice }}</p>
      <footer class="me-footer">
        <span class="me-frequency">Current {{ settings.mode === 'acoustics' ? 'acoustic' : 'radio' }} frequency · {{ settings.frequencyHz.toLocaleString() }} Hz</span>
        <button type="submit" class="me-apply" data-testid="material-apply" :disabled="disabled || !selectedMaterial">Apply material</button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.me-editor {
  --me-paper: #f8f5ed;
  --me-ink: #253735;
  --me-muted: #52645b;
  --me-teal: #28645e;
  --me-clay: #a45135;
  width: 100%;
  border: 1px solid #d8d3c6;
  border-radius: 10px;
  background: linear-gradient(145deg, #fbf9f3 0%, var(--me-paper) 100%);
  color: var(--me-ink);
  box-shadow: 0 18px 55px #203a3326, 0 3px 12px #203a3312;
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
  scrollbar-color: #b9c6bc transparent;
  scrollbar-width: thin;
}
.me-header { position: sticky; z-index: 2; top: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 17px 17px 13px; border-bottom: 1px solid #ded9cd; background: #fbf9f3f2; backdrop-filter: blur(10px); }
.me-eyebrow { margin: 0 0 3px; color: var(--me-muted); font-size: 9px; font-weight: 750; letter-spacing: .12em; }
.me-header h2 { margin: 0; color: var(--me-ink); font: 600 23px/1.1 Georgia, 'Times New Roman', serif; letter-spacing: -.035em; }
.me-close { display: grid; width: 30px; height: 30px; flex: none; place-items: center; border: 1px solid #cbd3c9; border-radius: 50%; background: #f2f0e8; color: var(--me-ink); font: 21px/1 Georgia, serif; cursor: pointer; }
.me-form { padding: 14px 17px 17px; }
.me-field { display: grid; min-width: 0; gap: 4px; color: var(--me-muted); font-size: 11px; font-weight: 650; }
.me-field input, .me-field select, .me-field textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid #c9cec4; border-radius: 5px; background: #fffdf7; color: var(--me-ink); font: 13px/1.35 ui-sans-serif, system-ui, sans-serif; }
.me-field input, .me-field select { min-height: 35px; padding: 7px 9px; }
.me-field textarea { min-height: 52px; padding: 7px 9px; resize: vertical; }
.me-field :is(input, select, textarea):focus-visible { outline: 2px solid var(--me-teal); outline-offset: 1px; border-color: var(--me-teal); }
.me-field :disabled { background: #eeece4; color: #778179; }
.me-form > .me-field { margin-bottom: 10px; }
.me-idline { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 12px; color: var(--me-muted); font-size: 11px; }
.me-idline code { padding: 3px 6px; border: 1px solid #d8d9cc; border-radius: 4px; background: #efede4; color: #3f514c; font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.me-scope { margin: 13px 0 17px; padding: 10px 11px; border-left: 3px solid #82a99c; background: #eaf0e9; color: #365149; font-size: 11px; }
.me-scope strong { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.me-scope p { margin: 4px 0 0; }
.me-scope ul { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
.me-scope li { max-width: 100%; padding: 3px 7px; border: 1px solid #c5d3c5; border-radius: 99px; color: #3c5349; overflow-wrap: anywhere; }
.me-scope .me-muted { color: #65776d; font-style: italic; }
.me-profile { margin: 15px 0 0; padding-top: 13px; border-top: 1px solid #ded9cd; }
.me-profile-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.me-profile-heading > div { display: flex; align-items: center; gap: 8px; min-width: 0; }
.me-profile-heading h3 { margin: 0; font: 600 16px/1.2 Georgia, 'Times New Roman', serif; }
.me-profile-mark { display: grid; width: 23px; height: 23px; flex: none; place-items: center; border: 1px solid #a8c0b5; border-radius: 50%; color: var(--me-teal); font: 600 12px/1 Georgia, serif; }
.me-radio-mark { border-color: #d7b6a7; color: var(--me-clay); }
.me-profile-unit { color: var(--me-muted); font-size: 10px; font-weight: 750; letter-spacing: .08em; }
.me-explainer { margin: 7px 0 10px; color: #53625b; font-size: 11px; line-height: 1.5; }
.me-missing { margin: 9px 0; padding: 9px 10px; border: 1px dashed #c7cbbf; border-radius: 5px; color: #66736b; font-size: 11px; }
.me-band { display: grid; gap: 9px; margin: 9px 0; padding: 10px; border: 1px solid #d9d7cb; border-radius: 6px; background: #f3f1e8; }
.me-band-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #42564e; font-size: 10px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
.me-remove { border: 0; padding: 3px 0; background: transparent; color: #98513b; font: 650 10px ui-sans-serif, system-ui, sans-serif; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.me-remove:disabled { color: #9a9890; cursor: default; }
.me-add { display: flex; width: 100%; min-height: 35px; align-items: center; justify-content: center; gap: 7px; margin-top: 8px; border: 1px dashed #8eaaa0; border-radius: 5px; background: #edf2eb; color: #315f57; font: 700 11px ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.me-add span { font-size: 16px; line-height: 1; }
.me-add:disabled { opacity: .55; cursor: default; }
.me-absorption { margin: 16px 0 0; padding: 9px 10px; border: 1px solid #e0c7b8; border-radius: 5px; background: #f4eae2; color: #654a3d; font-size: 10px; line-height: 1.5; }
.me-coverage { display: grid; gap: 3px; margin: 9px 0 0; color: #53635a; font-size: 10px; overflow-wrap: anywhere; }
.me-coverage strong { color: #3d5349; }
.me-current-coverage { color: #68756c; }
.me-alert, .me-notice { margin: 13px 0 0; padding: 9px 10px; border-radius: 5px; font-size: 11px; overflow-wrap: anywhere; }
.me-alert { border-left: 3px solid var(--me-clay); background: #f3e6de; color: #673d2e; }
.me-notice { border-left: 3px solid var(--me-teal); background: #e5efea; color: #2e554e; }
.me-empty { padding: 10px; color: #66736b; }
.me-footer { position: sticky; bottom: -17px; display: grid; gap: 9px; margin: 16px -17px -17px; padding: 11px 17px 13px; border-top: 1px solid #d9d6cb; background: #fbf9f3f5; backdrop-filter: blur(10px); }
.me-frequency { color: var(--me-muted); font-size: 10px; overflow-wrap: anywhere; }
.me-apply { min-height: 39px; border: 1px solid #1f5852; border-radius: 5px; background: linear-gradient(180deg, #39766d, #28645e); color: #fffdf6; box-shadow: 0 2px 0 #1c504a; font: 700 12px ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.me-apply:disabled { border-color: #9fa9a0; background: #aeb7ae; box-shadow: none; cursor: default; }
.me-editor :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--me-teal); outline-offset: 2px; }
@media (max-width: 360px) { .me-header { padding-inline: 13px; } .me-form { padding-inline: 13px; } .me-footer { margin-inline: -13px; padding-inline: 13px; } }
@media(min-width:761px) {
  .me-form { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 20px; }
  .me-form > :not(.me-field):not(.me-profile), .me-form > .me-field:first-child { grid-column:1/-1; }
  .me-profile { align-self:start; }
}
.me-band .me-field { min-width:0; }
.me-band .me-field > span, .me-explainer, .me-scope { font-size:12px; }
.me-footer { bottom:0; }
</style>
