import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings, evaluatePoint, type Scene, type SolverSettings } from './engine'
import { exportProbeReadingsCsv, summarizeProbes } from './probes'

describe('summarizeProbes', () => {
  it('evaluates every probe at its exact coordinate and reports the physical quantity and unit', () => {
    const scene = createDemoScene()
    scene.probes.push({ id: 'second', levelId: 'main', position: [3, 1, 1.2], name: 'Near source' })

    const summary = summarizeProbes(scene, defaultSettings('acoustics'))

    expect(summary).toMatchObject({ domain: 'acoustics', frequencyHz: 1000, quantity: 'relative-direct-level-db', unit: 'dB' })
    expect(summary.readings).toHaveLength(2)
    expect(summary.readings[0]).toMatchObject({ id: 'hallway-probe', name: 'Across the hall', position: [12, 2.5, 1.5], domain: 'acoustics' })
    expect(summary.readings[0]!.result.valid).toBe(true)
    expect(summary.readings[1]!.result.distanceM).toBeCloseTo(Math.hypot(1, -6.8, 0))
    expect(summary.readings[1]!.result.value).toBeDefined()
  })

  it('preserves invalid solver results without turning a missing value into zero', () => {
    const scene = createDemoScene()
    scene.probes[0]!.position = [...scene.emitters[0]!.position]

    const reading = summarizeProbes(scene, defaultSettings('acoustics')).readings[0]!

    expect(reading.result).toMatchObject({ valid: false, reason: 'below-model-distance' })
    expect(reading.result.value).toBeUndefined()
  })

  it('compares the baseline at each current probe coordinate and disables deltas for mismatched settings', () => {
    const scene = createDemoScene()
    const baseline: Scene = structuredClone(scene)
    baseline.emitters.find(source => source.domain === 'radio')!.position = [3, 2, 1.2]
    const settings = defaultSettings('radio')

    const compared = summarizeProbes(scene, settings, { scene: baseline, settings }).readings[0]!
    const expectedDelta = compared.result.value! - (awaitlessRadioValue(baseline, settings, scene.probes[0]!.position))
    expect(compared.baseline?.delta).toBeCloseTo(expectedDelta)
    expect(compared.baseline?.value).toBeDefined()

    const incompatible = summarizeProbes(scene, settings, {
      scene: baseline,
      settings: { ...settings, frequencyHz: 5e9 },
    }).readings[0]!
    expect(incompatible.baseline?.delta).toBeUndefined()
    expect(incompatible.baseline?.reason).toMatch(/matching frequencies/)

    const settingsMismatch = summarizeProbes(scene, settings, {
      scene: baseline,
      settings: { ...settings, receiverGainDbi: 3 },
    }).readings[0]!
    expect(settingsMismatch.baseline?.delta).toBeUndefined()
    expect(settingsMismatch.baseline?.reason).toMatch(/receiverGainDbi/)
  })
})

// Keep the expected baseline value independent of the summary/comparison implementation.
function awaitlessRadioValue(scene: Scene, settings: SolverSettings, point: [number, number, number]): number {
  // Importing evaluatePoint here would duplicate the code under test only at the API boundary;
  // direct engine evaluation is the intended physical reference for this assertion.
  return evaluatePoint(scene, settings, point).value!
}

describe('exportProbeReadingsCsv', () => {
  it('quotes cells, escapes quotes, and guards formula-like user labels', () => {
    const scene = createDemoScene()
    scene.probes[0]!.id = '=1+1'
    scene.probes[0]!.name = '@SUM("A1"), East'

    const csv = exportProbeReadingsCsv(summarizeProbes(scene, defaultSettings('acoustics')))
    const row = csv.split('\r\n')[1]!

    expect(row.startsWith('"\'=1+1",')).toBe(true)
    expect(row).toContain('"\'@SUM(""A1""), East"')
    expect(row).toContain('","main",')
    expect(csv).toContain('"value"')
    expect(csv).toContain('"unit"')
    expect(csv).not.toContain('"0","dB"')
  })

  it.each(['+probe', '-probe', '\tprobe', '\rprobe'])('guards a label starting with %j', prefix => {
    const scene = createDemoScene()
    scene.probes[0]!.name = `${prefix}label`
    const csv = exportProbeReadingsCsv(summarizeProbes(scene, defaultSettings('acoustics')))
    expect(csv).toContain(`"'${prefix}label"`)
  })
})

 it('keeps negative numeric readings numeric in CSV and records the frequency', () => {
  const summary = summarizeProbes(createDemoScene(), defaultSettings('acoustics'))
  const csv = exportProbeReadingsCsv(summary)
  expect(csv).toContain('"frequency_hz"')
  expect(csv).toContain(`"${summary.readings[0]!.result.value}"`)
  expect(csv).not.toContain(`"'${summary.readings[0]!.result.value}"`)
})
