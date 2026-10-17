import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { createRecordedEchoScan, parseEchoScan } from '../../../packages/echo-scan'

test('saved three-position recordings expose fixed responses and exact silence without choosing walls', async ({ page }) => {
  const sampleRate = 8000
  const recordings = [[0, 0], [1, 0], [0, 1]].map(([xM, yM], index) => {
    const pcm = Buffer.alloc(5600 * 2)
    for (let i = 0; i < 5600; i++) pcm.writeInt16LE(i % 2 ? 80 : -80, i * 2)
    if (index === 1) pcm.fill(0, 800 * 2, 960 * 2)
    pcm.writeInt16LE(32767, 0)
    return { id: `diagnostic-${index}`, capturedAt: '2026-01-01T00:00:00.000Z', position: { xM: xM!, yM: yM! }, sampleRate, durationMs: 700, pcm16Base64: pcm.toString('base64') }
  })
  const reviews = recordings.map((recording, index) => ({
    captureId: recording.id, directPeakIndex: null, wallPeakIndices: [],
    peaks: [{ delayMs: 100 + index * 10, strength: .6 }, { delayMs: 102 + index * 10 + index * .05, strength: .09 }],
  }))
  const scan = createRecordedEchoScan(recordings, reviews)
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByTestId('echo-import').setInputFiles({ name: 'diagnostic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scan)) })
  const comparison = page.getByTestId('echo-response-review')
  await expect(comparison).toBeVisible()
  await expect(page.getByTestId('echo-stationary-response')).toContainText('+2.05 ms')
  await expect(page.getByTestId('echo-stationary-response')).toContainText('0.10 ms across 3 recordings')
  await expect(page.getByTestId('echo-quality-1')).toContainText('No zero runs ≥5 ms')
  await expect(page.getByTestId('echo-quality-1')).toContainText('1 sample near full scale')
  await expect(page.getByTestId('echo-quality-2')).toContainText('20.0 ms exact silence')
  await expect(page.getByTestId('echo-quality-2')).toContainText('100.0–120.0 ms from recording start')
  await expect(page.getByTestId('echo-quality-3')).toContainText('No zero runs ≥5 ms')
  await expect(page.getByTestId('echo-result')).toContainText('Too few detected candidates')
  await expect(page.getByTestId('echo-estimate')).toHaveCount(0)
  for (const select of await page.locator('.el-direct select').all()) await expect(select).toHaveValue('')
  const first = page.locator('[data-capture-id="diagnostic-0"]')
  await first.locator('.el-direct select').selectOption('0')
  await first.locator('.el-peaks button').nth(1).click()
  await expect(page.getByTestId('echo-stationary-response')).toContainText('+2.05 ms')
  const download = page.waitForEvent('download')
  await page.getByTestId('echo-export').click()
  const exported = parseEchoScan(await readFile((await (await download).path())!, 'utf8')).document
  expect(exported.mode).toBe('recorded')
  if (exported.mode !== 'recorded') throw new Error('Expected recorded scan')
  expect(exported.recordings).toEqual(recordings)
  expect(exported.reviews[0]).toMatchObject({ directPeakIndex: 0, wallPeakIndices: [1] })
  expect(exported).not.toHaveProperty('diagnostics')
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.getByTestId('echo-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect((await new AxeBuilder({ page }).include('[data-testid="echo-response-review"]').analyze()).violations).toEqual([])
  }
  await page.getByTestId('echo-new-scan').click()
  await expect(comparison).toHaveCount(0)
  await page.getByTestId('echo-restore-scan').click()
  await expect(page.getByTestId('echo-quality-2')).toContainText('20.0 ms exact silence')
  await expect(first.locator('.el-direct select')).toHaveValue('0')
})
