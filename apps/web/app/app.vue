<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { createDemoScene, defaultSettings, evaluatePoint, isExteriorEnvelopeWall, type PointResult, type Scene, type SolverSettings } from '../../../packages/engine'
import { applySceneCommand } from '../../../packages/commands'
import { FIELD_PAPER_HEX, FIELD_SCALES, fieldCssColor } from '../../../packages/field-display'
import { buildLossBreakdown, type LossTerm } from '../../../packages/loss-breakdown'
import { createProject, type ProjectDocument, type ProjectExperiment, type FloorPlanReference } from '../../../packages/project'
import { loadProject, listProjects } from './lib/project-storage'
import { compareCompatibility } from '../../../packages/comparison'
import { HOME_SCENARIOS, type HomeScenario, type HomeScenarioIntervention } from '../../../packages/scenarios'
import HomeBuilder from './components/HomeBuilder.vue'
import SceneEditor from './components/SceneEditor.vue'
import ProbeReadings from './components/ProbeReadings.vue'
import LossBreakdown from './components/LossBreakdown.vue'
import PlanNavigation from './components/PlanNavigation.vue'
import ScenarioComparison from './components/ScenarioComparison.vue'
import ExperimentLibrary from './components/ExperimentLibrary.vue'
import PlacementExplorer from './components/PlacementExplorer.vue'
import type { PlacementCandidate } from '../../../packages/placement'
import { availableMaterialFrequencies, materialFrequencyCoverage } from '../../../packages/materials'
import MaterialEditor from './components/MaterialEditor.vue'
import SurveyPanel from './components/SurveyPanel.vue'
import { compareSurvey, exportSurveyCsv, exportSurveyTemplate, type RfSurvey } from '../../../packages/survey'
import { clone } from './lib/clone'
import { createPlanTransform, fitPlanView, panPlanView, zoomPlanView, type PlanView } from './lib/plan-viewport'
import type { BaselineState, HistoryContext, SceneDrag } from './lib/workspace-types'
import { useSceneHistory } from './composables/useSceneHistory'
import { useFieldJobs } from './composables/useFieldJobs'
import { useProjectWorkspace, type ProjectSource } from './composables/useProjectWorkspace'
import { useExperiments } from './composables/useExperiments'
import { usePlacementSearch } from './composables/usePlacementSearch'
import { useMaterialEditing } from './composables/useMaterialEditing'
import { useSurvey } from './composables/useSurvey'
import OfflineWorkspace from './components/OfflineWorkspace.vue'
import { useOfflineWorkspace } from './composables/useOfflineWorkspace'

useHead({ title: 'Cha Waves | Home field study', htmlAttrs: { lang: 'en' } })

type Point = [number, number]
type EmitterItem = Scene['emitters'][number]
type ProbeItem = Scene['probes'][number]
type SceneItem = EmitterItem | ProbeItem

const scene = shallowRef<Scene>(createDemoScene())
const previewScene = shallowRef<Scene | null>(null)
const shownScene = computed(() => previewScene.value ?? scene.value)
const BuildingCutaway = defineAsyncComponent(() => import('./components/BuildingCutaway.vue'))
const settings = shallowRef<SolverSettings>(defaultSettings('acoustics'))
const domain = ref<'sound' | 'wifi'>('sound')
const selectedTool = ref<'select' | 'source' | 'probe'>('select')
const selectedId = ref('hallway-probe')
const selectedDoorId = ref('hall-door')
const exact = ref<PointResult | null>(null)
const selectedLossTermId = ref('')
const lossBudget = computed(() => buildLossBreakdown(shownScene.value, settings.value, exact.value))
const highlightedLossTerm = computed(() => lossBudget.value.terms.find(term => term.id === selectedLossTermId.value && term.crossing) ?? null)
const editError = ref('')
const probeHeightDraft = ref<string | number>('1.5')
const sourceHeightDraft = ref<string | number>('1.2')
const probePositionDraft = ref<{ x: string | number; y: string | number }>({ x: '', y: '' })
const sourcePositionDraft = ref<{ x: string | number; y: string | number }>({ x: '', y: '' })
const canvas = ref<HTMLCanvasElement | null>(null)
const planPixelsPerMeter = ref(0)
const planView = shallowRef<PlanView | null>(null)
const panMode = ref(false)
const spacePan = ref(false)
const planPan = shallowRef<{ pointerId: number; start: Point; original: PlanView } | null>(null)
let planFrame: number | undefined
const inspector = ref<HTMLElement | null>(null)
const drag = ref<SceneDrag | null>(null)
const methodDialog = ref<HTMLDialogElement | null>(null)
const methodTrigger = ref<HTMLButtonElement | null>(null)
const guidedDialog = ref<HTMLDialogElement | null>(null)
const guidedTrigger = ref<HTMLButtonElement | null>(null)
const selectedScenarioId = ref(HOME_SCENARIOS[0]?.id ?? '')
const loadedInterventionId = ref('')
const showLayers = ref(false)
const compare = ref(false)
const splitComparison = ref(false)
const baseline = shallowRef<BaselineState>(null)
const experiments = shallowRef<readonly ProjectExperiment[]>([])
const baselineExperimentId = ref<string | null>(null)
const survey = shallowRef<RfSurvey | null>(null)
const selectedObjectId = ref('hallway-probe')
const projectStatus = ref<'loading' | 'saved' | 'saving' | 'failed'>('loading')
const projectNotice = ref('')
const storageNotice = ref('')
const rendererNotice = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const projectDoc = shallowRef<ProjectDocument | null>(null)
const projectName = ref('Morning light, 02')
const referenceImage = shallowRef<FloorPlanReference | undefined>()
const showReference = ref(true)
let referenceBitmap: HTMLImageElement | null = null
const homeDialog = ref<HTMLDialogElement | null>(null)
const editorDialog = ref<HTMLDialogElement | null>(null)
const libraryDialog = ref<HTMLDialogElement | null>(null)
const experimentsDialog = ref<HTMLDialogElement | null>(null)
const readingsDialog = ref<HTMLDialogElement | null>(null)
const readingsOpen = ref(false)
const placementDialog = ref<HTMLDialogElement | null>(null)
const placementOpen = ref(false)
const materialsDialog = ref<HTMLDialogElement | null>(null)
const materialsOpen = ref(false)
const surveyDialog = ref<HTMLDialogElement | null>(null)
const surveyOpen = ref(false)
let locateReadingAfterClose = false
function openReadings(event: Event) { readingsOpen.value = true; openWorkspaceDialog(readingsDialog.value, event) }
function closeReadings() {
  readingsOpen.value = false
  if (locateReadingAfterClose) { locateReadingAfterClose = false; focusPlanForKeyboard() }
  else closeWorkspaceDialog()
}
const readingsBaseline = computed(() => baseline.value ? { scene: baseline.value.scene, settings: baseline.value.settings } : undefined)
function selectReadingProbe(id: string) {
  selectSceneObject(id)
  locateReadingAfterClose = true
  readingsDialog.value?.close()
}
const savedHomes = ref<{ id: string; name: string; updatedAt: string }[]>([])
const libraryError = ref('')
const workspaceBusy = ref(false)
let workspaceTrigger: HTMLButtonElement | null = null
function openWorkspaceDialog(dialog: HTMLDialogElement | null, event: Event) {
  projectNotice.value = ''
  workspaceTrigger = event.currentTarget as HTMLButtonElement
  openDialog(dialog, workspaceTrigger)
}
function closeWorkspaceDialog() { workspaceTrigger?.focus() }
async function createHome(payload: { scene: Scene; name: string; referenceImage?: FloorPlanReference }) {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  try {
    await preserveCurrentProject()
    const doc = createProject(payload.scene, defaultSettings('acoustics'), undefined, payload.referenceImage)
    installWorkspace({ ...doc, metadata: { ...doc.metadata, name: payload.name } })
    homeDialog.value?.close()
  } catch (error) { projectNotice.value = error instanceof Error ? error.message : 'Could not create home' } finally { workspaceBusy.value = false }
}
async function openLibrary(event: Event) {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  openWorkspaceDialog(libraryDialog.value, event); libraryError.value = ''
  try { await preserveCurrentProject(); savedHomes.value = await listProjects() }
  catch (error) { libraryError.value = error instanceof Error ? error.message : 'Could not read local projects' } finally { workspaceBusy.value = false }
}
async function openSavedHome(id: string) {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  try { await preserveCurrentProject(); const doc = await loadProject(id); if (!doc) throw new Error('Saved home could not be found'); installWorkspace(doc); libraryDialog.value?.close() }
  catch (error) { libraryError.value = error instanceof Error ? error.message : 'Could not open home' } finally { workspaceBusy.value = false }
}

const viewMode = ref<'plan' | 'cutaway'>('plan')
const cutawayAvailable = ref(true)
const cutawayBackend = ref<'pending' | 'webgpu' | 'webgl'>('pending')
const renderBackend = computed(() => viewMode.value === 'plan' ? '2D plan canvas' : cutawayBackend.value === 'pending' ? 'Cutaway starting' : cutawayBackend.value === 'webgpu' ? 'WebGPU' : 'WebGL 2 fallback')
const projectFlowGeneration = ref(0)
const appMounted = ref(false)
const wallDraft = ref({ startX: 0, startY: 0, endX: 0, endY: 0, thicknessM: .12 })

