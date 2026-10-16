<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { applySceneCommand, SceneCommandError, type SceneCommand } from '../../../../packages/commands'
import { isExteriorEnvelopeWall, type Scene } from '../../../../packages/engine'
import type { FloorPlanReference } from '../../../../packages/floorplan'
import PlanNavigation from './PlanNavigation.vue'
import DraftingOverlay from './DraftingOverlay.vue'
import { layoutWallDimensions, snapDraftPoint, type DimensionSegment } from '../lib/drafting'
import { createPlanTransform, fitPlanView, MAX_PLAN_ZOOM, MIN_PLAN_ZOOM, panPlanView, zoomPlanView, type PlanBounds, type PlanView } from '../lib/plan-viewport'

type Point = [number, number]
type Bounds = { x: number; y: number; width: number; height: number }

const props = defineProps<{ scene: Scene; referenceImage?: FloorPlanReference | undefined }>()
const emit = defineEmits<{ command: [command: SceneCommand]; cancel: [] }>()
const level = computed(() => props.scene.levels[0]!)
const planHelpId = useId()
const junctionHelpId = useId()
const splitHelpId = useId()

const selectedWallId = ref('')
const selectedOpeningId = ref('')
const selectedProbeId = ref('')
const selectedZoneId = ref('')
const selectedEndpoint = ref<'start' | 'end'>('start')
const drawWallMode = ref(false)
const wallFirstPoint = ref<Point | null>(null)
const joinIntersections = ref(false)
const splitOffsetDraft = ref('')
const editorError = ref('')
const notice = ref('Choose a wall to edit it, or start a new wall from the canvas.')
const newWallThicknessDraft = ref('0.12')
const newWallMaterialDraft = ref('')
const wallPropertiesThicknessDraft = ref('0.12')
const wallPropertiesMaterialDraft = ref('')
const endpointX = ref('')
const endpointY = ref('')
const doorOffset = ref('0.5')
const doorWidth = ref('0.9')
const doorHeight = ref('2.1')
const doorMaterial = ref('')
const probeX = ref(String(props.scene.probes[0]?.position[0] ?? 0))
const probeY = ref(String(props.scene.probes[0]?.position[1] ?? 0))
const probeZ = ref(String(props.scene.probes[0]?.position[2] ?? Math.min(1.2, level.value.ceilingHeightM)))
const probeNameDraft = ref('')
const probeNameError = ref('')
const zoneName = ref('Room')
const zonePointsText = ref('')
const gridStep = ref(0.25)
const showDimensions = ref(false)
const hoverPoint = shallowRef<Point | null>(null)
const planZoom = ref(1)
const planCenter = ref<Point | null>(null)
const planSvg = ref<SVGSVGElement | null>(null)
const frameWidth = ref(0)
const frameHeight = ref(0)
const panMode = ref(false)
const panGesture = ref<{ pointerId: number; lastX: number; lastY: number; original: PlanView } | null>(null)
const suppressPanClick = ref(false)
let resizeObserver: ResizeObserver | null = null

const selectedWall = computed(() => props.scene.walls.find(wall => wall.id === selectedWallId.value) ?? null)
const selectedWallReadOnly = computed(() => !!selectedWall.value && isExteriorEnvelopeWall(props.scene, selectedWall.value))
const selectedOpening = computed(() => props.scene.openings.find(opening => opening.id === selectedOpeningId.value) ?? null)
const selectedProbe = computed(() => props.scene.probes.find(probe => probe.id === selectedProbeId.value) ?? null)
const selectedZone = computed(() => props.scene.zones.find(zone => zone.id === selectedZoneId.value) ?? null)
const selectedWallOpenings = computed(() => selectedWall.value ? props.scene.openings.filter(opening => opening.wallId === selectedWall.value!.id) : [])
const wallMaterials = computed(() => props.scene.materials.filter(material => !material.id.toLowerCase().includes('door')))
const defaultWallMaterialId = computed(() => {
  const preferred = ['interior-partition', 'partition', 'home-interior']
  return preferred.find(id => wallMaterials.value.some(material => material.id === id)) ?? wallMaterials.value[0]?.id ?? ''
})
const doorMaterials = computed(() => props.scene.materials.filter(material => material.id.toLowerCase().includes('door')))
const sceneBounds = computed<Bounds>(() => {
  const points = level.value.boundary
  const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]))
  const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]))
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 0.3
  let width = maxX - minX + pad * 2, height = maxY - minY + pad * 2
  const aspect = 1.55
  if (width / height < aspect) width = height * aspect
  else height = width / aspect
  return { x: (minX + maxX - width) / 2, y: -(minY + maxY + height) / 2, width, height }
})
const planBounds = computed<PlanBounds>(() => ({ minX: sceneBounds.value.x, maxX: sceneBounds.value.x + sceneBounds.value.width, minY: -sceneBounds.value.y - sceneBounds.value.height, maxY: -sceneBounds.value.y }))
const fittedView = computed(() => fitPlanView(planBounds.value))
const currentView = computed<PlanView>(() => ({ zoom: planZoom.value, center: planCenter.value ?? fittedView.value.center }))
const cameraTransform = computed(() => createPlanTransform(planBounds.value, frameWidth.value, frameHeight.value, currentView.value))
const cameraCorners = computed(() => [cameraTransform.value.screenToWorld([0, 0]), cameraTransform.value.screenToWorld([Math.max(1, frameWidth.value), Math.max(1, frameHeight.value)])] as [Point, Point])
const cameraBounds = computed(() => ({ x: cameraCorners.value[0][0], y: -cameraCorners.value[0][1], width: cameraCorners.value[1][0] - cameraCorners.value[0][0], height: cameraCorners.value[0][1] - cameraCorners.value[1][1] }))
const cameraViewBox = computed(() => `${cameraBounds.value.x} ${cameraBounds.value.y} ${cameraBounds.value.width} ${cameraBounds.value.height}`)
const pixelsPerMeter = computed(() => cameraTransform.value.scale)
const rulerLengthM = computed(() => {
  const ppm = pixelsPerMeter.value
  if (!Number.isFinite(ppm) || ppm <= 0) return 0
  const raw = 58 / ppm
  if (!Number.isFinite(raw) || raw <= 0) return 0
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  return (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10) * power
})
const rulerPixels = computed(() => rulerLengthM.value * pixelsPerMeter.value)
const selectedWallLength = computed(() => selectedWall.value ? distance(selectedWall.value.start, selectedWall.value.end) : 0)
const snapDescription = computed(() => `Grid ${gridStep.value.toFixed(2)} m · endpoint snap 0.25 m`)
const snapFeedback = computed(() => drawWallMode.value && !panMode.value && !panGesture.value && hoverPoint.value
  ? snapDraftPoint(hoverPoint.value, props.scene.walls, gridStep.value) : null)
const draftEnd = computed(() => wallFirstPoint.value && snapFeedback.value ? snapFeedback.value.point : null)
const dimensionSegments = computed<DimensionSegment[]>(() => {
  const segments: DimensionSegment[] = props.scene.walls
    .filter(wall => showDimensions.value || wall.id === selectedWallId.value)
    .map(wall => ({ id: wall.id, start: wall.start, end: wall.end, ...(wall.id === selectedWallId.value ? { selected: true } : {}) }))
  if (wallFirstPoint.value && draftEnd.value) segments.push({ id: 'wall-draft', start: wallFirstPoint.value, end: draftEnd.value, draft: true })
  return segments
})
const dimensionMarks = computed(() => layoutWallDimensions(dimensionSegments.value,
  point => cameraTransform.value.worldToScreen(point), frameWidth.value, frameHeight.value))
