import {
  isExteriorEnvelopeWall,
  parseScene,
  validatePlacement,
  validateWallGeometry,
  type Scene,
} from './engine'
import { applyMaterialUpdate, type MaterialUpdate } from './materials'

export type SceneCommand =
  | { type: 'move-emitter'; emitterId: string; position: [number, number, number] }
  | { type: 'move-probe'; probeId: string; position: [number, number, number] }
  | { type: 'rename-probe'; probeId: string; name: string }
  | ({ type: 'update-material' } & MaterialUpdate)
  | { type: 'set-door-state'; openingId: string; isOpen: boolean }
  | { type: 'change-wall-material'; wallId: string; materialId: string }
  | { type: 'update-wall'; wallId: string; start?: [number, number]; end?: [number, number]; thicknessM?: number; materialId?: string }
  | { type: 'add-wall'; wall: Scene['walls'][number]; joinIntersections?: boolean }
  | { type: 'split-wall'; wallId: string; offsetM: number }
  | { type: 'remove-wall'; wallId: string }
  | { type: 'add-door'; openingId: string; wallId: string; offsetM: number; widthM: number; heightM?: number; sillAboveBaseM?: number; isOpen?: boolean; materialId?: string }
  | { type: 'add-opening'; opening: Scene['openings'][number] }
  | { type: 'remove-opening'; openingId: string }
  | { type: 'update-opening'; openingId: string; offsetM?: number; widthM?: number; fromT?: number; toT?: number; heightM?: number; sillAboveBaseM?: number; isOpen?: boolean; fixed?: boolean; materialId?: string }
  | { type: 'add-zone'; zone: Scene['zones'][number] }
  | { type: 'remove-zone'; zoneId: string }
  | { type: 'update-zone'; zoneId: string; name?: string; polygon?: [number, number][] }
  | { type: 'move-connected-endpoint'; levelId: string; from: [number, number]; to: [number, number] }
  | { type: 'add-probe'; probe: Scene['probes'][number] }
  | { type: 'remove-probe'; probeId: string }

export type SceneCommandErrorCode = 'UNKNOWN_ENTITY' | 'INVALID_COMMAND' | 'READ_ONLY_WALL' | 'CONNECTED_ENDPOINT' | 'INVALID_GEOMETRY'
export class SceneCommandError extends Error {
  constructor(public readonly code: SceneCommandErrorCode, message: string) {
    super(message)
    this.name = 'SceneCommandError'
  }
}

const EPSILON_M = 1e-6
export const WALL_ENDPOINT_SNAP_M = 0.1
export const MAX_WALLS = 256

