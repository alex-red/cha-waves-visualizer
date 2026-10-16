import { expect, test } from '@playwright/test'

test('cutaway uses the numeric field and switching views preserves the probe result', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  const estimate = await page.getByTestId('probe-value').innerText()
  await page.getByTestId('view-cutaway').click()
  await expect(page.getByTestId('cutaway-canvas')).toHaveAttribute('data-backend', /webgpu|webgl/, { timeout: 20000 })
  await expect(page.getByTestId('render-backend-runtime')).toContainText(/WebGPU|WebGL/)
  await expect(page.getByTestId('probe-value')).toHaveText(estimate)
  await page.screenshot({ path: 'reports/screenshots/cutaway.png', fullPage: true })
  await page.getByTestId('view-plan').click()
  await expect(page.getByTestId('field-canvas')).toBeVisible()
  await expect(page.getByTestId('probe-value')).toHaveText(estimate)
  expect(errors).toEqual([])
})

test('an unavailable graphics context falls back to the usable plan', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
      if (contextId !== '2d') return null
      return original.apply(this, [contextId, ...args] as Parameters<typeof original>)
    } as typeof original
  })
  await page.goto('/')
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await page.getByTestId('view-cutaway').click()
  await expect(page.getByTestId('view-cutaway')).toBeDisabled({ timeout: 20000 })
  await expect(page.getByTestId('field-canvas')).toBeVisible()
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await expect(page.getByTestId('renderer-notice')).toContainText('Returned to plan')
})


test('the compact cutaway canvas has stable, bounded dimensions', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 740 })
  await page.goto('/')
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await page.getByTestId('view-cutaway').click()
  await expect(page.getByTestId('cutaway-canvas')).toHaveAttribute('data-backend', /webgpu|webgl/, { timeout: 20000 })
  const dimensions = await page.getByTestId('cutaway-canvas').evaluate((canvas: HTMLCanvasElement) => ({
    pixelsHigh: canvas.height, cssHigh: canvas.getBoundingClientRect().height, documentHigh: document.documentElement.scrollHeight,
  }))
  expect(dimensions.pixelsHigh).toBeLessThanOrEqual(4096)
  expect(dimensions.cssHigh).toBeLessThan(1200)
  expect(dimensions.documentHigh).toBeLessThan(2500)
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating')
  const after = await page.getByTestId('cutaway-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().height)
  expect(Math.abs(after - dimensions.cssHigh)).toBeLessThan(2)
})