const snapMarker = computed(() => snapFeedback.value ? {
  raw: cameraTransform.value.worldToScreen(snapFeedback.value.raw),
  point: cameraTransform.value.worldToScreen(snapFeedback.value.point), kind: snapFeedback.value.kind,
} : null)
const snapText = computed(() => {
  const feedback = snapFeedback.value
  if (!feedback) return panMode.value || panGesture.value ? 'Pan view · draft preview paused' : 'Move over the plan to preview a snapped point.'
  return `${feedback.kind === 'endpoint' ? 'Endpoint' : 'Grid'} · ${formatPoint(feedback.point)}${feedback.target ? ` · ${feedback.target.wallId} ${feedback.target.endpoint}` : ''}`
})
const snapAnnouncement = computed(() => {
  const feedback = snapFeedback.value
  return !feedback ? '' : feedback.target ? `Endpoint snap on ${feedback.target.wallId}, ${feedback.target.endpoint}.` : `Grid snap at ${gridStep.value.toFixed(2)} metres.`
})
function clearSnapFeedback() { hoverPoint.value = null }
function toggleWallDrawing() {
  drawWallMode.value = !drawWallMode.value
  panMode.value = false
  wallFirstPoint.value = null; editorError.value = ''; clearSnapFeedback()
}

function resetCamera() {
  clearSnapFeedback()
  const fit = fitPlanView(planBounds.value)
  planZoom.value = fit.zoom
  planCenter.value = [...fit.center]
  panMode.value = false
  cancelPan(false, false)
}

function setZoom(next: number, anchor?: { clientX: number; clientY: number }) {
  clearSnapFeedback()
  const svg = planSvg.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const oldZoom = planZoom.value
  const zoom = Number.isFinite(next) ? Math.max(MIN_PLAN_ZOOM, Math.min(MAX_PLAN_ZOOM, next)) : oldZoom
  if (zoom === oldZoom) return
  const pivot = anchor && rect.width > 0 && rect.height > 0
    ? [anchor.clientX - rect.left, anchor.clientY - rect.top] as Point
    : undefined
  const updated = zoomPlanView(planBounds.value, frameWidth.value, frameHeight.value, currentView.value, zoom / oldZoom, pivot)
  planCenter.value = updated.center
  planZoom.value = updated.zoom
}

function zoomBy(factor: number) { setZoom(planZoom.value * factor) }
function togglePanMode() { clearSnapFeedback(); panMode.value = !panMode.value; if (!panMode.value) cancelPan(false) }

function svgPoint(event: MouseEvent | PointerEvent): Point {
  const rect = planSvg.value?.getBoundingClientRect()
  return cameraTransform.value.screenToWorld([rect ? event.clientX - rect.left : 0, rect ? event.clientY - rect.top : 0])
}

function canvasClick(event: MouseEvent) {
  if (suppressPanClick.value) { suppressPanClick.value = false; event.preventDefault(); event.stopPropagation(); return }
  if (!drawWallMode.value) return
  if (!newWallMaterialDraft.value || !wallMaterials.value.some(material => material.id === newWallMaterialDraft.value)) {
    editorError.value = 'This project has no available wall material. Add a wall material before drawing.'
    return
  }
  const raw = svgPoint(event)
  const point = snapDraftPoint(raw, props.scene.walls, gridStep.value).point
  hoverPoint.value = raw
  if (!wallFirstPoint.value) {
    wallFirstPoint.value = point
    notice.value = `Start point ${formatPoint(point)} · choose the other end of the wall.`
    return
  }
  const start: Point = [...wallFirstPoint.value]
  wallFirstPoint.value = null
  if (distance(start, point) < 0.3) { notice.value = 'Wall is too short. Choose endpoints at least 0.3 m apart.'; return }
  const wallId = nextId('wall', props.scene.walls.map(item => item.id))
  submit({ type: 'add-wall', joinIntersections: joinIntersections.value, wall: {
    id: wallId, levelId: level.value.id, start, end: point,
    thicknessM: numberOr(newWallThicknessDraft.value, 0.12), baseZ: level.value.floorZ, heightM: level.value.ceilingHeightM,
    materialId: newWallMaterialDraft.value,
  } })
  if (!editorError.value) {
    selectedWallId.value = wallId
    notice.value = joinIntersections.value ? 'Wall and interior junctions created as one history edit.' : 'Wall created with metre snapping and geometry validation.'
  }
}

function pointerDown(event: PointerEvent) {
  if (panGesture.value || !event.isPrimary) return
  suppressPanClick.value = false
  if (!(event.button === 0 && panMode.value) && event.button !== 1) {
    if (event.button === 0 && drawWallMode.value) hoverPoint.value = svgPoint(event)
    return
  }
  clearSnapFeedback()
  event.preventDefault()
  planSvg.value?.focus({ preventScroll: true })
  panGesture.value = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, original: { zoom: currentView.value.zoom, center: [...currentView.value.center] } }
  suppressPanClick.value = true
  ;(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  if (!panGesture.value) {
    if (event.isPrimary && drawWallMode.value && !panMode.value) hoverPoint.value = svgPoint(event)
    return
  }
  if (panGesture.value.pointerId !== event.pointerId) return
  const svg = planSvg.value
  if (!svg) return
  const dx = event.clientX - panGesture.value.lastX, dy = event.clientY - panGesture.value.lastY
  const updated = panPlanView(planBounds.value, frameWidth.value, frameHeight.value, currentView.value, [dx, dy])
  planCenter.value = updated.center
  planZoom.value = updated.zoom
  panGesture.value.lastX = event.clientX; panGesture.value.lastY = event.clientY
  suppressPanClick.value = true
}

function cancelPan(suppressClick = false, restore = false) {
  const gesture = panGesture.value
  if (restore && gesture) {
    planZoom.value = gesture.original.zoom
    planCenter.value = [...gesture.original.center]
  }
  panGesture.value = null
  if (suppressClick && gesture) suppressPanClick.value = true
  if (gesture && planSvg.value?.hasPointerCapture(gesture.pointerId)) planSvg.value.releasePointerCapture(gesture.pointerId)
}

function pointerUp(event: PointerEvent) {
  if (!panGesture.value || panGesture.value.pointerId !== event.pointerId) return
  cancelPan(true, false)
}

function pointerCancel(event: PointerEvent) { if (panGesture.value?.pointerId === event.pointerId) cancelPan(false, true) }
function lostPointerCapture(event: PointerEvent) { if (panGesture.value?.pointerId === event.pointerId) cancelPan(false, true) }
function handleWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey || panGesture.value || !event.deltaY) return
  event.preventDefault()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frameHeight.value : 1)
  setZoom(planZoom.value * Math.exp(-Math.max(-1000, Math.min(1000, delta)) * .0015), event)
}

