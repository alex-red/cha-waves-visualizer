import type { StereoDevelopmentCase } from '../../packages/test-fixtures/stereo-development.ts'
import { STEREO_SETTINGS } from '../../packages/spatial-stereo-types.ts'
import { encodePpm } from '../../packages/spatial-ppm.ts'
import { jsonBytes, sha256, stereoInputSchema } from './stereo-files.ts'

/** The same exact manifest bytes identify comparison, ablation and future holdout inputs. */
export function prepareStereoReferenceCase(fixture: StereoDevelopmentCase) {
  const left = encodePpm(fixture.input.left.image), right = encodePpm(fixture.input.right.image)
  const manifest = stereoInputSchema.parse({
    format: 'cha-stereo-input-v1', id: fixture.id,
    provenance: { kind: 'synthetic', creator: 'Cha Waves', license: 'MIT', notes: 'Independent ray-rendered stereo development/evaluation case v1. Diagnostic masks and surface truth are evaluator-only; no Gaussian training, AI completion or physical validation.' },
    frame: { units: 'm', axes: 'right-handed-y-up', cameraConvention: 'opengl', orientations: 'identity-rectified' },
    left: { fileName: `${fixture.id}-left.ppm`, sha256: sha256(left), camera: fixture.input.left.camera },
    right: { fileName: `${fixture.id}-right.ppm`, sha256: sha256(right), camera: fixture.input.right.camera }, settings: STEREO_SETTINGS,
  })
  return { left, right, manifest, manifestBytes: jsonBytes(manifest) }
}

export function pinStereoReferenceCase(fixture: StereoDevelopmentCase) {
  const item = prepareStereoReferenceCase(fixture)
  return { id: fixture.id, split: fixture.split, inputSha256: sha256(item.manifestBytes), leftSha256: sha256(item.left), rightSha256: sha256(item.right), truthSha256: sha256(jsonBytes(fixture.truth)), regionsSha256: sha256(jsonBytes(fixture.regions)) }
}
