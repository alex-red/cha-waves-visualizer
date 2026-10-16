import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function saved(page: Page) {
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
}

function experiments(page: Page) {
  return page.getByTestId('experiments-dialog')
}

async function openExperiments(page: Page) {
  await page.getByTestId('experiment-library-open').click()
  await expect(experiments(page)).toBeVisible()
  return experiments(page)
}

async function capture(page: Page, name: string, notes = '') {
  const dialog = experiments(page)
  await dialog.getByTestId('experiment-name').fill(name)
  await dialog.getByTestId('experiment-notes').fill(notes)
  await dialog.getByTestId('experiment-save').click()
  await expect(dialog.getByRole('combobox', { name: 'Saved experiment', exact: true })).toHaveValue(/.+/)
}

async function readExport(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as Record<string, any>
}

test('captured experiment tracks its source changes and load can be undone', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  await ready(page)
  const startingPosition = await page.getByTestId('source-x').inputValue()
  const initialFieldRevision = await page.getByTestId('field-canvas').getAttribute('data-field-revision')

  const dialog = await openExperiments(page)
  await capture(page, 'Hallway source', 'Starting position')
  await dialog.getByRole('button', { name: 'Close experiments', exact: true }).click()

  await page.getByTestId('source-x').fill('4')
  await page.getByTestId('source-x').press('Tab')
  await ready(page)
  await expect(page.getByTestId('field-canvas')).not.toHaveAttribute('data-field-revision', initialFieldRevision ?? '')
  const changedPosition = await page.getByTestId('source-x').inputValue()
  expect(changedPosition).not.toBe(startingPosition)

  const library = await openExperiments(page)
  await library.getByRole('combobox', { name: 'Saved experiment', exact: true }).selectOption({ label: 'Hallway source' })
  await expect(library.getByTestId('experiment-changes')).toContainText(/source|position/i)
  if (browserName === 'chromium') await page.screenshot({ path: 'reports/screenshots/experiments.png' })
  await library.getByTestId('experiment-open').click()
  await ready(page)
  await expect(experiments(page)).toBeHidden()
  await expect(page.getByTestId('source-x')).toHaveValue(startingPosition)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('source-x')).toHaveValue(changedPosition)
})

test('duplicate, rename, notes, and baseline survive export and reload', async ({ page, browser }) => {
  await page.goto('/')
  await ready(page)
  let dialog = await openExperiments(page)
  await capture(page, 'Reference mix', 'Original notes')
  await dialog.getByRole('combobox', { name: 'Saved experiment', exact: true }).selectOption({ label: 'Reference mix' })
  await dialog.getByTestId('experiment-duplicate').click()
  await expect(dialog.getByRole('combobox', { name: 'Saved experiment', exact: true })).toHaveValue(/.+/)
  await expect(dialog.getByTestId('experiment-edit-name')).toHaveValue('Reference mix copy')
  await dialog.getByTestId('experiment-edit-name').fill('Quiet room')
  await dialog.getByTestId('experiment-edit-notes').fill('Updated notes')
  await dialog.getByTestId('experiment-update').click()
  await dialog.getByRole('combobox', { name: 'Saved experiment', exact: true }).selectOption({ label: 'Quiet room' })
  await dialog.getByTestId('experiment-baseline').click()
  await expect(dialog.getByTestId('experiment-baseline')).toContainText(/baseline selected/i)
  await dialog.getByRole('button', { name: 'Close experiments', exact: true }).click()

  await saved(page)
  const exported = await readExport(page)
  expect(exported.experiments).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Reference mix', notes: 'Original notes' }),
    expect.objectContaining({ name: 'Quiet room', notes: 'Updated notes' }),
  ]))
  expect(exported.baselineExperimentId).toBeTruthy()

  await page.reload()
  await ready(page)
  await saved(page)
  dialog = await openExperiments(page)
  const names = await dialog.getByRole('combobox', { name: 'Saved experiment', exact: true }).locator('option').allTextContents()
  expect(names.join(' ')).toContain('Reference mix')
  expect(names.join(' ')).toContain('Quiet room')
  await dialog.getByRole('combobox', { name: 'Saved experiment', exact: true }).selectOption(exported.baselineExperimentId)
  await expect(dialog.getByTestId('experiment-edit-notes')).toHaveValue('Updated notes')
  await expect(dialog.getByTestId('experiment-baseline')).toContainText(/baseline selected/i)
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage()
    await fresh.goto('/')
    await ready(fresh)
    await fresh.getByTestId('project-import').setInputFiles({ name: 'experiments.cha-waves.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
    await expect(fresh.getByTestId('project-error')).toContainText('Imported project')
    await saved(fresh)
    const importedLibrary = await openExperiments(fresh)
    await importedLibrary.getByTestId('experiment-select').selectOption(exported.baselineExperimentId)
    await expect(importedLibrary.getByTestId('experiment-edit-notes')).toHaveValue('Updated notes')
    await expect(importedLibrary.getByTestId('experiment-baseline')).toContainText(/baseline selected/i)
  } finally { await context.close() }
})

