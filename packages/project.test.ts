import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings } from './engine'
import { createProject, parseProject, ProjectError, serializeProject, validateProjectExperiment } from './project'

describe('portable project documents', () => {
  it('round trips scene, active settings, and baseline with exact solver provenance', () => {
    const scene = createDemoScene()
    const settings = defaultSettings('radio')
    const baselineScene = createDemoScene()
    baselineScene.revision = 2
    const baselineSettings = defaultSettings('acoustics')
    const doc = createProject(scene, settings, { scene: baselineScene, settings: baselineSettings })
    const restored = parseProject(serializeProject(doc))

    expect(restored.format).toBe('cha-waves-project')
    expect(restored.formatVersion).toBe(3)
    expect(restored.solverVersion).toBe('1.0.0')
    expect(restored.scene).toEqual(scene)
    expect(restored.settings).toEqual(settings)
    expect(restored.baseline?.scene.revision).toBe(2)
    expect(restored.baseline?.settings).toEqual(baselineSettings)
    expect(restored.baseline?.solverVersion).toBe('1.0.0')
    expect(Object.keys(restored).some(key => key === 'values' || key === 'validity')).toBe(false)
  })

  it('copies and deeply freezes the baseline so later edits cannot change it', () => {
    const scene = createDemoScene()
    const baseline = createDemoScene()
    const settings = defaultSettings('acoustics')
    const baselineSettings = defaultSettings('acoustics')
    const doc = createProject(scene, settings, { scene: baseline, settings: baselineSettings })
    baseline.walls[0]!.start[0] = 99
    baselineSettings.frequencyHz = 500

    expect(doc.baseline?.scene.walls[0]?.start[0]).toBe(0)
    expect(doc.baseline?.settings.frequencyHz).toBe(1000)
    expect(Object.isFrozen(doc.baseline?.scene.walls[0]?.start)).toBe(true)
    expect(() => { (doc.baseline!.settings as { frequencyHz: number }).frequencyHz = 10 }).toThrow()
  })

  it('preserves a settings mismatch between the working project and its baseline', () => {
    const doc = createProject(createDemoScene(), defaultSettings('radio'), {
      scene: createDemoScene(), settings: { ...defaultSettings('radio'), frequencyHz: 5e9 },
    })
    const restored = parseProject(serializeProject(doc))
    expect(restored.settings.mode).toBe('radio')
    expect(restored.settings.frequencyHz).toBe(2.4e9)
    expect(restored.baseline?.settings.frequencyHz).toBe(5e9)
  })

  it('rejects unknown document and solver versions with their field paths', () => {
    const doc = createProject(createDemoScene(), defaultSettings('acoustics'))
    expect(() => parseProject(JSON.stringify({ ...doc, formatVersion: 999 }))).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION', path: ['formatVersion'] }))
    expect(() => parseProject(JSON.stringify({ ...doc, solverVersion: 'future' }))).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION', path: ['solverVersion'] }))
  })

  it('migrates strict v1 documents and preserves the active and baseline snapshots', () => {
    const scene = createDemoScene()
    const baselineScene = createDemoScene(); baselineScene.revision = 3
    const referenceImage = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', pixelWidth: 1, pixelHeight: 1, widthM: 1, heightM: 1, originXY: [0, 0] as [number, number], opacity: 0.5 }
    const v2 = createProject(scene, defaultSettings('radio'), { scene: baselineScene, settings: defaultSettings('acoustics') }, referenceImage)
    const v1 = { format: v2.format, formatVersion: 1, solverVersion: v2.solverVersion, metadata: v2.metadata, scene: v2.scene, settings: v2.settings, baseline: v2.baseline, referenceImage: v2.referenceImage }
    const restored = parseProject(JSON.stringify(v1))
    expect(restored.formatVersion).toBe(3)
    expect(restored.scene).toEqual(scene)
    expect(restored.baseline?.scene.revision).toBe(3)
    expect(restored.referenceImage).toEqual(referenceImage)
    expect(restored.experiments).toEqual([])
    expect(restored.baselineExperimentId).toBeUndefined()
    expect(() => parseProject(JSON.stringify({ ...v1, experiments: [] }))).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT' }))
  })

  it('defaults an omitted v2 experiment library to an empty array', () => {
    const doc = createProject(createDemoScene(), defaultSettings('acoustics'))
    const legacyShape = { ...doc, formatVersion: 2 } as Record<string, unknown>
    delete legacyShape.experiments
    expect(parseProject(JSON.stringify(legacyShape)).experiments).toEqual([])
  })

  it('round trips named experiments and deeply freezes copied snapshots', () => {
    const scene = createDemoScene()
    const now = new Date().toISOString()
    const experiment = { id: 'exp-1', name: 'Current', notes: 'control', createdAt: now, updatedAt: now, scene, settings: defaultSettings('acoustics'), solverVersion: '1.0.0' }
    const baselineScene = structuredClone(scene); baselineScene.revision = 2
    const baselineExperiment = { ...experiment, id: 'exp-base', name: 'Baseline', scene: baselineScene }
    const doc = createProject(scene, defaultSettings('acoustics'), { scene: baselineScene, settings: experiment.settings }, undefined, { experiments: [experiment, baselineExperiment], baselineExperimentId: 'exp-base' })
    scene.walls[0]!.start[0] = 42
    const restored = parseProject(serializeProject(doc))
    expect(restored.experiments[0]?.scene.walls[0]?.start[0]).toBe(0)
    expect(restored.baselineExperimentId).toBe('exp-base')
    expect(Object.isFrozen(restored.experiments[0]?.scene.walls[0]?.start)).toBe(true)
    expect(() => { (restored.experiments[0]!.settings as { frequencyHz: number }).frequencyHz = 4 }).toThrow()
  })

  it('validates standalone experiment snapshots and enforces library identity and baseline guards', () => {
    const now = new Date().toISOString()
    const base = { id: 'e1', name: 'Design A', notes: '', createdAt: now, updatedAt: now, scene: createDemoScene(), settings: defaultSettings('acoustics'), solverVersion: '1.0.0' }
    const snapshot = validateProjectExperiment(base)
    expect(Object.isFrozen(snapshot.scene)).toBe(true)
    const other = { ...base, id: 'e2', name: 'design a' }
    expect(() => createProject(createDemoScene(), defaultSettings('acoustics'), undefined, undefined, { experiments: [base, other] })).toThrowError(expect.objectContaining({ path: ['experiments', 1, 'name'] }))
    expect(() => createProject(createDemoScene(), defaultSettings('acoustics'), undefined, undefined, { experiments: [base], baselineExperimentId: 'missing' })).toThrowError(expect.objectContaining({ path: ['baselineExperimentId'] }))
    expect(() => validateProjectExperiment({ ...base, id: 'x'.repeat(129) })).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT' }))
    const invalidScene = structuredClone(base.scene); invalidScene.walls[0]!.end = [...invalidScene.walls[0]!.start]
    expect(() => validateProjectExperiment({ ...base, scene: invalidScene })).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT', path: ['scene', 'walls', 0] }))
  })

  it('rejects malformed geometry with a useful field path', () => {
    const doc = createProject(createDemoScene(), defaultSettings('acoustics'))
    const invalid = structuredClone(doc) as { scene: { walls: Array<{ start: number[]; end: number[] }> } }
    invalid.scene.walls[0]!.end = [...invalid.scene.walls[0]!.start]
    expect(() => parseProject(JSON.stringify(invalid))).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT', path: ['scene', 'walls', 0] }))
  })

  it('rejects oversized JSON, excessive nesting, and prototype keys', () => {
    expect(() => parseProject(' '.repeat(5 * 1024 * 1024 + 1))).toThrowError(expect.objectContaining({ code: 'PROJECT_TOO_LARGE' }))
    expect(() => parseProject(`"${'é'.repeat(2.5 * 1024 * 1024 + 1)}"`)).toThrowError(expect.objectContaining({ code: 'PROJECT_TOO_LARGE' }))
    const doc = createProject(createDemoScene(), defaultSettings('acoustics'))
    const deep = `${JSON.stringify(doc).slice(0, -1)},"extra":${'['.repeat(33)}0${']'.repeat(33)}}`
    expect(() => parseProject(deep)).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT' }))
    expect(() => parseProject('{"format":"cha-waves-project","__proto__":{"polluted":true}}')).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT', path: ['__proto__'] }))
  })

  it('rejects an emitter placed inside a wall solid', () => {
    const scene = createDemoScene()
    scene.emitters[0]!.position = [6, 5, 1.2]
    try {
      createProject(scene, defaultSettings('acoustics'))
      throw new Error('Expected invalid geometry to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectError)
      expect(error).toMatchObject({ code: 'INVALID_PROJECT', path: ['scene', 'emitters', 0, 'position'] })
    }
  })

  it('uses the engine placement rules for an open doorway', () => {
    const scene = createDemoScene()
    scene.openings[0]!.isOpen = true
    scene.emitters[0]!.position = [7.5, 5, 1.2]
    expect(() => createProject(scene, defaultSettings('acoustics'))).not.toThrow()

    scene.openings[0]!.isOpen = false
    expect(() => createProject(scene, defaultSettings('acoustics'))).toThrowError(expect.objectContaining({
      code: 'INVALID_PROJECT', path: ['scene', 'emitters', 0, 'position'],
    }))
  })

  it('caps large scene arrays before schema parsing', () => {
    const doc = createProject(createDemoScene(), defaultSettings('acoustics'))
    const tooManyEmitters = structuredClone(doc) as { scene: { emitters: unknown[] } }
    tooManyEmitters.scene.emitters = Array.from({ length: 65 }, () => ({ id: 'x' }))
    expect(() => parseProject(JSON.stringify(tooManyEmitters))).toThrowError(expect.objectContaining({
      code: 'INVALID_PROJECT', path: ['scene', 'emitters'],
    }))

    const tooManyVertices = structuredClone(doc) as { scene: { levels: Array<{ boundary: unknown[] }> } }
    tooManyVertices.scene.levels[0]!.boundary = Array.from({ length: 257 }, () => [0, 0])
    expect(() => parseProject(JSON.stringify(tooManyVertices))).toThrowError(expect.objectContaining({
      code: 'INVALID_PROJECT', path: ['scene', 'levels', 0, 'boundary'],
    }))
  })
})
