import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createDemoScene, defaultSettings } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function panMode(page: Page, enabled = true) {
  const toggle = page.getByTestId('plan-pan')
  if ((await toggle.getAttribute('aria-pressed')) !== String(enabled)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', String(enabled))
}

async function worldAt(page: Page, x: number, y: number) {
  return page.getByTestId('field-canvas').evaluate((element, screenPoint) => {
    const canvas = element as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const scale = Number(canvas.dataset.pixelsPerMeter)
    const centerX = Number(canvas.dataset.planCenterX)
    const centerY = Number(canvas.dataset.planCenterY)
    const centerScreenX = Number(canvas.dataset.planCenterScreenX ?? rect.width / 2)
    const centerScreenY = Number(canvas.dataset.planCenterScreenY ?? rect.height / 2)
    return {
      x: centerX + (screenPoint.x - rect.left - centerScreenX) / scale,
      y: centerY - (screenPoint.y - rect.top - centerScreenY) / scale,
    }
  }, { x, y })
}

async function screenFor(page: Page, x: number, y: number) {
  return page.getByTestId('field-canvas').evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const scale = Number(canvas.dataset.pixelsPerMeter)
    const centerX = Number(canvas.dataset.planCenterX)
    const centerY = Number(canvas.dataset.planCenterY)
    const centerScreenX = Number(canvas.dataset.planCenterScreenX ?? rect.width / 2)
    const centerScreenY = Number(canvas.dataset.planCenterScreenY ?? rect.height / 2)
    return { x: rect.left + centerScreenX + (point.x - centerX) * scale, y: rect.top + centerScreenY - (point.y - centerY) * scale }
  }, { x, y })
}

test('zoom controls clamp, fit restores the home view, and navigation leaves field identity unchanged', async ({ page }) => {
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  const queryHash = await canvas.getAttribute('data-query-hash')
  const initialScale = Number(await canvas.getAttribute('data-pixels-per-meter'))
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '1')

  await page.getByTestId('plan-zoom-in').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '1.25')
  await expect.poll(async () => Number(await canvas.getAttribute('data-pixels-per-meter')) / initialScale).toBeCloseTo(1.25, 4)
  await page.getByTestId('plan-zoom-out').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '1')
  await page.getByTestId('plan-zoom-out').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '0.8')
  await expect.poll(async () => Number(await canvas.getAttribute('data-pixels-per-meter'))).toBeLessThan(initialScale)
  const fittedCenter = [await canvas.getAttribute('data-plan-center-x'), await canvas.getAttribute('data-plan-center-y')]
  await panMode(page)
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await page.getByTestId('plan-fit').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '1')
  await expect(canvas).toHaveAttribute('data-plan-center-x', fittedCenter[0]!)
  await expect(canvas).toHaveAttribute('data-plan-center-y', fittedCenter[1]!)
  await panMode(page, false)
  await expect(canvas).toHaveAttribute('data-query-hash', queryHash!)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  for (let i = 0; i < 10; i++) await page.getByTestId('plan-zoom-in').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '8')
  await expect(page.getByTestId('plan-zoom-in')).toBeDisabled()
  await expect.poll(async () => page.getByTestId('plan-scale').evaluate(ruler => {
    const scale = Number(document.querySelector('[data-testid="field-canvas"]')?.getAttribute('data-pixels-per-meter'))
    return Math.abs(ruler.querySelector('i')!.getBoundingClientRect().width - Number(ruler.getAttribute('data-length-m')) * scale)
  })).toBeLessThan(1)
  for (let i = 0; i < 13; i++) await page.getByTestId('plan-zoom-out').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '0.5')
  await expect(page.getByTestId('plan-zoom-out')).toBeDisabled()
})

test('wheel zoom preserves the world point beneath the cursor', async ({ page }) => {
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const point = { x: bounds!.x + bounds!.width * 0.67, y: bounds!.y + bounds!.height * 0.36 }
  const before = await worldAt(page, point.x, point.y)
  const initialScale = Number(await canvas.getAttribute('data-pixels-per-meter'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => Number(await canvas.getAttribute('data-pixels-per-meter'))).toBeGreaterThan(initialScale)
  const after = await worldAt(page, point.x, point.y)
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.03)
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.03)
  expect(await canvas.evaluate(element => {
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, cancelable: true, bubbles: true })
    element.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(false)
})

