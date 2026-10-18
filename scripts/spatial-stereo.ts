import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstructStereo } from '../packages/spatial-stereo.ts'
import { encodeStereoPly, encodeStereoSplats } from '../packages/spatial-stereo-export.ts'
import type { VisualManifest } from '../packages/spatial-visual-types.ts'
import { inspectSplatAsset, parseVisualManifest } from '../packages/spatial-visual.ts'
import { installNewDirectory, jsonBytes, loadStereoInput, parseFileArguments, serializeResult, sha256, stereoResultSchema } from './lib/stereo-files.ts'

export async function runSpatialStereo(args: readonly string[]): Promise<string> {
  const options = parseFileArguments(args, ['--input', '--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo -- --input <input.json> --output <new-directory>\nRead only the calibrated training pair. No truth or held-out images are opened.\n'
  const { file, bytes, input } = await loadStereoInput(options['--input']!)
  const started = performance.now()
  const result = reconstructStereo(input, file.settings)
  const reconstructionMs = performance.now() - started
  const resultFile = stereoResultSchema.parse({ format: 'cha-stereo-result-v1', inputSha256: sha256(bytes), algorithm: 'rectified-rgb-sad-v1', sourceHashes: { left: file.left.sha256, right: file.right.sha256 }, reconstruction: serializeResult(result) })
  const resultBytes = jsonBytes(resultFile)
  const outputs: Record<string, Uint8Array | string> = { 'reconstruction.json': resultBytes, 'reconstruction.ply': encodeStereoPly(result) }
  if (result.points.length > 0) {
    const splats = encodeStereoSplats(result, input.left.camera)
    inspectSplatAsset(splats, result.points.length)
    const manifest: VisualManifest = {
      format: 'cha-visual-bundle-v1', id: `${file.id}-stereo`, label: `${file.id} · stereo reconstruction`,
      asset: { fileName: 'reconstruction.splat', format: 'splat32', sha256: sha256(splats), splatCount: result.points.length },
      assetFrame: { handedness: 'right', up: '+y', cameraConvention: 'opengl' },
      worldFrame: { units: 'm', axes: 'right-handed-z-up' },
      registration: { status: 'known', scaleMPerUnit: 1, rotationXyzw: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], translationM: [0, 0, 0], method: file.provenance.kind === 'synthetic' ? 'synthetic' : 'supplied' },
      provenance: { kind: 'image-reconstruction', creator: file.provenance.creator, sourceUrl: null, license: { name: file.provenance.license, url: null }, method: 'rectifiedRGBBlockMatchingThenHeuristicSurfaceSplats', version: '1', notes: `${file.provenance.notes} Input SHA256 ${sha256(bytes)}; result SHA256 ${sha256(resultBytes)}. No Gaussian optimization, pose estimation, hole filling or AI completion. ${JSON.stringify(file.settings)}` },
      cameras: [file.left, file.right].map(item => ({ id: item.camera.id, role: 'training', position: item.camera.positionM, orientationXyzw: [0, 0, 0, 1], intrinsics: item.camera.intrinsics, imageSha256: item.sha256 })),
    }
    parseVisualManifest(JSON.stringify(manifest))
    outputs['manifest.json'] = jsonBytes(manifest)
    outputs['reconstruction.splat'] = splats
  }
  // Runtime is deliberately separate from deterministic reconstruction bytes.
  outputs['runtime.json'] = jsonBytes({ reconstructionMs, pointCount: result.points.length, inputBytes: bytes.length + input.left.image.rgb.length + input.right.image.rgb.length, decodedAttributeBytesMinimum: result.points.length * 40, note: 'One local CPU run; excludes peak memory, filesystem I/O and browser/GPU costs.' })
  await installNewDirectory(options['--output']!, outputs)
  return JSON.stringify({ format: 'cha-stereo-summary-v1', status: result.status, inputSha256: sha256(bytes), resultSha256: sha256(resultBytes), pointCount: result.points.length, counts: result.counts, reconstructionMs }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialStereo(process.argv.slice(2)).then(output => process.stdout.write(output), error => {
    process.stderr.write(`spatial:stereo: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
