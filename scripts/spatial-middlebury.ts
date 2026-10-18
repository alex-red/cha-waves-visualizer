import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createMiddleburyCameras, parseMiddleburyCalibration, parseMiddleburyPfm, resizeMiddleburyRgb, resizeMiddleburyTruth } from '../packages/spatial-middlebury.ts'
import { encodePpm } from '../packages/spatial-ppm.ts'
import { STEREO_SETTINGS } from '../packages/spatial-stereo-types.ts'
import { installNewDirectory, jsonBytes, loadStereoInput, parseFileArguments, readBounded, sha256, stereoInputSchema } from './lib/stereo-files.ts'
import { stereoGeometryTruthSchema } from './spatial-stereo-geometry.ts'

export type SourcePin = {
  format: string; dataset: string; sourceUrl: string
  license: { name: string; url: string; attribution: string }
  preparation: { width: number; height: number; minDisparity: number; maxDisparity: number; version: string }
  sources: Record<'calib.txt' | 'im0.png' | 'im1.png' | 'disp0.pfm', { url: string; sha256: string; bytes: number }>
}
const pinnedFileSchema = z.object({ url: z.string().url().max(2048), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(64_000_256) }).strict()
const sourcePinSchema = z.object({
  format: z.literal('cha-middlebury-source-pin-v1'), dataset: z.string().min(1).max(160), sourceUrl: z.string().url().startsWith('https://').max(2048),
  license: z.object({ name: z.string().min(1).max(256), url: z.string().url().startsWith('https://').max(2048), attribution: z.string().min(1).max(1024) }).strict(),
  preparation: z.object({ width: z.number().int().min(1).max(256), height: z.number().int().min(1).max(192), minDisparity: z.number().int().min(1).max(254), maxDisparity: z.number().int().min(2).max(255), version: z.literal('area-rgb-nearest-truth-v1') }).strict(),
  sources: z.object({ 'calib.txt': pinnedFileSchema, 'im0.png': pinnedFileSchema, 'im1.png': pinnedFileSchema, 'disp0.pfm': pinnedFileSchema }).strict(),
}).strict().superRefine((pin, context) => {
  if (pin.sources['calib.txt'].bytes > 64 * 1024 || pin.sources['im0.png'].bytes > 32 * 1024 * 1024 || pin.sources['im1.png'].bytes > 32 * 1024 * 1024) context.addIssue({ code: 'custom', message: 'Pinned source byte count exceeds its format limit.' })
  if (pin.preparation.minDisparity >= pin.preparation.maxDisparity || pin.preparation.maxDisparity >= pin.preparation.width) context.addIssue({ code: 'custom', message: 'Invalid pinned disparity range.' })
  for (const record of Object.values(pin.sources)) {
    const url = new URL(record.url)
    if (url.protocol !== 'https:' || url.hostname !== 'vision.middlebury.edu' || url.username || url.password || url.port) context.addIssue({ code: 'custom', message: 'Source URL must be an official HTTPS Middlebury URL.' })
  }
})
type RgbImage = { width: number; height: number; rgb: Uint8Array<ArrayBuffer> }
type Dependencies = { pin?: SourcePin; decodePng?: (bytes: Uint8Array) => RgbImage; fetchImpl?: typeof fetch }

const PIN_PATHS = { adirondack: fileURLToPath(new URL('../docs/data/middlebury-adirondack.json', import.meta.url)), motorcycle: fileURLToPath(new URL('../docs/data/middlebury-motorcycle.json', import.meta.url)) }
const HELP = 'Usage: bun run spatial:middlebury -- <fetch|prepare|truth> [options]\n  fetch --output <new-directory>\n  prepare --source <original-directory> --output <new-directory>\n  truth --source <original-directory> --input <prepared-input.json> --output <new-directory>\nOptional: --dataset adirondack|motorcycle (default: adirondack). Images/derived real captures remain local.\n'

