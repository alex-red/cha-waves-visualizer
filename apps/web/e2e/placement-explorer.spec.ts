import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

type ExportedProject = {
  scene: {
    revision: number
    emitters: Array<{ id: string; domain: string; active: boolean; position: [number, number, number] }>
    [key: string]: any
  }
  settings: { mode: 'acoustics' | 'radio'; [key: string]: any }
}

async function ready(page: Page) {
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 20_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await expect(page.getByTestId('worker-error')).toBeHidden()
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

async function openPlacement(page: Page) {
  await page.getByTestId('placement-open').click()
  const dialog = page.getByTestId('placement-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleName('Source placement explorer')
  return dialog
}

test('search ranks finite probe estimates and applying one candidate is one undoable scene edit', async ({ page, browserName }) => {
  await page.goto('/')
  await ready(page)
  const original = await exportProject(page)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  const dialog = await openPlacement(page)
  const probeOptions = dialog.locator('.placement-probes')
  const firstProbe = dialog.getByTestId('placement-probe').first()
  const probeCheckbox = firstProbe.locator('input[type="checkbox"]')
  const probeName = firstProbe.locator('.probe-copy strong')
  const optionsBounds = await probeOptions.boundingBox()
  const labelBounds = await firstProbe.boundingBox()
  const checkboxBounds = await probeCheckbox.boundingBox()
  const nameBounds = await probeName.boundingBox()
  expect(optionsBounds).not.toBeNull()
  expect(labelBounds).not.toBeNull()
  expect(checkboxBounds).not.toBeNull()
  expect(nameBounds).not.toBeNull()
  for (const itemBounds of [labelBounds!, checkboxBounds!, nameBounds!]) {
    expect(itemBounds.x).toBeGreaterThanOrEqual(optionsBounds!.x - 1)
    expect(itemBounds.y).toBeGreaterThanOrEqual(optionsBounds!.y - 1)
    expect(itemBounds.x + itemBounds.width).toBeLessThanOrEqual(optionsBounds!.x + optionsBounds!.width + 1)
    expect(itemBounds.y + itemBounds.height).toBeLessThanOrEqual(optionsBounds!.y + optionsBounds!.height + 1)
  }
  expect(await probeName.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(dialog.getByTestId('placement-objective')).toHaveValue('minimize-loudest')
  const budget = dialog.getByTestId('placement-budget')
  await expect(budget.locator('option')).toHaveCount(3)
  const budgetValues = await budget.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))
  expect(budgetValues).toEqual(['64', '144', '256'])

  const originalScene = structuredClone(original.scene)
  await dialog.getByTestId('placement-run').click()
  await expect(dialog.getByTestId('placement-candidate').first()).toBeVisible({ timeout: 60_000 })
  const candidates = dialog.getByTestId('placement-candidate')
  const count = await candidates.count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(5)

  const scores: number[] = []
  let applyIndex = -1
  let selectedPosition: [number, number, number] | undefined
  for (let index = 0; index < count; index++) {
    const candidate = candidates.nth(index)
    const x = Number(await candidate.getAttribute('data-x'))
    const y = Number(await candidate.getAttribute('data-y'))
    const z = Number(await candidate.getAttribute('data-z'))
    const score = Number(await candidate.getAttribute('data-score'))
    expect([x, y, z, score].every(Number.isFinite)).toBe(true)
    scores.push(score)
    if (!selectedPosition && await candidate.getByTestId('placement-apply').isEnabled()) {
      selectedPosition = [x, y, z]
      applyIndex = index
    }

    const readings = candidate.locator('.tradeoff-row')
    expect(await readings.count()).toBeGreaterThan(0)
    for (let readingIndex = 0; readingIndex < await readings.count(); readingIndex++) {
      const valueText = await readings.nth(readingIndex).locator('span').last().innerText()
      expect(valueText).toMatch(/^-?\d+(?:\.\d+)? dB(?:m)?$/)
      expect(Number.isFinite(Number.parseFloat(valueText))).toBe(true)
    }
  }
  expect(scores).toEqual([...scores].sort((a, b) => a - b))
  expect(selectedPosition).toBeDefined()
  expect(applyIndex).toBeGreaterThanOrEqual(0)
  if (browserName === 'chromium') {
    await mkdir('reports/screenshots', { recursive: true })
    await page.screenshot({ path: 'reports/screenshots/placement-explorer-desktop.png' })
    await candidates.first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'reports/screenshots/placement-explorer-desktop-results.png' })
  }
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  await dialog.getByRole('button', { name: 'Close placement explorer', exact: true }).click()
  await expect(dialog).toBeHidden()
  const afterSearch = await exportProject(page)
  expect(afterSearch.scene).toEqual(originalScene)
  expect(afterSearch.settings).toEqual(original.settings)
  expect(afterSearch).not.toHaveProperty('placement')

  const reopened = await openPlacement(page)
  await expect(reopened.getByTestId('placement-candidate').first()).toBeVisible()
  await reopened.getByTestId('placement-candidate').nth(applyIndex).getByTestId('placement-apply').click()
  await ready(page)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  const applied = await exportProject(page)
  const expectedScene = structuredClone(originalScene)
  const expectedSource = expectedScene.emitters.find(emitter => emitter.active && emitter.domain === original.settings.mode)!
  expectedSource.position = selectedPosition!
  expectedScene.revision = originalScene.revision + 1
  expect(applied.scene).toEqual(expectedScene)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  expect((await exportProject(page)).scene).toEqual(originalScene)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await ready(page)
  expect((await exportProject(page)).scene).toEqual(expectedScene)
})

