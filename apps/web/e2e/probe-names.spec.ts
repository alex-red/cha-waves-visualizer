import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function exportedProbeName(page: Page, id: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  const project = JSON.parse(await readFile(path!, 'utf8')) as {
    scene: { probes: Array<{ id: string; name?: string }> }
  }
  return project.scene.probes.find(probe => probe.id === id)?.name
}

test('probe names validate inline and persist through undo, reload, and export', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('edit-home').click()
  const dialog = page.getByTestId('scene-editor-dialog')
  const probe = dialog.getByRole('button', { name: /Across the hall/ })
  await probe.click()

  const name = dialog.locator('.probe-name-field input')
  await name.fill('   ')
  await dialog.getByRole('button', { name: 'Apply name' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Enter a name from 1 to 80 characters.')
  await expect(probe).toContainText('Across the hall')

  await name.fill('  Listening position  ')
  await dialog.getByRole('button', { name: 'Apply name' }).click()
  await expect(dialog.getByRole('button', { name: /Listening position/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close editor' }).click()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
  expect(await exportedProbeName(page, 'hallway-probe')).toBe('Listening position')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  expect(await exportedProbeName(page, 'hallway-probe')).toBe('Across the hall')

  await page.getByTestId('edit-home').click()
  const reopened = page.getByTestId('scene-editor-dialog')
  await reopened.getByRole('button', { name: /Across the hall/ }).click()
  await reopened.locator('.probe-name-field input').fill('Listening position')
  await reopened.getByRole('button', { name: 'Apply name' }).click()
  await reopened.getByRole('button', { name: 'Close editor' }).click()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })

  await page.reload()
  await ready(page)
  expect(await exportedProbeName(page, 'hallway-probe')).toBe('Listening position')
})