/** Optional Pillow decoder. It opens no files, URLs or truth; input/output are bounded bytes. */
export function decodePngRgb(bytes: Uint8Array): RgbImage {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 32 * 1024 * 1024) throw new Error('PNG source exceeds its supported byte limit.')
  const helper = fileURLToPath(new URL('./lib/decode-png-rgb.py', import.meta.url))
  const child = spawnSync('python3', [helper], { input: bytes, maxBuffer: 16_000_000 * 3 + 8, timeout: 30_000 })
  if (child.error || child.status !== 0) throw new Error('PNG decoding requires Python 3 and Pillow, and a bounded RGB PNG source.')
  const output = child.stdout
  if (output.length < 8) throw new Error('PNG decoder returned incomplete data.')
  const width = output.readUInt32LE(0), height = output.readUInt32LE(4)
  if (!Number.isInteger(width) || width < 1 || width > 4096 || !Number.isInteger(height) || height < 1 || height > 4096 || width * height > 16_000_000 || output.length !== width * height * 3 + 8) throw new Error('PNG decoder returned invalid dimensions or raster bytes.')
  return { width, height, rgb: new Uint8Array(output.subarray(8)) }
}

async function readOriginal(source: string, name: keyof SourcePin['sources'], pin: SourcePin): Promise<Uint8Array<ArrayBuffer>> {
  const record = pin.sources[name]
  const bytes = await readBounded(resolve(source, name), record.bytes)
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw new Error(`Pinned source SHA256/size mismatch for ${name}.`)
  return bytes
}

function encodeFloats(values: readonly (number | null)[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value ?? NaN, true))
  return bytes
}

async function fetchOriginals(pin: SourcePin, fetchImpl: typeof fetch): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  // Serial bounded downloads keep memory finite and preserve each exact original.
  for (const [name, record] of Object.entries(pin.sources)) {
    const url = new URL(record.url)
    if (url.protocol !== 'https:' || url.hostname !== 'vision.middlebury.edu') throw new Error('Source URL must be an official HTTPS Middlebury URL.')
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
    if (!response.ok || !response.body) throw new Error('Pinned source download failed.')
    const reader = response.body.getReader()
    const bytes = new Uint8Array(record.bytes)
    let offset = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (offset + chunk.value.length > bytes.length) throw new Error('Pinned source download exceeds its byte limit.')
        bytes.set(chunk.value, offset)
        offset += chunk.value.length
      }
    } finally { await reader.cancel() }
    if (offset !== record.bytes || sha256(bytes) !== record.sha256) throw new Error('Pinned source download SHA256/size mismatch.')
    files[name] = bytes
  }
  return files
}

