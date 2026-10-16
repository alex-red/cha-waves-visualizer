import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { createHomeScene } from '../../../packages/home'
import { defaultSettings, type Scene } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

type HomeOptions = Parameters<typeof createHomeScene>[0]

function junctionScene(options: HomeOptions = { name: 'Wall junctions', widthM: 8, depthM: 6, ceilingHeightM: 2.7 }): Scene {
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
  const created = createProject(scene, defaultSettings('acoustics'))
  const document = { ...created, metadata: { ...created.metadata, name: `Junction import ${created.metadata.id}` } }
  await page.getByTestId('project-import').setInputFiles({
    name: 'wall-junctions-home.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(document)),
  })
  // Zero probes and saved status can already match the previous workspace.
  await expect(page.locator('.project-title strong')).toHaveText(document.metadata.name)
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', String(scene.probes.length))
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
}

async function openEditor(page: Page) {
  await page.getByTestId('edit-home').click()
  const dialog = page.getByTestId('scene-editor-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function exportScene(page: Page): Promise<{ scene: Scene }> {
  const editor = page.getByTestId('scene-editor-dialog')
  if (await editor.isVisible()) {
    await editor.getByRole('button', { name: 'Close editor' }).click()
    await expect(editor).toBeHidden()
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-export').click()])
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as { scene: Scene }
}

async function svgScreenPoint(page: Page, x: number, y: number) {
  // The editor mounts inside a closed dialog. Its ResizeObserver must update
  // the camera after showModal() before a world coordinate can be clicked.
  await expect.poll(() => page.getByTestId('editor-plan-canvas').evaluate(element => {
    const svg = element as SVGSVGElement
    const matrix = svg.getScreenCTM()
    const scale = Number(svg.dataset.pixelsPerMeter)
    return Boolean(matrix && scale > 1 && Math.abs(matrix.a - scale) < 0.01 && Math.abs(matrix.d - scale) < 0.01)
  })).toBe(true)
  return page.getByTestId('editor-plan-canvas').evaluate((element, point) => {
    const svg = element as SVGSVGElement
    // Use the rendered SVG transform, including its current viewport dimensions.
    const matrix = svg.getScreenCTM()
    if (!matrix) throw new Error('Editor plan has no screen transform')
    const projected = new DOMPoint(point.x, -point.y).matrixTransform(matrix)
    return { x: projected.x, y: projected.y }
  }, { x, y })
}

async function clickPlanPoint(page: Page, x: number, y: number) {
  const point = await svgScreenPoint(page, x, y)
  await page.mouse.click(point.x, point.y)
}

async function addWallByCoordinates(dialog: Awaited<ReturnType<typeof openEditor>>, start: [number, number], end: [number, number]) {
  await dialog.getByText('Enter wall coordinates').click()
  for (const [label, value] of [['x₁', start[0]], ['y₁', start[1]], ['x₂', end[0]], ['y₂', end[1]]] as const) {
    await dialog.getByLabel(label).fill(String(value))
  }
  await dialog.getByRole('button', { name: 'Add wall from coordinates' }).click()
}

function wallGeometry(scene: Scene) {
  return scene.walls.map(wall => ({ id: wall.id, start: wall.start, end: wall.end })).sort((a, b) => a.id.localeCompare(b.id))
}

test('opt-in X and T junctions share exact endpoints and undo or redo as whole edits', async ({ page, browserName }) => {
  const scene = junctionScene({
    name: 'Junction host', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'host', start: [1, 3], end: [7, 3] }],
  })
  await ready(page)
  await importScene(page, scene)
  const dialog = await openEditor(page)
  const join = dialog.getByTestId('editor-join-walls')
  await expect(join).toHaveAccessibleName('Join intersecting walls')
  await expect(join).not.toBeChecked()
  await join.check()

  await addWallByCoordinates(dialog, [4, 1], [4, 5])
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  if (browserName === 'chromium') {
    await dialog.getByTestId('editor-dimensions').check()
    await page.screenshot({ path: 'reports/screenshots/wall-junctions.png' })
  }
  let exported = await exportScene(page)
  const xWalls = exported.scene.walls.filter(wall => !wall.id.startsWith('envelope-'))
  expect(xWalls.length).toBe(4)
  expect(xWalls.some(wall => wall.id === 'host' && wall.start[0] === 1 && wall.end[0] === 4)).toBe(true)
  expect(xWalls.filter(wall => wall.start[0] === 4 && wall.end[0] === 4)).toHaveLength(2)
  expect(xWalls.every(wall => wall.start[0] === 4 || wall.end[0] === 4 || wall.id === 'host')).toBe(true)
  const xGeometry = wallGeometry(exported.scene)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  exported = await exportScene(page)
  expect(exported.scene.walls).toEqual(scene.walls)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  exported = await exportScene(page)
  expect(wallGeometry(exported.scene)).toEqual(xGeometry)

  // A separate T junction verifies an endpoint-to-interior join.
  const tScene = junctionScene({
    name: 'T junction', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'host', start: [1, 3], end: [7, 3] }],
  })
  await importScene(page, tScene)
  const editorAgain = await openEditor(page)
  await editorAgain.getByTestId('editor-join-walls').check()
  await editorAgain.getByRole('button', { name: /Draw a wall/ }).click()
  await clickPlanPoint(page, 4, 3)
  await clickPlanPoint(page, 4, 5)
  await expect(editorAgain.getByRole('alert')).toHaveCount(0)
  exported = await exportScene(page)
  expect(exported.scene.walls).toHaveLength(tScene.walls.length + 2)
  expect(exported.scene.walls.some(wall => wall.start[0] === 4 && wall.start[1] === 3 && wall.end[0] === 4 && wall.end[1] === 5)).toBe(true)
  const tGeometry = wallGeometry(exported.scene)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await page.reload()
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', '0')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  exported = await exportScene(page)
  expect(wallGeometry(exported.scene)).toEqual(tGeometry)
})

