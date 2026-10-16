import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { cpus, platform, release, arch } from 'node:os'
import { writeFile, readFile, readdir } from 'node:fs/promises'

function count(name, fallback, max) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be 1..${max}`)
  return value
}
const samples = count('samples', 100, 1000), warmups = count('warmups', 20, 100)
const url = process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11) ?? 'http://127.0.0.1:4173'
const target = new URL(url)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.protocol !== 'http:') throw new Error('Benchmark targets must be a local HTTP preview.')
function summary(values) {
  const sorted = [...values].sort((a,b) => a-b)
  const p = percentile => sorted[Math.max(0, Math.ceil(percentile * sorted.length)-1)]
  return { median: p(.5), p95:p(.95), p99:p(.99), min: sorted[0], max: sorted.at(-1), unit:'ms' }
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width:1280, height:800 } })
  await page.addInitScript(() => {
    window.__chaBenchmark = []
    window.addEventListener('cha-waves:field-diagnostic', event => {
      if (event.detail.quality === 'balanced') window.__chaBenchmark.push(event.detail)
    })
  })
  await page.goto(url)
  await page.getByTestId('probe-value').filter({ hasNotText:'—' }).waitFor()
  const records = []
  for (let i=0; i<warmups+samples; i++) {
    const before = await page.evaluate(() => window.__chaBenchmark.length)
    await page.getByTestId('source-x').fill((2.2 + (i % 8) * .2).toFixed(1))
    await page.getByTestId('source-x').press('Tab')
    await page.waitForFunction(n => window.__chaBenchmark.length > n, before, {timeout:10000})
    const latest = await page.evaluate(() => window.__chaBenchmark.at(-1))
    if (i>=warmups) records.push(latest)
  }
  const request = records.map(record => record.requestToPaintMs), compute = records.map(record => record.computeMs)
  if (![...request,...compute].every(Number.isFinite)) throw new Error('Incomplete field diagnostics')
  const assetFiles = (await readdir('apps/web/.output/public/_nuxt')).filter(file => /\.(js|css)$/.test(file)).sort()
  const hash = createHash('sha256')
  for (const file of assetFiles) hash.update(file).update(await readFile(`apps/web/.output/public/_nuxt/${file}`))
  const report = {
    schemaVersion:1, generatedAt:new Date().toISOString(), buildAssetsSha256:hash.digest('hex'), solverVersion:records[0]?.solverVersion, solverId:records[0]?.solverId,
    environment:{node:process.version, browser:browser.version(), platform:platform(), osRelease:release(), arch:arch(), cpu:cpus()[0]?.model},
    setup:{samples,warmups, viewport:{width:1280,height:800}, backend:'Canvas 2D', mode:'acoustics', frequencyHz:1000, receiverZM:1.5, stepM:.25, cells:2240, walls:5, cache:'none', fixture:'createDemoScene', edits:'source X cycles 2.2..3.6 m at Y 7.8 m'},
    scope:'Worker request posting through accepted-result Canvas draw in an animation-frame callback, including worker serialization, solve and main-thread scheduling. Excludes input-event handling before posting, cold loading, GPU rendering, frame presentation to display, and on-site model validity.',
    requestToCanvasDrawMs:summary(request), workerComputeMs:summary(compute), raw:records,
  }
  await writeFile('reports/browser-benchmark.json', JSON.stringify(report,null,2)+'\n')
  await writeFile('reports/BROWSER_BENCHMARK.md', `# Browser worker/Canvas benchmark\n\nGenerated ${report.generatedAt}. Build assets SHA-256: ${report.buildAssetsSha256}. Solver: ${report.solverId} ${report.solverVersion}.\n\n${report.scope}\n\nChromium ${report.environment.browser}; ${report.environment.cpu}; ${report.environment.platform} ${report.environment.osRelease}; ${samples} measured updates after ${warmups} warmups. Viewport 1280 × 800, authored five-wall scene, acoustics 1 kHz, 0.25 m grid (2,240 cells), receiver 1.5 m. Headless browser with no CPU/network throttling.\n\n| Timing | Median (ms) | p95 (ms) | p99 (ms) |\n|---|---:|---:|---:|\n| Request to Canvas draw | ${report.requestToCanvasDrawMs.median.toFixed(3)} | ${report.requestToCanvasDrawMs.p95.toFixed(3)} | ${report.requestToCanvasDrawMs.p99.toFixed(3)} |\n| Worker compute | ${report.workerComputeMs.median.toFixed(3)} | ${report.workerComputeMs.p95.toFixed(3)} | ${report.workerComputeMs.p99.toFixed(3)} |\n\nReproduce: build, start \`bun run preview\`, then \`bun run benchmark:browser\` in another terminal. Raw data: [browser-benchmark.json](browser-benchmark.json). These observations do not establish latency on other devices or a full pointer-to-display budget.\n`)
  console.log(JSON.stringify({requestToCanvasDrawMs:report.requestToCanvasDrawMs,workerComputeMs:report.workerComputeMs}))
} finally { await browser.close() }
