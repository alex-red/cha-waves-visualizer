import { test as base, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createSyntheticEchoScan, parseEchoScan } from '../../../packages/echo-scan'
import { simulateEchoCaptures } from '../../../packages/echo'
import { createSatelliteServer } from '../../../scripts/satellite-server.mjs'
import AxeBuilder from '@axe-core/playwright'

const test = base.extend<{ relayOrigin: string }>({
  relayOrigin: async ({}, use) => {
    const server = await createSatelliteServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start satellite test server')
    try { await use(`http://127.0.0.1:${address.port}`) }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  },
})

test('virtual scan infers a hidden room and exports independent echo measurements', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  const dialog = page.getByTestId('echo-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('echo-capture').click()
  await expect(page.getByTestId('echo-estimate')).toHaveCount(0)
  await expect(page.getByTestId('echo-result')).toContainText('three captures')
  await page.getByTestId('echo-example').click()
  await expect(page.getByTestId('echo-estimate')).toBeVisible()
  await expect(page.getByTestId('echo-result')).toContainText('5 positions')
  await expect(page.getByTestId('echo-truth')).toHaveCount(0)
  await page.getByTestId('echo-reveal').check()
  await expect(page.getByTestId('echo-truth')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByTestId('echo-export').click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('cha-echo-scan.json')
  const json = await readFile((await saved.path())!, 'utf8')
  const exported = parseEchoScan(json).document
  expect(exported.mode).toBe('synthetic')
  expect(exported).not.toHaveProperty('reconstruction')
  await page.getByTestId('echo-new-scan').click()
  await expect(page.getByTestId('echo-estimate')).toHaveCount(0)
  await page.getByTestId('echo-import').setInputFiles({ name: 'scan.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await expect(page.getByTestId('echo-scan-notice')).toContainText('Scan opened')
  await expect(page.getByTestId('echo-estimate')).toBeVisible()
  await expect(page.getByTestId('echo-result')).toContainText('5 positions')
  await expect(page.getByTestId('echo-example')).toBeDisabled()
  await page.getByTestId('echo-restore-scan').click()
  await expect(page.getByTestId('echo-estimate')).toHaveCount(0)
  await page.getByTestId('echo-restore-scan').click()
  await expect(page.getByTestId('echo-estimate')).toBeVisible()
  await page.getByRole('button', { name: 'Close Echo Lab' }).click()
  await expect(page.getByTestId('echo-open')).toBeFocused()
})

test('ordinary static preview explains the optional relay requirement', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByRole('button', { name: '02 Phone satellite' }).click()
  await page.getByTestId('satellite-pair').click()
  await expect(page.getByRole('alert')).toContainText('satellite server')
  await expect(page.getByTestId('satellite-qr')).toHaveCount(0)
})

test('QR pairing opens a phone view and joins without activating its microphone', async ({ browser, page, relayOrigin }) => {
  await page.goto(relayOrigin)
  await page.getByTestId('echo-open').click()
  await page.getByRole('button', { name: '02 Phone satellite' }).click()
  await page.getByTestId('satellite-pair').click()
  await expect(page.getByTestId('satellite-qr')).toBeVisible()
  await page.getByTestId('satellite-origin').fill(relayOrigin)
  const href = await page.getByRole('link', { name: 'Open phone view' }).getAttribute('href')
  expect(href).toContain('?satellite=1#')
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const satellite = await phone.newPage()
  await satellite.addInitScript(() => {
    const media = navigator.mediaDevices
    if (media) media.getUserMedia = async () => { throw new Error('Microphone must not be requested during pairing') }
  })
  await satellite.goto(href!)
  await expect(satellite.getByTestId('phone-satellite')).toBeVisible()
  await expect(satellite.getByTestId('project-status')).toHaveCount(0)
  await satellite.getByRole('button', { name: 'Pair device' }).click()
  await expect(satellite.getByRole('button', { name: 'Record five sweeps' })).toBeDisabled()
  await expect(page.getByTestId('echo-dialog').getByRole('status')).toContainText('Phone microphone joined')
  await expect(satellite.locator('body')).not.toContainText('Microphone must not')
  await page.getByRole('button', { name: 'End phone session' }).click()
  await expect(page.getByTestId('satellite-qr')).toHaveCount(0)
  await phone.close()
})

test('Android USB pairing keeps its forwarded localhost origin and explains manual setup', async ({ browser, page, relayOrigin }) => {
  await page.goto(relayOrigin)
  await page.getByTestId('echo-open').click()
  await page.getByRole('button', { name: '02 Phone satellite' }).click()
  await page.getByTestId('satellite-usb').check()
  await expect(page.getByTestId('satellite-https-readiness')).toHaveCount(0)
  await expect(page.getByTestId('satellite-usb-readiness')).toContainText('cannot detect')
  const port = new URL(relayOrigin).port
  const setup = page.getByTestId('satellite-usb-setup')
  await setup.locator('summary').click()
  await expect(setup).toContainText(`bun run satellite:android -- --port ${port}`)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByTestId('echo-dialog').evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: 'reports/echo-lab-usb-setup.png' })
  await page.getByTestId('satellite-pair').click()
  await expect(page.getByTestId('satellite-qr')).toBeVisible()
  await expect(page.getByTestId('satellite-usb-origin')).toHaveText(`http://localhost:${port}`)
  await expect(page.getByTestId('satellite-origin')).toHaveCount(0)
  const href = await page.getByRole('link', { name: 'Open phone view' }).getAttribute('href')
  const url = new URL(href!)
  expect(url.origin).toBe(`http://localhost:${port}`)
  expect(url.searchParams.get('satellite')).toBe('1')
  expect(url.searchParams.get('transport')).toBe('usb')
  expect(url.hash.length).toBeGreaterThan(32)
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const satellite = await phone.newPage()
    await satellite.goto(href!)
    await expect(satellite.getByTestId('phone-usb-notice')).toContainText('cable')
    await satellite.getByRole('button', { name: 'Pair device' }).click()
    await expect(page.locator('.el-connection')).toContainText('joined')
    await satellite.getByRole('radio', { name: 'Single sweep', exact: true }).check()
    await satellite.getByLabel('Phone X coordinate (m)').fill('1.2')
    await satellite.getByLabel('Phone Y coordinate (m)').fill('2.3')
    await expect(satellite.getByRole('button', { name: 'Record sweep' })).toBeEnabled()
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 })
      const dialog = page.getByTestId('echo-dialog')
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      expect((await new AxeBuilder({ page }).include('[data-testid="echo-dialog"]').analyze()).violations).toEqual([])
      await dialog.evaluate(element => { element.scrollTop = 0 })
      await page.screenshot({ path: `reports/echo-lab-usb-${width}.png` })
    }
  } finally { await phone.close() }
})

