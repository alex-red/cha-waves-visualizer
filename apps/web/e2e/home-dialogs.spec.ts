import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'

for (const width of [320, 1280]) {
  test(`new home dialogs are accessible and bounded at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
    for (const [trigger, dialogId, close] of [
      ['new-home', 'home-builder-dialog', 'Cancel creating a home'],
      ['edit-home', 'scene-editor-dialog', 'Close editor'],
    ] as const) {
      await page.getByTestId(trigger).click()
      const dialog = page.getByTestId(dialogId)
      await expect(dialog).toBeVisible()
      const dimensions = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)
      const scan = await new AxeBuilder({ page }).include(`[data-testid="${dialogId}"]`).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(scan.violations).toEqual([])
      if (testInfo.project.name === 'chromium') {
        await mkdir('reports/screenshots', { recursive: true })
        await page.screenshot({ path: `reports/screenshots/${dialogId}-${width}.png` })
      }
      await dialog.getByRole('button', { name: close, exact: true }).click()
      await expect(page.getByTestId(trigger)).toBeFocused()
    }
  })
}
