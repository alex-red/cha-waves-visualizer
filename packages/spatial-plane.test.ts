import { describe, expect, it } from 'vitest'
import type { Vector3 } from './spatial-registration.ts'
import {
  fitSinglePlane,
  predictPlaneDelayMs,
  type PlaneObservation,
  type SpatialPlane,
} from './spatial-plane.ts'

const speaker: Vector3 = [2, 1, 1.2]
const microphones: Vector3[] = [
  [4.1, 1.1, 1.4],
  [2.2, 3.5, 1.7],
  [3.7, 2.1, 4.0],
  [0.5, 2.7, 2.3],
  [4.5, 3.6, 3.1],
  [1.2, 0.8, 4.4],
]

const norm = (v: Vector3): number => Math.hypot(...v)
const normalized = (v: Vector3): Vector3 => v.map(value => value / norm(v)) as Vector3
const clone = <T>(value: T): T => structuredClone(value)

function observationsFor(plane: SpatialPlane, idPrefix = 'pose', positions = microphones, source = speaker): PlaneObservation[] {
  return positions.map((microphonePositionM, index) => ({
    id: `${idPrefix}-${index + 1}`,
    speakerPositionM: [...source],
    microphonePositionM: [...microphonePositionM],
    arrivalCandidatesMs: [predictPlaneDelayMs(plane, source, microphonePositionM)],
  }))
}

function translatedPlane(plane: SpatialPlane, translation: Vector3): SpatialPlane {
  return { normal: [...plane.normal], offsetM: plane.offsetM + plane.normal[0] * translation[0] + plane.normal[1] * translation[1] + plane.normal[2] * translation[2] }
}

