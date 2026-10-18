<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { LoadedVisualBundle, VisualCamera } from '../../../../packages/spatial-visual-types'
import { VISUAL_LIMITS } from '../../../../packages/spatial-visual-types'

const props = defineProps<{
  bundle: LoadedVisualBundle
  active: boolean
  showAsset: boolean
  showCameras: boolean
  selectedCameraId: string | null
}>()

const emit = defineEmits<{
  ready: [backend: 'webgpu' | 'webgl', renderMs: number]
  unavailable: [reason: string]
  reset: []
}>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const status = shallowRef('Waiting for an active visual bundle')
const backendName = shallowRef('')
const backendType = shallowRef<'initializing' | 'webgpu' | 'webgl'>('initializing')
const cameraPreviewId = shallowRef<string | null>(props.selectedCameraId)

type ThreeModule = typeof import('three/webgpu')
type Renderer = InstanceType<ThreeModule['WebGPURenderer']>
type SplatModule = typeof import('three/addons/objects/GaussianSplat.js')
type Gaussian = InstanceType<SplatModule['GaussianSplat']>
type ControlsModule = typeof import('three/addons/controls/OrbitControls.js')
type Controls = InstanceType<ControlsModule['OrbitControls']>
type Attribute = InstanceType<typeof import('three')['BufferAttribute']>

type Runtime = {
  THREE: ThreeModule
  renderer: Renderer
  scene: InstanceType<ThreeModule['Scene']>
  displayRoot: InstanceType<ThreeModule['Group']>
  assetRoot: InstanceType<ThreeModule['Group']>
  splat: Gaussian
  orbitCamera: InstanceType<ThreeModule['PerspectiveCamera']>
  previewCamera: InstanceType<ThreeModule['PerspectiveCamera']>
  controls: Controls
  resize: ResizeObserver
  keydown: (event: KeyboardEvent) => void
  contextLost: (event: Event) => void
  renderOrigin: InstanceType<ThreeModule['Vector3']>
  registrationRotation: InstanceType<ThreeModule['Quaternion']>
  registrationTranslation: InstanceType<ThreeModule['Vector3']>
  registrationScale: number
  localCenter: InstanceType<ThreeModule['Vector3']>
  worldCenter: InstanceType<ThreeModule['Vector3']>
  boundsRadius: number
  cameraLines: InstanceType<ThreeModule['Group']>
  readyEmitted: boolean
  disposed: boolean
}

let runtime: Runtime | null = null
let generation = 0
let mounted = false
let cleanupBarrier: Promise<void> = Promise.resolve()
let startupTask: Promise<void> = Promise.resolve()

function safeUnavailable(reason: string): void {
  status.value = reason
  emit('unavailable', reason)
}

function isCurrent(token: number): boolean {
  return mounted && props.active && token === generation
}

function quaternionFrom(values: readonly number[], THREE: ThreeModule): InstanceType<ThreeModule['Quaternion']> {
  return new THREE.Quaternion(values[0]!, values[1]!, values[2]!, values[3]!).normalize()
}

function positionFrom(values: readonly number[], THREE: ThreeModule): InstanceType<ThreeModule['Vector3']> {
  return new THREE.Vector3(values[0]!, values[1]!, values[2]!)
}

function visualBounds(THREE: ThreeModule): { min: InstanceType<ThreeModule['Vector3']>; max: InstanceType<ThreeModule['Vector3']> } {
  return { min: positionFrom(props.bundle.stats.localBounds.min, THREE), max: positionFrom(props.bundle.stats.localBounds.max, THREE) }
}

function framePoint(local: InstanceType<ThreeModule['Vector3']>, current: Runtime): InstanceType<ThreeModule['Vector3']> {
  return local.clone()
    .multiplyScalar(current.registrationScale)
    .applyQuaternion(current.registrationRotation)
    .add(current.registrationTranslation)
    .sub(current.renderOrigin)
}

