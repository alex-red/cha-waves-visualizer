import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSpatialPlaneCases } from '../packages/test-fixtures/spatial-plane'
import { evaluatePlaneFit, type SpatialPlaneEvaluation } from '../packages/spatial-plane-evaluation'
import { fitSinglePlane, type PlaneObservation } from '../packages/spatial-plane'

export const SPATIAL_PLANE_DEMO_MAX_RESIDUAL_MS = 0.05
export const SPATIAL_PLANE_DEMO_USAGE = [
  'Usage: bun run spatial:plane-demo [--format json|markdown]',
  '',
  'Run the frozen synthetic one-plane 3D reference cases.',
  'The 0.05 ms fit residual threshold is a synthetic numerical screening choice.',
  '',
  'Options:',
  '  --format <format>    json or markdown (default: json)',
  '  --help               Show this help',
].join('\n') + '\n'

export type SpatialPlaneDemoFormat = 'json' | 'markdown'
export type SpatialPlaneDemoArguments = { format: SpatialPlaneDemoFormat } | { help: true }

export function parseSpatialPlaneDemoArguments(args: readonly string[]): SpatialPlaneDemoArguments {
  const values = args[0] === '--' ? args.slice(1) : args
  if (values.length === 1 && values[0] === '--help') return { help: true }
  let format: SpatialPlaneDemoFormat = 'json'
  let seen = false
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index]!
    if (option !== '--format') {
      if (option === '--help') throw new Error('--help must be used by itself.')
      throw new Error('Unknown option.')
    }
    if (seen) throw new Error('Repeated option "--format".')
    seen = true
    const value = values[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error('Option "--format" requires a value.')
    if (value !== 'json' && value !== 'markdown') throw new Error('Option "--format" must be "json" or "markdown".')
    format = value
    index += 1
  }
  return { format }
}

export interface SpatialPlaneDemoCaseReport {
  id: string
  trainingInputSha256: string
  heldOutInputSha256: string
  truthSha256: string
  trainingObservationIds: string[]
  heldOutObservationIds: string[]
  fit: ReturnType<typeof fitSinglePlane>
  evaluation: SpatialPlaneEvaluation
}

export interface SpatialPlaneDemoReport {
  reportFormat: 'cha-spatial-plane-demo-v1'
  source: 'synthetic-fixtures'
  defaultMaxResidualMs: number
  cases: SpatialPlaneDemoCaseReport[]
  limitations: string[]
}

/** Run a deterministic synthetic evaluation. Estimator inputs never include truth or held-out data. */
export function createSpatialPlaneDemoReport(): SpatialPlaneDemoReport {
  const cases = createSpatialPlaneCases().map(({ id, training, heldOut, truth }) => {
    const trainingJson = JSON.stringify(training)
    const heldOutJson = JSON.stringify(heldOut)
    const truthJson = JSON.stringify(truth)
    const fit = fitSinglePlane(training, { maxResidualMs: SPATIAL_PLANE_DEMO_MAX_RESIDUAL_MS })
    return {
      id,
      trainingInputSha256: createHash('sha256').update(trainingJson, 'utf8').digest('hex'),
      heldOutInputSha256: createHash('sha256').update(heldOutJson, 'utf8').digest('hex'),
      truthSha256: createHash('sha256').update(truthJson, 'utf8').digest('hex'),
      trainingObservationIds: training.map((observation: PlaneObservation) => observation.id),
      heldOutObservationIds: heldOut.map((observation: PlaneObservation) => observation.id),
      fit,
      evaluation: evaluatePlaneFit(fit, truth, heldOut),
    }
  })
  return {
    reportFormat: 'cha-spatial-plane-demo-v1',
    source: 'synthetic-fixtures',
    defaultMaxResidualMs: SPATIAL_PLANE_DEMO_MAX_RESIDUAL_MS,
    cases,
    limitations: [
      'All cases are generated synthetic fixtures; no real capture or physical room validation is involved.',
      'The model is one infinite specular plane with one fixed known speaker and supplied 3D microphone positions.',
      'The residual threshold is a synthetic screening parameter, not physical accuracy or confidence.',
      'Finite room boundaries, occlusion, diffraction, reflectivity, echo assignment, device response and calibration are not modeled.',
    ],
  }
}

export function renderSpatialPlaneDemoReport(report: SpatialPlaneDemoReport, format: SpatialPlaneDemoFormat): string {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n'
  if (format !== 'markdown') throw new Error('Report format must be "json" or "markdown".')
  const lines = [
    '# Synthetic spatial plane demonstration', '',
    `Residual screening threshold: ${report.defaultMaxResidualMs} ms.`,
    'Training hashes cover the exact JSON serialization of estimator observations only.', '',
  ]
  for (const item of report.cases) {
    lines.push(`## ${item.id}`, '',
      `Training SHA256: ${item.trainingInputSha256}`,
      `Held-out SHA256: ${item.heldOutInputSha256}`,
      `Truth SHA256: ${item.truthSha256}`,
      `Training IDs: ${item.trainingObservationIds.join(', ')}`,
      `Held-out IDs: ${item.heldOutObservationIds.join(', ')}`,
      `Fit status: ${item.fit.status}; eligible attempts: ${item.fit.eligibleCount}.`,
      `Plane error: normal ${item.evaluation.normalAngleErrorDeg === null ? 'unavailable' : `${item.evaluation.normalAngleErrorDeg}°`}; offset ${item.evaluation.absoluteOffsetErrorM === null ? 'unavailable' : `${item.evaluation.absoluteOffsetErrorM} m`}.`,
      `Held-out: ${item.evaluation.heldOut.eligibleCandidateCount} eligible candidates, ${item.evaluation.heldOut.evaluatedCount} evaluated, ${item.evaluation.heldOut.excludedCount} excluded; RMS ${item.evaluation.heldOut.rmsResidualMs === null ? 'unavailable' : `${item.evaluation.heldOut.rmsResidualMs} ms`}; maximum ${item.evaluation.heldOut.maxResidualMs === null ? 'unavailable' : `${item.evaluation.heldOut.maxResidualMs} ms`}.`,
    )
    for (const exclusion of item.evaluation.heldOut.exclusions) lines.push(`- Excluded ${exclusion.id}: ${exclusion.reason}.`)
    lines.push('')
  }
  lines.push('## Limits', '', ...report.limitations.map(limitation => `- ${limitation}`), '')
  return lines.join('\n')
}

export async function runSpatialPlaneDemo(args: readonly string[]): Promise<string> {
  const options = parseSpatialPlaneDemoArguments(args)
  if ('help' in options) return SPATIAL_PLANE_DEMO_USAGE
  return renderSpatialPlaneDemoReport(createSpatialPlaneDemoReport(), options.format)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSpatialPlaneDemo(process.argv.slice(2)).then(
    output => process.stdout.write(output),
    error => {
      process.stderr.write(`spatial:plane-demo: ${error instanceof Error ? error.message : 'Demonstration failed.'}\n`)
      process.exitCode = 1
    },
  )
}
