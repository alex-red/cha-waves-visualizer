import { parseScene, validatePlacement, validateWallGeometry, type Scene } from './engine'

export type HomeWallInput = {
  id: string
  start: [number, number]
  end: [number, number]
  thicknessM?: number
  materialId?: string
}

export type CreateHomeSceneOptions = {
  name?: string
  widthM: number
  depthM: number
  ceilingHeightM: number
  boundary?: [number, number][]
  interiorWalls?: HomeWallInput[]
}

/** Build a compact editable home with illustrative materials and safe initial placements. */
export function createHomeScene(options: CreateHomeSceneOptions): Scene {
  const { widthM, depthM, ceilingHeightM } = options
  if (![widthM, depthM, ceilingHeightM].every(Number.isFinite) || widthM <= 0 || depthM <= 0 || ceilingHeightM <= 0) {
    throw new Error('Home width, depth, and ceiling height must be positive finite metres')
  }
  const boundary = options.boundary?.map(point => [...point] as [number, number]) ?? [[0, 0], [widthM, 0], [widthM, depthM], [0, depthM]]
  const levelId = 'main'
  const name = options.name?.trim() || 'My home'
  const wallHeight = ceilingHeightM
  const materials: Scene['materials'] = [
    { id: 'home-exterior', name: 'Illustrative exterior wall', provenance: 'fixture-assumed', display: { color: '#64748b' }, acousticTransmissionDb: bands([[125, 18], [1000, 32], [4000, 38]]), radioLossDb: bands([[2.4e9, 15], [5e9, 20], [6e9, 22]]), acousticAbsorption: [] },
    { id: 'home-interior', name: 'Illustrative interior wall', provenance: 'fixture-assumed', display: { color: '#94a3b8' }, acousticTransmissionDb: bands([[125, 5], [1000, 11], [4000, 16]]), radioLossDb: bands([[2.4e9, 4], [5e9, 7], [6e9, 9]]), acousticAbsorption: [] },
    { id: 'home-door', name: 'Illustrative closed door leaf', provenance: 'fixture-assumed', display: { color: '#b08968' }, acousticTransmissionDb: bands([[125, 3], [1000, 7], [4000, 10]]), radioLossDb: bands([[2.4e9, 2], [5e9, 3], [6e9, 4]]), acousticAbsorption: [] },
  ]
  const walls: Scene['walls'] = boundary.map((start, index) => ({
    id: `envelope-${index + 1}`, levelId, start: [...start], end: [...boundary[(index + 1) % boundary.length]!],
    thicknessM: 0.2, baseZ: 0, heightM: wallHeight, materialId: 'home-exterior',
  }))
  for (const input of options.interiorWalls ?? []) walls.push({
    id: input.id, levelId, start: [...input.start], end: [...input.end], thicknessM: input.thicknessM ?? 0.12,
    baseZ: 0, heightM: wallHeight, materialId: input.materialId ?? 'home-interior',
  })

  const seed = findInteriorPoint(boundary)
  const initial: Scene = parseScene({
    id: slug(name), revision: 0,
    levels: [{ id: levelId, name: 'Main floor', boundary, floorZ: 0, ceilingHeightM }], zones: [], materials, walls, openings: [],
    emitters: [
      { id: 'home-speaker', levelId, domain: 'acoustics', position: [seed[0], seed[1], Math.min(1.2, ceilingHeightM)], active: true },
      { id: 'home-access-point', levelId, domain: 'radio', position: [seed[0], seed[1], Math.min(2.2, ceilingHeightM)], active: true, eirpDbm: 20 },
    ],
    probes: [{ id: 'home-probe', levelId, position: [seed[0], seed[1], Math.min(1.2, ceilingHeightM)], name: 'Measurement point' }],
  })
  const geometry = validateWallGeometry(initial)
  if (!geometry.valid) throw new Error(`Home geometry is invalid: ${geometry.reason}`)
  const { source, probe } = findClearPoints(initial)
  initial.emitters[0]!.position = [source[0], source[1], Math.min(1.2, ceilingHeightM)]
  initial.emitters[1]!.position = [source[0], source[1], Math.min(2.2, ceilingHeightM)]
  initial.probes[0]!.position = [probe[0], probe[1], Math.min(1.2, ceilingHeightM)]
  return parseScene(initial)
}

function bands(entries: readonly [number, number][]) {
  return entries.map(([frequencyHz, valueDb]) => ({ frequencyHz, valueDb, provenance: 'fixture-assumed' as const }))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'my-home'
}

function findClearPoints(scene: Scene): { source: [number, number]; probe: [number, number] } {
  const points = scene.levels[0]!.boundary
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const candidates: [number, number][] = []
  for (let row = 1; row <= 11; row++) for (let col = 1; col <= 11; col++) {
    candidates.push([minX + (maxX - minX) * col / 12, minY + (maxY - minY) * row / 12])
  }
  const clear = candidates.filter(([x, y]) => validatePlacement(scene, [x, y, Math.min(1.2, scene.levels[0]!.ceilingHeightM)]).valid)
  let pair: { source: [number, number]; probe: [number, number]; gap: number } | undefined
  for (let i = 0; i < clear.length; i++) for (let j = i + 1; j < clear.length; j++) {
    const source = clear[i]!, probe = clear[j]!, gap = Math.hypot(probe[0] - source[0], probe[1] - source[1])
    if (!pair || gap > pair.gap) pair = { source, probe, gap }
  }
  if (!pair || pair.gap < 1.05) throw new Error('Home must have room for a clear source and probe at least one metre apart')
  return { source: pair.source, probe: pair.probe }
}

function findInteriorPoint(polygon: [number, number][]): [number, number] {
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  for (let row = 1; row <= 11; row++) for (let col = 1; col <= 11; col++) {
    const point: [number, number] = [minX + (maxX - minX) * col / 12, minY + (maxY - minY) * row / 12]
    if (pointInPolygon(point, polygon)) return point
  }
  throw new Error('Home boundary has no usable interior')
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
