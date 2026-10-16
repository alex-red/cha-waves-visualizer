<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { FieldResult, Scene as BuildingScene } from '../../../../packages/engine'
import { fieldTexturePixels } from '../../../../packages/field-display'

const props = withDefaults(defineProps<{
  scene: BuildingScene
  field: FieldResult | null
  mode: 'sound' | 'wifi'
  compare?: boolean
  baselineField?: FieldResult | null | undefined
  backend?: 'auto' | 'webgl'
}>(), { compare: false, baselineField: null, backend: 'auto' })

const emit = defineEmits<{
  unavailable: [reason: string]
  select: [id: string]
  ready: [backend: 'webgpu' | 'webgl']
}>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const status = shallowRef('Preparing architectural model')
const backendLabel = shallowRef('')
const runtimeBackend = shallowRef<'initializing' | 'webgpu' | 'webgl'>('initializing')

type ThreeModule = typeof import('three/webgpu')
type Renderer = InstanceType<ThreeModule['WebGPURenderer']>
type Runtime = {
  THREE: ThreeModule
  renderer: Renderer
  scene: InstanceType<ThreeModule['Scene']>
  camera: InstanceType<ThreeModule['OrthographicCamera']>
  cameraBounds: { minX: number; maxX: number; minY: number; maxY: number }
  raycaster: InstanceType<ThreeModule['Raycaster']>
  resize: ResizeObserver
  click: (event: PointerEvent) => void
  contextLost: (event: Event) => void
  resources: Set<{ dispose: () => void }>
}

let runtime: Runtime | null = null
let initializing = false
let disposed = false
let rebuildVersion = 0

const displayWallHeight = 0.78
function createFieldTexture(THREE: ThreeModule, field: FieldResult | null): InstanceType<ThreeModule['DataTexture']> | null {
  if (!field || field.grid.cols < 1 || field.grid.rows < 1) return null
  const texture = new THREE.DataTexture(fieldTexturePixels(field, props.mode, props.compare, props.baselineField), field.grid.cols, field.grid.rows, THREE.RGBAFormat)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function makeShape(THREE: ThreeModule, points: [number, number][]) {
  const shape = new THREE.Shape()
  points.forEach(([x, z], index) => index === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z))
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function disposeModel(current: Runtime) {
  current.scene.traverse((object) => {
    const mesh = object as InstanceType<ThreeModule['Mesh']>
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) material.dispose()
  })
  for (const resource of current.resources) resource.dispose()
  current.resources.clear()
  current.scene.clear()
}

function cleanup() {
  const current = runtime
  runtime = null
  if (!current) return
  current.resize.disconnect()
  canvas.value?.removeEventListener('pointerup', current.click)
  canvas.value?.removeEventListener('webglcontextlost', current.contextLost)
  disposeModel(current)
  current.renderer.dispose()
}