const fixedReceiverHeightAboveFloor = 1.5
const sceneHistory = useSceneHistory(scene, {
  restoreContext: restoreHistoryContext,
  onRestore: () => { loadedInterventionId.value = ''; requestField() },
})
const { undoStack, redoStack, undo, redo } = sceneHistory
const fieldJobs = useFieldJobs({
  scene, settings, baseline, previewScene, drag, canvas, fixedReceiverHeightAboveFloor, inspectProbe, draw,
})
const {
  field, previewField, acceptedQuality, lastComputeMs, lastRequestToPaintMs, previewVersion,
  busy, workerError, requestId, createFieldWorker, requestField, restartFieldWorker, schedulePreview, clearScheduledPreview, cancelWorkingJobs,
} = fieldJobs
const projectWorkspace = useProjectWorkspace({
  scene, settings, baseline, referenceImage, experiments, baselineExperimentId, survey, projectName, projectDoc, projectStatus, projectNotice, storageNotice,
  projectFlowGeneration, appMounted, drag, previewScene, onInstall: installScene,
})
const {
  preserveCurrentProject, installDocument: installWorkspace, restoreProject, importProjectFile, exportProjectFile,
} = projectWorkspace
const experimentsDisabled = computed(() => projectStatus.value === 'loading' || !!drag.value || !!previewScene.value || workspaceBusy.value)
const offlineWorkspace = useOfflineWorkspace()
const offlineActionError = ref('')
const offlineState = computed(() => ({
  supported: offlineWorkspace.supported.value, enabled: offlineWorkspace.enabled.value, busy: offlineWorkspace.busy.value,
  ready: offlineWorkspace.ready.value, online: offlineWorkspace.online.value, updateReady: offlineWorkspace.updateReady.value,
  notice: offlineWorkspace.notice.value, error: offlineWorkspace.error.value, version: offlineWorkspace.version.value,
  assetCount: offlineWorkspace.assetCount.value, totalBytes: offlineWorkspace.totalBytes.value,
  persistenceState: offlineWorkspace.persistenceState.value, usageBytes: offlineWorkspace.usageBytes.value, quotaBytes: offlineWorkspace.quotaBytes.value,
}))
async function reloadOfflineUpdate() {
  if (experimentsDisabled.value || offlineWorkspace.busy.value) return
  offlineActionError.value = ''; workspaceBusy.value = true
  try {
    await preserveCurrentProject()
    if (await offlineWorkspace.applyUpdate()) window.location.reload()
  } catch {
    offlineActionError.value = 'This home could not be saved. Close Homes and export a JSON backup before reloading.'
  } finally { workspaceBusy.value = false }
}
const surveyWorkspace = useSurvey({
  survey, disabled: experimentsDisabled, currentDocument: projectWorkspace.currentDocument,
  commit: action => {
    const previousScene = clone(scene.value), before = captureHistoryContext()
    action()
    sceneHistory.record(previousScene, { before, after: captureHistoryContext() })
  },
})
const { error: surveyError, notice: surveyNotice } = surveyWorkspace
const surveyComparison = computed(() => surveyOpen.value && survey.value ? compareSurvey(scene.value, settings.value, survey.value) : null)
function openSurvey(event: Event) { surveyWorkspace.reset(); surveyOpen.value = true; openWorkspaceDialog(surveyDialog.value, event) }
function closeSurvey() { surveyOpen.value = false; surveyWorkspace.reset(); closeWorkspaceDialog() }
function downloadSurvey(template = false) {
  if (experimentsDisabled.value) return
  surveyWorkspace.reset()
  try {
    if (!template && !survey.value) throw new Error('Import observations before exporting a survey.')
    const text = template ? exportSurveyTemplate(scene.value, settings.value) : exportSurveyCsv(survey.value!)
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = template ? 'cha-waves-survey-template.csv' : 'cha-waves-observations.csv'
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { surveyError.value = cause instanceof Error ? cause.message : 'Could not export the survey.' }
}
const materialEditing = useMaterialEditing({
  scene, disabled: experimentsDisabled, currentDocument: projectWorkspace.currentDocument,
  commit: next => { sceneHistory.commit(next); loadedInterventionId.value = ''; editError.value = ''; requestField(); inspectProbe() },
})
const { error: materialError, notice: materialNotice } = materialEditing
function openMaterials(event: Event) {
  materialEditing.reset(); materialsOpen.value = true
  openWorkspaceDialog(materialsDialog.value, event)
}
function closeMaterials() { materialsOpen.value = false; materialEditing.reset(); closeWorkspaceDialog() }
const configuredMaterialFrequencies = computed(() => availableMaterialFrequencies(scene.value, settings.value.mode))
const currentBandCoverage = computed(() => materialFrequencyCoverage(scene.value, settings.value.mode, settings.value.frequencyHz))
const frequencyOptions = computed(() => {
  const defaults = settings.value.mode === 'radio' ? [2.4e9, 5e9, 6e9] : [1000]
  const frequencies = [...new Set([...defaults, ...configuredMaterialFrequencies.value, settings.value.frequencyHz])].sort((a, b) => a - b)
  const transmissionOff = settings.value.mode === 'acoustics' && !settings.value.transmissionEnabled
  return frequencies.map(frequencyHz => ({ frequencyHz, supported: transmissionOff || scene.value.walls.length === 0 || configuredMaterialFrequencies.value.includes(frequencyHz) }))
})
function frequencyLabel(frequencyHz: number) {
  return frequencyHz >= 1e9 ? `${frequencyHz / 1e9} GHz` : frequencyHz >= 1000 ? `${frequencyHz / 1000} kHz` : `${frequencyHz} Hz`
}
const missingBandNames = computed(() => currentBandCoverage.value.missingMaterialIds.map(id => scene.value.materials.find(material => material.id === id)?.name ?? id).join(', '))
const placementSearch = usePlacementSearch({
  scene, settings, disabled: experimentsDisabled,
  commit: (candidate, sourceId) => commitCommand({ type: 'move-emitter', emitterId: sourceId, position: [...candidate.position] }),
})
const { result: placementResult, running: placementRunning, progress: placementProgress, error: placementError, notice: placementNotice } = placementSearch
const placementCoverageField = computed(() => settings.value.mode === 'radio' && !busy.value && !drag.value && !previewScene.value && acceptedQuality.value === 'balanced' ? field.value : null)
function openPlacement(event: Event) {
  placementOpen.value = true
  openWorkspaceDialog(placementDialog.value, event)
}
function closePlacement() {
  placementSearch.cancel()
  placementOpen.value = false
  closeWorkspaceDialog()
}
function applyPlacement(candidate: PlacementCandidate) {
  if (placementSearch.apply(candidate)) placementDialog.value?.close()
}
const experimentLibrary = useExperiments({
  scene, settings, referenceImage, experiments, baseline, baselineExperimentId, disabled: experimentsDisabled,
  currentDocument: projectWorkspace.currentDocument,
  commit: action => {
    const previousScene = clone(scene.value), before = captureHistoryContext()
    action()
    sceneHistory.record(previousScene, { before, after: captureHistoryContext() })
  },
  onLoaded: () => {
    domain.value = settings.value.mode === 'acoustics' ? 'sound' : 'wifi'
    selectedId.value = scene.value.probes[0]?.id ?? ''
    selectedObjectId.value = selectedId.value || scene.value.emitters.find(item => item.active && item.domain === settings.value.mode)?.id || ''
    selectedDoorId.value = scene.value.openings.find(item => item.kind === 'door')?.id ?? ''
    selectedTool.value = 'select'; loadedInterventionId.value = ''; editError.value = ''
    compare.value = false; splitComparison.value = false; viewMode.value = 'plan'
    resetPlanNavigation(); experimentsDialog.value?.close()
  },
  onComputeChange: () => { requestField(true); inspectProbe(); draw() },
})
const { error: experimentError, notice: experimentNotice } = experimentLibrary
function openExperiments(event: Event) {
  experimentError.value = ''; experimentNotice.value = ''
  openWorkspaceDialog(experimentsDialog.value, event)
}

function installScene(document: ProjectDocument, source: ProjectSource) {
  if (drag.value) cancelDrag()
  scene.value = clone(document.scene as Scene)
  settings.value = clone(document.settings as SolverSettings)
  domain.value = settings.value.mode === 'acoustics' ? 'sound' : 'wifi'
  baseline.value = document.baseline
    ? { scene: clone(document.baseline.scene as Scene), settings: clone(document.baseline.settings as SolverSettings), field: null }
    : null
  experiments.value = document.experiments
  survey.value = document.survey ?? null
  surveyDialog.value?.close()
  baselineExperimentId.value = document.baselineExperimentId ?? null
  sceneHistory.clear()
  selectedId.value = scene.value.probes[0]?.id ?? scene.value.walls.find(wall => !isExteriorEnvelopeWall(scene.value, wall))?.id ?? ''
  selectedObjectId.value = selectedId.value
  syncPositionDraft('probe'); syncPositionDraft('source')
  resetPlanNavigation()
  compare.value = false
  if (source === 'home') {
    splitComparison.value = false; loadedInterventionId.value = ''; editError.value = ''; viewMode.value = 'plan'
  }
  requestField(true)
}

const sources = computed(() => shownScene.value.emitters.filter(item => item.domain === (domain.value === 'sound' ? 'acoustics' : 'radio')))
const probes = computed(() => shownScene.value.probes)
const walls = computed(() => shownScene.value.walls)
const selectedWall = computed(() => shownScene.value.walls.find(wall => wall.id === selectedObjectId.value) ?? null)
const wallIsExterior = computed(() => selectedWall.value ? isExteriorEnvelopeWall(shownScene.value, selectedWall.value) : false)
const selectedMaterial = computed(() => selectedWall.value?.materialId ?? '')
const selectedSceneObject = computed(() => [...sources.value, ...probes.value].find(item => item.id === selectedObjectId.value) ?? walls.value.find(item => item.id === selectedObjectId.value) ?? null)
const selectedSceneObjectName = computed(() => {
  const id = selectedObjectId.value
  const source = sources.value.find(item => item.id === id)
  if (source) return `${'name' in source && source.name ? source.name : source.domain === 'radio' ? 'Access point' : 'Speaker'} · source`
  const selectedProbe = probes.value.find(item => item.id === id)
  if (selectedProbe) return `${selectedProbe.name ?? 'Study probe'} · probe`
  const selectedDoor = doors.value.find(item => item.id === id)
  if (selectedDoor) return `${openingLabel(selectedDoor.id)} · ${selectedDoor.isOpen ? 'open' : 'shut'}`
  const wall = walls.value.find(item => item.id === id)
  return wall ? `${wall.id} · wall` : 'No scene object selected'
})
const canNudgeSelection = computed(() => [...sources.value, ...probes.value].some(item => item.id === selectedObjectId.value))
const selectedScenario = computed(() => HOME_SCENARIOS.find(scenario => scenario.id === selectedScenarioId.value) ?? HOME_SCENARIOS[0] ?? null)
const selectedIntervention = computed(() => selectedScenario.value?.interventions.find(item => item.id === loadedInterventionId.value) ?? null)
const scenarioProbePoint = computed(() => selectedScenario.value?.scene.probes[0]?.position ?? null)
function scenarioReading(sceneState: Scene, settingsState: SolverSettings, target = scenarioProbePoint.value) {
  if (!target) return null
  try { return evaluatePoint(sceneState, settingsState, [target[0], target[1], target[2]]) }
  catch { return null }
}
const scenarioBaselineReading = computed(() => selectedScenario.value ? scenarioReading(selectedScenario.value.scene, selectedScenario.value.settings) : null)
const scenarioCandidateReading = (intervention: HomeScenarioIntervention) => scenarioReading(intervention.scene, intervention.settings)
const scenarioTargetProbe = computed(() => selectedScenario.value?.scene.probes[0] ?? null)
const currentScenarioProbe = computed(() => scene.value.probes.find(item => item.id === scenarioTargetProbe.value?.id) ?? null)
const scenarioCurrentReading = computed(() => currentScenarioProbe.value ? scenarioReading(scene.value, settings.value, currentScenarioProbe.value.position) : null)
const scenarioCurrentComparable = computed(() => !!selectedScenario.value && !!scenarioTargetProbe.value && !!currentScenarioProbe.value
  && settings.value.mode === selectedScenario.value.settings.mode
  && currentScenarioProbe.value.position.every((coordinate, index) => coordinate === scenarioTargetProbe.value!.position[index]))
const scenarioCurrentDelta = computed(() => scenarioCurrentComparable.value
  ? readingDelta(scenarioBaselineReading.value, scenarioCurrentReading.value, selectedScenario.value!.settings)
  : 'Current mode or probe position differs from the authored comparison')
function readingText(result: PointResult | null | undefined, settingsState?: SolverSettings): string {
  if (!result) return 'Unavailable'
  if (!result.valid || !Number.isFinite(result.value)) return result.reason ? `No valid reading (${result.reason.replaceAll('-', ' ')})` : 'No valid reading'
  return `${Number(result.value).toFixed(1)} ${settingsState?.mode === 'radio' || result.unit === 'dBm' ? 'dBm' : 'dB'}`
}
function readingDelta(before: PointResult | null, after: PointResult | null, settingsState: SolverSettings): string {
  if (!before?.valid || !after?.valid || !Number.isFinite(before.value) || !Number.isFinite(after.value)) return 'No comparable valid readings'
  const delta = Number(after.value) - Number(before.value)
  const unit = settingsState.mode === 'radio' ? 'dB' : 'dB'
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${unit}`
}
const projectStateLabel = computed(() => ({ loading: 'Opening local project', saved: 'Saved on this device', saving: 'Saving locally…', failed: 'Local save failed' })[projectStatus.value])
const zones = computed(() => shownScene.value.zones)
const doors = computed(() => shownScene.value.openings.filter(opening => opening.kind === 'door'))
const door = computed(() => doors.value.find(opening => opening.id === selectedDoorId.value) ?? doors.value[0] ?? null)
const doorOpen = computed(() => door.value?.isOpen ?? false)
const doorLabel = computed(() => door.value ? openingLabel(door.value.id) : 'Interior door')
const levelFloorZ = computed(() => scene.value.levels[0]?.floorZ ?? 0)
const levelHeight = computed(() => scene.value.levels[0]?.ceilingHeightM ?? 2.7)
const fixedReceiverOutsideLevel = computed(() => fixedReceiverHeightAboveFloor > levelHeight.value + 1e-6)
const source = computed(() => sources.value.find(item => item.active) ?? null)
const probe = computed(() => probes.value.find((item: ProbeItem) => item.id === selectedId.value) ?? probes.value[0] ?? null)
const world = computed(() => {
  const boundary = scene.value.levels?.[0]?.boundary
  const points = boundary ?? [[0, 0], [14, 0], [14, 10], [0, 10]]
  const xs = points.map((p: Point) => p[0]); const ys = points.map((p: Point) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
})
const effectivePlanView = computed(() => planView.value ?? fitPlanView(world.value))
const planRulerLength = computed(() => {
  const scale = planPixelsPerMeter.value
  if (!(scale > 0) || (2 * scale >= 20 && 2 * scale <= 100)) return 2
  const target = 70 / scale, magnitude = 10 ** Math.floor(Math.log10(target))
  return Number(([5, 2, 1].find(value => value * magnitude <= target) ?? 1) * magnitude)
})
const roomDimensions = computed(() => `${(world.value.maxX - world.value.minX).toFixed(0)} × ${(world.value.maxY - world.value.minY).toFixed(0)} m`)
const title = computed(() => domain.value === 'sound' ? 'Sound field' : 'Wi-Fi coverage')
const quantity = computed(() => FIELD_SCALES[domain.value].quantity)
const unit = computed(() => FIELD_SCALES[domain.value].unit)
const legendScale = computed(() => FIELD_SCALES[compare.value ? 'delta' : domain.value])
const legendTicks = computed(() => Array.from({ length: 5 }, (_, index) => {
  const value = legendScale.value.min + (legendScale.value.max - legendScale.value.min) * index / 4
  return compare.value && value > 0 ? `+${value}` : String(value).replace('-', '−')
}))
const comparisonSnapshots = computed(() => {
  const saved = baseline.value, currentField = field.value
  if (!saved?.field || !currentField || drag.value || previewScene.value || acceptedQuality.value !== 'balanced') return null
  return { baseline: { scene: saved.scene, settings: saved.settings, field: saved.field },
    current: { scene: scene.value, settings: settings.value, field: currentField } }
})
const canCompare = computed(() => comparisonSnapshots.value
  ? compareCompatibility(comparisonSnapshots.value.baseline, comparisonSnapshots.value.current).compatible : false)
const comparisonProblems = computed(() => comparisonSnapshots.value ? compareCompatibility(comparisonSnapshots.value.baseline, comparisonSnapshots.value.current).reasons : [])
const probePoint = computed(() => probe.value?.position ?? [8, 6, 1.5])
const displayValue = computed(() => {
  const value = exact.value?.valid ? exact.value.value : undefined
  return Number.isFinite(value) ? Number(value).toFixed(1) : '—'
})
const distance = computed(() => {
  if (!source.value || !probe.value) return '—'
  const value = exact.value?.distanceM
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} m` : '—'
})
const pathExplanation = computed(() => {
  if (!exact.value?.crossings.length) return 'The model estimates direct propagation from source to probe using the selected distance and material assumptions.'
  const openDoor = exact.value.crossings.some(term => {
    const opening = term.openingId ? scene.value.openings.find(item => item.id === term.openingId) : undefined
    return opening?.kind === 'passage' || (opening?.kind === 'door' && opening.isOpen)
  })
  if (openDoor && exact.value.crossings.every(term => term.lossDb === 0)) return 'The direct path crosses an open door. The model applies no door loss.'
  return `The direct path crosses ${exact.value.crossings.length} wall ${exact.value.crossings.length === 1 ? 'assembly' : 'assemblies'}. Listed losses use the configured material assumptions.`
})

function position(item: SceneItem): Point { return [item.position[0], item.position[1]] }
function previewAt(original: Scene, kind: 'source' | 'probe', id: string, next: Point) {
  const item = kind === 'source' ? original.emitters.find(candidate => candidate.id === id)! : original.probes.find(candidate => candidate.id === id)!
  const command: Parameters<typeof applySceneCommand>[1] = kind === 'source'
    ? { type: 'move-emitter', emitterId: id, position: [next[0], next[1], item.position[2]] }
    : { type: 'move-probe', probeId: id, position: [next[0], next[1], item.position[2]] }
  return applySceneCommand(original, command)
}
function commitCommand(command: Parameters<typeof applySceneCommand>[1]) {
  try {
    const next = applySceneCommand(scene.value, command)
    sceneHistory.commit(next)
    loadedInterventionId.value = ''; editError.value = ''; requestField()
    return true
  } catch (error) {
    editError.value = error instanceof Error ? error.message : 'This change is not valid.'
    return false
  }
}
function syncWallDraft(wall: Scene['walls'][number] | null) {
  if (!wall) return
  wallDraft.value = { startX: wall.start[0], startY: wall.start[1], endX: wall.end[0], endY: wall.end[1], thicknessM: wall.thicknessM }
}
function applyWallGeometry() {
  const wall = selectedWall.value
  if (!wall || wallIsExterior.value) return
  commitCommand({ type: 'update-wall', wallId: wall.id, start: [Number(wallDraft.value.startX), Number(wallDraft.value.startY)], end: [Number(wallDraft.value.endX), Number(wallDraft.value.endY)], thicknessM: Number(wallDraft.value.thicknessM) })
}
function setWallMaterial(materialId: string) {
  const wall = selectedWall.value
  if (wall && !wallIsExterior.value && materialId !== wall.materialId) commitCommand({ type: 'change-wall-material', wallId: wall.id, materialId })
}
function selectSceneObject(id: string, focusPlan = false) {
  if (doors.value.some(opening => opening.id === id)) selectedDoorId.value = id
  selectedObjectId.value = id; selectedId.value = id; selectedTool.value = 'select'; inspectProbe(); draw()
  if (focusPlan && canNudgeSelection.value && viewMode.value === 'plan') nextTick(() => canvas.value?.focus({ preventScroll: true }))
}
function focusPlanForKeyboard() {
  splitComparison.value = false; viewMode.value = 'plan'
  nextTick(() => canvas.value?.focus())
}
function selectObject(id: string) { selectSceneObject(id) }
function openingLabel(id: string): string {
  if (id === 'hall-door') return 'Hall door'
  const match = id.match(/^(.+)-door$/)
  return match ? `${match[1]!.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ')} door` : id.split('-').filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ') || 'Interior door'
}
function selectDoor(id: string) {
  selectedDoorId.value = id
  selectedObjectId.value = id
  selectedTool.value = 'select'
  draw()
}
function cutawayUnavailable(reason: string) {
  cutawayAvailable.value = false; viewMode.value = 'plan'
  rendererNotice.value = `Cutaway view is unavailable here. Returned to plan view${reason ? `: ${reason}` : '.'}`
}
function setCutawayBackend(backend: 'webgpu' | 'webgl') { cutawayBackend.value = backend }
function setSourcePosition(item: EmitterItem, next: Point) {
  commitCommand({ type: 'move-emitter', emitterId: item.id, position: [next[0], next[1], item.position[2]] })
}
function setProbePosition(item: ProbeItem, next: Point) { commitCommand({ type: 'move-probe', probeId: item.id, position: [next[0], next[1], item.position[2]] }) }
function captureHistoryContext(): HistoryContext {
  return { survey: survey.value, referenceImage: referenceImage.value ? clone(referenceImage.value) : undefined, experiments: experiments.value, baselineExperimentId: baselineExperimentId.value, settings: clone(settings.value), domain: domain.value, baseline: baseline.value ? clone(baseline.value) : null, selectedId: selectedId.value, selectedObjectId: selectedObjectId.value, selectedDoorId: selectedDoorId.value }
}
function restoreHistoryContext(context: HistoryContext) {
  referenceImage.value = context.referenceImage
  survey.value = context.survey ?? null
  settings.value = clone(context.settings); domain.value = context.domain
  baseline.value = context.baseline ? clone(context.baseline) : null
  experiments.value = context.experiments ?? []
  baselineExperimentId.value = context.baselineExperimentId ?? null
  selectedId.value = context.selectedId; selectedObjectId.value = context.selectedObjectId; selectedDoorId.value = context.selectedDoorId
}
function loadGuidedState(state: Pick<HomeScenario, 'scene' | 'settings'>, interventionId = '') {
  if (drag.value) cancelDrag()
  const previousScene = clone(scene.value)
  const before = captureHistoryContext()
  referenceImage.value = undefined
  scene.value = clone(state.scene); settings.value = clone(state.settings)
  domain.value = state.settings.mode === 'acoustics' ? 'sound' : 'wifi'
  baseline.value = null; baselineExperimentId.value = null; compare.value = false; splitComparison.value = false
  selectedTool.value = 'select'; selectedId.value = scene.value.probes[0]?.id ?? ''
  selectedObjectId.value = selectedId.value || (scene.value.walls.find(wall => !isExteriorEnvelopeWall(scene.value, wall))?.id ?? '')
  resetPlanNavigation()
  loadedInterventionId.value = interventionId
  const after = captureHistoryContext()
  sceneHistory.record(previousScene, { before, after })
  requestField(true); inspectProbe(); draw()
  void nextTick(() => { if (inspector.value) inspector.value.scrollTop = 0 })
}
const guidedInterventionId = ref(HOME_SCENARIOS[0]?.interventions[0]?.id ?? '')
const guidedPreviewIntervention = computed(() => selectedScenario.value?.interventions.find(item => item.id === guidedInterventionId.value) ?? null)
const guidedPreviewReading = computed(() => guidedPreviewIntervention.value ? scenarioCandidateReading(guidedPreviewIntervention.value) : null)
function chooseScenario(id: string) {
  selectedScenarioId.value = id
  loadedInterventionId.value = ''
  const scenario = HOME_SCENARIOS.find(item => item.id === id)
  guidedInterventionId.value = scenario?.interventions[0]?.id ?? ''
}
function loadGuidedBaseline() {
  if (!selectedScenario.value) return
  loadGuidedState(selectedScenario.value)
}
function applyGuidedIntervention() {
  const intervention = selectedScenario.value?.interventions.find(item => item.id === guidedInterventionId.value)
  if (!intervention) return
  loadGuidedState(intervention, intervention.id)
}
function openDialog(dialog: HTMLDialogElement | null, trigger: HTMLButtonElement | null) {
  if (!dialog || dialog.open) return
  if (dialog === methodDialog.value) methodTrigger.value = trigger
  if (dialog === guidedDialog.value) guidedTrigger.value = trigger
  dialog.showModal()
  void nextTick(() => dialog.querySelector<HTMLElement>('[autofocus], button, select')?.focus())
}
function closeMethodDialog() { methodDialog.value?.close() }
function closeGuidedDialog() { guidedDialog.value?.close() }
function restoreDialogFocus(kind: 'method' | 'guided') {
  void nextTick(() => {
    const trigger = kind === 'method' ? methodTrigger.value : guidedTrigger.value
    if (trigger?.isConnected) trigger.focus()
  })
}