function handleCanvasKeydown(event: KeyboardEvent) {
  if (event.target !== planSvg.value) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25); return }
  if (event.key === '-') { event.preventDefault(); zoomBy(.8); return }
  if (event.key === '0') { event.preventDefault(); resetCamera(); return }
  if (event.key.startsWith('Arrow') && panMode.value) {
    event.preventDefault()
    const amount = event.shiftKey ? 80 : 40
    const delta: Point = event.key === 'ArrowLeft' ? [-amount, 0] : event.key === 'ArrowRight' ? [amount, 0] : event.key === 'ArrowUp' ? [0, -amount] : [0, amount]
    const updated = panPlanView(planBounds.value, frameWidth.value, frameHeight.value, currentView.value, delta)
    planCenter.value = updated.center
  }
}

function handleActivePanEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  clearSnapFeedback()
  if (!panGesture.value) return
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.scene-editor')) return
  event.preventDefault(); event.stopPropagation(); panMode.value = false; cancelPan(false, true)
}

function captureCanvasClick(event: MouseEvent) {
  if (suppressPanClick.value || panMode.value) {
    suppressPanClick.value = false
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
  } else if (drawWallMode.value && event.button === 0) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
    canvasClick(event)
  }
}

watch(selectedWall, wall => {
  splitOffsetDraft.value = wall ? String(round(distance(wall.start, wall.end) / 2)) : ''
  if (!wall) return
  wallPropertiesThicknessDraft.value = String(wall.thicknessM)
  wallPropertiesMaterialDraft.value = wall.materialId
  updateEndpointDraft()
}, { immediate: true })
watch(selectedWallId, (id, previousId) => {
  if (id === previousId) return
  selectedOpeningId.value = ''
  doorOffset.value = '0.5'
  doorWidth.value = '0.9'
})
watch([selectedEndpoint, selectedWall], updateEndpointDraft)
watch(selectedOpening, opening => {
  if (!opening) return
  const wall = props.scene.walls.find(item => item.id === opening.wallId)
  if (!wall) return
  const length = distance(wall.start, wall.end)
  doorOffset.value = String(round(opening.fromT * length))
  doorWidth.value = String(round((opening.toT - opening.fromT) * length))
  doorHeight.value = String(opening.heightM)
  doorMaterial.value = opening.materialId ?? ''
})
watch(selectedProbe, probe => {
  if (!probe) return
  probeX.value = String(probe.position[0]); probeY.value = String(probe.position[1]); probeZ.value = String(probe.position[2])
  probeNameDraft.value = probe.name ?? ''
  probeNameError.value = ''
})
watch(selectedZone, zone => {
  if (!zone) return
  zoneName.value = zone.name
  zonePointsText.value = zone.polygon.map(point => `${point[0]}, ${point[1]}`).join('\n')
})

function resetDraftsForScene() {
  clearSnapFeedback()
  joinIntersections.value = false
  selectedWallId.value = ''; selectedOpeningId.value = ''; selectedProbeId.value = ''; selectedZoneId.value = ''
  selectedEndpoint.value = 'start'; drawWallMode.value = false; wallFirstPoint.value = null
  editorError.value = ''; notice.value = 'Choose a wall to edit it, or start a new wall from the canvas.'
  newWallThicknessDraft.value = '0.12'; newWallMaterialDraft.value = defaultWallMaterialId.value
  wallPropertiesThicknessDraft.value = '0.12'; wallPropertiesMaterialDraft.value = defaultWallMaterialId.value
  wallStartX.value = ''; wallStartY.value = ''; wallEndX.value = ''; wallEndY.value = ''
  endpointX.value = ''; endpointY.value = ''
  doorOffset.value = '0.5'; doorWidth.value = '0.9'; doorHeight.value = '2.1'; doorMaterial.value = ''
  probeX.value = String(props.scene.probes[0]?.position[0] ?? 0)
  probeY.value = String(props.scene.probes[0]?.position[1] ?? 0)
  probeZ.value = String(props.scene.probes[0]?.position[2] ?? Math.min(1.2, level.value.ceilingHeightM))
  probeNameDraft.value = ''
  probeNameError.value = ''
  zoneName.value = 'Room'; zonePointsText.value = ''
}

function submit(command: SceneCommand) {
  clearSnapFeedback()
  editorError.value = ''
  try {
    applySceneCommand(props.scene, command)
    emit('command', command)
    notice.value = 'Edit accepted · the scene history has been updated.'
    wallFirstPoint.value = null
  } catch (error) {
    editorError.value = error instanceof SceneCommandError ? error.message : error instanceof Error ? error.message : 'This edit could not be applied.'
  }
}

function addNumericWall() {
  if (!newWallMaterialDraft.value || !wallMaterials.value.some(material => material.id === newWallMaterialDraft.value)) {
    editorError.value = 'This project has no available wall material. Add a wall material before adding a wall.'
    return
  }
  const start: Point = [numberOr(wallStartX.value, NaN), numberOr(wallStartY.value, NaN)]
  const end: Point = [numberOr(wallEndX.value, NaN), numberOr(wallEndY.value, NaN)]
  const wallId = nextId('wall', props.scene.walls.map(item => item.id))
  submit({ type: 'add-wall', joinIntersections: joinIntersections.value, wall: { id: wallId, levelId: level.value.id, start, end, thicknessM: numberOr(newWallThicknessDraft.value, 0.12), baseZ: level.value.floorZ, heightM: level.value.ceilingHeightM, materialId: newWallMaterialDraft.value } })
  if (!editorError.value) selectedWallId.value = wallId
}
const wallStartX = ref(''), wallStartY = ref(''), wallEndX = ref(''), wallEndY = ref('')
resetDraftsForScene()
watch(() => `${props.scene.id}\u0000${props.scene.materials.map(material => material.id).join('\u0000')}`, resetDraftsForScene)
watch(() => props.scene.id, resetCamera)

onMounted(() => {
  const measure = () => {
    const rect = planSvg.value?.getBoundingClientRect()
    frameWidth.value = rect?.width ?? 0
    frameHeight.value = rect?.height ?? 0
  }
  measure()
  if (planSvg.value) {
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(planSvg.value)
  }
  window.addEventListener('blur', handleWindowBlur)
})

function handleWindowBlur() { clearSnapFeedback(); cancelPan(false, true) }

onBeforeUnmount(() => {
  cancelPan(false)
  resizeObserver?.disconnect()
  window.removeEventListener('blur', handleWindowBlur)
})

