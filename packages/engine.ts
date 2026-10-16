import { z } from 'zod'

export const SOLVER_VERSION = '1.0.0'
export const MAX_GRID_CELLS = 100_000
const xySchema = z.tuple([z.number().finite(), z.number().finite()])
const pointSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const provenanceSchema = z.enum(['fixture-assumed', 'user-entered', 'literature-derived', 'manufacturer-measured', 'site-measured'])
const bandValueSchema = z.object({ frequencyHz: z.number().positive().finite(), valueDb: z.number().finite(), provenance: provenanceSchema, notes: z.string().optional() }).strict()
const absorptionBandSchema = z.object({ frequencyHz: z.number().positive().finite(), value: z.number().min(0).max(1).finite(), provenance: provenanceSchema, notes: z.string().optional() }).strict()

export const SceneSchema = z.object({
  id: z.string().min(1), revision: z.number().int().nonnegative().default(0),
  levels: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), boundary: z.array(xySchema).min(3), floorZ: z.number().finite().default(0), ceilingHeightM: z.number().positive().finite() }).strict()).min(1).max(1),
  zones: z.array(z.object({ id: z.string().min(1), levelId: z.string().min(1), name: z.string().min(1), polygon: z.array(xySchema).min(3) }).strict()).default([]),
  materials: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), provenance: provenanceSchema, display: z.object({ color: z.string().optional() }).strict().optional(), acousticTransmissionDb: z.array(bandValueSchema).default([]), radioLossDb: z.array(bandValueSchema).default([]), acousticAbsorption: z.array(absorptionBandSchema).default([]) }).strict()).max(64),
  walls: z.array(z.object({ id: z.string().min(1), levelId: z.string().min(1), start: xySchema, end: xySchema, thicknessM: z.number().positive().finite(), baseZ: z.number().finite(), heightM: z.number().positive().finite(), materialId: z.string().min(1) }).strict()).max(256),
  openings: z.array(z.object({ id: z.string().min(1), wallId: z.string().min(1), fromT: z.number().min(0).max(1), toT: z.number().min(0).max(1), sillAboveBaseM: z.number().nonnegative().finite(), heightM: z.number().positive().finite(), kind: z.enum(['passage', 'door', 'window']), isOpen: z.boolean().default(false), fixed: z.boolean().default(false), materialId: z.string().min(1).optional() }).strict()).max(256),
  emitters: z.array(z.object({ id: z.string().min(1), levelId: z.string().min(1), domain: z.enum(['acoustics', 'radio']), position: pointSchema, active: z.boolean().default(true), eirpDbm: z.number().finite().optional() }).strict()),
  probes: z.array(z.object({ id: z.string().min(1), levelId: z.string().min(1), position: pointSchema, name: z.string().optional() }).strict()).max(64).default([]),
}).strict().superRefine((scene, ctx) => {
  const ids = new Set<string>()
  const unique = (id: string, path: (string | number)[]) => { if (ids.has(id)) ctx.addIssue({ code: 'custom', path, message: `Duplicate id: ${id}` }); ids.add(id) }
  unique(scene.id,['id'])
  scene.levels.forEach((v, i) => unique(v.id, ['levels', i, 'id']))
  scene.zones.forEach((v, i) => unique(v.id, ['zones', i, 'id']))
  scene.materials.forEach((v, i) => unique(v.id, ['materials', i, 'id']))
  scene.walls.forEach((v, i) => unique(v.id, ['walls', i, 'id']))
  scene.openings.forEach((v, i) => unique(v.id, ['openings', i, 'id']))
  scene.emitters.forEach((v, i) => unique(v.id, ['emitters', i, 'id']))
  scene.probes.forEach((v, i) => unique(v.id, ['probes', i, 'id']))
  const levelIds = new Set(scene.levels.map(x => x.id)), materialIds = new Set(scene.materials.map(x => x.id)), wallIds = new Set(scene.walls.map(x => x.id))
  for (const [i, level] of scene.levels.entries()) {
    if (level.boundary.length < 3 || polygonArea(level.boundary) <= 1e-8) ctx.addIssue({ code: 'custom', path: ['levels', i, 'boundary'], message: 'Boundary must be a non-degenerate polygon' })
    if (selfIntersects(level.boundary)) ctx.addIssue({ code: 'custom', path: ['levels', i, 'boundary'], message: 'Boundary polygon cannot self-intersect' })
  }
  for (const [i, zone] of scene.zones.entries()) {
    if (!levelIds.has(zone.levelId)) ctx.addIssue({ code: 'custom', path: ['zones', i, 'levelId'], message: 'Unknown level' })
    if(polygonArea(zone.polygon)<=1e-8||selfIntersects(zone.polygon))ctx.addIssue({code:'custom',path:['zones',i,'polygon'],message:'Zone polygon must be simple and non-degenerate'})
  }
  for (const [i, wall] of scene.walls.entries()) {
    if (!levelIds.has(wall.levelId)) ctx.addIssue({ code: 'custom', path: ['walls', i, 'levelId'], message: 'Unknown level' })
    if (!materialIds.has(wall.materialId)) ctx.addIssue({ code: 'custom', path: ['walls', i, 'materialId'], message: 'Unknown material' })
    if (dist2(wall.start, wall.end) < 1e-12) ctx.addIssue({ code: 'custom', path: ['walls', i], message: 'Wall length must be greater than 1e-6 m' })
    const wallLevel=scene.levels.find(l=>l.id===wall.levelId)
    if(wallLevel&&wall.baseZ+wall.heightM>wallLevel.floorZ+wallLevel.ceilingHeightM+1e-6)ctx.addIssue({code:'custom',path:['walls',i,'heightM'],message:'Wall top must fit within its level'})
  }
  for(let i=0;i<scene.walls.length;i++)for(let j=i+1;j<scene.walls.length;j++){
    const a=scene.walls[i]!,b=scene.walls[j]!
    if(a.levelId!==b.levelId)continue
    if(unsupportedWallIntersection(a.start,a.end,b.start,b.end))ctx.addIssue({code:'custom',path:['walls',j],message:`Wall ${b.id} crosses or overlaps wall ${a.id} away from a shared endpoint`})
  }
  const openingsByWall = new Map<string, typeof scene.openings>()
  for (const [i, opening] of scene.openings.entries()) {
    const wall = scene.walls.find(x => x.id === opening.wallId)
    if (!wall || !wallIds.has(opening.wallId)) ctx.addIssue({ code: 'custom', path: ['openings', i, 'wallId'], message: 'Unknown wall' })
    if (opening.materialId && !materialIds.has(opening.materialId)) ctx.addIssue({ code: 'custom', path: ['openings', i, 'materialId'], message: 'Unknown material' })
    if(opening.kind==='door'&&!opening.materialId)ctx.addIssue({code:'custom',path:['openings',i,'materialId'],message:'Door requires an explicit leaf material'})
    if(opening.kind==='window'&&opening.fixed&&!opening.materialId)ctx.addIssue({code:'custom',path:['openings',i,'materialId'],message:'Fixed window requires an explicit material'})
    if (opening.fromT >= opening.toT) ctx.addIssue({ code: 'custom', path: ['openings', i], message: 'Opening span must have positive width' })
    if (wall && opening.sillAboveBaseM + opening.heightM > wall.heightM + 1e-8) ctx.addIssue({ code: 'custom', path: ['openings', i], message: 'Opening must fit within wall height' })
    const list = openingsByWall.get(opening.wallId) ?? []; list.push(opening); openingsByWall.set(opening.wallId, list)
  }
  openingsByWall.forEach((list, wallId) => {
    const sorted = [...list].sort((a,b) => a.fromT-b.fromT)
    for (let i=1;i<sorted.length;i++) if (sorted[i]!.fromT < sorted[i-1]!.toT) ctx.addIssue({ code:'custom', path:['openings'], message:`Openings overlap on wall ${wallId}` })
  })
  for (const [i, emitter] of scene.emitters.entries()) {
    if (!levelIds.has(emitter.levelId)) ctx.addIssue({ code: 'custom', path: ['emitters', i, 'levelId'], message: 'Unknown level' })
    if (emitter.domain === 'radio' && emitter.eirpDbm === undefined) ctx.addIssue({ code: 'custom', path: ['emitters', i, 'eirpDbm'], message: 'Radio emitter requires EIRP in dBm' })
    const emitterLevel=scene.levels.find(l=>l.id===emitter.levelId)
    if(emitterLevel&&(emitter.position[2]!<emitterLevel.floorZ-1e-6||emitter.position[2]!>emitterLevel.floorZ+emitterLevel.ceilingHeightM+1e-6)) ctx.addIssue({code:'custom',path:['emitters',i,'position',2],message:'Emitter height must lie within its level'})
    if(emitterLevel&&!pointInPolygon([emitter.position[0]!,emitter.position[1]!],emitterLevel.boundary))ctx.addIssue({code:'custom',path:['emitters',i,'position'],message:'Emitter must be inside its level boundary'})
  }
  for (const [i, probe] of scene.probes.entries()) {
    if (!levelIds.has(probe.levelId)) ctx.addIssue({ code:'custom', path:['probes',i,'levelId'], message:'Unknown level' })
    const probeLevel=scene.levels.find(l=>l.id===probe.levelId)
    if(probeLevel&&(probe.position[2]!<probeLevel.floorZ-1e-6||probe.position[2]!>probeLevel.floorZ+probeLevel.ceilingHeightM+1e-6)) ctx.addIssue({code:'custom',path:['probes',i,'position',2],message:'Probe height must lie within its level'})
    if(probeLevel&&!pointInPolygon([probe.position[0]!,probe.position[1]!],probeLevel.boundary))ctx.addIssue({code:'custom',path:['probes',i,'position'],message:'Probe must be inside its level boundary'})
  }
  for(const domain of ['acoustics','radio'] as const)if(scene.emitters.filter(e=>e.domain===domain&&e.active).length>1)ctx.addIssue({code:'custom',path:['emitters'],message:`Only one active ${domain} emitter is supported`})
  for (const material of scene.materials) for (const [name, bands] of [['acousticTransmissionDb',material.acousticTransmissionDb], ['radioLossDb',material.radioLossDb]] as const) {
    for (let i=1;i<bands.length;i++) if (bands[i]!.frequencyHz <= bands[i-1]!.frequencyHz) ctx.addIssue({ code:'custom', path:['materials',material.id,name], message:'Frequency bands must be strictly increasing' })
  }
})

