import { describe, expect, it } from 'vitest'
import { inspectSplatAsset } from './spatial-visual.ts'
import { evaluateStereo, renderStereoEvaluation, renderStereoPreview } from './spatial-stereo-evaluation.ts'
import { encodeStereoPly, encodeStereoSplats } from './spatial-stereo-export.ts'
import type { StereoCamera, StereoEvaluationInput, StereoImage, StereoResult, StereoTruth } from './spatial-stereo-types.ts'

function camera(id: string, width = 3, height = 3, positionM: [number, number, number] = [0, 0, 0]): StereoCamera {
  return { id, positionM, intrinsics: { width, height, fx: 1, fy: 1, cx: 1, cy: 1 } }
}

function result(depths: number[], width = 3, height = 3, color: [number, number, number] = [80, 120, 200]): StereoResult {
  const pixels = width * height
  const outcomes = new Uint8Array(pixels)
  const points = depths.map((depth, pixelIndex) => {
    outcomes[pixelIndex] = 5 // STEREO_OUTCOMES[5] === accepted.
    return { pixelIndex, positionM: [0, 0, -depth] as [number, number, number], color: [...color] as [number, number, number], disparityPx: 8, meanAbsoluteError: 0 }
  })
  return {
    status: points.length ? 'reconstructed' : 'empty', width, height, baselineM: 0.3,
    settings: { minDisparity: 4, maxDisparity: 28, patchRadius: 2, minTextureVariance: 24, maxMeanAbsoluteError: 18, uniquenessRatio: 0.8, leftRightTolerancePx: 1 },
    outcomes,
    counts: { border: pixels - points.length, textureless: 0, photometric: 0, ambiguous: 0, inconsistent: 0, accepted: points.length },
    points,
  }
}

function truth(depthM: (number | null)[], truthCamera = camera('reference')): StereoTruth {
  return { depthM, camera: truthCamera }
}

function heldOutFor(stereo: StereoResult, truthImage?: StereoImage, heldOutCamera = camera('held-out')) {
  const image = truthImage ?? renderStereoPreview(stereo.points, heldOutCamera).image
  return { view: { camera: heldOutCamera, image }, truth: truth(new Array<number | null>(image.width * image.height).fill(null), heldOutCamera) }
}

function passingInput(stereo: StereoResult): StereoEvaluationInput {
  const depths = new Array<number | null>(stereo.width * stereo.height).fill(null)
  stereo.points.forEach(point => { depths[point.pixelIndex] = 2 })
  return { reference: truth(depths), heldOut: [heldOutFor(stereo)] }
}

describe('renderStereoPreview', () => {
  it('uses OpenGL camera coordinates, square 3x3 splats, and a near-first z-buffer', () => {
    const cam = camera('preview')
    const far = { pixelIndex: 1, positionM: [0, 0, -2] as [number, number, number], color: [0, 0, 255] as [number, number, number], disparityPx: 8, meanAbsoluteError: 0 }
    const near = { pixelIndex: 2, positionM: [0, 0, -1] as [number, number, number], color: [255, 0, 0] as [number, number, number], disparityPx: 8, meanAbsoluteError: 0 }
    const behind = { pixelIndex: 0, positionM: [0, 0, 1] as [number, number, number], color: [0, 255, 0] as [number, number, number], disparityPx: 8, meanAbsoluteError: 0 }
    const originals = structuredClone([far, near, behind])
    const rendered = renderStereoPreview([far, near, behind], cam)
    expect([...rendered.covered]).toEqual(new Array(9).fill(1))
    for (let pixel = 0; pixel < 9; pixel += 1) expect([...rendered.image.rgb.slice(pixel * 3, pixel * 3 + 3)]).toEqual([255, 0, 0])
    expect([far, near, behind]).toEqual(originals)
  })

  it('clips projected splats at frame edges and returns zero coverage behind the camera', () => {
    const edge = { pixelIndex: 0, positionM: [-2, 0, -1] as [number, number, number], color: [5, 6, 7] as [number, number, number], disparityPx: 8, meanAbsoluteError: 0 }
    const rendered = renderStereoPreview([edge], camera('edge'))
    expect([...rendered.covered]).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0])
    const behind = { ...edge, positionM: [0, 0, 1] as [number, number, number] }
    expect([...renderStereoPreview([behind], camera('behind')).covered]).toEqual(new Array(9).fill(0))
  })

  it('converts projected pixel-centre coordinates to raster pixel indices', () => {
    const cam: StereoCamera = { id: 'subpixel-center', positionM: [0, 0, 0], intrinsics: { width: 5, height: 3, fx: 1, fy: 1, cx: 2.5, cy: 1.5 } }
    const point = { pixelIndex: 0, positionM: [0, 0, -2] as [number, number, number], color: [1, 2, 3] as [number, number, number], disparityPx: 8, meanAbsoluteError: 0 }
    const rendered = renderStereoPreview([point], cam)
    expect([...rendered.covered]).toEqual([0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0])
  })

  it('rejects malformed camera data and points instead of silently omitting them', () => {
    const point = result([2]).points
    expect(() => renderStereoPreview(point, { ...camera('bad'), intrinsics: { ...camera('bad').intrinsics, fx: 0 } })).toThrow(/fx/)
    expect(() => renderStereoPreview([{ ...point[0]!, positionM: [0, Number.NaN, -2] }], camera('bad-point'))).toThrow(/finite/)
    expect(() => renderStereoPreview([{ ...point[0]!, color: [0, 256, 0] }], camera('bad-color'))).toThrow(/byte/)
    expect(() => renderStereoPreview(new Array(1), camera('sparse-points'))).toThrow(/missing/)
  })
})

