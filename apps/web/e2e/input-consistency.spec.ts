import { expect, test, type Page } from '@playwright/test'
import { createDemoScene, defaultSettings } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

async function importScene(page: Page, scene: ReturnType<typeof createDemoScene>, mode: 'acoustics' | 'radio') {
  await page.getByTestId('project-import').setInputFiles({
    name: 'input-consistency.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(createProject(scene, defaultSettings(mode)))),
  })
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', String(scene.probes.length))
  await expect(page.getByTestId('project-export')).toBeEnabled()
}

test('importing a project with no probes clears the previous inspector reading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  const emptyScene = createDemoScene()
  emptyScene.probes = []
  await importScene(page, emptyScene, 'acoustics')

  await expect(page.getByTestId('no-probes')).toBeVisible()
  await expect(page.getByTestId('probe-value')).toContainText('—')
  await expect(page.getByTestId('probe-x')).toBeDisabled()
  await expect(page.getByTestId('probe-x')).toHaveValue('')
  await expect(page.getByTestId('probe-y')).toHaveValue('')
  await expect(page.getByTestId('probe-z')).toBeDisabled()
  await expect(page.locator('.measurements')).toHaveCount(0)
  await expect(page.getByTestId('no-probes')).toContainText('Edit home')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await page.reload()
  await expect(page.getByTestId('no-probes')).toBeVisible()
  await expect(page.getByTestId('probe-value')).toContainText('—')
  await page.getByTestId('mode-radio').click()
  await expect(page.getByTestId('no-probes')).toBeVisible()
  await expect(page.getByTestId('probe-value')).toContainText('—')
})

for (const mode of ['acoustics', 'radio'] as const) {
  for (const inactiveFirst of [true, false]) test(`inspector edits the active ${mode} emitter with inactive source ${inactiveFirst ? 'first' : 'last'}`, async ({ page }) => {
    await page.goto('/')
    const scene = createDemoScene()
    const domain = mode === 'acoustics' ? 'acoustics' : 'radio'
    const active = scene.emitters.find(emitter => emitter.domain === domain)!
    const inactive = { ...active, id: `${active.id}-inactive`, active: false, position: [12, 8, 1] as [number, number, number] }
    scene.emitters = inactiveFirst ? [inactive, ...scene.emitters] : [...scene.emitters, inactive]
    await importScene(page, scene, mode)

    await expect(page.getByTestId('source-x')).toHaveValue(active.position[0].toFixed(1))
    await expect(page.getByTestId('source-y')).toHaveValue(active.position[1].toFixed(1))
    await expect(page.locator('.object-list')).toContainText('inactive')
    await expect(page.locator('.measurements')).toContainText('Distance from')
    await expect(page.locator('.measurements strong').first()).not.toHaveText('—')
    await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced')
    const initial = await page.getByTestId('probe-value').innerText()
    await page.getByTestId('source-x').fill('4')
    // A background plan redraw must not replace an uncommitted input draft.
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(page.getByTestId('source-x')).toHaveValue('4')
    await page.getByTestId('source-x').press('Tab')
    await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced')
    await expect(page.getByTestId('probe-value')).not.toHaveText(initial)
    await expect(page.getByTestId('source-x')).toHaveValue('4.0')
  })

  test(`no active ${mode} emitter leaves source coordinates blank and disabled`, async ({ page }) => {
    await page.goto('/')
    const scene = createDemoScene()
    const domain = mode === 'acoustics' ? 'acoustics' : 'radio'
    scene.emitters = scene.emitters.map(emitter => emitter.domain === domain ? { ...emitter, active: false } : emitter)
    await importScene(page, scene, mode)

    await expect(page.getByTestId('source-x')).toBeDisabled()
    await expect(page.getByTestId('source-x')).toHaveValue('')
    await expect(page.getByTestId('source-y')).toHaveValue('')
    await expect(page.getByTestId('source-z')).toBeDisabled()
    await expect(page.getByTestId('source-z')).toHaveValue('')
    await expect(page.getByTestId('probe-value')).toContainText('—')
    await expect(page.getByTestId('no-active-source')).toBeVisible()
    await expect(page.locator('.measurements')).toHaveCount(0)
    await page.getByTestId(mode === 'acoustics' ? 'mode-radio' : 'mode-acoustics').click()
    await expect(page.getByTestId('source-x')).toBeEnabled()
    await expect(page.getByTestId('probe-value')).not.toContainText('—')
    await page.getByTestId(mode === 'acoustics' ? 'mode-acoustics' : 'mode-radio').click()
    await expect(page.getByTestId('no-active-source')).toBeVisible()
    await expect(page.getByTestId('probe-value')).toContainText('—')
  })
}
