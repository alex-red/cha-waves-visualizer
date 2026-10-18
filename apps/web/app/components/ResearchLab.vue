<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { createSpatialPlaneCases } from '../../../../packages/test-fixtures/spatial-plane'
import { evaluatePlaneFit } from '../../../../packages/spatial-plane-evaluation'
import { fitSinglePlane, type PlaneFitResult, type SpatialPlane } from '../../../../packages/spatial-plane'
import type { SpatialInspectionReport, SpatialWorldPose } from '../../../../packages/spatial-report'
import exampleBundle from '../../../../packages/test-fixtures/spatial/bundle.json?raw'
import exampleScan from '../../../../packages/test-fixtures/spatial/echo-synthetic.json?raw'
import { inspectSpatialBrowserFiles } from '../lib/spatial-browser'

const props = defineProps<{ active: boolean; returnLabel?: string }>()
const emit = defineEmits<{ close: [] }>()
const uid = useId()
const VisualLab = defineAsyncComponent(() => import('./VisualLab.vue'))
const visualMounted = ref(false)

const section = ref<'plane' | 'replay' | 'visual'>('plane')
const cases = createSpatialPlaneCases()
const selectedCaseId = ref(cases[0]?.id ?? 'tilted-wall')
const fit = shallowRef<PlaneFitResult | null>(null)
const evaluation = shallowRef<ReturnType<typeof evaluatePlaneFit> | null>(null)
const evidenceOpen = ref(false)
const planeMessage = ref('Choose a synthetic case and run the fixed-source reference.')

const manifestFile = shallowRef<File | null>(null)
const sourceFiles = shallowRef<File[]>([])
const report = shallowRef<SpatialInspectionReport | null>(null)
const replayMessage = ref('Load the local synthetic example or choose a manifest and its source files.')
const replayError = ref('')
const importing = ref(false)
let importGeneration = 0

const selectedCase = computed(() => cases.find(item => item.id === selectedCaseId.value) ?? cases[0]!)
const eligiblePoseCount = computed(() => selectedCase.value.training.filter(item => item.arrivalCandidatesMs.length === 1).length)
const trainingEvidence = computed(() => fit.value?.outcomes.map(outcome => ({
  ...outcome,
  observation: selectedCase.value.training.find(item => item.id === outcome.id),
})) ?? [])

function runPlane(): void {
  const current = selectedCase.value
  const next = fitSinglePlane(current.training)
  fit.value = next
  evidenceOpen.value = false
  if (next.status !== 'ok') {
    evaluation.value = null
    planeMessage.value = next.message
    return
  }
  evaluation.value = evaluatePlaneFit(next, current.truth, current.heldOut)
  planeMessage.value = next.message
}

function worldPoseText(pose: SpatialWorldPose): string {
  if (pose.status === 'unknown') return `Unavailable: ${pose.reason}`
  return `${pose.positionM.map(value => value.toFixed(3)).join(', ')} m · ${pose.poseMethod} pose · ${pose.registrationMethod} registration`
}

