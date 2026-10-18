import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePpm, encodePpm } from '../packages/spatial-ppm.ts'
import { evaluateStereo, renderStereoPreview } from '../packages/spatial-stereo-evaluation.ts'
import { STEREO_GATES, type StereoResult, type StereoEvaluationInput } from '../packages/spatial-stereo-types.ts'
import { decodeDepth, installNewDirectory, jsonBytes, loadStereoInput, parseFileArguments, parseJson, readBounded, readLinked, sha256, stereoEvaluationSchema, stereoResultSchema } from './lib/stereo-files.ts'

export async function runSpatialStereoEvaluate(args: readonly string[]): Promise<string> {
  const options = parseFileArguments(args, ['--input', '--result', '--evaluation', '--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo:evaluate -- --input <input.json> --result <reconstruction.json> --evaluation <evaluation.json> --output <new-directory>\nEvaluate frozen held-out images and truth separately; failed gates exit with status 2.\n'
  const loaded = await loadStereoInput(options['--input']!)
  const resultBytes = await readBounded(resolve(options['--result']!), 24 * 1024 * 1024)
  const resultFile = stereoResultSchema.parse(parseJson(resultBytes))
  const evaluationPath = resolve(options['--evaluation']!)
  const evaluationBytes = await readBounded(evaluationPath, 128 * 1024)
  const evaluationFile = stereoEvaluationSchema.parse(parseJson(evaluationBytes))
  const inputSha256 = sha256(loaded.bytes)
  if (resultFile.inputSha256 !== inputSha256 || evaluationFile.inputSha256 !== inputSha256) throw new Error('Reconstruction/evaluation input SHA256 mismatch.')
  if (resultFile.sourceHashes.left !== loaded.file.left.sha256 || resultFile.sourceHashes.right !== loaded.file.right.sha256) throw new Error('Reconstruction image SHA256 mismatch.')
  const rawResult = resultFile.reconstruction
  if (JSON.stringify(rawResult.settings) !== JSON.stringify(loaded.file.settings)) throw new Error('Reconstruction settings differ from the frozen input.')
  if (rawResult.width !== loaded.input.left.image.width || rawResult.height !== loaded.input.left.image.height || rawResult.baselineM !== loaded.input.right.camera.positionM[0] - loaded.input.left.camera.positionM[0]) throw new Error('Reconstruction calibration differs from the input.')
  const result: StereoResult = { ...rawResult, outcomes: Uint8Array.from(rawResult.outcomes) }
  const directory = dirname(evaluationPath)
  const reference = decodeDepth(await readLinked(directory, evaluationFile.referenceDepth, 256 * 192 * 4), loaded.input.left.camera)
  const heldOut: StereoEvaluationInput['heldOut'] = []
  const trainingIds = new Set([loaded.file.left.camera.id, loaded.file.right.camera.id])
  const trainingHashes = new Set([loaded.file.left.sha256, loaded.file.right.sha256])
  for (const item of evaluationFile.heldOut) {
    if (trainingIds.has(item.image.camera.id) || trainingHashes.has(item.image.sha256)) throw new Error('Held-out view reuses a training ID or image.')
    if ([loaded.file.left.camera, loaded.file.right.camera].some(camera => JSON.stringify(camera.positionM) === JSON.stringify(item.image.camera.positionM) && JSON.stringify(camera.intrinsics) === JSON.stringify(item.image.camera.intrinsics))) throw new Error('Held-out view reuses a training camera pose.')
    const image = decodePpm(await readLinked(directory, item.image, 149 * 1024))
    const truth = decodeDepth(await readLinked(directory, item.depth, 256 * 192 * 4), item.image.camera)
    heldOut.push({ view: { camera: item.image.camera, image }, truth })
  }
  const evaluation = evaluateStereo(result, { reference, heldOut })
  const report = {
    format: 'cha-stereo-evaluation-report-v1', algorithm: resultFile.algorithm,
    ...(resultFile.algorithmSettings ? { algorithmSettings: resultFile.algorithmSettings } : {}),
    inputSha256, resultSha256: sha256(resultBytes), evaluationInputSha256: sha256(evaluationBytes),
    sources: { training: { left: loaded.file.left, right: loaded.file.right }, referenceDepth: evaluationFile.referenceDepth, heldOut: evaluationFile.heldOut },
    provenance: loaded.file.provenance,
    settings: rawResult.settings, thresholds: STEREO_GATES, evaluation,
    limitations: ['Image provenance and metric rectified calibration are supplied. The documented benchmark uses self-authored synthetic images; physical accuracy and estimated registration are unvalidated.', 'Depth errors use withheld axial depths without alignment or scale fitting.', 'Held-out images use a fixed 3x3 depth-buffered surfel preview, not the browser Gaussian renderer. Missing pixels are black; exact PSNR is capped at 120 dB.', 'No Gaussian optimization, learned model, AI completion, acoustic evidence or full SPATIAL-05 pass.'],
  }
  const outputs: Record<string, Uint8Array> = { 'report.json': jsonBytes(report) }
  for (const item of heldOut) {
    const preview = renderStereoPreview(result.points, item.view.camera)
    outputs[`${item.view.camera.id}-prediction.ppm`] = encodePpm(preview.image)
    outputs[`${item.view.camera.id}-observed.ppm`] = encodePpm(item.view.image)
    const mask = new Uint8Array(preview.covered.length * 3)
    preview.covered.forEach((value, index) => mask.fill(value * 255, index * 3, index * 3 + 3))
    outputs[`${item.view.camera.id}-coverage.ppm`] = encodePpm({ width: preview.image.width, height: preview.image.height, rgb: mask })
  }
  await installNewDirectory(options['--output']!, outputs)
  return JSON.stringify({ format: report.format, inputSha256, resultSha256: report.resultSha256, evaluationInputSha256: report.evaluationInputSha256, passed: evaluation.passed, evaluation }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereoEvaluate(process.argv.slice(2)).then(output => {
    process.stdout.write(output)
    if (!output.startsWith('Usage:') && !JSON.parse(output).passed) process.exitCode = 2
  }, error => {
    process.stderr.write(`spatial:stereo:evaluate: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