function updateEndpointDraft() {
  if (!selectedWall.value) return
  const point = selectedWall.value[selectedEndpoint.value]
  endpointX.value = String(point[0]); endpointY.value = String(point[1])
}
function moveEndpoint() {
  if (!selectedWall.value) return
  submit({ type: 'move-connected-endpoint', levelId: selectedWall.value.levelId, from: [...selectedWall.value[selectedEndpoint.value]], to: [numberOr(endpointX.value, NaN), numberOr(endpointY.value, NaN)] })
}
function splitSelectedWall() {
  const wall = selectedWall.value
  if (!wall || selectedWallReadOnly.value) return
  submit({ type: 'split-wall', wallId: wall.id, offsetM: numberOr(splitOffsetDraft.value, NaN) })
  if (!editorError.value) notice.value = `Wall ${wall.id} split as one history edit. Openings keep their physical positions.`
}
function applyWallProperties() {
  const wall = selectedWall.value
  if (!wall) return
  const thicknessM = numberOr(wallPropertiesThicknessDraft.value, NaN)
  const materialId = wallPropertiesMaterialDraft.value
  if (!wallMaterials.value.some(material => material.id === materialId)) {
    editorError.value = 'Choose a wall material available in this project.'
    return
  }
  if (wall.thicknessM === thicknessM && wall.materialId === materialId) return
  submit({ type: 'update-wall', wallId: wall.id, thicknessM, materialId })
  if (!editorError.value) notice.value = `Wall properties updated for ${wall.id}.`
}
function addDoor() {
  if (!selectedWall.value) return
  const materialId = doorMaterial.value || doorMaterials.value[0]?.id
  const openingId = nextId('door', props.scene.openings.map(item => item.id))
  submit({ type: 'add-door', openingId, wallId: selectedWall.value.id, offsetM: numberOr(doorOffset.value, NaN), widthM: numberOr(doorWidth.value, NaN), heightM: numberOr(doorHeight.value, 2.1), ...(materialId ? { materialId } : {}) })
  if (!editorError.value) selectedOpeningId.value = openingId
}
function updateDoor() {
  if (!selectedOpening.value) return
  submit({ type: 'update-opening', openingId: selectedOpening.value.id, offsetM: numberOr(doorOffset.value, NaN), widthM: numberOr(doorWidth.value, NaN), heightM: numberOr(doorHeight.value, NaN), ...(doorMaterial.value ? { materialId: doorMaterial.value } : {}) })
}
function parseZonePoints(): Point[] {
  return zonePointsText.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [x, y, extra] = line.split(/[\s,]+/)
    if (extra !== undefined || !x?.trim() || !y?.trim()) throw new Error('Use one x, y coordinate pair per line.')
    const point: Point = [Number(x), Number(y)]
    if (!point.every(Number.isFinite)) throw new Error('Zone coordinates must be finite numbers.')
    return point
  })
}
function addZone() {
  try {
    const id = nextId('zone', props.scene.zones.map(item => item.id))
    submit({ type: 'add-zone', zone: { id, levelId: level.value.id, name: zoneName.value.trim() || 'Room', polygon: parseZonePoints() } })
    if (!editorError.value) selectedZoneId.value = id
  }
  catch (error) { editorError.value = error instanceof Error ? error.message : 'Zone coordinates are invalid.' }
}
function updateZone() {
  if (!selectedZone.value) return
  try { submit({ type: 'update-zone', zoneId: selectedZone.value.id, name: zoneName.value.trim(), polygon: parseZonePoints() }) }
  catch (error) { editorError.value = error instanceof Error ? error.message : 'Zone coordinates are invalid.' }
}
function addProbe() {
  const id = nextId('probe', props.scene.probes.map(item => item.id))
  submit({ type: 'add-probe', probe: { id, levelId: level.value.id, position: [numberOr(probeX.value, NaN), numberOr(probeY.value, NaN), numberOr(probeZ.value, NaN)], name: 'Measurement point' } })
  if (!editorError.value) selectedProbeId.value = id
}
function updateSelectedProbe() {
  if (!selectedProbe.value) return
  submit({ type: 'move-probe', probeId: selectedProbe.value.id, position: [numberOr(probeX.value, NaN), numberOr(probeY.value, NaN), numberOr(probeZ.value, NaN)] })
}
function renameSelectedProbe() {
  if (!selectedProbe.value) return
  const name = probeNameDraft.value.trim()
  if (name.length < 1 || name.length > 80) {
    probeNameError.value = 'Enter a name from 1 to 80 characters.'
    return
  }
  probeNameError.value = ''
  if (name === selectedProbe.value.name) return
  submit({ type: 'rename-probe', probeId: selectedProbe.value.id, name })
  if (!editorError.value) notice.value = `Measurement point renamed to “${name}”.`
}
function selectWall(id: string) { selectedWallId.value = id; selectedProbeId.value = ''; selectedZoneId.value = ''; selectedOpeningId.value = '' }
function selectProbe(id: string) { selectedProbeId.value = id; selectedWallId.value = ''; selectedZoneId.value = ''; selectedOpeningId.value = '' }
function selectZone(id: string) { selectedZoneId.value = id; selectedWallId.value = ''; selectedProbeId.value = ''; selectedOpeningId.value = '' }
function wallPathPoint(wall: Scene['walls'][number], t: number): Point { return [wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t] }
function openingCenter(openingId: string): Point | null {
  const opening = props.scene.openings.find(item => item.id === openingId), wall = opening && props.scene.walls.find(item => item.id === opening.wallId)
  return opening && wall ? wallPathPoint(wall, (opening.fromT + opening.toT) / 2) : null
}
function svgZonePoints(polygon: Point[]) { return polygon.map(point => `${point[0]},${-point[1]}`).join(' ') }
function svgImagePosition(reference: FloorPlanReference) { return { x: reference.originXY[0], y: -reference.originXY[1] - reference.heightM, width: reference.widthM, height: reference.heightM } }
function numberOr(value: string | number, fallback: number) { const parsed = String(value).trim() ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : fallback }
function distance(a: Point, b: Point) { return Math.hypot(a[0] - b[0], a[1] - b[1]) }
function round(value: number) { return Math.round(value * 1000) / 1000 }
function formatPoint(point: Point) { return `(${point[0].toFixed(2)}, ${point[1].toFixed(2)}) m` }
function nextId(prefix: string, ids: string[]) { let index = 1; while (ids.includes(`${prefix}-${index}`)) index++; return `${prefix}-${index}` }
</script>

