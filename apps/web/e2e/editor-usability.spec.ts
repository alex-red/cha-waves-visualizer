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
    scene: { walls: Array<{ id: string; thicknessM: number; materialId: string }> }
  }
}

test('wall material defaults follow the active project and applied properties persist', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  await page.getByTestId('edit-home').click()
  const editor = page.getByTestId('scene-editor-dialog')
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('New wall material')).toHaveValue('partition')
  await editor.getByRole('button', { name: 'Close editor' }).click()

  await page.getByTestId('new-home').click()
  await page.getByTestId('home-name').fill('Material reset home')
  await page.getByTestId('home-create').click()
  await ready(page)

  await page.getByTestId('edit-home').click()
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('New wall material')).toHaveValue('home-interior')
  await editor.getByText('Enter wall coordinates').click()
  await editor.getByLabel('x₁').fill('3')
  await editor.getByLabel('y₁').fill('1')
  await editor.getByLabel('x₂').fill('3')
  await editor.getByLabel('y₂').fill('4')
  await editor.getByRole('button', { name: 'Add wall from coordinates' }).click()
  await expect(editor.getByText('wall-1', { exact: true })).toBeVisible()

  await editor.getByLabel('wall-1 thickness').fill('0.17')
  await editor.getByLabel('wall-1 material').selectOption('home-exterior')
  await editor.getByRole('button', { name: 'Apply wall properties' }).click()
  await expect(editor.getByLabel('wall-1 thickness')).toHaveValue('0.17')
  await editor.getByRole('button', { name: 'Close editor' }).click()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })

  const exported = await exportScene(page)
  expect(exported.scene.walls.find(wall => wall.id === 'wall-1')).toMatchObject({
    thicknessM: 0.17,
    materialId: 'home-exterior',
  })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  const undone = await exportScene(page)
  expect(undone.scene.walls.find(wall => wall.id === 'wall-1')).toMatchObject({ thicknessM: .12, materialId: 'home-interior' })
})
