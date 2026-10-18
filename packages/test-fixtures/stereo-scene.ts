import type { StereoCamera, StereoImage, StereoTruth, StereoView } from '../spatial-stereo-types.ts'

/** Evaluator/generator only. Reconstruction must not import this module. */
const INTRINSICS = { width: 160, height: 120, fx: 140, fy: 140, cx: 80, cy: 60 }

function lattice(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const a = lattice(ix, iy, seed) * (1 - fx) + lattice(ix + 1, iy, seed) * fx
  const b = lattice(ix, iy + 1, seed) * (1 - fx) + lattice(ix + 1, iy + 1, seed) * fx
  return a * (1 - fy) + b * fy
}

function ray(camera: StereoCamera, pixelX: number, pixelY: number): { depthM: number; rgb: number[] } {
  const { fx, fy, cx, cy } = camera.intrinsics
  const [cameraX, cameraY, cameraZ] = camera.positionM
  const dx = (pixelX - cx) / fx, dy = -(pixelY - cy) / fy
  // The reference scene is never supplied to the estimator: tilted backdrop plus finite occluder.
  let depth = (3.6 + cameraZ + 0.18 * cameraX - 0.12 * cameraY) / (1 - 0.18 * dx + 0.12 * dy)
  const foregroundDepth = 2.25 + cameraZ
  const foregroundX = cameraX + foregroundDepth * dx, foregroundY = cameraY + foregroundDepth * dy
  const foreground = foregroundX >= -0.28 && foregroundX <= 0.37 && foregroundY >= -0.52 && foregroundY <= 0.34
  if (foreground && foregroundDepth < depth) depth = foregroundDepth
  const x = cameraX + depth * dx, y = cameraY + depth * dy
  if (!foreground && x > 1.15 && x < 1.5) return { depthM: depth, rgb: [190, 184, 169] }
  const offset = foreground ? 97 : 13
  const red = noise(x * 14, y * 14, offset)
  const green = noise(x * 14, y * 14, offset + 31)
  const blue = noise(x * 14, y * 14, offset + 79)
  return { depthM: depth, rgb: foreground ? [100 + red * 140, 35 + green * 110, 30 + blue * 100] : [45 + red * 150, 65 + green * 110, 60 + blue * 130] }
}

function render(camera: StereoCamera): { view: StereoView; truth: StereoTruth } {
  const { width, height } = camera.intrinsics
  const rgb = new Uint8Array(width * height * 3)
  const depthM: number[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = [0, 0, 0]
    for (const ox of [0.25, 0.75]) for (const oy of [0.25, 0.75]) {
      const sample = ray(camera, x + ox, y + oy)
      for (let channel = 0; channel < 3; channel++) color[channel]! += sample.rgb[channel]! / 4
    }
    const index = y * width + x
    for (let channel = 0; channel < 3; channel++) rgb[index * 3 + channel] = Math.round(color[channel]!)
    // Float32 truth is a separate binary fixture with explicit endianness.
    depthM.push(Math.fround(ray(camera, x + 0.5, y + 0.5).depthM))
  }
  const image: StereoImage = { width, height, rgb }
  return { view: { camera, image }, truth: { camera, depthM } }
}

export function createStereoScene(): {
  id: string
  training: { left: StereoView; right: StereoView }
  referenceTruth: StereoTruth
  heldOut: { view: StereoView; truth: StereoTruth }[]
} {
  const camera = (id: string, positionM: [number, number, number]): StereoCamera => ({ id, positionM, intrinsics: { ...INTRINSICS } })
  const left = render(camera('stereo-left', [-0.15, 0, 0]))
  const right = render(camera('stereo-right', [0.15, 0, 0]))
  return {
    id: 'synthetic-tilted-backdrop-v1',
    training: { left: left.view, right: right.view },
    referenceTruth: left.truth,
    heldOut: [render(camera('held-out-upper', [0, 0.08, 0.02])), render(camera('held-out-lower', [0.08, -0.06, -0.03]))],
  }
}