function addBoundsAndGrid(current: Runtime): void {
  const { THREE } = current
  const { min, max } = visualBounds(THREE)
  const size = max.clone().sub(min)
  const center = min.clone().add(max).multiplyScalar(0.5)
  const span = Math.max(size.x, size.y, size.z, 0.5)
  current.localCenter.copy(center)
  current.boundsRadius = Math.max(size.length() * current.registrationScale * 0.5, 0.35)
  current.worldCenter.copy(center.clone().multiplyScalar(current.registrationScale).applyQuaternion(current.registrationRotation).add(current.registrationTranslation))

  // The guide is a child of the registered asset root, so it starts in asset axes.
  const localUp = props.bundle.manifest.assetFrame.up
  const upAxis = localUp.endsWith('y') ? 'y' : 'z'
  const upSign = localUp.startsWith('-') ? -1 : 1
  const floor = upSign > 0 ? (upAxis === 'y' ? min.y : min.z) : (upAxis === 'y' ? max.y : max.z)
  const grid = new THREE.GridHelper(span * 1.8, 18, '#73836f', '#bdc4b7')
  grid.material.transparent = true
  grid.material.opacity = 0.45
  grid.position.copy(center)
  if (upAxis === 'y') {
    grid.position.y = floor
    if (upSign < 0) grid.rotation.z = Math.PI
  }
  else {
    grid.rotation.x = upSign > 0 ? Math.PI / 2 : -Math.PI / 2
    grid.position.z = floor
  }
  current.assetRoot.add(grid)

  const boundsBox = new THREE.Box3(min, max)
  const boundsHelper = new THREE.Box3Helper(boundsBox, '#87957d')
  current.assetRoot.add(boundsHelper)
}

function makeFrustum(camera: VisualCamera, current: Runtime): InstanceType<ThreeModule['LineSegments']> {
  const { THREE } = current
  const depth = Math.max(current.boundsRadius * 0.24 / current.registrationScale, 0.25 / current.registrationScale)
  const { width, height, fx, fy, cx, cy } = camera.intrinsics
  const corners: [number, number, number][] = [
    [-cx / fx * depth, cy / fy * depth, -depth],
    [(width - cx) / fx * depth, cy / fy * depth, -depth],
    [(width - cx) / fx * depth, -(height - cy) / fy * depth, -depth],
    [-cx / fx * depth, -(height - cy) / fy * depth, -depth],
  ]
  const vertices: number[] = []
  const origin: [number, number, number] = [0, 0, 0]
  for (let index = 0; index < 4; index += 1) {
    const corner = corners[index]!
    const next = corners[(index + 1) % 4]!
    vertices.push(...origin, ...corner, ...corner, ...next)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  const color = camera.role === 'training' ? '#47775b' : camera.role === 'held-out' ? '#b65d3b' : '#7a7880'
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: camera.role === 'illustrative' ? 0.55 : 0.86 })
  const lines = new THREE.LineSegments(geometry, material)
  lines.position.copy(positionFrom(camera.position, THREE))
  lines.quaternion.copy(quaternionFrom(camera.orientationXyzw, THREE))
  lines.userData.cameraId = camera.id
  return lines
}

function disposeScene(current: Runtime): void {
  current.scene.traverse((object) => {
    const item = object as InstanceType<ThreeModule['Mesh']>
    item.geometry?.dispose()
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : []
    for (const material of materials) material.dispose()
  })
  // GaussianSplat owns an internal instanced geometry and material while keeping
  // the loader's source geometry separately in `splatGeometry`.
  current.splat.splatGeometry.dispose()
  current.scene.clear()
}

async function disposeRuntime(current: Runtime): Promise<void> {
  if (current.disposed) return
  current.disposed = true
  current.resize.disconnect()
  canvas.value?.removeEventListener('keydown', current.keydown)
  canvas.value?.removeEventListener('webglcontextlost', current.contextLost)
  ;(current.controls as Controls | null)?.dispose()
  disposeScene(current)
  try { await current.renderer.dispose() } catch { /* Renderer teardown is best effort after close. */ }
}