function inspectProbe() {
  const currentProbe = shownScene.value.probes.find(item => item.id === selectedId.value) ?? shownScene.value.probes[0]
  if (!currentProbe) { exact.value = null; return }
  try { exact.value = evaluatePoint(shownScene.value, settings.value, [currentProbe.position[0], currentProbe.position[1], currentProbe.position[2]]) }
  catch { exact.value = null }
}

function clearLossHighlight() {
  selectedLossTermId.value = ''
  draw()
}
function selectLossTerm(term: LossTerm) {
  if (!term.crossing || !lossBudget.value.terms.includes(term)) return
  selectedLossTermId.value = selectedLossTermId.value === term.id ? '' : term.id
  splitComparison.value = false
  viewMode.value = 'plan'
  void nextTick(draw)
}

function planDimensions() {
  const rect = canvas.value?.getBoundingClientRect()
  return { width: rect?.width ?? 1, height: rect?.height ?? 1 }
}
function planTransform() {
  const { width, height } = planDimensions()
  return createPlanTransform(world.value, width, height, effectivePlanView.value)
}
function redrawPlan() {
  if (planFrame !== undefined || !appMounted.value) return
  planFrame = requestAnimationFrame(() => { planFrame = undefined; if (appMounted.value) draw() })
}
function zoomPlan(factor: number, anchor?: Point) {
  if (drag.value || planPan.value) return
  const { width, height } = planDimensions()
  planView.value = zoomPlanView(world.value, width, height, effectivePlanView.value, factor, anchor)
  redrawPlan()
}
function panPlan(delta: Point) {
  if (drag.value || planPan.value) return
  const { width, height } = planDimensions()
  planView.value = panPlanView(world.value, width, height, effectivePlanView.value, delta)
  redrawPlan()
}
function fitHome() {
  if (drag.value || planPan.value) return
  planView.value = null
  redrawPlan()
}
function choosePlanTool(tool: 'select'|'source'|'probe') {
  panMode.value = false
  selectedTool.value = tool
}
function togglePlanPan() {
  if (drag.value || planPan.value) return
  panMode.value = !panMode.value
  selectedTool.value = 'select'
}
function releasePlanPan(restore: boolean) {
  const current = planPan.value
  if (!current) return
  planPan.value = null
  if (restore) planView.value = current.original
  if (canvas.value?.hasPointerCapture(current.pointerId)) canvas.value.releasePointerCapture(current.pointerId)
  redrawPlan()
}
function resetPlanNavigation() {
  releasePlanPan(false)
  planView.value = null; panMode.value = false; spacePan.value = false
  redrawPlan()
}
function cancelPlanPointer(event: PointerEvent) {
  if (planPan.value?.pointerId === event.pointerId) releasePlanPan(true)
  else cancelDrag(event)
}
function releaseSpacePan(event: KeyboardEvent) { if (event.code === 'Space') spacePan.value = false }
function blurPlan() { spacePan.value = false; releasePlanPan(true) }
function planWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey || drag.value || planPan.value || viewMode.value !== 'plan' || splitComparison.value || !event.deltaY) return
  event.preventDefault()
  const rect = canvas.value!.getBoundingClientRect()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
  zoomPlan(Math.exp(-Math.max(-1000, Math.min(1000, delta)) * .0015), [event.clientX - rect.left, event.clientY - rect.top])
}

