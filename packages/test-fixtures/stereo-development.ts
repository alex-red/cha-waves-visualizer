import type { StereoCamera, StereoImage, StereoInput, StereoView } from '../spatial-stereo-types.ts'

export type StereoDevelopmentSplit = 'development' | 'evaluation'

export type StereoDevelopmentCase = {
  id: string
  split: StereoDevelopmentSplit
  input: StereoInput
  truth: {
    camera: StereoCamera
    disparityPx: (number | null)[]
    depthM: (number | null)[]
  }
  regions: {
    boundary: number[]
    weakTexture: number[]
    /** Left-visible pixels without an in-frame, unoccluded right-view correspondence. */
    occlusion: number[]
  }
}

type Point2 = readonly [number, number]
export type StereoReferenceScene = {
  id: string
  seed: number
  split: StereoDevelopmentSplit
  backdrop: { z: number; slopeX: number; slopeY: number }
  foreground: { z: number; polygon: Point2[] } | null
  texture: 'lattice' | 'weak-stripe-repeat' | 'repeat-lattice'
  stripe: { minX: number; maxX: number } | null
  rightGain: number
  rightOffset: number
}
type Scene = StereoReferenceScene

const WIDTH = 160
const HEIGHT = 120
const FX = 140
const FY = 140
const BASELINE_M = 0.3
const LEFT_CX = 80
const RIGHT_CX = 82.5
const CY = 60

// The case definitions, including evaluation-only seeds and geometry, stay private to this generator.
const SCENES: readonly Scene[] = [
  {
    id: 'dev-textured-tilt-occluder-a', split: 'development', seed: 101,
    backdrop: { z: 3.6, slopeX: 0.18, slopeY: -0.12 },
    foreground: { z: 2.25, polygon: [[-0.28, -0.52], [0.37, -0.52], [0.37, 0.34], [-0.28, 0.34]] },
    texture: 'lattice', stripe: null, rightGain: 1, rightOffset: 0,
  },
  {
    id: 'dev-weak-stripe-repeated-a', split: 'development', seed: 203,
    backdrop: { z: 3.42, slopeX: 0.12, slopeY: -0.08 },
    foreground: { z: 2.4, polygon: [[-0.35, -0.4], [0.32, -0.4], [0.32, 0.35], [-0.35, 0.35]] },
    texture: 'weak-stripe-repeat', stripe: { minX: -0.35, maxX: 0.2 }, rightGain: 1, rightOffset: 0,
  },
  {
    id: 'dev-exposure-tilt-occluder-a', split: 'development', seed: 307,
    backdrop: { z: 3.72, slopeX: 0.2, slopeY: -0.14 },
    foreground: { z: 2.3, polygon: [[-0.42, -0.48], [0.24, -0.48], [0.34, 0.24], [-0.32, 0.24]] },
    texture: 'lattice', stripe: null, rightGain: 1.06, rightOffset: 4,
  },
  {
    id: 'eval-textured-tilt-occluder-b', split: 'evaluation', seed: 419,
    backdrop: { z: 3.5, slopeX: -0.16, slopeY: 0.1 },
    foreground: { z: 2.18, polygon: [[-0.34, -0.42], [0.12, -0.5], [0.43, 0.12], [0.02, 0.4], [-0.4, 0.2]] },
    texture: 'repeat-lattice', stripe: null, rightGain: 1, rightOffset: 0,
  },
  {
    id: 'eval-weak-stripe-tilt-occluder-b', split: 'evaluation', seed: 523,
    backdrop: { z: 3.66, slopeX: 0.09, slopeY: 0.2 },
    foreground: { z: 2.34, polygon: [[-0.45, -0.34], [0.26, -0.43], [0.4, 0.1], [-0.18, 0.46]] },
    texture: 'weak-stripe-repeat', stripe: { minX: -0.42, maxX: 0.05 }, rightGain: 1, rightOffset: 0,
  },
]

function lattice(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx0 = x - ix, fy0 = y - iy
  const fx = fx0 * fx0 * (3 - 2 * fx0), fy = fy0 * fy0 * (3 - 2 * fy0)
  const a = lattice(ix, iy, seed) * (1 - fx) + lattice(ix + 1, iy, seed) * fx
  const b = lattice(ix, iy + 1, seed) * (1 - fx) + lattice(ix + 1, iy + 1, seed) * fx
  return a * (1 - fy) + b * fy
}