export async function runSpatialMiddlebury(args: readonly string[], dependencies: Dependencies = {}): Promise<string> {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--help') return HELP
  const mode = values[0]
  if (mode !== 'fetch' && mode !== 'prepare' && mode !== 'truth') throw new Error('Choose fetch, prepare or truth. Use --help.')
  const selected = values.indexOf('--dataset')
  let dataset: keyof typeof PIN_PATHS = 'adirondack'
  let flags = values.slice(1)
  if (selected !== -1) {
    const value = values[selected + 1]
    if ((value !== 'adirondack' && value !== 'motorcycle') || values.lastIndexOf('--dataset') !== selected) throw new Error('Choose one supported dataset: adirondack or motorcycle.')
    dataset = value
    flags = [...values.slice(1, selected), ...values.slice(selected + 2)]
  }
  const keys = mode === 'fetch' ? ['--output'] : mode === 'prepare' ? ['--source', '--output'] : ['--source', '--input', '--output']
  const options = parseFileArguments(flags, keys)
  if ('help' in options) return HELP
  const pinBytes = dependencies.pin ? jsonBytes(dependencies.pin) : await readBounded(PIN_PATHS[dataset], 16 * 1024)
  const pin = sourcePinSchema.parse(dependencies.pin ?? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pinBytes)))
  if (mode === 'fetch') {
    await installNewDirectory(options['--output']!, await fetchOriginals(pin, dependencies.fetchImpl ?? fetch))
    return JSON.stringify({ mode, dataset: pin.dataset, sourcePinSha256: sha256(pinBytes), files: pin.sources }, null, 2) + '\n'
  }
  const source = options['--source']!
  const calibrationBytes = await readOriginal(source, 'calib.txt', pin)
  const calibration = parseMiddleburyCalibration(new TextDecoder('utf-8', { fatal: true }).decode(calibrationBytes))
  const { width, height, minDisparity, maxDisparity } = pin.preparation
  if (maxDisparity !== Math.ceil(calibration.ndisp * width / calibration.width)) throw new Error('Pinned search range must derive only from ndisp and resize scale.')
  const cameras = createMiddleburyCameras(calibration, width, height)
  if (mode === 'prepare') {
    const images: Record<string, Uint8Array> = {}
    for (const [sourceName, targetName] of [['im0.png', 'left.ppm'], ['im1.png', 'right.ppm']] as const) {
      const original = await readOriginal(source, sourceName, pin)
      const decoded = (dependencies.decodePng ?? decodePngRgb)(original)
      if (decoded.width !== calibration.width || decoded.height !== calibration.height) throw new Error('PNG dimensions differ from calibration.')
      images[targetName] = encodePpm(resizeMiddleburyRgb(decoded, width, height))
    }
    const input = stereoInputSchema.parse({
      format: 'cha-stereo-input-v1', id: `middlebury-${dataset}-perfect`,
      provenance: { kind: 'recorded', creator: 'Middlebury stereo team; Cha Waves preparation', license: pin.license.name,
        notes: `${pin.dataset}; ${pin.sourceUrl}; ${pin.license.url}. Source pin SHA256 ${sha256(pinBytes)}. ${pin.license.attribution} Supplied metric stereo calibration; no estimated world registration. ${pin.preparation.version}; no truth or held-out views used by reconstruction.` },
      frame: { units: 'm', axes: 'right-handed-y-up', cameraConvention: 'opengl', orientations: 'identity-rectified' },
      left: { fileName: 'left.ppm', sha256: sha256(images['left.ppm']!), camera: cameras.left },
      right: { fileName: 'right.ppm', sha256: sha256(images['right.ppm']!), camera: cameras.right },
      settings: { ...STEREO_SETTINGS, minDisparity, maxDisparity },
    })
    const inputBytes = jsonBytes(input)
    await installNewDirectory(options['--output']!, { ...images, 'input.json': inputBytes, 'preparation.json': jsonBytes({ sourcePinSha256: sha256(pinBytes), sourceFiles: { calibration: pin.sources['calib.txt'], left: pin.sources['im0.png'], right: pin.sources['im1.png'] }, calibration, preparation: pin.preparation, inputSha256: sha256(inputBytes) }) })
    return JSON.stringify({ mode, inputSha256: sha256(inputBytes), cameraFrame: input.frame, sourcePinSha256: sha256(pinBytes), settings: input.settings }, null, 2) + '\n'
  }
  const input = await loadStereoInput(options['--input']!)
  if (JSON.stringify(input.file.left.camera) !== JSON.stringify(cameras.left) || JSON.stringify(input.file.right.camera) !== JSON.stringify(cameras.right) || JSON.stringify(input.file.settings) !== JSON.stringify({ ...STEREO_SETTINGS, minDisparity, maxDisparity })) throw new Error('Prepared camera/settings do not match the pinned calibration.')
  const originalTruth = await readOriginal(source, 'disp0.pfm', pin)
  const truth = resizeMiddleburyTruth(parseMiddleburyPfm(originalTruth), calibration, width, height)
  const disparity = encodeFloats(truth.disparityPx), depth = encodeFloats(truth.depthM)
  const manifest = stereoGeometryTruthSchema.parse({
    format: 'cha-stereo-geometry-truth-v1', inputSha256: sha256(input.bytes), camera: cameras.left,
    disparity: { fileName: 'disparity.f32', sha256: sha256(disparity) }, depth: { fileName: 'depth.f32', sha256: sha256(depth) },
    provenance: { dataset: pin.dataset, sourceUrl: pin.sourceUrl, method: 'Independent structured-light raw pixel disparity; PFM header magnitude ignored; nearest original truth sample per output pixel.', notes: `Original PFM SHA256 ${pin.sources['disp0.pfm'].sha256}; calibration SHA256 ${pin.sources['calib.txt'].sha256}; source pin SHA256 ${sha256(pinBytes)}; missing truth retained; no held-out camera views or estimated registration.` },
  })
  const manifestBytes = jsonBytes(manifest)
  await installNewDirectory(options['--output']!, { 'truth.json': manifestBytes, 'disparity.f32': disparity, 'depth.f32': depth })
  return JSON.stringify({ mode, inputSha256: sha256(input.bytes), truthSha256: sha256(manifestBytes), sourcePinSha256: sha256(pinBytes), missingTruthPixels: truth.depthM.filter(value => value === null).length }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialMiddlebury(process.argv.slice(2)).then(output => process.stdout.write(output), error => {
    const filesystemCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null
    process.stderr.write(`spatial:middlebury: ${filesystemCode ? `Local file operation failed (${filesystemCode}).` : error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