test('pan mode moves the view without editing the scene and Escape or pointercancel restores the view', async ({ page }) => {
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  const initialCenter = [await canvas.getAttribute('data-plan-center-x'), await canvas.getAttribute('data-plan-center-y')]
  const queryHash = await canvas.getAttribute('data-query-hash')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await panMode(page)

  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const start = { x: bounds!.x + bounds!.width * 0.2, y: bounds!.y + bounds!.height * 0.2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 72, start.y + 36, { steps: 3 })
  await page.mouse.up()
  await expect.poll(async () => canvas.getAttribute('data-plan-center-x')).not.toBe(initialCenter[0])
  await expect(canvas).toHaveAttribute('data-query-hash', queryHash!)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  const pannedCenter = [await canvas.getAttribute('data-plan-center-x'), await canvas.getAttribute('data-plan-center-y')]
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 45, start.y - 25)
  await page.keyboard.press('Escape')
  await expect(canvas).toHaveAttribute('data-plan-center-x', pannedCenter[0]!)
  await expect(canvas).toHaveAttribute('data-plan-center-y', pannedCenter[1]!)
  await page.mouse.up()

  await page.mouse.move(start.x, start.y)
  await canvas.evaluate(element => element.addEventListener('pointerdown', event => element.setAttribute('data-test-pointer-id', String((event as PointerEvent).pointerId)), { once: true }))
  await page.mouse.down()
  await page.mouse.move(start.x - 30, start.y + 30)
  await canvas.dispatchEvent('pointercancel', { pointerId: Number(await canvas.getAttribute('data-test-pointer-id')), bubbles: true })
  await expect(canvas).toHaveAttribute('data-plan-center-x', pannedCenter[0]!)
  await expect(canvas).toHaveAttribute('data-plan-center-y', pannedCenter[1]!)
  await page.mouse.up()

  await panMode(page, false)
  for (const temporary of ['space', 'middle'] as const) {
    const center = await canvas.getAttribute('data-plan-center-x')
    await canvas.focus()
    if (temporary === 'space') await page.keyboard.down('Space')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: temporary === 'middle' ? 'middle' : 'left' })
    await page.mouse.move(start.x + 25, start.y + 15)
    await page.mouse.up({ button: temporary === 'middle' ? 'middle' : 'left' })
    if (temporary === 'space') await page.keyboard.up('Space')
    await expect(canvas).not.toHaveAttribute('data-plan-center-x', center!)
    await expect(canvas).toHaveAttribute('data-query-hash', queryHash!)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  }
})

test('keyboard pan mode moves by CSS pixels while default arrows still edit selected objects', async ({ page }) => {
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  await panMode(page)
  await canvas.focus()
  const before = [Number(await canvas.getAttribute('data-plan-center-x')), Number(await canvas.getAttribute('data-plan-center-y'))]
  const scale = Number(await canvas.getAttribute('data-pixels-per-meter'))
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await canvas.getAttribute('data-plan-center-x'))).not.toBe(before[0])
  const after = [Number(await canvas.getAttribute('data-plan-center-x')), Number(await canvas.getAttribute('data-plan-center-y'))]
  expect(Math.abs(after[0]! - before[0]!)).toBeCloseTo(40 / scale, 4)
  await page.keyboard.press('Shift+ArrowDown')
  const shifted = Number(await canvas.getAttribute('data-plan-center-y'))
  expect(Math.abs(shifted - after[1]!)).toBeCloseTo(80 / scale, 4)

  await panMode(page, false)

  await canvas.focus()
  const xBefore = await page.getByTestId('probe-x').inputValue()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('probe-x')).not.toHaveValue(xBefore)
  await page.keyboard.press('0')
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '1')
})

test('source and probe dragging remains model-based after zooming and panning', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  await page.getByTestId('plan-zoom-in').click()
  await panMode(page)
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const origin = { x: bounds!.x + bounds!.width * 0.18, y: bounds!.y + bounds!.height * 0.22 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 30, origin.y + 18)
  await page.mouse.up()
  await panMode(page, false)
  if (test.info().project.name === 'chromium') await page.screenshot({ path: 'reports/screenshots/plan-navigation.png' })

  for (const item of [
    { point: { x: 12, y: 2.5 }, xTestId: 'probe-x', yTestId: 'probe-y' },
    { point: { x: 2, y: 7.8 }, xTestId: 'source-x', yTestId: 'source-y' },
  ]) {
    const start = await screenFor(page, item.point.x, item.point.y)
    const screenTarget = { x: start.x + 24, y: start.y - 15 }
    const expected = await worldAt(page, screenTarget.x, screenTarget.y)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(screenTarget.x, screenTarget.y, { steps: 3 })
    await page.mouse.up()
    await expect.poll(async () => Number(await page.getByTestId(item.xTestId).inputValue())).toBeCloseTo(expected.x, 1)
    await expect.poll(async () => Number(await page.getByTestId(item.yTestId).inputValue())).toBeCloseTo(expected.y, 1)
  }
})

test('resize preserves view center and the controls fit an accessible 320px layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await ready(page)
  const canvas = page.getByTestId('field-canvas')
  await page.getByTestId('plan-zoom-in').click()
  await page.getByTestId('plan-pan').click()
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  const center = [await canvas.getAttribute('data-plan-center-x'), await canvas.getAttribute('data-plan-center-y')]
  const controls = page.getByTestId('plan-navigation')
  const dimensions = await controls.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
  const scan = await new AxeBuilder({ page }).include('[data-testid="plan-navigation"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
  if (test.info().project.name === 'chromium') await page.screenshot({ path: 'reports/screenshots/plan-navigation-mobile.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(canvas).toHaveAttribute('data-plan-center-x', center[0]!)
  await expect(canvas).toHaveAttribute('data-plan-center-y', center[1]!)
})

test('installing another project resets plan navigation to fit', async ({ page }) => {
  await ready(page)
  await page.getByTestId('plan-zoom-in').click()
  await page.getByTestId('plan-pan').click()
  const zoomBeforeEdit = await page.getByTestId('plan-zoom-label').getAttribute('data-zoom')
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', zoomBeforeEdit!)
  await page.getByTestId('door-toggle').click()
  const scene = createDemoScene()
  scene.levels[0]!.boundary = [[0, 0], [40, 0], [40, 25], [0, 25]]
  await page.getByTestId('project-import').setInputFiles({
    name: 'new-navigation-home.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(createProject(scene, defaultSettings('acoustics')))),
  })
  await expect(page.getByTestId('plan-zoom-label')).toHaveAttribute('data-zoom', '1')
  await expect(page.getByTestId('plan-pan')).toHaveAttribute('aria-pressed', 'false')
})
