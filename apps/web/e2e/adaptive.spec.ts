import { expect, test, type Page } from '@playwright/test'

async function sourceScreen(page: Page, point: [number, number]) {
  const box = await page.getByTestId('field-canvas').boundingBox()
  if (!box) throw new Error('Plan canvas is not visible')
  const pad = Math.min(80, box.width * .1)
  const scale = Math.min((box.width - 2 * pad) / 14, (box.height - 2 * pad) / 10)
  return { x: box.x + (box.width - 14 * scale) / 2 + point[0] * scale,
    y: box.y + box.height - (box.height - 10 * scale) / 2 - point[1] * scale }
}

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

test('a held drag computes a preview then commits one balanced undoable edit', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const initial = await page.getByTestId('probe-value').innerText()
  const start = await sourceScreen(page, [2, 7.8]), end = await sourceScreen(page, [4.4, 7.6])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const invalid = await sourceScreen(page, [6, 5])
  await page.mouse.move(invalid.x, invalid.y)
  await expect(page.getByTestId('solver-status')).toContainText('Invalid position')
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await expect(page.getByTestId('field-quality')).toHaveAttribute('data-quality', 'preview', { timeout: 10000 })
  await page.mouse.up()
  await expect(page.getByTestId('field-quality')).toHaveAttribute('data-quality', 'balanced', { timeout: 10000 })
  await ready(page)
  await expect(page.getByTestId('probe-value')).not.toHaveText(initial)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('probe-value')).toHaveText(initial)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('Escape cancels a preview without losing the existing redo branch', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('door-toggle').click()
  await ready(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  const initial = await page.getByTestId('probe-value').innerText()
  const start = await sourceScreen(page, [2, 7.8]), end = await sourceScreen(page, [4.4, 7.6])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await expect(page.getByTestId('field-quality')).toHaveAttribute('data-quality', 'preview')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.getByTestId('field-quality')).toHaveAttribute('data-quality', 'balanced')
  await ready(page)
  await expect(page.getByTestId('probe-value')).toHaveText(initial)
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('door-toggle')).toContainText('OPEN')
})
