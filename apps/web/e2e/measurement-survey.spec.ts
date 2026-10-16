import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import { createDemoScene, defaultSettings, evaluatePoint } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

const headers = ['id', 'label', 'x_m', 'y_m', 'z_m', 'rssi_dbm', 'frequency_hz', 'scene_id', 'level_id', 'source_id', 'source_x_m', 'source_y_m', 'source_z_m', 'eirp_dbm']
const context = ['2400000000', 'demo-apartment', 'main', 'access-point', '2', '7.8', '1.2', '18']
let fixtureSequence = 0

function csvRow(id: string, label: string, x: number, y: number, z: number, rssi: number, overrides: Partial<Record<number, string>> = {}) {
  const row = [id, label, String(x), String(y), String(z), String(rssi), ...context]
  for (const [index, value] of Object.entries(overrides)) row[Number(index)] = value
  return row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')
}

function surveyCsv(rows = [
  csvRow('hall-reading', 'Hall receiver', 12, 2.5, 1.5, -50),
  csvRow('outside-reading', 'Outside receiver', 20, 20, 1.5, -60),
]) {
  return [headers.map(value => `"${value}"`).join(','), ...rows].join('\r\n')
}

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15000 })
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15000 })
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15000 })
}

async function waitForProjectSaved(page: Page) {
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15000 })
}

let importSequence = 0
async function importProject(page: Page, value: unknown, name = 'survey-project.json') {
  const project = typeof value === 'string' ? JSON.parse(value) : structuredClone(value) as any
  const expectedName = `${project.metadata.name} · import ${++importSequence}`
  project.metadata = { ...project.metadata, name: expectedName }
  const text = JSON.stringify(project)
  await page.getByTestId('project-import').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.locator('.project-title strong')).toHaveText(expectedName, { timeout: 15000 })
  await waitForProjectSaved(page)
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 20000 })
}

