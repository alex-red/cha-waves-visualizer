import { evaluatePoints, parseScene, validatePlacement, type PointResult, type Scene, type SolverSettings } from './engine'

export type PlacementObjective = 'maximize-weakest' | 'minimize-loudest'
export type PlacementOptions = { probeIds: string[]; objective: PlacementObjective; maxCandidates: number }
export type ProbeEstimate = { id: string; name: string; valid: boolean; value?: number; reason?: string }
export type PlacementCandidate = { position: [number, number, number]; score: number; weakest: number; loudest: number; distanceM: number; readings: ProbeEstimate[] }
export type PlacementResult = { sourceId: string; objective: PlacementObjective; unit: 'dB' | 'dBm'; baseline: { position: [number, number, number]; score: number | null; readings: ProbeEstimate[] }; candidates: PlacementCandidate[]; sampledCount: number; validCount: number; excludedPlacementCount: number; excludedEstimateCount: number; spacingM: [number, number] }
export const MAX_PLACEMENT_CANDIDATES = 256

export async function searchPlacements(
  sceneInput: Scene,
  settings: SolverSettings,
  options: PlacementOptions,
  callbacks?: { cancelled?: () => boolean; onProgress?: (done: number, total: number) => void },
): Promise<PlacementResult> {
  const scene = parseScene(sceneInput)
  // Validate settings even when every candidate will later fail placement checks.
  evaluatePoints(scene, settings, [])
  // Let the engine own settings validation and domain-specific query rules.
  const domain = settings.mode
  if (options.objective !== 'maximize-weakest' && options.objective !== 'minimize-loudest') throw new Error('Invalid placement objective')
  const source = scene.emitters.find(item => item.domain === domain && item.active)
  if (!source) throw new Error(`No active ${domain} source`)
  if (!Array.isArray(options.probeIds) || options.probeIds.length === 0 || options.probeIds.length > 64 || new Set(options.probeIds).size !== options.probeIds.length) throw new Error('Select 1–64 unique probes')
  const probes = options.probeIds.map(id => scene.probes.find(item => item.id === id))
  if (probes.some(probe => !probe || probe.levelId !== source.levelId)) throw new Error('Every selected probe must exist on the source level')
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 2 || options.maxCandidates > MAX_PLACEMENT_CANDIDATES) throw new Error(`maxCandidates must be an integer from 2 to ${MAX_PLACEMENT_CANDIDATES}`)
  const level = scene.levels.find(item => item.id === source.levelId)
  if (!level) throw new Error('Source level does not exist')
  const xs = level.boundary.map(point => point[0]), ys = level.boundary.map(point => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const width = maxX - minX, height = maxY - minY
  if (![minX, maxX, minY, maxY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Source level has invalid placement bounds')
  const slots = options.maxCandidates - 1
  const aspect = width / height
  const idealCols = Number.isFinite(aspect) ? Math.sqrt(slots * aspect) : (aspect === Infinity ? slots : 1)
  const cols = Math.min(slots, Math.max(1, Math.floor(Number.isFinite(idealCols) ? idealCols : (idealCols > 0 ? slots : 1))))
  const rows = Math.max(1, Math.floor(slots / cols))
  const spacingM: [number, number] = [width / cols, height / rows]
  const sites: [number, number, number][] = [[...source.position] as [number, number, number]]
  const seen = new Set([siteKey(sites[0]!)])
  for (let row = 0; row < rows && sites.length < options.maxCandidates; row++) for (let col = 0; col < cols && sites.length < options.maxCandidates; col++) {
    const position: [number, number, number] = [minX + (col + 0.5) * spacingM[0], minY + (row + 0.5) * spacingM[1], source.position[2]]
    const key = siteKey(position)
    if (!seen.has(key)) { seen.add(key); sites.push(position) }
  }

  const total = sites.length, scored: PlacementCandidate[] = []
  let excludedPlacementCount = 0, excludedEstimateCount = 0
  let baseline: PlacementResult['baseline'] | undefined
  const baselinePosition: [number, number, number] = [...source.position]
  const checkCancelled = () => { if (callbacks?.cancelled?.()) throw new Error('Placement search cancelled') }
  for (let offset = 0; offset < sites.length; offset += 4) {
    checkCancelled()
    const batch = sites.slice(offset, offset + 4)
    for (const position of batch) {
      const placement = validatePlacement(scene, position, source.levelId)
      if (!placement.valid) {
        excludedPlacementCount++
        if (samePosition(position, baselinePosition)) baseline = { position: [...baselinePosition], score: null, readings: probes.map(probe => ({ id: probe!.id, name: probe!.name ?? probe!.id, valid: false, reason: placement.reason })) }
        continue
      }
      const candidateScene = { ...scene, emitters: scene.emitters.map(emitter => emitter.id === source.id ? { ...emitter, position: [...position] as [number, number, number] } : emitter) }
      const points = probes.map(probe => [...probe!.position] as [number, number, number])
      const results = evaluatePoints(candidateScene, settings, points)
      const readings = results.map((result, index) => estimate(probes[index]!, result))
      const values = results.map(result => result.valid && Number.isFinite(result.value) ? result.value! : undefined)
      const isBaseline = samePosition(position, baselinePosition)
      if (values.some(value => value === undefined)) {
        excludedEstimateCount++
        if (isBaseline) baseline = { position: [...baselinePosition], score: null, readings }
        continue
      }
      const numeric = values as number[]
      const weakest = Math.min(...numeric), loudest = Math.max(...numeric)
      const score = options.objective === 'maximize-weakest' ? weakest : loudest
      const candidate: PlacementCandidate = { position: [...position], score, weakest, loudest, distanceM: Math.hypot(position[0] - source.position[0], position[1] - source.position[1], position[2] - source.position[2]), readings }
      scored.push(candidate)
      if (isBaseline) baseline = { position: [...baselinePosition], score, readings: cloneReadings(readings) }
    }
    callbacks?.onProgress?.(Math.min(offset + batch.length, total), total)
    if (offset + 4 < total) await new Promise<void>(resolve => setTimeout(resolve, 0))
    checkCancelled()
  }
  if (!baseline) baseline = { position: [...baselinePosition], score: null, readings: probes.map(probe => ({ id: probe!.id, name: probe!.name ?? probe!.id, valid: false, reason: 'outside-floor' })) }
  scored.sort((a, b) => options.objective === 'maximize-weakest' ? b.score - a.score || a.distanceM - b.distanceM || a.position[0] - b.position[0] || a.position[1] - b.position[1] : a.score - b.score || a.distanceM - b.distanceM || a.position[0] - b.position[0] || a.position[1] - b.position[1])
  return { sourceId: source.id, objective: options.objective, unit: domain === 'acoustics' ? 'dB' : 'dBm', baseline: { ...baseline, position: [...baseline.position], readings: cloneReadings(baseline.readings) }, candidates: scored.slice(0, 5).map(candidate => ({ ...candidate, position: [...candidate.position], readings: cloneReadings(candidate.readings) })), sampledCount: total, validCount: scored.length, excludedPlacementCount, excludedEstimateCount, spacingM: [...spacingM] }
}

function estimate(probe: NonNullable<Scene['probes'][number]>, result: PointResult): ProbeEstimate {
  const output: ProbeEstimate = { id: probe.id, name: probe.name ?? probe.id, valid: result.valid && Number.isFinite(result.value) }
  if (output.valid && result.value !== undefined) output.value = result.value
  else if (result.reason) output.reason = result.reason
  else output.reason = 'unsupported-geometry'
  return output
}
function cloneReadings(readings: ProbeEstimate[]): ProbeEstimate[] { return readings.map(reading => ({ ...reading })) }
function siteKey(position: [number, number, number]): string { return JSON.stringify(position) }
function samePosition(a: [number, number, number], b: [number, number, number]): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] }
