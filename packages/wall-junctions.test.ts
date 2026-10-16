import { describe, expect, it } from 'vitest'
import { applySceneCommand, SceneCommandError } from './commands'
import { createDemoScene, defaultSettings, evaluatePoint, parseScene, validateWallGeometry } from './engine'

function crossingWall(id = 'crossing-wall') {
  return { id, levelId: 'main', start: [5, 2] as [number, number], end: [5, 8] as [number, number], thicknessM: .12, baseZ: 0, heightM: 2.7, materialId: 'partition' }
}

function expectValid(scene: ReturnType<typeof createDemoScene>) {
  expect(parseScene(scene)).toEqual(scene)
  expect(validateWallGeometry(scene)).toEqual({ valid: true })
}

describe('wall junction commands', () => {
  it('accepts a 0.10 m junction segment in either wall orientation despite floating-point rounding', () => {
    for (const reversed of [false, true]) {
      const scene = createDemoScene()
      scene.emitters = []; scene.probes = []; scene.openings = []
      const host = scene.walls.find(wall => wall.id === 'hall-partition')!
      if (reversed) [host.start, host.end] = [host.end, host.start]
      const x = reversed ? 12.9 : 1.1
      const joined = applySceneCommand(scene, { type: 'add-wall', joinIntersections: true, wall: { ...crossingWall(), start: [x, 3], end: [x, 7] } })
      const first = joined.walls.find(wall => wall.id === host.id)!
      expect(Math.hypot(first.end[0] - first.start[0], first.end[1] - first.start[1])).toBeCloseTo(0.1, 10)
      expectValid(joined)
    }
  })
  it('keeps ordinary additions strict and opts into atomic junction creation', () => {
    const scene = createDemoScene()
    const original = structuredClone(scene)
    expect(() => applySceneCommand(scene, { type: 'add-wall', wall: crossingWall() })).toThrow(/crosses or overlaps/i)
    expect(scene).toEqual(original)

    const joined = applySceneCommand(scene, { type: 'add-wall', wall: crossingWall(), joinIntersections: true })
    expect(joined.revision).toBe(scene.revision + 1)
    expect(joined.walls.some(wall => wall.id === 'hall-partition')).toBe(true)
    expect(joined.walls.find(wall => wall.id === 'hall-partition')!.end).toEqual([5, 5])
    expect(joined.walls.filter(wall => wall.id.startsWith('hall-partition'))).toHaveLength(2)
    expect(joined.walls.filter(wall => wall.id.startsWith('crossing-wall'))).toHaveLength(2)
    expect(joined.openings[0]!.id).toBe('hall-door')
    expect(joined.openings[0]!.wallId, JSON.stringify({ walls: joined.walls.filter(wall => wall.id.includes('hall-partition')), opening: joined.openings[0] })).not.toBe('hall-partition')
    expect(scene).toEqual(original)
    expectValid(joined)
  })

  it('splits at a metre offset, retains orientation and original ID on the first child, and remaps the opening', () => {
    const scene = createDemoScene()
    const opening = structuredClone(scene.openings[0]!)
    const length = 12
    const start = scene.walls.find(wall => wall.id === 'hall-partition')!.start
    const worldSpanBefore = [start[0] + opening.fromT * length, start[0] + opening.toT * length]
    const split = applySceneCommand(scene, { type: 'split-wall', wallId: 'hall-partition', offsetM: 3 })
    const first = split.walls.find(wall => wall.id === 'hall-partition')!
    const second = split.walls.find(wall => wall.id !== 'hall-partition' && wall.start[1] === 5 && wall.end[1] === 5)!
    expect(first.start).toEqual([1, 5])
    expect(first.end).toEqual([4, 5])
    expect(second.start).toEqual([4, 5])
    expect(second.end).toEqual([13, 5])
    expect(second.id).toBeTruthy()
    expect(split.openings).toHaveLength(1)
    expect(split.openings[0]).toMatchObject({ id: opening.id, wallId: second.id, sillAboveBaseM: opening.sillAboveBaseM, heightM: opening.heightM, kind: opening.kind, isOpen: opening.isOpen, fixed: opening.fixed, materialId: opening.materialId })
    const childLength = Math.hypot(second.end[0] - second.start[0], second.end[1] - second.start[1])
    const worldSpanAfter = [second.start[0] + split.openings[0]!.fromT * childLength, second.start[0] + split.openings[0]!.toT * childLength]
    expect(worldSpanAfter[0]!).toBeCloseTo(worldSpanBefore[0]!, 10)
    expect(worldSpanAfter[1]!).toBeCloseTo(worldSpanBefore[1]!, 10)
    expect(split.revision).toBe(scene.revision + 1)
    expectValid(split)
  })

  it('allocates split IDs outside the global entity ID namespace', () => {
    const scene = createDemoScene()
    scene.zones[0]!.id = 'hall-partition-part-2'
    scene.probes[0]!.id = 'hall-partition-part-2-2'
    const split = applySceneCommand(scene, { type: 'split-wall', wallId: 'hall-partition', offsetM: 3 })
    expect(split.walls.find(wall => wall.id.startsWith('hall-partition-part-'))!.id).toBe('hall-partition-part-2-3')
    const ids = [...split.levels, ...split.zones, ...split.materials, ...split.walls, ...split.openings, ...split.emitters, ...split.probes].map(entity => entity.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('permits the exact 0.1 m child boundary and enforces the expanded 256-wall limit', () => {
    const boundaryCase = createDemoScene()
    const split = applySceneCommand(boundaryCase, { type: 'split-wall', wallId: 'hall-partition', offsetM: 0.1 })
    expect(split.walls.find(wall => wall.id === 'hall-partition')!.end[0]).toBeCloseTo(1.1, 10)
    expectValid(split)

    const capped = createDemoScene()
    capped.walls.push(...Array.from({ length: 251 }, (_, index) => {
      const y = 0.2 + index * 0.0135
      return { id: `cap-wall-${index}`, levelId: 'main', start: [8, y] as [number, number], end: [8.2, y] as [number, number], thicknessM: .005, baseZ: 0, heightM: .05, materialId: 'partition' }
    }))
    const before = structuredClone(capped)
    try {
      applySceneCommand(capped, { type: 'split-wall', wallId: 'hall-partition', offsetM: 3 })
      throw new Error('Expected the expanded wall cap to reject the split')
    } catch (error) {
      expect(error).toBeInstanceOf(SceneCommandError)
      expect((error as SceneCommandError).message).toMatch(/256.*wall/i)
    }
    expect(capped).toEqual(before)
  })

  it('rejects an opt-in junction through an opening as one immutable command', () => {
    const scene = createDemoScene()
    const before = structuredClone(scene)
    expect(() => applySceneCommand(scene, { type: 'add-wall', wall: { ...crossingWall('doorway-cut'), start: [7, 2], end: [7, 8] }, joinIntersections: true }))
      .toThrow(/opening/i)
    expect(scene).toEqual(before)
  })

  it('splits reversed diagonal additions at every interior crossing in one revision', () => {
    const scene = createDemoScene()
    scene.openings = []
    scene.walls.push(
      { id: 'lower-crossbar', levelId: 'main', start: [2, 3.5], end: [12, 3.5], thicknessM: .1, baseZ: 0, heightM: 2.7, materialId: 'partition' },
      { id: 'upper-crossbar', levelId: 'main', start: [2, 6.5], end: [12, 6.5], thicknessM: .1, baseZ: 0, heightM: 2.7, materialId: 'partition' },
    )
    const original = structuredClone(scene)
    const joined = applySceneCommand(scene, {
      type: 'add-wall', joinIntersections: true,
      wall: { id: 'diagonal', levelId: 'main', start: [12, 8], end: [2, 2], thicknessM: .1, baseZ: 0, heightM: 2.7, materialId: 'partition' },
    })
    expect(joined.revision).toBe(scene.revision + 1)
    expect(joined.walls.filter(wall => wall.id.startsWith('lower-crossbar'))).toHaveLength(2)
    expect(joined.walls.filter(wall => wall.id.startsWith('upper-crossbar'))).toHaveLength(2)
    expect(joined.walls.filter(wall => wall.id.startsWith('hall-partition'))).toHaveLength(2)
    expect(joined.walls.filter(wall => wall.id.startsWith('diagonal'))).toHaveLength(4)
    expect(scene).toEqual(original)
    expectValid(joined)
  })

  it('preserves acoustic and radio results for rays through an opening and across the split point', () => {
    const scene = createDemoScene()
    scene.emitters[0]!.position = [2, 2, 1.2]
    scene.emitters[1]!.position = [2, 2, 1.2]
    const split = applySceneCommand(scene, { type: 'split-wall', wallId: 'hall-partition', offsetM: 3 })
    for (const [domain, settings] of [['acoustics', defaultSettings('acoustics')], ['radio', defaultSettings('radio')]] as const) {
      for (const [point, expectedOpeningId] of [
        [[6, 8, 1.2], undefined], // Hits the split point at (4, 5).
        [[10, 6.8, 1.2], 'hall-door'], // Crosses the unchanged doorway span.
      ] as [[number, number, number], string | undefined][]) {
        const before = evaluatePoint(scene, settings, point)
        const after = evaluatePoint(split, settings, point)
        expect(before.valid && after.valid, domain).toBe(true)
        expect(before.crossings).toHaveLength(1)
        expect(after.crossings).toHaveLength(1)
        expect(before.crossings[0]!.openingId).toBe(expectedOpeningId)
        expect(after.crossings[0]!.openingId).toBe(expectedOpeningId)
        expect(after.value).toBeCloseTo(before.value!, 10)
        expect(after.crossings).toHaveLength(before.crossings.length)
        expect(after.crossings.map(hit => hit.openingId)).toEqual(before.crossings.map(hit => hit.openingId))
      }
    }
  })

  it('rejects invalid, too-near, exterior, and opening-interior split offsets without changing history input', () => {
    const scene = createDemoScene()
    const before = structuredClone(scene)
    const rejected: Array<[string, number]> = [
      ['hall-partition', Number.NaN], ['hall-partition', -1], ['hall-partition', 0],
      ['hall-partition', 0.05], ['hall-partition', 5.88], ['hall-partition', 6.5], ['hall-partition', 7.2],
      ['north', 7], ['missing-wall', 2],
    ]
    for (const [wallId, offsetM] of rejected) {
      let didThrow = false
      try { applySceneCommand(scene, { type: 'split-wall', wallId, offsetM }) } catch (error) {
        didThrow = true
        expect(error).toBeInstanceOf(SceneCommandError)
      }
      expect(didThrow, `${wallId}@${offsetM}`).toBe(true)
      expect(scene).toEqual(before)
    }
  })

  it('rejects overlapping collinear additions', () => {
    const scene = createDemoScene()
    const overlap = { ...crossingWall('overlap'), start: [3, 5] as [number, number], end: [9, 5] as [number, number] }
    expect(() => applySceneCommand(scene, { type: 'add-wall', wall: overlap, joinIntersections: true })).toThrow(/overlap|cross/i)
  })
})
