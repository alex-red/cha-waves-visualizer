import type { VisualManifest } from '../spatial-visual-types.ts'

const BYTES_PER_SPLAT = 32
const splats: number[] = []

function addSplat(
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  rgba: readonly [number, number, number, number],
  wxyz: readonly [number, number, number, number] = [1, 0, 0, 0],
): void {
  const buffer = new ArrayBuffer(BYTES_PER_SPLAT)
  const view = new DataView(buffer)
  view.setFloat32(0, x, true)
  view.setFloat32(4, y, true)
  view.setFloat32(8, z, true)
  view.setFloat32(12, sx, true)
  view.setFloat32(16, sy, true)
  view.setFloat32(20, sz, true)
  rgba.forEach((channel, index) => view.setUint8(24 + index, channel))
  // Standard packed splat order is quaternion WXYZ, encoded from [-1,1] to [0,255].
  wxyz.forEach((component, index) => view.setUint8(28 + index, Math.round((component + 1) * 127.5)))
  for (let index = 0; index < BYTES_PER_SPLAT; index++) splats.push(view.getUint8(index))
}

const cream: [number, number, number, number] = [220, 208, 177, 255]
const paleCream: [number, number, number, number] = [237, 229, 207, 255]
const green: [number, number, number, number] = [105, 132, 108, 255]
const darkGreen: [number, number, number, number] = [71, 98, 77, 255]
const rust: [number, number, number, number] = [166, 91, 65, 255]
const wood: [number, number, number, number] = [151, 112, 80, 255]

// Floor: 29 x 24 = 696 flat anisotropic splats.
for (let ix = 0; ix < 29; ix++) for (let iy = 0; iy < 24; iy++) {
  addSplat(0.12 + ix * 0.2, 0.12 + iy * 0.2, 0.035, 0.09, 0.09, 0.012,
    (ix + iy) % 5 === 0 ? paleCream : cream)
}

// Back and left walls form an open two-wall diorama, with flattened depth axes.
for (let ix = 0; ix < 29; ix++) for (let iz = 0; iz < 15; iz++) {
  addSplat(0.12 + ix * 0.2, 4.98, 0.12 + iz * 0.2, 0.09, 0.012, 0.09,
    iz % 4 === 0 ? paleCream : cream)
}
for (let iy = 0; iy < 24; iy++) for (let iz = 0; iz < 15; iz++) {
  addSplat(0.02, 0.12 + iy * 0.2, 0.12 + iz * 0.2, 0.012, 0.09, 0.09,
    iz % 4 === 0 ? paleCream : cream)
}

// Simple desk: a thin tabletop and four tapered-looking leg columns.
for (let ix = 0; ix < 13; ix++) for (let iy = 0; iy < 7; iy++) {
  addSplat(2.16 + ix * 0.14, 1.58 + iy * 0.14, 0.86, 0.062, 0.062, 0.018,
    (ix + iy) % 4 === 0 ? rust : wood)
}
for (const x of [2.25, 3.75]) for (const y of [1.68, 2.38]) for (let iz = 0; iz < 5; iz++) {
  addSplat(x, y, 0.13 + iz * 0.14, 0.025, 0.025, 0.07, wood)
}

// Low cabinet at the room's right side: front, side and top surfaces.
for (let ix = 0; ix < 7; ix++) for (let iz = 0; iz < 11; iz++) {
  addSplat(4.2 + ix * 0.15, 3.32, 0.15 + iz * 0.15, 0.065, 0.014, 0.065,
    iz % 4 === 0 ? rust : wood)
}
for (let iy = 0; iy < 5; iy++) for (let iz = 0; iz < 11; iz++) {
  addSplat(5.12, 3.4 + iy * 0.15, 0.15 + iz * 0.15, 0.014, 0.065, 0.065, wood)
}
for (let ix = 0; ix < 7; ix++) for (let iy = 0; iy < 5; iy++) {
  addSplat(4.2 + ix * 0.15, 3.4 + iy * 0.15, 1.72, 0.065, 0.065, 0.014, wood)
}

