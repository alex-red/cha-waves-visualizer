import { expect, test, type Page } from '@playwright/test'

async function ready(page: Page) {
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
}

test('focused plan supports fine/coarse keyboard edits and undo without scrolling', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  await expect(canvas).toHaveAccessibleDescription(/0.1 meters.*Shift.*0.5 meters/)
  await canvas.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('probe-x')).toHaveValue('11.9')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(page.getByTestId('probe-y')).toHaveValue('3.0')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('probe-y')).toHaveValue('2.5')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('probe-x')).toHaveValue('12.0')
  await expect(canvas).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await ready(page)
})

test('native controls and modal focus do not move scene objects or change tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  const revision = await canvas.getAttribute('data-field-revision')
  const picker = page.getByRole('combobox', { name: 'Select scene object', exact: true })
  await picker.focus()
  await page.keyboard.press('ArrowDown')
  await expect(picker).toBeFocused()
  await expect(canvas).toHaveAttribute('data-field-revision', revision!)
  await page.getByRole('button', { name: 'Method', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Model notes', exact: true })
  await dialog.focus()
  await page.keyboard.press('s')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Select and move', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveAttribute('data-field-revision', revision!)
  await picker.selectOption('speaker')
  await page.getByTestId('focus-plan').click()
  await expect(canvas).toBeFocused()
  await expect(canvas).toBeInViewport({ ratio: 0.3 })
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('source-x')).toHaveValue('2.1')
})

test('the two-meter plan ruler follows the fitted metric drawing on resize', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const ruler = page.getByTestId('plan-scale')
    await expect(ruler).toHaveAttribute('data-length-m', '2')
    await expect.poll(async () => page.getByTestId('field-canvas').evaluate(canvas => {
      const rect = canvas.getBoundingClientRect()
      const pad = Math.min(80, rect.width * 0.1)
      const expected = Math.min((rect.width - 2 * pad) / 14, (rect.height - 2 * pad) / 10) * 2
      const mark = document.querySelector('[data-testid="plan-scale"] i')!
      return Math.abs(mark.getBoundingClientRect().width - expected)
    })).toBeLessThan(1)
  }
})


test('skip link returns from cutaway to the editable keyboard plan', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('view-cutaway').click()
  await expect(page.getByTestId('cutaway-canvas')).toHaveAttribute('data-backend', /webgpu|webgl/, { timeout: 20_000 })
  const skip = page.getByRole('link', { name: 'Skip to interactive plan', exact: true })
  await skip.focus()
  await page.keyboard.press('Enter')
  const canvas = page.getByTestId('field-canvas')
  await expect(canvas).toBeVisible()
  await expect(canvas).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('probe-x')).toHaveValue('11.9')
})
