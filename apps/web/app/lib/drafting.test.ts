import { describe, expect, it } from 'vitest'
import { layoutWallDimensions, snapDraftPoint, type DimensionSegment, type DraftWall } from './drafting'

describe('snapDraftPoint', () => {
  it('snaps to the nearest endpoint before the grid and returns copied points', () => {
    const raw: [number, number] = [1.1, 2.05]
    const endpoint: [number, number] = [1, 2]
    const walls: DraftWall[] = [{ id: 'w1', start: endpoint, end: [20, 20] }]
    const snapped = snapDraftPoint(raw, walls, .5)
    expect(snapped).toMatchObject({ kind: 'endpoint', point: [1, 2], raw: [1.1, 2.05], target: { wallId: 'w1', endpoint: 'start' } })
    raw[0] = 50; endpoint[0] = 50
    expect(snapped.raw).toEqual([1.1, 2.05])
    expect(snapped.point).toEqual([1, 2])
  })

  it('uses negative-coordinate grid rounding and millimeter precision when no endpoint is close', () => {
    expect(snapDraftPoint([-1.26, 2.26], [], .5)).toMatchObject({ kind: 'grid', point: [-1.5, 2.5], raw: [-1.26, 2.26] })
    expect(snapDraftPoint([.146, -.146], [], .1).point).toEqual([.1, -.1])
  })

  it('includes the 0.25 m threshold and lets the last tied endpoint win', () => {
    const walls: DraftWall[] = [
      { id: 'first', start: [-.1, 0], end: [10, 10] },
      { id: 'last', start: [.1, 0], end: [20, 20] },
    ]
    expect(snapDraftPoint([0, 0], walls, .5).target).toEqual({ wallId: 'last', endpoint: 'start' })
    expect(snapDraftPoint([.25, 0], [{ id: 'threshold', start: [0, 0], end: [50, 50] }], .5)).toMatchObject({ kind: 'endpoint', distanceM: .25 })
  })

  it('rejects non-finite inputs and invalid grid steps', () => {
    expect(() => snapDraftPoint([Infinity, 1], [], .25)).toThrow(RangeError)
    expect(() => snapDraftPoint([1, 1], [], 0)).toThrow(RangeError)
    expect(() => snapDraftPoint([1, 1], [], NaN)).toThrow(RangeError)
  })
})

describe('layoutWallDimensions', () => {
  it('keeps physical length in metres under rotated and scaled screen projection', () => {
    const segment: DimensionSegment = { id: 'angled', start: [0, 0], end: [3, 4] }
    const marks = layoutWallDimensions([segment], ([x, y]) => [200 - 2 * y, 100 + 2 * x], 500, 400)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ id: 'angled', lengthM: 5, label: '5.00 m' })
    expect(Math.hypot(marks[0]!.end[0] - marks[0]!.start[0], marks[0]!.end[1] - marks[0]!.start[1])).toBeCloseTo(10)
  })

  it('clamps labels inside the safe viewport bands and culls offscreen or zero-length segments', () => {
    const segments: DimensionSegment[] = [
      { id: 'edge', start: [0, 0], end: [1, 0] },
      { id: 'outside', start: [-30, 80], end: [-20, 80] },
      { id: 'zero', start: [20, 20], end: [20, 20] },
    ]
    const marks = layoutWallDimensions(segments, ([x, y]) => [x, y], 300, 240)
    expect(marks.map(mark => mark.id)).toEqual(['edge'])
    expect(marks[0]!.labelAt[0]).toBeGreaterThanOrEqual(32 + 23)
    expect(marks[0]!.labelAt[1]).toBeGreaterThanOrEqual(60 + 9)
    expect(marks[0]!.labelAt[1]).toBeLessThanOrEqual(240 - 80 - 9)
    expect(layoutWallDimensions(segments, point => point, 0, 240)).toEqual([])
  })

  it('keeps bottom-edge wall anchors and places its offset line on the visible side', () => {
    const segment: DimensionSegment = { id: 'bottom', start: [50, 230], end: [250, 230] }
    const [mark] = layoutWallDimensions([segment], point => point, 300, 240)
    expect(mark?.wallStart).toEqual([50, 230])
    expect(mark?.wallEnd).toEqual([250, 230])
    expect(mark?.start[1]).toBe(214)
    expect(mark?.end[1]).toBe(214)
    expect(mark?.labelAnchor).toEqual([150, 214])
    expect(mark?.labelAt[1]).toBeLessThan(mark?.labelAnchor[1] ?? 0)
  })

  it('keeps left-edge wall anchors and rejects diagonal bounding-box-only visibility', () => {
    const [mark] = layoutWallDimensions([{ id: 'left', start: [5, 70], end: [5, 190] }], point => point, 300, 240)
    expect(mark?.wallStart).toEqual([5, 70])
    expect(mark?.wallEnd).toEqual([5, 190])
    expect(mark?.start[0]).toBe(21)
    expect(mark?.end[0]).toBe(21)
    expect(mark?.labelAnchor).toEqual([21, 130])
    const missedDiagonal = layoutWallDimensions([{ id: 'diagonal', start: [-100, 5], end: [5, -100] }], point => point, 300, 240)
    expect(missedDiagonal).toEqual([])
  })

  it('keeps true measurement endpoints when only part of a wall is visible', () => {
    const [mark] = layoutWallDimensions([{ id: 'partial', start: [-50, 100], end: [150, 100] }], point => point, 300, 240)
    expect(mark).toMatchObject({ wallStart: [-50, 100], wallEnd: [150, 100], start: [-50, 116], end: [150, 116], labelAnchor: [75, 116], lengthM: 200 })
    expect(layoutWallDimensions([{ id: 'outside', start: [-1, 70], end: [-1, 190] }], point => point, 300, 240)).toEqual([])
  })

  it('prioritizes selected and draft dimensions, avoids label collisions, and caps large plans', () => {
    const segments: DimensionSegment[] = Array.from({ length: 40 }, (_, index) => ({
      id: `segment-${index}`,
      start: [20, 100 + index * .01],
      end: [24, 100 + index * .01],
      ...(index === 35 ? { selected: true } : {}),
      ...(index === 39 ? { draft: true } : {}),
    }))
    const marks = layoutWallDimensions(segments, ([x, y]) => [100 + x, y], 500, 300)
    expect(marks.length).toBeLessThanOrEqual(32)
    expect(marks[0]?.id).toBe('segment-39')
    expect(marks.some(mark => mark.id === 'segment-35')).toBe(true)
    for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
      expect(Math.abs(marks[i]!.labelAt[1] - marks[j]!.labelAt[1])).toBeGreaterThanOrEqual(18)
    }
  })

  it('skips non-finite projection results', () => {
    expect(layoutWallDimensions([{ id: 'bad', start: [0, 0], end: [1, 0] }], () => [NaN, Infinity], 400, 300)).toEqual([])
  })
})