const diagram = computed(() => {
  const currentFit = fit.value
  const plane = currentFit?.status === 'ok' ? currentFit.plane : undefined
  if (!plane) return null
  const observations = selectedCase.value.training.filter(item => item.arrivalCandidatesMs.length === 1)
  const speaker = observations[0]?.speakerPositionM
  if (!speaker) return null
  const microphones = observations.map(item => item.microphonePositionM)
  const average: [number, number, number] = [0, 0, 0]
  for (const point of microphones) {
    for (let axis = 0; axis < 3; axis += 1) average[axis] = average[axis]! + point[axis]! / microphones.length
  }
  const normal = plane.normal
  const projectedCenter = average.map((value, axis) => value + (plane.offsetM - normal[0] * average[0] - normal[1] * average[1] - normal[2] * average[2]) * normal[axis]!) as [number, number, number]
  const reference: [number, number, number] = Math.abs(normal[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0]
  const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const normalize = (v: [number, number, number]): [number, number, number] => { const length = Math.hypot(...v); return v.map(value => value / length) as [number, number, number] }
  const basisU = normalize(cross(normal, reference))
  const basisV = normalize(cross(normal, basisU))
  const radius = Math.max(1.4, ...microphones.map(point => Math.hypot(point[0] - projectedCenter[0], point[1] - projectedCenter[1], point[2] - projectedCenter[2]))) + 0.8
  const patch: [number, number, number][] = [
    [-1, -1], [1, -1], [1, 1], [-1, 1],
  ].map(([u, v]) => [
    projectedCenter[0] + radius * (u! * basisU[0] + v! * basisV[0]),
    projectedCenter[1] + radius * (u! * basisU[1] + v! * basisV[1]),
    projectedCenter[2] + radius * (u! * basisU[2] + v! * basisV[2]),
  ])
  const projectRaw = ([x, y, z]: [number, number, number]) => [0.78 * (x - y), 0.42 * (x + y) - 0.84 * z] as [number, number]
  const worldPoints = [speaker, ...microphones, ...patch]
  const projected = worldPoints.map(point => projectRaw(point as [number, number, number]))
  const minX = Math.min(...projected.map(point => point[0])), maxX = Math.max(...projected.map(point => point[0]))
  const minY = Math.min(...projected.map(point => point[1])), maxY = Math.max(...projected.map(point => point[1]))
  const scale = Math.min(500 / Math.max(0.1, maxX - minX), 265 / Math.max(0.1, maxY - minY))
  const map = (point: [number, number, number]) => {
    const [x, y] = projectRaw(point)
    return { x: 320 + (x - (minX + maxX) / 2) * scale, y: 194 + (y - (minY + maxY) / 2) * scale }
  }
  return {
    polygon: patch.map(point => map(point).x.toFixed(1) + ',' + map(point).y.toFixed(1)).join(' '),
    speaker: map(speaker),
    microphones: microphones.map((position, index) => ({ id: `M${index + 1}`, ...map(position) })),
  }
})

function chooseSection(next: 'plane' | 'replay' | 'visual'): void {
  if (next === 'visual') visualMounted.value = true
  section.value = next
}

function setManifest(event: Event): void {
  invalidatePendingImport()
  manifestFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function setSources(event: Event): void {
  invalidatePendingImport()
  sourceFiles.value = [...((event.target as HTMLInputElement).files ?? [])]
}

async function inspectFiles(manifest: File, sources: readonly File[], generation: number): Promise<void> {
  replayError.value = ''
  importing.value = true
  replayMessage.value = 'Reading selected files locally…'
  try {
    const next = await inspectSpatialBrowserFiles(manifest, sources)
    if (generation !== importGeneration || !props.active) return
    report.value = next
    replayMessage.value = `Inspection ready · ${next.sources.length} source${next.sources.length === 1 ? '' : 's'} · ${next.observations.length} observations.`
  } catch (error) {
    if (generation !== importGeneration || !props.active) return
    replayError.value = error instanceof Error ? error.message : 'Could not inspect these local files.'
    replayMessage.value = 'The new import was not installed. Any earlier report is still available.'
  } finally {
    if (generation === importGeneration) importing.value = false
  }
}

function runReplayImport(): void {
  if (!props.active || !manifestFile.value || sourceFiles.value.length === 0 || importing.value) return
  const generation = ++importGeneration
  void inspectFiles(manifestFile.value, sourceFiles.value, generation)
}

function loadExample(): void {
  if (!props.active || importing.value) return
  const generation = ++importGeneration
  const manifest = new File([exampleBundle], 'bundle.json', { type: 'application/json' })
  const source = new File([exampleScan], 'echo-synthetic.json', { type: 'application/json' })
  void inspectFiles(manifest, [source], generation)
}

function downloadReport(): void {
  if (!report.value || !props.active) return
  const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(report.value, null, 2) + '\n'], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = 'cha-spatial-inspection-report.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
}

function invalidatePendingImport(): void {
  importGeneration += 1
  importing.value = false
}

watch(() => props.active, active => { if (!active) invalidatePendingImport() })
onBeforeUnmount(invalidatePendingImport)
</script>

<template>
  <section class="research-lab" aria-labelledby="research-lab-title" data-testid="research-lab">
    <header class="research-header">
      <div>
        <p class="eyebrow">CHA WAVES / RESEARCH WORKSPACE</p>
        <h2 id="research-lab-title">Research Lab</h2>
        <p class="intro">Inspect a synthetic plane, replay linked observations, or open a visual splat bundle. Every view keeps its assumptions in the frame.</p>
      </div>
      <button class="close-button" type="button" aria-label="Close Research Lab" @click="emit('close')">×</button>
    </header>

    <div class="lab-tabs" role="group" aria-label="Research Lab section">
      <button type="button" aria-label="3D plane reference" :aria-pressed="section === 'plane'" :class="{ selected: section === 'plane' }" @click="chooseSection('plane')"><span>01</span> 3D plane reference</button>
      <button type="button" aria-label="Observation replay" :aria-pressed="section === 'replay'" :class="{ selected: section === 'replay' }" @click="chooseSection('replay')"><span>02</span> Observation replay</button>
      <button type="button" aria-label="Visual splats" :aria-pressed="section === 'visual'" :class="{ selected: section === 'visual' }" @click="chooseSection('visual')"><span>03</span> Visual splats</button>
      <p>OFFLINE · SYNTHETIC + LOCAL FILES</p>
    </div>

    <section v-if="section === 'plane'" class="plane-workspace" aria-label="Synthetic 3D plane reference">
      <div class="plane-main">
        <div class="section-heading">
          <div><p class="eyebrow">FIXED SOURCE / INFINITE PLANE</p><h3>One reflection model</h3></div>
          <span class="status-stamp">SIMULATED INPUT</span>
        </div>
        <div class="plot-meta"><span>WORLD / METRES / Z UP</span><span>Display patch · bounds are illustrative</span></div>
        <div class="plot-frame">
          <svg class="plane-plot" viewBox="0 0 640 390" role="img" aria-label="Isometric view of the fitted infinite plane display patch, fixed speaker and known microphone poses">
            <defs>
              <pattern id="plane-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="skewY(-22)">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#799276" stroke-width=".6" opacity=".42" />
              </pattern>
              <marker id="axis-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#657a67" stroke-width="1.2" /></marker>
            </defs>
            <path d="M34 334H606M34 286H606M34 238H606M34 190H606M34 142H606M34 94H606" class="plot-rule" />
            <g v-if="diagram">
              <polygon :points="diagram.polygon" fill="#a7b99b55" stroke="#52704f" stroke-width="2" />
              <polygon :points="diagram.polygon" fill="url(#plane-grid)" stroke="none" />
              <line :x1="diagram.speaker.x" :y1="diagram.speaker.y" :x2="diagram.microphones[0]?.x" :y2="diagram.microphones[0]?.y" class="guide-ray" />
              <g v-for="pose in diagram.microphones" :key="pose.id">
                <circle :cx="pose.x" :cy="pose.y" r="6" class="mic-dot" />
                <text :x="pose.x + 8" :y="pose.y - 7" class="pose-label">{{ pose.id }}</text>
              </g>
              <path :d="`M ${diagram.speaker.x} ${diagram.speaker.y - 9} L ${diagram.speaker.x + 8} ${diagram.speaker.y} L ${diagram.speaker.x} ${diagram.speaker.y + 9} L ${diagram.speaker.x - 8} ${diagram.speaker.y} Z`" class="speaker-diamond" />
              <text :x="diagram.speaker.x + 12" :y="diagram.speaker.y + 4" class="pose-label">S · fixed</text>
            </g>
            <g v-else class="plot-empty"><path d="M242 201h156M320 123v156" /><text x="320" y="310">Run a reference to plot the supplied poses</text></g>
            <g class="axes" aria-hidden="true">
              <line x1="60" y1="320" x2="104" y2="344" marker-end="url(#axis-arrow)" />
              <line x1="60" y1="320" x2="16" y2="344" marker-end="url(#axis-arrow)" />
              <line x1="60" y1="320" x2="60" y2="272" marker-end="url(#axis-arrow)" />
              <text x="108" y="350">+X</text><text x="5" y="357">+Y</text><text x="66" y="275">+Z</text>
            </g>
            <g class="plot-legend"><circle cx="424" cy="359" r="5" class="speaker-diamond" /><text x="435" y="363">fixed speaker</text><circle cx="523" cy="359" r="5" class="mic-dot" /><text x="534" y="363">known mic</text></g>
          </svg>
        </div>
        <div class="plot-caption"><span>Patch size is a viewing aid only.</span><span>It does not represent recovered wall extents.</span></div>
      </div>

      <aside class="plane-controls">
        <p class="eyebrow">REFERENCE CASE</p>
        <label :for="`${uid}-plane-case`">Plane orientation</label>
        <select :id="`${uid}-plane-case`" v-model="selectedCaseId" data-testid="research-case" @change="fit = null; evaluation = null; evidenceOpen = false; planeMessage = 'Choose a synthetic case and run the fixed-source reference.'">
          <option v-for="item in cases" :key="item.id" :value="item.id">{{ item.id === 'tilted-wall' ? 'Tilted wall' : item.id === 'floor' ? 'Floor plane' : 'Ceiling plane' }}</option>
        </select>
        <div class="case-facts">
          <div><span>source</span><strong>one fixed speaker</strong></div>
          <div><span>poses</span><strong>{{ eligiblePoseCount }} supplied mic poses</strong></div>
          <div><span>surface</span><strong>infinite specular plane</strong></div>
        </div>
        <p class="model-note">Synthetic delays use separated speaker and microphone coordinates. Missing and multiple-candidate attempts stay visible; the solver never picks a candidate to improve the fit.</p>
        <button class="primary-button" type="button" data-testid="research-run-plane" @click="runPlane">Run synthetic reference <span aria-hidden="true">↗</span></button>
        <div class="plane-status" role="status" data-testid="research-plane-status">
          <span class="status-kicker">{{ fit?.status === 'ok' ? 'FIT SCREEN PASSED' : fit?.status === 'no-solution' ? 'NO ACCEPTED FIT' : fit?.status === 'insufficient-data' ? 'POSE DIVERSITY REQUIRED' : fit?.status === 'unsupported-source-motion' ? 'SOURCE MODEL UNSUPPORTED' : 'MODEL STATUS' }}</span>
          <strong>{{ fit?.status === 'ok' ? 'Numerical plane available' : 'Synthetic reference only' }}</strong>
          <p>{{ planeMessage }}</p>
          <template v-if="fit?.status === 'ok'">
            <dl class="metric-list">
              <div><dt>held-out timing RMS</dt><dd>{{ evaluation?.heldOut.rmsResidualMs?.toFixed(4) ?? '—' }} ms</dd></div>
              <div><dt>normal error</dt><dd>{{ evaluation?.normalAngleErrorDeg?.toFixed(3) ?? '—' }}°</dd></div>
              <div><dt>offset error</dt><dd>{{ evaluation?.absoluteOffsetErrorM?.toFixed(4) ?? '—' }} m</dd></div>
            </dl>
            <p class="synthetic-disclaimer">Fit and held-out scores measure this synthetic example, not physical accuracy.</p>
          </template>
        </div>
        <button v-if="fit?.status === 'ok'" class="outline-button" type="button" :aria-expanded="evidenceOpen" data-testid="research-surface" @click="evidenceOpen = !evidenceOpen">{{ evidenceOpen ? 'Hide fitted plane evidence' : 'Inspect fitted plane' }}</button>
        <section v-if="evidenceOpen && fit?.status === 'ok'" class="evidence-card" aria-label="Fitted plane and training evidence" data-testid="research-evidence">
          <h4>Fitted plane in world frame</h4>
          <p>normal [{{ fit.plane!.normal.map(value => value.toFixed(5)).join(', ') }}]</p>
          <p>offset {{ fit.plane!.offsetM.toFixed(5) }} m · image source [{{ fit.imageSourceM!.map(value => value.toFixed(4)).join(', ') }}] m</p>
          <h4>Training attempts</h4>
          <ul class="attempt-list" data-testid="research-observation-list" tabindex="0" aria-label="Training attempts and supplied poses">
            <li v-for="outcome in trainingEvidence" :key="outcome.id">
              <div><span>{{ outcome.id }}</span><b :class="`attempt-${outcome.status}`">{{ outcome.status }}</b></div>
              <small v-if="outcome.observation">speaker [{{ outcome.observation.speakerPositionM.map(value => value.toFixed(3)).join(', ') }}] · mic [{{ outcome.observation.microphonePositionM.map(value => value.toFixed(3)).join(', ') }}] m</small>
            </li>
          </ul>
          <h4>Supplied poses</h4>
          <p>Fixed speaker [{{ selectedCase.training[0]?.speakerPositionM.map(value => value.toFixed(3)).join(', ') }}] m.</p>
          <p>Microphone positions are supplied per attempt; missing and ambiguous attempts are listed above and excluded from fitting.</p>
        </section>
        <p class="reference-boundary">This reference does not map a moving phone, finite room, arbitrary surfaces, or real acoustic evidence.</p>
      </aside>
    </section>

    <section v-else-if="section === 'replay'" class="replay-workspace" aria-label="Local observation replay">
      <header class="replay-heading">
        <div><p class="eyebrow">HASH-LINKED / READ-ONLY REPLAY</p><h3>Inspect the observations</h3></div>
        <span class="status-stamp">ON THIS DEVICE</span>
      </header>
      <p class="replay-intro">Choose a bundle manifest and its Echo scan files. Inspection stays in this browser; source files are read locally, checked against their hashes, and never sent or saved by this workspace.</p>
      <div class="replay-actions">
        <button class="secondary-button" type="button" data-testid="research-load-example" :disabled="importing" @click="loadExample">{{ importing ? 'Reading files…' : 'Load synthetic example' }} <span aria-hidden="true">↗</span></button>
        <span class="source-note">The example contains synthetic arrivals, supplied registration, and one explicitly unknown frame.</span>
      </div>
      <div class="file-pickers">
        <label :for="`${uid}-manifest`">Bundle manifest <small>{{ manifestFile?.name ?? 'Choose a local JSON file' }}</small></label>
        <input :id="`${uid}-manifest`" type="file" accept="application/json,.json" data-testid="research-bundle-import" @change="setManifest">
        <label :for="`${uid}-sources`">Echo scan source files <small>{{ sourceFiles.length ? sourceFiles.map(file => file.name).join(', ') : 'Choose all files named by the bundle' }}</small></label>
        <input :id="`${uid}-sources`" type="file" accept="application/json,.json" multiple data-testid="research-sources-import" @change="setSources">
        <button class="primary-button import-button" type="button" data-testid="research-import-run" :disabled="importing || !manifestFile || !sourceFiles.length" @click="runReplayImport">{{ importing ? 'Inspecting locally…' : 'Inspect selected files' }} <span aria-hidden="true">↗</span></button>
      </div>
      <div class="replay-status" :class="{ error: replayError }" role="status" data-testid="research-replay-status">
        <span>{{ replayError ? 'IMPORT NOT INSTALLED' : report ? 'REPORT READY' : 'LOCAL REPLAY' }}</span>
        <strong>{{ replayError || replayMessage }}</strong>
      </div>

      <template v-if="report">
        <div class="report-toolbar">
          <div><span class="eyebrow">MANIFEST SHA256</span><code>{{ report.manifest.sha256 }}</code></div>
          <button class="outline-button" type="button" data-testid="research-download-report" @click="downloadReport">Download JSON report</button>
        </div>
        <section class="report-sources" aria-labelledby="replay-sources-title">
          <h4 id="replay-sources-title">Sources <span>{{ report.sources.length }}</span></h4>
          <article v-for="source in report.sources" :key="source.id" class="source-card">
            <div><strong>{{ source.id }}</strong><span class="origin-chip" :class="source.mode">{{ source.mode }} source</span></div>
            <p>{{ source.scanFormat }} · {{ source.captureCount }} captures · {{ source.byteLength }} bytes</p>
            <code>{{ source.sha256 }}</code>
            <p v-for="notice in source.notices" :key="notice" class="source-notice">{{ notice }}</p>
          </article>
        </section>
        <section class="report-observations" aria-labelledby="replay-observations-title">
          <h4 id="replay-observations-title">Observations <span>{{ report.observations.length }}</span></h4>
          <div data-testid="research-observation-list" class="observation-list">
            <article v-for="observation in report.observations" :key="observation.id" class="observation-card">
              <header><div><span class="eyebrow">{{ observation.sourceId }} / {{ observation.captureRef.kind }}</span><h5>{{ observation.id }}</h5></div><span class="origin-chip" :class="observation.measurement.mode">{{ observation.measurement.mode }}</span></header>
              <p class="observation-source">{{ observation.measurement.mode === 'synthetic' ? 'Synthetic model input' : 'Recorded capture input' }} · capture {{ observation.captureRef.kind === 'recorded' ? observation.captureRef.captureId : `index ${observation.captureRef.index}` }}</p>
              <div class="pose-grid">
                <div><span>Speaker world pose</span><strong>{{ worldPoseText(observation.speaker.world) }}</strong><small v-if="observation.speaker.input.status === 'known'">{{ observation.speaker.input.method }} pose supplied in {{ observation.speaker.input.frameId }}</small></div>
                <div><span>Microphone world pose</span><strong>{{ worldPoseText(observation.microphone.world) }}</strong><small v-if="observation.microphone.input.status === 'known'">{{ observation.microphone.input.method }} pose supplied in {{ observation.microphone.input.frameId }}</small></div>
              </div>
              <p class="xy-note">Original X/Y plan position: {{ observation.originalPositionXYM.xM.toFixed(3) }}, {{ observation.originalPositionXYM.yM.toFixed(3) }} m · this does not add missing 3D calibration.</p>
              <p class="time-note">Time: {{ observation.time.status === 'known' ? `${observation.time.timeMs} ms · ${observation.time.method} in clock ${observation.time.clockId}; not an acoustic emission time` : `Unavailable · ${observation.time.reason}` }}</p>
            </article>
          </div>
        </section>
        <p class="no-evidence-claim">Replay verifies file links and reports supplied observations. It does not identify a wall, reconstruct a room, or promote unknown poses.</p>
      </template>
    </section>

    <VisualLab v-if="visualMounted" v-show="section === 'visual'" :active="props.active && section === 'visual'" />
    <footer class="lab-footer"><span>RESEARCH BOUNDARY</span><p>Plane geometry is synthetic; replay preserves supplied and unknown registration. Visual assets remain separate from acoustic evidence. Rendering appearance does not validate physical geometry.</p><button type="button" class="return-button" :aria-label="props.returnLabel ?? 'Field visualizer'" @click="emit('close')">{{ props.returnLabel ?? 'Field visualizer' }} <span aria-hidden="true">↗</span></button></footer>
  </section>
</template>

<style scoped>
.research-lab{--paper:#f8f6ee;--paper-deep:#efeee3;--ink:#263c35;--muted:#5c685e;--line:#d1d7c9;--green:#315641;--green-soft:#dfe8d8;--rust:#a95837;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif;text-align:left}
.research-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:31px 34px 24px;background:radial-gradient(ellipse at 88% 18%,#dce7d780,transparent 52%),var(--paper-deep);border-bottom:1px solid var(--line)}
.eyebrow{margin:0;color:#596c5c;font:9px/1.5 ui-monospace,SFMono-Regular,monospace;letter-spacing:1.25px;text-transform:uppercase}
.research-header h2{margin:10px 0 7px;font:400 clamp(30px,4vw,43px)/1.07 Georgia,serif;letter-spacing:-1.15px}
.intro{max-width:700px;margin:0;color:var(--muted);font-size:12px;line-height:1.65}
.close-button{flex:none;width:37px;height:37px;border:1px solid #bdc8b8;border-radius:50%;background:#fffdf6;color:var(--green);font-size:23px;cursor:pointer}
.lab-tabs{display:flex;align-items:center;gap:0;padding:0 34px;border-bottom:1px solid var(--line);background:#f4f2e9}
.lab-tabs button{min-height:55px;margin-right:23px;padding:0 4px;border:0;border-bottom:2px solid transparent;background:transparent;color:#58665b;font:600 12px ui-sans-serif,system-ui;cursor:pointer}
.lab-tabs button span{margin-right:9px;color:#875b42;font:9px ui-monospace,monospace}
.lab-tabs button.selected{border-bottom-color:var(--rust);color:#294d3a}
.lab-tabs p{margin:0 0 0 auto;color:#805842;font:8px ui-monospace,monospace;letter-spacing:1px}
.plane-workspace{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(290px,.8fr);min-height:540px}
.plane-main{min-width:0;padding:24px 26px 19px;border-right:1px solid var(--line);background:linear-gradient(145deg,#edf1e7,#e5eadf 66%,#f0efe6)}
.section-heading,.replay-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}
.section-heading h3,.replay-heading h3{margin:5px 0 0;font:400 24px/1.1 Georgia,serif;letter-spacing:-.45px}
.status-stamp{flex:none;padding:6px 8px;border:1px solid #bdc9b5;border-radius:2px;color:#4e694e;font:8px ui-monospace,monospace;letter-spacing:.8px}
.plot-meta{display:flex;justify-content:space-between;gap:12px;margin-top:23px;padding:0 4px 7px;color:#60705f;font:8px ui-monospace,monospace;letter-spacing:.7px}
.plot-frame{border:1px solid #c9d2c3;background-color:#e6ecdf;background-image:linear-gradient(#f8f8ee80,#f8f8ee80),repeating-linear-gradient(0deg,transparent 0 23px,#9bb09538 24px),repeating-linear-gradient(90deg,transparent 0 23px,#9bb09538 24px);box-shadow:inset 0 0 28px #526a4820}
.plane-plot{display:block;width:100%;height:auto;min-height:320px}
.plot-rule{stroke:#94a68d;stroke-width:.6;opacity:.35}
.guide-ray{stroke:#9c6747;stroke-width:1;stroke-dasharray:4 5;opacity:.72}
.mic-dot{fill:#315c44;stroke:#f8f6ee;stroke-width:2}
.speaker-diamond{fill:#b35d37;stroke:#fff8e9;stroke-width:1.5}
.pose-label{fill:#385946;font:9px ui-monospace,monospace}
.axes line{stroke:#657a67;stroke-width:1.4}.axes text,.plot-legend text{fill:#526752;font:9px ui-monospace,monospace}
.plot-empty{stroke:#95a58f;stroke-width:1;fill:none}.plot-empty text{fill:#68786a;stroke:none;text-anchor:middle;font:italic 15px Georgia,serif}
.plot-caption{display:flex;justify-content:space-between;gap:10px;margin-top:9px;color:#667265;font:9px/1.5 ui-monospace,monospace}
.plane-controls{padding:25px 25px 28px;background:#fbf9f2}
.plane-controls>label{display:block;margin:17px 0 6px;color:#526553;font-size:10px;font-weight:650}
.plane-controls select{width:100%;min-height:38px;padding:8px 10px;border:1px solid #bbc7b4;border-radius:3px;background:#fffdf6;color:#2e4d3b;font:12px ui-sans-serif,system-ui}
.case-facts{display:grid;grid-template-columns:1fr;gap:0;margin:16px 0;border-top:1px solid #d9dece;border-bottom:1px solid #d9dece}
.case-facts div{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #e2e4d9}.case-facts div:last-child{border:0}
.case-facts span{color:#596c5c;font:9px ui-monospace,monospace;text-transform:uppercase}.case-facts strong{color:#385744;font-size:10px;font-weight:600}
.model-note,.reference-boundary{color:#59685d;font-size:10px;line-height:1.7}
.primary-button,.secondary-button,.outline-button{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:39px;padding:9px 12px;border:1px solid var(--green);border-radius:3px;background:var(--green);color:#fff9ec;font:600 11px ui-sans-serif,system-ui;cursor:pointer;text-align:left}
.primary-button:hover,.secondary-button:hover{background:#234835}.primary-button:disabled,.secondary-button:disabled{opacity:.55;cursor:not-allowed}
.outline-button{justify-content:center;background:transparent;color:#385844;border-color:#9dab98}.outline-button:hover{background:#e9eee3}
.plane-controls>.primary-button,.plane-controls>.outline-button{width:100%;margin-top:13px}
.plane-status{margin-top:16px;padding:12px;border:1px solid #d0d9c7;background:#eef1e7}
.status-kicker{display:block;color:#79533d;font:8px ui-monospace,monospace;letter-spacing:.9px}.plane-status>strong{display:block;margin:6px 0;color:#2d4c39;font:400 17px Georgia,serif}.plane-status>p{margin:0;color:#5a675d;font-size:10px;line-height:1.6}
.metric-list{margin:10px 0 0}.metric-list div{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid #dbe0d4}.metric-list dt{color:#5b695c;font:9px ui-monospace,monospace}.metric-list dd{margin:0;color:#304f3b;font:10px ui-monospace,monospace}
.plane-status .synthetic-disclaimer{margin-top:8px;color:#795943;font-size:9px}
.evidence-card{margin-top:12px;padding:13px;border:1px solid #c9d3c1;background:#f3f3e9}.evidence-card h4,.report-sources h4,.report-observations h4{margin:0 0 7px;color:#385741;font:400 17px Georgia,serif}.evidence-card h4:not(:first-child){margin-top:14px}.evidence-card p{margin:5px 0;color:#5b685d;font:9px/1.65 ui-monospace,monospace;overflow-wrap:anywhere}
.attempt-list{max-height:240px;overflow:auto;margin:7px 0 0;padding:0;list-style:none}.attempt-list li{display:grid;gap:4px;padding:7px 0;border-top:1px solid #e0e3d8;color:#59685a;font:9px ui-monospace,monospace}.attempt-list li>div{display:flex;justify-content:space-between;gap:10px}.attempt-list li>small{color:#68756a;font:8px/1.45 ui-monospace,monospace}.attempt-list b{font-weight:650}.attempt-eligible{color:#2d7046}.attempt-missing{color:#8a6342}.attempt-ambiguous{color:#9a5638}
.reference-boundary{margin:15px 0 0;color:#776149;font-size:9px}
.replay-workspace{padding:27px 34px 32px;background:#f8f6ee}
.replay-heading{margin-bottom:9px}.replay-intro{max-width:820px;margin:0 0 16px;color:#5b695e;font-size:11px;line-height:1.7}
.replay-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px;background:#edf0e6;border:1px solid #d4dccb}.secondary-button{min-width:215px;background:#fffdf6;color:#355740;border-color:#aab8a4}.secondary-button:hover{background:#e9eee3;color:#2e503c}.source-note{max-width:500px;color:#53644f;font-size:9px;line-height:1.55}
.file-pickers{display:grid;grid-template-columns:minmax(150px,.65fr) minmax(200px,1fr);align-items:center;gap:10px 16px;margin-top:17px;padding:14px 0;border-top:1px solid #d8ddcf;border-bottom:1px solid #d8ddcf}
.file-pickers label{display:grid;gap:4px;color:#395740;font-size:10px;font-weight:650}.file-pickers label small{color:#596c5c;font-size:9px;font-weight:400;overflow-wrap:anywhere}.file-pickers input{max-width:100%;color:#5a685d;font-size:10px}.import-button{grid-column:2;justify-self:start;min-width:190px}
.replay-status{display:grid;gap:5px;margin:15px 0;padding:12px 14px;border-left:3px solid #718664;background:#edf1e6;color:#35533d}.replay-status>span{font:8px ui-monospace,monospace;letter-spacing:.9px}.replay-status>strong{font-size:10px;font-weight:550;line-height:1.55}.replay-status.error{border-color:#ad6845;background:#f4e9dd;color:#774a32}
.report-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 0;border-top:1px solid #d4dacd}.report-toolbar>div{display:grid;gap:6px;min-width:0}.report-toolbar code,.source-card code{color:#526452;font:9px ui-monospace,monospace;overflow-wrap:anywhere}.report-toolbar .outline-button{flex:none}
.report-sources,.report-observations{margin-top:18px}.report-sources h4,.report-observations h4{display:flex;align-items:center;gap:9px}.report-sources h4 span,.report-observations h4 span{color:#7a6047;font:9px ui-monospace,monospace}
.source-card{padding:12px 13px;border:1px solid #d6dccf;border-left:3px solid #6b8461;background:#fdfbf4}.source-card+.source-card{margin-top:8px}.source-card>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.source-card strong{color:#355540;font:12px ui-monospace,monospace}.origin-chip{display:inline-flex;padding:4px 6px;border-radius:2px;background:#e8e9dc;color:#5a684f;font:8px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.5px}.origin-chip.synthetic{background:#f0e2d3;color:#825436}.origin-chip.recorded{background:#dce9dc;color:#386246}.source-card p{margin:5px 0;color:#657064;font-size:9px;line-height:1.5}.source-card .source-notice{color:#846248}
.observation-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.observation-card{min-width:0;padding:13px;border:1px solid #d3dacd;background:#fdfbf5}.observation-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.observation-card h5{margin:4px 0 0;color:#2e4d38;font:400 17px Georgia,serif;overflow-wrap:anywhere}.observation-source,.xy-note,.time-note{color:#5e6b60;font-size:9px;line-height:1.6}.pose-grid{display:grid;gap:7px;margin-top:10px}.pose-grid>div{display:grid;gap:4px;padding-top:8px;border-top:1px solid #e1e4d9}.pose-grid span{color:#7c5b42;font:8px ui-monospace,monospace;letter-spacing:.7px;text-transform:uppercase}.pose-grid strong{color:#385740;font-size:10px;font-weight:600;line-height:1.5;overflow-wrap:anywhere}.pose-grid small{color:#68756a;font-size:9px;line-height:1.45}.xy-note{padding-top:8px;border-top:1px solid #e1e4d9}.time-note{margin-bottom:0;color:#7a5e43}.no-evidence-claim{margin:18px 0 0;padding:12px;border:1px solid #d8d8c6;background:#f0efe4;color:#705a42;font-size:10px;line-height:1.6}
.lab-footer{display:flex;align-items:center;gap:17px;padding:17px 34px;border-top:1px solid #d0d8c9;background:#f0efe5}.lab-footer>span{flex:none;color:#81573d;font:8px ui-monospace,monospace;letter-spacing:1px}.lab-footer p{flex:1;margin:0;color:#59665a;font-size:9px;line-height:1.6}.return-button{flex:none;border:0;background:transparent;color:#315b43;font-size:10px;font-weight:650;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
button:focus-visible,select:focus-visible,input:focus-visible,.attempt-list:focus-visible{outline:2px solid #2d7770;outline-offset:3px}
@media(max-width:820px){.plane-workspace{grid-template-columns:1fr}.plane-main{border-right:0;border-bottom:1px solid var(--line)}.plane-controls{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.plane-controls>.eyebrow,.plane-controls>label,.plane-controls>select,.case-facts,.model-note,.plane-controls>.primary-button,.plane-status,.plane-controls>.outline-button,.evidence-card,.reference-boundary{grid-column:1/-1}.plane-controls>.eyebrow{margin-bottom:0}.plane-controls>label{margin-top:12px}.case-facts{grid-template-columns:repeat(3,1fr);gap:8px;margin:13px 0}.case-facts div{display:grid;align-content:center;gap:5px;border-bottom:0;border-right:1px solid #e2e4d9}.case-facts div:last-child{border:0}.model-note{margin:0 0 8px}}
@media(max-width:620px){.research-header{padding:23px 19px 19px}.research-header h2{font-size:31px}.lab-tabs{padding:0 17px;flex-wrap:wrap}.lab-tabs button{margin-right:13px;font-size:10px}.lab-tabs p{display:none}.plane-main{padding:19px 14px 15px}.plane-controls{padding:20px 18px}.plane-plot{min-height:260px}.plot-meta,.plot-caption{font-size:7px}.replay-workspace{padding:22px 18px 25px}.file-pickers{grid-template-columns:1fr;gap:6px}.file-pickers input{margin-bottom:9px}.import-button{grid-column:1}.observation-list{grid-template-columns:1fr}.report-toolbar{align-items:flex-start;flex-direction:column}.lab-footer{display:grid;grid-template-columns:1fr auto;padding:16px 18px;gap:8px}.lab-footer p{grid-column:1/-1;grid-row:2}.return-button{grid-column:2;grid-row:1}.replay-heading h3{font-size:22px}.status-stamp{font-size:7px}}
@media(max-width:380px){.section-heading{align-items:flex-start;flex-direction:column}.plane-controls{padding:18px 14px}.case-facts{grid-template-columns:1fr}.case-facts div{display:flex;border-right:0;border-bottom:1px solid #e2e4d9}.plot-meta{display:grid}.lab-tabs button{min-height:48px;margin-right:8px}.lab-tabs button span{margin-right:3px}}
</style>
