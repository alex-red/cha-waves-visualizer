export type DraftPoint = [number, number]
export type DraftWall = { id: string; start: DraftPoint; end: DraftPoint }
export type SnapFeedback = {
  point: DraftPoint
  raw: DraftPoint
  kind: 'endpoint' | 'grid'
  distanceM: number
  target?: { wallId: string; endpoint: 'start' | 'end' }
}
export type DimensionSegment = { id: string; start: DraftPoint; end: DraftPoint; selected?: boolean; draft?: boolean }
export type DimensionMark = {
  id: string
  wallStart: DraftPoint
  wallEnd: DraftPoint
  start: DraftPoint
  end: DraftPoint
  labelAnchor: DraftPoint
  labelAt: DraftPoint
  lengthM: number
  label: string
  selected?: boolean
  draft?: boolean
}

const ENDPOINT_SNAP_RADIUS_M = 0.25
const DIMENSION_OFFSET_PX = 16
const LABEL_GAP_PX = 9
const LABEL_HEIGHT_PX = 18
const SIDE_SAFE_PX = 32
const TOP_SAFE_PX = 60
// Reserve room for the multiline wall-tool readout on compact canvases.
const BOTTOM_SAFE_PX = 80
const MAX_DIMENSION_MARKS = 32

/** Match the editor's existing endpoint-first, then metre-grid snapping policy. */
export function snapDraftPoint(raw: DraftPoint, walls: readonly DraftWall[], gridStep: number): SnapFeedback {
  if (!raw.every(Number.isFinite)) throw new RangeError('Draft coordinates must be finite.')
  if (!Number.isFinite(gridStep) || gridStep <= 0) throw new RangeError('Grid step must be finite and positive.')

  let nearest: { point: DraftPoint; wallId: string; endpoint: 'start' | 'end' } | undefined
  let nearestDistance = ENDPOINT_SNAP_RADIUS_M
  for (const wall of walls) {
    for (const endpoint of ['start', 'end'] as const) {
      const candidate = wall[endpoint]
      if (!candidate.every(Number.isFinite)) continue
      const gap = Math.hypot(raw[0] - candidate[0], raw[1] - candidate[1])
      // Inclusive <= intentionally lets the last wall endpoint win a distance tie.
      if (gap <= nearestDistance) {
        nearest = { point: [...candidate], wallId: wall.id, endpoint }
        nearestDistance = gap
      }
    }
  }
  if (nearest) {
    return { point: [...nearest.point], raw: [...raw], kind: 'endpoint', distanceM: nearestDistance, target: { wallId: nearest.wallId, endpoint: nearest.endpoint } }
  }

  const point: DraftPoint = [roundToMillimeter(Math.round(raw[0] / gridStep) * gridStep), roundToMillimeter(Math.round(raw[1] / gridStep) * gridStep)]
  const distanceM = Math.hypot(raw[0] - point[0], raw[1] - point[1])
  if (!point.every(Number.isFinite) || !Number.isFinite(distanceM)) throw new RangeError('Grid snapping exceeds the finite coordinate range.')
  return { point, raw: [...raw], kind: 'grid', distanceM }
}

