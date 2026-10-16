import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings, SOLVER_VERSION } from './engine'
import { createProject, parseProject, serializeProject } from './project'
import { validateSurvey, type RfSurvey } from './survey'

const createdAt = '2026-10-15T12:00:00.000Z'

function survey(scene = createDemoScene()): RfSurvey {
  const settings = defaultSettings('radio')
  const source = scene.emitters.find(emitter => emitter.domain === 'radio')!
  return validateSurvey({
    id: 'walk-1', name: 'Office walk', notes: 'West wing', createdAt,
    context: {
      sceneId: scene.id, levelId: source.levelId, frequencyHz: settings.frequencyHz,
      sourceId: source.id, sourcePosition: [...source.position], eirpDbm: source.eirpDbm,
    },
    observations: [{ id: 'reading-1', label: 'Kitchen', position: [3, 7, 1.5], rssiDbm: -48 }],
  })
}

function v2ProjectWithExperiments() {
  const scene = createDemoScene()
  const settings = defaultSettings('radio')
  const baselineScene = structuredClone(scene)
  baselineScene.revision = 4
  const now = createdAt
  const baselineSettings = { ...settings, frequencyHz: 5e9 }
  const referenceImage = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', pixelWidth: 1, pixelHeight: 1, widthM: 1, heightM: 1, originXY: [0, 0] as [number, number], opacity: 0.5 }
  const experiment = {
    id: 'survey-baseline', name: 'Baseline', notes: 'Saved reference', createdAt: now, updatedAt: now,
    scene: baselineScene, settings: baselineSettings, solverVersion: SOLVER_VERSION,
    referenceImage,
  }
  const document = createProject(scene, settings, { scene: baselineScene, settings: baselineSettings }, referenceImage, {
    experiments: [experiment], baselineExperimentId: experiment.id,
  })
  const legacy = { ...document, formatVersion: 2 }
  delete (legacy as { survey?: RfSurvey }).survey
  return { legacy, scene, settings, baselineScene, baselineSettings, referenceImage, experiment }
}

describe('RF survey project persistence', () => {
  it('migrates strict v1 and v2 projects to format 3 without inventing a survey', () => {
    const scene = createDemoScene()
    const project = createProject(scene, defaultSettings('radio'))
    const v1 = {
      format: project.format, formatVersion: 1, solverVersion: project.solverVersion,
      metadata: project.metadata, scene: project.scene, settings: project.settings,
    }
    const migratedV1 = parseProject(JSON.stringify(v1))
    expect(migratedV1.formatVersion).toBe(3)
    expect(migratedV1.survey).toBeUndefined()
    expect(migratedV1.scene).toEqual(scene)
    expect(migratedV1.experiments).toEqual([])

    const { legacy } = v2ProjectWithExperiments()
    const migratedV2 = parseProject(JSON.stringify(legacy))
    expect(migratedV2.formatVersion).toBe(3)
    expect(migratedV2.survey).toBeUndefined()
  })

  it('preserves v2 named baseline, reference image, experiment snapshots, and metadata', () => {
    const { legacy, baselineScene, baselineSettings, referenceImage, experiment } = v2ProjectWithExperiments()
    const migrated = parseProject(JSON.stringify(legacy))
    expect(migrated.baselineExperimentId).toBe('survey-baseline')
    expect(migrated.baseline?.scene).toEqual(baselineScene)
    expect(migrated.baseline?.settings).toEqual(baselineSettings)
    expect(migrated.referenceImage).toEqual(referenceImage)
    expect(migrated.experiments).toHaveLength(1)
    expect(migrated.experiments[0]).toMatchObject(experiment)
  })

  it('round trips an immutable raw survey without storing derived predictions', () => {
    const scene = createDemoScene()
    const raw = survey(scene)
    const document = createProject(scene, defaultSettings('radio'), undefined, undefined, { survey: raw })
    const restored = parseProject(serializeProject(document))
    expect(restored.survey).toEqual(raw)
    expect(Object.isFrozen(restored.survey)).toBe(true)
    expect(Object.isFrozen(restored.survey?.context.sourcePosition)).toBe(true)
    expect(Object.isFrozen(restored.survey?.observations[0]?.position)).toBe(true)
    expect(restored.survey?.observations[0]).not.toHaveProperty('predictedDbm')
    expect(restored.survey?.observations[0]).not.toHaveProperty('residualDb')
  })

  it.each([
    ['duplicate observation IDs', (value: RfSurvey) => { value.observations.push({ ...value.observations[0]!, label: 'Second' }) }],
    ['non-finite measurements', (value: RfSurvey) => { value.observations[0]!.rssiDbm = Number.NaN }],
    ['derived prediction fields', (value: RfSurvey) => { Object.assign(value.observations[0]!, { predictedDbm: -42, residualDb: 6 }) }],
  ])('rejects %s without mutating the supplied document', (_description, invalidate) => {
    const scene = createDemoScene()
    const invalidSurvey = structuredClone(survey(scene))
    invalidate(invalidSurvey)
    const project = createProject(scene, defaultSettings('radio'))
    const candidate = { ...project, survey: invalidSurvey }
    const before = structuredClone(candidate)
    expect(() => parseProject(JSON.stringify(candidate))).toThrowError(expect.objectContaining({ code: 'INVALID_PROJECT' }))
    expect(candidate).toEqual(before)
  })

  it('enforces the five MiB project limit when a survey makes the payload too large', () => {
    const scene = createDemoScene()
    const document = createProject(scene, defaultSettings('radio'), undefined, undefined, { survey: survey(scene) })
    const validText = serializeProject(document)
    expect(validText).toContain('"survey"')
    expect(() => parseProject(`${validText}${' '.repeat(5 * 1024 * 1024)}`)).toThrowError(expect.objectContaining({ code: 'PROJECT_TOO_LARGE' }))
  })
})