test('new recordings preserve reviewed peaks and exported scans resume without a relay', async ({ page, request, relayOrigin }) => {
  const { generateChirp } = await import('../../../packages/echo')
  await page.goto(relayOrigin)
  await page.getByTestId('echo-open').click()
  await page.getByRole('button', { name: '02 Phone satellite' }).click()
  await expect(page.getByTestId('satellite-https-readiness')).toContainText('HTTPS')
  await page.getByTestId('satellite-pair').click()
  await expect(page.getByTestId('satellite-qr')).toBeVisible()
  const href = await page.getByRole('link', { name: 'Open phone view' }).getAttribute('href')
  const token = new URL(href!).hash.slice(1)
  const sampleRate = 48000, samples = new Float32Array(sampleRate * 0.7), chirp = generateChirp(sampleRate)
  for (const [offsetMs, amplitude] of [[50, 0.7], [60, 0.4], [68, 0.35], [76, 0.3], [85, 0.25]]) {
    const offset = Math.round(offsetMs! * sampleRate / 1000)
    for (let i = 0; i < chirp.length; i++) samples[offset + i] = samples[offset + i]! + chirp[i]! * amplitude!
  }
  const buffer = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2))
  const capture = { id: 'known-synthetic-pcm', capturedAt: new Date().toISOString(), position: { xM: 2, yM: 2 }, sampleRate, durationMs: 700, pcm16Base64: buffer.toString('base64') }
  const upload = async (data: typeof capture) => {
    const response = await request.post(`${relayOrigin}/api/satellite/captures`, {
      headers: { Origin: relayOrigin, Authorization: `Bearer ${token}` }, data,
    })
    expect(response.ok()).toBe(true)
  }
  await upload(capture)
  await expect(page.getByText('1 recordings received')).toBeVisible()
  await page.getByTestId('echo-analyze').click()
  const first = page.locator('[data-capture-id="known-synthetic-pcm"]')
  const peaks = first.locator('.el-peaks button')
  await expect(peaks).toHaveCount(5)
  await first.locator('.el-direct select').selectOption('0')
  for (const index of [1, 2, 3, 4]) await peaks.nth(index).click()
  await expect(first).toContainText('4/4 wall arrivals selected')
  await page.waitForTimeout(1500)
  await expect(peaks.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await upload({ ...capture, id: 'second-pcm', position: { xM: 3, yM: 3 } })
  await expect(page.getByText('2 recordings received')).toBeVisible()
  await expect(first.locator('.el-recording-select')).toHaveAttribute('aria-pressed', 'true')
  await expect(first.locator('.el-direct select')).toHaveValue('0')
  await expect(first).toContainText('4/4 wall arrivals selected')
  await page.getByTestId('echo-analyze').click()
  await expect(page.locator('[data-capture-id="second-pcm"] .el-peaks button')).toHaveCount(5)
  await expect(peaks.nth(1)).toHaveAttribute('aria-pressed', 'true')
  const download = page.waitForEvent('download')
  await page.getByTestId('echo-export').click()
  const json = await readFile((await (await download).path())!, 'utf8')
  const exported = parseEchoScan(json).document
  expect(exported.mode).toBe('recorded')
  if (exported.mode !== 'recorded') throw new Error('Expected recorded scan')
  expect(exported.recordings).toHaveLength(2)
  expect(exported.recordings[0]?.pcm16Base64).toBe(capture.pcm16Base64)
  expect(exported.reviews.find(review => review.captureId === capture.id)).toMatchObject({ directPeakIndex: 0, wallPeakIndices: [1, 2, 3, 4] })
  expect(json).not.toContain(token)
  expect(exported).not.toHaveProperty('reconstruction')

  // Reopen the portable scan on the ordinary static app with no active pairing.
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByTestId('echo-import').setInputFiles({ name: 'recorded.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  await expect(page.getByTestId('echo-scan-notice')).toContainText('Scan opened')
  await expect(first.locator('.el-direct select')).toHaveValue('0')
  await expect(first).toContainText('4/4 wall arrivals selected')
  await expect(page.getByTestId('echo-analyze')).toBeDisabled()
  await expect(page.getByTestId('satellite-qr')).toHaveCount(0)
  await page.getByTestId('echo-new-scan').click()
  await expect(first).toHaveCount(0)
  await page.getByTestId('echo-restore-scan').click()
  await expect(first).toContainText('4/4 wall arrivals selected')
})

test('translated scan imports fit the map and malformed files preserve the current scan', async ({ page }) => {
  const fixture = { widthM: 6.4, depthM: 4.8, originXM: 100, originYM: -50 }
  const positions = [[1, 1], [3, 2], [5, 1.5], [2, 3.5], [4.8, 3.2]].map(([x, y]) => ({ xM: 100 + x!, yM: -50 + y! }))
  const document = createSyntheticEchoScan(fixture, simulateEchoCaptures(fixture, positions))
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByTestId('echo-import').setInputFiles({ name: 'translated.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  await expect(page.getByTestId('echo-estimate')).toBeVisible()
  await expect(page.getByTestId('echo-result')).toContainText('Origin 100.00, -50.00')
  expect(Number(await page.getByTestId('echo-estimate').getAttribute('width'))).toBeGreaterThan(200)
  await page.getByTestId('echo-import').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await expect(page.getByRole('alert')).toContainText('valid JSON')
  await expect(page.getByTestId('echo-result')).toContainText('Origin 100.00, -50.00')
  await page.getByTestId('echo-import').setInputFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, ' ') })
  await expect(page.getByRole('alert')).toContainText('10 MiB')
  await expect(page.getByTestId('echo-result')).toContainText('Origin 100.00, -50.00')
})

test('phone view handles missing tokens and narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/?satellite=1')
  await expect(page.getByTestId('phone-satellite')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pair device' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('incomplete')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('lab stays accessible and bounded on desktop and phone layouts', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByTestId('echo-example').click()
  await page.getByTestId('echo-reveal').check()
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const dialog = page.getByTestId('echo-dialog')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const results = await new AxeBuilder({ page }).include('[data-testid="echo-dialog"]').analyze()
    expect(results.violations).toEqual([])
    await dialog.evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: `reports/echo-lab-${width}.png` })
  }
})

test('phone capture page is accessible before microphone permission', async ({ page, relayOrigin }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${relayOrigin}/?satellite=1#${'x'.repeat(43)}`)
  await expect(page.getByTestId('phone-satellite')).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
  await page.screenshot({ path: 'reports/phone-satellite-390.png', fullPage: true })
})
