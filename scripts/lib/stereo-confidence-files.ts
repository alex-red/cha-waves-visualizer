import type { StereoConfidenceCase } from '../../packages/test-fixtures/stereo-confidence.ts'
import { jsonBytes, sha256, stereoInputSchema } from './stereo-files.ts'
import { prepareStereoReferenceCase } from './stereo-reference-files.ts'

export function prepareStereoConfidenceCase(control: StereoConfidenceCase) {
  const prepared = prepareStereoReferenceCase(control.fixture)
  if (control.fixture.id.startsWith('confidence-')) {
    const manifest = stereoInputSchema.parse({ ...prepared.manifest, provenance: { ...prepared.manifest.provenance, notes: `${control.notes} Self-authored synthetic confidence control with supplied calibration; no physical validation. Truth and unsupported masks are evaluator-only.` } })
    return { ...prepared, manifest, manifestBytes: jsonBytes(manifest) }
  }
  // Preserve exact original development manifest bytes for the retained references.
  return prepared
}

export function pinStereoConfidenceCase(control: StereoConfidenceCase) {
  const prepared = prepareStereoConfidenceCase(control)
  return { id: control.fixture.id, split: control.fixture.split, inputSha256: sha256(prepared.manifestBytes), leftSha256: sha256(prepared.left), rightSha256: sha256(prepared.right), truthSha256: sha256(jsonBytes(control.fixture.truth)), regionsSha256: sha256(jsonBytes(control.fixture.regions)), role: control.role, unsupportedPixels: control.unsupportedPixels.length, unsupportedSha256: sha256(jsonBytes(control.unsupportedPixels)), notes: control.notes }
}
