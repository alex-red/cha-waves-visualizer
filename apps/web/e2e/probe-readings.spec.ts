import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { createDemoScene, defaultSettings } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

async function loadTwoProbes(page: Page) {
  const scene = createDemoScene()
  scene.probes.push({ id: 'bedroom-point', levelId: 'main', position: [10, 7.2, 1.5], name: 'Bedroom point' })
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await page.getByTestId('project-import').setInputFiles({ name: 'two-points.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(createProject(scene, defaultSettings('acoustics')))) })
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', '2')
  await expect(page.getByTestId('project-export')).toBeEnabled()
}

test('all probes are painted and selectable without changing their coordinates', async ({ page }) => {
  await loadTwoProbes(page)
  const canvas = page.getByTestId('field-canvas')
  const marker = await canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement, rect = canvas.getBoundingClientRect()
    const scale = Number(canvas.dataset.pixelsPerMeter)
    const x = rect.width / 2 + (10 - 7) * scale, y = rect.height / 2 - (7.2 - 5) * scale
    // Sample inside the circular marker, away from its letter and white outline.
    const pixel = Array.from(canvas.getContext('2d')!.getImageData(Math.round((x + 5) * canvas.width / rect.width), Math.round((y + 3) * canvas.height / rect.height), 1, 1).data)
    return { x, y, pixel }
  })
  expect(marker.pixel[1]).toBeGreaterThan(marker.pixel[0]! + 30)
  await canvas.click({ position: { x: marker.x, y: marker.y } })
  await expect(page.getByRole('heading', { name: 'Bedroom point', exact: true })).toBeVisible()
  await expect(page.getByTestId('probe-x')).toHaveValue('10.0')
  await expect(page.getByTestId('probe-y')).toHaveValue('7.2')
  await page.getByTestId('readings-open').click()
  const panel = page.getByTestId('probe-readings-dialog')
  await expect(panel.getByTestId('probe-reading-row')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Choose Across the hall on the plan' }).click()
  await expect(panel).not.toBeVisible()
  await expect(canvas).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Across the hall', exact: true })).toBeVisible()
})

test('readings report same-coordinate baseline changes and export exact CSV values', async ({ page }) => {
  await loadTwoProbes(page)
  await page.getByRole('button', { name: 'Save as baseline', exact: false }).click()
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('project-export')).toBeEnabled()
  await page.getByTestId('readings-open').click()
  const panel = page.getByTestId('probe-readings-dialog')
  await expect(panel.locator('[data-probe-id="hallway-probe"]')).toContainText('+6.0 dB')
  await expect(panel.locator('[data-probe-id="bedroom-point"]')).toContainText('0.0 dB')
  const downloadPromise = page.waitForEvent('download')
  await panel.getByTestId('readings-export').click()
  const download = await downloadPromise
  const csv = await readFile((await download.path())!, 'utf8')
  expect(csv).toContain('"frequency_hz"')
  expect(csv).toContain('"bedroom-point","Bedroom point"')
  expect(csv).toContain('"acoustics","1000"')
  expect(csv).toContain('"-21.')
  expect(csv).not.toContain('"\'-21.')
  await panel.getByRole('button', { name: 'Close probe readings' }).click()
  await expect(page.getByTestId('readings-open')).toBeFocused()
})

for (const width of [320, 1280]) {
  test(`readings panel is accessible and fits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 })
    await loadTwoProbes(page)
    await page.getByTestId('readings-open').click()
    const dialog = page.getByTestId('probe-readings-dialog')
    const dimensions = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)
    const scan = await new AxeBuilder({ page }).include('[data-testid="probe-readings-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(scan.violations).toEqual([])
    if (testInfo.project.name === 'chromium') {
      await mkdir('reports/screenshots', { recursive: true })
      await page.screenshot({ path: `reports/screenshots/probe-readings-${width}.png` })
    }
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('readings-open')).toBeFocused()
  })
}

test('a mismatched baseline explains why its delta is unavailable', async ({ page }) => {
  await loadTwoProbes(page)
  await page.getByRole('button', { name: 'Save as baseline', exact: false }).click()
  await page.getByTestId('mode-radio').click()
  await expect(page.getByTestId('project-export')).toBeEnabled()
  await page.getByTestId('readings-open').click()
  const row = page.getByTestId('probe-readings-dialog').locator('[data-probe-id="hallway-probe"]')
  await expect(row).toContainText('dBm')
  await expect(row).toContainText('Baseline domain differs')
  await expect(row).toContainText('Unavailable')
  await expect(row.locator('.delta')).toHaveCount(0)
})