/** Lay out screen-space dimensions while keeping each label's metre length physical. */
export function layoutWallDimensions(
  segments: readonly DimensionSegment[],
  project: (point: DraftPoint) => DraftPoint,
  width: number,
  height: number,
): DimensionMark[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
  const safeLeft = SIDE_SAFE_PX, safeRight = width - SIDE_SAFE_PX
  const safeTop = TOP_SAFE_PX, safeBottom = height - BOTTOM_SAFE_PX
  if (safeRight <= safeLeft || safeBottom <= safeTop) return []

  const ordered = segments.map((segment, index) => ({ segment, index, priority: Number(!!segment.draft) * 2 + Number(!!segment.selected) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
  const placed: { mark: DimensionMark; box: Box }[] = []

  for (const { segment } of ordered) {
    if (!segment.start.every(Number.isFinite) || !segment.end.every(Number.isFinite)) continue
    const lengthM = Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1])
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue
    let a: DraftPoint, b: DraftPoint
    try { a = project([...segment.start]); b = project([...segment.end]) } catch { continue }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) continue
    const dx = b[0] - a[0], dy = b[1] - a[1], screenLength = Math.hypot(dx, dy)
    if (!Number.isFinite(screenLength) || screenLength <= 1e-6) continue
    if (!clipLineToRect(a, b, width, height)) continue
    const nx = -dy / screenLength, ny = dx / screenLength
    const label = `${lengthM.toFixed(2)} m`
    const boxWidth = estimateLabelWidth(label)
    if (boxWidth > safeRight - safeLeft) continue
    let chosen: { start: DraftPoint; end: DraftPoint; labelAnchor: DraftPoint; labelAt: DraftPoint; box: Box } | undefined

    for (const direction of [1, -1]) {
      const ox = nx * DIMENSION_OFFSET_PX * direction, oy = ny * DIMENSION_OFFSET_PX * direction
      const uncutStart: DraftPoint = [a[0] + ox, a[1] + oy]
      const uncutEnd: DraftPoint = [b[0] + ox, b[1] + oy]
      const clipped = clipLineToRect(uncutStart, uncutEnd, width, height)
      if (!clipped || Math.hypot(clipped[1][0] - clipped[0][0], clipped[1][1] - clipped[0][1]) < 1) continue
      const labelAnchor: DraftPoint = [(clipped[0][0] + clipped[1][0]) / 2, (clipped[0][1] + clipped[1][1]) / 2]
      const midpoint: DraftPoint = [labelAnchor[0] + nx * LABEL_GAP_PX * direction, labelAnchor[1] + ny * LABEL_GAP_PX * direction]
      const labelAt: DraftPoint = [clamp(midpoint[0], safeLeft + boxWidth / 2, safeRight - boxWidth / 2), clamp(midpoint[1], safeTop + LABEL_HEIGHT_PX / 2, safeBottom - LABEL_HEIGHT_PX / 2)]
      const box: Box = { left: labelAt[0] - boxWidth / 2, right: labelAt[0] + boxWidth / 2, top: labelAt[1] - LABEL_HEIGHT_PX / 2, bottom: labelAt[1] + LABEL_HEIGHT_PX / 2 }
      // Keep true endpoints for ticks/extensions; SVG clips them without inventing
      // measurement endpoints at the viewport edge. The label follows the visible span.
      if (!placed.some(item => overlaps(box, item.box))) { chosen = { start: uncutStart, end: uncutEnd, labelAnchor, labelAt, box }; break }
    }
    if (!chosen) continue
    const mark: DimensionMark = { id: segment.id, wallStart: a, wallEnd: b, start: chosen.start, end: chosen.end, labelAnchor: chosen.labelAnchor, labelAt: chosen.labelAt, lengthM, label, ...(segment.selected ? { selected: true } : {}), ...(segment.draft ? { draft: true } : {}) }
    placed.push({ mark, box: chosen.box })
    if (placed.length >= MAX_DIMENSION_MARKS) break
  }
  return placed.map(item => item.mark)
}

type Box = { left: number; right: number; top: number; bottom: number }
function roundToMillimeter(value: number): number { return Math.round(value * 1000) / 1000 }
function estimateLabelWidth(label: string): number { return label.length * 7 + 12 }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }
function overlaps(a: Box, b: Box): boolean { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top }

/** Liang–Barsky clipping keeps actual visible endpoints instead of trusting a bounding box. */
function clipLineToRect(start: DraftPoint, end: DraftPoint, width: number, height: number): [DraftPoint, DraftPoint] | null {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  let t0 = 0, t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const ratio = q / p
    if (p < 0) { if (ratio > t1) return false; if (ratio > t0) t0 = ratio }
    else { if (ratio < t0) return false; if (ratio < t1) t1 = ratio }
    return true
  }
  if (!clip(-dx, start[0]) || !clip(dx, width - start[0]) || !clip(-dy, start[1]) || !clip(dy, height - start[1]) || t1 < t0) return null
  return [[start[0] + t0 * dx, start[1] + t0 * dy], [start[0] + t1 * dx, start[1] + t1 * dy]]
}
