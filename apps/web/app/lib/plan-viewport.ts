export type PlanPoint = [number, number]
export type PlanBounds = { minX: number; maxX: number; minY: number; maxY: number }
export type PlanView = { zoom: number; center: PlanPoint }

export const MIN_PLAN_ZOOM = 0.5
export const MAX_PLAN_ZOOM = 8

/** A fit view is centered on the home bounds; its zoom is relative to the fit scale. */
export function fitPlanView(bounds: PlanBounds): PlanView {
  validateBounds(bounds)
  return { zoom: 1, center: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2] }
}

export function createPlanTransform(bounds: PlanBounds, width: number, height: number, view: PlanView) {
  validateBounds(bounds)
  const viewportWidth = usableDimension(width)
  const viewportHeight = usableDimension(height)
  const center = sanitizedCenter(bounds, view.center)
  const zoom = clampZoom(view.zoom)
  const padding = Math.min(80, viewportWidth * 0.1)
  const fitScale = Math.min(
    Math.max(1e-9, viewportWidth - 2 * padding) / (bounds.maxX - bounds.minX),
    Math.max(1e-9, viewportHeight - 2 * padding) / (bounds.maxY - bounds.minY),
  )
  const scale = Math.min(Number.MAX_VALUE, Math.max(Number.MIN_VALUE, fitScale * zoom))
  return {
    scale,
    worldToScreen(point: PlanPoint): PlanPoint {
      return [viewportWidth / 2 + (point[0] - center[0]) * scale, viewportHeight / 2 - (point[1] - center[1]) * scale]
    },
    screenToWorld(point: PlanPoint): PlanPoint {
      return [center[0] + (point[0] - viewportWidth / 2) / scale, center[1] - (point[1] - viewportHeight / 2) / scale]
    },
  }
}

/** Zoom around a CSS-pixel anchor, keeping the world coordinate under it fixed. */
export function zoomPlanView(
  bounds: PlanBounds,
  width: number,
  height: number,
  view: PlanView,
  factor: number,
  anchor?: PlanPoint,
): PlanView {
  const transform = createPlanTransform(bounds, width, height, view)
  const viewportWidth = usableDimension(width)
  const viewportHeight = usableDimension(height)
  const pivot = anchor && anchor.every(Number.isFinite) ? anchor : [viewportWidth / 2, viewportHeight / 2] as PlanPoint
  if (!Number.isFinite(factor) || factor <= 0) return { zoom: clampZoom(view.zoom), center: sanitizedCenter(bounds, view.center) }
  const worldAnchor = transform.screenToWorld(pivot)
  const zoom = clampZoom(clampZoom(view.zoom) * factor)
  const scale = createPlanTransform(bounds, width, height, { zoom, center: worldAnchor }).scale
  return {
    zoom,
    center: [
      worldAnchor[0] - (pivot[0] - viewportWidth / 2) / scale,
      worldAnchor[1] + (pivot[1] - viewportHeight / 2) / scale,
    ],
  }
}

/** Move the plan by CSS pixels; positive delta moves the drawing right and down. */
export function panPlanView(
  bounds: PlanBounds,
  width: number,
  height: number,
  view: PlanView,
  delta: PlanPoint,
): PlanView {
  const transform = createPlanTransform(bounds, width, height, view)
  const center = sanitizedCenter(bounds, view.center)
  if (!delta.every(Number.isFinite)) return { zoom: clampZoom(view.zoom), center }
  return {
    zoom: clampZoom(view.zoom),
    center: [center[0] - delta[0] / transform.scale, center[1] + delta[1] / transform.scale],
  }
}

function validateBounds(bounds: PlanBounds): void {
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY
    || !Number.isFinite(bounds.maxX - bounds.minX) || !Number.isFinite(bounds.maxY - bounds.minY)) {
    throw new RangeError('Plan bounds must be finite and have positive width and height.')
  }
}

function usableDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function sanitizedCenter(bounds: PlanBounds, center: PlanPoint): PlanPoint {
  return Array.isArray(center) && center.length === 2 && center.every(Number.isFinite)
    ? [center[0], center[1]]
    : [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]
}

function clampZoom(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_PLAN_ZOOM, Math.min(MAX_PLAN_ZOOM, value)) : 1
}