const SolverSettingsSchema = z.discriminatedUnion('mode', [
  z.object({mode:z.literal('acoustics'),frequencyHz:z.number().positive().finite(),referenceDistanceM:z.number().positive().finite(),minValidDistanceM:z.number().positive().finite(),speedOfSoundMps:z.number().positive().finite(),transmissionEnabled:z.boolean()}).strict(),
  z.object({mode:z.literal('radio'),frequencyHz:z.number().positive().finite(),receiverGainDbi:z.number().finite(),minValidDistanceM:z.number().positive().finite(),otherLossDb:z.number().finite()}).strict(),
])

export type Scene = z.infer<typeof SceneSchema>
export type Domain = 'acoustics' | 'radio'
export type EngineErrorCode = 'INVALID_SCENE'|'INVALID_SETTINGS'|'INVALID_GRID'|'GRID_TOO_LARGE'|'UNKNOWN_LEVEL'|'CANCELLED'
export class EngineError extends Error {
  constructor(public readonly code:EngineErrorCode,message:string){super(message);this.name='EngineError'}
}
export type ParameterRecord = { id: string; valueDb: number; frequencyHz: number; provenance: z.infer<typeof provenanceSchema>; notes?: string }
export type SolverSettings = { mode: 'acoustics'; frequencyHz: number; referenceDistanceM: number; minValidDistanceM: number; speedOfSoundMps: number; transmissionEnabled: boolean } | { mode: 'radio'; frequencyHz: number; receiverGainDbi: number; minValidDistanceM: number; otherLossDb: number }
export type CrossingTerm = { wallId: string; openingId?: string; materialId: string; lossDb: number; hit: [number, number, number] }
export type PointResult = { valid: boolean; reason?: 'outside-floor'|'inside-solid'|'below-model-distance'|'missing-parameter'|'unsupported-geometry'; quantity: 'relative-direct-level-db'|'received-power-dbm'; unit: 'dB'|'dBm'; value?: number; distanceM: number; travelTimeMs?: number; crossings: CrossingTerm[]; assumptions: ParameterRecord[]; queryHash: string }
export type GridSpec = { levelId: string; originXY: [number,number]; cols: number; rows: number; cellSizeM: number; receiverZM: number; quality: 'custom' }
export type FieldResult = { identity: { workspaceGeneration: number; requestId: number; queryHash: string; solverId: 'acoustic-direct-v1'|'rf-fspl-multiwall-v1'; solverVersion: string }; sceneRevision: number; quantity: PointResult['quantity']; unit: PointResult['unit']; grid: GridSpec; values: Float32Array; validity: Uint8Array; assumptions: ParameterRecord[]; computeMs: number }
export type ComputeOptions = { step: number; receiverZ: number; levelId?: string; workspaceGeneration?: number; requestId?: number }
export type CancelCheck = () => boolean
export const MASK_REASON = { outsideFloor: 0, valid: 1, insideSolid: 2, belowModelDistance: 3, missingParameter: 4, unsupportedGeometry: 5 } as const

