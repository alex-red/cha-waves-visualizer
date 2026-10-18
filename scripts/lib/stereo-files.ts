import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { decodePpm } from '../../packages/spatial-ppm.ts'
import { STEREO_OUTCOMES, type StereoInput, type StereoResult, type StereoTruth } from '../../packages/spatial-stereo-types.ts'

const finite = z.number().finite()
const vector = z.tuple([finite.min(-1e6).max(1e6), finite.min(-1e6).max(1e6), finite.min(-1e6).max(1e6)])
const cameraPosition = z.tuple([finite.min(-1e3).max(1e3), finite.min(-1e3).max(1e3), finite.min(-1e3).max(1e3)])
export const stereoCameraSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), positionM: cameraPosition,
  intrinsics: z.object({ width: z.number().int().min(1).max(256), height: z.number().int().min(1).max(192), fx: finite.min(1e-3).max(1e4), fy: finite.min(1e-3).max(1e4), cx: finite.min(0).max(256), cy: finite.min(0).max(192) }).strict(),
}).strict()
const fileSchema = z.object({ fileName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/).refine(name => name !== '.' && name !== '..'), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const imageSchema = fileSchema.extend({ camera: stereoCameraSchema }).strict()
const settingsSchema = z.object({ minDisparity: finite.int().min(1).max(254), maxDisparity: finite.int().min(2).max(255), patchRadius: finite.int().min(1).max(4), minTextureVariance: finite.min(0).max(65025), maxMeanAbsoluteError: finite.min(0).max(255), uniquenessRatio: finite.gt(0).lt(1), leftRightTolerancePx: finite.min(0).max(4) }).strict()
export const stereoInputSchema = z.object({
  format: z.literal('cha-stereo-input-v1'), id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  provenance: z.object({ kind: z.enum(['synthetic', 'recorded']), creator: z.string().min(1).max(256), license: z.string().min(1).max(256), notes: z.string().max(2048) }).strict(),
  frame: z.object({ units: z.literal('m'), axes: z.literal('right-handed-y-up'), cameraConvention: z.literal('opengl'), orientations: z.literal('identity-rectified') }).strict(),
  left: imageSchema, right: imageSchema, settings: settingsSchema,
}).strict()
export type StereoInputFile = z.infer<typeof stereoInputSchema>
export const stereoEvaluationSchema = z.object({
  format: z.literal('cha-stereo-evaluation-input-v1'), inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  referenceDepth: fileSchema,
  heldOut: z.array(z.object({ image: imageSchema, depth: fileSchema }).strict()).min(1).max(8),
}).strict()
const countsSchema = z.object({ border: z.number().int().nonnegative(), textureless: z.number().int().nonnegative(), photometric: z.number().int().nonnegative(), ambiguous: z.number().int().nonnegative(), inconsistent: z.number().int().nonnegative(), accepted: z.number().int().nonnegative() }).strict()
export const stereoResultSchema = z.object({
  format: z.literal('cha-stereo-result-v1'), inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  algorithm: z.enum(['rectified-rgb-sad-v1', 'rectified-census-sgm-v1']),
  sourceHashes: z.object({ left: z.string().regex(/^[a-f0-9]{64}$/), right: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  reconstruction: z.object({ status: z.enum(['empty', 'reconstructed']), width: z.number().int().min(1).max(256), height: z.number().int().min(1).max(192), baselineM: finite.positive().max(10), settings: settingsSchema, outcomes: z.array(z.number().int().min(0).max(STEREO_OUTCOMES.length - 1)).max(49152), counts: countsSchema,
    points: z.array(z.object({ pixelIndex: z.number().int().min(0).max(49151), positionM: vector, color: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]), disparityPx: finite.positive(), meanAbsoluteError: finite.min(0).max(255) }).strict()).max(49152),
  }).strict(),
  algorithmSettings: z.object({ p1: finite.int().min(1).max(24), p2: finite.int().min(2).max(96), maxCensusCost: finite.int().min(1).max(24), minComponentPixels: finite.int().min(1).max(49152) }).strict().optional(),
}).strict().superRefine((file, context) => {
  if (file.algorithm === 'rectified-census-sgm-v1') {
    if (!file.algorithmSettings || file.algorithmSettings.p2 <= file.algorithmSettings.p1) context.addIssue({ code: 'custom', message: 'Census SGM requires explicit valid algorithm settings.' })
  } else if (file.algorithmSettings !== undefined) context.addIssue({ code: 'custom', message: 'SAD baseline does not accept SGM settings.' })
})

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
export const jsonBytes = (value: unknown): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')

export async function readBounded(path: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const info = await lstat(path)
  if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw new Error('Input must be a bounded regular file.')
  const bytes = new Uint8Array(await readFile(path))
  if (bytes.byteLength !== info.size || bytes.byteLength > maxBytes) throw new Error('Input changed while reading.')
  return bytes
}

export async function readLinked(directory: string, file: z.infer<typeof fileSchema>, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const root = await realpath(directory)
  const path = join(root, file.fileName)
  if (dirname(await realpath(path)) !== root) throw new Error('Linked input must remain within its manifest directory.')
  const bytes = await readBounded(path, maxBytes)
  if (sha256(bytes) !== file.sha256) throw new Error(`SHA256 mismatch for ${file.fileName}.`)
  return bytes
}

export function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export async function loadStereoInput(path: string): Promise<{ file: StereoInputFile; bytes: Uint8Array<ArrayBuffer>; input: StereoInput }> {
  const absolute = resolve(path)
  const bytes = await readBounded(absolute, 64 * 1024)
  const file = stereoInputSchema.parse(parseJson(bytes))
  if (file.left.camera.id === file.right.camera.id || file.left.fileName === file.right.fileName) throw new Error('Stereo input requires distinct camera and file IDs.')
  const { width, height } = file.left.camera.intrinsics
  if (file.settings.minDisparity >= file.settings.maxDisparity || file.settings.maxDisparity >= width || file.settings.patchRadius * 2 + 1 > Math.min(width, height)) throw new Error('Disparity/patch settings are incompatible with the image dimensions.')
  if ([file.left.camera, file.right.camera].some(camera => camera.intrinsics.cx > camera.intrinsics.width || camera.intrinsics.cy > camera.intrinsics.height)) throw new Error('Principal point is outside the image.')
  for (const key of ['width', 'height', 'fx', 'fy', 'cy'] as const) {
    if (file.left.camera.intrinsics[key] !== file.right.camera.intrinsics[key]) throw new Error('Rectified camera dimensions, focal lengths and vertical principal point must match.')
  }
  if (file.settings.minDisparity + file.right.camera.intrinsics.cx - file.left.camera.intrinsics.cx <= 0) throw new Error('Disparity plus horizontal principal-point offset must be positive.')
  const baseline = file.right.camera.positionM[0] - file.left.camera.positionM[0]
  if (baseline < 0.001 || baseline > 10 || Math.abs(file.right.camera.positionM[1] - file.left.camera.positionM[1]) > 1e-9 || Math.abs(file.right.camera.positionM[2] - file.left.camera.positionM[2]) > 1e-9) throw new Error('Cameras must have a positive 0.001–10 m rectified horizontal baseline.')
  const [left, right] = await Promise.all([readLinked(dirname(absolute), file.left, 149 * 1024), readLinked(dirname(absolute), file.right, 149 * 1024)])
  return { file, bytes, input: { left: { camera: file.left.camera, image: decodePpm(left) }, right: { camera: file.right.camera, image: decodePpm(right) } } }
}

export function serializeResult(result: StereoResult) {
  return { ...result, outcomes: Array.from(result.outcomes) }
}

export function decodeDepth(bytes: Uint8Array, camera: StereoTruth['camera']): StereoTruth {
  const count = camera.intrinsics.width * camera.intrinsics.height
  if (bytes.length !== count * 4) throw new Error('Truth depth byte count does not match its camera.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const depthM = Array.from({ length: count }, (_, index) => {
    const depth = view.getFloat32(index * 4, true)
    if (Number.isNaN(depth)) return null
    if (!Number.isFinite(depth) || depth <= 0 || depth > 1000) throw new Error('Invalid truth depth.')
    return depth
  })
  return { camera, depthM }
}

