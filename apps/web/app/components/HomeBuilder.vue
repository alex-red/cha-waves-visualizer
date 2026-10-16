<script setup lang="ts">
import { computed, ref } from 'vue'
import { createHomeScene } from '../../../../packages/home'
import type { Scene } from '../../../../packages/engine'
import type { FloorPlanReference } from '../../../../packages/floorplan'
import { FloorPlanImageError, processFloorPlanImage, type ProcessedFloorPlanImage } from '../lib/floorplan-image'

type Point = [number, number]
type ScreenPoint = { x: number; y: number }
type WallInput = { id: string; start: Point; end: Point; thicknessM?: number }
type WallDraft = { id: string; start: ScreenPoint; end: ScreenPoint; thicknessM?: number }
type BuilderResult = { scene: Scene; name: string; referenceImage?: FloorPlanReference }

const emit = defineEmits<{
  create: [result: BuilderResult]
  cancel: []
}>()

const mode = ref<'rectangle' | 'plan'>('rectangle')
const name = ref('My home')
const widthM = ref('8.5')
const depthM = ref('6.5')
const ceilingHeightM = ref('2.7')
const fileInput = ref<HTMLInputElement | null>(null)
const image = ref<ProcessedFloorPlanImage | null>(null)
const imageError = ref('')
const imageBusy = ref(false)
const scaleMode = ref(false)
const scalePoints = ref<ScreenPoint[]>([])
const measuredDistanceM = ref('')
const pixelsPerMeter = ref(0)
const isTracing = ref(false)
const boundaryPoints = ref<ScreenPoint[]>([])
const boundaryClosed = ref(false)
const fullImageBoundary = ref(false)
const drawingWall = ref(false)
const wallStart = ref<ScreenPoint | null>(null)
const walls = ref<WallDraft[]>([])
const wallThicknessM = ref('0.12')
const manualX = ref('')
const manualY = ref('')
const pointMessage = ref('')
const formError = ref('')
const opacity = ref(0.56)

const imageWidthM = computed(() => image.value && pixelsPerMeter.value > 0 ? image.value.pixelWidth / pixelsPerMeter.value : 0)
const imageHeightM = computed(() => image.value && pixelsPerMeter.value > 0 ? image.value.pixelHeight / pixelsPerMeter.value : 0)
const canCreate = computed(() => {
  const w = Number(widthM.value), d = Number(depthM.value), h = Number(ceilingHeightM.value)
  if (!name.value.trim() || !Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(h) || w < 1 || d < 1 || h < 2 || h > 8) return false
  if (mode.value === 'plan') return !!image.value && pixelsPerMeter.value > 0 && (boundaryClosed.value || fullImageBoundary.value)
  return true
})

