import { test as base, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createSatelliteServer } from '../../../scripts/satellite-server.mjs'
import { readFile } from 'node:fs/promises'
import { parseEchoScan } from '../../../packages/echo-scan'
import type { SatelliteCapture, SatelliteSessionSnapshot } from '../../../packages/satellite'
import type { ProbeBatch } from '../../../packages/probe-batch'

const test = base.extend<{ relayOrigin: string }>({
  relayOrigin: async ({}, use) => {
    const server = await createSatelliteServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start the isolated satellite test server')
    try { await use(`http://127.0.0.1:${address.port}`) }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  },
})

test.skip(({ browserName }) => browserName !== 'chromium', 'Fake microphone capture is configured for Chromium.')
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })

type BrowserProbeStats = {
  calls: number
  tracks: MediaStreamTrack[]
  batchUploads: Array<{ batch: ProbeBatch; captures: SatelliteCapture[] }>
  delayNextBatchResponse: boolean
}

async function createSession(relayOrigin: string): Promise<{ token: string; auth: Record<string, string> }> {
  const response = await fetch(`${relayOrigin}/api/satellite/sessions`, {
    method: 'POST', headers: { Origin: relayOrigin, 'Content-Type': 'application/json' }, body: '{}',
  })
  if (!response.ok) throw new Error(`Could not create isolated relay session: ${response.status}`)
  const { token } = await response.json() as { token: string }
  return { token, auth: { Origin: relayOrigin, Authorization: `Bearer ${token}` } }
}

async function readSession(relayOrigin: string, auth: Record<string, string>): Promise<SatelliteSessionSnapshot> {
  const response = await fetch(`${relayOrigin}/api/satellite/session`, { headers: auth })
  if (!response.ok) throw new Error(`Could not poll isolated relay session: ${response.status}`)
  return response.json() as Promise<SatelliteSessionSnapshot>
}

async function instrumentPhone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stats: BrowserProbeStats = { calls: 0, tracks: [], batchUploads: [], delayNextBatchResponse: false }
    Object.defineProperty(window, '__phoneSeriesStats', { value: stats, configurable: false })
    const media = navigator.mediaDevices
    const originalGetUserMedia = media.getUserMedia.bind(media)
    media.getUserMedia = async constraints => {
      stats.calls += 1
      const stream = await originalGetUserMedia(constraints)
      stats.tracks.push(...stream.getTracks())
      return stream
    }
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/satellite/batches') && typeof init?.body === 'string') {
        stats.batchUploads.push(JSON.parse(init.body) as { batch: ProbeBatch; captures: SatelliteCapture[] })
        const shouldDelay = stats.delayNextBatchResponse
        stats.delayNextBatchResponse = false
        const response = await originalFetch(input, init)
        if (shouldDelay) return await new Promise<Response>((resolve, reject) => {
          const finish = (error?: DOMException) => {
            window.clearTimeout(timeout)
            init.signal?.removeEventListener('abort', onAbort)
            if (error) reject(error)
            else resolve(response)
          }
          const timeout = window.setTimeout(() => finish(), 30_000)
          const onAbort = () => finish(new DOMException('Aborted', 'AbortError'))
          if (init.signal?.aborted) onAbort()
          else init.signal?.addEventListener('abort', onAbort, { once: true })
        })
        return response
      }
      return originalFetch(input, init)
    }
  })
}

async function configureSeriesPhone(page: Page, relayOrigin: string, token: string): Promise<void> {
  await page.goto(`${relayOrigin}/?satellite=1#${token}`)
  await expect(page.getByTestId('phone-satellite')).toBeVisible()
  await page.getByLabel('DEVICE NAME').fill('Phone')
  await page.getByRole('button', { name: 'Pair device' }).click()
  await expect(page.getByRole('button', { name: 'Record five sweeps' })).toBeDisabled()
  const coordinates = page.locator('.coordinate-fields input')
  await coordinates.nth(0).fill('1.25')
  await coordinates.nth(1).fill('2.50')
  await page.getByLabel('Phone height above floor (m)').fill('1.20')
  await page.getByLabel('Phone orientation').selectOption('screen-down')
  await page.getByLabel('Phone heading in room (degrees)').fill('45')
  await page.getByLabel('Reported media volume (%)').fill('63')
  await expect(page.getByRole('button', { name: 'Record five sweeps' })).toBeEnabled()
}

function browserStats(page: Page): Promise<{ calls: number; trackStates: string[]; batchUploads: Array<{ batch: ProbeBatch; captures: SatelliteCapture[] }> }> {
  return page.evaluate(() => {
    const stats = (window as Window & { __phoneSeriesStats: BrowserProbeStats }).__phoneSeriesStats
    return { calls: stats.calls, trackStates: stats.tracks.map(track => track.readyState), batchUploads: stats.batchUploads }
  })
}

