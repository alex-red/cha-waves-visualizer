import { expect, test, type Locator, type Page } from '@playwright/test'

const viewports = [
  { name: '320x800 mobile', width: 320, height: 800 },
  // This CSS viewport is a practical layout proxy for a 1280 CSS-pixel desktop
  // displayed at 200% zoom; Playwright does not change browser zoom here.
  { name: '640x450 compact 200% zoom proxy', width: 640, height: 450 },
  { name: '1280x720 desktop', width: 1280, height: 720 },
] as const

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(dimensions, JSON.stringify(dimensions)).toEqual({
    viewport: dimensions.viewport,
    document: dimensions.viewport,
    body: dimensions.viewport,
  })
}

async function expectDialogFitsAndScrolls(dialog: Locator, page: Page) {
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }
  })
  const { width, height } = page.viewportSize()!
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(width)
  expect(bounds.bottom).toBeLessThanOrEqual(height)
  expect(bounds.scrollHeight).toBeGreaterThan(bounds.clientHeight)

  const scrollPoint = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height - 24 }
  })
  await page.mouse.move(scrollPoint.x, scrollPoint.y)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollTop)).toBe(0)
  await expectNoHorizontalOverflow(page)
}

async function expectFocusStaysInDialog(dialog: Locator, page: Page, tabCount: number) {
  for (let index = 0; index < tabCount; index += 1) {
    await page.keyboard.press(index === tabCount - 1 ? 'Shift+Tab' : 'Tab')
    const focus = await dialog.evaluate(element => ({
      inside: element.contains(document.activeElement),
      browserChrome: document.activeElement === document.body && !document.hasFocus(),
      activeTag: document.activeElement?.tagName,
    }))
    // Native modal dialogs may let Tab reach browser chrome. Background page
    // controls must remain inert; browser chrome is not a focus-trap failure.
    expect(focus.inside || focus.browserChrome, JSON.stringify(focus)).toBe(true)
    if (focus.browserChrome) await dialog.getByRole('button').first().focus()
  }
  await page.getByTestId('mode-radio').evaluate(element => (element as HTMLElement).focus())
  await expect(page.getByTestId('mode-radio')).not.toBeFocused()
}

for (const viewport of viewports) {
  test(`${viewport.name}: primary controls and numeric inspector remain usable without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await ready(page)
    await expectNoHorizontalOverflow(page)
    if (viewport.width === 320) await page.screenshot({ path: 'reports/screenshots/mobile-320.png' })

    await expect(page.getByRole('button', { name: 'Guided home study', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Method', exact: true })).toBeVisible()
    await expect(page.getByTestId('field-canvas')).toBeVisible()
    await expect(page.getByTestId('mode-radio')).toBeVisible()
    await page.getByTestId('view-plan').click()
    await expect(page.getByTestId('view-plan')).toHaveClass(/active/)
    await page.getByTestId('mode-radio').click()
    await expect(page.getByTestId('mode-radio')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('mode-acoustics').click()
    await expect(page.getByTestId('mode-acoustics')).toHaveAttribute('aria-pressed', 'true')

    const probeX = page.getByTestId('probe-x')
    await probeX.scrollIntoViewIfNeeded()
    await expect(probeX).toBeVisible()
    await probeX.focus()
    await expect(probeX).toBeFocused()
    await expectNoHorizontalOverflow(page)
  })
}

test('640x450 CSS viewport proxy: Explore and Method stay bounded, scroll internally, and contain keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 })
  await page.goto('/')
  await ready(page)

  await page.getByRole('button', { name: 'Guided home study', exact: true }).click()
  const explore = page.getByRole('dialog', { name: 'Test one change at a time.', exact: true })
  await expect(explore).toBeVisible()
  await expectDialogFitsAndScrolls(explore, page)
  await expectFocusStaysInDialog(explore, page, 12)
  await page.keyboard.press('Escape')
  await expect(explore).toBeHidden()

  await page.getByRole('button', { name: 'Method', exact: true }).click()
  const method = page.getByRole('dialog', { name: 'Model notes', exact: true })
  await expect(method).toBeVisible()
  await expectDialogFitsAndScrolls(method, page)
  await expectFocusStaysInDialog(method, page, 5)
  await page.keyboard.press('Escape')
  await expect(method).toBeHidden()
})