export function parseScene(value: unknown): Scene { try{return SceneSchema.parse(value)}catch(error){throw new EngineError('INVALID_SCENE',error instanceof Error?error.message:'Scene validation failed')} }
function parseSettings(value:unknown):SolverSettings{try{return SolverSettingsSchema.parse(value)}catch(error){throw new EngineError('INVALID_SETTINGS',error instanceof Error?error.message:'Solver settings validation failed')}}
export function defaultSettings(mode: Domain): SolverSettings
export function defaultSettings(mode: 'acoustics'): Extract<SolverSettings,{mode:'acoustics'}>
export function defaultSettings(mode: 'radio'): Extract<SolverSettings,{mode:'radio'}>
export function defaultSettings(mode: Domain): SolverSettings {
  return mode === 'acoustics' ? { mode, frequencyHz: 1000, referenceDistanceM: 1, minValidDistanceM: 1, speedOfSoundMps: 343, transmissionEnabled: true } : { mode, frequencyHz: 2.4e9, receiverGainDbi: 0, minValidDistanceM: 1, otherLossDb: 0 }
}

export function createDemoScene(): Scene {
  return parseScene({
    id:'demo-apartment', revision:1,
    levels:[{ id:'main', name:'Main level', boundary:[[0,0],[14,0],[14,10],[0,10]], floorZ:0, ceilingHeightM:2.7 }],
    zones:[{ id:'living',levelId:'main',name:'Living room',polygon:[[1,5],[13,5],[13,9],[1,9]] },{ id:'bedroom',levelId:'main',name:'Bedroom',polygon:[[1,1],[13,1],[13,5],[1,5]] }],
    materials:[
      { id:'partition',name:'Demo lightweight partition',provenance:'fixture-assumed',acousticTransmissionDb:[{frequencyHz:1000,valueDb:8,provenance:'fixture-assumed'}],radioLossDb:[{frequencyHz:2.4e9,valueDb:3,provenance:'fixture-assumed'},{frequencyHz:5e9,valueDb:5,provenance:'fixture-assumed'},{frequencyHz:6e9,valueDb:6,provenance:'fixture-assumed'}] },
      { id:'masonry',name:'Demo masonry partition',provenance:'fixture-assumed',acousticTransmissionDb:[{frequencyHz:1000,valueDb:15,provenance:'fixture-assumed'}],radioLossDb:[{frequencyHz:2.4e9,valueDb:10,provenance:'fixture-assumed'},{frequencyHz:5e9,valueDb:15,provenance:'fixture-assumed'},{frequencyHz:6e9,valueDb:18,provenance:'fixture-assumed'}] },
      { id:'door-leaf',name:'Demo closed interior door',provenance:'fixture-assumed',acousticTransmissionDb:[{frequencyHz:1000,valueDb:6,provenance:'fixture-assumed'}],radioLossDb:[{frequencyHz:2.4e9,valueDb:2,provenance:'fixture-assumed'},{frequencyHz:5e9,valueDb:3,provenance:'fixture-assumed'},{frequencyHz:6e9,valueDb:4,provenance:'fixture-assumed'}] },
    ],
    walls:[
      {id:'north',levelId:'main',start:[0,10],end:[14,10],thicknessM:.15,baseZ:0,heightM:2.7,materialId:'masonry'},
      {id:'south',levelId:'main',start:[14,0],end:[0,0],thicknessM:.15,baseZ:0,heightM:2.7,materialId:'masonry'},
      {id:'west',levelId:'main',start:[0,0],end:[0,10],thicknessM:.15,baseZ:0,heightM:2.7,materialId:'masonry'},
      {id:'east',levelId:'main',start:[14,10],end:[14,0],thicknessM:.15,baseZ:0,heightM:2.7,materialId:'masonry'},
      {id:'hall-partition',levelId:'main',start:[1,5],end:[13,5],thicknessM:.12,baseZ:0,heightM:2.7,materialId:'partition'},
    ],
    openings:[{id:'hall-door',wallId:'hall-partition',fromT:.49,toT:.60,sillAboveBaseM:0,heightM:2.1,kind:'door',isOpen:false,materialId:'door-leaf'}],
    emitters:[{id:'speaker',levelId:'main',domain:'acoustics',position:[2,7.8,1.2],active:true},{id:'access-point',levelId:'main',domain:'radio',position:[2,7.8,1.2],active:true,eirpDbm:18}],
    probes:[{id:'hallway-probe',levelId:'main',position:[12,2.5,1.5],name:'Across the hall'}],
  })
}

