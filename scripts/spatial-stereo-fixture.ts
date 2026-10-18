import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStereoScene } from '../packages/test-fixtures/stereo-scene.ts'
import { encodePpm } from '../packages/spatial-ppm.ts'
import { STEREO_SETTINGS, type StereoTruth } from '../packages/spatial-stereo-types.ts'
import { installNewDirectory, jsonBytes, parseFileArguments, sha256, stereoInputSchema, stereoEvaluationSchema } from './lib/stereo-files.ts'

export function encodeDepth(truth: StereoTruth): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(truth.depthM.length * 4)
  const view = new DataView(bytes.buffer)
  truth.depthM.forEach((depth, index) => view.setFloat32(index * 4, depth ?? Number.NaN, true))
  return bytes
}

export function createStereoFixtureFiles(): { training: Record<string, Uint8Array>; evaluation: Record<string, Uint8Array> } {
  const scene = createStereoScene()
  const left = encodePpm(scene.training.left.image), right = encodePpm(scene.training.right.image)
  const input = stereoInputSchema.parse({
    format: 'cha-stereo-input-v1', id: scene.id,
    provenance: { kind: 'synthetic', creator: 'Cha Waves', license: 'MIT', notes: 'Self-authored ray-rendered tilted textured backdrop, finite foreground occluder and textureless stripe. Cameras and metric scale are supplied synthetic calibration; this is not a physical capture.' },
    frame: { units: 'm', axes: 'right-handed-y-up', cameraConvention: 'opengl', orientations: 'identity-rectified' },
    left: { fileName: 'left.ppm', sha256: sha256(left), camera: scene.training.left.camera },
    right: { fileName: 'right.ppm', sha256: sha256(right), camera: scene.training.right.camera },
    settings: STEREO_SETTINGS,
  })
  const inputBytes = jsonBytes(input)
  const depth = encodeDepth(scene.referenceTruth)
  const evaluationFiles: Record<string, Uint8Array> = { 'reference-depth.f32': depth }
  const heldOut = scene.heldOut.map(({ view, truth }) => {
    const image = encodePpm(view.image), truthBytes = encodeDepth(truth)
    const imageName = `${view.camera.id}.ppm`, depthName = `${view.camera.id}.f32`
    evaluationFiles[imageName] = image
    evaluationFiles[depthName] = truthBytes
    return { image: { fileName: imageName, sha256: sha256(image), camera: view.camera }, depth: { fileName: depthName, sha256: sha256(truthBytes) } }
  })
  evaluationFiles['evaluation.json'] = jsonBytes(stereoEvaluationSchema.parse({
    format: 'cha-stereo-evaluation-input-v1', inputSha256: sha256(inputBytes),
    referenceDepth: { fileName: 'reference-depth.f32', sha256: sha256(depth) }, heldOut,
  }))
  return { training: { 'input.json': inputBytes, 'left.ppm': left, 'right.ppm': right }, evaluation: evaluationFiles }
}

export async function runStereoFixture(args: readonly string[]): Promise<string> {
  const options = parseFileArguments(args, ['--output'])
  if ('help' in options) return 'Usage: bun run spatial:stereo:fixture -- --output <new-directory>\nGenerate separate training/ and evaluation/ synthetic fixtures.\n'
  const files = createStereoFixtureFiles()
  const output = resolve(options['--output']!)
  await installNewDirectory(`${output}/training`, files.training)
  await installNewDirectory(`${output}/evaluation`, files.evaluation)
  return JSON.stringify({ format: 'cha-stereo-fixture-summary-v1', inputSha256: sha256(files.training['input.json']!), evaluationSha256: sha256(files.evaluation['evaluation.json']!) }, null, 2) + '\n'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStereoFixture(process.argv.slice(2)).then(output => process.stdout.write(output), error => {
    process.stderr.write(`spatial:stereo:fixture: ${error instanceof Error ? error.message : 'Failed.'}\n`)
    process.exitCode = 1
  })
}
