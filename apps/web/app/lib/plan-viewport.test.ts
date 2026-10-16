import { describe, expect, it } from 'vitest'
import {
  createPlanTransform,
  fitPlanView,
  MAX_PLAN_ZOOM,
  MIN_PLAN_ZOOM,
  panPlanView,
  zoomPlanView,
  type PlanBounds,
} from './plan-viewport'

const bounds: PlanBounds = { minX: -4, maxX: 16, minY: 3, maxY: 13 }
const closePoint = (actual: [number, number], expected: [number, number], digits = 8) => {
  expect(actual[0]).toBeCloseTo(expected[0], digits)
  expect(actual[1]).toBeCloseTo(expected[1], digits)
}

describe('plan viewport transforms', () => {
  it('roundtrips world and screen coordinates for nonzero bounds', () => {
    const transform = createPlanTransform(bounds, 800, 600, fitPlanView(bounds))
    const point: [number, number] = [7.25, 9.5]
    closePoint(transform.screenToWorld(transform.worldToScreen(point)), point)
  })

  it('matches the existing centered fit scale and padding', () => {
    const width = 1000, height = 700
    const padding = Math.min(80, width * 0.1)
    const oldScale = Math.min((width - padding * 2) / 20, (height - padding * 2) / 10)
    const transform = createPlanTransform(bounds, width, height, fitPlanView(bounds))
    expect(transform.scale).toBe(oldScale)
    closePoint(transform.worldToScreen([6, 8]), [width / 2, height / 2])
  })

  it('preserves the world point beneath an off-center zoom anchor', () => {
    const view = { zoom: 1.4, center: [4, 9] as [number, number] }
    const anchor: [number, number] = [137, 421]
    const before = createPlanTransform(bounds, 800, 600, view).screenToWorld(anchor)
    const zoomed = zoomPlanView(bounds, 800, 600, view, 1.8, anchor)
    const after = createPlanTransform(bounds, 800, 600, zoomed).screenToWorld(anchor)
    closePoint(after, before)
  })

  it('pans the drawing in the pointer delta direction', () => {
    const view = fitPlanView(bounds)
    const before = createPlanTransform(bounds, 800, 600, view).worldToScreen([5, 8])
    const moved = panPlanView(bounds, 800, 600, view, [40, -25])
    const after = createPlanTransform(bounds, 800, 600, moved).worldToScreen([5, 8])
    closePoint(after, [before[0] + 40, before[1] - 25])
  })

  it('clamps zoom and keeps the world center stable across a resize', () => {
    const start = { zoom: 1, center: [6, 8] as [number, number] }
    expect(zoomPlanView(bounds, 800, 600, start, 100).zoom).toBe(MAX_PLAN_ZOOM)
    expect(zoomPlanView(bounds, 800, 600, start, .001).zoom).toBe(MIN_PLAN_ZOOM)
    const resized = createPlanTransform(bounds, 1200, 500, start)
    closePoint(resized.screenToWorld([600, 250]), start.center)
  })

  it('sanitizes hidden dimensions and invalid view values without producing non-finite transforms', () => {
    const transform = createPlanTransform(bounds, 0, Number.NaN, { zoom: Number.NaN, center: [Infinity, 0] })
    expect(Number.isFinite(transform.scale)).toBe(true)
    expect(transform.worldToScreen([1, 1]).every(Number.isFinite)).toBe(true)
    expect(transform.screenToWorld([0, 0]).every(Number.isFinite)).toBe(true)
    expect(zoomPlanView(bounds, 0, 0, fitPlanView(bounds), 2)).toMatchObject({ zoom: 2 })
  })

  it('rejects non-finite or degenerate home bounds', () => {
    expect(() => fitPlanView({ ...bounds, maxX: bounds.minX })).toThrow(RangeError)
    expect(() => createPlanTransform({ ...bounds, minY: Number.NaN }, 800, 600, fitPlanView(bounds))).toThrow(RangeError)
  })
})