async function openSurvey(page: Page) {
  await page.getByTestId('survey-open').click()
  const dialog = page.getByTestId('survey-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeSurvey(dialog: Locator) {
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close measurement survey' }).click()
  await expect(dialog).not.toBeVisible()
}

async function importMeasurements(page: Page, dialog: Locator, csv = surveyCsv()) {
  await dialog.getByLabel('Survey name').fill('Building walk-through')
  await dialog.getByLabel('CSV data').fill(csv)
  await dialog.getByTestId('survey-import').click()
  await expect(dialog.getByRole('heading', { name: 'Building walk-through' })).toBeVisible()
  expect(await dialog.evaluate(element => (element as HTMLDialogElement).matches(':modal'))).toBe(true)
  await waitForProjectSaved(page)
}

async function radioProject() {
  const scene = createDemoScene()
  const document = createProject(scene, defaultSettings('radio'))
  const fixture = JSON.parse(serializeProject(document))
  fixture.metadata.name = `Survey fixture ${++fixtureSequence}`
  return JSON.stringify(fixture)
}

test('imports measured RSSI with finite residuals, excludes invalid points, and is one undoable survey change', async ({ page }) => {
  await ready(page)
  const fixtureText = await radioProject()
  const fixture = JSON.parse(fixtureText)
  await importProject(page, fixtureText)
  await page.getByTestId('mode-radio').click()
  await expect(page.getByTestId('frequency-select')).toHaveValue('2400000000')
  const sourceX = await page.getByTestId('source-x').inputValue()
  const sourceY = await page.getByTestId('source-y').inputValue()
  const probeCount = await page.getByTestId('field-canvas').getAttribute('data-probe-count')
  const dialog = await openSurvey(page)
  await importMeasurements(page, dialog)

  const validEstimate = evaluatePoint(createDemoScene(), defaultSettings('radio'), [12, 2.5, 1.5])
  expect(validEstimate.valid).toBe(true)
  const validRow = dialog.locator('[data-testid="survey-row"][data-id="hall-reading"]')
  const excludedRow = dialog.locator('[data-testid="survey-row"][data-id="outside-reading"]')
  await expect(validRow).toHaveAttribute('data-valid', 'true')
  const residual = Number(await validRow.getAttribute('data-residual'))
  expect(Number.isFinite(residual)).toBe(true)
  expect(residual).toBeCloseTo(validEstimate.value! - (-50), 5)
  await expect(excludedRow).toHaveAttribute('data-valid', 'false')
  await expect(excludedRow).toContainText('outside the modeled floor')
  await expect(dialog.getByTestId('survey-summary')).toHaveAttribute('data-valid', '1')
  await expect(dialog.getByTestId('survey-summary')).toHaveAttribute('data-excluded', '1')
  await expect(page.getByTestId('frequency-select')).toHaveValue('2400000000')
  await expect(page.getByTestId('source-x')).toHaveValue(sourceX)
  await expect(page.getByTestId('source-y')).toHaveValue(sourceY)
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', probeCount!)

  await closeSurvey(dialog)
  const postImport = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  const postImportDocument = JSON.parse(await readFile((await (await postImport).path())!, 'utf8'))
  expect(postImportDocument.scene).toEqual(fixture.scene)
  expect(postImportDocument.settings).toEqual(fixture.settings)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const undone = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  const undoneDocument = JSON.parse(await readFile((await (await undone).path())!, 'utf8'))
  expect(undoneDocument.survey).toBeUndefined()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  const redone = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  expect(JSON.parse(await readFile((await (await redone).path())!, 'utf8')).survey.name).toBe('Building walk-through')

  const visibleDialog = await openSurvey(page)
  await visibleDialog.getByTestId('survey-clear').click()
  await expect(visibleDialog.getByRole('heading', { name: 'Building walk-through' })).toHaveCount(0)
  await closeSurvey(visibleDialog)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const clearUndone = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  expect(JSON.parse(await readFile((await (await clearUndone).path())!, 'utf8')).survey.name).toBe('Building walk-through')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  const clearRedone = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  expect(JSON.parse(await readFile((await (await clearRedone).path())!, 'utf8')).survey).toBeUndefined()
})

test('survey survives project export, reload, and import; a legacy v2 project migrates without losing its baseline', async ({ page, browser }) => {
  await ready(page)
  await importProject(page, await radioProject())
  await page.getByTestId('mode-radio').click()
  const dialog = await openSurvey(page)
  await importMeasurements(page, dialog, surveyCsv([csvRow('hall-reading', 'Hall receiver', 12, 2.5, 1.5, -52)]))
  await closeSurvey(dialog)

  const exported = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  const projectText = await readFile((await (await exported).path())!, 'utf8')
  const document = JSON.parse(projectText)
  expect(document.formatVersion).toBe(3)
  expect(document.survey.observations[0].rssiDbm).toBe(-52)

  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15000 })
  await page.reload()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 15000 })
  const afterReload = await openSurvey(page)
  await expect(afterReload.getByRole('heading', { name: 'Building walk-through' })).toBeVisible()
  await expect(afterReload.getByTestId('survey-row')).toHaveCount(1)
  await closeSurvey(afterReload)

  const fresh = await browser.newPage()
  await ready(fresh)
  await importProject(fresh, projectText)
  const imported = await openSurvey(fresh)
  await expect(imported.getByRole('heading', { name: 'Building walk-through' })).toBeVisible()
  await closeSurvey(imported)

  await fresh.getByRole('button', { name: 'Save as baseline', exact: false }).click()
  const legacyDownload = fresh.waitForEvent('download')
  await fresh.getByTestId('project-export').click()
  const legacy = JSON.parse(await readFile((await (await legacyDownload).path())!, 'utf8'))
  delete legacy.survey
  legacy.formatVersion = 2
  legacy.metadata.name = 'Legacy migration fixture'
  await importProject(fresh, legacy, 'legacy-v2.json')
  await expect(fresh.getByRole('button', { name: 'Compare', exact: false })).toBeEnabled()
  const migratedDownload = fresh.waitForEvent('download')
  await fresh.getByTestId('project-export').click()
  const migrated = JSON.parse(await readFile((await (await migratedDownload).path())!, 'utf8'))
  expect(migrated.formatVersion).toBe(3)
  expect(migrated.baseline).toBeTruthy()
  expect(migrated.survey).toBeUndefined()
  await fresh.close()
})

test('frequency and source context changes pause comparison; compatible scene edits refresh predictions', async ({ page }) => {
  await ready(page)
  await importProject(page, await radioProject())
  await page.getByTestId('mode-radio').click()
  const dialog = await openSurvey(page)
  await importMeasurements(page, dialog)
  const row = dialog.locator('[data-testid="survey-row"][data-id="hall-reading"]')
  const baselineResidual = Number(await row.getAttribute('data-residual'))

  await closeSurvey(dialog)
  await page.getByTestId('frequency-select').selectOption('5000000000')
  const changedFrequency = await openSurvey(page)
  await expect(changedFrequency.getByText('Survey and current model contexts differ.')).toBeVisible()
  await expect(changedFrequency.getByText('Predictions and residuals are unavailable until the context is compatible.')).toBeVisible()
  await expect(changedFrequency.getByTestId('survey-row')).toHaveCount(0)
  await closeSurvey(changedFrequency)
  await page.getByTestId('frequency-select').selectOption('2400000000')
  await page.getByTestId('source-x').fill('3')
  await page.getByTestId('source-x').dispatchEvent('change')
  const changedSource = await openSurvey(page)
  await expect(changedSource.getByText('Survey and current model contexts differ.')).toBeVisible()
  await expect(changedSource.getByTestId('survey-row')).toHaveCount(0)
  await closeSurvey(changedSource)
  await page.getByTestId('source-x').fill('2')
  await page.getByTestId('source-x').dispatchEvent('change')
  const restored = await openSurvey(page)
  await expect(restored.locator('[data-testid="survey-row"][data-id="hall-reading"]')).toHaveAttribute('data-valid', 'true')
  await closeSurvey(restored)

  await page.getByTestId('door-toggle').click()
  const changedMaterial = await openSurvey(page)
  await expect(changedMaterial.locator('[data-testid="survey-row"][data-id="hall-reading"]')).toHaveAttribute('data-valid', 'true')
  const updatedResidual = Number(await changedMaterial.locator('[data-testid="survey-row"][data-id="hall-reading"]').getAttribute('data-residual'))
  expect(Number.isFinite(updatedResidual)).toBe(true)
  expect(updatedResidual).not.toBeCloseTo(baselineResidual, 4)
})