test('RF mode uses its own objective and coverage threshold counts valid sampled cells', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('mode-radio').click()
  await ready(page)

  const dialog = await openPlacement(page)
  await expect(dialog.getByTestId('placement-objective')).toHaveValue('maximize-weakest')
  const summary = dialog.getByTestId('coverage-summary')
  const threshold = dialog.getByTestId('coverage-threshold')
  await expect(summary).toBeVisible()
  await expect.poll(async () => Number(await summary.getAttribute('data-valid'))).toBeGreaterThan(0)

  await threshold.fill('100')
  await expect.poll(async () => Number(await summary.getAttribute('data-above'))).toBe(0)
  const validCells = Number(await summary.getAttribute('data-valid'))
  await threshold.fill('-300')
  await expect.poll(async () => Number(await summary.getAttribute('data-above'))).toBe(validCells)

  // The search controls describe a query; changing them does not create a scene edit or enter a project export.
  await dialog.getByTestId('placement-objective').selectOption('minimize-loudest')
  await dialog.getByTestId('placement-budget').selectOption('64')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close placement explorer', exact: true }).click()
  await expect(dialog).toBeHidden()
  const exported = await exportProject(page)
  expect(exported.settings.mode).toBe('radio')
  expect(exported).not.toHaveProperty('placement')
  expect(exported).not.toHaveProperty('coverageThreshold')
})

