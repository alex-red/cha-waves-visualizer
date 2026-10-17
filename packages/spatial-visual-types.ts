import type { Quaternion, Vector3 } from './spatial-registration.ts'
import type { SpatialMethod } from './spatial-bundle.ts'

export const VISUAL_MANIFEST_FORMAT = 'cha-visual-bundle-v1' as const
export const VISUAL_LIMITS = {
  manifestBytes: 256 * 1024,
  splatCount: 262_144,
  assetBytes: 8 * 1024 * 1024,
  cameras: 128,
  coordinate: 1_000_000,
} as const

export type VisualRegistration =
  | { status: 'known'; scaleMPerUnit: number; rotationXyzw: Quaternion; translationM: Vector3; method: SpatialMethod }
  | { status: 'unknown'; reason: string }

export type VisualCamera = {
  id: string
  role: 'training' | 'held-out' | 'illustrative'
  position: Vector3
  orientationXyzw: Quaternion
  intrinsics: { width: number; height: number; fx: number; fy: number; cx: number; cy: number }
  imageSha256: string | null
}

/** A separate appearance contract; positions/cameras are in the same asset frame. */
export type VisualManifest = {
  format: typeof VISUAL_MANIFEST_FORMAT
  id: string
  label: string
  asset: { fileName: string; format: 'splat32'; sha256: string; splatCount: number }
  assetFrame: { handedness: 'right'; up: '+y' | '-y' | '+z' | '-z'; cameraConvention: 'opengl' }
  worldFrame: { units: 'm'; axes: 'right-handed-z-up' }
  registration: VisualRegistration
  provenance: {
    kind: 'synthetic' | 'image-reconstruction' | 'generated' | 'mesh-conversion'
    creator: string
    sourceUrl: string | null
    license: { name: string; url: string | null }
    method: string
    version: string
    notes: string
  }
  cameras: VisualCamera[]
}

export type VisualAssetStats = {
  splatCount: number
  visibleSplatCount: number
  sourceBytes: number
  localBounds: { min: Vector3; max: Vector3 }
  /** Minimum decoded center/covariance/color attributes; excludes renderer overhead. */
  decodedAttributeBytes: number
}

export type LoadedVisualBundle = {
  manifest: VisualManifest
  manifestSha256: string
  assetSha256: string
  manifestBytes: Uint8Array<ArrayBuffer>
  assetBytes: Uint8Array<ArrayBuffer>
  stats: VisualAssetStats
  timing: { readMs: number; inspectMs: number }
}
