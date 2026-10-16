import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function exportScene(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as {
    scene: { walls: Array<{ id: string }>; openings: Array<{ id: string; fromT: number; toT: number }>; probes: Array<{ id: string }> }
  }
}

test('geometry editor validates drafts and persists accepted edits through undo and reload', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('edit-home').click()
  const dialog = page.getByTestId('scene-editor-dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByText('Enter wall coordinates').click()
  await dialog.getByLabel('x₁').fill('7')
  await dialog.getByLabel('y₁').fill('1')
  await dialog.getByLabel('x₂').fill('7')
  await dialog.getByLabel('y₂').fill('4')
  await dialog.getByRole('button', { name: 'Add wall from coordinates' }).click()
  await expect(dialog.getByText('wall-1', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Add door' }).click()
  await expect(dialog.getByRole('button', { name: /door-1/ })).toBeVisible()

  // This segment crosses the newly created wall; the editor surfaces the
  // command rejection without changing the canonical scene.
  await dialog.getByLabel('x₁').fill('6')
  await dialog.getByLabel('y₁').fill('2')
  await dialog.getByLabel('x₂').fill('8')
  await dialog.getByLabel('y₂').fill('3')
  await dialog.getByRole('button', { name: 'Add wall from coordinates' }).click()
  await expect(dialog.getByRole('alert')).toContainText(/crosses or overlaps/i)

  const probeFields = dialog.locator('.probe-coordinates input')
  await probeFields.nth(0).fill('10')
  await probeFields.nth(1).fill('3')
  await probeFields.nth(2).fill('1.2')
  await dialog.getByRole('button', { name: 'Add probe here' }).click()
  await expect(dialog.getByRole('button', { name: /Measurement point/ })).toBeVisible()

  await dialog.getByRole('button', { name: 'Close editor' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
  const afterEdits = await exportScene(page)
  expect(afterEdits.scene.walls.some(wall => wall.id === 'wall-1')).toBe(true)
  expect(afterEdits.scene.openings.some(opening => opening.id === 'door-1')).toBe(true)
  expect(afterEdits.scene.probes.some(probe => probe.id === 'probe-1')).toBe(true)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
  const afterUndo = await exportScene(page)
  expect(afterUndo.scene.walls.some(wall => wall.id === 'wall-1')).toBe(true)
  expect(afterUndo.scene.openings.some(opening => opening.id === 'door-1')).toBe(true)
  expect(afterUndo.scene.probes.some(probe => probe.id === 'probe-1')).toBe(false)

  await page.reload()
  await ready(page)
  const reloaded = await exportScene(page)
  expect(reloaded.scene.walls.some(wall => wall.id === 'wall-1')).toBe(true)
  expect(reloaded.scene.openings.some(opening => opening.id === 'door-1')).toBe(true)
  expect(reloaded.scene.probes.some(probe => probe.id === 'probe-1')).toBe(false)
})