describe('evaluateStereo', () => {
  it('computes direct metric depth errors, held-out image scores, outcome counts and frozen gates', () => {
    const stereo = result([2, 2.01, 2.02, 2.03, 2.04, 2.05])
    const input = passingInput(stereo)
    const report = evaluateStereo(stereo, input)
    expect(report.outcomeCounts).toEqual(stereo.counts)
    expect(report.reference).toEqual({
      acceptedFraction: 6 / 9, depthCount: 6,
      unevaluatedAcceptedCount: 0,
      meanAbsoluteDepthErrorM: expect.closeTo(0.025),
      depthP50M: expect.closeTo(0.025), depthP90M: expect.closeTo(0.045), depthMaxM: expect.closeTo(0.05),
    })
    expect(report.heldOut[0]).toMatchObject({ coveredPixels: 9, totalPixels: 9, coverage: 1, coveredMae: 0, allPixelMae: 0, psnrDb: 120 })
    expect(report.gates).toMatchObject({ minimumAcceptedFraction: true, completeReferenceTruth: true, maximumDepthP90M: true, passed: true })
    expect(report.gates.heldOut[0]?.passed).toBe(true)
    expect(report.passed).toBe(true)
  })

  it('does not fit or rescale points to truth and fails a corrupted held-out image', () => {
    const stereo = result([2.1, 2.1, 2.1, 2.1, 2.1, 2.1], 3, 3, [255, 255, 255])
    const input = passingInput(stereo)
    input.heldOut[0]!.view.image.rgb.fill(0)
    const report = evaluateStereo(stereo, input)
    expect(report.reference.meanAbsoluteDepthErrorM).toBeCloseTo(0.1)
    expect(report.heldOut[0]?.coveredMae).toBe(255)
    expect(report.heldOut[0]?.allPixelMae).toBe(255)
    expect(report.heldOut[0]?.psnrDb).toBe(0)
    expect(report.gates.heldOut[0]?.passed).toBe(false)
    expect(report.passed).toBe(false)
  })

  it('scores missing pixels as black in full-image MAE and rejects absent depth comparisons', () => {
    const stereo = result([2], 5, 5, [255, 255, 255])
    const depth = new Array<number | null>(25).fill(null)
    depth[0] = 2
    const cam = camera('held-out', 5, 5)
    const rendered = renderStereoPreview(stereo.points, cam)
    const input: StereoEvaluationInput = {
      reference: truth(depth, camera('reference', 5, 5)),
      heldOut: [{ view: { camera: cam, image: { ...rendered.image, rgb: new Uint8Array(25 * 3).fill(255) } }, truth: truth(new Array(25).fill(null), cam) }],
    }
    const report = evaluateStereo(stereo, input)
    expect(report.heldOut[0]?.coverage).toBe(9 / 25)
    expect(report.heldOut[0]?.coveredMae).toBe(0)
    expect(report.heldOut[0]?.allPixelMae).toBeCloseTo(16 / 25 * 255)

    const noDepth = result([2], 3, 3)
    const noDepthReport = evaluateStereo(noDepth, { ...passingInput(noDepth), reference: truth(new Array(9).fill(null)) })
    expect(noDepthReport.reference.depthCount).toBe(0)
    expect(noDepthReport.reference.depthP90M).toBeNull()
    expect(noDepthReport.reference.unevaluatedAcceptedCount).toBe(1)
    expect(noDepthReport.gates.completeReferenceTruth).toBe(false)
    expect(noDepthReport.gates.maximumDepthP90M).toBe(false)
    expect(noDepthReport.passed).toBe(false)
  })

  it('fails held-out coverage and covered-MAE gates when all predictions are missing', () => {
    const stereo = result([2])
    const cam = camera('held-out', 3, 3, [0, 0, -3])
    const view = { camera: cam, image: { width: 3, height: 3, rgb: new Uint8Array(27).fill(100) } }
    const input = { ...passingInput(stereo), heldOut: [{ view, truth: truth(new Array(9).fill(null), cam) }] }
    const report = evaluateStereo(stereo, input)
    expect(report.heldOut[0]).toMatchObject({ coveredPixels: 0, coverage: 0, coveredMae: null, allPixelMae: 100, psnrDb: expect.any(Number) })
    expect(report.gates.heldOut[0]?.passed).toBe(false)
  })

  it('rejects malformed result histograms, truth maps, duplicate held-out views and shape mismatches', () => {
    const stereo = result([2])
    const input = passingInput(stereo)
    expect(() => evaluateStereo({ ...stereo, counts: { ...stereo.counts, accepted: 0 } }, input)).toThrow(/counts.accepted/)
    expect(() => evaluateStereo(stereo, { ...input, reference: truth([Number.NaN, null, null, null, null, null, null, null, null]) })).toThrow(/finite/)
    const sparseDepth = new Array<number | null>(9)
    expect(() => evaluateStereo(stereo, { ...input, reference: truth(sparseDepth) })).toThrow(/finite number/)
    expect(() => evaluateStereo(stereo, { ...input, heldOut: [input.heldOut[0]!, input.heldOut[0]!] })).toThrow(/duplicate/)
    const referenceAsHeldOut = { ...input.heldOut[0]!, view: { ...input.heldOut[0]!.view, camera: camera('reference') }, truth: truth(new Array(9).fill(null)) }
    expect(() => evaluateStereo(stereo, { ...input, heldOut: [referenceAsHeldOut] })).toThrow(/reference camera/)
    const malformedImage = { ...input.heldOut[0]!, view: { ...input.heldOut[0]!.view, image: { width: 2, height: 2, rgb: new Uint8Array(12) } } }
    expect(() => evaluateStereo(stereo, { ...input, heldOut: [malformedImage] })).toThrow(/dimensions/)
  })

  it('renders deterministic JSON and readable Markdown with retained rejection counts', () => {
    const stereo = result([2])
    const report = evaluateStereo(stereo, passingInput(stereo))
    expect(renderStereoEvaluation(report)).toBe(renderStereoEvaluation(report, 'json'))
    expect(renderStereoEvaluation(report, 'markdown')).toContain('border: 8')
    expect(renderStereoEvaluation(report, 'markdown')).toContain('| held-out |')
    expect(() => renderStereoEvaluation(report, 'yaml' as 'json')).toThrow(/format/)
  })
})