function pointInPolygon(x: number, y: number, polygon: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

type Hit = { z: number; x: number; y: number; surface: 'backdrop' | 'foreground' }

function rayHit(scene: Scene, camera: StereoCamera, u: number, v: number): Hit {
  const { fx, fy, cx, cy } = camera.intrinsics
  const [ox, oy, oz] = camera.positionM
  const dx = (u - cx) / fx
  const dy = -(v - cy) / fy
  const { z, slopeX, slopeY } = scene.backdrop
  const backdropZ = (z + slopeX * ox + slopeY * oy - oz) / (1 - slopeX * dx - slopeY * dy)
  let hit: Hit = { z: backdropZ, x: ox + backdropZ * dx, y: oy + backdropZ * dy, surface: 'backdrop' }
  const foreground = scene.foreground
  if (foreground) {
    const foregroundZ = foreground.z + oz
    const foregroundX = ox + foregroundZ * dx
    const foregroundY = oy + foregroundZ * dy
    if (foregroundZ > 0 && foregroundZ < hit.z && pointInPolygon(foregroundX, foregroundY, foreground.polygon)) {
      hit = { z: foregroundZ, x: foregroundX, y: foregroundY, surface: 'foreground' }
    }
  }
  return hit
}

function textureAt(scene: Scene, hit: Hit): [number, number, number] {
  const weak = scene.stripe !== null && hit.x >= scene.stripe.minX && hit.x <= scene.stripe.maxX
  const scale = scene.texture === 'repeat-lattice' ? 19 : 16
  const repeated = scene.texture !== 'lattice'
  const tx = repeated ? hit.x / 0.43 : hit.x * scale
  const ty = repeated ? hit.y / 0.43 : hit.y * scale
  const amp = weak ? 3 : 42
  const channels = [17, 53, 89]
  const surfaceSeed = hit.surface === 'foreground' ? scene.seed + 701 : scene.seed + 17
  return channels.map((channel, index) => {
    const n = smoothNoise(tx, ty, surfaceSeed + channel + index * 113)
    const broad = smoothNoise(hit.x * 3.1, hit.y * 3.1, surfaceSeed + 1301 + channel)
    let value = 58 + index * 22 + (n - 0.5) * amp + (broad - 0.5) * (weak ? 2 : 18)
    if (repeated && !weak) {
      const periodX = ((hit.x + 2) % 0.43 + 0.43) % 0.43
      const periodY = ((hit.y + 2) % 0.43 + 0.43) % 0.43
      value += (periodX < 0.06 || periodY < 0.06) ? 24 : -8
    }
    return Math.max(0, Math.min(255, value))
  }) as [number, number, number]
}

function render(scene: Scene, camera: StereoCamera): StereoView {
  const { width, height } = camera.intrinsics
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const color = [0, 0, 0]
    for (const ox of [0.25, 0.75]) for (const oy of [0.25, 0.75]) {
      const hit = rayHit(scene, camera, x + ox, y + oy)
      const sample = textureAt(scene, hit)
      for (let channel = 0; channel < 3; channel += 1) {
        const adjusted = camera.id.endsWith('-right') ? sample[channel]! * scene.rightGain + scene.rightOffset : sample[channel]!
        color[channel]! += Math.max(0, Math.min(255, adjusted)) / 4
      }
    }
    const pixel = y * width + x
    for (let channel = 0; channel < 3; channel += 1) rgb[pixel * 3 + channel] = Math.round(color[channel]!)
  }
  const image: StereoImage = { width, height, rgb }
  return { camera, image }
}

function distanceToSegment(px: number, py: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSquared))
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
}

function project(camera: StereoCamera, x: number, y: number, z: number): Point2 {
  const { fx, fy, cx, cy } = camera.intrinsics
  const [ox, oy, oz] = camera.positionM
  const depth = z - oz
  return [fx * (x - ox) / depth + cx, cy - fy * (y - oy) / depth]
}

function foregroundBoundary(scene: Scene, camera: StereoCamera): Set<number> {
  const result = new Set<number>()
  if (!scene.foreground) return result
  const corners = scene.foreground.polygon.map(([x, y]) => project(camera, x, y, scene.foreground!.z))
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    if (corners.some((corner, i) => distanceToSegment(x + 0.5, y + 0.5, corner, corners[(i + 1) % corners.length]!) <= 2)) {
      result.add(y * WIDTH + x)
    }
  }
  return result
}

function camera(id: string, positionM: [number, number, number], cx: number): StereoCamera {
  return { id, positionM, intrinsics: { width: WIDTH, height: HEIGHT, fx: FX, fy: FY, cx, cy: CY } }
}

function makeCase(scene: Scene): StereoDevelopmentCase {
  const leftCamera = camera(`${scene.id}-left`, [-BASELINE_M / 2, 0, 0], LEFT_CX)
  const rightCamera = camera(`${scene.id}-right`, [BASELINE_M / 2, 0, 0], RIGHT_CX)
  const left = render(scene, leftCamera)
  const right = render(scene, rightCamera)
  const disparityPx: (number | null)[] = []
  const depthM: (number | null)[] = []
  const boundary = foregroundBoundary(scene, leftCamera)
  const weakTexture: number[] = []
  const occlusion: number[] = []

  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const pixel = y * WIDTH + x
    const u = x + 0.5, v = y + 0.5
    const hit = rayHit(scene, leftCamera, u, v)
    if (scene.stripe && hit.x >= scene.stripe.minX && hit.x <= scene.stripe.maxX) weakTexture.push(pixel)

    const [rightU, rightV] = project(rightCamera, hit.x, hit.y, hit.z)
    const rightInside = rightU >= 0.5 && rightU < WIDTH - 0.5 && rightV >= 0.5 && rightV < HEIGHT - 0.5
    const rightHit = rightInside ? rayHit(scene, rightCamera, rightU, rightV) : null
    const visibleRight = rightHit !== null && rightHit.surface === hit.surface && Math.abs(rightHit.z - (hit.z - rightCamera.positionM[2])) < 1e-6
    if (!visibleRight) occlusion.push(pixel)
    disparityPx.push(u - rightU)
    depthM.push(hit.z - leftCamera.positionM[2])
  }

  return {
    id: scene.id,
    split: scene.split,
    input: { left, right },
    truth: { camera: leftCamera, disparityPx, depthM },
    regions: { boundary: [...boundary].sort((a, b) => a - b), weakTexture, occlusion },
  }
}

/** Render an explicitly supplied scene definition into estimator input and evaluator-only truth. */
export function createStereoReferenceCase(scene: StereoReferenceScene): StereoDevelopmentCase {
  return makeCase(scene)
}

/** Generate one split only; evaluation scenes are not returned with development data. */
export function createStereoDevelopmentCases(split: StereoDevelopmentSplit): StereoDevelopmentCase[] {
  if (split !== 'development' && split !== 'evaluation') throw new Error('split must be development or evaluation')
  return SCENES.filter(scene => scene.split === split).map(createStereoReferenceCase)
}
