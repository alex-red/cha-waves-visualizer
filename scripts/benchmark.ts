import { cpus, freemem, platform, release, totalmem, arch } from 'node:os'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createDemoScene, computeField, defaultSettings, sha256Hex, SOLVER_VERSION } from '../packages/engine.ts'

const DEFAULT_SAMPLES = 100
const DEFAULT_WARMUPS = 20
const FIXED_RECEIVER_Z = 1.5
const FIXTURE_ID = 'engine-benchmark-create-demo-scene-v1'

function positiveIntegerArg(name: string, fallback: number, maximum: number): number {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`)
  return parsed
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[index]!
}

async function runCase(mode: 'acoustics' | 'radio', stepM: number, warmups: number, samples: number) {
  const scene = createDemoScene()
  const settings = defaultSettings(mode)
  const options = { step: stepM, receiverZ: FIXED_RECEIVER_Z, levelId: scene.levels[0]!.id }
  for (let index = 0; index < warmups; index++) await computeField(scene, settings, options)

  const wallClockMs: number[] = []
  const engineElapsedMs: number[] = []
  let lastField: Awaited<ReturnType<typeof computeField>> | undefined
  for (let index = 0; index < samples; index++) {
    const start = performance.now()
    lastField = await computeField(scene, settings, options)
    wallClockMs.push(performance.now() - start)
    engineElapsedMs.push(lastField.computeMs)
  }
  if (!lastField) throw new Error('Benchmark did not produce a field')

  return {
    mode,
    frequencyHz: settings.frequencyHz,
    gridStepM: stepM,
    grid: lastField.grid,
    cellCount: lastField.values.length,
    validCellCount: lastField.validity.reduce((total, value) => total + (value === 1 ? 1 : 0), 0),
    invalidCellCount: lastField.validity.reduce((total, value) => total + (value === 1 ? 0 : 1), 0),
    warmups,
    measuredRuns: samples,
    wallClockMs: summarize(wallClockMs),
    engineElapsedMs: summarize(engineElapsedMs),
    queryHash: lastField.identity.queryHash,
    solverId: lastField.identity.solverId,
    rawSamples: { wallClockMs, engineElapsedMs },
  }
}

function summarize(values: number[]) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    unit: 'ms',
  }
}

function escapeTable(value: string | number): string {
  return String(value).replaceAll('|', '\\|')
}

const samples = positiveIntegerArg('samples', DEFAULT_SAMPLES, 1000)
const warmups = positiveIntegerArg('warmups', DEFAULT_WARMUPS, 100)
const scene = createDemoScene()
const cases = []
for (const mode of ['acoustics', 'radio'] as const) {
  for (const step of [0.5, 0.25]) cases.push(await runCase(mode, step, warmups, samples))
}

const cpu = cpus()[0]
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixture: { id: FIXTURE_ID, sceneId: scene.id, provenance: 'createDemoScene() from packages/engine.ts', jsonSha256: sha256Hex(JSON.stringify(scene)) },
  setup: {
    invocation: `node --experimental-transform-types scripts/benchmark.ts --samples=${samples} --warmups=${warmups}`,
    node: process.version,
    platform: `${platform()} ${release()}`,
    architecture: arch(),
    cpuModel: cpu?.model ?? 'unavailable',
    logicalCpuCount: cpus().length,
    memoryBytes: { total: totalmem(), freeAtReport: freemem() },
    execution: 'direct main-thread Node.js calls to computeField; no browser, worker, or end-to-end measurement',
    cache: 'none; no result or field cache is enabled by the harness',
    wallCount: scene.walls.length,
    openingCount: scene.openings.length,
    sourceHeightM: {
      acoustics: scene.emitters.find((emitter) => emitter.domain === 'acoustics')!.position[2],
      radio: scene.emitters.find((emitter) => emitter.domain === 'radio')!.position[2],
    },
    solverVersion: SOLVER_VERSION,
    warmups,
    measuredRunsPerCase: samples,
    receiverHeightM: FIXED_RECEIVER_Z,
    cases: ['sound', 'radio'] as const,
    gridStepsM: [0.5, 0.25],
  },
  cases,
} as const

const jsonPath = resolve('reports/engine-benchmark.json')
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

const rows = cases.map((item) => `| ${item.mode} | ${item.frequencyHz} | ${item.gridStepM} | ${item.cellCount} | ${item.wallClockMs.median.toFixed(3)} | ${item.wallClockMs.p95.toFixed(3)} | ${item.wallClockMs.p99.toFixed(3)} | ${item.engineElapsedMs.median.toFixed(3)} |`)
const markdown = `# Engine benchmark\n\nGenerated ${report.generatedAt}. Measurements describe local direct Node.js execution of the field solver. They do not describe browser rendering, worker execution, or end-to-end application latency.\n\n## Setup\n\n- Command: \`${report.setup.invocation}\`\n- Node: ${report.setup.node}; ${escapeTable(report.setup.platform)}; ${report.setup.architecture}\n- CPU: ${escapeTable(report.setup.cpuModel)} (${report.setup.logicalCpuCount} logical CPUs)\n- Solver: ${report.setup.solverVersion}; fixture: \`${FIXTURE_ID}\` (${scene.walls.length} walls, ${scene.openings.length} opening)\n- Cache: none. Each measured call executes \`computeField\` again.\n- Runs: ${warmups} warmups and ${samples} measured runs per case; receiver height ${FIXED_RECEIVER_Z} m.\n- Grid steps: 0.5 m (preview) and 0.25 m (balanced).\n\n## Results\n\nWall-clock values measure the full awaited call around \`computeField\`. Engine elapsed values are the solver's returned \`computeMs\`, which includes its cooperative row-yield scheduling. Percentiles use nearest-rank selection.\n\n| Mode | Frequency (Hz) | Step (m) | Cells | Wall median (ms) | Wall p95 (ms) | Wall p99 (ms) | Engine elapsed median (ms) |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\nFull distributions and environment metadata are in [engine-benchmark.json](./engine-benchmark.json). Rerun the command above to replace both generated reports.\n`
await writeFile(resolve('reports/ENGINE_BENCHMARK.md'), markdown, 'utf8')
console.log(`Wrote ${jsonPath} and reports/ENGINE_BENCHMARK.md`)