function buildModel(current: Runtime, fieldTexture: InstanceType<ThreeModule['DataTexture']> | null) {
  const { THREE, scene } = current
  const root = new THREE.Group()
  scene.add(root)
  const level = props.scene.levels[0]
  if (!level) return
  const bounds = level.boundary
  const minX = Math.min(...bounds.map((point) => point[0]))
  const maxX = Math.max(...bounds.map((point) => point[0]))
  const minZ = Math.min(...bounds.map((point) => point[1]))
  const maxZ = Math.max(...bounds.map((point) => point[1]))
  const width = Math.max(maxX - minX, 0.1)
  const depth = Math.max(maxZ - minZ, 0.1)
  const floorY = level.floorZ

  const slab = new THREE.Mesh(makeShape(THREE, bounds), new THREE.MeshStandardMaterial({ color: '#d7d0c4', roughness: 0.96, side: THREE.DoubleSide }))
  slab.position.y = floorY - 0.025
  slab.userData.kind = 'slab'
  root.add(slab)

  props.scene.zones.forEach((zone, index) => {
    const colors = ['#e8e1d5', '#e4e3d9', '#ebe2d9', '#e1e5df']
    const room = new THREE.Mesh(makeShape(THREE, zone.polygon), new THREE.MeshStandardMaterial({ color: colors[index % colors.length] ?? '#e8e1d5', roughness: 0.94, side: THREE.DoubleSide }))
    room.position.y = floorY - 0.008 + index * 0.0005
    room.userData.id = zone.id
    room.userData.kind = 'zone'
    root.add(room)
  })

  if (fieldTexture) {
    const geometry = new THREE.PlaneGeometry(fieldTexture.image.width * props.field!.grid.cellSizeM, fieldTexture.image.height * props.field!.grid.cellSizeM)
    geometry.rotateX(-Math.PI / 2)
    const uv = geometry.getAttribute('uv')
    for (let index = 0; index < uv.count; index++) uv.setY(index, 1 - uv.getY(index))
    uv.needsUpdate = true
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: fieldTexture,
      color: '#ffffff',
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    }))
    mesh.position.set(props.field!.grid.originXY[0] + fieldTexture.image.width * props.field!.grid.cellSizeM / 2, floorY + 0.004, props.field!.grid.originXY[1] + fieldTexture.image.height * props.field!.grid.cellSizeM / 2)
    mesh.userData.kind = 'field'
    root.add(mesh)
  }

  const materials = new Map(props.scene.materials.map((material) => [material.id, material]))
  const wallMeshes: InstanceType<ThreeModule['Mesh']>[] = []
  for (const wall of props.scene.walls) {
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    const wallBase = floorY + Math.max(0, Math.min(1, (wall.baseZ - level.floorZ) / Math.max(level.ceilingHeightM, 1e-6))) * displayWallHeight
    const displayHeight = wall.heightM / Math.max(level.ceilingHeightM, 1e-6) * displayWallHeight
    const wallMaterial = materials.get(wall.materialId)
    const material = new THREE.MeshStandardMaterial({ color: wallMaterial?.display?.color ?? '#d9d1c3', roughness: 0.9 })
    const openings = props.scene.openings.filter((opening) => opening.wallId === wall.id).sort((a, b) => a.fromT - b.fromT)
    const cuts = new Set([0, 1])
    openings.forEach((opening) => { cuts.add(opening.fromT); cuts.add(opening.toT) })
    const edges = [...cuts].sort((a, b) => a - b)
    for (let i = 0; i < edges.length - 1; i++) {
      const from = edges[i]!
      const to = edges[i + 1]!
      if (to - from < 0.0001) continue
      const opening = openings.find((item) => from >= item.fromT - 1e-6 && to <= item.toT + 1e-6)
      const sill = opening ? (opening.sillAboveBaseM / Math.max(wall.heightM, 1e-6)) * displayHeight : 0
      const top = opening ? Math.min(displayHeight, ((opening.sillAboveBaseM + opening.heightM) / Math.max(wall.heightM, 1e-6)) * displayHeight) : displayHeight
      const bands: [number, number, InstanceType<ThreeModule['MeshStandardMaterial']>][] = []
      if (!opening) bands.push([0, displayHeight, material])
      else {
        if (sill > 0.005) bands.push([0, sill, material])
        if (displayHeight - top > 0.005) bands.push([top, displayHeight, material])
      }
      for (const [low, high, bandMaterial] of bands) {
        const segmentLength = length * (to - from)
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(segmentLength, high - low, wall.thicknessM), bandMaterial)
        const t = (from + to) / 2
        mesh.position.set(wall.start[0] + dx * t, wallBase + (low + high) / 2, wall.start[1] + dz * t)
        mesh.rotation.y = -Math.atan2(dz, dx)
        mesh.userData.id = wall.id
        mesh.userData.kind = 'wall'
        root.add(mesh)
        wallMeshes.push(mesh)
      }
      if (opening && opening.kind === 'door' && !opening.isOpen) {
        const doorMaterial = new THREE.MeshStandardMaterial({ color: '#b89570', roughness: 0.84 })
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(length * (to - from) * 0.94, Math.max(top - sill, 0.04), 0.025), doorMaterial)
        const t = (from + to) / 2
        leaf.position.set(wall.start[0] + dx * t, wallBase + (sill + top) / 2, wall.start[1] + dz * t)
        leaf.rotation.y = -Math.atan2(dz, dx)
        leaf.userData.id = opening.id
        leaf.userData.kind = 'opening'
        root.add(leaf)
      }
    }
    // Wall base and top caps are display cues; openings remain visible as real gaps.
    material.side = THREE.DoubleSide
  }

  for (const emitter of props.scene.emitters.filter(item => item.active && item.domain === (props.mode === 'sound' ? 'acoustics' : 'radio'))) {
    const active = emitter.active
    const color = emitter.domain === 'radio' ? '#096c77' : '#ae4c23'
    const mark = new THREE.Group()
    const t = Math.max(0, Math.min(1, (emitter.position[2] - level.floorZ) / Math.max(level.ceilingHeightM, 1e-6)))
    mark.position.set(emitter.position[0], floorY + 0.12 + t * 0.38, emitter.position[1])
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.23, 12), new THREE.MeshStandardMaterial({ color: '#fffaf2', roughness: 0.7 }))
    stem.position.y = -0.08
    mark.add(stem)
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), new THREE.MeshBasicMaterial({ color: active ? color : '#a9aaa2' }))
    sphere.userData.id = emitter.id
    sphere.userData.kind = 'marker'
    mark.add(sphere)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.015, 6, 24), new THREE.MeshBasicMaterial({ color: '#fffaf2' }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.17
    mark.add(ring)
    root.add(mark)
  }
  for (const probe of props.scene.probes) {
    const t = Math.max(0, Math.min(1, (probe.position[2] - level.floorZ) / Math.max(level.ceilingHeightM, 1e-6)))
    const mark = new THREE.Group()
    mark.position.set(probe.position[0], floorY + 0.1 + t * 0.34, probe.position[1])
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 10), new THREE.MeshStandardMaterial({ color: '#fffaf2', roughness: 0.72 }))
    pin.position.y = -0.07
    mark.add(pin)
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: '#096c77' }))
    diamond.userData.id = probe.id
    diamond.userData.kind = 'marker'
    mark.add(diamond)
    mark.traverse((object) => { object.userData.id = probe.id })
    root.add(mark)
  }

  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const span = Math.max(width, depth, 1)
  current.camera.position.set(centerX + span * 1.35, floorY + span * 1.65, centerZ + span * 1.4)
  current.camera.lookAt(centerX, floorY + displayWallHeight * 0.32, centerZ)
  current.camera.updateProjectionMatrix()
  current.camera.updateMatrixWorld()
  const projected = bounds.flatMap(([x, z]) => [floorY, floorY + displayWallHeight].map(y =>
    new THREE.Vector3(x, y, z).applyMatrix4(current.camera.matrixWorldInverse)))
  current.cameraBounds = {
    minX: Math.min(...projected.map(point => point.x)), maxX: Math.max(...projected.map(point => point.x)),
    minY: Math.min(...projected.map(point => point.y)), maxY: Math.max(...projected.map(point => point.y)),
  }
}

