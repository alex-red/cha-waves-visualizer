import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

type Band = { frequencyHz: number; valueDb: number; provenance: string; notes?: string }
type Material = {
  id: string
  name: string
  provenance: string
  acousticTransmissionDb: Band[]
  radioLossDb: Band[]
  acousticAbsorption?: unknown[]
}
type Project = {
  metadata: { id: string; name: string; [key: string]: unknown }
  scene: {
    id: string
    revision: number
    materials: Material[]
    walls: Array<{ materialId: string }>
    openings: Array<{ kind: string; materialId?: string }>
    [key: string]: any
  }
  baseline?: any
  [key: string]: any
}

async function ready(page: Page, expectProbe = true) {
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 20_000 })
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 20_000 })
  if (expectProbe) await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function exportProject(page: Page): Promise<Project> {
  const dialog = page.getByTestId('materials-dialog')
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Close material editor' }).click()
    await expect(dialog).toBeHidden()
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as Project
}

async function importProject(page: Page, source: Project, label: string, expectProbe = true) {
  // Import a fresh object and unique identity so the storage layer never
  // mistakes this test fixture for the current local project.
  const project = structuredClone(source)
  const name = `${label} ${Date.now()}`
  project.metadata = { ...project.metadata, id: `material-e2e-${Date.now()}`, name }
  await page.getByTestId('project-import').setInputFiles({
    name: 'material-editor.cha-waves.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  // Probe count is unchanged by material-only fixtures, so wait for the
  // imported project title to confirm the import finished.
  await expect(page.locator('.project-title strong')).toHaveText(name)
  await ready(page, expectProbe)
  return project
}

async function openMaterials(page: Page) {
  await page.getByTestId('materials-open').click()
  const dialog = page.getByTestId('materials-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleName('Materials and bands')
  return dialog
}

async function currentProbeDb(page: Page) {
  return Number.parseFloat((await page.getByTestId('probe-value').innerText()).replace(/[^-\d.]/g, ''))
}

test('partition acoustic edit changes the exact ray by 4 dB and is one undoable edit', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Save as baseline' }).click()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 })
  const baselineProject = await exportProject(page)
  const rayFixture = structuredClone(baselineProject)
  // Keep the ray outside the demo door opening so it crosses the partition
  // coefficient being edited.
  const probe = rayFixture.scene.probes?.find((item: { id: string }) => item.id === 'hallway-probe')
  if (probe) probe.position = [8, 2.5, 1.5]
  const baselineProbe = rayFixture.baseline?.scene.probes?.find((item: { id: string }) => item.id === 'hallway-probe')
  if (baselineProbe) baselineProbe.position = [8, 2.5, 1.5]
  rayFixture.scene.revision += 1
  if (rayFixture.baseline?.scene) rayFixture.baseline.scene.revision += 1
  const before = await importProject(page, rayFixture, 'Baseline fixture')
  await ready(page)
  const originalScene = structuredClone(before.scene)
  const originalBaseline = structuredClone(before.baseline)
  expect(originalScene.materials.find(material => material.id === 'partition')?.acousticTransmissionDb[0]).toMatchObject({ frequencyHz: 1000, valueDb: 8 })
  const initialDb = await currentProbeDb(page)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  const dialog = await openMaterials(page)
  await dialog.getByTestId('material-select').selectOption('partition')
  const row = dialog.getByTestId('material-acoustic-row').first()
  await row.getByLabel('Loss (dB)').fill('12')
  await dialog.getByTestId('material-apply').click()
  await expect(dialog.getByRole('status')).toContainText('One Undo restores')
  await ready(page)
  expect(await currentProbeDb(page)).toBeCloseTo(initialDb - 4, 1)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()

  await expect(dialog.getByTestId('material-select')).toHaveValue('partition')
  await expect(dialog.getByTestId('material-name')).toHaveValue('Demo lightweight partition')
  const applied = await exportProject(page)
  expect(applied.scene.revision).toBe(originalScene.revision + 1)
  expect(applied.scene.materials.find(material => material.id === 'partition')?.acousticTransmissionDb[0]?.valueDb).toBe(12)
  expect(applied.baseline).toEqual(originalBaseline)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  expect((await exportProject(page)).scene).toEqual(originalScene)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await ready(page)
  expect((await exportProject(page)).scene.materials.find(material => material.id === 'partition')?.acousticTransmissionDb[0]?.valueDb).toBe(12)

  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 })
  await page.reload()
  await ready(page)
  const reloaded = await exportProject(page)
  expect(reloaded.scene.materials.find(material => material.id === 'partition')?.acousticTransmissionDb[0]?.valueDb).toBe(12)
  expect(reloaded.baseline).toEqual(originalBaseline)
})