function fitOrbit(current: Runtime, save = true): void {
  const { THREE } = current
  const worldUp = props.bundle.manifest.registration.status === 'known' ? '+z' : props.bundle.manifest.assetFrame.up
  const sign = worldUp.startsWith('-') ? -1 : 1
  const up = worldUp.endsWith('y') ? new THREE.Vector3(0, sign, 0) : new THREE.Vector3(0, 0, sign)
  current.orbitCamera.up.copy(up)
  const center = current.worldCenter.clone().sub(current.renderOrigin)
  const radius = Math.max(current.boundsRadius, 0.5)
  const offset = Math.abs(up.z) > 0.5
    ? new THREE.Vector3(radius * 1.75, -radius * 2.15, radius * 1.55 * sign)
    : new THREE.Vector3(radius * 1.65, radius * 1.7 * sign, radius * 1.65)
  current.orbitCamera.position.copy(center).add(offset)
  current.orbitCamera.near = Math.max(radius / 1000, 0.001)
  current.orbitCamera.far = Math.max(radius * 100, 100)
  current.orbitCamera.lookAt(center)
  current.controls.target.copy(center)
  current.controls.update()
  if (save) current.controls.saveState()
}

function setSelectedCamera(current: Runtime, camera: VisualCamera | null): void {
  current.controls.enabled = camera === null
  if (!camera) {
    fitOrbit(current)
    return
  }
  const { THREE } = current
  const posePosition = framePoint(positionFrom(camera.position, THREE), current)
  const poseRotation = current.registrationRotation.clone().multiply(quaternionFrom(camera.orientationXyzw, THREE)).normalize()
  current.previewCamera.position.copy(posePosition)
  current.previewCamera.quaternion.copy(poseRotation)
  current.previewCamera.near = Math.max(current.boundsRadius / 10000, 0.001)
  const distanceToAsset = posePosition.distanceTo(current.worldCenter.clone().sub(current.renderOrigin))
  current.previewCamera.far = Math.max(distanceToAsset + current.boundsRadius * 4, current.boundsRadius * 100, 100)
  current.previewCamera.updateMatrixWorld(true)
}

function cameraViewport(width: number, height: number, aspect: number): { x: number; y: number; width: number; height: number } {
  const viewportAspect = width / height
  if (viewportAspect > aspect) {
    const viewportWidth = Math.round(height * aspect)
    return { x: Math.floor((width - viewportWidth) / 2), y: 0, width: viewportWidth, height }
  }
  const viewportHeight = Math.round(width / aspect)
  return { x: 0, y: Math.floor((height - viewportHeight) / 2), width, height: viewportHeight }
}

function updatePreviewProjection(current: Runtime, camera: VisualCamera): void {
  const { width, height, fx, fy, cx, cy } = camera.intrinsics
  const near = current.previewCamera.near
  const left = -cx * near / fx
  const right = (width - cx) * near / fx
  const top = cy * near / fy
  const bottom = -(height - cy) * near / fy
  current.previewCamera.coordinateSystem = current.renderer.coordinateSystem
  current.previewCamera.projectionMatrix.makePerspective(left, right, top, bottom, near, current.previewCamera.far, current.renderer.coordinateSystem)
  current.previewCamera.projectionMatrixInverse.copy(current.previewCamera.projectionMatrix).invert()
}

function draw(current = runtime): void {
  if (!current || current.disposed || runtime !== current || !props.active) return
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const maxBuffer = 4096
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, maxBuffer / rect.width, maxBuffer / rect.height)
  current.renderer.setPixelRatio(pixelRatio)
  current.renderer.setSize(rect.width, rect.height, false)
  // Renderer viewport/scissor APIs use CSS pixels and apply DPR internally.
  const width = rect.width
  const height = rect.height
  current.orbitCamera.aspect = width / height
  current.orbitCamera.updateProjectionMatrix()
  const renderStartedAt = performance.now()
  current.renderer.setScissorTest(false)
  current.renderer.setViewport(0, 0, width, height)
  current.renderer.setClearColor('#f3efe7', 1)
  current.renderer.clear()

  const selected = cameraPreviewId.value
    ? props.bundle.manifest.cameras.find(camera => camera.id === cameraPreviewId.value) ?? null
    : null
  if (selected) {
    setSelectedCamera(current, selected)
    updatePreviewProjection(current, selected)
    const viewport = cameraViewport(width, height, selected.intrinsics.width / selected.intrinsics.height)
    current.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height)
    current.renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height)
    current.renderer.setScissorTest(true)
    current.renderer.render(current.scene, current.previewCamera)
    current.renderer.setScissorTest(false)
  } else {
    current.controls.enabled = true
    current.renderer.render(current.scene, current.orbitCamera)
  }

  if (!current.readyEmitted) {
    current.readyEmitted = true
    const backend = (current.renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend ? 'webgl' : 'webgpu'
    backendType.value = backend
    backendName.value = `${backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'} · ${props.bundle.stats.visibleSplatCount.toLocaleString()} splats`
    status.value = `${props.bundle.manifest.registration.status === 'known' ? 'Registered world frame' : 'Unregistered asset frame'} · ${props.bundle.stats.splatCount.toLocaleString()} splats`
    emit('ready', backend, performance.now() - renderStartedAt)
  }
}

