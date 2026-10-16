import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function loadHomeAcoustics(page: Page) {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('scenario-open').click()
  await page.getByTestId('scenario-select').selectOption('home-acoustics')
  await page.getByTestId('scenario-load').click()
  await page.keyboard.press('Escape')
  await ready(page)
}

test('individual home doors distinguish the study control from the bedroom path', async ({ page }) => {
  await loadHomeAcoustics(page)
  const baseline = Number.parseFloat(await page.getByTestId('probe-value').innerText())

  await page.getByTestId('door-select').selectOption('study-door')
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('door-toggle')).toHaveAttribute('aria-pressed', 'true')
  await ready(page)
  expect(Number.parseFloat(await page.getByTestId('probe-value').innerText())).toBeCloseTo(baseline, 1)

  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('door-toggle')).toHaveAttribute('aria-pressed', 'false')
  await ready(page)
  await page.getByTestId('door-select').selectOption('bedroom-door')
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('door-toggle')).toHaveAttribute('aria-pressed', 'true')
  await ready(page)
  const bedroomOpen = Number.parseFloat(await page.getByTestId('probe-value').innerText())
  expect(bedroomOpen - baseline).toBeCloseTo(7, 1)
})

test('probe height changes the reading, can be undone, and persists after reload', async ({ page }) => {
  await loadHomeAcoustics(page)
  const baseline = await page.getByTestId('probe-value').innerText()
  await expect(page.getByTestId('probe-z')).toHaveValue('1.2')

  await page.getByTestId('probe-z').fill('2.6')
  await page.getByTestId('probe-z').press('Tab')
  await ready(page)
  const raised = await page.getByTestId('probe-value').innerText()
  expect(raised).not.toBe(baseline)
  await expect(page.getByTestId('probe-z')).toHaveValue('2.6')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('probe-z')).toHaveValue('1.2')
  await expect(page.getByTestId('probe-value')).toHaveText(baseline)

  await page.getByTestId('probe-z').fill('2.6')
  await page.getByTestId('probe-z').press('Tab')
  await ready(page)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
  const savedReading = await page.getByTestId('probe-value').innerText()
  await page.reload()
  await ready(page)
  await expect(page.getByTestId('probe-z')).toHaveValue('2.6')
  await expect(page.getByTestId('probe-value')).toHaveText(savedReading)

  await page.getByTestId('source-z').fill('2.6')
  await page.getByTestId('source-z').press('Tab')
  await ready(page)
  const raisedSourceReading = await page.getByTestId('probe-value').innerText()
  expect(raisedSourceReading).not.toBe(savedReading)
  await expect(page.getByTestId('source-z')).toHaveValue('2.6')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('source-z')).toHaveValue('1.2')
  await expect(page.getByTestId('probe-value')).toHaveText(savedReading)
})

test('an invalid height leaves the last valid probe and reading intact', async ({ page }) => {
  await loadHomeAcoustics(page)
  const validReading = await page.getByTestId('probe-value').innerText()
  await page.getByTestId('probe-z').fill('99')
  // Resizing redraws the plan and updates UI diagnostics without committing Z.
  await page.setViewportSize({ width: 1100, height: 720 })
  await expect(page.getByTestId('probe-z')).toHaveValue('99')
  await page.getByTestId('probe-z').press('Tab')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('probe-z')).toHaveValue('1.2')
  await ready(page)
  await expect(page.getByTestId('probe-value')).toHaveText(validReading)
})

test('imported elevations remain expressed above a nonzero floor', async ({ page }) => {
  await loadHomeAcoustics(page)
  const downloadEvent = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  const download = await downloadEvent
  const exportedPath = await download.path()
  expect(exportedPath).toBeTruthy()
  const project = JSON.parse(await readFile(exportedPath!, 'utf8'))
  const raisedFloor = 1.5
  for (const level of project.scene.levels) level.floorZ += raisedFloor
  for (const wall of project.scene.walls) wall.baseZ += raisedFloor
  for (const item of [...project.scene.emitters, ...project.scene.probes]) item.position[2] += raisedFloor

  await page.getByTestId('project-import').setInputFiles({
    name: 'raised-floor.cha-waves.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await ready(page)
  await expect(page.getByTestId('probe-z')).toHaveValue('1.2')
  await expect(page.getByTestId('source-z')).toHaveValue('1.2')
  await expect(page.getByText('Receiver · 1.2 m above floor')).toBeVisible()
  await expect(page.getByTestId('field-receiver-plane')).toContainText('1.5 m above floor')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-receiver-z', '3')

  // A fixed receiver plane above an unusually low modeled ceiling stays
  // explicit; the app must not silently lower it or invalidate the exact probe.
  project.scene.levels[0].ceilingHeightM = 1
  for (const wall of project.scene.walls) wall.heightM = 0.9
  for (const opening of project.scene.openings) opening.heightM = 0.8
  for (const item of [...project.scene.emitters, ...project.scene.probes]) item.position[2] = raisedFloor + 0.5
  await page.getByTestId('project-import').setInputFiles({
    name: 'low-ceiling.cha-waves.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await ready(page)
  await expect(page.getByTestId('field-plane-status')).toBeVisible()
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-receiver-z', '3')
  await expect(page.getByTestId('worker-error')).toBeHidden()

})
