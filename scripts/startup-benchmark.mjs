import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { arch, cpus, platform, release } from 'node:os'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const REPORT_JSON = resolve(ROOT, 'reports/startup-benchmark.json')
const REPORT_MD = resolve(ROOT, 'reports/STARTUP_BENCHMARK.md')

function option(name, fallback) {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
}

function positiveInt(name, fallback, max) {
  const raw = option(name, String(fallback))
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`)
  }
  return value
}

const samples = positiveInt('samples', 20, 100)
const url = new URL(option('base-url', 'http://127.0.0.1:4173'))
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Startup benchmark targets must be an HTTP server on localhost or 127.0.0.1.')
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
  return {
    median: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    min: sorted[0],
    max: sorted.at(-1),
    unit: 'ms',
    method: 'nearest-rank',
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

async function buildAssetFingerprint() {
  const assetRoot = resolve(ROOT, 'apps/web/.output/public/_nuxt')
  const files = await listFiles(assetRoot)
  const hash = createHash('sha256')
  const manifest = []
  for (const path of files) {
    const bytes = await readFile(path)
    const name = relative(assetRoot, path).split('\\').join('/')
    hash.update(name).update('\0').update(bytes).update('\0')
    manifest.push({ path: name, bytes: bytes.length })
  }
  if (!files.length) throw new Error(`No built assets found under ${assetRoot}; run the production build first.`)
  return { sha256: hash.digest('hex'), count: files.length, manifest }
}

const buildAssets = await buildAssetFingerprint()
const browser = await chromium.launch()
const browserVersion = browser.version()
const records = []

try {
  for (let index = 0; index < samples; index++) {
    // A new BrowserContext gives each measured navigation its own browser storage
    // and HTTP cache. The Chromium process and host operating-system caches persist.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.addInitScript(() => {
      const state = {
        installedAtMs: performance.now(),
        timeOriginEpochMs: performance.timeOrigin,
        events: [],
        errors: [],
      }
      Object.defineProperty(window, '__chaStartupBenchmark', { value: state })
      window.addEventListener('cha-waves:field-diagnostic', event => {
        if (event.detail?.quality !== 'balanced' || state.accepted) return
        const navigation = performance.getEntriesByType('navigation')[0]
        state.accepted = {
          acceptedAtMs: performance.now(),
          detail: structuredClone(event.detail),
          navigation: navigation ? {
            name: navigation.name,
            type: navigation.type,
            redirectCount: navigation.redirectCount,
            fetchStart: navigation.fetchStart,
            domainLookupStart: navigation.domainLookupStart,
            domainLookupEnd: navigation.domainLookupEnd,
            connectStart: navigation.connectStart,
            connectEnd: navigation.connectEnd,
            requestStart: navigation.requestStart,
            responseStart: navigation.responseStart,
            responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
            transferSize: navigation.transferSize,
            encodedBodySize: navigation.encodedBodySize,
            decodedBodySize: navigation.decodedBodySize,
          } : null,
          resources: performance.getEntriesByType('resource').map(resource => ({
            name: resource.name,
            initiatorType: resource.initiatorType,
            startTime: resource.startTime,
            duration: resource.duration,
            responseEnd: resource.responseEnd,
            transferSize: resource.transferSize,
            encodedBodySize: resource.encodedBodySize,
            decodedBodySize: resource.decodedBodySize,
          })),
        }
      })
      window.addEventListener('error', event => state.errors.push({ type: 'error', message: event.message }))
      window.addEventListener('unhandledrejection', event => state.errors.push({ type: 'unhandledrejection', message: String(event.reason) }))
    })

    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.__chaStartupBenchmark?.accepted, undefined, { timeout: 30_000 })
      const captured = await page.evaluate(() => window.__chaStartupBenchmark)
      const accepted = captured.accepted
      const durationMs = accepted.acceptedAtMs
      const diagnostic = accepted.detail
      if (!Number.isFinite(durationMs) || diagnostic.quality !== 'balanced' || !diagnostic.grid) {
        throw new Error(`Sample ${index + 1} did not capture a complete accepted balanced field diagnostic.`)
      }
      if (captured.errors.length) {
        throw new Error(`Sample ${index + 1} recorded startup JavaScript errors: ${JSON.stringify(captured.errors)}`)
      }
      records.push({
        sample: index + 1,
        navigationStartToAcceptedDrawMs: durationMs,
        timingBasis: 'performance.timeOrigin to performance.now() when the accepted balanced diagnostic event fires',
        initScript: {
          installedAtMs: captured.installedAtMs,
          timeOriginEpochMs: captured.timeOriginEpochMs,
          accepted,
          errors: captured.errors,
        },
      })
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}

const durations = records.map(record => record.navigationStartToAcceptedDrawMs)
const firstDiagnostic = records[0].initScript.accepted.detail
const allSameFixture = records.every(record => record.initScript.accepted.detail.queryHash === firstDiagnostic.queryHash)
if (!allSameFixture) throw new Error('Fixture query hash changed between fresh-context startup samples.')

const report = {
  schemaVersion: 1,
  benchmark: 'cold-browser-context-startup-to-first-balanced-canvas-draw',
  generatedAt: new Date().toISOString(),
  targetUrl: url.href,
  buildAssetsSha256: buildAssets.sha256,
  buildAssetCount: buildAssets.count,
  buildAssetManifest: buildAssets.manifest,
  environment: {
    node: process.version,
    browser: `Chromium ${browserVersion}`,
    platform: platform(),
    osRelease: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    powerState: 'not measured',
    headless: true,
    viewport: { width: 1280, height: 800 },
    throttling: 'none',
    previewCompression: 'uncompressed Node preview (no-store)',
  },
  fixture: {
    identity: 'createDemoScene startup default',
    queryHash: firstDiagnostic.queryHash,
    sceneRevision: firstDiagnostic.sceneRevision,
    solverId: firstDiagnostic.solverId,
    solverVersion: firstDiagnostic.solverVersion,
    grid: firstDiagnostic.grid,
    expectedQuality: 'balanced',
  },
  setup: {
    measuredSamples: samples,
    warmups: 0,
    contextPolicy: 'new Playwright BrowserContext and page for every measured navigation; no context is reused',
    cacheScope: 'browser-context HTTP cache and storage are fresh per sample; Chromium process, OS filesystem/page cache, DNS cache and local preview server may be warm',
    previewServer: 'scripts/serve-static.mjs sends Cache-Control: no-store and uncompressed response bodies',
    start: 'document navigation timeOrigin (navigation start)',
    end: 'first accepted balanced cha-waves:field-diagnostic event, emitted synchronously after Canvas draw in the app requestAnimationFrame callback',
  },
  scope: 'Measures from the document navigation time origin through the first accepted balanced field result draw in Canvas, reported by the app diagnostic event after its requestAnimationFrame draw callback. It covers local preview document/assets, app startup, worker startup and solve, and accepted-result Canvas drawing. It does not measure compositor submission, display presentation, input-to-display latency, real-device behavior, physical room accuracy, or cold OS/DNS/network caches.',
  navigationStartToAcceptedDrawMs: quantiles(durations),
  resourceTransferObservations: {
    description: 'Per-sample Navigation Timing and Resource Timing sizes captured at the first accepted balanced diagnostic. Browser cache behavior can make transferSize zero; values describe Chromium observations only.',
    samples: records.map(({ sample, initScript }) => ({
      sample,
      navigation: initScript.accepted.navigation,
      resources: initScript.accepted.resources,
    })),
  },
  rawSamples: records,
}

const q = report.navigationStartToAcceptedDrawMs
const grid = report.fixture.grid
const md = `# Startup benchmark\n\nGenerated ${report.generatedAt}. Built asset SHA-256: \`${report.buildAssetsSha256}\` (${report.buildAssetCount} files). Fixture: \`${report.fixture.identity}\`, query hash \`${report.fixture.queryHash}\`; solver ${report.fixture.solverId} ${report.fixture.solverVersion}.\n\n${report.scope}\n\nChromium ${browserVersion}, ${report.environment.cpu}, ${report.environment.platform} ${report.environment.osRelease}; ${samples} measured navigations, each in a new browser context and with no warmup. Viewport 1280 × 800; grid ${grid.cols ?? '?'} × ${grid.rows ?? '?'}, cell size ${grid.cellSizeM ?? '?'} m. The default Node preview sends uncompressed responses with \`Cache-Control: no-store\`. The Chromium process and host OS caches, DNS cache, and local preview server can stay warm. Power state was not measured.\n\n| Timing | Median (ms) | p75 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Min (ms) | Max (ms) |\n|---|---:|---:|---:|---:|---:|---:|---:|\n| Navigation start to first accepted Canvas draw | ${q.median.toFixed(3)} | ${q.p75.toFixed(3)} | ${q.p90.toFixed(3)} | ${q.p95.toFixed(3)} | ${q.p99.toFixed(3)} | ${q.min.toFixed(3)} | ${q.max.toFixed(3)} |\n\nReproduce after building and starting the local production preview with \`bun run preview\`: run \`node scripts/startup-benchmark.mjs\`. Optional flags: \`--samples=1..100\` (default 20), \`--base-url=http://127.0.0.1:4173\` (local HTTP only). Raw samples, init-script captures, navigation/resource timing observations, environment, and asset manifest are in [startup-benchmark.json](startup-benchmark.json). Resource sizes are observations only and can be zero when Chromium reports a cache hit.\n`

await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(REPORT_MD, md)
console.log(JSON.stringify({ samples, navigationStartToAcceptedDrawMs: q, fixture: report.fixture, buildAssetsSha256: report.buildAssetsSha256 }, null, 2))