test('malformed and mixed-context CSV submissions preserve the current survey, draft, and history', async ({ page }) => {
  await ready(page)
  await importProject(page, await radioProject())
  await page.getByTestId('mode-radio').click()
  const dialog = await openSurvey(page)
  await importMeasurements(page, dialog, surveyCsv([csvRow('original-reading', 'Original', 12, 2.5, 1.5, -51)]))
  await dialog.locator('.sv-import > summary').click()
  const draftName = dialog.getByLabel('Survey name')
  const draftCsv = dialog.getByLabel('CSV data')
  await draftName.fill('Keep this draft')
  for (const invalidCsv of [
    'id,label,x_m,y_m,z_m,rssi_dbm\n"unterminated',
    surveyCsv([
      csvRow('first-context', 'First source', 12, 2.5, 1.5, -60),
      csvRow('mixed-reading', 'Other source', 11, 2.5, 1.5, -61, { 9: 'other-source' }),
    ]),
  ]) {
    await draftCsv.fill(invalidCsv)
    const enteredDraft = await draftCsv.inputValue()
    await dialog.getByTestId('survey-import').click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(draftName).toHaveValue('Keep this draft')
    await expect(draftCsv).toHaveValue(enteredDraft)
    await expect(dialog.getByRole('heading', { name: 'Building walk-through' })).toBeVisible()
    await expect(dialog.locator('[data-testid="survey-row"][data-id="original-reading"]')).toHaveAttribute('data-valid', 'true')
  }
  await closeSurvey(dialog)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const undone = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  expect(JSON.parse(await readFile((await (await undone).path())!, 'utf8')).survey).toBeUndefined()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  const redone = page.waitForEvent('download')
  await page.getByTestId('project-export').click()
  expect(JSON.parse(await readFile((await (await redone).path())!, 'utf8')).survey.name).toBe('Building walk-through')
})

test('CSV template leaves RSSI blank and raw observation export keeps the measured value', async ({ page }) => {
  await ready(page)
  await importProject(page, await radioProject())
  await page.getByTestId('mode-radio').click()
  const dialog = await openSurvey(page)
  const templateDownload = page.waitForEvent('download')
  await dialog.getByTestId('survey-template').click()
  const template = (await readFile((await (await templateDownload).path())!, 'utf8')).trim().split(/\r?\n/)
  expect(template[0]!.replaceAll('"', '').split(',')).toEqual(headers)
  expect(template[1]!.replaceAll('"', '').split(',')[5]).toBe('')
  expect(template[1]).not.toContain('model')

  await importMeasurements(page, dialog, surveyCsv([csvRow('raw-reading', 'Measured minus sign', 12, 2.5, 1.5, -53)]))
  const rawDownload = page.waitForEvent('download')
  await dialog.getByTestId('survey-export').click()
  const raw = await readFile((await (await rawDownload).path())!, 'utf8')
  expect(raw).toContain('"raw-reading"')
  expect(raw).toContain('"-53"')
  expect(raw).not.toContain("'-53")
})

for (const width of [1280, 320]) {
  test(`measurement survey dialog is accessible and fits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await ready(page)
    await importProject(page, await radioProject())
    await page.getByTestId('mode-radio').click()
    const dialog = await openSurvey(page)
    const scan = await new AxeBuilder({ page }).include('[data-testid="survey-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(scan.violations).toEqual([])
    await importMeasurements(page, dialog)
    const dimensions = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)
    const populatedScan = await new AxeBuilder({ page }).include('[data-testid="survey-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(populatedScan.violations).toEqual([])
    if (testInfo.project.name === 'chromium') {
      await mkdir('reports/screenshots', { recursive: true })
      await page.screenshot({ path: `reports/screenshots/measurement-survey-${width === 1280 ? 'desktop' : 'phone'}.png` })
    }
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('survey-open')).toBeFocused()
  })
}
