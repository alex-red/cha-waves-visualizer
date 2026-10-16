import {
  pointQueryHash,
  type CrossingTerm,
  type PointResult,
  type Scene,
  type SolverSettings,
} from './engine'

export const LOSS_BREAKDOWN_TOLERANCE_DB = 1e-9

export type LossTerm = {
  id: string
  kind: 'reference' | 'source' | 'gain' | 'distance' | 'crossing' | 'other'
  label: string
  contributionDb: number
  detail: string
  crossing?: CrossingTerm
}

export type LossBreakdown = {
  available: boolean
  reason?: string
  terms: LossTerm[]
  total?: number
  unit: 'dB' | 'dBm'
  residualDb?: number
}

function unavailable(unit: 'dB' | 'dBm', reason: string): LossBreakdown {
  return { available: false, reason, terms: [], unit }
}

function compactFrequency(hz: number): string {
  if (hz >= 1e9) return `${Number((hz / 1e9).toPrecision(4))} GHz`
  if (hz >= 1e6) return `${Number((hz / 1e6).toPrecision(4))} MHz`
  if (hz >= 1e3) return `${Number((hz / 1e3).toPrecision(4))} kHz`
  return `${Number(hz.toPrecision(4))} Hz`
}

function readableId(id: string): string {
  return id.split('-').filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ') || id
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= LOSS_BREAKDOWN_TOLERANCE_DB
}

/**
 * Explain a point estimate as additive contributions from the authored model.
 * This describes the solver's assumptions; it is not a measurement accuracy claim.
 */