test('captures, sends and restores a full five-probe batch with one stream and aligned telemetry', async ({ page, relayOrigin }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { token, auth } = await createSession(relayOrigin)
  await instrumentPhone(page)
  await configureSeriesPhone(page, relayOrigin, token)
  await page.getByRole('button', { name: 'Record five sweeps' }).click()
  await expect(page.getByText('Series held locally')).toBeVisible({ timeout: 15_000 })

  const review = page.getByTestId('echo-probe-batch')
  await expect(review).toContainText('5 / 5 captured')
  await expect(review.getByRole('listitem')).toHaveCount(5)
  await page.screenshot({ path: testInfo.outputPath('phone-probe-series-review-390.png'), fullPage: true })
  const axe = await new AxeBuilder({ page }).include('[data-testid="echo-probe-batch"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations).toEqual([])
  const pageBounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(pageBounds.width).toBeLessThanOrEqual(pageBounds.viewport)

  const preSend = await readSession(relayOrigin, auth)
  expect(preSend.captures).toEqual([])
  expect(preSend.batches).toEqual([])
  const heldStats = await browserStats(page)
  expect(heldStats.calls).toBe(1)
  expect(heldStats.trackStates.length).toBeGreaterThan(0)
  expect(heldStats.trackStates.every(state => state === 'ended')).toBe(true)
  expect(heldStats.batchUploads).toEqual([])
  const saveBeforeSend = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save series JSON' }).click()
  const savedPath = await (await saveBeforeSend).path()
  if (!savedPath) throw new Error('Saving the held series did not produce a file')
  const heldDocument = parseEchoScan(await readFile(savedPath, 'utf8')).document
  expect(heldDocument.mode).toBe('recorded')
  if (heldDocument.mode !== 'recorded' || !heldDocument.batches) throw new Error('Expected a recorded series with a batch')
  const heldUpload = { batch: heldDocument.batches[0]!, captures: heldDocument.recordings }
  expect(heldUpload.captures).toHaveLength(5)
  expect(heldUpload.batch.attempts.map(attempt => attempt.status)).toEqual(Array(5).fill('captured'))
  expect(heldUpload.batch.position).toEqual({ xM: 1.25, yM: 2.5 })
  expect(heldUpload.batch.context).toEqual({ heightM: 1.2, orientation: 'screen-down', headingDeg: 45, speakerVolumePercent: 63 })
  expect(heldUpload.batch.playbackGain).toBe(0.1)
  const sampleRate = heldUpload.batch.sampleRate
  expect(heldUpload.batch.warmupEndFrame - heldUpload.batch.warmupStartFrame).toBeGreaterThanOrEqual(sampleRate)
  for (let index = 0; index < heldUpload.captures.length; index += 1) {
    const capture = heldUpload.captures[index]!
    const acquisition = capture.acquisition!
    expect(capture.captureBackend).toBe('audio-worklet')
    expect(capture.durationMs).toBe(700)
    expect(acquisition.timing.precision).toBe('sample-frame')
    expect(acquisition.continuity.status).toBe('observed')
    expect(acquisition.timing.captureFrames).toBe(Math.round(sampleRate * 0.7))
    expect(acquisition.timing.scheduledChirpStartFrame - acquisition.timing.captureStartFrame!).toBe(Math.round(sampleRate * 0.1))
    expect(acquisition.timing.captureStartFrame).toBeGreaterThanOrEqual(heldUpload.batch.warmupEndFrame)
    if (index > 0) expect(acquisition.timing.captureStartFrame! - heldUpload.captures[index - 1]!.acquisition!.timing.captureStartFrame!).toBeGreaterThanOrEqual(sampleRate)
  }

  await page.evaluate(() => { (window as Window & { __phoneSeriesStats: BrowserProbeStats }).__phoneSeriesStats.delayNextBatchResponse = true })
  await page.getByRole('button', { name: 'Send series' }).click()
  await expect.poll(async () => (await readSession(relayOrigin, auth)).batches.length).toBe(1)
  await page.getByRole('button', { name: 'Cancel send' }).click()
  await expect(page.getByRole('alert')).toContainText('Sending cancelled')
  await expect(page.getByRole('button', { name: 'Send series' })).toBeVisible()
  await page.getByRole('button', { name: 'Send series' }).click()
  await expect(page.getByText('Received by computer')).toBeVisible({ timeout: 15_000 })
  const retriedStats = await browserStats(page)
  expect(retriedStats.batchUploads).toHaveLength(2)
  expect(retriedStats.batchUploads[0]).toEqual(heldUpload)
  expect(retriedStats.batchUploads[1]).toEqual(heldUpload)
  const accepted = await readSession(relayOrigin, auth)
  expect(accepted.captures).toHaveLength(5)
  expect(accepted.batches).toHaveLength(1)
  expect(accepted.batches[0]).toEqual(heldUpload.batch)

  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByTestId('echo-import').setInputFiles({
    name: 'recorded-series.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'cha-echo-scan-v3', mode: 'recorded', recordings: accepted.captures, reviews: [], batches: accepted.batches })),
  })
  await expect(page.getByTestId('echo-probe-batch')).toContainText('5 / 5 captured')
  const exportEvent = page.waitForEvent('download')
  await page.getByTestId('echo-export').click()
  const path = await (await exportEvent).path()
  if (!path) throw new Error('Echo Lab export did not produce a file')
  const exported = parseEchoScan(await readFile(path, 'utf8')).document
  expect(exported.mode).toBe('recorded')
  if (exported.mode !== 'recorded') throw new Error('Expected a recorded scan')
  expect(exported.batches).toEqual(accepted.batches)
  expect(exported.recordings.map(item => item.id)).toEqual(accepted.captures.map(item => item.id))
  expect(exported.recordings.map(item => item.acquisition)).toEqual(accepted.captures.map(item => item.acquisition))
  await page.getByTestId('echo-new-scan').click()
  await page.getByTestId('echo-restore-scan').click()
  await expect(page.getByTestId('echo-probe-batch')).toContainText('5 / 5 captured')
})

test('stopping at sweep three saves a partial batch with explicit interrupted and not-started outcomes', async ({ page, relayOrigin }) => {
  const { token, auth } = await createSession(relayOrigin)
  await instrumentPhone(page)
  await configureSeriesPhone(page, relayOrigin, token)
  await page.getByRole('button', { name: 'Record five sweeps' }).click()
  await expect(page.getByText('Sweep 3 of 5')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop series' }).click()
  await expect(page.getByText('Series held locally')).toBeVisible({ timeout: 10_000 })
  const outcomes = page.getByTestId('echo-probe-batch').getByRole('listitem')
  await expect(outcomes).toHaveCount(5)
  await expect(outcomes.nth(0)).toContainText('Captured')
  await expect(outcomes.nth(1)).toContainText('Captured')
  await expect(outcomes.nth(2)).toContainText('Stopped by user')
  await expect(outcomes.nth(3)).toContainText('Not started')
  await expect(outcomes.nth(4)).toContainText('Not started')
  const stats = await browserStats(page)
  expect(stats.calls).toBe(1)
  expect(stats.trackStates.length).toBeGreaterThan(0)
  expect(stats.trackStates.every(state => state === 'ended')).toBe(true)
  expect(stats.batchUploads).toEqual([])
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save series JSON' }).click()
  const path = await (await download).path()
  if (!path) throw new Error('Saving the partial series did not produce a file')
  const saved = parseEchoScan(await readFile(path, 'utf8')).document
  expect(saved.mode).toBe('recorded')
  if (saved.mode !== 'recorded') throw new Error('Expected a recorded partial series')
  expect(saved.batches).toHaveLength(1)
  expect(saved.batches![0]!.attempts.map(attempt => attempt.status)).toEqual(['captured', 'captured', 'interrupted', 'not-started', 'not-started'])
  expect(saved.batches![0]!.attempts[2]).toMatchObject({ reason: 'cancelled' })
  expect(saved.recordings).toHaveLength(2)
  const untouched = await readSession(relayOrigin, auth)
  expect(untouched.captures).toEqual([])
  expect(untouched.batches).toEqual([])
})

test('retains a complete local series when the 12-capture relay capacity rejects it', async ({ page, relayOrigin }) => {
  const { token, auth } = await createSession(relayOrigin)
  for (let index = 0; index < 8; index += 1) {
    const seeded = await fetch(`${relayOrigin}/api/satellite/captures`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `seed-${index}`, capturedAt: '2026-10-16T12:00:00.000Z', position: { xM: 0, yM: 0 },
        sampleRate: 8_000, durationMs: 1, pcm16Base64: Buffer.alloc(16).toString('base64'),
      }),
    })
    expect(seeded.status).toBe(201)
  }
  await instrumentPhone(page)
  await configureSeriesPhone(page, relayOrigin, token)
  await page.getByRole('button', { name: 'Record five sweeps' }).click()
  await expect(page.getByText('Series held locally')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Send series' }).click()
  await expect(page.getByRole('alert')).toContainText('12-capture or 12-batch limit.', { timeout: 15_000 })
  await expect(page.getByText('Series held locally')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save series JSON' })).toBeVisible()
  const session = await readSession(relayOrigin, auth)
  expect(session.captures).toHaveLength(8)
  expect(session.batches).toEqual([])
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save series JSON' }).click()
  const path = await (await download).path()
  if (!path) throw new Error('Saving the capacity-rejected series did not produce a file')
  const saved = parseEchoScan(await readFile(path, 'utf8')).document
  expect(saved.mode).toBe('recorded')
  if (saved.mode !== 'recorded') throw new Error('Expected a recorded saved series')
  expect(saved.recordings).toHaveLength(5)
  expect(saved.batches).toHaveLength(1)
})
