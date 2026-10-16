import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest runs under Node; package source types intentionally omit Node globals.
import { createHash } from 'node:crypto'
import { createDemoScene, defaultSettings, evaluatePoint, computeField, SceneSchema, MASK_REASON, EngineError, sha256Hex, parseScene } from './engine'

describe('engine numerical slice', () => {
  it('matches the direct sound distance and travel-time checks', () => {
    const scene = createDemoScene()
    scene.walls = []
    scene.openings = []
    scene.emitters[0]!.position = [1, 1, 1.2]
    const settings = defaultSettings('acoustics')
    const twoMeters = evaluatePoint(scene, settings, [3, 1, 1.2])
    expect(twoMeters.valid).toBe(true)
    expect(twoMeters.value).toBeCloseTo(-6.020599913, 8)
    const tenMs = evaluatePoint(scene, settings, [1 + 3.43, 1, 1.2])
    expect(tenMs.travelTimeMs).toBeCloseTo(10, 10)
  })

  it('matches exact c0 FSPL and keeps RF independent of acoustic settings', () => {
    const scene = createDemoScene()
    scene.walls = []
    scene.openings = []
    scene.emitters[1]!.position = [1, 1, 1.2]
    const result = evaluatePoint(scene, defaultSettings('radio'), [3, 1, 1.2])
    expect(result.valid).toBe(true)
    expect(result.value).toBeCloseTo(-28.072, 2)
    expect(result.quantity).toBe('received-power-dbm')
  })

  it('applies EIRP linearly and frequency doubling through free-space loss', () => {
    const scene=createDemoScene()
    scene.walls=[]
    scene.openings=[]
    scene.emitters[1]!.position=[1,1,1.2]
    const point:[number,number,number]=[3,1,1.2]
    const settings=defaultSettings('radio')
    const base=evaluatePoint(scene,settings,point)
    scene.emitters[1]!.eirpDbm=21
    const boosted=evaluatePoint(scene,settings,point)
    const doubled=evaluatePoint(scene,{...settings,frequencyHz:4.8e9},point)
    expect(boosted.value!-base.value!).toBeCloseTo(3,10)
    expect(doubled.value!-boosted.value!).toBeCloseTo(-6.020599913,8)
    expect(base.crossings).toHaveLength(0)
  })

  it('places the demonstration ray through the actual closed doorway and charges one leaf loss', () => {
    const scene = createDemoScene(), probe = scene.probes[0]!.position
    const closed = evaluatePoint(scene, defaultSettings('acoustics'), probe)
    expect(closed.valid).toBe(true)
    expect(closed.crossings.map(x => x.wallId)).toEqual(['hall-partition'])
    expect(closed.crossings[0]!.openingId).toBe('hall-door')
    expect(closed.crossings[0]!.materialId).toBe('door-leaf')
    expect(closed.crossings[0]!.lossDb).toBe(6)
    scene.openings[0]!.isOpen = true
    const open = evaluatePoint(scene, defaultSettings('acoustics'), probe)
    expect(open.valid).toBe(true)
    expect(open.crossings).toHaveLength(1)
    expect(open.crossings[0]!.lossDb).toBe(0)
    expect(open.value! - closed.value!).toBeCloseTo(6, 10)
    expect(evaluatePoint(scene, defaultSettings('acoustics'), [7.3,5.02,1.2]).reason).not.toBe('inside-solid')
    const radio=defaultSettings('radio'), closedRadio=evaluatePoint(createDemoScene(),radio,[12,2.5,1.5])
    const openScene=createDemoScene();openScene.openings[0]!.isOpen=true
    const openRadio=evaluatePoint(openScene,radio,[12,2.5,1.5])
    expect(openRadio.value!-closedRadio.value!).toBeCloseTo(2,10)
  })

  it('resolves a rotated wall crossing at its interpolated opening span and height', () => {
    const scene=createDemoScene()
    const wall=scene.walls.find(item=>item.id==='hall-partition')!
    wall.start=[3,9.28]
    wall.end=[11,1.28]
    scene.openings[0]!.fromT=.5
    scene.openings[0]!.toT=.58
    const result=evaluatePoint(scene,defaultSettings('acoustics'),scene.probes[0]!.position)
    expect(result.valid).toBe(true)
    expect(result.crossings).toHaveLength(1)
    expect(result.crossings[0]).toMatchObject({wallId:'hall-partition',openingId:'hall-door',materialId:'door-leaf',lossDb:6})
    expect(result.crossings[0]!.hit[2]).toBeGreaterThan(1.2)
    expect(result.crossings[0]!.hit[2]).toBeLessThan(2.1)
  })

  it('marks points outside the floor invalid and rejects emitters outside the scene', () => {
    const scene=createDemoScene()
    const outside=evaluatePoint(scene,defaultSettings('acoustics'),[20,2,1.5])
    expect(outside).toMatchObject({valid:false,reason:'outside-floor'})
    scene.emitters[0]!.position=[-1,2,1.2]
    expect(()=>parseScene(scene)).toThrowError(expect.objectContaining({code:'INVALID_SCENE'}))
  })

  it('uses absolute z at the crossing and masks an in-wall point', () => {
    const scene = createDemoScene()
    scene.emitters[0]!.position[2]=2.4
    const outsideOpening = evaluatePoint(scene, defaultSettings('acoustics'), [12, 2.5, 2.4])
    expect(outsideOpening.valid).toBe(true)
    expect(outsideOpening.crossings[0]!.materialId).toBe('partition')
    const inside = evaluatePoint(scene, defaultSettings('acoustics'), [6, 5.02, 1.5])
    expect(inside.valid).toBe(false)
    expect(inside.reason).toBe('inside-solid')
  })

  it('rejects unsupported profile bands instead of extrapolating', () => {
    const scene = createDemoScene()
    const settings = { ...defaultSettings('acoustics'), frequencyHz: 500 }
    const result = evaluatePoint(scene, settings, scene.probes[0]!.position)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('missing-parameter')
  })

  it('builds row-major Float32 fields with reason-coded masks and cancellation yields', async () => {
    const scene = createDemoScene()
    const field = await computeField(scene, defaultSettings('acoustics'), { step: .1, receiverZ: 1.5 })
    expect(field.grid).toMatchObject({ originXY: [0, 0], cols: 140, rows: 100, cellSizeM: .1, receiverZM: 1.5 })
    expect(field.values).toBeInstanceOf(Float32Array)
    expect(field.validity).toBeInstanceOf(Uint8Array)
    expect([...field.validity]).toContain(MASK_REASON.valid)
    expect([...field.validity]).toContain(MASK_REASON.insideSolid)
    let cancelled=false
    const cancellationTick=new Promise<void>(resolve=>setTimeout(()=>{cancelled=true;resolve()},0))
    await expect(computeField(scene, defaultSettings('acoustics'), { step: .25, receiverZ: 1.5 }, () => cancelled)).rejects.toMatchObject({ code: 'CANCELLED' })
    await cancellationTick
    expect(cancelled).toBe(true)
  })

  it('hashes physical query content, ignoring passive probe labels and display-only zones', () => {
    const scene = createDemoScene(), point: [number, number, number] = [12, 2.5, 1.5], settings = defaultSettings('radio')
    const before = evaluatePoint(scene, settings, point).queryHash
    scene.probes[0]!.name = 'renamed'
    scene.zones[0]!.name = 'display name only'
    const after = evaluatePoint(scene, settings, point).queryHash
    expect(after).toBe(before)
    expect(evaluatePoint(scene, { ...settings, frequencyHz: 5e9 }, point).queryHash).not.toBe(before)
  })

  it('includes grid sampling in field identity and ignores level display names', async () => {
    const scene=createDemoScene(),settings=defaultSettings('acoustics')
    const base=await computeField(scene,settings,{step:1,receiverZ:1.5,requestId:1})
    const same=await computeField(scene,settings,{step:1,receiverZ:1.5,requestId:99})
    expect(same.identity.queryHash).toBe(base.identity.queryHash)
    scene.levels[0]!.name='Renamed level'
    const renamed=await computeField(scene,settings,{step:1,receiverZ:1.5})
    expect(renamed.identity.queryHash).toBe(base.identity.queryHash)
    const changedStep=await computeField(scene,settings,{step:.5,receiverZ:1.5})
    const changedReceiver=await computeField(scene,settings,{step:1,receiverZ:1.2})
    expect(changedStep.identity.queryHash).not.toBe(base.identity.queryHash)
    expect(changedReceiver.identity.queryHash).not.toBe(base.identity.queryHash)
  })

  it('produces the standard SHA-256 digest', () => {
    const content='query identity test vector'
    const expected=createHash('sha256').update(content).digest('hex')
    expect(sha256Hex(content)).toBe(expected)
  })

  it('runtime-validates references and opening geometry', () => {
    const scene = createDemoScene()
    scene.openings[0]!.wallId = 'unknown'
    expect(() => SceneSchema.parse(scene)).toThrow()
  })

  it('rejects crossing walls and returns coded validation errors', async () => {
    const scene = createDemoScene()
    scene.walls.push({id:'unsupported-crossing',levelId:'main',start:[2,4],end:[2,6],thicknessM:.1,baseZ:0,heightM:2.5,materialId:'partition'})
    expect(() => SceneSchema.parse(scene)).toThrow()
    await expect(computeField(scene,defaultSettings('acoustics'),{step:.25,receiverZ:1.5})).rejects.toBeInstanceOf(EngineError)
  })

  it('keeps explicit field steps strict at the grid limit', async () => {
    const scene = createDemoScene()
    scene.levels[0]!.boundary = [[0, 0], [80, 0], [80, 80], [0, 80]]
    await expect(computeField(scene, defaultSettings('acoustics'), { step: 0.25, receiverZ: 1.5 }))
      .rejects.toMatchObject({ code: 'GRID_TOO_LARGE' })
    await expect(computeField(scene, defaultSettings('acoustics'), { step: 0.5, receiverZ: 1.5 }))
      .resolves.toMatchObject({ grid: { cols: 160, rows: 160, cellSizeM: 0.5 } })
  })
})