function onKeydown(current: Runtime, event: KeyboardEvent): void {
  if (cameraPreviewId.value) return
  const control = current.controls
  const turn = 0.07
  if (event.key === 'ArrowLeft') control.rotateLeft(turn)
  else if (event.key === 'ArrowRight') control.rotateLeft(-turn)
  else if (event.key === 'ArrowUp') control.rotateUp(turn)
  else if (event.key === 'ArrowDown') control.rotateUp(-turn)
  else if (event.key === '+' || event.key === '=') control.dollyIn(1.15)
  else if (event.key === '-' || event.key === '_') control.dollyOut(1.15)
  else return
  event.preventDefault()
  control.update()
  draw(current)
}

function initialize(): void {
  const token = ++generation
  const previousStartup = startupTask
  startupTask = (async () => {
    try { await previousStartup } catch { /* A previous failed renderer init must not block a retry. */ }
    if (isCurrent(token)) await initializeRuntime(token)
  })()
}

async function initializeRuntime(token: number): Promise<void> {
  const old = runtime
  runtime = null
  if (old) cleanupBarrier = disposeRuntime(old)
  await cleanupBarrier
  if (!isCurrent(token) || !canvas.value) return
  status.value = 'Loading local splat data and renderer…'
  backendName.value = ''
  backendType.value = 'initializing'

  let renderer: Renderer | null = null
  let sourceGeometry: InstanceType<ThreeModule['BufferGeometry']> | null = null
  let candidateSplat: Gaussian | null = null
  let candidateRuntime: Runtime | null = null
  try {
    const [THREE, { SPLATLoader }, { GaussianSplat }, { OrbitControls }] = await Promise.all([
      import('three/webgpu'),
      import('three/addons/loaders/SPLATLoader.js'),
      import('three/addons/objects/GaussianSplat.js'),
      import('three/addons/controls/OrbitControls.js'),
    ])
    if (!isCurrent(token)) return

    const bytes = props.bundle.assetBytes
    if (bytes.byteLength < 32 || bytes.byteLength > VISUAL_LIMITS.assetBytes || bytes.byteLength % 32 !== 0) {
      throw new Error('The splat file must contain 1–262,144 complete 32-byte records and stay within 8 MiB.')
    }
    if (bytes.byteLength / 32 !== props.bundle.manifest.asset.splatCount || bytes.byteLength / 32 !== props.bundle.stats.splatCount) {
      throw new Error('The splat record count does not match the validated manifest.')
    }
    const forceWebGL = new URLSearchParams(window.location.search).get('spatial-webgl') === '1'
    const rendererOptions = { canvas: canvas.value, antialias: true, alpha: false, powerPreference: 'high-performance' as const }
    renderer = new THREE.WebGPURenderer({ ...rendererOptions, forceWebGL })
    try {
      await renderer.init()
    } catch (error) {
      try { await renderer.dispose() } catch { /* Retry with an explicit WebGL 2 backend below. */ }
      if (forceWebGL || !isCurrent(token)) throw error
      renderer = new THREE.WebGPURenderer({ ...rendererOptions, forceWebGL: true })
      await renderer.init()
    }
    if (!isCurrent(token)) {
      await renderer.dispose()
      return
    }
    renderer.setClearColor('#f3efe7', 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping

    const exactBuffer = bytes.slice().buffer
    const sourceView = new DataView(exactBuffer)
    for (let row = 0; row < exactBuffer.byteLength / 32; row += 1) {
      for (let component = 0; component < 3; component += 1) {
        const scale = sourceView.getFloat32(row * 32 + 12 + component * 4, true)
        if (!Number.isFinite(scale) || scale <= 0 || scale > 10_000) {
          throw new Error('The splat contains non-finite or out-of-range Gaussian scales.')
        }
      }
    }
    sourceGeometry = new SPLATLoader().parse(exactBuffer)
    const centers = sourceGeometry.getAttribute('position') as Attribute | undefined
    const covariance = sourceGeometry.getAttribute('covariance') as Attribute | undefined
    if (!centers || !covariance || centers.count === 0 || centers.count > VISUAL_LIMITS.splatCount) {
      throw new Error('The splat data did not decode into a bounded position and covariance set.')
    }
    for (let index = 0; index < centers.count; index += 1) {
      const x = centers.getX(index), y = centers.getY(index), z = centers.getZ(index)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
        || Math.abs(x) > VISUAL_LIMITS.coordinate || Math.abs(y) > VISUAL_LIMITS.coordinate || Math.abs(z) > VISUAL_LIMITS.coordinate) {
        throw new Error('The splat contains non-finite or out-of-range center coordinates.')
      }
      for (let component = 0; component < 6; component += 1) {
        if (!Number.isFinite(covariance.getComponent(index, component))) throw new Error('The splat contains non-finite Gaussian scales or orientations.')
      }
    }
    if (!isCurrent(token)) {
      sourceGeometry.dispose()
      sourceGeometry = null
      await renderer.dispose()
      return
    }
    candidateSplat = new GaussianSplat(sourceGeometry as unknown as ConstructorParameters<SplatModule['GaussianSplat']>[0])

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f3efe7')
    scene.add(new THREE.HemisphereLight('#fffdf7', '#827d71', 2.4))
    const key = new THREE.DirectionalLight('#fff8e9', 1.8)
    key.position.set(-4, 7, 6)
    scene.add(key)
    const displayRoot = new THREE.Group()
    const assetRoot = new THREE.Group()
    const cameraLines = new THREE.Group()
    const bounds = visualBounds(THREE)
    const localCenter = bounds.min.clone().add(bounds.max).multiplyScalar(0.5)
    const registration = props.bundle.manifest.registration
    const registrationScale = registration.status === 'known' ? registration.scaleMPerUnit : 1
    const registrationRotation = registration.status === 'known' ? quaternionFrom(registration.rotationXyzw, THREE) : new THREE.Quaternion()
    const registrationTranslation = registration.status === 'known' ? positionFrom(registration.translationM, THREE) : new THREE.Vector3()
    const worldCenter = localCenter.clone().multiplyScalar(registrationScale).applyQuaternion(registrationRotation).add(registrationTranslation)
    const renderOrigin = worldCenter.clone()
    assetRoot.position.copy(registrationTranslation)
    assetRoot.quaternion.copy(registrationRotation)
    assetRoot.scale.setScalar(registrationScale)
    const runtimeStub = {
      THREE, renderer, scene, displayRoot, assetRoot, splat: candidateSplat,
      orbitCamera: new THREE.PerspectiveCamera(43, 1, 0.001, 1_000_000),
      previewCamera: new THREE.PerspectiveCamera(50, 1, 0.001, 1_000_000),
      controls: null as unknown as Controls,
      resize: new ResizeObserver(() => { if (runtime) draw(runtime) }),
      keydown: (_event: KeyboardEvent) => {},
      contextLost: (_event: Event) => {},
      renderOrigin, registrationRotation, registrationTranslation, registrationScale,
      localCenter, worldCenter, boundsRadius: 1,
      cameraLines, readyEmitted: false, disposed: false,
    } satisfies Runtime
    const current = runtimeStub as Runtime
    candidateRuntime = current
    addBoundsAndGrid(current)
    candidateSplat.computeBoundingSphere()
    current.boundsRadius = Math.max(current.boundsRadius, (candidateSplat.boundingSphere?.radius ?? 0) * current.registrationScale)
    for (const camera of props.bundle.manifest.cameras) cameraLines.add(makeFrustum(camera, current))
    current.cameraLines.visible = props.showCameras
    current.splat.visible = props.showAsset
    current.assetRoot.add(candidateSplat, current.cameraLines)
    displayRoot.add(assetRoot)
    displayRoot.position.copy(renderOrigin).negate()
    scene.add(displayRoot)
    const frameUp = registration.status === 'known' ? '+z' : props.bundle.manifest.assetFrame.up
    const frameUpSign = frameUp.startsWith('-') ? -1 : 1
    if (frameUp.endsWith('y')) current.orbitCamera.up.set(0, frameUpSign, 0)
    else current.orbitCamera.up.set(0, 0, frameUpSign)
    current.controls = new OrbitControls(current.orbitCamera, canvas.value)
    current.controls.enableDamping = false
    current.controls.addEventListener('change', () => draw(current))
    fitOrbit(current)
    current.resize.observe(canvas.value)
    current.keydown = event => onKeydown(current, event)
    current.contextLost = (event) => {
      event.preventDefault()
      safeUnavailable('Graphics context was lost. The validated local bundle remains available; close and reopen the viewer to retry.')
      const lost = runtime
      runtime = null
      if (lost) cleanupBarrier = disposeRuntime(lost)
    }
    canvas.value.addEventListener('keydown', current.keydown)
    canvas.value.addEventListener('webglcontextlost', current.contextLost)
    runtime = current
    const backendDevice = (renderer.backend as { device?: { lost?: Promise<{ message?: string }> } }).device
    void backendDevice?.lost?.then((info) => {
      if (runtime !== current || current.disposed) return
      safeUnavailable(info.message || 'Graphics device was lost. The validated local bundle remains available.')
      runtime = null
      cleanupBarrier = disposeRuntime(current)
    })
    status.value = 'Preparing first render…'
    draw(current)
  } catch (error) {
    if (candidateRuntime) {
      if (runtime === candidateRuntime) runtime = null
      try { await disposeRuntime(candidateRuntime) } catch { /* Best-effort cleanup of partially assembled scene. */ }
    } else {
      if (sourceGeometry && !candidateSplat) sourceGeometry.dispose()
      if (candidateSplat) {
        candidateSplat.geometry.dispose()
        candidateSplat.material.dispose()
        candidateSplat.splatGeometry.dispose()
      }
    }
    if (renderer && !candidateRuntime) {
      try { await renderer.dispose() } catch { /* Best-effort cleanup of a partial init. */ }
    }
    if (isCurrent(token)) {
      const detail = error instanceof Error ? error.message : 'unsupported renderer or invalid splat data'
      safeUnavailable(`Spatial splat viewer unavailable: ${detail}`)
    }
  }
}

