import { describe, expect, it } from 'vitest'
import { applySceneCommand } from './commands'
import { computeField, createDemoScene, defaultSettings, evaluatePoint } from './engine'

describe('vertical coordinates and field sampling', () => {
  it('preserves field values when the entire building and receiver plane translate vertically', async () => {
    const original = createDemoScene()
    const elevated = structuredClone(original)
    const offset = 3
    elevated.levels[0]!.floorZ += offset
    elevated.walls.forEach(wall => { wall.baseZ += offset })
    elevated.emitters.forEach(emitter => { emitter.position[2] += offset })
    elevated.probes.forEach(probe => { probe.position[2] += offset })
    for (const domain of ['acoustics', 'radio'] as const) {
      const settings = defaultSettings(domain)
      const a = await computeField(original, settings, { step: 0.5, receiverZ: 1.5 })
      const b = await computeField(elevated, settings, { step: 0.5, receiverZ: offset + 1.5 })
      expect(b.grid.receiverZM - a.grid.receiverZM).toBe(offset)
      expect(b.validity).toEqual(a.validity)
      for (let index = 0; index < a.values.length; index++) {
        if (a.validity[index] === 1) expect(b.values[index]).toBeCloseTo(a.values[index]!, 5)
      }
      expect(b.identity.queryHash).not.toBe(a.identity.queryHash)
    }
  })

  it('crosses the wall above an open door when both endpoints rise past the door head', () => {
    let low = createDemoScene()
    low = applySceneCommand(low, { type: 'set-door-state', openingId: 'hall-door', isOpen: true })
    low = applySceneCommand(low, { type: 'move-probe', probeId: 'hallway-probe', position: [12, 2.5, 1.2] })
    let high = applySceneCommand(low, { type: 'move-probe', probeId: 'hallway-probe', position: [12, 2.5, 2.4] })
    for (const emitter of low.emitters) {
      high = applySceneCommand(high, { type: 'move-emitter', emitterId: emitter.id, position: [emitter.position[0], emitter.position[1], 2.4] })
    }
    for (const [domain, wallLoss] of [['acoustics', 8], ['radio', 3]] as const) {
      const settings = defaultSettings(domain)
      const a = evaluatePoint(low, settings, low.probes[0]!.position)
      const b = evaluatePoint(high, settings, high.probes[0]!.position)
      expect(a.valid && b.valid).toBe(true)
      expect(b.distanceM).toBeCloseTo(a.distanceM, 10)
      expect(a.value! - b.value!).toBeCloseTo(wallLoss, 8)
      expect(b.crossings).toEqual([expect.objectContaining({ wallId: 'hall-partition', materialId: 'partition', lossDb: wallLoss })])
    }
  })
})