async function startRenderer(): Promise<Runtime | null> {
  if (!canvas.value) return null
  const THREE = await import('three/webgpu')
  const options = { canvas: canvas.value, antialias: true, alpha: false, powerPreference: 'high-performance' as const }
  let renderer: Renderer
  let kind = 'WebGPU'
  runtimeBackend.value = 'initializing'
  try {
    renderer = new THREE.WebGPURenderer({ ...options, forceWebGL: props.backend === 'webgl' })
    await renderer.init()
    if (props.backend === 'webgl') kind = 'WebGL 2'
  } catch (error) {
    // Initialization may have allocated a partial GPU context before rejecting.
    if (typeof renderer! !== 'undefined') renderer!.dispose()
    if (props.backend === 'webgl') throw error
    kind = 'WebGL 2 fallback'
    renderer = new THREE.WebGPURenderer({ ...options, forceWebGL: true })
    try {
      await renderer.init()
    } catch (fallbackError) {
      renderer.dispose()
      throw fallbackError
    }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.setClearColor('#f3efe7', 1)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const actualBackend = renderer.backend as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean; device?: { lost?: Promise<{ message?: string; reason?: string }> } }
  if (actualBackend.isWebGLBackend) kind = props.backend === 'webgl' ? 'WebGL 2' : 'WebGL 2 fallback'
  else kind = 'WebGPU'
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#f3efe7')
  scene.add(new THREE.HemisphereLight('#fffdf7', '#8b857b', 2.1))
  const key = new THREE.DirectionalLight('#fff5e2', 2.3)
  key.position.set(-4, 7, 6)
  scene.add(key)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  const resize = new ResizeObserver(() => draw())
  const raycaster = new THREE.Raycaster()
  const next: Runtime = { THREE, renderer, scene, camera, cameraBounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, resize, raycaster, resources: new Set(), click: () => {}, contextLost: () => {} }
  next.click = (event) => {
    const bounds = canvas.value?.getBoundingClientRect()
    if (!bounds) return
    const ndc = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(scene.children, true)
    const target = hits.find((hit) => typeof hit.object.userData.id === 'string' && hit.object.userData.kind === 'marker')
    if (target?.object.userData.id) emit('select', target.object.userData.id)
  }
  next.contextLost = (event) => {
    event.preventDefault()
    status.value = 'Graphics device unavailable'
    emit('unavailable', 'The graphics device was lost. Return to plan view to keep editing.')
    cleanup()
  }
  canvas.value.addEventListener('pointerup', next.click)
  canvas.value.addEventListener('webglcontextlost', next.contextLost)
  resize.observe(canvas.value)
  void actualBackend.device?.lost?.then((info) => {
    if (runtime !== next || disposed) return
    status.value = 'Graphics device unavailable'
    emit('unavailable', info.message || 'The graphics device was lost. Return to plan view to keep editing.')
    cleanup()
  })
  runtimeBackend.value = kind === 'WebGPU' ? 'webgpu' : 'webgl'
  backendLabel.value = kind
  emit('ready', runtimeBackend.value)
  return next
}