function stop(): void {
  generation += 1
  const current = runtime
  runtime = null
  if (current) cleanupBarrier = disposeRuntime(current)
  status.value = 'Viewer closed · local bundle remains in the workspace'
  backendName.value = ''
  backendType.value = 'initializing'
}

function resetView(): void {
  const current = runtime
  if (!current) return
  if (cameraPreviewId.value !== null) cameraPreviewId.value = null
  emit('reset')
  current.controls.reset()
  current.controls.enabled = true
  fitOrbit(current)
  draw(current)
  canvas.value?.focus()
}

watch(() => props.selectedCameraId, (cameraId) => {
  cameraPreviewId.value = cameraId
  if (runtime) draw(runtime)
})
watch(() => [props.showAsset, props.showCameras] as const, ([showAsset, showCameras]) => {
  if (!runtime) return
  runtime.splat.visible = showAsset
  runtime.cameraLines.visible = showCameras
  draw(runtime)
})
watch(() => [props.active, props.bundle] as const, ([active]) => {
  if (!mounted) return
  if (active) void initialize()
  else stop()
})

onMounted(() => {
  mounted = true
  if (props.active) void initialize()
})

onBeforeUnmount(() => {
  mounted = false
  stop()
})
</script>

<template>
  <section class="splat-viewer" aria-label="Registered Gaussian splat viewer" :data-active="active">
    <canvas
      ref="canvas"
      class="splat-canvas"
      data-testid="visual-canvas"
      :data-backend="backendType"
      tabindex="0"
      aria-label="Interactive Gaussian splat visualization. Use arrow keys to orbit, plus and minus to zoom, or the reset view button."
    />
    <div class="viewer-stamp" aria-hidden="true"><span>LOCAL VISUAL REFERENCE</span><strong>{{ bundle.manifest.label }}</strong></div>
    <div class="viewer-status" role="status" data-testid="visual-status"><i :class="{ unavailable: status.includes('unavailable') || status.includes('lost') }" />{{ status }}</div>
    <div class="viewer-backend" data-testid="visual-backend">{{ backendName || 'RENDERER / WAITING' }}</div>
    <div v-if="bundle.manifest.cameras.length" class="viewer-legend" aria-label="Camera frustum roles">
      <span v-if="bundle.manifest.cameras.some(camera => camera.role === 'training')"><i class="training" />training</span><span v-if="bundle.manifest.cameras.some(camera => camera.role === 'held-out')"><i class="held-out" />held-out</span><span v-if="bundle.manifest.cameras.some(camera => camera.role === 'illustrative')"><i class="illustrative" />illustrative</span>
    </div>
    <button class="reset-button" type="button" data-testid="visual-reset" aria-label="Reset orbit view" @click="resetView">Reset view <span aria-hidden="true">↺</span></button>
  </section>
