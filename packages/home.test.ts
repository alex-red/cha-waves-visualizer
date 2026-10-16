import { describe, expect, it } from 'vitest'
import { createHomeScene } from './home'
import { defaultSettings, evaluatePoint, parseScene, validatePlacement, validateWallGeometry } from './engine'
import { createProject, parseProject, serializeProject } from './project'

describe('editable home factory', () => {
  it('creates a rectangular home with an envelope, illustrative materials, and clear starting placements', () => {
    const scene = createHomeScene({ name: 'Starter home', widthM: 8, depthM: 6, ceilingHeightM: 2.8 })
    expect(scene.id).toBe('starter-home')
    expect(scene.levels[0]!.boundary).toEqual([[0, 0], [8, 0], [8, 6], [0, 6]])
    expect(scene.walls).toHaveLength(4)
    expect(scene.emitters.map(emitter => emitter.domain)).toEqual(['acoustics', 'radio'])
    expect(Math.hypot(scene.emitters[0]!.position[0] - scene.probes[0]!.position[0], scene.emitters[0]!.position[1] - scene.probes[0]!.position[1])).toBeGreaterThanOrEqual(1)
    for (const entity of [...scene.emitters, ...scene.probes]) expect(validatePlacement(scene, entity.position, entity.levelId)).toEqual({ valid: true })
    expect(validateWallGeometry(scene)).toEqual({ valid: true })
    expect(evaluatePoint(scene, defaultSettings('acoustics'), scene.probes[0]!.position).valid).toBe(true)
  })

  it('uses a supplied boundary and interior walls, then round-trips as a project', () => {
    const scene = createHomeScene({
      name: 'Custom', widthM: 9, depthM: 7, ceilingHeightM: 2.6,
      boundary: [[0, 0], [9, 0], [9, 7], [5, 7], [0, 7]],
      interiorWalls: [{ id: 'partition', start: [4, 1], end: [4, 6], thicknessM: 0.12 }],
    })
    expect(scene.walls.some(wall => wall.id === 'partition')).toBe(true)
    const project = parseProject(serializeProject(createProject(scene, defaultSettings('acoustics'))))
    expect(project.scene).toEqual(scene)
    expect(parseScene(project.scene)).toEqual(scene)
  })

  it('rejects impossible size values and invalid wall layouts', () => {
    expect(() => createHomeScene({ widthM: 0, depthM: 5, ceilingHeightM: 2.5 })).toThrow(/positive finite/i)
    expect(() => createHomeScene({ widthM: 8, depthM: 6, ceilingHeightM: 2.5, interiorWalls: [
      { id: 'cross-a', start: [2, 1], end: [6, 5] },
      { id: 'cross-b', start: [2, 5], end: [6, 1] },
    ] })).toThrow(/invalid|cross|collid/i)
  })
})
