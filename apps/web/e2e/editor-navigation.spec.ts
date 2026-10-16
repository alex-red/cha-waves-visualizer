import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { createHomeScene } from '../../../packages/home'
import { createDemoScene, defaultSettings, type Scene } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await expect(page.getByTestId('probe-value')).not.toContainText('—', { timeout: 15_000 })
}

async function importScene(page: Page, scene: ReturnType<typeof createDemoScene>) {
  await page.getByTestId('project-import').setInputFiles({
    name: 'editor-navigation-home.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(createProject(scene, defaultSettings('acoustics')))),
  })
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', String(scene.probes.length))
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
}

async function openEditor(page: Page) {
  await page.getByTestId('edit-home').click()
  const dialog = page.getByTestId('scene-editor-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function svgScreenPoint(page: Page, x: number, y: number) {
  return page.getByTestId('editor-plan-canvas').evaluate((element, point) => {
    const svg = element as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    const scale = Number(svg.dataset.pixelsPerMeter)
    const centerX = Number(svg.dataset.planCenterX)
    const centerY = Number(svg.dataset.planCenterY)
    return {
      x: rect.left + rect.width / 2 + (point.x - centerX) * scale,
      y: rect.top + rect.height / 2 - (point.y - centerY) * scale,
    }
  }, { x, y })
}

async function exportScene(page: Page): Promise<{ scene: Scene }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-export').click()])
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as { scene: Scene }
}

test('editor zoom, pan, and fit change only the camera, not project data or history', async ({ page }) => {
  await ready(page)
  const initial = await exportScene(page)
  const dialog = await openEditor(page)
  const controls = dialog.getByTestId('editor-plan-navigation')
  const canvas = dialog.getByTestId('editor-plan-canvas')
  await expect(controls.getByTestId('editor-plan-zoom-label')).toHaveAttribute('data-zoom', '1')
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled()
  const probeX = await dialog.locator('.probe-coordinates input').nth(0).inputValue()
  const wallsBefore = await canvas.locator('.wall-group').count()

  await controls.getByTestId('editor-plan-zoom-in').click()
  await expect(controls.getByTestId('editor-plan-zoom-label')).toHaveAttribute('data-zoom', '1.25')
  await controls.getByTestId('editor-plan-pan').click()
  await expect(controls.getByTestId('editor-plan-pan')).toHaveAttribute('aria-pressed', 'true')
  const rect = await canvas.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect!.x + rect!.width * 0.18, rect!.y + rect!.height * 0.18)
  await page.mouse.down()
  await page.mouse.move(rect!.x + rect!.width * 0.18 + 45, rect!.y + rect!.height * 0.18 + 20, { steps: 3 })
  const pannedX = await canvas.getAttribute('data-plan-center-x')
  await canvas.dispatchEvent('pointerdown', { pointerId: 99, isPrimary: false, pointerType: 'touch', button: 0, bubbles: true })
  await canvas.dispatchEvent('pointercancel', { pointerId: 99, bubbles: true })
  await expect(canvas).toHaveAttribute('data-plan-center-x', pannedX!)
  await page.mouse.up()
  if (test.info().project.name === 'chromium') await dialog.locator('.drawing-column').screenshot({ path: 'reports/screenshots/editor-navigation.png' })
  await controls.getByTestId('editor-plan-fit').click()
  await expect(controls.getByTestId('editor-plan-zoom-label')).toHaveAttribute('data-zoom', '1')
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled()
  await expect(dialog.locator('.probe-coordinates input').nth(0)).toHaveValue(probeX)
  await expect(canvas.locator('.wall-group')).toHaveCount(wallsBefore)
  await dialog.getByRole('button', { name: 'Close editor' }).click()
  await expect(page.getByTestId('scene-editor-dialog')).toBeHidden()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  const exported = await exportScene(page)
  expect(exported.scene).toEqual(initial.scene)
})