test('material name, band notes, and provenance persist through export and import', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const initial = await exportProject(page)
  const dialog = await openMaterials(page)
  await dialog.getByTestId('material-select').selectOption('partition')
  await dialog.getByTestId('material-name').fill('Measured acoustic partition')
  await dialog.getByTestId('material-provenance').selectOption('site-measured')
  const row = dialog.getByTestId('material-acoustic-row').first()
  await row.getByLabel('Provenance').selectOption('literature-derived')
  await row.getByLabel('Notes').fill('Measured in the west bedroom, test run 24.')
  await dialog.getByTestId('material-apply').click()
  await expect(dialog.getByRole('status')).toContainText('One Undo restores')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 })
  await expect(dialog.getByTestId('material-name')).toHaveValue('Measured acoustic partition')
  const edited = await exportProject(page)
  const partition = edited.scene.materials.find(material => material.id === 'partition')!
  expect(partition.name).toBe('Measured acoustic partition')
  expect(partition.provenance).toBe('site-measured')
  expect(partition.acousticTransmissionDb[0]).toMatchObject({
    frequencyHz: 1000,
    provenance: 'literature-derived',
    notes: 'Measured in the west bedroom, test run 24.',
  })
  expect(edited.baseline).toEqual(initial.baseline)

  await page.reload()
  await ready(page)
  const reloaded = await exportProject(page)
  expect(reloaded.scene.materials.find(material => material.id === 'partition')).toEqual(partition)
  expect(reloaded.baseline).toEqual(edited.baseline)

  await importProject(page, edited, 'Material round trip')
  const roundTrip = await exportProject(page)
  expect(roundTrip.scene.materials.find(material => material.id === 'partition')).toEqual(partition)
  expect(roundTrip.baseline).toEqual(edited.baseline)
})

test('rejected blank names and duplicate bands preserve drafts and do not enter scene history', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const initial = await exportProject(page)
  const dialog = await openMaterials(page)
  await dialog.getByTestId('material-select').selectOption('partition')
  const name = dialog.getByTestId('material-name')
  await name.fill('   ')
  await dialog.getByTestId('material-apply').click()
  await expect(dialog.getByRole('alert')).toContainText('Material name must contain 1 to 80 characters')
  await expect(name).toHaveValue('   ')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  await name.fill('Demo lightweight partition')
  await dialog.getByTestId('material-add-acoustic').click()
  const duplicate = dialog.getByTestId('material-acoustic-row').nth(1)
  await duplicate.getByLabel('Frequency (Hz)').fill('1000')
  await duplicate.getByLabel('Loss (dB)').fill('30')
  await dialog.getByTestId('material-apply').click()
  await expect(dialog.getByRole('alert')).toContainText('band frequencies must be unique')
  await expect(duplicate.getByLabel('Frequency (Hz)')).toHaveValue('1000')
  await expect(duplicate.getByLabel('Loss (dB)')).toHaveValue('30')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  const unchanged = await exportProject(page)
  expect(unchanged.scene).toEqual(initial.scene)
})

test('500 Hz appears only after every referenced acoustic profile has an exact band', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const initial = await exportProject(page)
  const select = page.getByTestId('frequency-select')
  await expect(select.locator('option[value="500"]')).toHaveCount(0)
  const dialog = await openMaterials(page)

  const referencedIds = new Set([
    ...initial.scene.walls.map(wall => wall.materialId),
    ...initial.scene.openings.filter(opening => opening.kind === 'door' || opening.kind === 'window').map(opening => opening.materialId).filter((id): id is string => !!id),
  ])
  for (const materialId of referencedIds) {
    await dialog.getByTestId('material-select').selectOption(materialId)
    await dialog.getByTestId('material-add-acoustic').click()
    const row = dialog.getByTestId('material-acoustic-row').last()
    await row.getByLabel('Frequency (Hz)').fill('500')
    await row.getByLabel('Loss (dB)').fill('11')
    await row.getByLabel('Provenance').selectOption('user-entered')
    await row.getByLabel('Notes').fill(`Shared 500 Hz test band for ${materialId}.`)
    await dialog.getByTestId('material-apply').click()
    await expect(dialog.getByRole('status')).toContainText('One Undo restores')
  }
  await dialog.getByRole('button', { name: 'Close material editor' }).click()
  await expect(dialog).toBeHidden()
  await expect(select.locator('option[value="500"]')).toHaveCount(1)
  await select.selectOption('500')
  await ready(page)
  expect(Number.isFinite(await currentProbeDb(page))).toBe(true)
  const updatedDialog = await openMaterials(page)
  await expect(updatedDialog.getByTestId('material-frequency-coverage')).toContainText('500 Hz')
})

