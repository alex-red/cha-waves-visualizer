import { compareProbeAt } from './comparison'
import { evaluatePoint, type Domain, type PointResult, type Scene, type SolverSettings } from './engine'

export type ProbeBaseline = { scene: Scene; settings: SolverSettings }

export type ProbeReading = {
  id: string
  name: string
  levelId: string
  position: [number, number, number]
  domain: Domain
  result: PointResult
  baseline?: {
    value?: number
    unit: PointResult['unit']
    reason?: string
    delta?: number
  }
}

export type ProbeReadingsSummary = {
  domain: Domain
  frequencyHz: number
  quantity: PointResult['quantity']
  unit: PointResult['unit']
  readings: ProbeReading[]
}

function baselineCompatibilityReason(current: SolverSettings, baseline: SolverSettings): string | undefined {
  if (current.mode !== baseline.mode) return `Baseline domain differs (${baseline.mode} vs ${current.mode}); point deltas require matching domains.`
  if (current.frequencyHz !== baseline.frequencyHz) return `Baseline frequency differs (${baseline.frequencyHz} Hz vs ${current.frequencyHz} Hz); point deltas require matching frequencies.`
  const keys = [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort()
  const changed = keys.filter(key => (current as unknown as Record<string, unknown>)[key] !== (baseline as unknown as Record<string, unknown>)[key])
  if (changed.length) return `Baseline solver settings differ (${changed.join(', ')}); point deltas require identical solver settings.`
  return undefined
}

/** Evaluate every saved probe directly through the point solver (never through a sampled field). */
export function summarizeProbes(scene: Scene, settings: SolverSettings, baseline?: ProbeBaseline): ProbeReadingsSummary {
  const readings = scene.probes.map(probe => {
    const position: [number, number, number] = [...probe.position]
    const result = evaluatePoint(scene, settings, position)
    let baselineReading: ProbeReading['baseline']

    if (baseline) {
      const incompatibility = baselineCompatibilityReason(settings, baseline.settings)
      if (incompatibility) {
        baselineReading = { unit: result.unit, reason: incompatibility }
      } else try {
        // compareProbeAt checks that both point queries use identical physical settings and
        // reports B minus A, so the delta is current minus baseline at this exact coordinate.
        const comparison = compareProbeAt(baseline.scene, baseline.settings, scene, settings, position)
        baselineReading = {
          ...(comparison.a.valid ? { value: comparison.a.value } : {}),
          unit: comparison.a.unit,
          ...(comparison.a.valid ? {} : { reason: `Baseline reading is invalid: ${explainProbeInvalidReason(comparison.a.reason)}` }),
          ...(comparison.delta === undefined ? {} : { delta: comparison.delta }),
          ...(comparison.a.valid && !comparison.b.valid
            ? { reason: `Current reading is invalid: ${explainProbeInvalidReason(comparison.b.reason)}` }
            : {}),
        }
      } catch (error) {
        baselineReading = {
          unit: result.unit,
          reason: error instanceof Error ? error.message : 'Baseline settings are incompatible with this probe reading.',
        }
      }
    }

    return {
      id: probe.id,
      name: probe.name ?? probe.id,
      levelId: probe.levelId,
      position,
      domain: settings.mode,
      result,
      ...(baselineReading ? { baseline: baselineReading } : {}),
    }
  })

  const unit = settings.mode === 'acoustics' ? 'dB' : 'dBm'
  const quantity = settings.mode === 'acoustics' ? 'relative-direct-level-db' : 'received-power-dbm'
  return { domain: settings.mode, frequencyHz: settings.frequencyHz, quantity, unit, readings }
}

export function explainProbeInvalidReason(reason: PointResult['reason']): string {
  switch (reason) {
    case 'outside-floor': return 'Point is outside the modeled floor or height range.'
    case 'inside-solid': return 'Point is inside a solid wall.'
    case 'below-model-distance': return 'Point is closer to the source than the model minimum distance.'
    case 'missing-parameter': return 'A required source or material parameter is missing.'
    case 'unsupported-geometry': return 'Point or geometry is unsupported by the solver.'
    default: return 'The solver could not produce a valid reading.'
  }
}

const csvColumns = [
  'probe_id', 'probe_name', 'level_id', 'x_m', 'y_m', 'z_m', 'domain', 'frequency_hz', 'quantity', 'value', 'unit',
  'valid', 'invalid_reason', 'distance_m', 'travel_time_ms', 'crossings', 'assumptions',
  'baseline_value', 'baseline_unit', 'baseline_reason', 'delta_current_minus_baseline_db',
] as const

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value)
  // Prevent spreadsheet apps from interpreting user-controlled names and IDs as formulas.
  if (typeof value === 'string' && /^(?:\s*[=+\-@]|[\t\r\n])/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** Serialize readings as RFC-style quoted CSV, guarding user-controlled labels against formulas. */
export function exportProbeReadingsCsv(summary: ProbeReadingsSummary): string {
  const rows = summary.readings.map(reading => {
    const result = reading.result
    return [
      reading.id, reading.name, reading.levelId, ...reading.position,
      reading.domain, summary.frequencyHz, result.quantity, result.valid ? result.value : undefined, result.unit,
      result.valid, result.valid ? undefined : explainProbeInvalidReason(result.reason), result.distanceM,
      result.travelTimeMs, JSON.stringify(result.crossings), JSON.stringify(result.assumptions),
      reading.baseline?.value, reading.baseline?.unit, reading.baseline?.reason, reading.baseline?.delta,
    ].map(csvCell).join(',')
  })
  return [csvColumns.map(csvCell).join(','), ...rows].join('\r\n')
}