export function evaluatePoint(sceneInput: Scene, settings: SolverSettings, point: [number,number,number]): PointResult {
  const scene = parseScene(sceneInput), checkedSettings=parseSettings(settings)
  return evaluatePointValidated(scene,checkedSettings,point)
}

/** Evaluate a batch while validating the shared model and settings only once. */
export function evaluatePoints(sceneInput: Scene, settings: SolverSettings, points: readonly [number,number,number][]): PointResult[] {
  const scene = parseScene(sceneInput), checkedSettings = parseSettings(settings), hash = queryHash(scene, checkedSettings)
  return points.map(point => evaluatePointValidated(scene, checkedSettings, point, hash))
}

/** Return the model/settings identity shared by point estimates for this input. */
export function pointQueryHash(sceneInput: Scene, settings: SolverSettings): string {
  return queryHash(parseScene(sceneInput), parseSettings(settings))
}

function evaluatePointValidated(scene:Scene,settings:SolverSettings,point:[number,number,number],knownHash?:string):PointResult {
  const domain = settings.mode, level = scene.levels[0]
  const emitter = scene.emitters.find(e => e.domain === domain && e.active)
  const quantity = domain === 'acoustics' ? 'relative-direct-level-db' : 'received-power-dbm', unit = domain === 'acoustics' ? 'dB' : 'dBm'
  const hash=knownHash??queryHash(scene,settings)
  const invalid = (reason: PointResult['reason'], distanceM=0): PointResult => ({valid:false,...(reason?{reason}:{}),quantity,unit,distanceM,crossings:[],assumptions:[],queryHash:hash})
  if (!emitter) return invalid('missing-parameter')
  if (!point.every(Number.isFinite)) return invalid('unsupported-geometry')
  if (!pointInPolygon([point[0]!,point[1]!],level!.boundary) || point[2]! < level!.floorZ-1e-6 || point[2]! > level!.floorZ+level!.ceilingHeightM+1e-6) return invalid('outside-floor')
  const d = Math.hypot(point[0]-emitter.position[0],point[1]-emitter.position[1],point[2]-emitter.position[2])
  if(!Number.isFinite(d))return invalid('unsupported-geometry')
  if (d < settings.minValidDistanceM) return invalid('below-model-distance',d)
  if (insideWall(scene,point)) return invalid('inside-solid',d)
  const crossings = wallCrossings(scene,emitter.position,point)
  const assumptions: ParameterRecord[] = []
  let loss = 0
  for (const crossing of crossings) {
    if (domain==='acoustics' && !settings.transmissionEnabled) continue
    const opening=crossing.openingId?scene.openings.find(o=>o.id===crossing.openingId):undefined
    if(opening&&(opening.kind==='passage'||(opening.kind==='door'&&opening.isOpen))) continue
    const material = scene.materials.find(m=>m.id===crossing.materialId)
    const bands = domain==='acoustics' ? material?.acousticTransmissionDb : material?.radioLossDb
    const band = bands?.find(b=>b.frequencyHz===settings.frequencyHz)
    if (!band) return invalid('missing-parameter',d)
    crossing.lossDb = band.valueDb; loss += band.valueDb
    assumptions.push({id:crossing.materialId,valueDb:band.valueDb,frequencyHz:band.frequencyHz,provenance:band.provenance,...(band.notes===undefined?{}:{notes:band.notes})})
  }
  let value: number
  if(domain==='acoustics') value=-20*Math.log10(d/settings.referenceDistanceM)-loss
  else {
    const fspl=20*Math.log10(4*Math.PI*d*settings.frequencyHz/299792458)
    value=emitter.eirpDbm!+settings.receiverGainDbi-fspl-loss-settings.otherLossDb
  }
  if(!Number.isFinite(value))return invalid('unsupported-geometry',d)
  return {valid:true,quantity,unit,value,distanceM:d,...(domain==='acoustics'?{travelTimeMs:1000*d/settings.speedOfSoundMps}:{}),crossings,assumptions,queryHash:hash}
}