/** Stage all files in a newly reserved directory. Existing results are never replaced. */
export async function installNewDirectory(target: string, files: Record<string, Uint8Array | string>): Promise<void> {
  const absolute = resolve(target)
  await mkdir(dirname(absolute), { recursive: true })
  // Reserve the destination before staging, preventing POSIX rename from replacing an empty directory.
  await mkdir(absolute)
  const staging = join(absolute, '.staging')
  try {
    await mkdir(staging)
    for (const [name, bytes] of Object.entries(files)) {
      if (basename(name) !== name) throw new Error('Output files must be basenames.')
      await writeFile(join(staging, name), bytes, { flag: 'wx' })
    }
    for (const name of Object.keys(files)) await rename(join(staging, name), join(absolute, name))
    await rm(staging, { recursive: true })
  } catch (error) {
    await rm(absolute, { recursive: true, force: true })
    throw error
  }
}

export function parseFileArguments(args: readonly string[], required: readonly string[]): Record<string, string> | { help: true } {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--help') return { help: true }
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]!, value = values[index + 1]
    if (!required.includes(key) || key in result || !value || value.startsWith('--')) throw new Error('Unknown, repeated or missing option. Use --help.')
    result[key] = value
  }
  if (required.some(key => !(key in result))) throw new Error('Missing required option. Use --help.')
  return result
}