// Plant: terracotta pot rings, a stem, and deliberately simple leaf clusters.
const plantX = 1.05, plantY = 3.75
for (const [z, radius, color] of [[0.12, 0.2, rust], [0.38, 0.15, rust], [0.4, 0.16, paleCream]] as const) {
  for (let i = 0; i < 16; i++) {
    const ringPositions: [number, number][] = [
      [0.2, 0], [0.1848, 0.0765], [0.1414, 0.1414], [0.0765, 0.1848],
      [0, 0.2], [-0.0765, 0.1848], [-0.1414, 0.1414], [-0.1848, 0.0765],
      [-0.2, 0], [-0.1848, -0.0765], [-0.1414, -0.1414], [-0.0765, -0.1848],
      [0, -0.2], [0.0765, -0.1848], [0.1414, -0.1414], [0.1848, -0.0765],
    ]
    const [dx, dy] = ringPositions[i]!
    addSplat(plantX + dx * radius / 0.2, plantY + dy * radius / 0.2, z, 0.045, 0.045, 0.025, color)
  }
}
for (let iz = 0; iz < 10; iz++) addSplat(plantX, plantY, 0.48 + iz * 0.1, 0.025, 0.025, 0.055, darkGreen)
const leaves = [
  [0.34, 0, 0.88], [-0.34, 0, 0.96], [0, 0.34, 1.06], [0, -0.34, 0.94],
  [0.24, 0.24, 1.22], [-0.24, 0.24, 1.14], [0.24, -0.24, 1.3], [-0.24, -0.24, 1.24],
] as const
for (const [dx, dy, z] of leaves) {
  for (let i = 0; i < 7; i++) {
    const t = (i - 3) * 0.035
    addSplat(plantX + dx * (0.55 + i * 0.025), plantY + dy * (0.55 + i * 0.025), z + t,
      0.065, 0.022, 0.035, i % 3 === 0 ? green : darkGreen)
  }
}

const SPLAT_COUNT = splats.length / BYTES_PER_SPLAT

/** Return a fresh, deterministic 32-byte-per-Gaussian synthetic appearance fixture. */
export function createSyntheticVisualAsset(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(splats)
}

function normalize(vector: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector)
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function lookAtQuaternion(position: [number, number, number], target: [number, number, number]): [number, number, number, number] {
  // OpenGL camera local -Z points at the target and local +Y remains as upright as possible.
  const forward = normalize([target[0] - position[0], target[1] - position[1], target[2] - position[2]])
  const horizontalLength = Math.hypot(forward[0], forward[1])
  const right: [number, number, number] = horizontalLength < 1e-10
    ? [1, 0, 0]
    : [forward[1] / horizontalLength, -forward[0] / horizontalLength, 0]
  const up: [number, number, number] = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  const m00 = right[0], m01 = up[0], m02 = -forward[0]
  const m10 = right[1], m11 = up[1], m12 = -forward[1]
  const m20 = right[2], m21 = up[2], m22 = -forward[2]
  const trace = m00 + m11 + m22
  let x: number, y: number, z: number, w: number
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s
  }
  const norm = Math.hypot(x, y, z, w)
  return [x / norm, y / norm, z / norm, w / norm]
}

function camera(id: string, position: [number, number, number], target: [number, number, number]): VisualManifest['cameras'][number] {
  return {
    id,
    role: 'illustrative',
    position,
    orientationXyzw: lookAtQuaternion(position, target),
    intrinsics: { width: 1280, height: 720, fx: 820, fy: 820, cx: 640, cy: 360 },
    imageSha256: null,
  }
}

export function createSyntheticVisualManifest(assetSha256: string): VisualManifest {
  return {
    format: 'cha-visual-bundle-v1',
    id: 'synthetic-study-room',
    label: 'Synthetic study room diorama',
    asset: { fileName: 'synthetic-study-room.splat', format: 'splat32', sha256: assetSha256, splatCount: SPLAT_COUNT },
    assetFrame: { handedness: 'right', up: '+z', cameraConvention: 'opengl' },
    worldFrame: { units: 'm', axes: 'right-handed-z-up' },
    registration: {
      status: 'known', scaleMPerUnit: 1,
      rotationXyzw: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      translationM: [1, 2, 0], method: 'synthetic',
    },
    provenance: {
      kind: 'synthetic', creator: 'Cha Waves', sourceUrl: null,
      license: { name: 'MIT', url: null },
      method: 'proceduralGaussianfixture', version: '1',
      notes: 'Deterministic procedural synthetic appearance fixture. Not captured by a camera, not reconstructed from images, and not image-trained. Illustrative cameras are not training or held-out evidence.',
    },
    cameras: [
      camera('illustrative-front', [3, -5, 2.8], [3, 2.4, 1.25]),
      camera('illustrative-corner', [8, 3, 3.2], [3, 2.4, 1.35]),
      camera('illustrative-top', [3.8, 1.1, 7], [3, 2.4, 0.9]),
    ],
  }
}