export async function computeField(sceneInput: Scene, settings: SolverSettings, options: ComputeOptions, cancel?: CancelCheck): Promise<FieldResult> {
  const scene=parseScene(sceneInput), checkedSettings=parseSettings(settings), level=scene.levels.find(l=>l.id===(options.levelId??scene.levels[0]!.id))
  if(!level) throw new EngineError('UNKNOWN_LEVEL','Unknown level')
  if(!Number.isFinite(options.step)||options.step<=0||!Number.isFinite(options.receiverZ)) throw new EngineError('INVALID_GRID','Grid step must be positive and receiver height must be finite')
  const minX=Math.min(...level.boundary.map(p=>p[0])), maxX=Math.max(...level.boundary.map(p=>p[0])), minY=Math.min(...level.boundary.map(p=>p[1])), maxY=Math.max(...level.boundary.map(p=>p[1]))
  const width=maxX-minX, depth=maxY-minY
  if(!Number.isFinite(width)||!Number.isFinite(depth)||width<=0||depth<=0) throw new EngineError('INVALID_GRID','Grid bounds must have finite, positive dimensions')
  const cols=Math.max(1,Math.ceil(width/options.step)), rows=Math.max(1,Math.ceil(depth/options.step))
  if(!Number.isSafeInteger(cols)||!Number.isSafeInteger(rows)||cols<1||rows<1) throw new EngineError('INVALID_GRID','Grid dimensions exceed the supported numeric range')
  if(cols>MAX_GRID_CELLS/rows) throw new EngineError('GRID_TOO_LARGE',`Grid exceeds the ${MAX_GRID_CELLS.toLocaleString()} cell limit`)
  const grid: GridSpec={levelId:level.id,originXY:[minX,minY],cols,rows,cellSizeM:options.step,receiverZM:options.receiverZ,quality:'custom'}
  const values=new Float32Array(cols*rows), validity=new Uint8Array(cols*rows), start=performanceNow(), assumptions:ParameterRecord[]=[], hash=queryHash(scene,checkedSettings,{step:options.step,receiverZ:options.receiverZ,levelId:level.id})
  for(let j=0;j<rows;j++) {
    if(cancel?.()) throw new EngineError('CANCELLED','Field computation cancelled')
    for(let i=0;i<cols;i++) {
      const index=j*cols+i, result=evaluatePointValidated(scene,checkedSettings,[minX+(i+.5)*options.step,minY+(j+.5)*options.step,options.receiverZ],hash)
      if(result.valid&&result.value!==undefined){values[index]=result.value;validity[index]=MASK_REASON.valid; for(const a of result.assumptions) if(!assumptions.some(x=>x.id===a.id&&x.frequencyHz===a.frequencyHz)) assumptions.push(a)}
      else validity[index]=result.reason==='inside-solid'?MASK_REASON.insideSolid:result.reason==='below-model-distance'?MASK_REASON.belowModelDistance:result.reason==='missing-parameter'?MASK_REASON.missingParameter:result.reason==='unsupported-geometry'?MASK_REASON.unsupportedGeometry:MASK_REASON.outsideFloor
    }
    if(j%8===7) await new Promise<void>(resolve=>setTimeout(resolve,0))
  }
  if(cancel?.()) throw new EngineError('CANCELLED','Field computation cancelled')
  return {identity:{workspaceGeneration:options.workspaceGeneration??0,requestId:options.requestId??0,queryHash:hash,solverId:checkedSettings.mode==='acoustics'?'acoustic-direct-v1':'rf-fspl-multiwall-v1',solverVersion:SOLVER_VERSION},sceneRevision:scene.revision,quantity:checkedSettings.mode==='acoustics'?'relative-direct-level-db':'received-power-dbm',unit:checkedSettings.mode==='acoustics'?'dB':'dBm',grid,values,validity,assumptions,computeMs:performanceNow()-start}
}

