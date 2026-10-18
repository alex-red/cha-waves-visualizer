import { createStereoReferenceCase, type StereoDevelopmentCase, type StereoReferenceScene } from './stereo-development.ts'

const HOLDOUT_SCENES: readonly StereoReferenceScene[] = [
  {
    id: 'holdout-c-textured-tilt', split: 'evaluation', seed: 631,
    backdrop: { z: 3.54, slopeX: -0.21, slopeY: 0.06 },
    foreground: { z: 2.16, polygon: [[-0.36, -0.37], [0.17, -0.49], [0.41, 0.08], [0.02, 0.39], [-0.43, 0.13]] },
    texture: 'lattice', stripe: null, rightGain: 1, rightOffset: 0,
  },
  {
    id: 'holdout-c-weak-stripe-repeat', split: 'evaluation', seed: 743,
    backdrop: { z: 3.69, slopeX: 0.14, slopeY: -0.18 },
    foreground: { z: 2.32, polygon: [[-0.43, -0.31], [0.28, -0.41], [0.39, 0.14], [-0.14, 0.44]] },
    texture: 'weak-stripe-repeat', stripe: { minX: -0.24, maxX: 0.31 }, rightGain: 1, rightOffset: 0,
  },
  {
    id: 'holdout-c-negative-exposure', split: 'evaluation', seed: 857,
    backdrop: { z: 3.48, slopeX: 0.07, slopeY: 0.22 },
    foreground: { z: 2.27, polygon: [[-0.39, -0.45], [0.34, -0.32], [0.29, 0.35], [-0.28, 0.3]] },
    texture: 'lattice', stripe: null, rightGain: 0.94, rightOffset: -3,
  },
  {
    id: 'holdout-c-repeat-narrow-occluder', split: 'evaluation', seed: 967,
    backdrop: { z: 3.61, slopeX: -0.08, slopeY: -0.2 },
    foreground: { z: 2.12, polygon: [[-0.095, -0.51], [0.075, -0.51], [0.11, 0.35], [-0.07, 0.35]] },
    texture: 'repeat-lattice', stripe: null, rightGain: 1, rightOffset: 0,
  },
]

/** Fresh evaluation-only synthetic references, held apart from the development-case factory. */
export function createStereoHoldoutCases(): StereoDevelopmentCase[] {
  return HOLDOUT_SCENES.map(createStereoReferenceCase)
}
