import { describe, expect, it } from 'vitest'
import { applySceneCommand, SceneCommandError } from './commands'
import { createDemoScene, defaultSettings, evaluatePoint, parseScene, validatePlacement, validateWallGeometry } from './engine'
import { createProject, serializeProject, parseProject } from './project'

describe('validated scene commands', () => {
  it('returns a new revision without mutating the source scene', () => {
    const scene = createDemoScene()
    const before = structuredClone(scene)
    const changed = applySceneCommand(scene, { type: 'move-probe', probeId: 'hallway-probe', position: [11, 2.5, 1.5] })
    expect(changed).not.toBe(scene)
    expect(changed.revision).toBe(scene.revision + 1)
    expect(changed.probes[0]!.position).toEqual([11, 2.5, 1.5])
    expect(scene).toEqual(before)

    // The new history entry owns its nested coordinates too.
    changed.probes[0]!.position[0] = 99
    expect(scene.probes[0]!.position).toEqual(before.probes[0]!.position)
  })

  it('moves probes through the numerical path and updates direct distance', () => {
    const scene = createDemoScene()
    scene.walls = []
    scene.openings = []
    scene.emitters[0]!.position = [1, 1, 1.2]

    const changed = applySceneCommand(scene, {
      type: 'move-probe', probeId: 'hallway-probe', position: [3, 1, 1.2],
    })
    const result = evaluatePoint(changed, defaultSettings('acoustics'), changed.probes[0]!.position)

    expect(result.valid).toBe(true)
    expect(result.value).toBeCloseTo(-6.020599913, 8)
    expect(scene.probes[0]!.position).not.toEqual(changed.probes[0]!.position)
  })

  it('renames probes with trimmed names from 1 to 80 characters without mutating rejected scenes', () => {
    const scene = createDemoScene()
    const before = structuredClone(scene)
    const renamed = applySceneCommand(scene, { type: 'rename-probe', probeId: 'hallway-probe', name: '  Loading dock  ' })

    expect(renamed.probes[0]!.name).toBe('Loading dock')
    expect(renamed.revision).toBe(scene.revision + 1)
    expect(scene).toEqual(before)

    const longest = applySceneCommand(scene, { type: 'rename-probe', probeId: 'hallway-probe', name: 'x'.repeat(80) })
    expect(longest.probes[0]!.name).toHaveLength(80)
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      expect(() => applySceneCommand(scene, { type: 'rename-probe', probeId: 'hallway-probe', name })).toThrowError(/probe name must contain 1 to 80 characters/i)
      expect(scene).toEqual(before)
    }
  })

  it('updates direct distance and wall/opening crossings when an emitter moves', () => {
    const scene = createDemoScene()
    const settings = defaultSettings('acoustics')
    const probe = scene.probes[0]!.position
    const before = evaluatePoint(scene, settings, probe)
    expect(before.crossings.map(crossing => crossing.openingId)).toEqual(['hall-door'])

    const changed = applySceneCommand(scene, {
      type: 'move-emitter', emitterId: 'speaker', position: [11, 2.5, 1.2],
    })
    const after = evaluatePoint(changed, settings, probe)

    expect(after.valid).toBe(true)
    expect(after.crossings).toHaveLength(0)
    expect(after.value).toBeGreaterThan(before.value!)
  })

  it('rejects emitter and probe moves beyond floor or ceiling bounds', () => {
    const scene = createDemoScene()
    expect(() => applySceneCommand(scene, {
      type: 'move-emitter', emitterId: 'speaker', position: [2, 7.8, -0.1],
    })).toThrowError(/outside-floor/i)
    expect(() => applySceneCommand(scene, {
      type: 'move-probe', probeId: 'hallway-probe', position: [12, 2.5, 2.8],
    })).toThrowError(/outside-floor/i)
  })

  it('uses absolute heights for placement on a level with a nonzero floor', () => {
    const scene = createDemoScene()
    scene.levels[0]!.floorZ = 10
    for (const wall of scene.walls) wall.baseZ += 10
    for (const emitter of scene.emitters) emitter.position[2] += 10
    for (const probe of scene.probes) probe.position[2] += 10

    const changed = applySceneCommand(scene, {
      type: 'move-probe', probeId: 'hallway-probe', position: [11, 2.5, 11.5],
    })
    expect(changed.probes[0]!.position).toEqual([11, 2.5, 11.5])
    expect(() => applySceneCommand(changed, {
      type: 'move-probe', probeId: 'hallway-probe', position: [11, 2.5, 9.9],
    })).toThrowError(/outside-floor/i)
  })

  it('checks wall solids in 3D and permits points above a low wall', () => {
    const scene = createDemoScene()
    scene.openings = []
    scene.walls.find(wall => wall.id === 'hall-partition')!.heightM = 0.8

    expect(() => applySceneCommand(scene, {
      type: 'move-emitter', emitterId: 'speaker', position: [2, 5, 0.5],
    })).toThrowError(/inside-solid/i)
    const changed = applySceneCommand(scene, {
      type: 'move-emitter', emitterId: 'speaker', position: [2, 5, 1],
    })
    expect(changed.emitters.find(emitter => emitter.id === 'speaker')!.position).toEqual([2, 5, 1])
  })

  it('preserves relative doorway spans when resizing a wall', () => {
    const scene = createDemoScene()
    const openingBefore = structuredClone(scene.openings[0])
    const changed = applySceneCommand(scene, { type: 'update-wall', wallId: 'hall-partition', start: [1, 5.2], end: [13, 5.2] })
    expect(changed.openings[0]).toEqual(openingBefore)
    expect(scene.openings[0]).toEqual(openingBefore)
  })

  it('rejects exterior edits and disconnecting a shared endpoint', () => {
    const scene = createDemoScene()
    expect(() => applySceneCommand(scene, { type: 'update-wall', wallId: 'north', start: [0, 9.9] }))
      .toThrowError(/exterior envelope wall north is read-only/i)
    scene.walls.push({ id: 'return', levelId: 'main', start: [1, 5], end: [1, 2], thicknessM: 0.1, baseZ: 0, heightM: 2.7, materialId: 'partition' })
    expect(() => applySceneCommand(scene, { type: 'update-wall', wallId: 'hall-partition', start: [1.2, 5] }))
      .toThrowError(/shared endpoint/i)
  })

  it('rejects unsupported wall intersections and solid overlap', () => {
    const scene = createDemoScene()
    expect(() => applySceneCommand(scene, { type: 'update-wall', wallId: 'hall-partition', end: [13, 10] }))
      .toThrowError(/crosses or overlaps/i)
    expect(() => applySceneCommand(scene, { type: 'update-wall', wallId: 'hall-partition', thicknessM: 11 }))
      .toThrowError(/thickness extends outside/i)
  })

  it('rejects moving an emitter into a wall solid and exposes the same placement result to UI', () => {
    const scene = createDemoScene()
    expect(validatePlacement(scene, [2, 5, 1.2], 'main')).toEqual({ valid: false, reason: 'inside-solid' })
    expect(() => applySceneCommand(scene, { type: 'move-emitter', emitterId: 'speaker', position: [2, 5, 1.2] }))
      .toThrowError(/inside-solid/i)
    expect(() => applySceneCommand(scene, { type: 'update-wall', wallId: 'hall-partition', start: [1, 7.8], end: [13, 7.8] }))
      .toThrowError(/would obstruct emitter speaker/i)
  })

  it('allows placement inside a valid open doorway aperture', () => {
    const scene = createDemoScene()
    const opened = applySceneCommand(scene, { type: 'set-door-state', openingId: 'hall-door', isOpen: true })
    expect(validatePlacement(opened, [7.5, 5, 1], 'main')).toEqual({ valid: true })
  })

  it('changes acoustic and radio results when a wall material changes', () => {
    const scene = createDemoScene()
    const point: [number, number, number] = [3, 2.5, 1.2]
    const acousticBefore = evaluatePoint(scene, defaultSettings('acoustics'), point)
    const radioBefore = evaluatePoint(scene, defaultSettings('radio'), point)
    const changed = applySceneCommand(scene, { type: 'change-wall-material', wallId: 'hall-partition', materialId: 'masonry' })
    const acousticAfter = evaluatePoint(changed, defaultSettings('acoustics'), point)
    const radioAfter = evaluatePoint(changed, defaultSettings('radio'), point)
    expect(acousticBefore.valid && acousticAfter.valid).toBe(true)
    expect(radioBefore.valid && radioAfter.valid).toBe(true)
    expect(acousticAfter.value).toBeLessThan(acousticBefore.value!)
    expect(radioAfter.value).toBeLessThan(radioBefore.value!)
  })

  it('throws a typed error for non-door open state edits', () => {
    const scene = createDemoScene()
    scene.openings[0]!.kind = 'passage'
    try {
      applySceneCommand(scene, { type: 'set-door-state', openingId: 'hall-door', isOpen: true })
      throw new Error('Expected command rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(SceneCommandError)
      expect((error as SceneCommandError).code).toBe('INVALID_COMMAND')
    }
  })
})