function queryHash(scene:Scene,settings:SolverSettings,sampling?:{step:number;receiverZ:number;levelId:string}):string {
  const domain=settings.mode, emitter=scene.emitters.find(e=>e.domain===domain&&e.active)
  const materialIds=new Set(scene.walls.map(w=>w.materialId)); scene.openings.forEach(o=>{if(o.materialId)materialIds.add(o.materialId)})
  const {id:levelId,boundary,floorZ,ceilingHeightM}=scene.levels[0]!
  const relevant={version:'query-v1',domain,settings,sampling,emitter,level:{id:levelId,boundary,floorZ,ceilingHeightM},walls:[...scene.walls].sort((a,b)=>a.id.localeCompare(b.id)),openings:[...scene.openings].sort((a,b)=>a.id.localeCompare(b.id)),materials:scene.materials.filter(m=>materialIds.has(m.id)).map(m=>({id:m.id,provenance:m.provenance,acousticTransmissionDb:domain==='acoustics'?m.acousticTransmissionDb:undefined,radioLossDb:domain==='radio'?m.radioLossDb:undefined})).sort((a,b)=>a.id.localeCompare(b.id))}
  return sha256Hex(stableStringify(relevant))
}

function wallCrossings(scene:Scene,source:[number,number,number],receiver:[number,number,number]):CrossingTerm[] {
  const result: { wall: Scene['walls'][number]; u: number; t: number; hit: [number, number, number] }[] = []
  const rx = receiver[0] - source[0]
  const ry = receiver[1] - source[1]
  const rayLength = Math.hypot(rx, ry)
  if (rayLength < 1e-9) return []

  for (const wall of scene.walls) {
    const sx = wall.end[0] - wall.start[0]
    const sy = wall.end[1] - wall.start[1]
    const denominator = cross(rx, ry, sx, sy)
    if (Math.abs(denominator) < 1e-12) continue

    const qx = wall.start[0] - source[0]
    const qy = wall.start[1] - source[1]
    const rayT = cross(qx, qy, sx, sy) / denominator
    const wallT = cross(qx, qy, rx, ry) / denominator
    const rayEpsilon = 1e-6 / rayLength
    const wallEpsilon = 1e-6 / Math.hypot(sx, sy)
    if (rayT <= rayEpsilon || rayT >= 1 - rayEpsilon || wallT < -wallEpsilon || wallT > 1 + wallEpsilon) continue

    const sourceSide = cross(sx, sy, source[0] - wall.start[0], source[1] - wall.start[1])
    const receiverSide = cross(sx, sy, receiver[0] - wall.start[0], receiver[1] - wall.start[1])
    if (sourceSide === 0 || receiverSide === 0 || sourceSide * receiverSide >= 0) continue

    const z = source[2] + rayT * (receiver[2] - source[2])
    if (z < wall.baseZ - 1e-6 || z > wall.baseZ + wall.heightM + 1e-6) continue
    result.push({ wall, u: wallT, t: rayT, hit: [source[0] + rayT * rx, source[1] + rayT * ry, z] })
  }
  result.sort((a, b) => a.t - b.t || a.wall.id.localeCompare(b.wall.id))

  // A connected junction is charged once. Sorting by stable wall ID makes the choice deterministic.
  const unique: typeof result = []
  for (const crossing of result) {
    const previous = unique.at(-1)
    if (previous && Math.abs(crossing.t - previous.t) * rayLength <= 1e-6) continue
    unique.push(crossing)
  }

  return unique.map(({ wall, u, hit }) => {
    const opening = scene.openings.find(item => item.wallId === wall.id
      && u >= item.fromT && u < item.toT
      && hit[2] >= wall.baseZ + item.sillAboveBaseM - 1e-6
      && hit[2] < wall.baseZ + item.sillAboveBaseM + item.heightM)
    const openPassage = opening && (opening.kind === 'passage' || (opening.kind === 'door' && opening.isOpen))
    const materialId = openPassage ? wall.materialId : (opening?.materialId ?? wall.materialId)
    return { wallId: wall.id, ...(opening ? { openingId: opening.id } : {}), materialId, lossDb: 0, hit }
  })
}