async function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  imageError.value = ''
  imageBusy.value = true
  try {
    image.value = await processFloorPlanImage(file)
    scalePoints.value = []
    measuredDistanceM.value = ''
    pixelsPerMeter.value = 0
    boundaryPoints.value = []
    boundaryClosed.value = false
    fullImageBoundary.value = false
    walls.value = []
    isTracing.value = false
    scaleMode.value = false
    drawingWall.value = false
    pointMessage.value = 'Image ready. Calibrate its scale before tracing the footprint.'
  } catch (error) {
    image.value = null
    imageError.value = error instanceof FloorPlanImageError ? error.message : 'The image could not be processed.'
  } finally {
    imageBusy.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function startCalibration() {
  if (!image.value) return
  scaleMode.value = true
  isTracing.value = false
  drawingWall.value = false
  scalePoints.value = []
  pointMessage.value = 'Click two points on the plan whose real distance you know.'
}

function acceptCalibration() {
  const distance = Number(measuredDistanceM.value)
  if (scalePoints.value.length !== 2 || !image.value) return
  if (!String(measuredDistanceM.value).trim() || !Number.isFinite(distance) || distance <= 0) {
    pointMessage.value = 'Enter a real distance greater than zero metres.'
    return
  }
  const a = scalePoints.value[0]!, b = scalePoints.value[1]!
  const pixels = Math.hypot(b.x - a.x, b.y - a.y)
  if (pixels < 2) {
    pointMessage.value = 'Choose points farther apart so the scale is reliable.'
    return
  }
  const nextPixelsPerMeter = pixels / distance
  const physicalWidth = image.value.pixelWidth / nextPixelsPerMeter
  const physicalHeight = image.value.pixelHeight / nextPixelsPerMeter
  if (physicalWidth < 1 || physicalHeight < 1 || physicalWidth > 200 || physicalHeight > 200) {
    pointMessage.value = 'That measurement gives an implausible plan size. Check the points and distance.'
    return
  }
  pixelsPerMeter.value = nextPixelsPerMeter
  widthM.value = physicalWidth.toFixed(2)
  depthM.value = physicalHeight.toFixed(2)
  scaleMode.value = false
  pointMessage.value = `Scale set · image covers ${physicalWidth.toFixed(2)} × ${physicalHeight.toFixed(2)} m.`
}

function stageClick(event: MouseEvent) {
  if (!image.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = Math.max(0, Math.min(image.value.pixelWidth, (event.clientX - rect.left) / rect.width * image.value.pixelWidth))
  const y = Math.max(0, Math.min(image.value.pixelHeight, (event.clientY - rect.top) / rect.height * image.value.pixelHeight))
  applyStagePoint({ x, y })
}

function applyStagePoint(point: ScreenPoint) {
  if (scaleMode.value) {
    if (scalePoints.value.length < 2) scalePoints.value.push(point)
    else scalePoints.value = [point]
    pointMessage.value = scalePoints.value.length === 2 ? 'Enter the real distance, then set the scale.' : 'Choose the second point on the plan.'
  } else if (isTracing.value && !boundaryClosed.value) {
    if (boundaryPoints.value.length < 96) boundaryPoints.value.push(point)
    fullImageBoundary.value = false
    pointMessage.value = `${boundaryPoints.value.length} boundary point${boundaryPoints.value.length === 1 ? '' : 's'} added.`
  } else if (drawingWall.value) {
    if (!wallStart.value) {
      wallStart.value = point
      pointMessage.value = 'Click the wall’s other endpoint.'
    } else {
      if (distance(wallStart.value, point) >= 4) {
        walls.value.push({ id: `partition-${walls.value.length + 1}`, start: wallStart.value, end: point, thicknessM: clampNumber(wallThicknessM.value, 0.04, 0.5, 0.12) })
        pointMessage.value = `Wall segment ${walls.value.length} added.`
      } else pointMessage.value = 'That segment is too short. Try again.'
      wallStart.value = null
    }
  }
}

function addManualPoint() {
  if (!image.value) return
  if (!String(manualX.value).trim() || !String(manualY.value).trim()) {
    pointMessage.value = 'Enter both image coordinates before adding a point.'
    return
  }
  const x = Number(manualX.value), y = Number(manualY.value)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > image.value.pixelWidth || y > image.value.pixelHeight) {
    pointMessage.value = `Enter image coordinates from 0 to ${image.value.pixelWidth} × ${image.value.pixelHeight}.`
    return
  }
  applyStagePoint({ x, y })
  manualX.value = ''
  manualY.value = ''
}

function beginBoundary() {
  if (!image.value || pixelsPerMeter.value <= 0) return
  isTracing.value = true
  scaleMode.value = false
  drawingWall.value = false
  boundaryPoints.value = []
  boundaryClosed.value = false
  fullImageBoundary.value = false
  pointMessage.value = 'Click around the outside edge of the home, then close the boundary.'
}

function closeBoundary() {
  if (boundaryPoints.value.length < 3) return
  boundaryClosed.value = true
  isTracing.value = false
  pointMessage.value = `Footprint closed with ${boundaryPoints.value.length} points.`
}

function useWholeImage() {
  if (!image.value || pixelsPerMeter.value <= 0) return
  boundaryPoints.value = []
  boundaryClosed.value = false
  fullImageBoundary.value = true
  isTracing.value = false
  pointMessage.value = 'The whole image extent is now the footprint boundary.'
}

function startWall() {
  if (!image.value || pixelsPerMeter.value <= 0 || !boundaryClosed.value && !fullImageBoundary.value) return
  drawingWall.value = true
  isTracing.value = false
  scaleMode.value = false
  wallStart.value = null
  pointMessage.value = 'Click the start and end of one interior wall segment.'
}

function undoPlanAction() {
  if (wallStart.value) { wallStart.value = null; pointMessage.value = 'Wall endpoint cleared.'; return }
  if (walls.value.length) { walls.value.pop(); pointMessage.value = 'Last wall segment removed.'; return }
  if (drawingWall.value) { drawingWall.value = false; pointMessage.value = 'Wall drawing ended.'; return }
  if (isTracing.value && boundaryPoints.value.length) { boundaryPoints.value.pop(); pointMessage.value = 'Last boundary point removed.'; return }
  if (boundaryClosed.value) { boundaryClosed.value = false; isTracing.value = true; pointMessage.value = 'Boundary reopened. Add or remove points, then close it again.'; return }
  if (scalePoints.value.length) { scalePoints.value.pop(); pointMessage.value = 'Last calibration point removed.' }
}

function clearPlan() {
  scaleMode.value = false
  scalePoints.value = []
  boundaryPoints.value = []
  boundaryClosed.value = false
  fullImageBoundary.value = false
  isTracing.value = false
  drawingWall.value = false
  wallStart.value = null
  walls.value = []
  pixelsPerMeter.value = 0
  pointMessage.value = 'Plan marks and scale cleared. Calibrate the image to start again.'
}

function createHome() {
  formError.value = ''
  if (!canCreate.value) {
    formError.value = 'Complete the required dimensions and floor plan scale before creating your home.'
    return
  }
  const width = Number(widthM.value), depth = Number(depthM.value), height = Number(ceilingHeightM.value)
  let boundary: Point[] | undefined
  let interiorWalls: WallInput[] | undefined
  let referenceImage: FloorPlanReference | undefined
  if (mode.value === 'plan' && image.value) {
    const sx = width / image.value.pixelWidth
    const sy = depth / image.value.pixelHeight
    const toWorld = (point: ScreenPoint): Point => [round(point.x * sx), round((image.value!.pixelHeight - point.y) * sy)]
    if (fullImageBoundary.value) boundary = [[0, 0], [width, 0], [width, depth], [0, depth]]
    else if (boundaryClosed.value) boundary = boundaryPoints.value.map(toWorld)
    interiorWalls = walls.value.map(wall => ({ ...wall, start: toWorld(wall.start), end: toWorld(wall.end) }))
    referenceImage = {
      dataUrl: image.value.dataUrl,
      pixelWidth: image.value.pixelWidth,
      pixelHeight: image.value.pixelHeight,
      widthM: width,
      heightM: depth,
      originXY: [0, 0],
      opacity: opacity.value,
    }
  }
  try {
    const scene = createHomeScene({ name: name.value.trim(), widthM: width, depthM: depth, ceilingHeightM: height, ...(boundary ? { boundary } : {}), ...(interiorWalls?.length ? { interiorWalls } : {}) })
    emit('create', { scene, name: name.value.trim(), ...(referenceImage ? { referenceImage } : {}) })
  } catch (error) {
    formError.value = error instanceof Error ? error.message : 'The home could not be created from these details.'
  }
}

function overlayPoint(point: ScreenPoint) { return `${point.x},${point.y}` }
function round(value: number) { return Math.round(value * 1000) / 1000 }
function distance(a: ScreenPoint, b: ScreenPoint) { return Math.hypot(b.x - a.x, b.y - a.y) }
function clampNumber(value: string, min: number, max: number, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
</script>

<template>
  <div class="home-builder">
    <header class="builder-head">
      <div class="heading-copy">
        <span class="eyebrow">A ROOM FOR YOUR STUDY</span>
        <h2 id="home-builder-title">Build your home</h2>
        <p>Set the footprint and ceiling height. You can add more detail as you go.</p>
      </div>
      <button class="icon-close" type="button" aria-label="Cancel creating a home" @click="emit('cancel')">×</button>
    </header>

    <form class="builder-form" data-testid="home-builder-form" @submit.prevent="createHome">
      <label class="field name-field">
        <span>Home name</span>
        <input v-model="name" data-testid="home-name" maxlength="80" autocomplete="off" required />
      </label>

      <div class="mode-switch" role="group" aria-label="How to describe the home">
        <button type="button" data-testid="home-mode-rectangle" :aria-pressed="mode === 'rectangle'" :class="{ selected: mode === 'rectangle' }" @click="mode = 'rectangle'">
          <span class="mode-icon rectangle-icon" aria-hidden="true"></span><span><strong>Start with dimensions</strong><small>A clear rectangular footprint</small></span>
        </button>
        <button type="button" data-testid="home-mode-plan" :aria-pressed="mode === 'plan'" :class="{ selected: mode === 'plan' }" @click="mode = 'plan'">
          <span class="mode-icon plan-icon" aria-hidden="true">⌁</span><span><strong>Trace a floor plan</strong><small>Use your own image as a guide</small></span>
        </button>
      </div>

      <section v-if="mode === 'rectangle'" class="dimension-panel" aria-label="Home dimensions">
        <div class="section-title"><span class="step-no">01</span><div><h3>Make a simple footprint</h3><p>All measurements are in metres.</p></div></div>
        <div class="dimension-grid">
          <label class="field"><span>Width</span><div class="number-wrap"><input v-model="widthM" data-testid="home-width" type="number" min="1" max="100" step="0.1" required /><b>m</b></div></label>
          <label class="field"><span>Depth</span><div class="number-wrap"><input v-model="depthM" data-testid="home-depth" type="number" min="1" max="100" step="0.1" required /><b>m</b></div></label>
          <label class="field ceiling-field"><span>Ceiling height</span><div class="number-wrap"><input v-model="ceilingHeightM" data-testid="home-ceiling-height" type="number" min="2" max="8" step="0.1" required /><b>m</b></div></label>
        </div>
        <div class="preview-card" aria-label="Footprint preview">
          <div class="preview-ruler top-ruler"><span>0</span><i></i><span>{{ Number(widthM) > 0 ? Number(widthM).toFixed(1) : '—' }} m</span></div>
          <div class="rect-preview"><span>HOME</span><span class="preview-dimension vertical-dimension">{{ Number(depthM) > 0 ? Number(depthM).toFixed(1) : '—' }} m</span></div>
          <p>One open room to start · you can draw walls in the editor.</p>
        </div>
      </section>

      <section v-else class="plan-panel" aria-label="Trace a floor plan">
        <div class="section-title"><span class="step-no">01</span><div><h3>Add and scale your plan</h3><p>PNG or JPEG · up to 12 MB and 16 megapixels</p></div></div>
        <input ref="fileInput" data-testid="floorplan-file" class="visually-hidden" type="file" accept="image/png,image/jpeg" aria-label="Choose a PNG or JPEG floor plan" @change="onFileChange" />
        <div v-if="!image" class="upload-well">
          <div class="upload-mark" aria-hidden="true">↥</div>
          <strong>{{ imageBusy ? 'Preparing your image…' : 'Bring a plan into the room' }}</strong>
          <span>We resize it and remove embedded metadata before keeping it in this project.</span>
          <button type="button" class="quiet-button" :disabled="imageBusy" @click="fileInput?.click()">Choose floor plan</button>
          <p v-if="imageError" class="inline-error" role="alert">{{ imageError }}</p>
        </div>
        <template v-else>
          <div class="plan-tools">
            <div class="file-chip"><span class="file-symbol" aria-hidden="true">▤</span><span><strong>Floor plan ready</strong><small>{{ image.pixelWidth }} × {{ image.pixelHeight }} px · optimized copy</small></span></div>
            <button class="text-button" type="button" @click="fileInput?.click()">Replace</button>
          </div>
          <div class="plan-stage-wrap">
          <div class="plan-stage" data-testid="floorplan-stage" :class="{ 'stage-active': scaleMode || isTracing || drawingWall }" :style="{ aspectRatio: `${image.pixelWidth} / ${image.pixelHeight}` }" @click="stageClick">
              <img :src="image.dataUrl" alt="Uploaded floor plan. Click to place calibration points, footprint points, or wall endpoints." draggable="false" />
              <svg class="trace-layer" :viewBox="`0 0 ${image.pixelWidth} ${image.pixelHeight}`" preserveAspectRatio="none" aria-hidden="true">
                <polygon v-if="boundaryClosed || fullImageBoundary" :points="fullImageBoundary ? `0,0 ${image.pixelWidth},0 ${image.pixelWidth},${image.pixelHeight} 0,${image.pixelHeight}` : boundaryPoints.map(overlayPoint).join(' ')" />
                <polyline v-else-if="boundaryPoints.length > 1" :points="boundaryPoints.map(overlayPoint).join(' ')" />
                <g v-for="(point, index) in boundaryPoints" :key="`b-${index}`"><circle :cx="point.x" :cy="point.y" r="8" /><text :x="point.x" :y="point.y - 13">{{ index + 1 }}</text></g>
                <line v-for="wall in walls" :key="wall.id" :x1="wall.start.x" :y1="wall.start.y" :x2="wall.end.x" :y2="wall.end.y" class="wall-line" />
                <circle v-for="(point, index) in scalePoints" :key="`s-${index}`" :cx="point.x" :cy="point.y" r="11" class="scale-dot" />
                <line v-if="scalePoints.length === 2" :x1="scalePoints[0]?.x" :y1="scalePoints[0]?.y" :x2="scalePoints[1]?.x" :y2="scalePoints[1]?.y" class="measure-line" />
                <circle v-if="wallStart" :cx="wallStart.x" :cy="wallStart.y" r="8" class="wall-dot" />
              </svg>
              <span v-if="scaleMode" class="stage-instruction">1 · Click two known points</span>
              <span v-else-if="isTracing" class="stage-instruction">2 · Click around the footprint</span>
              <span v-else-if="drawingWall" class="stage-instruction">3 · Click wall endpoints</span>
              <span class="north-mark" aria-hidden="true">N ↑</span>
            </div>
            <div class="plan-axis"><span>Image bottom-left becomes <b>(0, 0)</b> in the model</span><span v-if="pixelsPerMeter">{{ imageWidthM.toFixed(2) }} × {{ imageHeightM.toFixed(2) }} m</span></div>
          </div>
          <div class="calibration-row">
            <div class="calibration-copy"><span class="calibration-check" :class="{ done: pixelsPerMeter > 0 }">{{ pixelsPerMeter > 0 ? '✓' : '1' }}</span><div><strong>{{ pixelsPerMeter > 0 ? 'Scale calibrated' : 'Calibrate the scale' }}</strong><small>{{ pixelsPerMeter > 0 ? 'Measured from two points on this image.' : 'Click two points with a known distance between them.' }}</small></div></div>
            <button type="button" data-testid="floorplan-calibrate" class="quiet-button small" @click="startCalibration">{{ pixelsPerMeter > 0 ? 'Recalibrate' : 'Pick points' }}</button>
          </div>
          <div v-if="scaleMode" class="calibration-entry">
            <label class="field"><span>Distance between points</span><div class="number-wrap"><input v-model="measuredDistanceM" data-testid="floorplan-distance" type="number" min="0.1" max="100" step="0.01" placeholder="e.g. 4.2" /><b>m</b></div></label>
            <button type="button" data-testid="floorplan-set-scale" class="solid-button" :disabled="scalePoints.length !== 2 || !Number(measuredDistanceM)" @click="acceptCalibration">Set scale</button>
          </div>
          <div class="trace-section">
            <div class="trace-step"><span class="calibration-check" :class="{ done: boundaryClosed || fullImageBoundary }">{{ boundaryClosed || fullImageBoundary ? '✓' : '2' }}</span><div><strong>Describe the outside edge</strong><small>Trace the footprint on the image. A photo outline is never assumed.</small></div></div>
            <div class="tool-row">
              <button type="button" class="quiet-button small" :disabled="!pixelsPerMeter" @click="beginBoundary">{{ boundaryClosed ? 'Redraw boundary' : isTracing ? 'Tracing…' : 'Trace boundary' }}</button>
              <button type="button" class="quiet-button small" :disabled="!isTracing || boundaryPoints.length < 3" @click="closeBoundary">Close boundary</button>
              <button type="button" data-testid="floorplan-whole-image" class="text-button" :disabled="!pixelsPerMeter" @click="useWholeImage">Use whole image extent</button>
            </div>
            <div v-if="boundaryClosed || fullImageBoundary" class="trace-step wall-step"><span class="calibration-check">3</span><div><strong>Add interior wall guides <em>optional</em></strong><small>These are simple wall segments; doors and openings can be set later.</small></div></div>
            <div v-if="boundaryClosed || fullImageBoundary" class="tool-row wall-tools">
              <button type="button" class="quiet-button small" :disabled="!pixelsPerMeter" @click="startWall">{{ drawingWall ? 'Adding walls…' : 'Add wall segment' }}</button>
              <label class="compact-field"><span>Thickness</span><input v-model="wallThicknessM" type="number" min="0.04" max="0.5" step="0.01" aria-label="Wall thickness in metres" /><b>m</b></label>
              <span v-if="walls.length" class="wall-count">{{ walls.length }} segment{{ walls.length === 1 ? '' : 's' }}</span>
            </div>
          </div>
          <div class="point-alternative">
            <details><summary>Enter image coordinates instead</summary>
              <p>Keyboard option for calibration, footprint tracing, and wall endpoints. Coordinates start at the top-left of the image (0, 0).</p>
              <div class="coordinate-entry"><label>X <input v-model="manualX" data-testid="floorplan-coordinate-x" type="number" min="0" :max="image.pixelWidth" step="1" inputmode="numeric" aria-label="Image X coordinate in pixels" /></label><label>Y <input v-model="manualY" data-testid="floorplan-coordinate-y" type="number" min="0" :max="image.pixelHeight" step="1" inputmode="numeric" aria-label="Image Y coordinate in pixels" /></label><button type="button" data-testid="floorplan-add-coordinate" class="quiet-button small" @click="addManualPoint">Add point</button></div>
            </details>
          </div>
          <div class="trace-feedback" data-testid="floorplan-feedback" role="status" aria-live="polite"><span class="feedback-dot"></span>{{ pointMessage || (pixelsPerMeter ? 'Scale set. Trace the outer edge or use the full image extent.' : 'Choose points on the image to set its scale.') }}</div>
          <div class="trace-actions"><button type="button" class="text-button" @click="undoPlanAction">Undo last point or wall</button><button type="button" class="text-button clear-action" @click="clearPlan">Clear trace</button></div>
          <label v-if="pixelsPerMeter" class="opacity-field"><span>Plan visibility</span><input v-model.number="opacity" type="range" min="0.15" max="0.85" step="0.05" /><b>{{ Math.round(opacity * 100) }}%</b></label>
          <div class="dimension-grid image-dimensions">
            <label class="field"><span>Ceiling height</span><div class="number-wrap"><input v-model="ceilingHeightM" type="number" min="2" max="8" step="0.1" required /><b>m</b></div></label>
            <div class="extent-note"><span>Calibrated image extent</span><strong>{{ pixelsPerMeter ? `${imageWidthM.toFixed(2)} × ${imageHeightM.toFixed(2)} m` : 'Set scale above' }}</strong></div>
          </div>
          <p v-if="imageError" class="inline-error" role="alert">{{ imageError }}</p>
        </template>
      </section>

      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <footer class="builder-footer">
        <div class="local-note"><span aria-hidden="true">◇</span><span>Saved on this device<br /><small>Your plan stays in this project.</small></span></div>
        <div class="footer-actions"><button type="button" class="cancel-button" @click="emit('cancel')">Cancel</button><button type="submit" data-testid="home-create" class="create-button" :disabled="!canCreate">Create home <span aria-hidden="true">↗</span></button></div>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.home-builder{--ink:#243b38;--muted:#52645b;--line:#d9d4c9;--paper:#fbfaf5;--green:#284d48;--rust:#ac633f;color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;max-height:min(90dvh,920px);overflow:auto;background:var(--paper);padding:31px clamp(20px,4vw,42px) 0;scrollbar-color:#b9c2b6 transparent;scrollbar-width:thin}
.builder-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:23px;border-bottom:1px solid #e6e1d7}.eyebrow{font:700 9px/1 ui-monospace,SFMono-Regular,monospace;letter-spacing:1.5px;color:#52645b}.heading-copy h2{margin:10px 0 5px;font:400 clamp(27px,4vw,35px)/1.08 Georgia,"Times New Roman",serif;letter-spacing:-.8px;color:#203a37}.heading-copy p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}.icon-close{width:34px;height:34px;border:1px solid var(--line);border-radius:50%;background:transparent;color:#56665f;font:25px/1 Georgia,serif;cursor:pointer;transition:background .18s,border-color .18s}.icon-close:hover{background:#f0ede5;border-color:#9da99e}
.builder-form{padding-top:20px}.field{display:grid;gap:7px;min-width:0}.field>span{font-size:11px;font-weight:700;color:#586a61;letter-spacing:.3px}.field input{width:100%;height:39px;padding:0 11px;border:1px solid #d6d2c8;border-radius:4px;background:#fffefa;color:#243b38;font:13px ui-monospace,SFMono-Regular,monospace;outline:none}.field input:focus{border-color:#507a6f;box-shadow:0 0 0 3px #507a6f20}.name-field{max-width:390px}.mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:19px 0 23px}.mode-switch button{display:flex;align-items:center;gap:12px;min-height:64px;padding:11px 13px;border:1px solid #ddd8ce;border-radius:5px;background:#fffefa;text-align:left;cursor:pointer;color:var(--ink);transition:border-color .18s,background .18s,transform .18s}.mode-switch button:hover{transform:translateY(-1px);border-color:#a5b5a6}.mode-switch button.selected{border-color:#587b70;background:#f0f4ed;box-shadow:inset 0 0 0 1px #587b7030}.mode-switch strong,.mode-switch small{display:block}.mode-switch strong{font:600 11px Georgia,serif}.mode-switch small{margin-top:4px;color:#52645b;font-size:11px}.mode-icon{display:grid;place-items:center;flex:none;width:29px;height:29px;color:#52645b}.rectangle-icon{position:relative;border:1px solid #82988c}.rectangle-icon:before{content:"";width:12px;height:8px;border:1px solid #55786e}.plan-icon{font:28px Georgia,serif;border:1px solid #c8d0c5;border-radius:50%}.section-title{display:flex;align-items:center;gap:11px;margin-bottom:17px}.step-no{display:grid;place-items:center;flex:none;width:25px;height:25px;border:1px solid #bdc9bb;border-radius:50%;color:#52645b;font:10px ui-monospace,monospace}.section-title h3{margin:0;color:#2a413d;font:500 16px Georgia,serif}.section-title p{margin:4px 0 0;color:#52645b;font-size:11px}.dimension-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.number-wrap{position:relative}.number-wrap input{padding-right:31px}.number-wrap b{position:absolute;right:11px;top:50%;transform:translateY(-50%);font:10px ui-monospace,monospace;color:#52645b}.preview-card{position:relative;display:grid;justify-items:center;padding:23px 30px 12px;margin-top:20px;border:1px solid #e7e2d8;border-radius:5px;background:radial-gradient(ellipse at center,#fffefa 0%,#f5f3eb 100%)}.preview-ruler{display:flex;align-items:center;gap:9px;width:min(53%,360px);color:#52645b;font:9px ui-monospace,monospace}.preview-ruler i{height:1px;flex:1;background:#adb9ac;position:relative}.preview-ruler i:before,.preview-ruler i:after{content:"";position:absolute;top:-3px;width:1px;height:7px;background:#adb9ac}.preview-ruler i:before{left:0}.preview-ruler i:after{right:0}.rect-preview{position:relative;display:grid;place-items:center;width:min(53%,360px);aspect-ratio:1.32;margin-top:5px;border:1px solid #7a9687;background:linear-gradient(135deg,#eff3e9,#e6ede3);box-shadow:inset 0 0 0 6px #fbfaf5,inset 0 0 0 7px #bdcbbb;color:#52645b;font:9px ui-monospace,monospace;letter-spacing:2px}.vertical-dimension{position:absolute;right:-35px;top:50%;transform:translateY(-50%) rotate(90deg);white-space:nowrap;color:#52645b;font:9px ui-monospace,monospace;letter-spacing:0}.preview-card>p{margin:11px 0 0;color:#52645b;font-size:11px}
.upload-well{display:grid;justify-items:center;gap:8px;min-height:191px;padding:24px 17px;border:1px dashed #aebcaf;border-radius:5px;background:repeating-linear-gradient(135deg,#f7f7f0,#f7f7f0 9px,#f4f4ec 9px,#f4f4ec 18px);text-align:center}.upload-mark{display:grid;place-items:center;width:35px;height:35px;border:1px solid #b4c2b3;border-radius:50%;color:#52645b;font:21px Georgia,serif}.upload-well>strong{font:500 16px Georgia,serif}.upload-well>span{max-width:350px;color:#52645b;font-size:11px;line-height:1.5}.quiet-button,.solid-button,.cancel-button,.create-button{min-height:34px;padding:0 12px;border-radius:4px;font:600 10px ui-sans-serif,system-ui,sans-serif;cursor:pointer;transition:background .18s,border-color .18s,transform .18s}.quiet-button{border:1px solid #9faf9f;background:#fffefa;color:#315a51}.quiet-button:hover:not(:disabled){background:#ecf2eb;border-color:#678775}.quiet-button:disabled{opacity:.46;cursor:not-allowed}.quiet-button.small{min-height:30px;padding:0 9px;font-size:11px}.solid-button{border:1px solid #254a44;background:#2b524b;color:#fffaf0}.solid-button:hover:not(:disabled){background:#1f413c}.solid-button:disabled{opacity:.45;cursor:not-allowed}.inline-error,.form-error{color:#923e2c}.inline-error{margin:0;font-size:11px}.plan-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.file-chip{display:flex;align-items:center;gap:9px}.file-symbol{display:grid;place-items:center;width:31px;height:31px;border:1px solid #c3cec1;border-radius:4px;background:#f2f4ed;color:#52645b;font-size:16px}.file-chip strong,.file-chip small{display:block}.file-chip strong{font:500 12px Georgia,serif}.file-chip small{margin-top:3px;color:#52645b;font:9px ui-monospace,monospace}.text-button{padding:5px 2px;border:0;background:transparent;color:#386a61;font-size:11px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}.text-button:hover:not(:disabled){color:#244e48}.text-button:disabled{opacity:.4;cursor:not-allowed}.plan-stage-wrap{padding:10px;border:1px solid #e0ddd3;border-radius:5px;background:#f0eee6}.plan-stage{position:relative;width:100%;overflow:hidden;border:1px solid #d4d0c5;background:#eae8df;cursor:crosshair;user-select:none;touch-action:manipulation}.plan-stage:not(.stage-active){cursor:default}.plan-stage img{display:block;width:100%;height:100%;object-fit:fill;opacity:.92}.trace-layer{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.trace-layer polygon{fill:#d5804b38;stroke:#b55d37;stroke-width:4;vector-effect:non-scaling-stroke}.trace-layer polyline{fill:none;stroke:#b55d37;stroke-width:3;stroke-dasharray:7 5;vector-effect:non-scaling-stroke}.trace-layer circle{fill:#fff9ed;stroke:#a95432;stroke-width:3;vector-effect:non-scaling-stroke}.trace-layer text{font:600 16px ui-monospace,monospace;fill:#643c2c;text-anchor:middle}.trace-layer .scale-dot{fill:#236971;stroke:#fff}.trace-layer .measure-line{stroke:#236971;stroke-width:2;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}.trace-layer .wall-line{stroke:#315f58;stroke-width:5;stroke-linecap:round;vector-effect:non-scaling-stroke}.trace-layer .wall-dot{fill:#d47946;stroke:#fff}.stage-instruction,.north-mark{position:absolute;top:8px;padding:5px 7px;border:1px solid #d8d2c3;border-radius:3px;background:#fffcf1e8;color:#34524a;font:9px ui-monospace,monospace}.stage-instruction{left:8px}.north-mark{right:8px}.plan-axis{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#52645b;font:8px ui-monospace,monospace}.plan-axis b{color:#39594d;font-weight:700}.calibration-row,.trace-step{display:flex;align-items:center;gap:10px}.calibration-row{justify-content:space-between;margin-top:13px;padding:11px 0;border-bottom:1px solid #e9e4da}.calibration-copy{display:flex;align-items:center;gap:9px}.calibration-copy strong,.calibration-copy small,.trace-step strong,.trace-step small{display:block}.calibration-copy strong,.trace-step strong{font:500 12px Georgia,serif;color:#304a44}.calibration-copy small,.trace-step small{margin-top:3px;color:#52645b;font-size:11px;line-height:1.4}.calibration-check{display:grid;place-items:center;flex:none;width:23px;height:23px;border:1px solid #c0cabe;border-radius:50%;color:#52645b;font:10px ui-monospace,monospace}.calibration-check.done{border-color:#5b8071;background:#e8f0e7;color:#416a5d}.calibration-entry{display:flex;align-items:end;gap:10px;margin:11px 0 13px;padding:11px;background:#f1f2e9;border:1px solid #dce2d6;border-radius:4px}.calibration-entry .field{flex:1}.trace-section{padding:12px 0 9px}.trace-step{align-items:flex-start}.trace-step>div{padding-top:1px}.tool-row{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:9px 0 0 33px}.tool-row .text-button{margin-left:auto}.wall-step{margin-top:17px}.wall-step em{margin-left:5px;color:#52645b;font:italic 10px Georgia,serif}.compact-field{display:flex;align-items:center;gap:4px;color:#52645b;font-size:11px}.compact-field input{width:55px;height:28px;padding:0 5px;border:1px solid #d9d5ca;border-radius:3px;background:#fffefa;color:#3b524a;font:10px ui-monospace,monospace}.compact-field b{font:8px ui-monospace,monospace}.wall-count{color:#52645b;font:9px ui-monospace,monospace}.point-alternative{margin-top:7px;border-top:1px solid #ebe6dc;padding-top:8px}.point-alternative summary{color:#52645b;font-size:11px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}.point-alternative p{margin:7px 0;color:#52645b;font-size:11px}.coordinate-entry{display:flex;align-items:center;gap:7px}.coordinate-entry label{display:flex;align-items:center;gap:4px;color:#52645b;font:9px ui-monospace,monospace}.coordinate-entry input{width:76px;height:29px;padding:0 6px;border:1px solid #d8d4c9;border-radius:3px;background:#fffefa;color:#304940;font:10px ui-monospace,monospace}.trace-feedback{display:flex;align-items:center;gap:7px;min-height:31px;padding:6px 8px;border:1px solid #e1e6db;border-radius:3px;background:#f2f5ed;color:#52645b;font-size:11px}.feedback-dot{width:5px;height:5px;border-radius:50%;background:#79957f}.trace-actions{display:flex;justify-content:space-between;align-items:center;margin:4px 1px 1px}.clear-action{color:#52645b}.opacity-field{display:grid;grid-template-columns:auto 1fr 36px;align-items:center;gap:10px;margin:12px 0;padding:9px 10px;border:1px solid #e2ded4;border-radius:4px;background:#f7f6ef}.opacity-field span{color:#52645b;font-size:11px}.opacity-field input{accent-color:#467267}.opacity-field b{text-align:right;color:#4d6c60;font:9px ui-monospace,monospace}.image-dimensions{grid-template-columns:minmax(140px,1fr) 1.3fr;align-items:end;margin-top:12px}.extent-note{display:grid;gap:6px;padding:0 0 6px}.extent-note span{color:#52645b;font-size:11px}.extent-note strong{font:11px ui-monospace,monospace;color:#395b50}.form-error{margin:13px 0 0;padding:9px 11px;border:1px solid #dfb5a5;border-radius:4px;background:#fff2ec;font-size:11px}.builder-footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:15px;margin:21px calc(clamp(20px,4vw,42px) * -1) 0;padding:13px clamp(20px,4vw,42px);border-top:1px solid #e2ddd3;background:#fbfaf5ed;backdrop-filter:blur(8px)}.local-note{display:flex;align-items:center;gap:8px;color:#597168;font:12px Georgia,serif}.local-note>span:first-child{font-size:19px}.local-note small{color:#52645b;font:9px ui-sans-serif,system-ui}.footer-actions{display:flex;align-items:center;gap:8px}.cancel-button{border:1px solid transparent;background:transparent;color:#52645b}.cancel-button:hover{background:#f0ede5}.create-button{min-height:38px;padding:0 15px;border:1px solid #254740;background:#2a514a;color:#fffaf1;font-size:11px}.create-button span{padding-left:9px;color:#52645b}.create-button:hover:not(:disabled){transform:translateY(-1px);background:#1e403b}.create-button:disabled{opacity:.42;cursor:not-allowed}.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}button:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid #28736e;outline-offset:2px}
@media(max-width:600px){.home-builder{padding:23px 17px 0;max-height:92dvh}.builder-head{padding-bottom:17px}.builder-form{padding-top:16px}.mode-switch{gap:6px}.mode-switch button{gap:8px;min-height:65px;padding:8px}.mode-switch strong{font-size:11px}.mode-switch small{font-size:11px}.mode-icon{width:23px;height:23px}.dimension-grid{gap:7px}.field input{height:37px;font-size:12px}.preview-card{padding-left:19px;padding-right:27px}.rect-preview,.preview-ruler{width:65%}.builder-footer{margin-left:-17px;margin-right:-17px;padding:11px 17px}.local-note{font-size:11px}.local-note small{font-size:11px}.create-button{padding:0 10px}.trace-actions .text-button{font-size:11px}.image-dimensions{grid-template-columns:1fr 1fr}.plan-axis{font-size:7px}}
@media(max-width:390px){.home-builder{padding-left:13px;padding-right:13px}.mode-switch{grid-template-columns:1fr}.mode-switch button{min-height:54px}.dimension-grid{grid-template-columns:1fr 1fr}.ceiling-field{grid-column:1/-1}.builder-footer{margin-left:-13px;margin-right:-13px;padding:10px 13px}.local-note{gap:4px}.local-note>span:first-child{font-size:16px}.footer-actions{gap:3px}.cancel-button{padding:0 7px}.create-button{padding:0 8px;font-size:11px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
</style>
