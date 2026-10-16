import { expect, test } from '@playwright/test'

async function ready(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

test('door edits recompute a numeric estimate and undo restores it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  const initial = await page.getByTestId('probe-value').innerText()
  await page.screenshot({ path: 'reports/screenshots/workspace.png', fullPage: true })
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('door-toggle')).toContainText('OPEN')
  await ready(page)
  await expect(page.getByTestId('probe-value')).not.toHaveText(initial)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('probe-value')).toHaveText(initial)
  // A new edit after undo exercises history cloning rather than a proxy object.
  await page.getByTestId('door-toggle').click()
  await ready(page)
  expect(errors).toEqual([])
})

test('source coordinates update the worker field and radio has independent units', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const initial = await page.getByTestId('probe-value').innerText()
  await page.getByTestId('source-x').fill('4')
  await page.getByTestId('source-x').press('Tab')
  await ready(page)
  await expect(page.getByTestId('probe-value')).not.toHaveText(initial)
  await page.getByTestId('mode-radio').click()
  await ready(page)
  await expect(page.getByTestId('probe-value')).toContainText('dBm')
  const radio = await page.getByTestId('probe-value').innerText()
  await page.getByTestId('frequency-select').selectOption('5000000000')
  await ready(page)
  await expect(page.getByTestId('probe-value')).not.toHaveText(radio)
  await page.getByTestId('mode-acoustics').click()
  await ready(page)
  await expect(page.getByTestId('probe-value')).not.toContainText('dBm')
})

test('the compact plan stays usable with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await ready(page)
  await expect(page.getByTestId('field-canvas')).toBeVisible()
  await expect(page.getByTestId('source-x')).toBeVisible()
  const width = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(width.body).toBeLessThanOrEqual(width.viewport + 1)
})


test('baseline differences are real and incompatible bands disable comparison', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Save as baseline' }).click()
  await page.getByTestId('door-toggle').click()
  await ready(page)
  await page.getByRole('button', { name: 'Compare', exact: false }).click()
  await expect(page.getByText('Difference · working − baseline')).toBeVisible()
  await page.screenshot({ path: 'reports/screenshots/difference.png', fullPage: true })
  await page.getByTestId('mode-radio').click()
  await ready(page)
  await expect(page.getByRole('button', { name: 'Compare', exact: false })).toBeDisabled()
})

test('rapid model changes settle on the latest acoustic query', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const initial = await page.getByTestId('probe-value').innerText()
  await page.getByTestId('mode-radio').click()
  await page.getByTestId('frequency-select').selectOption('6000000000')
  await page.getByTestId('mode-acoustics').click()
  await ready(page)
  await expect(page.getByTestId('probe-value')).toHaveText(initial)
  await expect(page.getByTestId('solver-status')).toContainText('1000 Hz')
})