test('wall endpoints drawn after editor zoom and pan map to snapped model coordinates', async ({ page }) => {
  await ready(page)
  const scene = createHomeScene({ name: 'Editor drawing grid', widthM: 8, depthM: 6, ceilingHeightM: 2.7 })
  scene.emitters = []
  scene.probes = []
  await importScene(page, scene)
  const dialog = await openEditor(page)
  const controls = dialog.getByTestId('editor-plan-navigation')
  const canvas = dialog.getByTestId('editor-plan-canvas')
  await controls.getByTestId('editor-plan-zoom-in').click()
  await controls.getByTestId('editor-plan-pan').click()
  const rect = await canvas.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect!.x + rect!.width * 0.18, rect!.y + rect!.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(rect!.x + rect!.width * 0.18 + 30, rect!.y + rect!.height * 0.2 + 24)
  await page.mouse.up()
  await controls.getByTestId('editor-plan-pan').click()
  await dialog.getByRole('button', { name: 'Draw a wall' }).click()
  const first = await svgScreenPoint(page, 4, 1)
  const second = await svgScreenPoint(page, 4, 5)
  await page.mouse.click(first.x, first.y)
  await page.mouse.click(second.x, second.y)
  await expect(canvas.locator('.wall-group')).toHaveCount(5)
  await expect(dialog.locator('.editor-notice')).toContainText(/wall created.*snapping/i)
  await expect(page.locator('button[aria-label="Undo"]')).toBeEnabled()
  await dialog.getByRole('button', { name: 'Close editor' }).click()
  const exported = await exportScene(page)
  expect(exported.scene.walls.find(wall => wall.id === 'wall-1')).toMatchObject({ start: [4, 1], end: [4, 5] })
})

test('panning while the wall start is pending preserves that endpoint and does not consume a click', async ({ page }) => {
  await ready(page)
  const scene = createHomeScene({ name: 'Pan during wall draft', widthM: 8, depthM: 6, ceilingHeightM: 2.7 })
  scene.emitters = []
  scene.probes = []
  await importScene(page, scene)
  const dialog = await openEditor(page)
  const controls = dialog.getByTestId('editor-plan-navigation')
  const canvas = dialog.getByTestId('editor-plan-canvas')
  await dialog.getByRole('button', { name: 'Draw a wall' }).click()
  const first = await svgScreenPoint(page, 2, 2)
  await page.mouse.click(first.x, first.y)
  await expect(dialog.locator('.editor-notice')).toContainText(/start.*2\.00, 2\.00/i)
  await controls.getByTestId('editor-plan-pan').click()
  const rect = await canvas.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect!.x + rect!.width * 0.15, rect!.y + rect!.height * 0.18)
  await page.mouse.down()
  await page.mouse.move(rect!.x + rect!.width * 0.15 + 35, rect!.y + rect!.height * 0.18 + 22)
  await page.mouse.up()
  await expect(canvas.locator('.wall-group')).toHaveCount(4)
  await expect(dialog.locator('.editor-notice')).toContainText(/start.*2\.00, 2\.00/i)

  await controls.getByTestId('editor-plan-pan').click()
  const second = await svgScreenPoint(page, 4, 4)
  await page.mouse.click(second.x, second.y)
  await expect(canvas.locator('.wall-group')).toHaveCount(5)
  await expect(dialog.locator('.editor-notice')).toContainText(/wall created/i)
})

test('editor navigation controls fit a phone viewport and keyboard zoom respects its bounds', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await ready(page)
  const dialog = await openEditor(page)
  const controls = dialog.getByTestId('editor-plan-navigation')
  const canvas = dialog.getByTestId('editor-plan-canvas')
  const bounds = await controls.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1)
  await canvas.focus()
  for (let index = 0; index < 25; index++) await page.keyboard.press('Shift+Equal')
  await expect(controls.getByTestId('editor-plan-zoom-label')).toHaveAttribute('data-zoom', '8')
  await page.keyboard.press('0')
  await expect(controls.getByTestId('editor-plan-zoom-label')).toHaveAttribute('data-zoom', '1')
  const scan = await new AxeBuilder({ page }).include('[data-testid="editor-plan-navigation"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
  if (test.info().project.name === 'chromium') await dialog.locator('.drawing-column').screenshot({ path: 'reports/screenshots/editor-navigation-mobile.png' })
})
