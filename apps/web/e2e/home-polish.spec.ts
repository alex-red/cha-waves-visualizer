import { expect, test } from '@playwright/test'
import { createHomeScene } from '../../../packages/home'
import { createProject, serializeProject } from '../../../packages/project'
import { defaultSettings } from '../../../packages/engine'

test('blank and outside-floor coordinates preserve the last valid scene and reset the input', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  const reading = await page.getByTestId('probe-value').innerText()
  for (const id of ['probe-x', 'source-y']) {
    const input = page.getByTestId(id)
    const before = await input.inputValue()
    await input.fill('')
    await page.setViewportSize({ width: id === 'probe-x' ? 1100 : 1120, height: 800 })
    await expect(input).toHaveValue('')
    await input.press('Tab')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(input).toHaveValue(before)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await expect(page.getByTestId('probe-value')).toHaveText(reading)
  }
  await page.getByTestId('probe-x').fill('100')
  await page.getByTestId('probe-x').press('Tab')
  await expect(page.getByTestId('probe-x')).toHaveValue('12.0')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('an L-shaped home does not acquire a phantom bounding-box wall', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  const scene = createHomeScene({ name: 'Courtyard home', widthM: 8, depthM: 6, ceilingHeightM: 2.7, boundary: [[0,0],[8,0],[8,3],[4,3],[4,6],[0,6]] })
  const text = serializeProject(createProject(scene, defaultSettings('acoustics')))
  await page.getByTestId('project-import').setInputFiles({ name: 'courtyard.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await expect(page.locator('.project-title strong')).toHaveText('courtyard-home')
  await expect(page.getByTestId('project-export')).toBeEnabled()
  const pixel = await page.getByTestId('field-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const scale = document.querySelector('[data-testid="plan-scale"] i')!.getBoundingClientRect().width / 2
    // At world (6,6), above the courtyard: the old bounding rectangle drew a dark wall here.
    const x = (rect.width / 2 + 2 * scale) * canvas.width / rect.width
    const y = (rect.height / 2 - 3 * scale) * canvas.height / rect.height
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round(x), Math.round(y), 1, 1).data)
  })
  expect(pixel[0]).toBeGreaterThan(180)
  expect(pixel[1]).toBeGreaterThan(180)
  expect(pixel[2]).toBeGreaterThan(170)
})

test('created doors have distinct labels in the scene controls', async ({ page }) => {
  const scene = createHomeScene({ name: 'Door study', widthM: 8, depthM: 6, ceilingHeightM: 2.7,
    interiorWalls: [{ id: 'partition-a', start: [3,1], end: [3,5] }, { id: 'partition-b', start: [5,1], end: [5,5] }] })
  scene.openings = ['partition-a', 'partition-b'].map((wallId, index) => ({ id: `door-${index + 1}`, wallId, fromT: .3, toT: .55, sillAboveBaseM: 0, heightM: 2.1, kind: 'door', isOpen: false, fixed: false, materialId: 'home-door' }))
  const text = serializeProject(createProject(scene, defaultSettings('acoustics')))
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await page.getByTestId('project-import').setInputFiles({ name: 'doors.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.getByTestId('door-select').locator('option')).toHaveText(['Door 1', 'Door 2'])
  await page.getByTestId('door-select').selectOption('door-2')
  await expect(page.getByTestId('door-toggle')).toContainText('Door 2')
})