export function buildLossBreakdown(scene: Scene, settings: SolverSettings, result: PointResult | null): LossBreakdown {
  const expectedUnit = settings.mode === 'acoustics' ? 'dB' : 'dBm'
  if (!result) return unavailable(expectedUnit, 'No exact point estimate is available.')
  if (!result.valid || result.value === undefined || !Number.isFinite(result.value)) {
    return unavailable(expectedUnit, result.reason ? `The point estimate is invalid (${result.reason}).` : 'The point estimate is invalid.')
  }

  try {
    const expectedHash = pointQueryHash(scene, settings)
    if (result.queryHash !== expectedHash) return unavailable(expectedUnit, 'The point estimate belongs to an older scene or set of solver settings.')
  } catch {
    return unavailable(expectedUnit, 'The scene or solver settings are invalid.')
  }

  const expectedQuantity = settings.mode === 'acoustics' ? 'relative-direct-level-db' : 'received-power-dbm'
  if (result.unit !== expectedUnit || result.quantity !== expectedQuantity) return unavailable(expectedUnit, 'The point estimate does not match the selected solver mode.')
  if (!Number.isFinite(result.distanceM) || result.distanceM <= 0) return unavailable(expectedUnit, 'The point estimate has no finite positive source distance.')
  if (!Array.isArray(result.crossings) || !Array.isArray(result.assumptions)
    || !result.assumptions.every(item => item && typeof item.id === 'string' && Number.isFinite(item.frequencyHz) && Number.isFinite(item.valueDb)
      && typeof item.provenance === 'string' && (item.notes === undefined || typeof item.notes === 'string'))) {
    return unavailable(expectedUnit, 'The point estimate is missing valid crossing or assumption details.')
  }

  const emitter = scene.emitters.find(item => item.domain === settings.mode && item.active)
  if (!emitter) return unavailable(expectedUnit, 'There is no active source for this solver mode.')
  const frequency = compactFrequency(settings.frequencyHz)
  const terms: LossTerm[] = []

  if (settings.mode === 'acoustics') {
    terms.push({ id: 'reference', kind: 'reference', label: 'Reference level', contributionDb: 0, detail: `0 dB at ${settings.referenceDistanceM} m reference distance · ${frequency}` })
    terms.push({ id: 'distance', kind: 'distance', label: 'Geometric distance', contributionDb: -20 * Math.log10(result.distanceM / settings.referenceDistanceM), detail: `${result.distanceM.toFixed(2)} m from source · inverse-distance level relative to ${settings.referenceDistanceM} m` })
  } else {
    if (emitter.eirpDbm === undefined || !Number.isFinite(emitter.eirpDbm)) return unavailable(expectedUnit, 'The active radio source has no finite EIRP value.')
    terms.push({ id: 'source', kind: 'source', label: 'Transmitter EIRP', contributionDb: emitter.eirpDbm, detail: `${emitter.eirpDbm.toFixed(1)} dBm at ${frequency}` })
    terms.push({ id: 'gain', kind: 'gain', label: 'Receiver antenna gain', contributionDb: settings.receiverGainDbi, detail: `${settings.receiverGainDbi.toFixed(1)} dBi receiver gain` })
    terms.push({ id: 'distance', kind: 'distance', label: 'Free-space path loss', contributionDb: -20 * Math.log10(4 * Math.PI * result.distanceM * settings.frequencyHz / 299792458), detail: `${result.distanceM.toFixed(2)} m at ${frequency} · Friis free-space loss` })
  }

  for (const [index, crossing] of result.crossings.entries()) {
    if (!crossing || typeof crossing.wallId !== 'string' || typeof crossing.materialId !== 'string'
      || (crossing.openingId !== undefined && typeof crossing.openingId !== 'string')
      || !Number.isFinite(crossing.lossDb) || !Array.isArray(crossing.hit) || crossing.hit.length !== 3 || !crossing.hit.every(Number.isFinite)) {
      return unavailable(expectedUnit, 'A wall crossing has invalid loss, identity, or hit coordinates.')
    }
    const wall = scene.walls.find(item => item.id === crossing.wallId)
    const opening = crossing.openingId ? scene.openings.find(item => item.id === crossing.openingId) : undefined
    if (!wall || (crossing.openingId && (!opening || opening.wallId !== wall.id))) return unavailable(expectedUnit, 'A wall crossing no longer matches the current scene.')
    const openPath = opening?.kind === 'passage' || (opening?.kind === 'door' && opening.isOpen)
    const expectedMaterialId = openPath ? wall.materialId : (opening?.materialId ?? wall.materialId)
    if (crossing.materialId !== expectedMaterialId) return unavailable(expectedUnit, 'A wall crossing references a different material than the current scene.')
    const material = scene.materials.find(item => item.id === crossing.materialId)
    if (!material) return unavailable(expectedUnit, 'A wall crossing references a missing material.')
    const expectedLoss = openPath || (settings.mode === 'acoustics' && !settings.transmissionEnabled)
      ? 0
      : (settings.mode === 'acoustics' ? material.acousticTransmissionDb : material.radioLossDb).find(band => band.frequencyHz === settings.frequencyHz)?.valueDb
    if (expectedLoss === undefined || !Number.isFinite(expectedLoss) || !closeEnough(expectedLoss, crossing.lossDb)) {
      return unavailable(expectedUnit, 'A wall crossing loss does not match the current material assumptions.')
    }
    const openingName = opening ? readableId(opening.id) : ''
    const origin = opening
      ? (openingName.toLowerCase().endsWith(opening.kind) ? openingName : `${openingName} ${opening.kind}`)
      : readableId(wall.id)
    const label = `${origin} · ${material.name}`
    let detail: string
    if (openPath) detail = `${opening!.kind === 'passage' ? 'Open passage' : 'Open door'} · 0 dB at ${frequency}`
    else if (settings.mode === 'acoustics' && !settings.transmissionEnabled) detail = `Sound transmission disabled · ${frequency}`
    else {
      const assumption = result.assumptions.find(item => item.id === crossing.materialId && item.frequencyHz === settings.frequencyHz)
      detail = `${frequency} material loss · ${assumption?.provenance.replaceAll('-', ' ') ?? material.provenance.replaceAll('-', ' ')}`
      if (assumption?.notes) detail += ` · ${assumption.notes}`
    }
    const signedContribution = crossing.lossDb === 0 ? 0 : -crossing.lossDb
    if (crossing.lossDb < 0) detail += ` · configured coefficient ${crossing.lossDb.toFixed(1)} dB yields +${signedContribution.toFixed(1)} dB contribution`
    terms.push({ id: `crossing-${index}-${crossing.wallId}-${crossing.openingId ?? ''}`, kind: 'crossing', label, contributionDb: signedContribution, detail, crossing })
  }

  if (settings.mode === 'radio') {
    if (!Number.isFinite(settings.otherLossDb)) return unavailable(expectedUnit, 'Other radio loss is not finite.')
    terms.push({ id: 'other-loss', kind: 'other', label: 'Other modeled loss', contributionDb: -settings.otherLossDb, detail: `${settings.otherLossDb.toFixed(1)} dB configured additional loss` })
  }

  const total = terms.reduce((sum, term) => sum + term.contributionDb, 0)
  if (!Number.isFinite(total) || !closeEnough(total, result.value)) return unavailable(expectedUnit, 'The point estimate does not reconcile with its explicit model contributions.')
  return { available: true, terms, total, unit: expectedUnit, residualDb: result.value - total }
}
