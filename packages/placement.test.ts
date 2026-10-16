import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings, evaluatePoint, validatePlacement, type Domain } from './engine'
import { searchPlacements, type PlacementObjective } from './placement'

function fixture(domain: Domain = 'acoustics') {
  const scene = createDemoScene()
  const source = scene.emitters.find(emitter => emitter.domain === domain)!
  scene.emitters = scene.emitters.map(emitter => emitter.domain === domain ? { ...emitter, active: true } : { ...emitter, active: false })
  return { scene, source, settings: defaultSettings(domain) }
}

const options = (objective: PlacementObjective = 'maximize-weakest', maxCandidates = 32) => ({ probeIds: ['hallway-probe'], objective, maxCandidates })

describe('source placement search', () => {
  it.each(['acoustics', 'radio'] as const)('ranks %s candidates and agrees with direct point estimates', async domain => {
    const { scene, source, settings } = fixture(domain)
    const original = structuredClone(scene)
    const result = await searchPlacements(scene, settings, options('maximize-weakest', 20))
    expect(result.unit).toBe(domain === 'radio' ? 'dBm' : 'dB')
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every(candidate => candidate.readings.every(reading => reading.valid))).toBe(true)
    for (const candidate of result.candidates) {
      const moved = structuredClone(scene)
      moved.emitters.find(emitter => emitter.id === source.id)!.position = [...candidate.position]
      const estimate = evaluatePoint(moved, settings, scene.probes[0]!.position)
      expect(candidate.readings[0]!.value).toBeCloseTo(estimate.value!, 5)
      expect(candidate.score).toBeCloseTo(candidate.weakest, 7)
    }
    expect(scene).toEqual(original)
  })

  it('orders minimize-loudest upward from the weakest reading and does not worsen a valid baseline', async () => {
    const { scene, settings } = fixture()
    const maximize = await searchPlacements(scene, settings, options('maximize-weakest', 28))
    const minimize = await searchPlacements(scene, settings, options('minimize-loudest', 28))
    expect(maximize.candidates.every((candidate, i, list) => i === 0 || list[i - 1]!.score >= candidate.score)).toBe(true)
    expect(minimize.candidates.every((candidate, i, list) => i === 0 || list[i - 1]!.score <= candidate.score)).toBe(true)
    expect(maximize.baseline.score).not.toBeNull()
    expect(minimize.baseline.score).not.toBeNull()
    expect(maximize.candidates[0]!.score).toBeGreaterThanOrEqual(maximize.baseline.score!)
    expect(minimize.candidates[0]!.score).toBeLessThanOrEqual(minimize.baseline.score!)
  })

  it('scores every selected probe independently for both objectives and keeps sampling counts invariant', async () => {
    const { scene, source, settings } = fixture()
    scene.probes.push({ id: 'near-bedroom', levelId: 'main', position: [10, 2, 1.4], name: 'Bedroom receiver' })
    const original = structuredClone(scene)
    const selected = ['hallway-probe', 'near-bedroom']
    const maximize = await searchPlacements(scene, settings, { ...options('maximize-weakest', 36), probeIds: selected })
    const minimize = await searchPlacements(scene, settings, { ...options('minimize-loudest', 36), probeIds: selected })
    expect(maximize.sampledCount).toBe(minimize.sampledCount)
    expect(maximize.excludedPlacementCount).toBe(minimize.excludedPlacementCount)
    expect(maximize.excludedEstimateCount).toBe(minimize.excludedEstimateCount)
    expect(maximize.excludedEstimateCount).toBe(0)

    for (const [result, objective] of [[maximize, 'maximize-weakest'], [minimize, 'minimize-loudest']] as const) {
      expect(result.candidates.length).toBeGreaterThan(0)
      for (const candidate of result.candidates) {
        const moved = structuredClone(scene)
        moved.emitters.find(emitter => emitter.id === source.id)!.position = [...candidate.position]
        const independent = selected.map(id => {
          const probe = scene.probes.find(item => item.id === id)!
          return evaluatePoint(moved, settings, probe.position).value!
        })
        expect(candidate.readings.map(reading => reading.id)).toEqual(selected)
        expect(candidate.readings.map(reading => reading.value)).toEqual(independent)
        expect(candidate.score).toBeCloseTo(objective === 'maximize-weakest' ? Math.min(...independent) : Math.max(...independent), 7)
      }
    }
    expect(scene).toEqual(original)
  })

  it('excludes every candidate when one selected probe is consistently inside a solid', async () => {
    const { scene, settings } = fixture()
    scene.probes.push({ id: 'blocked', levelId: 'main', position: [6, 5.02, 1.5], name: 'Blocked receiver' })
    const result = await searchPlacements(scene, settings, { ...options(), probeIds: ['hallway-probe', 'blocked'] })
    expect(result.baseline.score).toBeNull()
    expect(result.baseline.readings.map(reading => reading.valid)).toEqual([true, false])
    expect(result.baseline.readings[1]!.reason).toBe('inside-solid')
    expect(result.candidates).toEqual([])
    expect(result.excludedEstimateCount).toBeGreaterThan(0)
    expect(result.validCount).toBe(0)
  })

  it('respects the candidate cap, preserves source height, and computes aspect-aware spacing', async () => {
    const { scene, source, settings } = fixture()
    scene.levels[0]!.boundary = [[0, 0], [30, 0], [30, 3], [0, 3]]
    scene.emitters.forEach(emitter => { emitter.position = [2, 1.5, emitter.position[2]] })
    scene.emitters.find(emitter => emitter.id === source.id)!.position = [2, 1.5, 1.7]
    const result = await searchPlacements(scene, settings, options('maximize-weakest', 17))
    expect(result.sampledCount).toBeLessThanOrEqual(17)
    expect(Math.max(...result.spacingM) / Math.min(...result.spacingM)).toBeGreaterThan(1.1)
    expect(result.candidates.every(candidate => candidate.position[2] === 1.7)).toBe(true)
  })

  it('fills a balanced two-dimensional grid for 143 prime candidate slots', async () => {
    const { scene, settings } = fixture()
    const result = await searchPlacements(scene, settings, options('maximize-weakest', 144))
    expect(result.sampledCount).toBeGreaterThanOrEqual(140)
    expect(result.sampledCount).toBeLessThanOrEqual(144)
    expect(Math.abs(Math.log(result.spacingM[0] / result.spacingM[1]))).toBeLessThan(0.25)
  })

  it('excludes placements within walls and outside a concave floor envelope', async () => {
    const { scene, settings } = fixture()
    scene.levels[0]!.boundary = [[0, 0], [14, 0], [14, 4], [5, 4], [5, 10], [0, 10]]
    const result = await searchPlacements(scene, settings, options('maximize-weakest', 40))
    expect(result.excludedPlacementCount).toBeGreaterThan(0)
    expect(result.candidates.every(candidate => candidate.position[0] <= 5 || candidate.position[1] <= 4)).toBe(true)
  })

  it('excludes probe estimates below the model minimum distance', async () => {
    const { scene, settings } = fixture()
    scene.probes[0]!.position = [...scene.emitters[0]!.position]
    const result = await searchPlacements(scene, { ...settings, minValidDistanceM: 3 }, options())
    expect(result.baseline.score).toBeNull()
    expect(result.excludedEstimateCount).toBeGreaterThan(0)
    expect(result.candidates.every(candidate => candidate.readings.every(reading => reading.valid))).toBe(true)
  })

  it('validates probe selection and candidate-count bounds', async () => {
    const { scene, settings } = fixture()
    await expect(searchPlacements(scene, settings, { ...options(), probeIds: [] })).rejects.toThrow()
    await expect(searchPlacements(scene, settings, { ...options(), probeIds: ['missing'] })).rejects.toThrow()
    await expect(searchPlacements(scene, settings, { ...options(), probeIds: ['hallway-probe', 'hallway-probe'] })).rejects.toThrow()
    await expect(searchPlacements(scene, settings, options('maximize-weakest', 1))).rejects.toThrow()
    await expect(searchPlacements(scene, settings, options('maximize-weakest', 257))).rejects.toThrow()
  })

  it('reports a missing or inactive source even when another domain emitter exists', async () => {
    const { scene, settings } = fixture()
    scene.emitters[0]!.active = false
    await expect(searchPlacements(scene, settings, options())).rejects.toThrow(/No active acoustics source/)
    scene.emitters = scene.emitters.filter(emitter => emitter.domain !== 'acoustics')
    await expect(searchPlacements(scene, settings, options())).rejects.toThrow(/No active acoustics source/)
  })

  it('validates settings even when the baseline and every sampled placement are inside a wall', async () => {
    const { scene, settings } = fixture()
    scene.emitters.find(emitter => emitter.domain === 'acoustics')!.position = [7, 5, 1.2]
    expect(validatePlacement(scene, [7, 5, 1.2]).valid).toBe(false)
    expect((await searchPlacements(scene, settings, options('maximize-weakest', 2))).validCount).toBe(0)
    const invalidSettings = { ...settings, frequencyHz: Number.NaN }
    await expect(searchPlacements(scene, invalidSettings, options('maximize-weakest', 2))).rejects.toThrow()
  })

  it('reports progress, supports cancellation, and repeats with stable rankings', async () => {
    const { scene, settings } = fixture()
    const progress: Array<[number, number]> = []
    const first = await searchPlacements(scene, settings, options('maximize-weakest', 35), { onProgress: (done, total) => progress.push([done, total]) })
    const second = await searchPlacements(scene, settings, options('maximize-weakest', 35))
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)![0]).toBe(progress.at(-1)![1])
    expect(first.candidates).toEqual(second.candidates)
    await expect(searchPlacements(scene, settings, options('maximize-weakest', 35), { cancelled: () => true })).rejects.toThrow(/cancelled/)
  })
})
