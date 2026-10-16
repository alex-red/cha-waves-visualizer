import { describe, expect, it } from 'vitest'
import { applySceneCommand } from './commands'
import { computeField, defaultSettings, evaluatePoint, isExteriorEnvelopeWall, parseScene, validateWallGeometry } from './engine'
import { createHomeScene, createHomeScenarios, HOME_SCENARIO_INTERVENTIONS } from './scenarios'

describe('authored home scenario', () => {
  it('parses with four useful rooms, valid doors, and a complete exterior envelope', () => {
    const scene = createHomeScene()
    expect(parseScene(scene)).toEqual(scene)
    expect(scene.zones.map(zone => zone.name)).toEqual(['Living room', 'Kitchen', 'Bedroom', 'Study'])
    expect(scene.openings.every(opening => opening.kind === 'door' && !!opening.materialId)).toBe(true)
    expect(scene.walls.filter(wall => isExteriorEnvelopeWall(scene, wall))).toHaveLength(8)
    expect(validateWallGeometry(scene)).toEqual({ valid: true })
  })

  it('produces finite fields and valid probe readings for both guided models', async () => {
    for (const scenario of createHomeScenarios()) {
      for (const state of [scenario, ...scenario.interventions]) {
        for (const probe of state.scene.probes) {
          const reading = evaluatePoint(state.scene, state.settings, probe.position)
          expect(reading.valid).toBe(true)
          expect(Number.isFinite(reading.value)).toBe(true)
        }
        const field = await computeField(state.scene, state.settings, { step: 0.5, receiverZ: 1.5 })
        expect(field.grid.cols * field.grid.rows).toBe(432)
        expect([...field.validity].filter(value => value === 1).length).toBeGreaterThan(300)
        for (let i = 0; i < field.values.length; i++) {
          if (field.validity[i] === 1) expect(Number.isFinite(field.values[i])).toBe(true)
        }
      }
    }
  })

  it('keeps createDemoScene out of the authored fixture API and exports guided actions', () => {
    expect(HOME_SCENARIO_INTERVENTIONS.map(item => item.id)).toEqual([
      'open-bedroom-door', 'move-access-point', 'change-radio-frequency', 'open-study-door-control',
    ])
    expect(createHomeScenarios().map(scenario => scenario.settings.mode)).toEqual(['acoustics', 'radio'])
  })

  it('shows a numeric sound improvement from opening the door and no change in the negative control', () => {
    const baseline = createHomeScene()
    const point: [number, number, number] = [4, 7, 1.2]
    const settings = { ...defaultSettings('acoustics'), frequencyHz: 1000 }
    const baselineReading = evaluatePoint(baseline, settings, point)
    const doorOpen = applySceneCommand(baseline, { type: 'set-door-state', openingId: 'bedroom-door', isOpen: true })
    const openReading = evaluatePoint(doorOpen, settings, point)
    const control = applySceneCommand(baseline, { type: 'set-door-state', openingId: 'study-door', isOpen: true })
    const controlReading = evaluatePoint(control, settings, point)

    expect(baselineReading.valid && openReading.valid && controlReading.valid).toBe(true)
    expect(openReading.value! - baselineReading.value!).toBeCloseTo(7, 8)
    expect(controlReading.value).toBe(baselineReading.value)
  })

  it('uses complete RF bands to show numeric placement and frequency effects at a fixed probe', () => {
    const scenarios = createHomeScenarios()
    const radio = scenarios.find(scenario => scenario.id === 'home-radio')!
    const point = radio.scene.probes[0]!.position
    const baseline = evaluatePoint(radio.scene, radio.settings, point)
    const moved = evaluatePoint(radio.interventions.find(item => item.id === 'move-access-point')!.scene, radio.settings, point)
    const fiveG = evaluatePoint(radio.scene, radio.interventions.find(item => item.id === 'change-radio-frequency')!.settings, point)

    expect(baseline.valid && moved.valid && fiveG.valid).toBe(true)
    expect(moved.value).toBeGreaterThan(baseline.value!)
    expect(fiveG.value).toBeLessThan(baseline.value!)
  })
})
