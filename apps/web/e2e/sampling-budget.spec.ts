import { expect, test, type Page } from '@playwright/test'
import { createHomeScene } from '../../../packages/home'
import { defaultSettings } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

async function readyAtStep(page: Page, step: string) {
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-step', step)
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await expect(page.getByTestId('worker-error')).toBeHidden()
}

test('an accepted 80 metre home computes a coarser field and retains compatible comparisons', async ({ page }) => {
  await page.goto('/')
  await readyAtStep(page, '0.25')
  await page.getByTestId('new-home').click()
  await page.getByTestId('home-width').fill('80')
  await page.getByTestId('home-depth').fill('80')
  await page.getByTestId('home-create').click()
  await expect(page.getByTestId('home-builder-dialog')).toBeHidden()
  await readyAtStep(page, '0.5')
  await expect(page.getByTestId('accepted-step')).toContainText('0.5')
  await page.getByRole('button', { name: 'Save as baseline' }).click()
  await page.getByTestId('source-x').fill('8')
  await page.getByTestId('source-x').press('Tab')
  await readyAtStep(page, '0.5')
  await expect(page.getByTestId('comparison-split')).toBeEnabled()
  await page.getByTestId('comparison-split').click()
  await expect(page.getByTestId('comparison-panel')).toHaveAttribute('data-compatible', 'true')
  await expect(page.getByTestId('comparison-probe-delta')).not.toContainText('Unavailable')
})

test('imported large scenes regenerate working and baseline fields at the same supported step after reload', async ({ page }) => {
  const scene = createHomeScene({ name: 'Large traced extent', widthM: 200, depthM: 200, ceilingHeightM: 2.7 })
  const settings = defaultSettings('radio')
  const current = structuredClone(scene)
  current.emitters.find(emitter => emitter.domain === 'radio')!.position[0] += 3
  const document = createProject(current, settings, { scene, settings })
  await page.goto('/')
  await readyAtStep(page, '0.25')
  await page.getByTestId('project-import').setInputFiles({
    name: 'large-home.cha-waves.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(document)),
  })
  await readyAtStep(page, '1')
  await expect(page.getByTestId('comparison-split')).toBeEnabled()
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await page.reload()
  await readyAtStep(page, '1')
  await expect(page.getByTestId('comparison-split')).toBeEnabled()
  await page.getByTestId('comparison-split').click()
  await expect(page.getByTestId('comparison-panel')).toHaveAttribute('data-compatible', 'true')
})
