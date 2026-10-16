import { describe, expect, it } from 'vitest'
import { createDemoScene, MAX_GRID_CELLS } from './engine'
import { planSampling, planSceneSampling, sceneSamplingExtent } from './sampling'

describe('sampling budget planner', () => {
  it('keeps a requested step when the grid is below or exactly at the cap', () => {
    expect(planSampling([{ widthM: 399, depthM: 250 }], 1)).toMatchObject({ stepM: 1, coarsened: false, maxCells: 99_750 })
    expect(planSampling([{ widthM: 400, depthM: 250 }], 1)).toMatchObject({ stepM: 1, coarsened: false, maxCells: MAX_GRID_CELLS })
  })

  it('doubles the step when the requested grid exceeds the cap', () => {
    const plan = planSampling([{ widthM: 400, depthM: 250.01 }], 1)
    expect(plan.stepM).toBe(2)
    expect(plan.coarsened).toBe(true)
    expect(plan.maxCells).toBe(25_200)
  })

  it('coarsens the accepted 80 by 80 metre home from 0.25 m', () => {
    expect(planSampling([{ widthM: 80, depthM: 80 }], 0.25)).toMatchObject({ stepM: 0.5, maxCells: 25_600 })
    expect(planSampling([{ widthM: 12, depthM: 9 }], 0.25)).toMatchObject({ stepM: 0.25, coarsened: false })
  })

  it('budgets long narrow footprints by bounding-box cell count', () => {
    expect(planSampling([{ widthM: 100_000, depthM: 0.1 }], 0.25)).toMatchObject({ stepM: 1, maxCells: 100_000 })
  })

  it('uses the whole bounding box for concave scene boundaries', () => {
    const scene = createDemoScene()
    scene.levels[0]!.boundary = [[0, 0], [80, 0], [80, 10], [10, 10], [10, 80], [0, 80]]
    expect(sceneSamplingExtent(scene)).toEqual({ widthM: 80, depthM: 80 })
    expect(planSceneSampling([scene], 0.25).stepM).toBe(0.5)
  })

  it('chooses one step that fits every scene in a comparison', () => {
    const plan = planSampling([{ widthM: 12, depthM: 9 }, { widthM: 80, depthM: 80 }], 0.25)
    expect(plan.stepM).toBe(0.5)
    expect(plan.maxCells).toBe(25_600)
  })

  it('rejects invalid steps, dimensions, and coordinate subtraction overflow', () => {
    expect(() => planSampling([{ widthM: 10, depthM: 10 }], 0)).toThrow(/finite positive/)
    expect(() => planSampling([{ widthM: Infinity, depthM: 1 }], 0.25)).toThrow(/finite, positive/)
    const scene = createDemoScene()
    scene.levels[0]!.boundary = [[-1e308, 0], [1e308, 0], [0, 1]]
    expect(() => sceneSamplingExtent(scene)).toThrow(/finite, positive/)
  })

  it('finds finite steps across the full floating-point range without dropping a narrow row', () => {
    const wide = planSampling([{ widthM: 1e308, depthM: 1e308 }], Number.MIN_VALUE)
    expect(Number.isFinite(wide.stepM)).toBe(true)
    expect(wide.maxCells).toBeLessThanOrEqual(MAX_GRID_CELLS)
    const narrow = planSampling([{ widthM: 1e308, depthM: Number.MIN_VALUE }], 0.25)
    expect(narrow.maxCells).toBeGreaterThan(0)
    expect(narrow.maxCells).toBeLessThanOrEqual(MAX_GRID_CELLS)
  })
})