<template>
  <section class="scene-editor" aria-labelledby="scene-editor-title" @keydown.capture="handleActivePanEscape">
    <header class="editor-header">
      <div>
        <span class="editor-kicker">HOME GEOMETRY · METRES</span>
        <h2 id="scene-editor-title">Draft the floor plan</h2>
        <p>Draw walls and place rooms and measurement points. Every edit is checked before it joins the scene history.</p>
      </div>
      <button class="close-button" type="button" aria-label="Close editor" @click="clearSnapFeedback(); emit('cancel')">×</button>
    </header>

    <div class="editor-layout">
      <section class="drawing-column" aria-label="Floor plan canvas">
        <div class="canvas-toolbar">
          <div class="canvas-state"><span class="state-dot"></span><span>{{ panMode ? 'Pan mode' : drawWallMode ? wallFirstPoint ? 'Choose wall end' : 'Choose wall start' : 'Plan view' }}</span></div>
          <label class="dimension-toggle"><input v-model="showDimensions" data-testid="editor-dimensions" type="checkbox"> Show wall dimensions</label>
          <div class="snap-control"><label for="grid-step">Snap</label><select id="grid-step" v-model.number="gridStep"><option :value="0.1">0.10 m</option><option :value="0.25">0.25 m</option><option :value="0.5">0.50 m</option><option :value="1">1.00 m</option></select></div>
        </div>
        <div class="canvas-frame">
          <PlanNavigation class="editor-navigation-overlay" test-id-prefix="editor-plan" :zoom="planZoom" :pan-mode="panMode" :disabled="!!panGesture" @zoom="zoomBy" @fit="resetCamera" @pan="togglePanMode" />
          <svg ref="planSvg" class="plan-canvas" :class="{ 'pan-active': panMode }" :viewBox="cameraViewBox" preserveAspectRatio="none" role="img" aria-label="Editable home floor plan in metres" :aria-describedby="planHelpId" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0" tabindex="0" data-testid="editor-plan-canvas" :data-plan-zoom="planZoom" :data-plan-center-x="currentView.center[0]" :data-plan-center-y="currentView.center[1]" :data-pixels-per-meter="pixelsPerMeter" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerleave="clearSnapFeedback" @pointerup="pointerUp" @pointercancel="pointerCancel" @lostpointercapture="lostPointerCapture" @blur="cancelPan(false, true); clearSnapFeedback()" @wheel="handleWheel" @keydown="handleCanvasKeydown" @click.capture="captureCanvasClick" @click="canvasClick">
            <defs><pattern id="editor-grid" :width="gridStep" :height="gridStep" patternUnits="userSpaceOnUse"><path :d="`M ${gridStep} 0 L 0 0 0 ${gridStep}`" fill="none" stroke="#cfcabd" stroke-width="0.008" /></pattern></defs>
            <rect :x="cameraBounds.x" :y="cameraBounds.y" :width="cameraBounds.width" :height="cameraBounds.height" fill="#f1efe7" />
            <image v-if="referenceImage" :href="referenceImage.dataUrl" v-bind="svgImagePosition(referenceImage)" preserveAspectRatio="none" :opacity="referenceImage.opacity" />
            <rect :x="cameraBounds.x" :y="cameraBounds.y" :width="cameraBounds.width" :height="cameraBounds.height" fill="url(#editor-grid)" />
            <polygon :points="svgZonePoints(level.boundary)" class="floor-boundary" />
            <polygon v-for="zone in scene.zones" :key="zone.id" :points="svgZonePoints(zone.polygon)" :class="['zone-shape', { selected: selectedZoneId === zone.id }]" @click.stop="selectZone(zone.id)" />
            <g v-for="wall in scene.walls" :key="wall.id" class="wall-group" @click.stop="selectWall(wall.id)">
              <line :x1="wall.start[0]" :y1="-wall.start[1]" :x2="wall.end[0]" :y2="-wall.end[1]" :class="['wall-hit', { selected: selectedWallId === wall.id }]" :stroke-width="Math.max(wall.thicknessM, 0.08)" />
              <line :x1="wall.start[0]" :y1="-wall.start[1]" :x2="wall.end[0]" :y2="-wall.end[1]" class="wall-core" :stroke-width="wall.thicknessM" />
              <line v-for="opening in scene.openings.filter(item => item.wallId === wall.id)" :key="opening.id" :x1="wallPathPoint(wall, opening.fromT)[0]" :y1="-wallPathPoint(wall, opening.fromT)[1]" :x2="wallPathPoint(wall, opening.toT)[0]" :y2="-wallPathPoint(wall, opening.toT)[1]" :class="['opening-mark', { active: opening.id === selectedOpeningId, open: opening.isOpen }]" :stroke-width="Math.max(wall.thicknessM * 0.72, 0.05)" @click.stop="selectWall(wall.id); selectedOpeningId = opening.id" />
            </g>
            <g v-for="probe in scene.probes" :key="probe.id" class="probe-mark" :class="{ selected: selectedProbeId === probe.id }" @click.stop="selectProbe(probe.id)">
              <circle :cx="probe.position[0]" :cy="-probe.position[1]" r="0.13" />
              <path :d="`M ${probe.position[0] - 0.08} ${-probe.position[1]} L ${probe.position[0] + 0.08} ${-probe.position[1]} M ${probe.position[0]} ${-probe.position[1] - 0.08} L ${probe.position[0]} ${-probe.position[1] + 0.08}`" />
            </g>
            <line v-if="wallFirstPoint && draftEnd" :x1="wallFirstPoint[0]" :y1="-wallFirstPoint[1]" :x2="draftEnd[0]" :y2="-draftEnd[1]" class="draft-preview-line" vector-effect="non-scaling-stroke" />
            <circle v-if="wallFirstPoint" :cx="wallFirstPoint[0]" :cy="-wallFirstPoint[1]" r="0.1" class="draft-point" />
            <g v-if="selectedWall" class="endpoint-pins" aria-label="Selected wall endpoints"><circle :cx="selectedWall.start[0]" :cy="-selectedWall.start[1]" r="0.085" /><circle :cx="selectedWall.end[0]" :cy="-selectedWall.end[1]" r="0.085" /></g>
          </svg>
          <DraftingOverlay :width="frameWidth" :height="frameHeight" :dimensions="dimensionMarks" :snap="snapMarker" />
          <span :id="planHelpId" class="visually-hidden">Use plus/minus to zoom and 0 to fit the home. Choose Pan, then focus this plan and use arrow keys to move the drawing by 40 pixels; hold Shift for 80 pixels. Use the geometry tools and numeric fields to select and edit objects. Escape cancels an active pan; otherwise it closes the editor.</span>
          <div class="map-north"><span>N</span><b>↑</b></div>
          <div class="map-scale" data-testid="editor-plan-scale" :data-length-m="rulerLengthM"><i :style="{ width: `${rulerPixels}px` }"></i><span>{{ rulerLengthM.toPrecision(2) }} m</span></div>
          <div v-if="drawWallMode" class="canvas-hint"><b>Wall tool</b><span>{{ wallFirstPoint ? `Start ${formatPoint(wallFirstPoint)} · choose the end` : snapDescription }}</span><span class="snap-readout" data-testid="drafting-snap-status" :data-snap-kind="snapFeedback?.kind ?? ''" :data-snap-x="snapFeedback?.point[0] ?? ''" :data-snap-y="snapFeedback?.point[1] ?? ''" :data-target-wall-id="snapFeedback?.target?.wallId ?? ''">{{ snapText }}</span><span class="visually-hidden" role="status" aria-live="polite">{{ snapAnnouncement }}</span></div>
          <div v-else class="canvas-hint"><b>{{ level.name }}</b><span>{{ scene.walls.length }} walls · {{ scene.zones.length }} zones · {{ scene.probes.length }} probes</span></div>
        </div>
        <div class="canvas-caption"><span>Click to select a wall, opening, zone, or probe.</span><span>Model coordinates: bottom-left origin · {{ snapDescription }}</span></div>
        <div v-if="editorError" class="editor-error" role="alert"><strong>Could not apply edit</strong><span>{{ editorError }}</span></div>
        <div v-else class="editor-notice" role="status" aria-live="polite"><span>◇</span>{{ notice }}</div>
      </section>

      <aside class="edit-panel" aria-label="Geometry tools and selected item">
        <section class="tool-block">
          <div class="block-heading"><span class="block-number">01</span><div><h3>Wall</h3><p>Interior construction</p></div></div>
          <button type="button" :class="['draw-button', { armed: drawWallMode }]" :aria-pressed="drawWallMode" @click="toggleWallDrawing">
            <span class="draw-icon">／</span><span><strong>{{ drawWallMode ? 'Finish drawing' : 'Draw a wall' }}</strong><small>{{ drawWallMode ? 'Two canvas points create one segment' : 'Click two snapped points on the plan' }}</small></span><b>{{ drawWallMode ? 'ESC' : '+' }}</b>
          </button>
          <div class="control-grid three-col">
            <label class="mini-field"><span>New wall thickness</span><div><input v-model="newWallThicknessDraft" type="number" min="0.04" max="1" step="0.01"><b>m</b></div></label>
            <label class="mini-field material-field"><span>New wall material</span><select v-model="newWallMaterialDraft"><option v-for="material in wallMaterials" :key="material.id" :value="material.id">{{ material.name }}</option></select></label>
          </div>
          <label class="junction-toggle"><input v-model="joinIntersections" data-testid="editor-join-walls" type="checkbox" :aria-describedby="junctionHelpId"> Join intersecting walls</label>
          <p :id="junctionHelpId" class="junction-help">Create interior T and cross junctions in one edit. Keep junctions clear of openings; exterior walls stay fixed.</p>
          <details class="numeric-fallback"><summary>Enter wall coordinates</summary>
            <div class="coordinate-grid"><label>x₁<input v-model="wallStartX" type="number" step="0.01"></label><label>y₁<input v-model="wallStartY" type="number" step="0.01"></label><label>x₂<input v-model="wallEndX" type="number" step="0.01"></label><label>y₂<input v-model="wallEndY" type="number" step="0.01"></label></div>
            <button type="button" class="small-action" @click="addNumericWall">Add wall from coordinates</button>
          </details>
          <div v-if="selectedWall" class="selection-card">
            <div class="selection-title"><span class="wall-swatch"></span><strong>{{ selectedWall.id }}</strong><button type="button" class="danger-link" @click="submit({ type: 'remove-wall', wallId: selectedWall.id })">Remove</button></div>
            <div class="wall-meta"><span>{{ selectedWallLength.toFixed(2) }} m long</span><span>{{ selectedWall.thicknessM.toFixed(2) }} m thick</span></div>
            <div class="control-grid three-col wall-properties">
              <label class="mini-field"><span>Thickness</span><div><input v-model="wallPropertiesThicknessDraft" :aria-label="`${selectedWall.id} thickness`" type="number" min="0.04" max="1" step="0.01"><b>m</b></div></label>
              <label class="mini-field"><span>Material</span><select v-model="wallPropertiesMaterialDraft" :aria-label="`${selectedWall.id} material`"><option v-for="material in wallMaterials" :key="material.id" :value="material.id">{{ material.name }}</option></select></label>
            </div>
            <button type="button" class="small-action primary wall-properties-apply" :disabled="!wallMaterials.length" @click="applyWallProperties">Apply wall properties</button>
            <label class="field-label">Move connected endpoint</label>
            <div class="endpoint-row"><select v-model="selectedEndpoint" aria-label="Endpoint"><option value="start">Start point</option><option value="end">End point</option></select><label>x<input v-model="endpointX" type="number" step="0.01"></label><label>y<input v-model="endpointY" type="number" step="0.01"></label><button type="button" class="mini-apply" aria-label="Move connected endpoint" @click="moveEndpoint">↗</button></div>
            <p class="field-help">Junctions move together. Exterior walls stay fixed.</p>
            <div class="split-controls">
              <label class="mini-field"><span>Split distance from start</span><div><input v-model="splitOffsetDraft" data-testid="editor-split-offset" aria-label="Split distance from start" type="number" min="0.1" :max="Math.max(0, selectedWallLength - 0.1)" step="0.05" :disabled="selectedWallReadOnly" :aria-describedby="splitHelpId"><b>m</b></div></label>
              <button type="button" class="small-action" data-testid="editor-split-wall" :disabled="selectedWallReadOnly" @click="splitSelectedWall">Split wall</button>
            </div>
            <p :id="splitHelpId" class="junction-help">{{ selectedWallReadOnly ? 'Exterior walls cannot be split.' : 'Openings keep their positions. Choose a cut outside openings and leave at least 0.10 m on each side.' }}</p>
          </div>
        </section>

        <section class="tool-block">
          <div class="block-heading"><span class="block-number">02</span><div><h3>Opening</h3><p>{{ selectedWall ? `Along ${selectedWall.id} · ${selectedWallLength.toFixed(2)} m` : 'Select an interior wall first' }}</p></div></div>
          <div class="opening-list" v-if="selectedWallOpenings.length">
            <button v-for="opening in selectedWallOpenings" :key="opening.id" type="button" :class="['opening-chip', { chosen: selectedOpeningId === opening.id }]" @click="selectedOpeningId = opening.id"><span class="opening-symbol">▱</span>{{ opening.id }}<small>{{ opening.isOpen ? 'open' : opening.kind }}</small></button>
          </div>
          <div class="control-grid three-col door-fields">
            <label class="mini-field"><span>Offset</span><div><input v-model="doorOffset" type="number" min="0" step="0.05"><b>m</b></div></label>
            <label class="mini-field"><span>Width</span><div><input v-model="doorWidth" type="number" min="0.2" step="0.05"><b>m</b></div></label>
            <label class="mini-field"><span>Height</span><div><input v-model="doorHeight" type="number" min="0.5" step="0.05"><b>m</b></div></label>
          </div>
          <label v-if="doorMaterials.length" class="mini-field full-field"><span>Leaf material</span><select v-model="doorMaterial"><option value="">Use default</option><option v-for="material in doorMaterials" :key="material.id" :value="material.id">{{ material.name }}</option></select></label>
          <div class="action-row"><button type="button" class="small-action primary" :disabled="!selectedWall" @click="addDoor">Add door</button><button v-if="selectedOpening" type="button" class="small-action" @click="updateDoor">Update opening</button><button v-if="selectedOpening" type="button" class="icon-danger" aria-label="Remove opening" @click="submit({ type: 'remove-opening', openingId: selectedOpening.id })">×</button></div>
          <p class="field-help">Offset is measured from the wall’s start point.</p>
        </section>

        <section class="tool-block">
          <div class="block-heading"><span class="block-number">03</span><div><h3>Room zone</h3><p>Polygon coordinates in metres</p></div></div>
          <div class="zone-select-list"><button v-for="zone in scene.zones" :key="zone.id" type="button" :class="{ chosen: zone.id === selectedZoneId }" @click="selectZone(zone.id)"><span class="zone-swatch"></span>{{ zone.name }}<small>⌑</small></button></div>
          <div class="zone-fields"><label class="mini-field"><span>Name</span><input v-model="zoneName" type="text" maxlength="80"></label><label class="mini-field polygon-field"><span>Vertices · one x, y per line</span><textarea v-model="zonePointsText" rows="3" placeholder="0.5, 0.5&#10;3.5, 0.5&#10;3.5, 3.0&#10;0.5, 3.0"></textarea></label></div>
          <div class="action-row"><button v-if="selectedZone" type="button" class="small-action primary" @click="updateZone">Update zone</button><button v-else type="button" class="small-action primary" @click="addZone">Add zone</button><button v-if="selectedZone" type="button" class="icon-danger" aria-label="Remove zone" @click="submit({ type: 'remove-zone', zoneId: selectedZone.id })">×</button></div>
        </section>

        <section class="tool-block probe-block">
          <div class="block-heading"><span class="block-number">04</span><div><h3>Measurement point</h3><p>Probe locations on the floor plan</p></div></div>
          <div class="probe-list"><button v-for="probe in scene.probes" :key="probe.id" type="button" :class="{ chosen: probe.id === selectedProbeId }" @click="selectProbe(probe.id)"><span class="probe-dot"></span>{{ probe.name || probe.id }}<small>{{ probe.position[0].toFixed(1) }}, {{ probe.position[1].toFixed(1) }}</small></button></div>
          <label v-if="selectedProbe" class="mini-field probe-name-field"><span>Name</span><input v-model="probeNameDraft" type="text" maxlength="80" aria-describedby="probe-name-help" @input="probeNameError = ''"></label>
          <p v-if="selectedProbe && probeNameError" id="probe-name-help" class="probe-name-error" role="alert">{{ probeNameError }}</p>
          <div class="probe-coordinates"><label class="mini-field"><span>X</span><input v-model="probeX" type="number" step="0.05"></label><label class="mini-field"><span>Y</span><input v-model="probeY" type="number" step="0.05"></label><label class="mini-field"><span>Z · absolute</span><input v-model="probeZ" type="number" step="0.05"></label></div>
          <div class="action-row"><button v-if="selectedProbe" type="button" class="small-action primary" @click="renameSelectedProbe">Apply name</button><button v-if="selectedProbe" type="button" class="small-action" @click="updateSelectedProbe">Move selected</button><button v-else type="button" class="small-action primary" @click="addProbe">Add probe here</button><button v-if="selectedProbe" type="button" class="icon-danger" aria-label="Remove probe" @click="submit({ type: 'remove-probe', probeId: selectedProbe.id })">×</button></div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.scene-editor{--ink:#243b38;--muted:#78847c;--line:#ddd8cc;--paper:#faf8f2;--green:#294d49;--rust:#ac603b;display:flex;flex-direction:column;min-height:min(860px,calc(100dvh - 48px));max-height:calc(100dvh - 48px);color:var(--ink);background:var(--paper);font-family:ui-sans-serif,system-ui,sans-serif}.editor-header{flex:none;display:flex;justify-content:space-between;align-items:flex-start;padding:24px 28px 17px;border-bottom:1px solid var(--line);background:linear-gradient(115deg,#fbfaf5 0%,#f5f2e9 100%)}.editor-kicker{font-size:9px;letter-spacing:1.5px;font-weight:700;color:#52645b}.editor-header h2{font:400 27px/1.05 Georgia,serif;letter-spacing:-.55px;margin:8px 0 7px;color:#203735}.editor-header p{margin:0;font-size:11px;color:#52645b;line-height:1.5;max-width:650px}.close-button{height:30px;width:30px;border:1px solid #d8d2c6;background:#fffdf8;border-radius:50%;font-size:21px;line-height:1;color:#52645b;cursor:pointer}.editor-layout{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.8fr);min-height:0;flex:1}.drawing-column{display:flex;flex-direction:column;min-width:0;min-height:0;padding:17px 19px 12px;background:#edeae1}.canvas-toolbar{height:33px;display:flex;align-items:center;justify-content:space-between;padding:0 3px 10px;color:#52645b;font-size:10px}.canvas-state{display:flex;align-items:center;gap:7px}.state-dot{width:7px;height:7px;border-radius:50%;background:#7f9b78}.snap-control{display:flex;align-items:center;gap:8px}.snap-control select{border:1px solid #d6d0c4;border-radius:4px;background:#faf8f2;padding:4px 20px 4px 7px;color:#50605a;font-size:10px}.canvas-frame{position:relative;flex:1;min-height:290px;border:1px solid #d2cdbf;border-radius:5px;overflow:hidden;background:#f1efe7;box-shadow:0 5px 18px #40493a0b}.plan-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;cursor:crosshair;touch-action:none}.floor-boundary{fill:#f8f6ee;stroke:#54675d;stroke-width:.045;stroke-linejoin:round;pointer-events:none}.zone-shape{fill:#d2ddd0a6;stroke:#829684;stroke-width:.035;stroke-dasharray:.13 .08;cursor:pointer}.zone-shape.selected{fill:#d4e3d5c9;stroke:#46765b;stroke-width:.06}.wall-group{cursor:pointer}.wall-hit{stroke:transparent;stroke-linecap:square;pointer-events:stroke}.wall-hit.selected{stroke:#c2764f55}.wall-core{stroke:#465c55;stroke-linecap:square;pointer-events:none}.wall-hit.selected+.wall-core{stroke:#273f3b}.opening-mark{stroke:#f1efe7;stroke-linecap:butt;cursor:pointer;pointer-events:stroke}.opening-mark.active{stroke:#d28b50}.opening-mark.open{stroke:#88a78e;stroke-dasharray:.08 .05}.probe-mark{color:#11747c;cursor:pointer}.probe-mark circle{fill:#f7fbf7;stroke:#187b80;stroke-width:.045}.probe-mark path{stroke:#187b80;stroke-width:.025}.probe-mark.selected circle{fill:#b3d9d4;stroke-width:.07}.endpoint-pins circle{fill:#f7dfbb;stroke:#a55430;stroke-width:.035}.draft-point{stroke:#b24d29;stroke-width:.16;stroke-linecap:round}.map-north{position:absolute;right:15px;top:12px;display:grid;justify-items:center;color:#53655d;font:10px ui-monospace,monospace}.map-north b{font-size:17px;line-height:14px;font-weight:400}.map-scale{position:absolute;right:14px;bottom:14px;display:flex;align-items:center;gap:6px;color:#52645b;font:9px ui-monospace,monospace}.map-scale i{width:27px;height:4px;border:1px solid #627166;border-top:0}.canvas-hint{position:absolute;left:12px;bottom:10px;display:grid;gap:3px;max-width:75%;padding:8px 10px;border:1px solid #d7d2c6;border-radius:4px;background:#faf9f3ed;box-shadow:0 2px 9px #28362d0e}.canvas-hint b{font-size:10px;font-weight:650;color:#3e524a}.canvas-hint span{font-size:9px;color:#52645b}.canvas-caption{display:flex;justify-content:space-between;gap:8px;padding:9px 1px 0;color:#52645b;font-size:9px}.editor-notice,.editor-error{min-height:35px;display:flex;align-items:center;gap:8px;margin-top:8px;padding:7px 9px;border:1px solid #d9d5ca;border-radius:4px;background:#f7f5ee;color:#52645b;font-size:10px}.editor-notice>span{font:17px Georgia,serif;color:#52645b}.editor-error{align-items:flex-start;flex-direction:column;gap:3px;border-color:#ddb8a6;background:#fff3ed;color:#823e27}.editor-error strong{font-size:10px}.editor-error span{line-height:1.4}.edit-panel{min-height:0;overflow:auto;border-left:1px solid #dcd6ca;background:#faf8f2;padding:4px 18px 16px}.tool-block{padding:13px 0 14px;border-bottom:1px solid #e4ded2}.tool-block:last-child{border-bottom:0}.block-heading{display:flex;align-items:flex-start;gap:9px;margin-bottom:10px}.block-number{padding-top:2px;color:#52645b;font:10px ui-monospace,monospace}.block-heading h3{margin:0;color:#2c403b;font:500 15px Georgia,serif}.block-heading p{margin:3px 0 0;color:#52645b;font-size:9px}.draw-button{width:100%;height:48px;display:flex;align-items:center;gap:10px;padding:0 10px;border:1px solid #d8d2c6;border-radius:4px;background:#f2efe7;color:#354943;text-align:left;cursor:pointer}.draw-button:hover,.draw-button.armed{border-color:#648477;background:#e9eee7}.draw-icon{font:22px Georgia,serif;color:#52645b}.draw-button strong,.draw-button small{display:block}.draw-button strong{font-size:10px;font-weight:650}.draw-button small{margin-top:3px;color:#52645b;font-size:9px}.draw-button>b{margin-left:auto;color:#52645b;font-size:16px;font-weight:400}.control-grid{display:grid;gap:7px;margin-top:9px}.three-col{grid-template-columns:1fr 1.4fr}.mini-field{display:grid;gap:4px;min-width:0;color:#52645b;font-size:9px}.mini-field>span{font-weight:600}.mini-field>div{height:31px;display:flex;align-items:center;border:1px solid #ded9ce;border-radius:3px;background:#fffdf8}.mini-field input,.mini-field select,.mini-field>select,.mini-field>input{min-width:0;width:100%;height:31px;border:1px solid #ded9ce;border-radius:3px;background:#fffdf8;padding:0 7px;color:#344742;font:10px ui-monospace,monospace}.mini-field>div input{height:29px;border:0;background:transparent;padding:0 5px}.mini-field>div b{padding-right:6px;color:#52645b;font:9px ui-monospace,monospace}.material-field{grid-column:span 1}.numeric-fallback{margin-top:8px;color:#52645b;font-size:9px}.numeric-fallback summary{cursor:pointer}.coordinate-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0}.coordinate-grid label,.endpoint-row label{display:grid;gap:3px;color:#52645b;font:9px ui-monospace,monospace}.coordinate-grid input,.endpoint-row input{width:100%;height:27px;border:1px solid #ded9ce;border-radius:3px;background:#fffdf8;padding:0 5px;color:#344742;font:10px ui-monospace,monospace}.small-action{height:29px;padding:0 9px;border:1px solid #d7d2c7;border-radius:3px;background:#f5f2ea;color:#57675f;font-size:9px;cursor:pointer}.small-action:hover:not(:disabled){border-color:#88998b;background:#edf0e9}.small-action:disabled{opacity:.45;cursor:not-allowed}.small-action.primary{border-color:#315a51;background:#315a51;color:#fffdf6}.selection-card{margin-top:10px;padding:9px 9px 8px;border:1px solid #ded9ce;border-radius:4px;background:#f5f3ec}.selection-title{display:flex;align-items:center;gap:7px}.selection-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#394d46;font-size:10px}.wall-swatch{height:4px;width:14px;background:#465c55}.danger-link{margin-left:auto;border:0;background:none;color:#a14f32;font-size:9px;cursor:pointer}.wall-meta{display:flex;justify-content:space-between;padding:6px 0 8px;color:#52645b;font:9px ui-monospace,monospace}.field-label{display:block;margin:2px 0 5px;color:#52645b;font-size:9px;font-weight:600}.endpoint-row{display:grid;grid-template-columns:1.2fr 1fr 1fr 28px;gap:5px;align-items:end}.endpoint-row select{height:27px;border:1px solid #ded9ce;border-radius:3px;background:#fffdf8;color:#52625a;font-size:9px}.mini-apply{height:27px;border:1px solid #c8d2c6;border-radius:3px;background:#e8eee6;color:#3d6555;cursor:pointer}.field-help{margin:6px 0 0;color:#52645b;font-size:8px;line-height:1.4}.opening-list,.zone-select-list,.probe-list{display:grid;gap:4px;margin:0 0 8px}.opening-chip,.zone-select-list button,.probe-list button{min-width:0;height:28px;display:flex;align-items:center;gap:6px;padding:0 7px;border:1px solid transparent;border-radius:3px;background:#f2efe7;color:#56665e;text-align:left;font-size:9px;cursor:pointer}.opening-chip.chosen,.zone-select-list button.chosen,.probe-list button.chosen{border-color:#b9c9b8;background:#eaf0e8}.opening-symbol{color:#52645b}.opening-chip small,.zone-select-list small,.probe-list small{margin-left:auto;color:#52645b;font-size:8px}.door-fields{grid-template-columns:repeat(3,1fr)}.full-field{margin-top:8px}.action-row{display:flex;align-items:center;gap:6px;margin-top:8px}.icon-danger{height:28px;width:28px;border:1px solid #e1c3b5;border-radius:3px;background:#fff5ef;color:#a44e31;font-size:17px;cursor:pointer}.zone-swatch{width:10px;height:8px;border:1px dashed #69846d;background:#d8e2d5}.zone-fields{display:grid;grid-template-columns:1fr;gap:7px}.polygon-field textarea{resize:vertical;min-height:57px;padding:6px;border:1px solid #ded9ce;border-radius:3px;background:#fffdf8;color:#344742;font:10px/1.5 ui-monospace,monospace}.probe-list button{background:#f6f4ed}.probe-dot{height:7px;width:7px;border:1px solid #14767d;border-radius:50%;background:#e9f4ef}.probe-coordinates{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:8px}.probe-block{padding-bottom:8px}
.wall-properties{margin-top:7px}.wall-properties-apply{margin-top:8px}
.probe-name-field{margin-top:8px}.probe-name-error{margin:5px 0 0;color:#823e27;font-size:9px;line-height:1.4}
.draft-point{fill:#f7dfbb;stroke:#b24d29;stroke-width:.04}
.editor-navigation-overlay{position:absolute;top:10px;left:10px;z-index:3;max-width:calc(100% - 20px)}
.canvas-toolbar{height:auto;min-height:33px;flex-wrap:wrap;gap:8px}.snap-control{margin-left:auto}
.dimension-toggle{display:inline-flex;align-items:center;gap:5px;color:#52645b;font-size:11px;cursor:pointer}.dimension-toggle input{accent-color:#176d70}
.junction-toggle{display:flex;align-items:center;gap:6px;margin-top:11px;color:#354943;font-size:11px;cursor:pointer}.junction-toggle input{accent-color:#176d70}
.junction-help{margin:5px 0 0;color:#52645b;font-size:10px;line-height:1.5}.split-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:7px;margin-top:11px;padding-top:10px;border-top:1px solid #ded9ce}
.draft-preview-line{stroke:#a45135;stroke-width:2;stroke-dasharray:5 4;pointer-events:none}
.snap-readout{overflow-wrap:anywhere}.canvas-hint{z-index:3;pointer-events:none}
@media(max-width:420px){.dimension-toggle{order:3;flex-basis:100%}}
.plan-canvas.pan-active{cursor:grab}.plan-canvas.pan-active:active{cursor:grabbing}
@media(max-width:900px){.scene-editor{max-height:calc(100dvh - 24px)}.editor-layout{grid-template-columns:minmax(0,1.2fr) minmax(285px,.9fr)}.drawing-column{padding:13px}.edit-panel{padding-left:13px;padding-right:13px}}
@media(max-width:700px){.scene-editor{max-height:none;min-height:0}.editor-header{padding:18px 17px 13px}.editor-header h2{font-size:23px}.editor-header p{font-size:10px}.editor-layout{display:flex;flex-direction:column}.drawing-column{min-height:380px;flex:0 0 48vh}.canvas-frame{min-height:260px}.canvas-caption span:last-child{display:none}.edit-panel{overflow:visible;border-left:0;border-top:1px solid #dcd6ca;padding:2px 17px 15px}.tool-block{padding:14px 0}.three-col{grid-template-columns:1fr 1.4fr}}
@media(max-width:420px){.drawing-column{padding:10px;flex-basis:42vh}.canvas-frame{min-height:210px}.editor-header{padding-left:13px;padding-right:13px}.edit-panel{padding-left:13px;padding-right:13px}.endpoint-row{grid-template-columns:1fr 1fr 1fr 27px}}
</style>
