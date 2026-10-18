import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { evaluateStereoGeometry, STEREO_GEOMETRY_GATES, type StereoGeometryTruth } from '../packages/spatial-stereo-geometry.ts'
import type { StereoCamera, StereoResult } from '../packages/spatial-stereo-types.ts'
import { installNewDirectory, jsonBytes, loadStereoInput, parseFileArguments, parseJson, readBounded, readLinked, sha256, stereoCameraSchema, stereoResultSchema } from './lib/stereo-files.ts'

const linkedFloatSchema = z.object({
  fileName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/).refine(name => name !== '.' && name !== '..'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const stereoGeometryTruthSchema = z.object({
  format: z.literal('cha-stereo-geometry-truth-v1'),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  camera: stereoCameraSchema,
  disparity: linkedFloatSchema,
  depth: linkedFloatSchema,
  provenance: z.object({
    dataset: z.string().min(1).max(160),
    sourceUrl: z.string().url().startsWith('https://').max(2048),
    method: z.string().min(1).max(320),
    notes: z.string().max(2048),
  }).strict(),
}).strict()

export type StereoGeometryTruthFile = z.infer<typeof stereoGeometryTruthSchema>

function sameCamera(left: StereoCamera, right: StereoCamera): boolean {
  return left.id === right.id
    && left.positionM.every((value, axis) => value === right.positionM[axis])
    && left.intrinsics.width === right.intrinsics.width
    && left.intrinsics.height === right.intrinsics.height
    && left.intrinsics.fx === right.intrinsics.fx
    && left.intrinsics.fy === right.intrinsics.fy
    && left.intrinsics.cx === right.intrinsics.cx
    && left.intrinsics.cy === right.intrinsics.cy
}

function sameSettings(a: StereoResult['settings'], b: StereoResult['settings']): boolean {
  return a.minDisparity === b.minDisparity
    && a.maxDisparity === b.maxDisparity
    && a.patchRadius === b.patchRadius
    && a.minTextureVariance === b.minTextureVariance
    && a.maxMeanAbsoluteError === b.maxMeanAbsoluteError
    && a.uniquenessRatio === b.uniquenessRatio
    && a.leftRightTolerancePx === b.leftRightTolerancePx
}

function decodeFloat32Map(bytes: Uint8Array, count: number, path: string): (number | null)[] {
  if (bytes.byteLength !== count * Float32Array.BYTES_PER_ELEMENT) throw new Error(`${path} byte count does not match its camera dimensions.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: (number | null)[] = new Array(count)
  for (let index = 0; index < count; index += 1) {
    const value = view.getFloat32(index * 4, true)
    values[index] = Number.isNaN(value) ? null : value
  }
  return values
}

/** Evaluate disparity and axial depth maps linked to the same calibrated training input. */
export async function runSpatialStereoGeometry(args: readonly string[]): Promise<string> {
  const options = parseFileArguments(args, ['--input', '--result', '--truth', '--output'])
  if ('help' in options) return 'Usage: bun scripts/spatial-stereo-geometry.ts --input <input.json> --result <reconstruction.json> --truth <truth.json> --output <new-directory>\nCompare reconstruction disparity/depth directly with linked geometry truth; no fitting, rescaling or held-out view evaluation.\n'

  const loaded = await loadStereoInput(options['--input']!)
  const resultBytes = await readBounded(resolve(options['--result']!), 24 * 1024 * 1024)
  const resultFile = stereoResultSchema.parse(parseJson(resultBytes))
  const truthPath = resolve(options['--truth']!)
  const truthBytes = await readBounded(truthPath, 128 * 1024)
  const truthFile = stereoGeometryTruthSchema.parse(parseJson(truthBytes))
  const inputSha256 = sha256(loaded.bytes)

  if (resultFile.inputSha256 !== inputSha256 || truthFile.inputSha256 !== inputSha256) throw new Error('Reconstruction/geometry-truth input SHA256 mismatch.')
  if (resultFile.sourceHashes.left !== loaded.file.left.sha256 || resultFile.sourceHashes.right !== loaded.file.right.sha256) throw new Error('Reconstruction image SHA256 mismatch.')
  const rawResult = resultFile.reconstruction
  if (!sameSettings(rawResult.settings, loaded.file.settings)) throw new Error('Reconstruction settings differ from the frozen input.')
  const baseline = loaded.input.right.camera.positionM[0] - loaded.input.left.camera.positionM[0]
  if (rawResult.width !== loaded.input.left.image.width || rawResult.height !== loaded.input.left.image.height || rawResult.baselineM !== baseline) throw new Error('Reconstruction calibration differs from the input.')
  if (!sameCamera(truthFile.camera, loaded.file.left.camera)) throw new Error('Geometry truth camera must exactly match the calibrated left training camera.')
  if (truthFile.disparity.fileName === truthFile.depth.fileName) throw new Error('Disparity and depth truth must use separate files.')

  const pixelCount = truthFile.camera.intrinsics.width * truthFile.camera.intrinsics.height
  const truthDirectory = dirname(truthPath)
  const [disparityBytes, depthBytes] = await Promise.all([
    readLinked(truthDirectory, truthFile.disparity, pixelCount * 4),
    readLinked(truthDirectory, truthFile.depth, pixelCount * 4),
  ])
  const geometryTruth: StereoGeometryTruth = {
    camera: truthFile.camera,
    disparityPx: decodeFloat32Map(disparityBytes, pixelCount, 'truth.disparity'),
    depthM: decodeFloat32Map(depthBytes, pixelCount, 'truth.depth'),
  }
  const result: StereoResult = { ...rawResult, outcomes: Uint8Array.from(rawResult.outcomes) }
  const evaluation = evaluateStereoGeometry(result, geometryTruth)
  const report = {
    format: 'cha-stereo-geometry-report-v1',
    algorithm: resultFile.algorithm,
    inputSha256,
    resultSha256: sha256(resultBytes),
    truthSha256: sha256(truthBytes),
    sourceHashes: {
      leftImage: loaded.file.left.sha256,
      rightImage: loaded.file.right.sha256,
      disparity: truthFile.disparity.sha256,
      depth: truthFile.depth.sha256,
    },
    inputId: loaded.file.id,
    provenance: { training: loaded.file.provenance, geometryTruth: truthFile.provenance },
    calibration: { left: loaded.file.left.camera, right: loaded.file.right.camera, principalPointOffsetPx: loaded.file.right.camera.intrinsics.cx - loaded.file.left.camera.intrinsics.cx },
    settings: rawResult.settings,
    thresholds: STEREO_GEOMETRY_GATES,
    limitations: [
      'Geometry is compared directly without pose, scale or disparity fitting; truth calibration must exactly match the left training camera.',
      'This report evaluates one stereo reconstruction against supplied disparity/depth truth. It makes no held-out camera-view, image-quality, physical-scene or general reconstruction claim.',
    ],
    evaluation,
  }
  const reportBytes = jsonBytes(report)
  await installNewDirectory(options['--output']!, { 'report.json': reportBytes })
  return JSON.stringify({ format: report.format, passed: evaluation.passed, inputSha256, resultSha256: report.resultSha256, truthSha256: report.truthSha256, reportSha256: sha256(reportBytes), evaluation }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoGeometry(process.argv.slice(2)).then(output => {
    process.stdout.write(output)
    if (!output.startsWith('Usage:') && !JSON.parse(output).passed) process.exitCode = 2
  }, error => {
    process.stderr.write(`spatial:stereo:geometry: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
