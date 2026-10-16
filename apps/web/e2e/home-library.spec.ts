import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

type ExportedProject = {
  metadata: { id: string; name: string }
  scene: { id: string; levels: Array<{ boundary: [number, number][] }> }
}

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function saved(page: Page) {
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
}

async function exportProject(page: Page): Promise<ExportedProject> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as ExportedProject
}

test('homes stay separate and a renamed home survives reload, export, and reopening another home', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await saved(page)

  const original = await exportProject(page)
  expect(original.metadata.name).toBe('Morning light, 02')

  await page.getByTestId('new-home').click()
  const builder = page.getByTestId('home-builder-dialog')
  await expect(builder).toBeVisible()
  await page.getByTestId('home-name').fill('Pine House')
  await page.getByTestId('home-width').fill('9.2')
  await page.getByTestId('home-depth').fill('7.1')
  await page.getByTestId('home-create').click()
  await expect(builder).not.toBeVisible()
  await ready(page)
  await saved(page)

  await page.getByTestId('saved-homes').click()
  const library = page.getByRole('dialog', { name: 'Your homes' })
  await expect(library).toBeVisible()
  await expect(library.getByRole('button', { name: /Morning light, 02/ })).toBeVisible()
  await expect(library.getByRole('button', { name: /Pine House/ })).toBeVisible()

  await library.getByRole('textbox', { name: 'Project name' }).fill('Pine House renamed')
  await saved(page)
  await library.getByRole('button', { name: 'Close' }).click()

  await page.reload()
  await ready(page)
  await saved(page)
  await expect(page.locator('.project-title strong')).toHaveText('Pine House renamed')

  const renamed = await exportProject(page)
  expect(renamed.metadata.name).toBe('Pine House renamed')
  expect(renamed.metadata.id).not.toBe(original.metadata.id)
  expect(renamed.scene.id).not.toBe(original.scene.id)
  expect(renamed.scene.levels[0]?.boundary).toEqual([[0, 0], [9.2, 0], [9.2, 7.1], [0, 7.1]])

  await page.getByTestId('saved-homes').click()
  const reloadedLibrary = page.getByRole('dialog', { name: 'Your homes' })
  await expect(reloadedLibrary.getByRole('button', { name: /Pine House renamed/ })).toBeVisible()
  await reloadedLibrary.getByRole('button', { name: /Morning light, 02/ }).click()
  await ready(page)
  await saved(page)
  await expect(page.locator('.project-title strong')).toHaveText('Morning light, 02')

  const reopened = await exportProject(page)
  expect(reopened.metadata.id).toBe(original.metadata.id)
  expect(reopened.scene.id).toBe(original.scene.id)
  expect(reopened.scene.levels[0]?.boundary).toEqual(original.scene.levels[0]?.boundary)
})