function draw() {
  const current = runtime
  const element = canvas.value
  if (!current || !element) return
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  // CSS dimensions must stay independent of drawing-buffer dimensions. Cap
  // allocations as a second guard for unusually large embedded viewports.
  const maxCssSize = 4096 / current.renderer.getPixelRatio()
  const scale = Math.min(1, maxCssSize / rect.width, maxCssSize / rect.height)
  const width = Math.max(1, Math.round(rect.width * scale))
  const height = Math.max(1, Math.round(rect.height * scale))
  if (element.width !== Math.round(width * current.renderer.getPixelRatio())
    || element.height !== Math.round(height * current.renderer.getPixelRatio())) {
    current.renderer.setSize(width, height, false)
  }
  const aspect = rect.width / rect.height
  const bounds = current.cameraBounds
  const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2
  const halfHeight = Math.max((bounds.maxY - bounds.minY) / 2, (bounds.maxX - bounds.minX) / (2 * aspect)) * 1.18
  const halfWidth = halfHeight * aspect
  current.camera.left = centerX - halfWidth
  current.camera.right = centerX + halfWidth
  current.camera.top = centerY + halfHeight
  current.camera.bottom = centerY - halfHeight
  current.camera.updateProjectionMatrix()
  current.renderer.render(current.scene, current.camera)
}

async function refresh() {
  const version = ++rebuildVersion
  if (disposed) return
  status.value = props.field ? 'Mapping computed field' : 'Architecture · waiting for a field'
  try {
    if (!runtime) {
      if (initializing) return
      initializing = true
      const started = await startRenderer()
      initializing = false
      if (!started) throw new Error('Canvas is unavailable')
      runtime = started
      if (disposed || version !== rebuildVersion) {
        cleanup()
        if (!disposed) queueMicrotask(() => { if (!disposed) void refresh() })
        return
      }
    }
    const current = runtime
    if (!current) return
    disposeModel(current)
    current.scene.background = new current.THREE.Color('#f3efe7')
    current.scene.add(new current.THREE.HemisphereLight('#fffdf7', '#8b857b', 2.1))
    const key = new current.THREE.DirectionalLight('#fff5e2', 2.3)
    key.position.set(-4, 7, 6)
    current.scene.add(key)
    const texture = createFieldTexture(current.THREE, props.field)
    if (texture) current.resources.add(texture)
    buildModel(current, texture)
    status.value = props.field ? 'Computed values · valid cells only' : 'Architecture · no computed field yet'
    draw()
  } catch (error) {
    initializing = false
    cleanup()
    const reason = error instanceof Error ? error.message : 'No supported graphics renderer is available.'
    status.value = 'Cutaway unavailable'
    emit('unavailable', reason)
  }
}

