import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSpatialPlaneCases } from '../packages/test-fixtures/spatial-plane'
import {
  createSpatialPlaneDemoReport,
  parseSpatialPlaneDemoArguments,
  runSpatialPlaneDemo,
  SPATIAL_PLANE_DEMO_MAX_RESIDUAL_MS,
  SPATIAL_PLANE_DEMO_USAGE,
} from './spatial-plane-demo'

describe('spatial plane demonstration command', () => {
  it('uses only stable training inputs and records exact hashes and observation IDs', () => {
    const fixtureCases = createSpatialPlaneCases()
    const report = createSpatialPlaneDemoReport()
    expect(report.reportFormat).toBe('cha-spatial-plane-demo-v1')
    expect(report.source).toBe('synthetic-fixtures')
    expect(report.defaultMaxResidualMs).toBe(0.05)
    expect(SPATIAL_PLANE_DEMO_MAX_RESIDUAL_MS).toBe(0.05)
    expect(report.cases.map(item => item.id)).toEqual(['tilted-wall', 'floor', 'ceiling'])
    expect(report.cases.map(item => item.trainingInputSha256)).toEqual([
      'd93abd593823c4084f793413d0bc7ac35c6f693cea4c7af0c9b6ee9f82d0a995',
      'da1443fcefdec65f9fd363399fc844410fcbc06abd39608523090508c487133e',
      '8efa56596d5f64dd4b0397691f528ab3fa2d8ec0bcf9b55ae5e89e6e311a6490',
    ])
    report.cases.forEach((item, index) => {
      expect(item.trainingObservationIds).toEqual(fixtureCases[index]!.training.map(observation => observation.id))
      expect(item.heldOutObservationIds).toEqual(fixtureCases[index]!.heldOut.map(observation => observation.id))
      expect(item.heldOutInputSha256).toBe(createHash('sha256').update(JSON.stringify(fixtureCases[index]!.heldOut), 'utf8').digest('hex'))
      expect(item.truthSha256).toBe(createHash('sha256').update(JSON.stringify(fixtureCases[index]!.truth), 'utf8').digest('hex'))
      expect(item.trainingObservationIds).toHaveLength(8)
      expect(item.trainingObservationIds.at(-2)).toBe(`${item.id}-training-missing`)
      expect(item.trainingObservationIds.at(-1)).toBe(`${item.id}-training-ambiguous`)
      expect(item.fit.eligibleCount).toBe(6)
      expect(item.evaluation.trainingAttempts).toEqual({ eligibleCount: 6, missingCount: 1, ambiguousCount: 1 })
    })
    expect(JSON.stringify(report)).toBe(JSON.stringify(createSpatialPlaneDemoReport()))
    expect(report.limitations.join(' ')).toContain('not physical accuracy')
  })

  it('strictly parses format and standalone help options', () => {
    expect(parseSpatialPlaneDemoArguments(['--format', 'markdown'])).toEqual({ format: 'markdown' })
    expect(parseSpatialPlaneDemoArguments(['--', '--format', 'json'])).toEqual({ format: 'json' })
    expect(parseSpatialPlaneDemoArguments(['--help'])).toEqual({ help: true })
    for (const args of [['--format'], ['--format', 'csv'], ['--format', 'json', '--format', 'markdown'], ['--bad'], ['--help', '--format', 'json']]) {
      expect(() => parseSpatialPlaneDemoArguments(args)).toThrow()
    }
  })

  it('renders deterministic JSON and Markdown and returns help without running the demo', async () => {
    const json = await runSpatialPlaneDemo([])
    expect(json).toBe(await runSpatialPlaneDemo([]))
    expect(JSON.parse(json).cases).toHaveLength(3)
    const markdown = await runSpatialPlaneDemo(['--format', 'markdown'])
    expect(markdown).toContain('# Synthetic spatial plane demonstration')
    expect(markdown).toContain('Training SHA256: d93abd593823c4084f793413d0bc7ac35c6f693cea4c7af0c9b6ee9f82d0a995')
    expect(await runSpatialPlaneDemo(['--help'])).toBe(SPATIAL_PLANE_DEMO_USAGE)
  })

  it('executes standalone help/errors and importing the command does not run it', () => {
    const script = fileURLToPath(new URL('./spatial-plane-demo.ts', import.meta.url))
    const help = spawnSync('bun', [script, '--help'], { encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toBe(SPATIAL_PLANE_DEMO_USAGE)
    expect(help.stderr).toBe('')
    const invalid = spawnSync('bun', [script, '--format', 'csv'], { encoding: 'utf8' })
    expect(invalid.status).toBe(1)
    expect(invalid.stdout).toBe('')
    expect(invalid.stderr).toMatch(/json.*markdown/)
    const execution = spawnSync('bun', [script], { encoding: 'utf8' })
    expect(execution.status).toBe(0)
    expect(JSON.parse(execution.stdout).cases.map((item: { trainingInputSha256: string }) => item.trainingInputSha256)).toEqual([
      'd93abd593823c4084f793413d0bc7ac35c6f693cea4c7af0c9b6ee9f82d0a995',
      'da1443fcefdec65f9fd363399fc844410fcbc06abd39608523090508c487133e',
      '8efa56596d5f64dd4b0397691f528ab3fa2d8ec0bcf9b55ae5e89e6e311a6490',
    ])
    const imported = spawnSync('bun', ['-e', `import(${JSON.stringify(script)}).then(() => process.stdout.write('imported'))`], { encoding: 'utf8' })
    expect(imported.status).toBe(0)
    expect(imported.stdout).toBe('imported')
    expect(imported.stderr).toBe('')
  })
})