function insideWall(scene: Scene, point: [number, number, number]): boolean {
  return scene.walls.some(wall => {
    if (point[2] < wall.baseZ - 1e-6 || point[2] > wall.baseZ + wall.heightM + 1e-6) return false

    const dx = wall.end[0] - wall.start[0]
    const dy = wall.end[1] - wall.start[1]
    const lengthSquared = dx * dx + dy * dy
    const along = Math.max(0, Math.min(1,
      ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dy) / lengthSquared))
    const nearestX = wall.start[0] + along * dx
    const nearestY = wall.start[1] + along * dy
    const opening = scene.openings.find(item => item.wallId === wall.id
      && along >= item.fromT && along < item.toT
      && point[2] >= wall.baseZ + item.sillAboveBaseM - 1e-6
      && point[2] < wall.baseZ + item.sillAboveBaseM + item.heightM)

    if (opening && (opening.kind === 'passage' || (opening.kind === 'door' && opening.isOpen))) return false
    return Math.hypot(point[0] - nearestX, point[1] - nearestY) < wall.thicknessM / 2 - 1e-6
  })
}

/** Placement check shared by scene commands and interactive editors. Coordinates are world meters. */
export type PlacementValidation = { valid: true } | { valid: false; reason: 'unknown-level' | 'outside-floor' | 'inside-solid' | 'invalid-scene' }
export function validatePlacement(
  sceneInput: Scene,
  position: [number, number, number],
  levelId = sceneInput.levels[0]?.id,
): PlacementValidation {
  let scene: Scene
  try { scene = parseScene(sceneInput) } catch { return { valid: false, reason: 'invalid-scene' } }
  const level = scene.levels.find(item => item.id === levelId)
  if (!level) return { valid: false, reason: 'unknown-level' }
  if (!position.every(Number.isFinite)
    || !pointInPolygon([position[0], position[1]], level.boundary)
    || position[2] < level.floorZ - 1e-6
    || position[2] > level.floorZ + level.ceilingHeightM + 1e-6) {
    return { valid: false, reason: 'outside-floor' }
  }
  if (insideWall(scene, position)) return { valid: false, reason: 'inside-solid' }
  return { valid: true }
}

/** True when a wall lies on one complete edge of the level envelope. */
export function isExteriorEnvelopeWall(scene: Scene, wall: Scene['walls'][number]): boolean {
  const level = scene.levels.find(item => item.id === wall.levelId)
  if (!level) return false
  const epsilon = 1e-6
  for (let i = 0; i < level.boundary.length; i++) {
    const a = level.boundary[i]!, b = level.boundary[(i + 1) % level.boundary.length]!
    if (onSegment(wall.start, a, b, epsilon) && onSegment(wall.end, a, b, epsilon)
      && Math.abs(cross(b[0] - a[0], b[1] - a[1], wall.start[0] - a[0], wall.start[1] - a[1])) <= epsilon * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
      && Math.abs(cross(b[0] - a[0], b[1] - a[1], wall.end[0] - a[0], wall.end[1] - a[1])) <= epsilon * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))) return true
  }
  return false
}

/** Reusable exact geometry test for proposed wall assemblies. */
export function validateWallGeometry(sceneInput: Scene): { valid: true } | { valid: false; reason: string } {
  try {
    const scene = parseScene(sceneInput)
    for (const wall of scene.walls) {
      const level = scene.levels.find(item => item.id === wall.levelId)!
      if (isExteriorEnvelopeWall(scene, wall)) continue
      const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1]
      const length = Math.hypot(dx, dy), nx = -dy / length * wall.thicknessM / 2, ny = dx / length * wall.thicknessM / 2
      const corners: [number, number][] = [
        [wall.start[0] + nx, wall.start[1] + ny],
        [wall.end[0] + nx, wall.end[1] + ny],
        [wall.end[0] - nx, wall.end[1] - ny],
        [wall.start[0] - nx, wall.start[1] - ny],
      ]
      for (let i = 0; i < corners.length; i++) {
        const corner = corners[i]!, next = corners[(i + 1) % corners.length]!
        if (!pointInPolygon(corner, level.boundary)) return { valid: false, reason: `Wall ${wall.id} thickness extends outside the level boundary` }
        for (let j = 0; j < level.boundary.length; j++) {
          if (segmentsIntersect(corner, next, level.boundary[j]!, level.boundary[(j + 1) % level.boundary.length]!)) {
            return { valid: false, reason: `Wall ${wall.id} solid crosses the level boundary` }
          }
        }
      }
    }
    for (let i = 0; i < scene.walls.length; i++) {
      const a = scene.walls[i]!
      for (const b of scene.walls.slice(i + 1)) {
        if (a.levelId !== b.levelId) continue
        const joined = [a.start, a.end].some(p => [b.start, b.end].some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1e-6))
        if (joined) continue
        const gap = Math.min(distanceToSegment(a.start, b.start, b.end), distanceToSegment(a.end, b.start, b.end), distanceToSegment(b.start, a.start, a.end), distanceToSegment(b.end, a.start, a.end))
        if (gap < (a.thicknessM + b.thicknessM) / 2 - 1e-6) return { valid: false, reason: `Wall ${a.id} solid collides with wall ${b.id}` }
      }
    }
    return { valid: true }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'Invalid wall geometry' }
  }
}