describe('single infinite plane reference', () => {
  it('predicts colocated and separated source/microphone image-source paths analytically', () => {
    const floor: SpatialPlane = { normal: [0, 0, 1], offsetM: 0 }
    expect(predictPlaneDelayMs(floor, [0, 0, 1], [0, 0, 1])).toBeCloseTo(2_000 / 343, 12)
    const direct = Math.sqrt(1.25)
    const reflected = Math.sqrt(9.25)
    expect(predictPlaneDelayMs(floor, [0, 0, 1], [0, 0.5, 2])).toBeCloseTo((reflected - direct) * 1000 / 343, 12)
  })

  it('canonicalizes accepted near-unit normals without changing a large-coordinate plane', () => {
    const factor = 1 + 5e-7
    const exact: SpatialPlane = { normal: [0, 0, 1], offsetM: 899_999 }
    const approximate: SpatialPlane = { normal: [0, 0, factor], offsetM: 899_999 * factor }
    const reversed: SpatialPlane = { normal: [0, 0, -factor], offsetM: -899_999 * factor }
    const largeSpeaker: Vector3 = [900_000, -900_000, 900_000]
    const largeMic: Vector3 = [900_000.5, -899_999.5, 900_001]
    const expected = predictPlaneDelayMs(exact, largeSpeaker, largeMic)
    expect(predictPlaneDelayMs(approximate, largeSpeaker, largeMic)).toBeCloseTo(expected, 9)
    expect(predictPlaneDelayMs(reversed, largeSpeaker, largeMic)).toBeCloseTo(expected, 9)
  })

  it('fits tilted, floor and ceiling planes and publishes only an accepted plane', () => {
    const tilted: SpatialPlane = { normal: normalized([0.3, -0.2, 0.93]), offsetM: 0 }
    const cases: SpatialPlane[] = [tilted, { normal: [0, 0, 1], offsetM: 0 }, { normal: [0, 0, 1], offsetM: 5 }]
    for (const [index, plane] of cases.entries()) {
      const result = fitSinglePlane(observationsFor(plane, `case${index}`))
      expect(result.status).toBe('ok')
      expect(result.plane).toBeDefined()
      expect(result.imageSourceM).toBeDefined()
      expect(result.rmsResidualMs).toBeLessThan(1e-8)
      expect(result.maxResidualMs).toBeLessThan(1e-8)
      expect(result.plane!.normal[0] * speaker[0] + result.plane!.normal[1] * speaker[1] + result.plane!.normal[2] * speaker[2] - result.plane!.offsetM).toBeGreaterThan(0)
      const speakerSide = plane.normal[0] * speaker[0] + plane.normal[1] * speaker[1] + plane.normal[2] * speaker[2] - plane.offsetM
      const sign = speakerSide > 0 ? 1 : -1
      result.plane!.normal.forEach((value, axis) => expect(value).toBeCloseTo(plane.normal[axis]! * sign, 7))
      expect(result.plane!.offsetM).toBeCloseTo(plane.offsetM * sign, 7)
    }
  })

  it('is translation invariant when every position and plane offset share a world translation', () => {
    const plane: SpatialPlane = { normal: normalized([0.2, -0.15, 0.97]), offsetM: 0.25 }
    const translation: Vector3 = [10_000, -20_000, 500]
    const movedSpeaker = speaker.map((value, index) => value + translation[index]!) as Vector3
    const movedMics = microphones.map(position => position.map((value, index) => value + translation[index]!) as Vector3)
    const original = fitSinglePlane(observationsFor(plane))
    const translated = fitSinglePlane(observationsFor(translatedPlane(plane, translation), 'moved', movedMics, movedSpeaker))
    expect(original.status).toBe('ok')
    expect(translated.status).toBe('ok')
    translated.plane!.normal.forEach((value, axis) => expect(value).toBeCloseTo(original.plane!.normal[axis]!, 7))
    expect(translated.plane!.offsetM).toBeCloseTo(translatedPlane(plane, translation).offsetM, 5)
    translated.imageSourceM!.forEach((value, axis) => expect(value - translation[axis]!).toBeCloseTo(original.imageSourceM![axis]!, 5))
  })

  it('predicts separate held-out positions without adding them to the fit', () => {
    const plane: SpatialPlane = { normal: normalized([0.25, 0.1, 0.96]), offsetM: 0.1 }
    const fit = fitSinglePlane(observationsFor(plane))
    expect(fit.status).toBe('ok')
    const heldOut: Vector3[] = [[3.2, 4.1, 2.5], [0.8, 1.5, 5.2]]
    for (const microphone of heldOut) {
      expect(predictPlaneDelayMs(fit.plane!, speaker, microphone)).toBeCloseTo(predictPlaneDelayMs(plane, speaker, microphone), 7)
    }
    expect(fit.eligibleCount).toBe(microphones.length)
  })

  it('keeps missing and ambiguous attempts in input order without selecting a candidate', () => {
    const plane: SpatialPlane = { normal: [0, 0, 1], offsetM: 0 }
    const training = observationsFor(plane)
    const missing = { ...observationsFor(plane, 'missing', [microphones[0]!])[0]!, id: 'missing', arrivalCandidatesMs: [] }
    const ambiguous = { ...observationsFor(plane, 'ambiguous', [microphones[1]!])[0]!, id: 'ambiguous', arrivalCandidatesMs: [2, 3] }
    const result = fitSinglePlane([...training, missing, ambiguous])
    expect(result.status).toBe('ok')
    expect(result.eligibleCount).toBe(6)
    expect(result.outcomes.slice(-2)).toEqual([{ id: 'missing', status: 'missing' }, { id: 'ambiguous', status: 'ambiguous' }])
  })

  it('rejects too few, coplanar, moving-source and mixed-arrival inputs without publishing geometry', () => {
    const plane: SpatialPlane = { normal: [0, 0, 1], offsetM: 0 }
    const valid = observationsFor(plane)
    const tooFew = fitSinglePlane(valid.slice(0, 3))
    expect(tooFew.status).toBe('insufficient-data')
    expect(tooFew).not.toHaveProperty('plane')

    const coplanarMics: Vector3[] = [[0, 0, 1], [1, 0, 1], [0, 1, 1], [2, 3, 1], [4, 1, 1]]
    const coplanar = fitSinglePlane(observationsFor(plane, 'flat', coplanarMics))
    expect(coplanar.status).toBe('insufficient-data')
    expect(coplanar).not.toHaveProperty('imageSourceM')

    const almostCoplanarMics: Vector3[] = [
      [0, 0, 1], [1, 0, 1 + 1e-12], [0, 1, 1 - 1e-12],
      [1, 1, 1 + 2e-12], [0.4, 0.7, 1 - 2e-12],
    ]
    const almostCoplanar = fitSinglePlane(observationsFor(plane, 'almost-flat', almostCoplanarMics))
    expect(almostCoplanar.status).toBe('insufficient-data')
    expect(almostCoplanar).not.toHaveProperty('plane')

    const moved = clone(valid)
    moved[moved.length - 1]!.speakerPositionM[0] += 0.001
    const movingResult = fitSinglePlane(moved)
    expect(movingResult.status).toBe('unsupported-source-motion')
    expect(movingResult).not.toHaveProperty('plane')

    const corrupted = clone(valid)
    corrupted[0]!.arrivalCandidatesMs[0] = corrupted[0]!.arrivalCandidatesMs[0]! + 0.5
    const badFit = fitSinglePlane(corrupted)
    expect(badFit.status).toBe('no-solution')
    expect(badFit.maxResidualMs).toBeGreaterThan(0.05)
    expect(badFit).not.toHaveProperty('plane')
  })

  it('accepts either input normal sign and leaves observations unchanged', () => {
    const plane: SpatialPlane = { normal: normalized([0.1, 0.1, 0.99]), offsetM: 0 }
    const reversed: SpatialPlane = { normal: plane.normal.map(value => -value) as Vector3, offsetM: -plane.offsetM }
    const mic: Vector3 = [3, 2, 4]
    expect(predictPlaneDelayMs(plane, speaker, mic)).toBeCloseTo(predictPlaneDelayMs(reversed, speaker, mic), 12)
    const observations = observationsFor(plane)
    const before = clone(observations)
    const result = fitSinglePlane(observations)
    expect(result.status).toBe('ok')
    expect(observations).toEqual(before)
  })

  it('rejects malformed bounds, duplicate IDs, invalid normals and opposite-side geometry', () => {
    const valid = observationsFor({ normal: [0, 0, 1], offsetM: 0 })
    expect(fitSinglePlane([{ ...valid[0]!, id: 'not valid' }]).status).toBe('invalid-data')
    expect(fitSinglePlane([valid[0]!, { ...valid[1]!, id: valid[0]!.id }]).status).toBe('invalid-data')
    expect(fitSinglePlane(valid, { maxResidualMs: 11 }).status).toBe('invalid-data')
    expect(() => predictPlaneDelayMs({ normal: [0, 0, 2], offsetM: 0 }, speaker, microphones[0]!)).toThrow(/unit norm/)
    expect(() => predictPlaneDelayMs({ normal: [0, 0, 1], offsetM: 0 }, speaker, [0, 0, -1])).toThrow(/same side/)
    expect(() => predictPlaneDelayMs({ normal: [0, 0, 1], offsetM: 1.2 }, speaker, microphones[0]!)).toThrow(/degenerate/)
  })
})