describe('encodeStereoSplats', () => {
  it('exports metric-frame coordinates, tangent-scaled records, color and identity wxyz quaternion', () => {
    const stereo = result([2, 2, 2, 2, 2, 2], 3, 3, [12, 34, 56])
    const cam = camera('reference')
    const before = structuredClone(stereo)
    const bytes = encodeStereoSplats(stereo, cam)
    expect(bytes.byteLength).toBe(6 * 32)
    expect(inspectSplatAsset(bytes, 6)).toMatchObject({ splatCount: 6, sourceBytes: 192, decodedAttributeBytes: 240 })
    const view = new DataView(bytes.buffer)
    expect(view.getFloat32(8, true)).toBe(-2)
    expect(view.getFloat32(12, true)).toBeCloseTo(1.2)
    expect([...bytes.slice(24, 32)]).toEqual([12, 34, 56, 255, 255, 128, 128, 128])
    expect(stereo).toEqual(before)
  })

  it('exports a deterministic ASCII PLY with world-space RGB vertices', () => {
    const stereo = result([2, 2], 3, 3, [12, 34, 56])
    const first = encodeStereoPly(stereo)
    expect(first).toContain('element vertex 2\n')
    expect(first).toContain('property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n')
    expect(first.split('\n').at(-3)).toBe('0 0 -2 12 34 56')
    expect(encodeStereoPly(stereo)).toBe(first)
  })

  it('keeps points and nonzero camera positions in the same metric asset frame', () => {
    const stereo = result([2])
    const shiftedCamera = camera('shifted', 3, 3, [-0.15, 0.2, 0.4])
    stereo.points[0]!.positionM = [0.3, 0.1, -2]
    const bytes = encodeStereoSplats(stereo, shiftedCamera)
    const view = new DataView(bytes.buffer)
    expect(view.getFloat32(0, true)).toBeCloseTo(0.3)
    expect(view.getFloat32(4, true)).toBeCloseTo(0.1)
    expect(view.getFloat32(8, true)).toBe(-2)
    expect(view.getFloat32(12, true)).toBeCloseTo(0.6 * 2.4)
  })

  it('rejects points behind the export camera and mismatched camera dimensions', () => {
    const stereo = result([2])
    expect(() => encodeStereoSplats({ ...stereo, points: [{ ...stereo.points[0]!, positionM: [0, 0, 1] }] }, camera('reference'))).toThrow(/depth/)
    expect(() => encodeStereoSplats(stereo, camera('reference', 2, 2))).toThrow(/dimensions/)
    expect(() => encodeStereoSplats(result([]), camera('reference'))).toThrow(/at least one point/)
  })
})