test('cancelling ignores a late worker result and changed probe selection clears results until rerun', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let delayedPlacementResult = false
    ;(window as any).__placementHeld = false
    ;(window as any).__releasePlacementResult = undefined
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (delayedPlacementResult || !String(url).includes('placement.worker')) return
        delayedPlacementResult = true
        let handler: ((event: MessageEvent) => void) | null = null
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => handler,
          set: value => { handler = value as typeof handler },
        })
        this.addEventListener('message', event => {
          const message = event as MessageEvent
          if (message.data?.type === 'result') {
            ;(window as any).__placementHeld = true
            ;(window as any).__releasePlacementResult = () => handler?.(message)
          } else handler?.(message)
        })
      }
    } as typeof Worker
  })
  await page.goto('/')
  await ready(page)
  const dialog = await openPlacement(page)
  await dialog.getByTestId('placement-budget').selectOption('64')
  await dialog.getByTestId('placement-run').click()
  await expect.poll(() => page.evaluate(() => (window as any).__placementHeld), { timeout: 60_000 }).toBe(true)
  await expect(dialog.getByTestId('placement-progress')).toBeVisible()

  await dialog.getByTestId('placement-cancel').click()
  await expect(dialog.getByTestId('placement-progress')).toHaveCount(0)
  await expect(dialog.getByRole('status')).toContainText('cancelled')
  await page.evaluate(() => (window as any).__releasePlacementResult())
  await expect(dialog.getByTestId('placement-candidate')).toHaveCount(0)
  await dialog.getByTestId('placement-run').click()
  await expect(dialog.getByTestId('placement-candidate').first()).toBeVisible({ timeout: 60_000 })

  const probes = dialog.getByTestId('placement-probe').locator('input[type="checkbox"]')
  await expect(probes).toHaveCount(1)
  await probes.uncheck()
  await expect(dialog.getByTestId('placement-candidate')).toHaveCount(0)
  await expect(dialog.getByTestId('placement-run')).toBeDisabled()
  await probes.check()
  await expect(dialog.getByTestId('placement-run')).toBeEnabled()
  await dialog.getByTestId('placement-run').click()
  await expect(dialog.getByTestId('placement-candidate').first()).toBeVisible({ timeout: 60_000 })
})

test('search stays guarded when probes are empty or the active source is missing', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const original = await exportProject(page)
  const emptyWorkspace = structuredClone(original)
  emptyWorkspace.scene.probes = []
  emptyWorkspace.scene.emitters = emptyWorkspace.scene.emitters.map(emitter => ({ ...emitter, active: false }))
  await page.getByTestId('project-import').setInputFiles({
    name: 'placement-no-probes-or-source.cha-waves.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(emptyWorkspace)),
  })
  await expect(page.getByTestId('project-error')).toContainText('Imported project')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', '0')
  let dialog = await openPlacement(page)
  await expect(dialog.getByTestId('placement-run')).toBeDisabled()
  await expect(dialog.getByText(/Activate a sound source in this mode to search/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Close placement explorer', exact: true }).click()

  const noProbes = structuredClone(original)
  noProbes.scene.probes = []
  await page.getByTestId('project-import').setInputFiles({
    name: 'placement-no-probes.cha-waves.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(noProbes)),
  })
  await expect(page.getByTestId('project-error')).toContainText('Imported project')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', '0')
  dialog = await openPlacement(page)
  await expect(dialog.getByTestId('placement-probe')).toHaveCount(0)
  await expect(dialog.getByTestId('placement-run')).toBeDisabled()
  await expect(dialog.getByText(/Add probes on this level to compare their readings/i)).toBeVisible()
})

test('placement explorer fits a phone viewport and passes dialog accessibility checks with results', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await ready(page)
  const dialog = await openPlacement(page)
  const bounds = await dialog.boundingBox()
  expect(bounds).toBeTruthy()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321)

  const scan = await new AxeBuilder({ page }).include('[data-testid="placement-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(scan.violations.map(({ id }) => id)).toEqual([])

  await dialog.getByTestId('placement-run').click()
  await expect(dialog.getByTestId('placement-candidate').first()).toBeVisible({ timeout: 60_000 })
  const populated = await new AxeBuilder({ page }).include('[data-testid="placement-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(populated.violations.map(({ id }) => id)).toEqual([])
  await dialog.getByTestId('placement-candidate').first().scrollIntoViewIfNeeded()
  const metricText = dialog.getByTestId('placement-candidate').first().locator('.candidate-metric span')
  expect(await metricText.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  if (browserName === 'chromium') {
    await mkdir('reports/screenshots', { recursive: true })
    await page.screenshot({ path: 'reports/screenshots/placement-explorer-phone.png' })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('placement-open')).toBeFocused()
})