test('radio loss edit changes the direct reading by 2 dB', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('mode-radio').click()
  await ready(page)
  const initialDb = await currentProbeDb(page)
  const dialog = await openMaterials(page)
  await dialog.getByTestId('material-select').selectOption('door-leaf')
  const row = dialog.getByTestId('material-radio-row').first()
  await expect(row.getByLabel('Frequency (Hz)')).toHaveValue('2400000000')
  await row.getByLabel('Loss (dB)').fill('4')
  await dialog.getByTestId('material-apply').click()
  await expect(dialog.getByRole('status')).toContainText('One Undo restores')
  await ready(page)
  expect(await currentProbeDb(page)).toBeCloseTo(initialDb - 2, 1)
})

test('empty current-frequency profiles stay explicit, stale searches clear after edits, and the dialog fits 320 px', async ({ page, browserName }) => {
  await page.goto('/')
  await ready(page)
  const source = await exportProject(page)
  // A completed placement query is tied to the current scene. A material
  // commit while the results are closed must invalidate that result.
  await page.getByTestId('placement-open').click()
  const placement = page.getByTestId('placement-dialog')
  await expect(placement).toBeVisible()
  await placement.getByTestId('placement-budget').selectOption('64')
  await placement.getByTestId('placement-run').click()
  await expect(placement.getByTestId('placement-candidate').first()).toBeVisible({ timeout: 60_000 })
  await placement.getByRole('button', { name: 'Close placement explorer' }).click()

  const editor = await openMaterials(page)
  await editor.getByTestId('material-select').selectOption('partition')
  await editor.getByTestId('material-name').fill('Edited partition for invalidation')
  await editor.getByTestId('material-apply').click()
  await expect(editor.getByRole('status')).toContainText('One Undo restores')
  await editor.getByRole('button', { name: 'Close material editor' }).click()
  await page.getByTestId('placement-open').click()
  await expect(page.getByTestId('placement-candidate')).toHaveCount(0)
  await expect(page.getByTestId('placement-run')).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('placement-dialog')).toBeHidden()

  await page.setViewportSize({ width: 320, height: 800 })
  const populatedDialog = await openMaterials(page)
  const bounds = await populatedDialog.boundingBox()
  expect(bounds).toBeTruthy()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321)
  const populatedScan = await new AxeBuilder({ page }).include('[data-testid="materials-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(populatedScan.violations.map(({ id }) => id)).toEqual([])
  await populatedDialog.getByTestId('material-acoustic-row').first().scrollIntoViewIfNeeded()
  if (browserName === 'chromium') {
    await mkdir('reports/screenshots', { recursive: true })
    await page.screenshot({ path: 'reports/screenshots/material-editor-phone.png' })
  }
  await page.keyboard.press('Escape')
  await expect(populatedDialog).toBeHidden()
  await expect(page.getByTestId('materials-open')).toBeFocused()

  await page.setViewportSize({ width: 1280, height: 900 })
  const desktopDialog = await openMaterials(page)
  if (browserName === 'chromium') {
    await desktopDialog.evaluate(element => element.scrollTop = 0)
    await mkdir('reports/screenshots', { recursive: true })
    await page.screenshot({ path: 'reports/screenshots/material-editor-desktop.png' })
  }

  await page.keyboard.press('Escape')
  await expect(desktopDialog).toBeHidden()
  await expect(page.getByTestId('materials-open')).toBeFocused()

  const emptyProfiles = structuredClone(source)
  for (const material of emptyProfiles.scene.materials) material.acousticTransmissionDb = []
  await importProject(page, emptyProfiles, 'Empty profiles', false)
  await expect(page.getByTestId('frequency-select')).toHaveValue('1000')
  await expect(page.getByTestId('frequency-select').locator('option:checked')).toContainText('incomplete profiles')
  const emptyDialog = await openMaterials(page)
  await expect(emptyDialog.getByText('No acoustic coefficients authored.')).toBeVisible()
  await expect(emptyDialog.getByTestId('material-frequency-coverage')).toContainText('none authored across referenced assemblies')
  await expect(emptyDialog.getByTestId('material-frequency-coverage')).toContainText('Current setting 1,000 Hz is not covered')
  const emptyScan = await new AxeBuilder({ page }).include('[data-testid="materials-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(emptyScan.violations.map(({ id }) => id)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(emptyDialog).toBeHidden()
  await expect(page.getByTestId('materials-open')).toBeFocused()
})