describe('geometry and state transitions remain persistable', () => {
  it('rejects closing a door around a source inside its aperture', () => {
    const scene = createDemoScene()
    scene.openings[0]!.isOpen = true
    scene.emitters[0]!.position = [7.5, 5, 1.2]
    expect(() => applySceneCommand(scene, { type: 'set-door-state', openingId: 'hall-door', isOpen: false })).toThrow(/obstruct speaker/)
    expect(scene.openings[0]!.isOpen).toBe(true)
  })

  it('rejects a wall crossing a concave floor notch despite all four corners being inside', () => {
    const scene = createDemoScene()
    scene.levels[0]!.boundary = [[0,0],[10,0],[10,10],[7,10],[7,3],[3,3],[3,10],[0,10]]
    scene.emitters.forEach(emitter => { emitter.position = [1,1,1.2] })
    scene.probes[0]!.position = [2,2,1.5]
    scene.openings = []
    scene.walls = [{ id: 'notch-crossing', levelId:'main', start:[1,6], end:[9,6], thicknessM:0.1, baseZ:0, heightM:2.7, materialId:'partition' }]
    expect(validateWallGeometry(scene)).toMatchObject({ valid:false, reason: expect.stringContaining('crosses the level boundary') })
  })

  it('adds a snapped connected wall, creates a door using metre offsets, and cascades wall deletion', () => {
    const scene = createDemoScene()
    const withWall = applySceneCommand(scene, { type: 'add-wall', wall: {
      id: 'return-wall', levelId: 'main', start: [1.04, 5.02], end: [1, 2.5], thicknessM: 0.1, baseZ: 0, heightM: 2.7, materialId: 'partition',
    } })
    expect(withWall.walls.find(wall => wall.id === 'return-wall')!.start).toEqual([1, 5])
    const withDoor = applySceneCommand(withWall, { type: 'add-door', openingId: 'return-door', wallId: 'return-wall', offsetM: 0.4, widthM: 0.8 })
    expect(withDoor.openings.find(opening => opening.id === 'return-door')!.fromT).toBeCloseTo(0.4 / 2.5)
    expect(withDoor.openings.find(opening => opening.id === 'return-door')!.toT).toBeCloseTo(1.2 / 2.5)
    expect(withDoor.openings.find(opening => opening.id === 'return-door')!.materialId).toBe('door-leaf')
    const removed = applySceneCommand(withDoor, { type: 'remove-wall', wallId: 'return-wall' })
    expect(removed.walls.some(wall => wall.id === 'return-wall')).toBe(false)
    expect(removed.openings.some(opening => opening.id === 'return-door')).toBe(false)
    expect(serializeProject(createProject(removed, defaultSettings('acoustics')))).toBeTruthy()
  })

  it('moves a connected junction atomically and rejects unsupported intersections', () => {
    const scene = createDemoScene()
    scene.walls.push({ id: 'return-wall', levelId: 'main', start: [1, 5], end: [1, 2.5], thicknessM: 0.1, baseZ: 0, heightM: 2.7, materialId: 'partition' })
    const moved = applySceneCommand(scene, { type: 'move-connected-endpoint', levelId: 'main', from: [1, 5], to: [1.2, 5] })
    expect(moved.walls.find(wall => wall.id === 'hall-partition')!.start).toEqual([1.2, 5])
    expect(moved.walls.find(wall => wall.id === 'return-wall')!.start).toEqual([1.2, 5])
    expect(() => applySceneCommand(moved, { type: 'add-wall', wall: {
      id: 'crossing-wall', levelId: 'main', start: [7, 2], end: [7, 8], thicknessM: 0.1, baseZ: 0, heightM: 2.7, materialId: 'partition',
    } })).toThrowError(/crosses or overlaps/i)
  })

  it('updates and removes openings and preserves at least one probe', () => {
    const scene = createDemoScene()
    const updated = applySceneCommand(scene, { type: 'update-opening', openingId: 'hall-door', offsetM: 3, widthM: 1, heightM: 2 })
    expect(updated.openings[0]).toMatchObject({ fromT: 3 / 12, toT: 4 / 12, heightM: 2 })
    expect(applySceneCommand(updated, { type: 'remove-opening', openingId: 'hall-door' }).openings).toHaveLength(0)
    const extraProbe = applySceneCommand(scene, { type: 'add-probe', probe: { id: 'extra', levelId: 'main', position: [10, 2, 1.2] } })
    expect(applySceneCommand(extraProbe, { type: 'remove-probe', probeId: 'extra' }).probes).toHaveLength(1)
    expect(() => applySceneCommand(scene, { type: 'remove-probe', probeId: 'hallway-probe' })).toThrowError(/at least one probe/i)
    expect(parseScene(updated)).toEqual(updated)
  })
})

describe('atomic wall properties', () => {
  it('changes thickness and material together in one revision, preserving inputs on rejection', () => {
    const original = createDemoScene()
    const changed = applySceneCommand(original, { type: 'update-wall', wallId: 'hall-partition', thicknessM: .17, materialId: 'masonry' })
    expect(changed.revision).toBe(original.revision + 1)
    expect(changed.walls.find(wall => wall.id === 'hall-partition')).toMatchObject({ thicknessM: .17, materialId: 'masonry' })
    expect(() => applySceneCommand(original, { type: 'update-wall', wallId: 'hall-partition', thicknessM: .17, materialId: 'missing-material' })).toThrow()
    expect(original.walls.find(wall => wall.id === 'hall-partition')?.thicknessM).not.toBe(.17)
  })
})