function distanceToSegment(point: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    const crossesY = (a[1] > point[1]) !== (b[1] > point[1])
    const crossesRight = point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
    if (crossesY && crossesRight) inside = !inside
  }
  return inside
}

function polygonArea(polygon: [number, number][]): number {
  let twiceArea = 0
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!, next = polygon[(i + 1) % polygon.length]!
    twiceArea += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(twiceArea) / 2
}

function selfIntersects(polygon: [number, number][]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const nextI = (i + 1) % polygon.length
    for (let j = i + 1; j < polygon.length; j++) {
      const nextJ = (j + 1) % polygon.length
      if (j === i || j === nextI || i === nextJ) continue
      if (segmentsIntersect(polygon[i]!, polygon[nextI]!, polygon[j]!, polygon[nextJ]!)) return true
    }
  }
  return false
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const abC = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1])
  const abD = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1])
  const cdA = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1])
  const cdB = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1])
  return abC * abD < 0 && cdA * cdB < 0
}
function unsupportedWallIntersection(a:[number,number],b:[number,number],c:[number,number],d:[number,number]):boolean{
  const eps=1e-6, shared:[[number,number],[number,number]][]=[]
  for(const p of [a,b])for(const q of [c,d])if(Math.hypot(p[0]-q[0],p[1]-q[1])<=eps)shared.push([p,q])
  const intersects=segmentsIntersect(a,b,c,d)||onSegment(a,c,d,eps)||onSegment(b,c,d,eps)||onSegment(c,a,b,eps)||onSegment(d,a,b,eps)
  if(!intersects)return false
  if(shared.length===0)return true
  const node=shared[0]![0], va=(Math.hypot(a[0]-node[0],a[1]-node[1])<=eps?b:a), vb=(Math.hypot(c[0]-node[0],c[1]-node[1])<=eps?d:c)
  const ax=va[0]-node[0],ay=va[1]-node[1],bx=vb[0]-node[0],by=vb[1]-node[1]
  return Math.abs(cross(ax,ay,bx,by))<=eps*Math.max(1,Math.hypot(ax,ay),Math.hypot(bx,by))&&ax*bx+ay*by>0
}
function onSegment(p:[number,number],a:[number,number],b:[number,number],eps:number):boolean{
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)
  return Math.abs(cross(dx,dy,p[0]-a[0],p[1]-a[1]))<=eps*Math.max(1,len)&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps
}
function dist2(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function stableStringify(value: unknown): string {
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${entries.join(',')}}`
}
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const words: number[] = Array.from(bytes)
  const bitLength = bytes.length * 8
  words.push(0x80)
  while (words.length % 64 !== 56) words.push(0)
  const highLength = Math.floor(bitLength / 0x100000000)
  const lowLength = bitLength >>> 0
  for (let i = 3; i >= 0; i--) words.push((highLength >>> (i * 8)) & 255)
  for (let i = 3; i >= 0; i--) words.push((lowLength >>> (i * 8)) & 255)
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  let h: [number, number, number, number, number, number, number, number] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < words.length; offset += 64) {
    const schedule = new Array<number>(64)
    for (let i = 0; i < 16; i++) {
      const start = offset + i * 4
      schedule[i] = (
        (words[start]! << 24)
        | (words[start + 1]! << 16)
        | (words[start + 2]! << 8)
        | words[start + 3]!
      ) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const a = schedule[i - 15]!, b = schedule[i - 2]!
      const sigma0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const sigma1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      schedule[i] = (schedule[i - 16]! + sigma0 + schedule[i - 7]! + sigma1) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const upperE = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (hh + upperE + choose + K[i]! + schedule[i]!) >>> 0
      const upperA = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (upperA + majority) >>> 0
      hh = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }

    const working: [number, number, number, number, number, number, number, number] = [a, b, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + working[i]!) >>> 0
  }

  return h.map(word => word.toString(16).padStart(8, '0')).join('')
}
