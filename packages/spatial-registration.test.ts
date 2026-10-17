import { describe, expect, it } from 'vitest'
import { applyRigidTransform, composeRigidTransforms, invertRigidTransform, type RigidTransform } from './spatial-registration'

const identity: RigidTransform = { translationM: [0, 0, 0], rotationXyzw: [0, 0, 0, 1] }
const quarterTurnX: RigidTransform = { translationM: [0, 1, 0], rotationXyzw: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
const quarterTurnZ: RigidTransform = { translationM: [1, 2, 0], rotationXyzw: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }

describe('spatial rigid transforms', () => {
  it('applies a known quarter turn and translation', () => {
    applyRigidTransform([1, 0, 0], quarterTurnZ).forEach((value, index) => expect(value).toBeCloseTo([1, 3, 0][index]!, 12))
  })

  it('inverts a transform and round trips points', () => {
    const point: [number, number, number] = [3.25, -2, 4]
    const roundTrip = applyRigidTransform(applyRigidTransform(point, quarterTurnZ), invertRigidTransform(quarterTurnZ))
    roundTrip.forEach((value, index) => expect(value).toBeCloseTo(point[index]!, 12))
    expect(composeRigidTransforms(invertRigidTransform(quarterTurnZ), quarterTurnZ)).toEqual(identity)
  })

  it('composes noncommuting transforms in explicit inner-first order', () => {
    const point: [number, number, number] = [0, 1, 0]
    const composed = composeRigidTransforms(quarterTurnZ, quarterTurnX)
    const sequential = applyRigidTransform(applyRigidTransform(point, quarterTurnX), quarterTurnZ)
    const result = applyRigidTransform(point, composed)
    result.forEach((value, index) => expect(value).toBeCloseTo(sequential[index]!, 12))
    result.forEach((value, index) => expect(value).toBeCloseTo([0, 2, 1][index]!, 12))
    expect(applyRigidTransform(applyRigidTransform(point, quarterTurnZ), quarterTurnX)).not.toEqual(result)
  })

  it('rejects malformed values without silently normalizing and leaves inputs unchanged', () => {
    const transform = structuredClone(quarterTurnZ)
    const point: [number, number, number] = [1, 2, 3]
    const originalPoint = [...point]
    expect(() => applyRigidTransform(point, { ...transform, rotationXyzw: [0, 0, 0, 2] })).toThrow(/unit quaternion/)
    expect(() => applyRigidTransform([1, Number.NaN, 0], transform)).toThrow(/finite numbers/)
    composeRigidTransforms(transform, quarterTurnX)
    invertRigidTransform(transform)
    applyRigidTransform(point, transform)
    expect(transform).toEqual(quarterTurnZ)
    expect(point).toEqual(originalPoint)
  })
})