</template>

<style scoped>
.splat-viewer{--paper:#f3efe7;--ink:#283e36;--green:#315b43;--line:#d9d5c9;position:relative;isolation:isolate;width:100%;height:clamp(320px,40vw,480px);min-height:320px;overflow:hidden;border:1px solid #ded8cc;border-radius:3px;background-color:var(--paper);background-image:linear-gradient(rgba(49,63,59,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(49,63,59,.035) 1px,transparent 1px);background-size:24px 24px;color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif;text-align:left}
.splat-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline:none}.splat-canvas:focus-visible{outline:2px solid #2d7770;outline-offset:-3px}
.viewer-stamp{position:absolute;left:16px;top:14px;display:grid;gap:4px;max-width:52%;pointer-events:none}.viewer-stamp span{color:#52634f;font:8px ui-monospace,monospace;letter-spacing:1.1px}.viewer-stamp strong{color:#2c4938;font:400 16px Georgia,serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viewer-status{position:absolute;left:16px;bottom:47px;display:flex;align-items:center;gap:7px;max-width:64%;padding:6px 8px;border:1px solid #dbd8ca;background:#fffdf6eF;color:#566459;font:8px/1.5 ui-monospace,monospace;pointer-events:none}.viewer-status i{flex:none;width:6px;height:6px;border-radius:50%;background:#6f896c}.viewer-status i.unavailable{background:#ad613f}
.viewer-backend{position:absolute;right:15px;top:15px;padding:6px 8px;border:1px solid #d8d5c9;background:#fffdf6d9;color:#59665b;font:8px ui-monospace,monospace;letter-spacing:.5px;pointer-events:none}
.viewer-legend{position:absolute;right:15px;bottom:45px;display:grid;gap:5px;padding:8px 9px;border:1px solid #dad7ca;background:#fffdf6eb;color:#5c695e;font:8px ui-monospace,monospace;pointer-events:none}.viewer-legend span{display:flex;align-items:center;gap:7px}.viewer-legend i{width:12px;height:2px;background:#47775b}.viewer-legend i.held-out{background:#b65d3b}.viewer-legend i.illustrative{background:#7a7880}
.reset-button{position:absolute;right:15px;bottom:13px;display:flex;align-items:center;gap:10px;min-height:28px;padding:5px 9px;border:1px solid #abb8a6;border-radius:3px;background:#fdfbf4;color:#355740;font:600 9px ui-sans-serif,system-ui;cursor:pointer}.reset-button:hover{background:#e8eee3}.reset-button:focus-visible{outline:2px solid #2d7770;outline-offset:2px}
@media(max-width:560px){.splat-viewer{height:300px;min-height:260px}.viewer-stamp{left:10px;top:10px}.viewer-backend{right:9px;top:9px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.viewer-status{left:9px;bottom:49px;max-width:60%;font-size:7px}.viewer-legend{right:9px;bottom:47px;font-size:7px}.reset-button{right:9px;bottom:9px}}
</style>