onMounted(() => { void refresh() })
watch(() => [props.scene, props.field, props.mode, props.compare, props.baselineField, props.backend], () => { if (!initializing) void refresh() })
onBeforeUnmount(() => {
  disposed = true
  rebuildVersion++
  cleanup()
})
</script>

<template>
  <section class="cutaway-shell" aria-label="Architectural cutaway">
    <canvas ref="canvas" class="cutaway-canvas" data-testid="cutaway-canvas" :data-backend="runtimeBackend" aria-label="Three dimensional apartment cutaway. Use scene object controls and numeric coordinates for keyboard editing." />
    <div class="cutaway-stamp" aria-hidden="true"><span>STUDY MODEL</span><strong>01 / {{ mode === 'sound' ? 'ACOUSTICS' : 'RADIO' }}</strong></div>
    <div class="cutaway-legend"><i :class="mode" /><span>{{ compare ? 'Working − baseline · dB' : mode === 'sound' ? 'Relative direct level · dB' : 'Received power · dBm' }}</span><small data-testid="render-backend-runtime">{{ backendLabel }}</small></div>
    <div class="cutaway-status" role="status"><span class="status-mark" />{{ status }}</div>
    <div class="cutaway-scale" aria-label="Metric geometry; walls are displayed at 0.78 meters for visibility">METRIC GEOMETRY · WALLS 0.78 M DISPLAY</div>
  </section>
</template>

<style scoped>
.cutaway-shell{position:absolute;inset:0;min-height:0;height:100%;overflow:hidden;background-color:#f3efe7;background-image:linear-gradient(rgba(49,63,59,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(49,63,59,.035) 1px,transparent 1px);background-size:24px 24px;border:1px solid #ded8cc;border-radius:3px;isolation:isolate}
.cutaway-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;min-height:0;touch-action:manipulation;outline:none}
.cutaway-stamp{position:absolute;left:18px;top:16px;display:grid;gap:4px;color:#52615b;pointer-events:none}.cutaway-stamp span{font:9px ui-monospace,monospace;letter-spacing:1.35px}.cutaway-stamp strong{font:600 10px ui-monospace,monospace;letter-spacing:.35px;color:#263a37}
.cutaway-legend{position:absolute;left:18px;bottom:44px;display:flex;align-items:center;gap:8px;padding:7px 9px;background:#fffcf6eF;border:1px solid #e0d9cc;color:#52615b;font:10px ui-monospace,monospace;pointer-events:none}.cutaway-legend i{width:9px;height:9px;border-radius:50%;background:#ae4c23}.cutaway-legend i.wifi{background:#096c77}.cutaway-legend small{margin-left:5px;color:#8a9087;font-size:9px}
.cutaway-status{position:absolute;left:18px;bottom:13px;display:flex;align-items:center;gap:7px;color:#738078;font:9px ui-monospace,monospace;pointer-events:none}.status-mark{width:6px;height:6px;border-radius:50%;background:#72897c}
.cutaway-scale{position:absolute;right:18px;bottom:15px;display:flex;align-items:center;gap:8px;color:#69756d;font:9px ui-monospace,monospace;pointer-events:none}.cutaway-scale span{display:block;width:34px;height:4px;border:1px solid #728078;border-top:0}
@media(max-width:520px){.cutaway-shell,.cutaway-canvas{min-height:0}.cutaway-stamp{left:11px;top:11px}.cutaway-legend{left:10px;bottom:40px;max-width:70%;font-size:9px}.cutaway-legend small{display:none}.cutaway-status{left:10px;bottom:12px;font-size:8px}.cutaway-scale{right:10px;bottom:12px;font-size:8px}.cutaway-scale span{width:24px}}
</style>
