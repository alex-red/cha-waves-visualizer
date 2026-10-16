import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { createHomeScene } from '../../../packages/home'
import { defaultSettings, type Scene } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

type HomeOptions = Parameters<typeof createHomeScene>[0]

function draftingScene(options: HomeOptions = { name: 'Drafting feedback', widthM: 8, depthM: 6, ceilingHeightM: 2.7 }): Scene {
  const scene = createHomeScene(options)
  scene.emitters = []
  scene.probes = []
  return scene
}

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
}

async function importScene(page: Page, scene: Scene) {
  await page.getByTestId('project-import').setInputFiles({
    name: 'drafting-feedback-home.json',
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
  const editor = page.getByTestId('scene-editor-dialog')
  if (await editor.isVisible()) { await editor.getByRole('button', { name: 'Close editor' }).click(); await expect(editor).toBeHidden() }
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-export').click()])
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as { scene: Scene }
}

async function clickPlanPoint(page: Page, x: number, y: number) {
  const point = await svgScreenPoint(page, x, y)
  await page.mouse.click(point.x, point.y)
}

async function hoverPlanPoint(page: Page, x: number, y: number) {
  const point = await svgScreenPoint(page, x, y)
  await page.mouse.move(point.x, point.y)
}

test('dimension labels show true wall lengths and stay out of scene history', async ({ page }) => {
  const scene = draftingScene({
    name: 'Dimension measurement', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'diagonal-3-4-5', start: [1, 1], end: [4, 5] }],
  })
  await ready(page)
  await importScene(page, scene)
  const before = await exportScene(page)
  const dialog = await openEditor(page)
  const canvas = dialog.getByTestId('editor-plan-canvas')
  const dimensions = dialog.getByTestId('editor-dimensions')

  await expect(dimensions).not.toBeChecked()
  await clickPlanPoint(page, 2.5, 3)
  const selectedLabel = dialog.locator('[data-testid="dimension-label"][data-wall-id="diagonal-3-4-5"]')
  await expect(selectedLabel).toBeVisible()
  await expect(selectedLabel).toHaveAttribute('data-draft', 'false')
  expect(Number(await selectedLabel.getAttribute('data-length-m'))).toBeCloseTo(5, 5)
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled()

  await dialog.getByTestId('editor-plan-navigation').getByTestId('editor-plan-zoom-in').click()
  expect(Number(await selectedLabel.getAttribute('data-length-m'))).toBeCloseTo(5, 5)
  await dimensions.check()
  await expect(selectedLabel).toBeVisible()
  await expect(dialog.locator('[data-testid="dimension-label"]')).toHaveCount(scene.walls.length)
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled()
  await expect(canvas.locator('.wall-group')).toHaveCount(scene.walls.length)
  const after = await exportScene(page)
  expect(after.scene).toEqual(before.scene)
})

test('hover feedback distinguishes grid snaps and previews pending wall length', async ({ page, browserName }) => {
  const scene = draftingScene()
  await ready(page)
  await importScene(page, scene)
  const dialog = await openEditor(page)
  const status = dialog.getByTestId('drafting-snap-status')
  const indicator = dialog.getByTestId('snap-indicator')
  const drawButton = dialog.getByRole('button', { name: /Draw a wall/ })

  await drawButton.click()
  // Stay clear of half-grid boundaries, which depend on pointer pixel rounding.
  await hoverPlanPoint(page, 1.05, 1.05)
  await expect(status).toBeVisible()
  await expect(status).toHaveAttribute('data-snap-kind', 'grid')
  await expect(status).toHaveAttribute('data-snap-x', '1')
  await expect(status).toHaveAttribute('data-snap-y', '1')
  await expect(status).toContainText('Grid')
  await expect(indicator).toHaveAttribute('data-snap-kind', 'grid')

  await clickPlanPoint(page, 1.05, 1.05)
  await expect(dialog.locator('.canvas-hint')).toContainText('Start (1.00, 1.00) m')
  await hoverPlanPoint(page, 3.05, 2.05)
  await expect(status).toHaveAttribute('data-snap-x', '3')
  await expect(status).toHaveAttribute('data-snap-y', '2')
  const draftLabel = dialog.locator('[data-testid="dimension-label"][data-wall-id="wall-draft"]')
  await expect(draftLabel).toBeVisible()
  await expect(draftLabel).toHaveAttribute('data-draft', 'true')
  expect(Number(await draftLabel.getAttribute('data-length-m'))).toBeCloseTo(Math.sqrt(5), 2)
  if (browserName === 'chromium') {
    await dialog.getByTestId('editor-dimensions').check()
    await hoverPlanPoint(page, 3.05, 2.05)
    await page.screenshot({ path: 'reports/screenshots/drafting-feedback.png' })
  }
})