function draw() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = Math.round(rect.width * dpr); el.height = Math.round(rect.height * dpr)
  const ctx = el.getContext('2d'); if (!ctx) return
  ctx.scale(dpr, dpr)
  const w = rect.width; const h = rect.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = FIELD_PAPER_HEX; ctx.fillRect(0, 0, w, h)
  // Drafting grid
  ctx.strokeStyle = 'rgba(52,67,64,.08)'; ctx.lineWidth = 1
  for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  const transform = createPlanTransform(world.value, w, h, effectivePlanView.value)
  const scale = transform.scale
  planPixelsPerMeter.value = scale
  const origin = transform.worldToScreen([0, 0])
  const sx = (x: number) => origin[0] + x * scale
  const sy = (y: number) => origin[1] - y * scale
  const guide = referenceImage.value
  if (guide && referenceBitmap && showReference.value) {
    ctx.save(); ctx.globalAlpha = guide.opacity
    ctx.drawImage(referenceBitmap, sx(guide.originXY[0]), sy(guide.originXY[1] + guide.heightM), guide.widthM * scale, guide.heightM * scale)
    ctx.restore()
  }
  const visibleField = previewScene.value ? previewField.value : field.value
  if (visibleField) {
    ctx.save(); if (guide && showReference.value) ctx.globalAlpha = .52
    const values = visibleField.values; const valid = visibleField.validity
      const cols = visibleField.grid.cols; const rows = visibleField.grid.rows
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const i = row * cols + col; if (valid?.[i] !== 1) continue
      let value = values[i]!
      if (compare.value && baseline.value?.field) {
        if (baseline.value.field.validity[i] !== 1) continue
        value -= baseline.value.field.values[i]!
        ctx.fillStyle = fieldCssColor(value, 'delta')
      } else {
        ctx.fillStyle = fieldCssColor(value, domain.value)
      }
      const x = visibleField.grid.originXY[0]; const y = visibleField.grid.originXY[1]; const step = visibleField.grid.cellSizeM
      ctx.fillRect(sx(x + col * step), sy(y + (row + 1) * step), scale * step + .5, scale * step + .5)
    }
  }
  if (visibleField) ctx.restore()
  // Apartment slab and outer shell
  ctx.fillStyle = 'rgba(248,245,238,.10)'; ctx.strokeStyle = '#263535'; ctx.lineWidth = 5
  if (scene.value.levels?.[0]?.boundary) {
    const points = scene.value.levels[0].boundary
    ctx.beginPath(); points.forEach((p: Point, i: number) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke()
  }
  for (const wall of walls.value) {
    const pts = [wall.start, wall.end] as const
    ctx.lineCap = 'square'; ctx.lineWidth = Math.max(7, Number(wall.thicknessM ?? .16) * scale); ctx.strokeStyle = '#b9aa95'
    ctx.beginPath(); ctx.moveTo(sx(pts[0][0]), sy(pts[0][1])); ctx.lineTo(sx(pts[1][0]), sy(pts[1][1])); ctx.stroke()
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#6f716a'; ctx.stroke()
    if (wall.id === selectedObjectId.value) {
      ctx.lineWidth = Math.max(10, Number(wall.thicknessM ?? .16) * scale + 6); ctx.strokeStyle = 'rgba(31,105,108,.30)'
      ctx.beginPath(); ctx.moveTo(sx(pts[0][0]), sy(pts[0][1])); ctx.lineTo(sx(pts[1][0]), sy(pts[1][1])); ctx.stroke()
      ctx.lineWidth = 2; ctx.strokeStyle = '#176d70'
      for (const point of pts) { ctx.beginPath(); ctx.arc(sx(point[0]), sy(point[1]), 5, 0, Math.PI * 2); ctx.fillStyle = '#faf8f2'; ctx.fill(); ctx.stroke() }
    }
    const wallOpenings = scene.value.openings.filter(item => item.wallId === wall.id && (item.kind === 'door' || item.kind === 'passage'))
    for (const opening of wallOpenings) {
      const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1]
      const a: Point = [pts[0][0] + dx * opening.fromT, pts[0][1] + dy * opening.fromT]
      const b: Point = [pts[0][0] + dx * opening.toT, pts[0][1] + dy * opening.toT]
      ctx.lineWidth = Math.max(9, Number(wall.thicknessM ?? .16) * scale + 3); ctx.strokeStyle = '#f8f5ee'
      ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke()
      if (opening.kind === 'door' && !opening.isOpen) { ctx.lineWidth = 2; ctx.strokeStyle = '#a47650'; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke() }
      else if (opening.kind === 'door') { ctx.lineWidth = 1.2; ctx.strokeStyle = '#a47650'; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(a[0]), sy(a[1]) - Math.min(23, scale * .8)); ctx.stroke() }
    }
  }
  // Labels and selected direct path
  if (source.value && probe.value) {
    const a = position(source.value), b = position(probe.value)
    ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(28,48,49,.56)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke(); ctx.setLineDash([])
  }
  const crossing = highlightedLossTerm.value?.crossing
  const highlightedWall = crossing ? shownScene.value.walls.find(wall => wall.id === crossing.wallId) : null
  if (crossing && highlightedWall) {
    const a = highlightedWall.start, b = highlightedWall.end
    ctx.save()
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(23,109,112,.38)'; ctx.lineWidth = Math.max(12, highlightedWall.thicknessM * scale + 8)
    ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke()
    const opening = shownScene.value.openings.find(item => item.id === crossing.openingId && item.wallId === highlightedWall.id)
    if (opening) {
      ctx.strokeStyle = '#176d70'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(sx(a[0] + (b[0] - a[0]) * opening.fromT), sy(a[1] + (b[1] - a[1]) * opening.fromT))
      ctx.lineTo(sx(a[0] + (b[0] - a[0]) * opening.toT), sy(a[1] + (b[1] - a[1]) * opening.toT)); ctx.stroke()
    }
    const x = sx(crossing.hit[0]), y = sy(crossing.hit[1])
    ctx.fillStyle = '#fffaf2'; ctx.strokeStyle = '#9d4527'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11); ctx.stroke()
    ctx.restore()
  }
  const annotations: { left: number; right: number; top: number; bottom: number }[] = []
  const mark = (item: SceneItem | null, kind: 'source'|'probe', shortLabel?: string) => {
    if (!item) return
    const p = position(item); const x = sx(p[0]); const y = sy(p[1]); const active = item.id === selectedId.value
    ctx.beginPath(); ctx.arc(x, y, active ? 12 : 9, 0, Math.PI * 2); ctx.fillStyle = kind === 'source' ? '#b44f25' : '#126a72'; ctx.fill(); ctx.lineWidth = active ? 3 : 1.5; ctx.strokeStyle = '#fffaf2'; ctx.stroke()
    ctx.fillStyle = '#172b2c'; ctx.font = '600 12px ui-monospace, monospace'; ctx.fillText(kind === 'source' ? 'S' : 'P', x - 4, y + 4)
    ctx.font = '12px system-ui'; ctx.fillStyle = '#253737'
    const label = shortLabel ?? ('name' in item ? item.name : undefined) ?? (kind === 'source' ? ('domain' in item && item.domain === 'radio' ? 'Access point' : 'Speaker') : 'Study probe')
    const labelWidth = ctx.measureText(label).width
    const labelFitsRight = x + 14 + labelWidth <= w - 8
    ctx.textAlign = labelFitsRight ? 'left' : 'right'
    ctx.fillText(label, x + (labelFitsRight ? 14 : -14), y - 10)
    ctx.textAlign = 'left'
    const left = labelFitsRight ? x + 14 : x - 14 - labelWidth
    annotations.push({ left, right: left + labelWidth, top: y - 23, bottom: y - 7 }, { left: x - 13, right: x + 13, top: y - 13, bottom: y + 13 })
  }
  mark(source.value, 'source')
  probes.value.forEach((item, index) => { if (item.id !== probe.value?.id) mark(item, 'probe', `P${index + 1}`) })
  mark(probe.value, 'probe')
  // Room names are visual guides, never solver geometry.
  ctx.fillStyle = 'rgba(34,48,47,.65)'; ctx.font = '11px system-ui'; ctx.letterSpacing = '1px'
  for (const zone of zones.value) {
    const center = zone.polygon.reduce((acc, point) => [acc[0] + point[0] / zone.polygon.length, acc[1] + point[1] / zone.polygon.length] as Point, [0, 0] as Point)
    const label = zone.name.toUpperCase(), x = sx(center[0]), y = sy(center[1])
    const width = ctx.measureText(label).width
    // Room labels are secondary guides; keep exact marker annotations legible.
    if (annotations.some(box => x < box.right + 3 && x + width > box.left - 3 && y - 12 < box.bottom + 3 && y + 2 > box.top - 3)) continue
    ctx.fillText(label, x, y)
  }
}
function canvasWorld(event: PointerEvent): Point {
  const rect = canvas.value!.getBoundingClientRect()
  return planTransform().screenToWorld([event.clientX - rect.left, event.clientY - rect.top])
}
function hitTest(event: PointerEvent): SceneItem | null {
  const p = canvasWorld(event); let nearest: SceneItem | null = null; let d = 14 / planTransform().scale
  for (const item of [...(source.value ? [source.value] : []), ...probes.value]) { const q = position(item); const dist = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dist < d) { nearest = item; d = dist } }
  return nearest
}
function hitWall(event: PointerEvent): Scene['walls'][number] | null {
  const p = canvasWorld(event); let nearest: Scene['walls'][number] | null = null; let distance = 10 / planTransform().scale
  for (const wall of walls.value) {
    const [ax, ay] = wall.start, dx = wall.end[0] - ax, dy = wall.end[1] - ay
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
    if (d < distance) { nearest = wall; distance = d }
  }
  return nearest
}
function pointerDown(event: PointerEvent) {
  if (drag.value || planPan.value || viewMode.value !== 'plan' || splitComparison.value || !event.isPrimary) return
  if (event.button === 1 || (event.button === 0 && (panMode.value || spacePan.value))) {
    event.preventDefault()
    canvas.value?.focus({ preventScroll: true })
    planPan.value = { pointerId: event.pointerId, start: [event.clientX, event.clientY], original: clone(effectivePlanView.value) }
    canvas.value?.setPointerCapture(event.pointerId)
    return
  }
  if (event.button !== 0) return
  const hit = hitTest(event)
  if (hit) { selectedId.value = hit.id; selectedObjectId.value = hit.id; selectedTool.value = 'select'; const original = clone(scene.value); drag.value = { id: hit.id, kind: scene.value.emitters.some(s => s.id === hit.id) ? 'source' : 'probe', pointerId: event.pointerId, start: position(hit), original, moved: false, valid: true }; previewScene.value = clone(original); previewField.value = null; compare.value = false; canvas.value?.setPointerCapture(event.pointerId); draw(); return }
  if (selectedTool.value === 'source' || selectedTool.value === 'probe') {
    const kind = selectedTool.value
    const next = canvasWorld(event)
    if (kind === 'source' && source.value) setSourcePosition(source.value, next)
    else if (kind === 'probe' && probe.value) setProbePosition(probe.value, next)
    return
  }
  const wallHit = hitWall(event)
  if (wallHit) { selectedObjectId.value = wallHit.id; selectedId.value = wallHit.id; selectedTool.value = 'select'; draw(); return }
}
function pointerMove(event: PointerEvent) {
  const navigation = planPan.value
  if (navigation?.pointerId === event.pointerId) {
    const { width, height } = planDimensions()
    planView.value = panPlanView(world.value, width, height, navigation.original, [event.clientX - navigation.start[0], event.clientY - navigation.start[1]])
    redrawPlan()
    return
  }
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  const currentDrag = drag.value
  // A new pointer intent invalidates the previously accepted preview raster.
  previewField.value = null
  previewVersion.value++
  const intent = previewVersion.value
  previewField.value = null
  const next = canvasWorld(event)
  if (next[0] !== currentDrag.start[0] || next[1] !== currentDrag.start[1]) currentDrag.moved = true
  try {
    const candidate = previewAt(currentDrag.original, currentDrag.kind, currentDrag.id, next)
    currentDrag.valid = true; previewScene.value = candidate; schedulePreview(candidate, intent)
  } catch {
    currentDrag.valid = false
    clearScheduledPreview()
    const candidate = clone(currentDrag.original)
    const item = currentDrag.kind === 'source' ? candidate.emitters.find(value => value.id === currentDrag.id)! : candidate.probes.find(value => value.id === currentDrag.id)!
    item.position = [next[0], next[1], item.position[2]]
    previewScene.value = candidate; previewField.value = null
  }
  inspectProbe(); draw()
}
function pointerUp(event: PointerEvent) {
  if (planPan.value?.pointerId === event.pointerId) { releasePlanPan(false); return }
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  const finished = drag.value
  const item = finished.kind === 'source' ? previewScene.value?.emitters.find(value => value.id === finished.id) : previewScene.value?.probes.find(value => value.id === finished.id)
  const next: Point | null = item ? position(item) : null
  const commit = finished.valid && finished.moved && next && (next[0] !== finished.start[0] || next[1] !== finished.start[1])
  drag.value = null; previewScene.value = null; previewField.value = null; inspectProbe()
  if (commit && next) {
    const command: Parameters<typeof applySceneCommand>[1] = finished.kind === 'source'
      ? { type: 'move-emitter', emitterId: finished.id, position: [next[0], next[1], finished.original.emitters.find(value => value.id === finished.id)!.position[2]] }
      : { type: 'move-probe', probeId: finished.id, position: [next[0], next[1], finished.original.probes.find(value => value.id === finished.id)!.position[2]] }
    commitCommand(command)
  } else { cancelWorkingJobs(); requestField(); draw() }
}
function cancelDrag(event?: PointerEvent) {
  if (!drag.value || (event && drag.value.pointerId !== event.pointerId)) return
  if (canvas.value?.hasPointerCapture(drag.value.pointerId)) canvas.value.releasePointerCapture(drag.value.pointerId)
  drag.value = null; previewScene.value = null; previewField.value = null; cancelWorkingJobs(); requestField(); inspectProbe(); draw()
}
function nudge(axisX: number, axisY: number, large = false) {
  const item = [...sources.value, ...probes.value].find(x => x.id === selectedId.value)
  if (!item) return
  const p = position(item); const next: Point = [p[0] + axisX * (large ? .5 : .1), p[1] + axisY * (large ? .5 : .1)]
  if (sources.value.some(source => source.id === item.id)) setSourcePosition(item as EmitterItem, next)
  else setProbePosition(item as ProbeItem, next)
}
function keydown(event: KeyboardEvent) {
  if (projectStatus.value === 'loading' || event.defaultPrevented || event.isComposing) return
  if (event.key === 'Escape' && planPan.value) { event.preventDefault(); releasePlanPan(true); return }
  const target = event.target
  const isFormControl = target instanceof HTMLInputElement || target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
  if (isFormControl) return
  if (event.key === 'Escape' && drag.value) {
    cancelDrag(); return
  }
  if (target instanceof HTMLElement && target.closest('dialog[open]')) return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
  // Leave browser and assistive-technology shortcuts untouched.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (target === canvas.value && viewMode.value === 'plan' && !splitComparison.value) {
    if (event.code === 'Space') { event.preventDefault(); spacePan.value = true; return }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomPlan(1.25); return }
    if (event.key === '-') { event.preventDefault(); zoomPlan(.8); return }
    if (event.key === '0') { event.preventDefault(); fitHome(); return }
    if (panMode.value && event.key.startsWith('Arrow')) {
      event.preventDefault()
      const step = event.shiftKey ? 80 : 40
      if (event.key === 'ArrowLeft') panPlan([-step, 0])
      else if (event.key === 'ArrowRight') panPlan([step, 0])
      else if (event.key === 'ArrowUp') panPlan([0, -step])
      else if (event.key === 'ArrowDown') panPlan([0, step])
      return
    }
  }
  if (event.key.startsWith('Arrow') && target === canvas.value) {
    event.preventDefault()
    if (viewMode.value !== 'plan' || splitComparison.value) return
  } else if (event.key.startsWith('Arrow')) return
  if (event.key.toLowerCase() === 'v') choosePlanTool('select')
  else if (event.key.toLowerCase() === 's') choosePlanTool('source')
  else if (event.key.toLowerCase() === 'p') choosePlanTool('probe')
  if (event.key === 'ArrowLeft') nudge(-1, 0, event.shiftKey)
  else if (event.key === 'ArrowRight') nudge(1, 0, event.shiftKey)
  else if (event.key === 'ArrowUp') nudge(0, 1, event.shiftKey)
  else if (event.key === 'ArrowDown') nudge(0, -1, event.shiftKey)
}
function toggleDoor() {
  const opening = scene.value.openings.find(o => o.id === door.value?.id && o.kind === 'door')
  if (opening) commitCommand({ type: 'set-door-state', openingId: opening.id, isOpen: !opening.isOpen })
}
function changeDomain(next: 'sound' | 'wifi') {
  if (drag.value) cancelDrag()
  domain.value = next
  settings.value = next === 'sound' ? defaultSettings('acoustics') : defaultSettings('radio')
  const stillSelected = [...probes.value, ...walls.value].some(item => item.id === selectedObjectId.value) || sources.value.some(item => item.id === selectedObjectId.value)
  if (!stillSelected) selectSceneObject(probes.value[0]?.id ?? sources.value[0]?.id ?? '')
  loadedInterventionId.value = ''
  requestField(); inspectProbe()
}
function setCoordinate(axis: 'x'|'y', event: Event) { setXYCoordinate('probe', axis, event) }
function setSourceCoordinate(axis: 'x'|'y', event: Event) { setXYCoordinate('source', axis, event) }
function syncPositionDraft(kind: 'probe'|'source') {
  const item = kind === 'probe' ? probe.value : source.value
  const draft = kind === 'probe' ? probePositionDraft : sourcePositionDraft
  draft.value = { x: item?.position[0].toFixed(1) ?? '', y: item?.position[1].toFixed(1) ?? '' }
}
function setXYCoordinate(kind: 'probe'|'source', axis: 'x'|'y', event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const item = kind === 'probe' ? probe.value : source.value
  if (!item) return
  const index = axis === 'x' ? 0 : 1
  const draft = kind === 'probe' ? probePositionDraft : sourcePositionDraft
  const value = input.value.trim() ? Number(input.value) : Number.NaN
  if (Math.abs(value - item.position[index]) < 1e-9) {
    draft.value[axis] = item.position[index].toFixed(1)
    input.value = String(draft.value[axis])
    return
  }
  const next: Point = axis === 'x' ? [value, item.position[1]] : [item.position[0], value]
  if (kind === 'probe') setProbePosition(item as ProbeItem, next)
  else setSourcePosition(item as EmitterItem, next)
  const committed = kind === 'probe' ? probe.value : source.value
  draft.value[axis] = committed?.position[index].toFixed(1) ?? ''
  input.value = String(draft.value[axis])
}
function aboveFloor(positionZ: number, levelId = scene.value.levels[0]?.id) {
  return positionZ - (scene.value.levels.find(level => level.id === levelId)?.floorZ ?? 0)
}
function setProbeHeight(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (!probe.value) return
  const value = input.value
  const heightAboveFloor = value.trim() ? Number(value) : Number.NaN
  const floorZ = scene.value.levels.find(level => level.id === probe.value!.levelId)?.floorZ ?? 0
  if (Math.abs(heightAboveFloor - aboveFloor(probe.value.position[2], probe.value.levelId)) < 1e-9) return
  commitCommand({ type: 'move-probe', probeId: probe.value.id, position: [probe.value.position[0], probe.value.position[1], floorZ + heightAboveFloor] })
  probeHeightDraft.value = probe.value ? aboveFloor(probe.value.position[2], probe.value.levelId).toFixed(1) : ''
}
function setSourceHeight(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (!source.value) return
  const value = input.value
  const heightAboveFloor = value.trim() ? Number(value) : Number.NaN
  const floorZ = scene.value.levels.find(level => level.id === source.value!.levelId)?.floorZ ?? 0
  if (Math.abs(heightAboveFloor - aboveFloor(source.value.position[2], source.value.levelId)) < 1e-9) return
  commitCommand({ type: 'move-emitter', emitterId: source.value.id, position: [source.value.position[0], source.value.position[1], floorZ + heightAboveFloor] })
  sourceHeightDraft.value = source.value ? aboveFloor(source.value.position[2], source.value.levelId).toFixed(1) : ''
}
function setFrequency(value: string) {
  if (drag.value) cancelDrag()
  const frequencyHz = Number(value)
  if (!Number.isFinite(frequencyHz) || !frequencyOptions.value.some(option => option.frequencyHz === frequencyHz && option.supported)) return
  settings.value = { ...settings.value, frequencyHz }
  loadedInterventionId.value = ''
  requestField(); inspectProbe()
}
function saveBaseline() {
  if (!field.value || drag.value || previewScene.value || busy.value) return
  const previousScene = clone(scene.value), before = captureHistoryContext()
  splitComparison.value = false
  fieldJobs.invalidateBaselineRequest()
  baseline.value = { field: clone(field.value), scene: clone(scene.value), settings: clone(settings.value) }
  baselineExperimentId.value = null
  compare.value = false
  sceneHistory.record(previousScene, { before, after: captureHistoryContext() })
}
function toggleComparison() {
  if (!canCompare.value) return
  splitComparison.value = false
  compare.value = !compare.value
  draw()
}

function toggleSplitComparison() {
  if (!canCompare.value) return
  splitComparison.value = !splitComparison.value
  compare.value = false
  requestAnimationFrame(draw)
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  appMounted.value = true
  try {
    createFieldWorker()
  } catch {
    busy.value = false; workerError.value = 'This browser could not start the local field worker. Restart the calculation to try again.'
  }
  resizeObserver = new ResizeObserver(draw); if (canvas.value) resizeObserver.observe(canvas.value)
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', releaseSpacePan)
  window.addEventListener('blur', blurPlan)
  void restoreProject().then(() => { if (requestId.value === 0) requestField() }); draw()
})
onBeforeUnmount(() => {
  appMounted.value = false; releasePlanPan(false)
  if (planFrame !== undefined) cancelAnimationFrame(planFrame)
  projectFlowGeneration.value++; projectWorkspace.dispose(); fieldJobs.dispose(); placementSearch.dispose(); resizeObserver?.disconnect()
  window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', releaseSpacePan); window.removeEventListener('blur', blurPlan)
})
watch([referenceImage, showReference], () => {
  referenceBitmap = null
  if (referenceImage.value) { const image = new Image(); image.onload = () => { if (referenceImage.value?.dataUrl === image.src) { referenceBitmap = image; draw() } }; image.src = referenceImage.value.dataUrl }
  draw()
})
watch([domain, scene], () => { draw(); inspectProbe() }, { deep: false })
watch(() => [world.value.minX, world.value.maxX, world.value.minY, world.value.maxY].join(','), resetPlanNavigation)
watch([shownScene, settings, selectedId], clearLossHighlight, { flush: 'sync' })
watch([scene, doors], () => { if (!doors.value.some(opening => opening.id === selectedDoorId.value)) selectedDoorId.value = doors.value[0]?.id ?? '' }, { deep: false })
watch(selectedWall, syncWallDraft, { immediate: true })
watch([() => probe.value?.id, () => probe.value?.position[0], () => probe.value?.position[1]], () => {
  syncPositionDraft('probe')
}, { immediate: true })
watch([() => source.value?.id, () => source.value?.position[0], () => source.value?.position[1]], () => {
  syncPositionDraft('source')
}, { immediate: true })
watch([() => probe.value?.id, () => probe.value?.position[2], levelFloorZ], () => {
  probeHeightDraft.value = probe.value ? aboveFloor(probe.value.position[2], probe.value.levelId).toFixed(1) : ''
}, { immediate: true })
watch([() => source.value?.id, () => source.value?.position[2], levelFloorZ], () => {
  sourceHeightDraft.value = source.value ? aboveFloor(source.value.position[2], source.value.levelId).toFixed(1) : ''
}, { immediate: true })
watch(canCompare, compatible => { if (!compatible) { compare.value = false; splitComparison.value = false } })
watch(viewMode, mode => { if (mode === 'cutaway') { cutawayBackend.value = 'pending'; blurPlan() }; requestAnimationFrame(draw) })
watch(splitComparison, active => { if (active) blurPlan(); else redrawPlan() })
</script>