test('case-insensitive duplicate names and malformed v2 snapshots are rejected without losing drafts or workspace', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const dialog = await openExperiments(page)
  await capture(page, 'Evening setup')
  await dialog.getByTestId('experiment-name').fill('EVENING SETUP')
  await dialog.getByTestId('experiment-notes').fill('Keep this draft')
  await dialog.getByTestId('experiment-save').click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByTestId('experiment-name')).toHaveValue('EVENING SETUP')
  await expect(dialog.getByTestId('experiment-notes')).toHaveValue('Keep this draft')
  await dialog.getByRole('button', { name: 'Close experiments', exact: true }).click()

  await saved(page)
  const originalSource = await page.getByTestId('source-x').inputValue()
  const originalProbe = await page.getByTestId('probe-value').innerText()
  const invalidV2 = await readExport(page)
  invalidV2.experiments[0].scene.walls[0].end = [...invalidV2.experiments[0].scene.walls[0].start]
  await page.getByTestId('project-import').setInputFiles({
    name: 'invalid-v2.cha-waves.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalidV2)),
  })
  await expect(page.getByTestId('project-error')).toBeVisible()
  await expect(page.getByTestId('source-x')).toHaveValue(originalSource)
  await expect(page.getByTestId('probe-value')).toHaveText(originalProbe)
})

test('v1 import migrates an empty experiment library while retaining its legacy baseline', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Save as baseline' }).click()
  await saved(page)
  const legacy = await readExport(page)
  delete legacy.experiments
  delete legacy.baselineExperimentId
  legacy.formatVersion = 1
  delete legacy.survey
  await page.getByTestId('project-import').setInputFiles({
    name: 'legacy-v1.cha-waves.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  })
  await expect(page.getByTestId('project-error')).toContainText('Imported project')
  await ready(page)
  const migrated = await readExport(page)
  expect(migrated.formatVersion).toBe(3)
  expect(migrated.experiments).toEqual([])
  expect(migrated.baseline).toBeTruthy()
  await expect(page.getByRole('button', { name: /Compare/ })).toBeEnabled()
})

test('experiments dialog fits mobile, passes accessibility checks, and restores keyboard focus', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await ready(page)
  const trigger = page.getByTestId('experiment-library-open')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = experiments(page)
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds).toBeTruthy()
  expect(bounds!.width).toBeLessThanOrEqual(320)
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map(({ id }) => id)).toEqual([])
  await expect(dialog.getByRole('button', { name: 'Close experiments', exact: true })).toBeFocused()
  await capture(page, 'Phone reference', 'Accessible saved state')
  const populated = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(populated.violations.map(({ id }) => id)).toEqual([])
  if (browserName === 'chromium') {
    await dialog.getByTestId('experiment-select').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'reports/screenshots/experiments-mobile.png' })
    await dialog.getByTestId('experiment-open').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'reports/screenshots/experiments-mobile-details.png' })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('experiment capture and export remain available without a calculation worker or UUID helper', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class { constructor() { throw new Error('Simulated unavailable worker') } } as unknown as typeof Worker
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true })
  })
  await page.goto('/')
  await expect(page.getByTestId('worker-error')).toBeVisible()
  await saved(page)
  const dialog = await openExperiments(page)
  await capture(page, 'Offline inputs', 'No field required')
  await dialog.getByRole('button', { name: 'Close experiments', exact: true }).click()
  const exported = await readExport(page)
  expect(exported.experiments).toHaveLength(1)
  expect(exported.experiments[0].name).toBe('Offline inputs')
  expect(exported.experiments[0]).not.toHaveProperty('field')
})