test('endpoint snapping takes priority over the grid and commits the exact endpoint', async ({ page }) => {
  const scene = draftingScene({
    name: 'Endpoint priority', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'endpoint-source', start: [3.13, 3.13], end: [3.13, 5.13] }],
  })
  await ready(page)
  await importScene(page, scene)
  const dialog = await openEditor(page)
  const status = dialog.getByTestId('drafting-snap-status')

  await dialog.getByRole('button', { name: /Draw a wall/ }).click()
  await clickPlanPoint(page, 1, 1)
  await hoverPlanPoint(page, 3.12, 3.12)
  await expect(status).toHaveAttribute('data-snap-kind', 'endpoint')
  await expect(status).toHaveAttribute('data-snap-x', '3.13')
  await expect(status).toHaveAttribute('data-snap-y', '3.13')
  await expect(status).toHaveAttribute('data-target-wall-id', 'endpoint-source')
  await expect(status).toContainText('Endpoint')

  await clickPlanPoint(page, 3.12, 3.12)
  const exported = await exportScene(page)
  const addedWall = exported.scene.walls.find(wall => wall.id === 'wall-1')
  expect(addedWall).toBeTruthy()
  expect(addedWall!.start).toEqual([1, 1])
  expect(addedWall!.end).toEqual([3.13, 3.13])
})

test('leaving the canvas and switching to pan clears hover feedback but preserves the pending wall start', async ({ page }) => {
  const scene = draftingScene()
  await ready(page)
  await importScene(page, scene)
  const dialog = await openEditor(page)
  const canvas = dialog.getByTestId('editor-plan-canvas')
  const status = dialog.getByTestId('drafting-snap-status')
  const indicator = dialog.getByTestId('snap-indicator')
  const controls = dialog.getByTestId('editor-plan-navigation')

  await dialog.getByRole('button', { name: /Draw a wall/ }).click()
  await clickPlanPoint(page, 2, 2)
  await hoverPlanPoint(page, 4, 4)
  await expect(indicator).toBeVisible()
  const pendingDimension = dialog.locator('[data-testid="dimension-label"][data-wall-id="wall-draft"]')
  await expect(pendingDimension).toBeVisible()
  const rect = await canvas.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect!.x + rect!.width + 20, rect!.y + rect!.height + 30)
  await expect(status).toHaveAttribute('data-snap-kind', '')
  await expect(status).toHaveAttribute('data-snap-x', '')
  await expect(status).toHaveAttribute('data-snap-y', '')
  await expect(indicator).toHaveCount(0)
  await expect(pendingDimension).toHaveCount(0)

  await controls.getByTestId('editor-plan-pan').click()
  await expect(controls.getByTestId('editor-plan-pan')).toHaveAttribute('aria-pressed', 'true')
  await expect(status).toHaveAttribute('data-snap-kind', '')
  await expect(indicator).toHaveCount(0)
  await expect(pendingDimension).toHaveCount(0)
  await controls.getByTestId('editor-plan-pan').click()
  await clickPlanPoint(page, 4, 4)
  const exported = await exportScene(page)
  const addedWall = exported.scene.walls.find(wall => wall.id === 'wall-1')
  expect(addedWall).toBeTruthy()
  expect(addedWall!.start).toEqual([2, 2])
  expect(addedWall!.end).toEqual([4, 4])
})

test('dimension toggle and snap readout remain usable and accessible at 320px', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await ready(page)
  await importScene(page, draftingScene())
  const dialog = await openEditor(page)
  const dimensions = dialog.getByTestId('editor-dimensions')
  const status = dialog.getByTestId('drafting-snap-status')

  await expect(dimensions).toBeVisible()
  await dimensions.check()
  await expect(dimensions).toBeChecked()
  await dialog.getByRole('button', { name: /Draw a wall/ }).click()
  await hoverPlanPoint(page, 1.12, 1.12)
  await expect(status).toBeVisible()
  await expect(status).toHaveAttribute('data-snap-kind', 'grid')
  const statusBounds = await status.boundingBox()
  expect(statusBounds).not.toBeNull()
  expect(statusBounds!.x).toBeGreaterThanOrEqual(0)
  expect(statusBounds!.x + statusBounds!.width).toBeLessThanOrEqual(321)
  const hintBounds = await dialog.locator('.canvas-hint').boundingBox()
  expect(hintBounds).not.toBeNull()
  for (const label of await dialog.locator('.dimension-label').all()) {
    const bounds = (await label.boundingBox())!
    const overlapsHint = bounds.x < hintBounds!.x + hintBounds!.width && bounds.x + bounds.width > hintBounds!.x
      && bounds.y < hintBounds!.y + hintBounds!.height && bounds.y + bounds.height > hintBounds!.y
    expect(overlapsHint).toBe(false)
  }

  const toggleA11y = await new AxeBuilder({ page }).include('[data-testid="editor-dimensions"]').analyze()
  expect(toggleA11y.violations).toEqual([])
  const readoutA11y = await new AxeBuilder({ page }).include('[data-testid="drafting-snap-status"]').analyze()
  expect(readoutA11y.violations).toEqual([])
  if (browserName === 'chromium') await page.screenshot({ path: 'reports/screenshots/drafting-feedback-mobile.png' })
})