<template>
  <main class="app-shell">
    <a class="skip-link" href="#plan-canvas" @click.prevent="focusPlanForKeyboard">Skip to interactive plan</a>
    <input ref="fileInput" id="project-import" data-testid="project-import" class="visually-hidden" type="file" accept="application/json,.json" @change="importProjectFile"><label class="visually-hidden" for="project-import">Import a project JSON file</label>
    <header class="topbar">
      <a class="brand" href="#" aria-label="Cha Waves home"><span class="brand-mark">cw</span><span>cha waves</span></a>
      <div class="project-title"><span class="eyebrow">APARTMENT STUDY</span><strong>{{ projectName }}</strong></div>
      <div class="history-controls">
        <button class="icon-button" aria-label="Undo" :disabled="projectStatus === 'loading' || !undoStack.length" @click="undo">↶</button>
        <button class="icon-button" aria-label="Redo" :disabled="projectStatus === 'loading' || !redoStack.length" @click="redo">↷</button>
        <span class="saved-state" data-testid="project-status" :data-state="projectStatus"><i :class="{ failed: projectStatus === 'failed', saving: projectStatus === 'saving' }"></i> {{ projectStateLabel }}</span>
      </div>
      <div class="project-actions"><button class="export-button" data-testid="new-home" :disabled="projectStatus === 'loading' || workspaceBusy" @click="openWorkspaceDialog(homeDialog, $event)">New home</button><button class="export-button" data-testid="saved-homes" @click="openLibrary">Homes</button><button class="export-button" data-testid="experiment-library-open" :disabled="experimentsDisabled" @click="openExperiments">Experiments</button><button class="export-button guide-button" data-testid="scenario-open" aria-label="Guided home study" ref="guidedTrigger" @click="openDialog(guidedDialog, $event.currentTarget as HTMLButtonElement)">Explore</button><button class="export-button" aria-label="Import a project JSON file" :disabled="workspaceBusy" @click="fileInput?.click()">Import</button><button data-testid="project-export" class="export-button" :disabled="projectStatus === 'loading' || !!drag || !!previewScene" @click="exportProjectFile">Export <span>↗</span></button><button class="export-button method-button" aria-label="Method" ref="methodTrigger" @click="openDialog(methodDialog, $event.currentTarget as HTMLButtonElement)">Method</button></div>
    </header>
    <section class="workspace" :inert="projectStatus === 'loading'">
      <aside class="tool-rail">
        <div class="domain-switch" role="group" aria-label="Field type">
          <button data-testid="mode-acoustics" aria-label="Sound" :aria-pressed="domain === 'sound'" :class="{ active: domain === 'sound' }" @click="changeDomain('sound')"><span class="domain-icon sound-icon">)))</span><span>Sound</span></button>
          <button data-testid="mode-radio" aria-label="Wi-Fi" :aria-pressed="domain === 'wifi'" :class="{ active: domain === 'wifi' }" @click="changeDomain('wifi')"><span class="domain-icon wifi-icon">⌁</span><span>Wi-Fi</span></button>
        </div>
        <div class="rail-section"><div class="section-label">EDIT SCENE</div>
          <button class="tool-row" aria-label="Select and move" :aria-pressed="selectedTool === 'select' && !panMode" :class="{ chosen: selectedTool === 'select' && !panMode }" @click="choosePlanTool('select')"><span class="tool-glyph">↖</span><span>Select & move</span><kbd>V</kbd></button>
          <button class="tool-row" aria-label="Emitter tool" :aria-pressed="selectedTool === 'source' && !panMode" :class="{ chosen: selectedTool === 'source' && !panMode }" @click="choosePlanTool('source')"><span class="tool-glyph source-glyph">◉</span><span>Emitter</span><kbd>S</kbd></button>
          <button class="tool-row" aria-label="Probe tool" :aria-pressed="selectedTool === 'probe' && !panMode" :class="{ chosen: selectedTool === 'probe' && !panMode }" @click="choosePlanTool('probe')"><span class="tool-glyph probe-glyph">⌖</span><span>Probe</span><kbd>P</kbd></button>
        </div>
        <div class="rail-section"><div class="section-label">ARCHITECTURE</div><button class="tool-row" data-testid="edit-home" aria-label="Edit home" @click="openWorkspaceDialog(editorDialog, $event)"><span class="tool-glyph">＋</span><span>Edit home</span></button><label v-if="referenceImage" class="reference-toggle"><input v-model="showReference" type="checkbox"> Floor plan guide</label>
          <button data-testid="wall-select" class="tool-row" aria-label="Select an interior wall" :aria-pressed="!!selectedWall" :class="{ chosen: !!selectedWall }" @click="selectSceneObject(walls.find(wall => !isExteriorEnvelopeWall(scene, wall))?.id ?? walls[0]?.id ?? '')"><span class="tool-glyph">▱</span><span>Walls</span><span class="count">{{ walls.length }}</span></button>
          <label class="door-picker-label" for="door-select">Individual door</label><select id="door-select" data-testid="door-select" class="door-select" :value="door?.id ?? ''" :disabled="!doors.length" @change="selectDoor(($event.target as HTMLSelectElement).value)"><option v-for="item in doors" :key="item.id" :value="item.id">{{ openingLabel(item.id) }}</option></select>
          <button data-testid="door-toggle" class="tool-row" :aria-label="`${doorLabel}, ${doorOpen ? 'open' : 'shut'}`" :aria-pressed="doorOpen" :disabled="!door" @click="toggleDoor"><span class="tool-glyph">⌑</span><span>{{ doorLabel }}</span><span class="door-state" :class="{ open: doorOpen }">{{ doorOpen ? 'OPEN' : 'SHUT' }}</span></button>
        </div>
        <details class="object-list"><summary>Scene objects</summary><button v-for="item in [...sources, ...probes]" :key="item.id" :aria-current="selectedObjectId === item.id ? 'true' : undefined" @click="selectSceneObject(item.id, true)">{{ 'name' in item ? item.name : 'Source' }} <small>{{ 'domain' in item ? `source · ${item.active ? 'active' : 'inactive'}` : 'probe' }}</small></button><button v-for="item in doors" :key="item.id" :aria-current="selectedObjectId === item.id ? 'true' : undefined" @click="selectSceneObject(item.id)">{{ openingLabel(item.id) }} <small>{{ item.isOpen ? 'open' : 'shut' }}</small></button><button v-for="wall in walls" :key="wall.id" :aria-current="selectedObjectId === wall.id ? 'true' : undefined" @click="selectSceneObject(wall.id)">{{ wall.id }} <small>wall</small></button></details>
        <div class="scene-card">
          <button class="scene-head" @click="showLayers = !showLayers"><span><span class="tiny-building">⌂</span> Scene layers</span><span>{{ showLayers ? '−' : '+' }}</span></button>
          <div v-if="showLayers" class="layer-list"><span v-for="zone in zones" :key="zone.id">◉ {{ zone.name }}</span><span>◒ Structural walls · constrained editing</span></div>
          <div class="scene-foot"><span>{{ roomDimensions }}</span><span>{{ scene.levels.length }} level</span></div>
        </div>
        <div class="rail-bottom"><span class="key-hint"><kbd>⌘</kbd><kbd>Z</kbd> Undo</span><span class="key-hint"><kbd>⇧</kbd><kbd>↑</kbd> Coarse move</span></div>
      </aside>

      <section class="viewport-column">
        <div class="viewport-toolbar"><div><span class="live-dot"></span><span class="view-caption">{{ splitComparison ? 'Baseline A / Current B' : compare ? 'Difference · working − baseline' : title }}</span><span class="dot-separator">·</span><span class="view-subtitle">{{ viewMode === 'plan' ? 'Orthographic plan' : 'Cutaway view' }}</span><span data-testid="render-backend" class="backend-label">{{ renderBackend }}</span></div><div class="view-actions"><button data-testid="view-plan" :class="{ active: viewMode === 'plan' }" @click="splitComparison = false; viewMode = 'plan'">Plan</button><button data-testid="view-cutaway" :class="{ active: viewMode === 'cutaway' }" :disabled="!cutawayAvailable" @click="splitComparison = false; viewMode = 'cutaway'">Cutaway</button><button data-testid="comparison-split" :disabled="!canCompare" :aria-pressed="splitComparison" :class="{ active: splitComparison }" @click="toggleSplitComparison">A / B</button><button :disabled="!canCompare" :class="{ active: compare }" @click="toggleComparison">⇄ &nbsp;{{ compare ? 'Difference' : 'Compare' }}</button><button aria-label="Layers" @click="showLayers = !showLayers">▤</button></div></div>
        <div class="canvas-wrap" :class="{ stale: busy, dragging: !!drag, panning: !!planPan, 'pan-ready': panMode || spacePan }"><canvas v-show="viewMode === 'plan' && !splitComparison" id="plan-canvas" ref="canvas" class="plan-canvas" tabindex="0" data-testid="field-canvas" :data-plan-zoom="effectivePlanView.zoom" :data-plan-center-x="effectivePlanView.center[0]" :data-plan-center-y="effectivePlanView.center[1]" :data-highlight-wall-id="highlightedLossTerm?.crossing?.wallId ?? ''" :data-highlight-opening-id="highlightedLossTerm?.crossing?.openingId ?? ''" :data-highlight-hit="highlightedLossTerm?.crossing?.hit.join(',') ?? ''" :data-pixels-per-meter="planPixelsPerMeter" :data-probe-count="probes.length" :data-step="(previewScene ? previewField : field)?.grid.cellSizeM ?? ''" :data-field-revision="(previewScene ? previewField : field)?.sceneRevision ?? ''" :data-receiver-z="field?.grid.receiverZM ?? ''" :data-request-id="(previewScene ? previewField : field)?.identity.requestId ?? ''" :data-query-hash="(previewScene ? previewField : field)?.identity.queryHash ?? ''" :data-quality="previewScene ? (previewField ? 'preview' : 'pending') : acceptedQuality ?? 'pending'" aria-label="Interactive apartment plan" aria-describedby="plan-keyboard-help" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelPlanPointer" @lostpointercapture="cancelPlanPointer" @wheel="planWheel" @blur="spacePan = false"></canvas><span id="plan-keyboard-help" class="visually-hidden">Select a speaker or probe, then use the arrow keys to move it 0.1 meters. Hold Shift with an arrow key to move 0.5 meters. Each move can be undone with Command or Control plus Z. Arrow keys move objects only while this plan has keyboard focus. All {{ probes.length }} probes are visible; open All readings to select a point and inspect its exact estimate. Use plus/minus to zoom and 0 to fit the home. Choose Pan to drag the view or move it with arrow keys; hold Shift for larger steps. Hold Space or the middle mouse button to pan temporarily.</span>
          <PlanNavigation v-if="viewMode === 'plan' && !splitComparison" class="plan-navigation-overlay" :zoom="effectivePlanView.zoom" :pan-mode="panMode" :disabled="!!drag || !!planPan" @zoom="zoomPlan" @fit="fitHome" @pan="togglePlanPan" />
          <ScenarioComparison v-if="splitComparison && comparisonSnapshots" class="comparison-surface" :baseline="comparisonSnapshots.baseline" :current="comparisonSnapshots.current" :probe-position="[probePoint[0]!, probePoint[1]!, probePoint[2]!]" /><ClientOnly><BuildingCutaway v-if="viewMode === 'cutaway' && !splitComparison" class="cutaway-surface" :scene="scene" :field="field" :mode="domain" :compare="compare" :baseline-field="baseline?.field ?? null" backend="auto" @select="selectObject" @ready="setCutawayBackend" @unavailable="cutawayUnavailable" /></ClientOnly>
          <div v-if="viewMode === 'plan' && !splitComparison" class="north-mark"><span>N</span><b>↑</b></div><div v-if="viewMode === 'plan' && !splitComparison" class="scale-mark" data-testid="plan-scale" :data-length-m="planRulerLength"><i :style="{ width: `${planPixelsPerMeter * planRulerLength}px` }"></i><span>{{ planRulerLength }} m</span></div>
          <div v-show="!splitComparison" class="canvas-status" :class="{ 'cutaway-compute': viewMode === 'cutaway' }" data-testid="solver-status" :data-quality="previewScene ? (previewField ? 'preview' : 'pending') : acceptedQuality ?? 'pending'" :data-compute-ms="lastComputeMs ?? ''" :data-request-to-paint-ms="lastRequestToPaintMs ?? ''"><span class="status-wave" data-testid="field-quality" :data-quality="previewScene ? (previewField ? 'preview' : 'pending') : acceptedQuality ?? 'pending'">≈</span><div><strong>{{ drag ? (drag.valid ? (previewField ? 'Preview field' : 'Preview pending') : 'Invalid position') : busy ? 'Calculating field' : 'Direct field estimate' }}</strong><small>{{ drag ? (drag.valid ? 'Release to accept · Escape to restore' : 'Position is outside the valid scene') : busy ? 'Updating from scene changes…' : `${domain === 'sound' ? `${settings.frequencyHz} Hz` : `${settings.frequencyHz / 1e9} GHz`} · ` }}<span data-testid="accepted-step">{{ previewScene ? previewField?.grid.cellSizeM ?? '' : field?.grid.cellSizeM ?? '' }}<template v-if="previewScene ? previewField : field"> m grid</template></span><span v-if="drag" class="inspector-sample-label"> · unsaved sample</span></small></div><span class="status-spinner" :class="{ spinning: busy }"></span></div>
          <div v-if="editError" class="error-toast" role="alert">{{ editError }}</div>
          <div v-if="workerError" class="error-toast worker-error" data-testid="worker-error" role="alert">
            <span>Field calculation unavailable: {{ workerError }}</span>
            <button type="button" data-testid="worker-retry" @click="restartFieldWorker">Restart calculation</button>
          </div>
        </div>
        <div class="field-footer"><div class="provenance"><span class="provenance-icon">⌁</span><div><strong>{{ compare ? 'Computed difference' : 'Computed approximation' }}</strong><small>{{ compare ? 'Working − saved baseline' : 'Direct path + assumed material loss' }} <button class="text-link" @click="openDialog(methodDialog, $event.currentTarget as HTMLButtonElement)">How it works</button></small></div></div><div class="legend-wrap"><div class="legend-label"><span>{{ compare ? 'Change in ' + quantity.toLowerCase() : quantity }}</span><span>{{ compare ? 'dB' : unit }}</span></div><div class="legend-bar" :class="compare ? 'delta' : domain"><span v-for="color in legendScale.colors" :key="color" :style="{ background: color }"></span></div><div class="legend-ticks"><span v-for="tick in legendTicks" :key="tick">{{ tick }}</span></div></div></div>
      </section>

      <aside ref="inspector" class="inspector">
        <div class="mobile-object-picker"><label for="mobile-object-select">Select scene object</label><select id="mobile-object-select" data-testid="mobile-object-select" :value="selectedObjectId" @change="selectSceneObject(($event.target as HTMLSelectElement).value)"><optgroup v-if="sources.length" label="Sources"><option v-for="item in sources" :key="item.id" :value="item.id">{{ 'name' in item && item.name ? item.name : item.domain === 'radio' ? 'Access point' : 'Speaker' }} · source</option></optgroup><optgroup v-if="probes.length" label="Probes"><option v-for="item in probes" :key="item.id" :value="item.id">{{ item.name ?? 'Study probe' }} · probe</option></optgroup><optgroup v-if="doors.length" label="Doors"><option v-for="item in doors" :key="item.id" :value="item.id">{{ openingLabel(item.id) }} · {{ item.isOpen ? 'open' : 'shut' }}</option></optgroup><optgroup label="Walls"><option v-for="wall in walls" :key="wall.id" :value="wall.id">{{ wall.id }} · wall</option></optgroup></select><span data-testid="selected-object-name">{{ selectedSceneObjectName }}</span><button v-if="canNudgeSelection" type="button" class="focus-plan-button" data-testid="focus-plan" @click="focusPlanForKeyboard">Focus plan to move selected item</button></div>
        <button class="all-readings-button" data-testid="readings-open" @click="openReadings"><span>All readings</span><span>{{ probes.length }} {{ probes.length === 1 ? 'point' : 'points' }} ↗</span></button><button class="all-readings-button" data-testid="placement-open" :disabled="experimentsDisabled" @click="openPlacement"><span>Find source placement</span><span>Study ↗</span></button><div class="inspector-heading"><div><span class="section-label">MEASUREMENT</span><h1>{{ probe ? probe.name ?? 'Study probe' : 'No probe selected' }}</h1><p v-if="probe">Receiver · {{ aboveFloor(probe.position[2], probe.levelId).toFixed(1) }} m above floor</p></div></div>
        <section v-if="selectedWall" class="wall-editor" aria-label="Selected wall properties">
          <div class="section-label">WALL INSPECTOR <span>{{ wallIsExterior ? 'ENVELOPE · LOCKED' : 'INTERIOR · EDITABLE' }}</span></div>
          <strong class="wall-title">{{ selectedWall.id }}</strong>
          <p v-if="wallIsExterior" class="wall-lock-note">Exterior envelope walls are protected. Select an interior wall to edit geometry.</p>
          <div class="wall-coordinate-grid"><label>Start X<input data-testid="wall-start-x" type="number" step="0.1" v-model.number="wallDraft.startX" :disabled="wallIsExterior"></label><label>Start Y<input data-testid="wall-start-y" type="number" step="0.1" v-model.number="wallDraft.startY" :disabled="wallIsExterior"></label><label>End X<input data-testid="wall-end-x" type="number" step="0.1" v-model.number="wallDraft.endX" :disabled="wallIsExterior"></label><label>End Y<input data-testid="wall-end-y" type="number" step="0.1" v-model.number="wallDraft.endY" :disabled="wallIsExterior"></label></div>
          <label class="wall-thickness">Thickness · m<input data-testid="wall-thickness" type="number" min="0.01" step="0.01" v-model.number="wallDraft.thicknessM" :disabled="wallIsExterior"></label>
          <label class="wall-material">Illustrative material<select data-testid="wall-material" :value="selectedMaterial" :disabled="wallIsExterior" @change="setWallMaterial(($event.target as HTMLSelectElement).value)"><option v-for="material in scene.materials" :key="material.id" :value="material.id">{{ material.name }}</option></select></label>
          <button data-testid="wall-apply" class="wall-apply" :disabled="wallIsExterior" @click="applyWallGeometry">Apply geometry</button>
        </section>
        <div class="reading-card"><div class="reading-top"><span>{{ quantity }}</span><span class="reading-unit">{{ unit }}</span></div><div class="reading-number" data-testid="probe-value">{{ displayValue }}<small> {{ unit }}</small></div><div class="reading-baseline"><span class="measure-line"></span><span>{{ domain === 'sound' ? `Reference at ${settings.mode === 'acoustics' ? settings.referenceDistanceM : 1} m` : 'At selected receiver' }}</span><span class="baseline-value">{{ domain === 'sound' ? '0 dB' : 'received' }}</span></div></div>
        <div v-if="probe && source" class="measurements"><div class="metric-row"><span>Distance from {{ domain === 'sound' ? 'speaker' : 'access point' }}</span><strong>{{ distance }}</strong></div><div v-if="exact?.travelTimeMs" class="metric-row"><span>Direct travel time</span><strong>{{ Number(exact.travelTimeMs).toFixed(2) }} ms</strong></div><div class="metric-row"><span>Intersected assemblies</span><strong>{{ exact?.crossings?.length ?? 0 }} <small>{{ (exact?.crossings?.length ?? 0) === 1 ? 'wall' : 'walls' }}</small></strong></div></div><p v-else-if="!probe" class="empty-inspector-state" data-testid="no-probes">This home has no study probes. Add one in Edit home to inspect a reading.</p><p v-else class="empty-inspector-state" data-testid="no-active-source">There is no active source for this domain, so no distance or wall losses can be shown.</p>
        <LossBreakdown :budget="lossBudget" :selected-term-id="selectedLossTermId" @select="selectLossTerm" @clear="clearLossHighlight" />
        <div class="inspector-divider"></div>
        <div class="section-label position-label">POSITION <span>METERS</span></div>
        <div class="coordinate-fields"><label><span>X</span><input data-testid="probe-x" type="number" step="0.1" v-model="probePositionDraft.x" :disabled="!probe" @change="setCoordinate('x', $event)"></label><label><span>Y</span><input data-testid="probe-y" type="number" step="0.1" v-model="probePositionDraft.y" :disabled="!probe" @change="setCoordinate('y', $event)"></label><label><span>Z</span><input data-testid="probe-z" aria-label="Probe height above floor" type="number" min="0" :max="levelHeight" step="0.1" v-model="probeHeightDraft" :disabled="!probe" @change="setProbeHeight($event)"></label></div>
        <div class="source-controls"><div class="section-label position-label">{{ domain === 'sound' ? 'SPEAKER' : 'ACCESS POINT' }} POSITION <span>METERS</span></div><div class="coordinate-fields"><label><span>X</span><input data-testid="source-x" type="number" step="0.1" v-model="sourcePositionDraft.x" :disabled="!source" @change="setSourceCoordinate('x', $event)"></label><label><span>Y</span><input data-testid="source-y" type="number" step="0.1" v-model="sourcePositionDraft.y" :disabled="!source" @change="setSourceCoordinate('y', $event)"></label><label><span>Z</span><input data-testid="source-z" aria-label="Source height above floor" type="number" min="0" :max="levelHeight" step="0.1" v-model="sourceHeightDraft" :disabled="!source" @change="setSourceHeight($event)"></label></div></div>
        <p data-testid="field-receiver-plane" class="plane-note">Z inputs are height above floor. Field map plane · {{ fixedReceiverHeightAboveFloor.toFixed(1) }} m above floor</p><div v-if="fixedReceiverOutsideLevel" data-testid="field-plane-status" class="project-notice" role="status">The field map plane is above this level’s ceiling, so the field is masked. Raise the ceiling to 1.5 m or more to show it.</div>
        <label class="frequency-control"><span>Frequency</span><select data-testid="frequency-select" :value="settings.frequencyHz" @change="setFrequency(($event.target as HTMLSelectElement).value)"><option v-for="option in frequencyOptions" :key="option.frequencyHz" :value="option.frequencyHz" :disabled="!option.supported && option.frequencyHz !== settings.frequencyHz">{{ frequencyLabel(option.frequencyHz) }}{{ option.supported ? '' : ' · incomplete profiles' }}</option></select></label>
        <p v-if="missingBandNames && !(settings.mode === 'acoustics' && !settings.transmissionEnabled)" class="material-band-notice" data-testid="material-band-notice">Current band is missing data for {{ missingBandNames }}. Only paths crossing these assemblies are unavailable.</p>
        <button class="all-readings-button" data-testid="survey-open" :disabled="experimentsDisabled" @click="openSurvey"><span>Measurement survey</span><span>Review ↗</span></button>
        <button class="all-readings-button" data-testid="materials-open" :disabled="experimentsDisabled" @click="openMaterials"><span>Materials and bands</span><span>Edit ↗</span></button>
        <div class="explanation"><div class="explanation-mark">i</div><div><strong>{{ !probe || (exact && !exact.valid) ? 'No valid reading' : 'Why this reading?' }}</strong><p>{{ !probe ? 'This home has no study probes. Add one in Edit home to inspect a reading.' : !source ? 'There is no active source for this domain, so the solver cannot calculate a reading.' : exact && !exact.valid ? ({ 'inside-solid': 'This point is inside a wall. Move it into the room.', 'outside-floor': 'This point is outside the modeled floor.', 'below-model-distance': 'This point is closer than the model minimum distance.', 'missing-parameter': 'A material assumption is missing for this frequency.', 'unsupported-geometry': 'This point falls in unsupported geometry.' } as Record<string, string>)[exact.reason ?? ''] ?? 'The point is invalid for this model.' : pathExplanation }}</p><button @click="openDialog(methodDialog, $event.currentTarget as HTMLButtonElement)">View model assumptions <span>↗</span></button></div></div>
        <div v-if="rendererNotice" data-testid="renderer-notice" class="project-notice" role="status">{{ rendererNotice }}</div><div v-if="storageNotice" data-testid="storage-error" class="project-notice" role="status">{{ storageNotice }}</div><div v-if="projectNotice" data-testid="project-error" class="project-notice" role="status">{{ projectNotice }}</div><div class="local-note">Projects save in this browser on this device. Import replaces this scene and its baseline.</div>
        <div v-if="comparisonProblems.length" data-testid="comparison-reason" class="project-notice" role="status">{{ comparisonProblems.join(' ') }}</div><div class="inspector-bottom"><button class="save-baseline" :disabled="!field || busy" @click="saveBaseline"><span>＋</span> {{ baseline ? 'Replace saved baseline' : 'Save as baseline' }}</button><button v-if="baseline && canCompare" class="probe-select" @click="toggleComparison">{{ compare ? '● Difference view' : '● Show baseline difference' }}</button></div>
      </aside>
    </section>
    <dialog ref="homeDialog" data-testid="home-builder-dialog" class="workspace-dialog" aria-label="Create a home" @close="closeWorkspaceDialog"><p v-if="projectNotice" role="alert" class="home-create-error">{{ projectNotice }}</p><HomeBuilder @create="createHome" @cancel="homeDialog?.close()" /></dialog>
    <dialog ref="editorDialog" data-testid="scene-editor-dialog" class="workspace-dialog" aria-label="Edit home geometry" @close="closeWorkspaceDialog"><SceneEditor :key="projectFlowGeneration" :scene="scene" :reference-image="referenceImage" @command="commitCommand" @cancel="editorDialog?.close()" /></dialog>
    <dialog ref="readingsDialog" data-testid="probe-readings-dialog" class="workspace-dialog" aria-label="All probe readings" @close="closeReadings"><ProbeReadings v-if="readingsOpen" :scene="scene" :settings="settings" :baseline="readingsBaseline" :selected-id="probe?.id" @select="selectReadingProbe" @close="readingsDialog?.close()" /></dialog>
    <dialog ref="surveyDialog" data-testid="survey-dialog" class="workspace-dialog" aria-label="Measurement survey" @close="closeSurvey"><SurveyPanel v-if="surveyOpen" :scene="scene" :settings="settings" :survey="survey" :comparison="surveyComparison" :disabled="experimentsDisabled" :error="surveyError" :notice="surveyNotice" @import="surveyWorkspace.importText" @clear="surveyWorkspace.remove" @template="downloadSurvey(true)" @export="downloadSurvey(false)" @close="surveyDialog?.close()" /></dialog>
    <dialog ref="materialsDialog" data-testid="materials-dialog" class="workspace-dialog materials-dialog" aria-label="Materials and bands" @close="closeMaterials"><MaterialEditor v-if="materialsOpen" :scene="scene" :settings="settings" :disabled="experimentsDisabled" :error="materialError" :notice="materialNotice" @apply="materialEditing.apply" @clear-feedback="materialEditing.reset" @close="materialsDialog?.close()" /></dialog>
    <dialog ref="placementDialog" data-testid="placement-dialog" class="workspace-dialog placement-dialog" aria-label="Source placement explorer" @close="closePlacement"><PlacementExplorer v-if="placementOpen" :scene="scene" :settings="settings" :field="placementCoverageField" :running="placementRunning" :progress="placementProgress" :result="placementResult" :error="placementError" :notice="placementNotice" :disabled="experimentsDisabled" @configure="placementSearch.configure" @run="placementSearch.run" @cancel="placementSearch.cancel" @apply="applyPlacement" @close="placementDialog?.close()" /></dialog>
    <dialog ref="experimentsDialog" data-testid="experiments-dialog" class="workspace-dialog experiments-dialog" aria-label="Named experiments" @close="closeWorkspaceDialog"><ExperimentLibrary :key="projectFlowGeneration" :experiments="experiments" :scene="scene" :settings="settings" :reference-image="referenceImage" :baseline-experiment-id="baselineExperimentId" :disabled="experimentsDisabled" :error="experimentError" :notice="experimentNotice" @save="experimentLibrary.save" @open="experimentLibrary.load" @baseline="experimentLibrary.useBaseline" @duplicate="experimentLibrary.duplicate" @update="experimentLibrary.update" @remove="experimentLibrary.remove" @close="experimentsDialog?.close()" /></dialog>
    <dialog ref="libraryDialog" class="workspace-dialog home-library" aria-labelledby="homes-title" @close="closeWorkspaceDialog"><button class="export-button" autofocus @click="libraryDialog?.close()">Close</button><span class="section-label">ON THIS DEVICE</span><h2 id="homes-title">Your homes</h2><p>Projects stay in this browser. Export a JSON backup to keep a portable copy.</p><label>Project name<input v-model="projectName" :disabled="workspaceBusy" maxlength="256" aria-label="Project name"></label><p v-if="libraryError" role="alert">{{ libraryError }}</p><button v-for="home in savedHomes" :key="home.id" class="saved-home" :disabled="workspaceBusy" @click="openSavedHome(home.id)"><strong>{{ home.id === projectDoc?.metadata.id ? projectName.trim() || 'Untitled home' : home.name }}</strong><span>{{ new Date(home.updatedAt).toLocaleString() }}</span></button><p v-if="!savedHomes.length && !libraryError">No saved homes yet.</p><OfflineWorkspace :state="offlineState" :disabled="experimentsDisabled || offlineState.busy" :action-error="offlineActionError" @enable="offlineWorkspace.enable" @check="offlineWorkspace.checkForUpdate" @update="reloadOfflineUpdate" @disable="offlineWorkspace.disable" @persist="offlineWorkspace.requestPersistence" /></dialog>
    <dialog ref="methodDialog" class="method-panel" aria-labelledby="method-dialog-title" @close="restoreDialogFocus('method')"><button class="close-method" aria-label="Close method notes" autofocus @click="closeMethodDialog">×</button><span class="section-label">MODEL NOTES</span><h2 id="method-dialog-title">Model notes</h2><p class="method-intro">Cha Waves computes a direct-path field from the scene geometry. It is designed for comparing changes in this apartment, not for certified room or network planning.</p><div class="method-row"><b>Sound</b><p>Distance loss from a point source with configured transmission through crossed assemblies. Relative direct level in dB; reflections and diffraction are not modeled.</p></div><div class="method-row"><b>Wi-Fi</b><p>Free-space path loss with configured wall losses at the selected band. Received power in dBm; multipath, antenna patterns, and throughput are not modeled.</p></div><div class="method-row"><b>Geometry</b><p>Walls and doors shape the computation. Furnishings and room labels are visual guides only. Move the source or probe and the field is recomputed locally in your browser.</p></div><div class="method-note">Computed locally · No data leaves this tab</div></dialog>
    <dialog ref="guidedDialog" class="guided-panel" aria-labelledby="guided-dialog-title" @close="restoreDialogFocus('guided')"><div class="guided-heading"><div><span class="section-label">GUIDED HOME STUDY</span><h2 id="guided-dialog-title">Test one change at a time.</h2></div><button class="close-method" aria-label="Close guided home study" autofocus @click="closeGuidedDialog">×</button></div><p class="method-intro">Start from an authored home example, read the exact direct-path estimate, then apply one controlled change. The example is saved as one undoable scene change.</p><label class="scenario-picker-label" for="scenario-select">Choose an example</label><select id="scenario-select" data-testid="scenario-select" :value="selectedScenario?.id" @change="chooseScenario(($event.target as HTMLSelectElement).value)"><option v-for="scenario in HOME_SCENARIOS" :key="scenario.id" :value="scenario.id">{{ scenario.title }}</option></select><section v-if="selectedScenario" class="scenario-card"><h3>{{ selectedScenario.title }}</h3><p>{{ selectedScenario.description }}</p><div class="scenario-baseline"><span>Authored baseline at {{ selectedScenario.scene.probes[0]?.name ?? 'probe' }}</span><strong>{{ readingText(scenarioBaselineReading, selectedScenario.settings) }}</strong></div><button data-testid="scenario-load" class="scenario-action" @click="loadGuidedBaseline">Load baseline example</button><label class="scenario-picker-label" for="intervention-select">Select a guided change</label><select id="intervention-select" :value="guidedInterventionId" @change="guidedInterventionId = ($event.target as HTMLSelectElement).value"><option v-for="item in selectedScenario.interventions" :key="item.id" :value="item.id">{{ item.title }}</option></select><p v-if="guidedPreviewIntervention" class="scenario-instruction">{{ guidedPreviewIntervention.instruction }}</p><div class="scenario-candidate" v-if="guidedPreviewIntervention"><span>Exact estimate after this change</span><strong>{{ readingText(guidedPreviewReading, guidedPreviewIntervention.settings) }}</strong><small>Change from authored baseline: {{ readingDelta(scenarioBaselineReading, guidedPreviewReading, selectedScenario.settings) }}</small></div><button data-testid="scenario-apply" class="scenario-action primary" :disabled="!guidedPreviewIntervention" @click="applyGuidedIntervention">Apply guided change</button><div v-if="loadedInterventionId" data-testid="scenario-result" class="scenario-result" role="status"><strong>Current exact reading at authored probe: {{ readingText(scenarioCurrentReading, settings) }}</strong><span>{{ selectedIntervention?.title }} · {{ scenarioCurrentDelta }} from authored baseline</span><small>Recomputed with evaluatePoint at the authored probe location. A delta appears only when the current field mode and probe position match the authored comparison.</small></div></section></dialog>
  </main>