/** Apply one validated scene edit and return a new scene at the next revision. */
export function applySceneCommand(sceneInput: Scene, command: SceneCommand): Scene {
  let original: Scene
  try { original = parseScene(sceneInput) } catch (error) {
    throw new SceneCommandError('INVALID_GEOMETRY', error instanceof Error ? error.message : 'Scene is invalid')
  }
  const next = structuredClone(original)

  switch (command.type) {
    case 'move-emitter': {
      const emitter = next.emitters.find(item => item.id === command.emitterId)
      if (!emitter) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown emitter ${command.emitterId}`)
      const placement = validatePlacement(next, command.position, emitter.levelId)
      if (!placement.valid) throw new SceneCommandError('INVALID_GEOMETRY', `Cannot move emitter: ${placement.reason}`)
      emitter.position = [...command.position]
      break
    }
    case 'move-probe': {
      const probe = next.probes.find(item => item.id === command.probeId)
      if (!probe) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown probe ${command.probeId}`)
      const placement = validatePlacement(next, command.position, probe.levelId)
      if (!placement.valid) throw new SceneCommandError('INVALID_GEOMETRY', `Cannot move probe: ${placement.reason}`)
      probe.position = [...command.position]
      break
    }
    case 'rename-probe': {
      const probe = next.probes.find(item => item.id === command.probeId)
      if (!probe) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown probe ${command.probeId}`)
      if (typeof command.name !== 'string') throw new SceneCommandError('INVALID_COMMAND', 'Probe name must contain 1 to 80 characters')
      const name = command.name.trim()
      if (name.length < 1 || name.length > 80) throw new SceneCommandError('INVALID_COMMAND', 'Probe name must contain 1 to 80 characters')
      probe.name = name
      break
    }
    case 'update-material': {
      if (!next.materials.some(item => item.id === command.materialId)) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown material ${command.materialId}`)
      try {
        next.materials = applyMaterialUpdate(next, command).materials
      } catch (error) {
        throw new SceneCommandError('INVALID_COMMAND', error instanceof Error ? error.message : 'Material profile is invalid')
      }
      break
    }
    case 'set-door-state': {
      const opening = next.openings.find(item => item.id === command.openingId)
      if (!opening) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown opening ${command.openingId}`)
      if (opening.kind !== 'door') throw new SceneCommandError('INVALID_COMMAND', `Opening ${opening.id} is not a door`)
      opening.isOpen = command.isOpen
      break
    }
    case 'change-wall-material': {
      const wall = next.walls.find(item => item.id === command.wallId)
      if (!wall) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown wall ${command.wallId}`)
      if (!next.materials.some(item => item.id === command.materialId)) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown material ${command.materialId}`)
      wall.materialId = command.materialId
      break
    }
    case 'update-wall': {
      const wall = next.walls.find(item => item.id === command.wallId)
      if (!wall) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown wall ${command.wallId}`)
      if (isExteriorEnvelopeWall(original, wall)) throw new SceneCommandError('READ_ONLY_WALL', `Exterior envelope wall ${wall.id} is read-only`)
      const start = command.start ?? wall.start
      const end = command.end ?? wall.end
      for (const endpoint of [wall.start, wall.end]) {
        const shared = original.walls.some(other => other.id !== wall.id && [other.start, other.end].some(point => samePoint(endpoint, point)))
        if (shared && ![start, end].some(point => samePoint(endpoint, point))) {
          throw new SceneCommandError('CONNECTED_ENDPOINT', `Wall ${wall.id} has a shared endpoint; keep it fixed or edit all connected walls together`)
        }
      }
      wall.start = [...start]
      wall.end = [...end]
      if (command.thicknessM !== undefined) wall.thicknessM = command.thicknessM
      if (command.materialId !== undefined) wall.materialId = command.materialId
      let parsed: Scene
      try { parsed = parseScene(next) } catch (error) {
        throw new SceneCommandError('INVALID_GEOMETRY', error instanceof Error ? error.message : 'Wall edit is invalid')
      }
      const wallGeometry = validateWallGeometry(parsed)
      if (!wallGeometry.valid) throw new SceneCommandError('INVALID_GEOMETRY', wallGeometry.reason)
      ensureNoSolidCollisions(parsed, wall.id)
      for (const emitter of parsed.emitters) {
        const placement = validatePlacement(parsed, emitter.position, emitter.levelId)
        if (!placement.valid) throw new SceneCommandError('INVALID_GEOMETRY', `Wall edit would obstruct emitter ${emitter.id}: ${placement.reason}`)
      }
      for (const probe of parsed.probes) {
        const placement = validatePlacement(parsed, probe.position, probe.levelId)
        if (!placement.valid) throw new SceneCommandError('INVALID_GEOMETRY', `Wall edit would obstruct probe ${probe.id}: ${placement.reason}`)
      }
      break
    }
    case 'add-wall': {
      const wall = structuredClone(command.wall)
      if (!wall || typeof wall.id !== 'string' || !wall.id || allEntityIds(next).has(wall.id)) throw new SceneCommandError('INVALID_COMMAND', `Wall ID ${wall?.id ?? ''} is empty or already in use`)
      if (![...wall.start, ...wall.end, wall.thicknessM, wall.baseZ, wall.heightM].every(Number.isFinite)) throw new SceneCommandError('INVALID_COMMAND', 'Wall points and dimensions must be finite')
      wall.start = snapToWallEndpoints(next, wall.levelId, wall.start)
      wall.end = snapToWallEndpoints(next, wall.levelId, wall.end)
      if (command.joinIntersections) {
        applyJunctionWall(next, wall)
        break
      }
      if (next.walls.length >= MAX_WALLS) throw new SceneCommandError('INVALID_COMMAND', `A scene can contain at most ${MAX_WALLS} walls`)
      next.walls.push(wall)
      validateEditedScene(next)
      break
    }
    case 'split-wall': {
      const wall = next.walls.find(item => item.id === command.wallId)
      if (!wall) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown wall ${command.wallId}`)
      if (!Number.isFinite(command.offsetM)) throw new SceneCommandError('INVALID_COMMAND', 'Wall split offset must be finite')
      if (command.offsetM < WALL_ENDPOINT_SNAP_M - EPSILON_M || command.offsetM > wallLength(wall) - WALL_ENDPOINT_SNAP_M + EPSILON_M) throw new SceneCommandError('INVALID_COMMAND', 'Wall split must leave segments at least 0.1 m long')
      splitWallsAtOffsets(next, new Map([[wall.id, [command.offsetM]]]))
      validateEditedScene(next)
      break
    }
    case 'remove-wall': {
      const wall = next.walls.find(item => item.id === command.wallId)
      if (!wall) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown wall ${command.wallId}`)
      if (isExteriorEnvelopeWall(original, wall)) throw new SceneCommandError('READ_ONLY_WALL', `Exterior envelope wall ${wall.id} is read-only`)
      next.walls = next.walls.filter(item => item.id !== wall.id)
      next.openings = next.openings.filter(item => item.wallId !== wall.id)
      validateEditedScene(next)
      break
    }
    case 'add-door': {
      const wall = next.walls.find(item => item.id === command.wallId)
      if (!wall) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown wall ${command.wallId}`)
      const length = wallLength(wall)
      if (!Number.isFinite(command.offsetM) || !Number.isFinite(command.widthM) || command.offsetM < 0 || command.widthM <= 0 || command.offsetM + command.widthM > length + EPSILON_M) throw new SceneCommandError('INVALID_COMMAND', 'Door offset and width must fit along its wall')
      const materialId = command.materialId ?? next.materials.find(material => material.id.includes('door'))?.id
      if (!materialId) throw new SceneCommandError('INVALID_COMMAND', 'Door requires an explicit leaf material')
      next.openings.push({ id: command.openingId, wallId: wall.id, fromT: command.offsetM / length, toT: (command.offsetM + command.widthM) / length, sillAboveBaseM: command.sillAboveBaseM ?? 0, heightM: command.heightM ?? 2.1, kind: 'door', isOpen: command.isOpen ?? false, fixed: false, materialId })
      validateEditedScene(next)
      break
    }
    case 'add-opening': {
      next.openings.push(structuredClone(command.opening))
      validateEditedScene(next)
      break
    }
    case 'remove-opening': {
      if (!next.openings.some(item => item.id === command.openingId)) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown opening ${command.openingId}`)
      next.openings = next.openings.filter(item => item.id !== command.openingId)
      validateEditedScene(next)
      break
    }
    case 'update-opening': {
      const opening = next.openings.find(item => item.id === command.openingId)
      if (!opening) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown opening ${command.openingId}`)
      const wall = next.walls.find(item => item.id === opening.wallId)!
      const length = wallLength(wall)
      if (command.offsetM !== undefined || command.widthM !== undefined) {
        const offset = command.offsetM ?? opening.fromT * length
        const width = command.widthM ?? (opening.toT - opening.fromT) * length
        if (!Number.isFinite(offset) || !Number.isFinite(width) || offset < 0 || width <= 0 || offset + width > length + EPSILON_M) throw new SceneCommandError('INVALID_COMMAND', 'Opening offset and width must fit along its wall')
        opening.fromT = offset / length; opening.toT = (offset + width) / length
      }
      if (command.fromT !== undefined) opening.fromT = command.fromT
      if (command.toT !== undefined) opening.toT = command.toT
      if (command.heightM !== undefined) opening.heightM = command.heightM
      if (command.sillAboveBaseM !== undefined) opening.sillAboveBaseM = command.sillAboveBaseM
      if (command.isOpen !== undefined) opening.isOpen = command.isOpen
      if (command.fixed !== undefined) opening.fixed = command.fixed
      if (command.materialId !== undefined) opening.materialId = command.materialId
      validateEditedScene(next)
      break
    }
    case 'add-zone': {
      next.zones.push(structuredClone(command.zone)); validateEditedScene(next); break
    }
    case 'remove-zone': {
      if (!next.zones.some(item => item.id === command.zoneId)) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown zone ${command.zoneId}`)
      next.zones = next.zones.filter(item => item.id !== command.zoneId); validateEditedScene(next); break
    }
    case 'update-zone': {
      const zone = next.zones.find(item => item.id === command.zoneId)
      if (!zone) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown zone ${command.zoneId}`)
      if (command.name !== undefined) zone.name = command.name
      if (command.polygon !== undefined) zone.polygon = structuredClone(command.polygon)
      validateEditedScene(next); break
    }
    case 'move-connected-endpoint': {
      const connected = next.walls.filter(wall => wall.levelId === command.levelId && [wall.start, wall.end].some(point => samePoint(point, command.from)))
      if (!connected.length) throw new SceneCommandError('UNKNOWN_ENTITY', 'No wall endpoint exists at the requested point')
      if (connected.some(wall => isExteriorEnvelopeWall(original, wall))) throw new SceneCommandError('READ_ONLY_WALL', 'Connected endpoint includes an exterior envelope wall')
      for (const wall of connected) {
        if (samePoint(wall.start, command.from)) wall.start = [...command.to]
        if (samePoint(wall.end, command.from)) wall.end = [...command.to]
      }
      validateEditedScene(next)
      break
    }
    case 'add-probe': {
      next.probes.push(structuredClone(command.probe)); validateEditedScene(next); break
    }
    case 'remove-probe': {
      if (!next.probes.some(item => item.id === command.probeId)) throw new SceneCommandError('UNKNOWN_ENTITY', `Unknown probe ${command.probeId}`)
      if (next.probes.length <= 1) throw new SceneCommandError('INVALID_COMMAND', 'A scene must keep at least one probe')
      next.probes = next.probes.filter(item => item.id !== command.probeId); validateEditedScene(next); break
    }
    default: {
      const exhaustive: never = command
      throw new SceneCommandError('INVALID_COMMAND', `Unsupported command: ${String(exhaustive)}`)
    }
  }

  // A state change such as closing an occupied doorway must remain a valid
  // scene for persistence as well as for the selected command's own geometry.
  for (const entity of [...next.emitters, ...next.probes]) {
    const placement = validatePlacement(next, entity.position, entity.levelId)
    if (!placement.valid) throw new SceneCommandError('INVALID_GEOMETRY', `Command would obstruct ${entity.id}: ${placement.reason}`)
  }
  next.revision = original.revision + 1
  try { return parseScene(next) } catch (error) {
    throw new SceneCommandError('INVALID_GEOMETRY', error instanceof Error ? error.message : 'Command produced an invalid scene')
  }
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON_M
}

function wallLength(wall: Scene['walls'][number]): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function snapToWallEndpoints(scene: Scene, levelId: string, point: [number, number]): [number, number] {
  let nearest: [number, number] | undefined, nearestDistance = WALL_ENDPOINT_SNAP_M
  for (const wall of scene.walls) {
    if (wall.levelId !== levelId) continue
    for (const endpoint of [wall.start, wall.end]) {
      const distance = Math.hypot(point[0] - endpoint[0], point[1] - endpoint[1])
      if (distance <= nearestDistance) { nearest = endpoint; nearestDistance = distance }
    }
  }
  return nearest ? [...nearest] : [...point]
}

function allEntityIds(scene: Scene): Set<string> {
  return new Set([scene.id, ...scene.levels.map(item => item.id), ...scene.zones.map(item => item.id), ...scene.materials.map(item => item.id), ...scene.walls.map(item => item.id), ...scene.openings.map(item => item.id), ...scene.emitters.map(item => item.id), ...scene.probes.map(item => item.id)])
}

function applyJunctionWall(scene: Scene, proposed: Scene['walls'][number]): void {
  const cuts = new Map<string, number[]>([[proposed.id, []]])
  for (const other of scene.walls) {
    if (other.levelId !== proposed.levelId || !verticalOverlap(other, proposed)) continue
    const hits = intersectionParameters(proposed.start, proposed.end, other.start, other.end)
    if (hits) {
      const [t, u] = hits
      const proposedOffset = t * wallLength(proposed), otherOffset = u * wallLength(other)
      if (proposedOffset > EPSILON_M && proposedOffset < wallLength(proposed) - EPSILON_M) cuts.get(proposed.id)!.push(proposedOffset)
      if (otherOffset > EPSILON_M && otherOffset < wallLength(other) - EPSILON_M) cuts.set(other.id, [...(cuts.get(other.id) ?? []), otherOffset])
    }
    // Collinear geometry is deliberately not converted into a junction.
  }
  splitWallsAtOffsets(scene, cuts, proposed)
  validateEditedScene(scene)
}

function verticalOverlap(a: Scene['walls'][number], b: Scene['walls'][number]): boolean {
  return Math.min(a.baseZ + a.heightM, b.baseZ + b.heightM) - Math.max(a.baseZ, b.baseZ) > EPSILON_M
}

function intersectionParameters(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): [number, number] | undefined {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (Math.abs(den) <= 1e-12) return undefined
  const qx = c[0] - a[0], qy = c[1] - a[1]
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den
  const aLength = Math.hypot(rx, ry), bLength = Math.hypot(sx, sy)
  if (t < -EPSILON_M / aLength || t > 1 + EPSILON_M / aLength || u < -EPSILON_M / bLength || u > 1 + EPSILON_M / bLength) return undefined
  return [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))]
}

function splitWallsAtOffsets(scene: Scene, cuts: Map<string, number[]>, proposed?: Scene['walls'][number]): void {
  const sourceWalls = [...scene.walls, ...(proposed ? [proposed] : [])]
  const reserved = allEntityIds(scene)
  if (proposed) reserved.add(proposed.id)
  const replacements = new Map<string, Scene['walls']>()
  const openingMoves = new Map<string, Scene['openings'][number]>()
  let expandedCount = scene.walls.length + (proposed ? 1 : 0)
  for (const source of sourceWalls) {
    const offsets = [...(cuts.get(source.id) ?? [])].sort((a, b) => a - b)
    const length = wallLength(source)
    const unique = offsets.filter((value, i) => Number.isFinite(value) && value > EPSILON_M && value < length - EPSILON_M && (i === 0 || Math.abs(value - offsets[i - 1]!) > EPSILON_M))
    if (unique.length === 0) continue
    if (scene.walls.some(item => item.id === source.id) && isExteriorEnvelopeWall(scene, source)) throw new SceneCommandError('READ_ONLY_WALL', `Exterior envelope wall ${source.id} cannot be cut`)
    const boundaries = [0, ...unique, length]
    const openingSpans = scene.openings.filter(item => item.wallId === source.id).map(item => ({ item, from: item.fromT * length, to: item.toT * length }))
    for (const offset of unique) {
      if (openingSpans.some(span => Math.abs(offset - span.from) <= EPSILON_M || Math.abs(offset - span.to) <= EPSILON_M || (offset > span.from && offset < span.to))) {
        throw new SceneCommandError('INVALID_GEOMETRY', `Cannot cut wall ${source.id} through or beside an opening; move the junction away from the opening`)
      }
    }
    const dx = (source.end[0] - source.start[0]) / length, dy = (source.end[1] - source.start[1]) / length
    const parts = boundaries.slice(0, -1).map((from, index) => {
      const to = boundaries[index + 1]!
      if (to - from < WALL_ENDPOINT_SNAP_M - EPSILON_M) throw new SceneCommandError('INVALID_GEOMETRY', `Wall ${source.id} would have a segment shorter than 0.1 m; move the junction`)
      const id = index === 0 ? source.id : allocatePartId(source.id, index + 1, reserved)
      return { ...structuredClone(source), id, start: [source.start[0] + dx * from, source.start[1] + dy * from] as [number, number], end: [source.start[0] + dx * to, source.start[1] + dy * to] as [number, number] }
    })
    replacements.set(source.id, parts)
    expandedCount += parts.length - 1
    for (const span of openingSpans) {
      const partIndex = boundaries.slice(0, -1).findIndex((from, index) => span.from >= from - EPSILON_M && span.to <= boundaries[index + 1]! + EPSILON_M)
      if (partIndex < 0) throw new SceneCommandError('INVALID_GEOMETRY', `Opening ${span.item.id} would span a junction; move the junction away from the opening`)
      const from = boundaries[partIndex]!, partLength = boundaries[partIndex + 1]! - from
      openingMoves.set(span.item.id, { ...span.item, wallId: parts[partIndex]!.id, fromT: (span.from - from) / partLength, toT: (span.to - from) / partLength })
    }
  }
  if (expandedCount > MAX_WALLS) throw new SceneCommandError('INVALID_COMMAND', `Wall junction would exceed the ${MAX_WALLS}-wall scene limit`)
  const updated: Scene['walls'] = []
  for (const existing of scene.walls) updated.push(...(replacements.get(existing.id) ?? [existing]))
  if (proposed) updated.push(...(replacements.get(proposed.id) ?? [proposed]))
  scene.walls = updated
  scene.openings = scene.openings.map(item => openingMoves.get(item.id) ?? item)
}

function allocatePartId(base: string, part: number, reserved: Set<string>): string {
  let candidate = `${base}-part-${part}`, suffix = 2
  while (reserved.has(candidate)) candidate = `${base}-part-${part}-${suffix++}`
  reserved.add(candidate)
  return candidate
}

function validateEditedScene(scene: Scene): void {
  let parsed: Scene
  try { parsed = parseScene(scene) } catch (error) {
    throw new SceneCommandError('INVALID_GEOMETRY', error instanceof Error ? error.message : 'Edited scene is invalid')
  }
  const geometry = validateWallGeometry(parsed)
  if (!geometry.valid) throw new SceneCommandError('INVALID_GEOMETRY', geometry.reason)
  for (const entity of [...parsed.emitters, ...parsed.probes]) {
    const placement = validatePlacement(parsed, entity.position, entity.levelId)
    if (!placement.valid) throw new SceneCommandError('INVALID_GEOMETRY', `Edit would obstruct ${entity.id}: ${placement.reason}`)
  }
}

function ensureNoSolidCollisions(scene: Scene, editedWallId: string): void {
  const edited = scene.walls.find(item => item.id === editedWallId)!
  for (const other of scene.walls) {
    if (other.id === editedWallId || other.levelId !== edited.levelId) continue
    const connected = [edited.start, edited.end].some(a => [other.start, other.end].some(b => samePoint(a, b)))
    if (connected) continue
    const gap = segmentDistance(edited.start, edited.end, other.start, other.end)
    if (gap < (edited.thicknessM + other.thicknessM) / 2 - EPSILON_M) {
      throw new SceneCommandError('INVALID_GEOMETRY', `Wall ${edited.id} solid collides with wall ${other.id}`)
    }
  }
}

function segmentDistance(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function pointSegmentDistance(point: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx
  const orient = (p: [number, number], q: [number, number], r: [number, number]) => cross(q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1])
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}
