import type { Vector3 } from './spatial-registration.ts'

/** Bounded rectified pinhole reference. All camera positions and points are metres. */
export type StereoCamera = {
  id: string
  positionM: Vector3
  intrinsics: { width: number; height: number; fx: number; fy: number; cx: number; cy: number }
}

export type StereoImage = { width: number; height: number; rgb: Uint8Array<ArrayBuffer> }
export type StereoView = { camera: StereoCamera; image: StereoImage }
export type StereoInput = { left: StereoView; right: StereoView }

export type StereoSettings = {
  minDisparity: number
  maxDisparity: number
  patchRadius: number
  minTextureVariance: number
  maxMeanAbsoluteError: number
  uniquenessRatio: number
  leftRightTolerancePx: number
}

export const STEREO_SETTINGS: Readonly<StereoSettings> = Object.freeze({
  minDisparity: 4,
  maxDisparity: 28,
  patchRadius: 2,
  minTextureVariance: 24,
  maxMeanAbsoluteError: 18,
  uniquenessRatio: 0.8,
  leftRightTolerancePx: 1,
})

export type StereoOutcome = 'border' | 'textureless' | 'photometric' | 'ambiguous' | 'inconsistent' | 'accepted'
export const STEREO_OUTCOMES: readonly StereoOutcome[] = ['border', 'textureless', 'photometric', 'ambiguous', 'inconsistent', 'accepted']
export type StereoPoint = {
  pixelIndex: number
  positionM: Vector3
  color: [number, number, number]
  disparityPx: number
  meanAbsoluteError: number
}
export type StereoResult = {
  status: 'reconstructed' | 'empty'
  width: number
  height: number
  baselineM: number
  settings: StereoSettings
  /** One outcome code per left-image pixel, including every rejection. */
  outcomes: Uint8Array<ArrayBuffer>
  counts: Record<StereoOutcome, number>
  points: StereoPoint[]
}

export type StereoTruth = {
  /** Evaluator-only axial depths. Null means no reference surface at that pixel. */
  depthM: (number | null)[]
  camera: StereoCamera
}

export type StereoEvaluationInput = {
  reference: StereoTruth
  heldOut: { view: StereoView; truth: StereoTruth }[]
}

/** Frozen synthetic screening choices, not physical-accuracy requirements. */
export const STEREO_GATES = Object.freeze({
  minimumAcceptedFraction: 0.35,
  maximumDepthP90M: 0.12,
  minimumHeldOutCoverage: 0.3,
  maximumCoveredMae: 30,
  maximumAllPixelMae: 65,
})