</template>

<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18292b;background:#f3efe7;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0;min-width:320px}.app-shell{min-height:100vh;background:#f3efe7}.topbar{height:64px;border-bottom:1px solid #dcd6cb;background:#f9f6ef;display:flex;align-items:center;padding:0 24px;gap:28px}.brand{display:flex;align-items:center;gap:9px;width:205px;color:#1c3031;text-decoration:none;font-family:Georgia,serif;font-size:20px;letter-spacing:-.7px}.brand-mark{font-family:Georgia,serif;font-style:italic;font-size:18px;letter-spacing:-4px;display:grid;place-items:center;width:29px;height:29px;border:1px solid #76827c;border-radius:50%;padding-right:4px}.project-title{display:flex;flex-direction:column;gap:2px;flex:1}.eyebrow,.section-label{font-size:9px;letter-spacing:1.35px;font-weight:700;color:#77817a}.project-title strong{font-family:Georgia,serif;font-size:15px;font-weight:500}.history-controls{display:flex;align-items:center;gap:4px}.icon-button,.view-actions button,.more-button,.expand-button{border:0;background:transparent;color:#52615e;cursor:pointer}.icon-button{font-size:20px;width:32px;height:32px}.icon-button:disabled{opacity:.32}.saved-state{font-size:11px;color:#687672;margin:0 18px;display:flex;gap:7px;align-items:center}.saved-state i,.live-dot{height:6px;width:6px;border-radius:50%;background:#7d9b72}.export-button{height:34px;padding:0 13px;border:1px solid #c7c4ba;background:#fffdf8;border-radius:5px;color:#233737;font-size:12px}.export-button span{padding-left:11px;color:#75817a}.workspace{height:calc(100vh - 64px);min-height:620px;display:grid;grid-template-columns:218px minmax(400px,1fr) 292px}.tool-rail{background:#f8f5ee;border-right:1px solid #ddd7cc;display:flex;flex-direction:column;padding:20px 12px 14px}.domain-switch{height:43px;display:grid;grid-template-columns:1fr 1fr;padding:3px;background:#ebe7dd;border-radius:6px;margin:0 3px 26px}.domain-switch button{border:0;background:transparent;border-radius:4px;color:#66716b;font-size:12px;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer}.domain-switch button.active{background:#fffdf8;color:#203434;box-shadow:0 1px 3px #2738321c}.domain-switch button:first-child.active{color:#a54824}.domain-switch button:last-child.active{color:#096c77}.domain-icon{font-size:16px;line-height:1;font-weight:700}.sound-icon{letter-spacing:-4px;padding-right:4px}.wifi-icon{font-size:25px}.rail-section{margin-bottom:23px}.section-label{padding:0 9px 8px;display:block}.tool-row{height:38px;width:100%;border:0;background:transparent;display:flex;align-items:center;gap:11px;text-align:left;padding:0 9px;border-radius:5px;font-size:12px;color:#4c5b57;cursor:pointer}.tool-row:hover,.tool-row.chosen{background:#ece9e0;color:#213536}.tool-row.chosen{box-shadow:inset 2px 0 #b14d26}.tool-glyph{font-size:16px;width:17px;text-align:center;color:#586760}.source-glyph{color:#ae4c23}.probe-glyph{color:#096c77}.tool-row kbd,.key-hint kbd{font-family:inherit;font-size:9px;color:#969d95;background:#eeece5;padding:2px 4px;border-radius:3px;margin-left:auto}.count{font-family:ui-monospace,monospace;font-size:10px;margin-left:auto;color:#88918a}.door-state{margin-left:auto;font-size:8px;letter-spacing:.7px;color:#97714f}.door-state.open{color:#528173}.scene-card{margin-top:auto;border:1px solid #dfd9ce;border-radius:6px;background:#fbf9f3;padding:11px 10px 8px}.scene-head{width:100%;display:flex;justify-content:space-between;border:0;background:transparent;color:#344441;font-size:11px;font-weight:600;padding:0;cursor:pointer}.tiny-building{font-size:16px;color:#a15332;margin-right:5px}.scene-foot{border-top:1px solid #e9e4da;display:flex;justify-content:space-between;padding-top:8px;margin-top:10px;font-size:10px;color:#7c8780}.layer-list{display:grid;gap:8px;margin:13px 0 2px;padding-left:6px;color:#6a756e;font-size:10px}.rail-bottom{display:flex;gap:10px;padding:13px 4px 0;justify-content:space-around}.key-hint{display:flex;align-items:center;gap:3px;font-size:9px;color:#89918b}.key-hint kbd{margin:0;font-size:8px}.viewport-column{min-width:0;display:flex;flex-direction:column;background:#ede9df}.viewport-toolbar{height:49px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid #dcd6ca;background:#f3efe7}.viewport-toolbar>div:first-child{display:flex;align-items:center;gap:9px}.view-caption{font-size:11px;font-weight:650;color:#30413e}.dot-separator,.view-subtitle{color:#8c938b;font-size:11px}.live-dot{width:7px;height:7px}.view-actions{display:flex;gap:7px}.view-actions button{height:28px;padding:0 8px;font-size:11px;border-radius:4px}.view-actions button:hover,.view-actions button.active{background:#e4e1d7;color:#253737}.canvas-wrap{position:relative;flex:1;min-height:350px;overflow:hidden}.canvas-wrap canvas{width:100%;height:100%;display:block;touch-action:none;cursor:crosshair}.north-mark{position:absolute;top:19px;right:21px;display:flex;flex-direction:column;align-items:center;color:#50615b;font:10px ui-monospace,monospace}.north-mark b{font-size:19px;font-weight:400;line-height:17px}.scale-mark{position:absolute;bottom:20px;right:22px;display:flex;align-items:center;gap:7px;color:#65726c;font:10px ui-monospace,monospace}.scale-mark i{width:38px;height:4px;border:1px solid #68756d;border-top:0}.canvas-status{position:absolute;left:18px;bottom:16px;background:#faf8f1eF;border:1px solid #d8d2c7;border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 3px 14px #353f3210}.status-wave{font-size:24px;color:#af4d27}.canvas-status strong,.canvas-status small{display:block}.canvas-status strong{font-size:10px;font-weight:650;color:#33423e}.canvas-status small{font-size:9px;color:#7c8780;margin-top:3px}.status-spinner{margin-left:5px;width:7px;height:7px;border-radius:50%;border:1.5px solid #af4d27;opacity:.35}.status-spinner.spinning{border-top-color:transparent;opacity:1;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.error-toast{position:absolute;top:14px;left:14px;max-width:80%;background:#fff3e9;color:#8d351c;border:1px solid #d9a68f;padding:10px;border-radius:4px;font-size:11px}.field-footer{height:80px;background:#faf8f2;border-top:1px solid #dcd6ca;display:flex;align-items:center;padding:0 18px;gap:20px}.provenance{display:flex;align-items:center;gap:9px;min-width:190px}.provenance-icon{width:27px;height:27px;border-radius:50%;background:#eee9df;display:grid;place-items:center;color:#78867e;font-size:19px}.provenance strong,.provenance small{display:block}.provenance strong{font-size:10px;color:#33413d}.provenance small{font-size:9px;color:#7d8780;margin-top:4px}.text-link{padding:0;border:0;background:none;color:#326d70;font-size:9px;text-decoration:underline;cursor:pointer}.legend-wrap{flex:1;max-width:340px;margin:auto}.legend-label,.legend-ticks{display:flex;justify-content:space-between;color:#758078;font-size:9px}.legend-label{margin-bottom:7px}.legend-label span:first-child{font-weight:600;color:#586660}.legend-bar{height:8px;display:flex;border-radius:2px;overflow:hidden}.legend-bar span{flex:1}.legend-ticks{margin-top:4px;font-family:ui-monospace,monospace;font-size:8px}.expand-button{font-size:17px;color:#7b857e}.inspector{background:#faf8f2;border-left:1px solid #dcd6ca;padding:24px 19px 15px;display:flex;flex-direction:column;min-width:0}.inspector-heading{display:flex;justify-content:space-between;align-items:start;margin-bottom:21px}.inspector-heading .section-label{padding:0;margin-bottom:8px}.inspector-heading h1{font-family:Georgia,serif;font-weight:400;font-size:22px;letter-spacing:-.5px;margin:0 0 5px;color:#1d302f}.inspector-heading p{font-size:10px;color:#828b83;margin:0}.more-button{font-size:15px;letter-spacing:1px}.reading-card{padding:15px 14px 12px;background:#f2eee5;border:1px solid #e2dcd0;border-radius:6px}.reading-top{display:flex;justify-content:space-between;font-size:10px;color:#6d7972}.reading-unit{font-family:ui-monospace,monospace;color:#929991}.reading-number{font-family:Georgia,serif;font-size:39px;letter-spacing:-1.5px;margin:8px 0 11px;color:#233735}.reading-number small{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:0;color:#758078}.reading-baseline{display:flex;align-items:center;gap:7px;font-size:9px;color:#818a83}.measure-line{height:1px;flex:1;background:#d5cfc3}.baseline-value{color:#54635d;font-family:ui-monospace,monospace}.measurements{padding:10px 2px 2px}.metric-row{min-height:35px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #eae5db;font-size:10px;color:#758079}.metric-row strong{font-family:ui-monospace,monospace;font-size:11px;font-weight:500;color:#30413d}.metric-row strong small{font:9px ui-sans-serif,system-ui;color:#859087}.inspector-divider{height:1px;background:#e4ded3;margin:18px 0}.position-label{padding:0;margin-bottom:10px}.position-label span{float:right;font-size:8px;letter-spacing:1px;color:#9aa097}.coordinate-fields{display:flex;gap:8px}.coordinate-fields label{height:38px;border:1px solid #dcd6ca;background:#fffdf8;border-radius:4px;display:flex;align-items:center;gap:8px;padding:0 9px;flex:1}.coordinate-fields label span{font:10px ui-monospace,monospace;color:#859087}.coordinate-fields input{width:100%;border:0;outline:0;background:transparent;font:12px ui-monospace,monospace;color:#253936}.explanation{display:flex;gap:10px;padding:14px 0;margin-top:10px}.explanation-mark{width:17px;height:17px;flex:none;border:1px solid #aeb9ad;border-radius:50%;display:grid;place-items:center;color:#66806f;font:italic 11px Georgia}.explanation strong{font-family:Georgia,serif;font-size:13px;font-weight:500;color:#354541}.explanation p{font-size:10px;line-height:1.55;color:#748079;margin:5px 0 7px}.explanation button{padding:0;border:0;background:none;color:#366f70;font-size:9px;cursor:pointer}.explanation button span{margin-left:4px}.inspector-bottom{margin-top:auto;display:grid;gap:8px}.save-baseline{height:38px;border:1px solid #294d4a;background:#254744;border-radius:5px;color:#fffaf1;font-size:11px;cursor:pointer}.save-baseline span{font-size:15px;margin-right:5px}.probe-select{height:33px;border:0;background:transparent;color:#63716b;font-size:10px;cursor:pointer}.probe-select:first-letter{color:#0a737c}.modal-backdrop{position:fixed;z-index:5;inset:0;background:#18292766;display:flex;justify-content:flex-end}.method-panel{position:relative;width:min(460px,100%);height:100%;background:#faf8f2;padding:54px 38px;box-shadow:-10px 0 40px #18292722;overflow:auto}.close-method{position:absolute;right:24px;top:20px;border:0;background:transparent;font-size:25px;color:#61706a;cursor:pointer}.method-panel>.section-label{padding:0}.method-panel h2{font:400 32px/1.1 Georgia,serif;letter-spacing:-.7px;margin:15px 0;color:#203534}.method-intro{font-size:13px;line-height:1.6;color:#68766f;margin-bottom:27px}.method-row{border-top:1px solid #e1dbd0;padding:17px 0;display:grid;grid-template-columns:90px 1fr;gap:15px}.method-row b{font:500 13px Georgia,serif;color:#a24c2a}.method-row p{margin:0;font-size:11px;line-height:1.65;color:#63716a}.method-note{margin-top:23px;padding:13px;background:#f0ece3;color:#68776f;font-size:10px;border-radius:4px}
@media(max-width:1150px){.workspace{grid-template-columns:190px minmax(360px,1fr) 260px}.inspector{padding:20px 15px}.provenance{min-width:160px}.field-footer{gap:12px;padding:0 13px}}@media(max-width:850px){.workspace{height:auto;min-height:calc(100vh - 60px);grid-template-columns:64px minmax(0,1fr)}.tool-rail{padding:14px 7px}.domain-switch{height:auto;display:flex;flex-direction:column;margin:0 0 20px;padding:3px}.domain-switch button{height:40px;font-size:0}.domain-icon{font-size:16px}.rail-section .section-label,.tool-row span:not(.tool-glyph),.tool-row kbd,.scene-card,.rail-bottom{display:none}.rail-section{margin-bottom:18px}.tool-row{justify-content:center;padding:0}.tool-glyph{font-size:19px}.viewport-column{min-height:calc(100vh - 60px)}.inspector{grid-column:2;border-left:0;border-top:1px solid #dcd6ca;min-height:350px}.topbar{height:60px;padding:0 13px;gap:12px}.brand{width:auto;font-size:17px}.project-title{display:none}.history-controls{margin-left:auto}.saved-state{display:none}.export-button{padding:0 8px}.field-footer{height:70px}.provenance{min-width:0}.provenance strong{font-size:9px}.provenance small{display:none}.legend-wrap{max-width:220px}.view-subtitle{display:none}}@media(max-width:520px){.workspace{grid-template-columns:48px minmax(0,1fr)}.tool-rail{padding:11px 4px}.viewport-toolbar{height:42px;padding:0 10px}.view-actions{gap:0}.view-actions button{padding:0 5px;font-size:10px}.canvas-wrap{min-height:390px}.field-footer{padding:0 8px;gap:8px}.provenance-icon,.expand-button{display:none}.provenance{max-width:94px}.provenance strong{line-height:1.3}.legend-wrap{max-width:none}.legend-label{font-size:8px}.legend-ticks{font-size:7px}.reading-number{font-size:34px}.inspector{padding:18px 14px}.method-panel{padding:45px 23px}}
.canvas-status.cutaway-compute{top:16px;bottom:auto;left:auto;right:16px}
.comparison-surface{position:absolute;inset:0;overflow:auto;border:0;border-radius:0;padding:18px;background:#f3efe7}.viewport-toolbar{gap:8px}.view-actions{flex-shrink:0}@media(max-width:650px){.viewport-toolbar .backend-label,.viewport-toolbar .view-caption{display:none}.comparison-surface{padding:10px}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #176d70;outline-offset:3px}
@media(max-width:850px){.project-actions .method-button{display:inline-flex;align-items:center;justify-content:center}}
@media(max-width:520px){.project-actions .method-button{display:inline-flex;align-items:center;justify-content:center}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #176d70;outline-offset:3px}
dialog.method-panel,dialog.guided-panel{border:0;margin:0 0 0 auto;max-width:100vw;max-height:100dvh}
dialog.method-panel::backdrop,dialog.guided-panel::backdrop{background:#18292799;backdrop-filter:blur(2px)}
dialog.method-panel{width:min(460px,100%);height:100dvh;padding:54px 38px 30px}
dialog.guided-panel{width:min(560px,100%);height:100dvh;background:#faf8f2;color:#253735;padding:33px 36px;box-shadow:-10px 0 40px #18292722;overflow:auto}
.guided-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.guided-heading .section-label{padding:0}.guided-heading h2{font:400 30px/1.08 Georgia,serif;letter-spacing:-.6px;margin:12px 0 4px;color:#203534}.guided-panel .method-intro{margin:10px 0 23px}.guided-panel select{width:100%;height:40px;padding:0 11px;border:1px solid #d3cdc1;border-radius:4px;background:#fffdf8;color:#283b38;font:12px ui-sans-serif,system-ui}.scenario-picker-label{display:block;margin:12px 0 7px;color:#68766f;font-size:10px;font-weight:650}.scenario-card{margin-top:17px;padding:17px 16px 15px;border:1px solid #e0d9ce;border-radius:6px;background:#f4f0e7}.scenario-card h3{margin:0 0 6px;color:#213634;font:500 19px Georgia,serif}.scenario-card>p{margin:0 0 13px;color:#6c7972;font-size:11px;line-height:1.5}.scenario-baseline,.scenario-candidate{display:flex;flex-direction:column;gap:5px;padding:12px 11px;border:1px solid #e2dbd0;border-radius:4px;background:#fbf9f3}.scenario-baseline span,.scenario-candidate span{color:#77827a;font-size:9px;letter-spacing:.25px}.scenario-baseline strong,.scenario-candidate strong{font:500 21px Georgia,serif;color:#253936}.scenario-action{width:100%;min-height:38px;margin-top:11px;border:1px solid #aab6aa;border-radius:4px;background:#fffdf8;color:#31544f;font-size:11px;font-weight:650;cursor:pointer}.scenario-action.primary{border-color:#294d4a;background:#254744;color:#fffaf1}.scenario-action:disabled{opacity:.45;cursor:not-allowed}.scenario-instruction{margin:11px 0 9px!important;padding-left:10px;border-left:2px solid #bb7049;color:#62716a!important}.scenario-candidate small,.scenario-result small{color:#76827a;font-size:9px;line-height:1.45}.scenario-result{display:grid;gap:7px;margin-top:12px;padding:12px;border:1px solid #b6c8b9;border-radius:4px;background:#edf3ec}.scenario-result strong{font:500 15px Georgia,serif;color:#284743}.scenario-result span{font-size:10px;color:#44625b}.scenario-result small{line-height:1.5}
.mobile-object-picker{display:none}
@media(max-width:850px){.mobile-object-picker{display:grid;gap:5px;margin:0 0 16px;padding:10px 11px;border:1px solid #e1dbd0;border-radius:5px;background:#f4f0e7}.mobile-object-picker label{color:#68766f;font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase}.mobile-object-picker select{width:100%;height:37px;padding:0 8px;border:1px solid #d5cec1;border-radius:4px;background:#fffdf8;color:#2b3d39;font-size:11px}.mobile-object-picker span{font:12px Georgia,serif;color:#315c58}.project-actions .guide-button{display:inline-flex;align-items:center;justify-content:center}.project-actions .method-button{display:inline-flex;align-items:center;justify-content:center}}
@media(max-width:520px){dialog.guided-panel{padding:26px 19px}.guided-heading h2{font-size:26px}dialog.method-panel{padding:50px 23px 25px}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
.source-controls{margin-top:15px}
.material-band-notice{margin:8px 0;color:#814022;font-size:12px;line-height:1.5;overflow-wrap:anywhere}.frequency-control{display:flex;align-items:center;justify-content:space-between;margin-top:13px;font-size:10px;color:#758079}
.frequency-control select{min-width:100px;height:30px;border:1px solid #dcd6ca;background:#fffdf8;border-radius:4px;padding:0 8px;color:#30413d;font:11px ui-monospace,monospace}





.view-actions button:disabled,.save-baseline:disabled{opacity:.45;cursor:not-allowed}
.read-only-row{cursor:default}
.canvas-wrap.stale canvas{opacity:.48}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #174fb6;outline-offset:2px}
.project-actions{display:flex;gap:6px;align-items:center}.project-actions .export-button{white-space:nowrap}.project-actions .export-button:disabled{opacity:.4;cursor:not-allowed}.saved-state i.failed{background:#b6452b}.saved-state i.saving{background:#b77b36;animation:spin 1s linear infinite}
.workspace-dialog.materials-dialog{width:min(900px,96vw)}.experiments-dialog,.placement-dialog{width:min(1040px,96vw)}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.object-list{margin:8px 3px 0;padding:9px 8px;border:1px solid #e5e0d6;border-radius:5px;color:#50615b;font-size:10px}.object-list summary{cursor:pointer;font-weight:650}.object-list button{width:100%;display:flex;justify-content:space-between;margin-top:7px;padding:3px 0;border:0;background:transparent;color:#52615b;text-align:left;font-size:10px;cursor:pointer}.object-list button[aria-current=true]{color:#196a6d;font-weight:700}.object-list small{color:#929990;font-size:9px}
.inspector{overflow:auto}.wall-editor{padding:12px;margin:-5px 0 16px;background:#f0ece3;border:1px solid #e1dbd0;border-radius:5px}.wall-editor>.section-label{display:flex;justify-content:space-between;gap:8px;font-size:8px}.wall-editor>.section-label span{color:#9a6a3b;font-size:7px}.wall-title{display:block;margin:7px 0 9px;font:15px Georgia,serif;color:#344641}.wall-lock-note{margin:0 0 9px;color:#8a6848;font-size:9px;line-height:1.4}.wall-coordinate-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.wall-coordinate-grid label,.wall-thickness,.wall-material{display:grid;gap:4px;color:#79837b;font-size:8px}.wall-coordinate-grid input,.wall-thickness input,.wall-material select{width:100%;height:29px;padding:0 7px;border:1px solid #d7d1c5;background:#fffdf8;border-radius:3px;color:#30413d;font:11px ui-monospace,monospace}.wall-thickness,.wall-material{margin-top:8px}.wall-coordinate-grid input:disabled,.wall-thickness input:disabled,.wall-material select:disabled{opacity:.55}.wall-apply{width:100%;height:31px;margin-top:10px;border:1px solid #526e68;background:#e9eee7;border-radius:4px;color:#315550;font-size:9px;font-weight:650;cursor:pointer}.wall-apply:disabled{opacity:.45;cursor:not-allowed}.project-notice{margin:8px 0;padding:9px;background:#fff1e5;border:1px solid #dfb597;border-radius:4px;color:#814022;font-size:9px;line-height:1.4}.local-note{margin:7px 0;color:#879087;font-size:8px;line-height:1.45}
.backend-label{padding:3px 5px;border:1px solid #ddd7ca;border-radius:3px;color:#899189;font:8px ui-monospace,monospace;white-space:nowrap}.cutaway-surface{position:absolute;inset:0;width:100%;height:100%;display:block}
@media(max-width:850px){.project-actions{gap:3px}.project-actions .export-button{height:30px;padding:0 7px;font-size:10px}.object-list{display:none}}
@media(max-width:520px){.saved-state{display:none}.project-actions .export-button{padding:0 5px}.wall-coordinate-grid{gap:5px}}
.canvas-status.cutaway-compute{top:16px;bottom:auto;left:auto;right:16px}
.comparison-surface{position:absolute;inset:0;overflow:auto;border:0;border-radius:0;padding:18px;background:#f3efe7}.viewport-toolbar{gap:8px}.view-actions{flex-shrink:0}@media(max-width:650px){.viewport-toolbar .backend-label,.viewport-toolbar .view-caption{display:none}.comparison-surface{padding:10px}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #176d70;outline-offset:3px}
@media(max-width:850px){.project-actions .method-button{display:inline-flex;align-items:center;justify-content:center}}
@media(max-width:520px){.project-actions .method-button{display:inline-flex;align-items:center;justify-content:center}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
.eyebrow,.section-label{color:#58645e}
.saved-state{color:#56635c}
.domain-switch button{color:#58645e}
.door-state{color:#765638}
.scene-foot,.key-hint,.view-subtitle,.dot-separator,.backend-label,.provenance small,.legend-label,.legend-ticks{color:#5d6962}
.reading-top,.reading-unit,.reading-number small,.reading-baseline,.metric-row,.metric-row strong small,.coordinate-fields label span,.position-label span,.explanation p,.wall-coordinate-grid label,.wall-thickness,.wall-material,.local-note,.scenario-baseline span,.scenario-candidate span,.scenario-candidate small,.scenario-result small{color:#5d6962}
.wall-lock-note,.wall-editor>.section-label span{color:#735334}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
.method-intro,.method-note,.scenario-picker-label,.mobile-object-picker label,.scenario-card>p,.inspector-heading p,.frequency-control{color:#58645e}
.worker-error{display:grid;gap:8px}.worker-error button{justify-self:start;border:1px solid #b86d4b;border-radius:4px;background:#fffaf5;color:#79351e;padding:6px 9px;font:inherit;font-weight:650;cursor:pointer}.worker-error button:hover{background:#fbe5d8}.worker-error button:focus-visible{outline:2px solid #176d70;outline-offset:3px}
.plan-canvas:focus-visible{outline:3px solid #176d70;outline-offset:-4px}.skip-link{position:fixed;z-index:10;top:8px;left:8px;padding:9px 12px;background:#fffdf8;border:2px solid #176d70;border-radius:4px;color:#183735;font-size:12px;transform:translateY(-160%)}.skip-link:focus{transform:translateY(0)}
.focus-plan-button{justify-self:start;border:1px solid #71857b;border-radius:4px;background:#fffdf8;color:#315b56;padding:7px 9px;font-size:10px;cursor:pointer}.focus-plan-button:focus-visible{outline:2px solid #176d70;outline-offset:2px}
@media(max-width:520px){.topbar{height:auto;min-height:84px;display:grid;grid-template-columns:1fr auto;grid-template-areas:"brand history" "actions actions";gap:7px 8px;padding:8px 10px}.brand{grid-area:brand}.history-controls{grid-area:history;margin-left:0}.project-actions{grid-area:actions;width:100%;justify-content:space-between;gap:4px}.project-actions .export-button{height:30px;min-width:0;flex:1;padding:0 4px;font-size:9px}.project-actions .export-button span{padding-left:2px}.workspace{min-height:calc(100vh - 84px)}.viewport-column{min-height:calc(100vh - 84px)}}
.door-picker-label{display:block;margin:0 8px 4px;color:#58645e;font-size:8px;font-weight:650;letter-spacing:.5px;text-transform:uppercase}
.door-select{width:calc(100% - 16px);height:30px;margin:0 8px 5px;padding:0 7px;border:1px solid #dcd6ca;border-radius:4px;background:#fffdf8;color:#30413d;font-size:10px}
.tool-row:disabled{opacity:.5;cursor:not-allowed}
.plane-note{margin:8px 1px 0;color:#65736a;font-size:9px;line-height:1.45}
@media(max-width:850px){.door-picker-label,.door-select{display:none}}
@media(max-width:360px){.coordinate-fields{gap:5px}.coordinate-fields label{gap:4px;padding:0 6px}.coordinate-fields label span{font-size:9px}.coordinate-fields input{font-size:11px;min-width:0}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style scoped>
.workspace-dialog{border:1px solid #c6cbbd;background:#faf8f2;color:#253735;width:min(1160px,96vw);max-width:96vw;max-height:94dvh;padding:0;border-radius:12px;box-shadow:0 24px 90px #142b2855;overflow:auto}.workspace-dialog::backdrop{background:#18292799;backdrop-filter:blur(3px)}.home-library{padding:30px;width:min(560px,94vw)}.home-library h2{font-size:32px}.home-library label{display:grid;gap:8px;margin:20px 0}.home-library input{padding:12px;border:1px solid #b8beb3;background:#fffdf8;color:inherit}.saved-home{display:flex;flex-direction:column;gap:8px;text-align:left;background:transparent;color:inherit;border:0;border-top:1px solid #d5d8cd;padding:20px 0;width:100%;cursor:pointer}.saved-home span{font-size:12px;color:#65726a}.reference-toggle{display:flex;gap:7px;font-size:12px;padding:8px}.project-actions{flex-wrap:wrap}.topbar{height:auto;min-height:76px}@media(max-width:760px){.project-title{display:none}.project-actions{gap:4px}.project-actions .export-button{padding:7px 6px;font-size:11px}.topbar{padding:12px;gap:8px;flex-wrap:wrap}.workspace-dialog{max-height:96dvh;width:96vw}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style scoped>
@media(max-width:850px){.reference-toggle{flex-direction:column;align-items:center;overflow-wrap:anywhere;text-align:center;font-size:9px;padding:7px 0}}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style scoped>
.all-readings-button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 20px;padding:12px 0;color:#285c57;background:transparent;border:0;border-bottom:1px solid #c9d1c6;text-align:left;cursor:pointer;font:600 12px ui-sans-serif,system-ui}.all-readings-button span:last-child{font:11px ui-monospace,monospace;color:#52645b}.all-readings-button:hover{color:#9d4e2d}.all-readings-button:focus-visible{outline:2px solid #26716c;outline-offset:3px}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>

<style>
.plan-navigation-overlay{position:absolute;top:12px;left:12px;max-width:calc(100% - 24px);z-index:2}
.canvas-wrap.pan-ready .plan-canvas{cursor:grab}.canvas-wrap.panning .plan-canvas{cursor:grabbing}
@media(max-width:520px){.project-actions .export-button{flex:1 0 auto;padding:0 6px;font-size:10px}}
</style>
