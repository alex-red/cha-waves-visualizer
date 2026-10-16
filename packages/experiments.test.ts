import { describe, expect, it } from 'vitest'
import { createDemoScene, defaultSettings } from './engine'
import { captureExperiment, describeExperimentChanges, duplicateExperiment, updateExperimentMetadata } from './experiments'
import { ProjectError } from './project'

const saved = (opts: { name?: string; notes?: string } = {}) => captureExperiment({ id:'saved', name:opts.name ?? 'Baseline', notes:opts.notes ?? '', scene:createDemoScene(), settings:defaultSettings('acoustics'), now:'2026-01-01T00:00:00.000Z' })

describe('project experiments', () => {
  it('captures a validated deep copy and freezes it', () => {
    const scene = createDemoScene(), settings = defaultSettings('acoustics')
    const experiment = captureExperiment({ id:'one', name:'Saved', notes:'', scene, settings, now:'2026-01-01T00:00:00.000Z' })
    scene.probes[0]!.name = 'Changed'; settings.frequencyHz = 500
    expect(experiment.scene.probes[0]?.name).toBe('Across the hall')
    expect(experiment.settings.frequencyHz).toBe(1000)
    expect(Object.isFrozen(experiment.scene.probes[0])).toBe(true)
    expect(() => { (experiment.settings as {frequencyHz:number}).frequencyHz = 50 }).toThrow()
  })

  it('duplicates immutably with case-insensitive unique names and a preserved suffix', () => {
    const source = saved({ name:'X'.repeat(80) })
    const collision = { ...saved({ name:`${'x'.repeat(75)} COPY` }), id:'collision' }
    const duplicate = duplicateExperiment(source, 'copy', [source, collision], '2026-02-01T00:00:00.000Z')
    expect(duplicate.name).toBe(`${'X'.repeat(73)} copy 2`)
    expect(duplicate.name.length).toBeLessThanOrEqual(80)
    expect(duplicate.id).toBe('copy')
    expect(duplicate.scene).toEqual(source.scene)
    expect(duplicate.createdAt).toBe('2026-02-01T00:00:00.000Z')
    expect(source.name).toBe('X'.repeat(80))
  })

  it('avoids source-name and id collisions when duplicating a long name ending in copy', () => {
    const source = saved({ name:`${'X'.repeat(75)} copy` })
    const duplicate = duplicateExperiment(source, 'new-id', [source], '2026-02-01T00:00:00.000Z')
    expect(duplicate.name).toBe(`${'X'.repeat(73)} copy 2`)
    expect(() => duplicateExperiment(source, 'saved', [source])).toThrow(/id.*already exists/i)
  })

  it('validates metadata updates and leaves the source unchanged', () => {
    const source = saved()
    const updated = updateExperimentMetadata(source, { name:'New label', notes:'Plain text notes' }, '2026-02-01T00:00:00.000Z')
    expect(updated.name).toBe('New label'); expect(updated.notes).toBe('Plain text notes'); expect(updated.updatedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(source.name).toBe('Baseline')
    expect(() => updateExperimentMetadata(source, { name:'', notes:'' })).toThrow(ProjectError)
  })

  it('reports probe, zone, and setting changes while ignoring revision and entity order', () => {
    const baseline = saved(), scene = structuredClone(baseline.scene) as ReturnType<typeof createDemoScene>
    scene.revision += 10
    scene.probes[0]!.name = 'Desk'
    scene.probes.push({ id:'new-probe', levelId:'main', position:[3,3,1], name:'Window' })
    scene.zones[0]!.name = 'Lounge'
    scene.zones.reverse()
    const settings = { ...defaultSettings('acoustics'), frequencyHz:500 }
    const changes = describeExperimentChanges(baseline, { scene, settings })
    expect(changes.map(c => c.key)).toEqual(expect.arrayContaining(['probes.hallway-probe.name','probes.new-probe','zones.living.name','settings.frequencyHz']))
    expect(changes.some(c => c.key === 'scene.revision')).toBe(false)
    const reordered = structuredClone(baseline.scene) as ReturnType<typeof createDemoScene>
    reordered.walls.reverse(); reordered.materials.reverse(); reordered.probes.reverse(); reordered.zones.reverse()
    expect(describeExperimentChanges(baseline, { scene:reordered, settings:baseline.settings })).toEqual([])
  })

  it('describes guide image asset changes without exposing base64 data', () => {
    const png = (marker: number) => `data:image/png;base64,${btoa(String.fromCharCode(137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,marker))}`
    const referenceImage = { dataUrl:png(1), pixelWidth:1, pixelHeight:1, widthM:10, heightM:8, originXY:[0,0] as [number,number], opacity:0.5 }
    const baseline = captureExperiment({ id:'img', name:'Image', notes:'', scene:createDemoScene(), settings:defaultSettings('acoustics'), referenceImage })
    const changes = describeExperimentChanges(baseline, { scene:baseline.scene as ReturnType<typeof createDemoScene>, settings:baseline.settings as ReturnType<typeof defaultSettings>, referenceImage:{ ...referenceImage, dataUrl:png(2), widthM:12, originXY:[1,2] } })
    expect(changes.map(change => change.key)).toEqual(['referenceImage.dataUrl','referenceImage.widthM','referenceImage.originXY'])
    expect(changes[0]?.after).toBe('Different embedded image')
    expect(changes[1]?.before).toBe('10'); expect(changes[1]?.after).toBe('12')
    expect(changes[2]?.before).toBe('[0,0]'); expect(changes[2]?.after).toBe('[1,2]')
    expect(changes.every(change => !change.after.includes('base64') && !change.after.includes(png(2)))).toBe(true)
  })

  it('reports opacity changes as their own guide field', () => {
    const png = `data:image/png;base64,${btoa(String.fromCharCode(137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1))}`
    const referenceImage = { dataUrl:png, pixelWidth:1, pixelHeight:1, widthM:10, heightM:8, originXY:[0,0] as [number,number], opacity:0.5 }
    const baseline = captureExperiment({ id:'opacity', name:'Image', notes:'', scene:createDemoScene(), settings:defaultSettings('acoustics'), referenceImage })
    const changes = describeExperimentChanges(baseline, { scene:baseline.scene as ReturnType<typeof createDemoScene>, settings:baseline.settings as ReturnType<typeof defaultSettings>, referenceImage:{ ...referenceImage, opacity:0.8 } })
    expect(changes).toEqual([{ key:'referenceImage.opacity', label:'Guide image · opacity', before:'0.5', after:'0.8' }])
  })
})