test('crossings stay rejected by default and selected interior splits preserve openings on the second child', async ({ page }) => {
  const scene = junctionScene({
    name: 'Split with opening', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'partition', start: [1, 3], end: [7, 3] }],
  })
  scene.openings = [{ id: 'door-west', wallId: 'partition', fromT: 0.8, toT: 0.9, sillAboveBaseM: 0, heightM: 2.1, kind: 'door', isOpen: false, fixed: false, materialId: 'home-door' }]
  await ready(page)
  await importScene(page, scene)
  let dialog = await openEditor(page)
  await expect(dialog.getByTestId('editor-join-walls')).not.toBeChecked()
  await addWallByCoordinates(dialog, [4, 1], [4, 5])
  await expect(dialog.getByRole('alert')).toContainText(/crosses or overlaps/i)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(dialog.locator('.wall-group')).toHaveCount(scene.walls.length)

  await clickPlanPoint(page, 4.5, 3)
  const offset = dialog.getByTestId('editor-split-offset')
  await expect(offset).toHaveAccessibleName('Split distance from start')
  await offset.fill('4.5')
  await dialog.getByTestId('editor-split-wall').click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  const exported = await exportScene(page)
  const firstChild = exported.scene.walls.find(wall => wall.id === 'partition')!
  const otherChild = exported.scene.walls.find(wall => wall.id.startsWith('partition-part-'))!
  expect(firstChild.start).toEqual([1, 3])
  expect(firstChild.end).toEqual([5.5, 3])
  expect(otherChild.start).toEqual([5.5, 3])
  expect(otherChild.end).toEqual([7, 3])
  expect(exported.scene.openings).toHaveLength(1)
  expect(exported.scene.openings[0]!.wallId).toBe(otherChild.id)
  expect(exported.scene.openings[0]!.fromT).toBeCloseTo(0.2, 4)
  expect(exported.scene.openings[0]!.toT).toBeCloseTo(0.6, 4)
})

test('doorway split rejection preserves geometry and history; exterior walls cannot be split', async ({ page }) => {
  const scene = junctionScene({
    name: 'Rejected split', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'partition', start: [1, 3], end: [7, 3] }],
  })
  scene.openings = [{ id: 'door-west', wallId: 'partition', fromT: 0.3, toT: 0.5, sillAboveBaseM: 0, heightM: 2.1, kind: 'door', isOpen: false, fixed: false, materialId: 'home-door' }]
  await ready(page)
  await importScene(page, scene)
  const original = (await exportScene(page)).scene
  const dialog = await openEditor(page)
  await clickPlanPoint(page, 2.5, 3)
  await dialog.getByTestId('editor-split-offset').fill('2.0')
  await dialog.getByTestId('editor-split-wall').click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect((await exportScene(page)).scene.walls).toEqual(original.walls)
  await expect((await exportScene(page)).scene.openings).toEqual(original.openings)

  const exteriorScene = junctionScene()
  await importScene(page, exteriorScene)
  const exteriorEditor = await openEditor(page)
  await clickPlanPoint(page, 4, 0)
  await expect(exteriorEditor.getByTestId('editor-split-offset')).toBeDisabled()
  await expect(exteriorEditor.getByTestId('editor-split-wall')).toBeDisabled()
  await expect(exteriorEditor.getByText(/exterior walls cannot be split/i)).toBeVisible()
})

test('junction and split controls stay within a 320px viewport and pass accessibility checks', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await ready(page)
  await importScene(page, junctionScene({
    name: 'Mobile wall edit', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'partition', start: [1, 3], end: [7, 3] }],
  }))
  const dialog = await openEditor(page)
  const join = dialog.getByTestId('editor-join-walls')
  await expect(join).toBeVisible()
  const joinBounds = await join.boundingBox()
  expect(joinBounds).not.toBeNull()
  expect(joinBounds!.x).toBeGreaterThanOrEqual(0)
  expect(joinBounds!.x + joinBounds!.width).toBeLessThanOrEqual(321)
  const joinA11y = await new AxeBuilder({ page }).include('[data-testid="editor-join-walls"]').analyze()
  expect(joinA11y.violations).toEqual([])
  await clickPlanPoint(page, 4, 3)
  const splitInput = dialog.getByTestId('editor-split-offset')
  const splitButton = dialog.getByTestId('editor-split-wall')
  await expect(splitInput).toHaveAccessibleName('Split distance from start')
  for (const control of [splitInput, splitButton]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321)
  }
  const splitA11y = await new AxeBuilder({ page }).include('[data-testid="editor-split-offset"]').analyze()
  expect(splitA11y.violations).toEqual([])
  if (browserName === 'chromium') {
    await splitButton.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'reports/screenshots/wall-junctions-mobile.png' })
  }
})
