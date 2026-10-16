import type { FieldResult } from './engine'
import { MASK_REASON } from './engine'

export type RfCoverageSummary = {
  thresholdDbm: number
  totalCount: number
  validCount: number
  aboveCount: number
  excludedCount: number
  validAreaM2: number
  aboveAreaM2: number
  excludedAreaM2: number
  percentOfValid: number | null
  cellSizeM: number
  receiverZM: number
  excludedByReason: Record<string, number>
}

/** Summarize sampled Wi-Fi coverage. Areas approximate the sampled grid area. */
export function summarizeRfCoverage(field: FieldResult, thresholdDbm: number): RfCoverageSummary {
  if (!Number.isFinite(thresholdDbm)) throw new RangeError('Coverage threshold must be finite')
  if (field.identity.solverId !== 'rf-fspl-multiwall-v1' || field.quantity !== 'received-power-dbm' || field.unit !== 'dBm') {
    throw new TypeError('Coverage requires an RF received-power field in dBm')
  }

  const { cols, rows, cellSizeM, receiverZM } = field.grid
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) throw new RangeError('Field dimensions must be positive integers')
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0 || !Number.isFinite(receiverZM)) throw new RangeError('Field cell size and receiver height must be finite and cell size positive')
  const totalCount = cols * rows
  if (!Number.isSafeInteger(totalCount) || field.values.length !== totalCount || field.validity.length !== totalCount) {
    throw new RangeError('Field arrays must match the grid dimensions')
  }

  const excludedByReason: Record<string, number> = {}
  const reasonNames: Record<number, string> = {
    [MASK_REASON.outsideFloor]: 'outsideFloor',
    [MASK_REASON.insideSolid]: 'insideSolid',
    [MASK_REASON.belowModelDistance]: 'belowModelDistance',
    [MASK_REASON.missingParameter]: 'missingParameter',
    [MASK_REASON.unsupportedGeometry]: 'unsupportedGeometry',
  }
  let validCount = 0, aboveCount = 0, excludedCount = 0
  for (let i = 0; i < totalCount; i++) {
    const mask = field.validity[i]!
    if (!Number.isInteger(mask) || mask < 0 || mask > MASK_REASON.unsupportedGeometry) throw new RangeError(`Unknown validity mask ${mask}`)
    if (mask === MASK_REASON.valid) {
      if (!Number.isFinite(field.values[i])) throw new RangeError('Valid field cells must contain finite values')
      validCount++
      if (field.values[i]! >= thresholdDbm) aboveCount++
    } else {
      excludedCount++
      const reason = reasonNames[mask]!
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1
    }
  }
  const cellArea = cellSizeM * cellSizeM
  if (!Number.isFinite(cellArea)) throw new RangeError('Cell area must be finite')
  const validAreaM2 = validCount * cellArea
  const aboveAreaM2 = aboveCount * cellArea
  const excludedAreaM2 = excludedCount * cellArea
  if (![validAreaM2, aboveAreaM2, excludedAreaM2].every(Number.isFinite)) throw new RangeError('Coverage areas must be finite')
  return {
    thresholdDbm, totalCount, validCount, aboveCount, excludedCount,
    validAreaM2, aboveAreaM2, excludedAreaM2,
    percentOfValid: validCount === 0 ? null : aboveCount / validCount * 100,
    cellSizeM, receiverZM, excludedByReason,
  }
}
