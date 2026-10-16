import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createDemoScene, defaultSettings, evaluatePoint } from '../../../packages/engine'
import { createProject, serializeProject } from '../../../packages/project'

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved')
  await expect(page.getByTestId('probe-value')).not.toContainText('—', { timeout: 15_000 })
}

async function importProject(page: Page, scene = createDemoScene(), mode: 'acoustics' | 'radio' = 'acoustics') {
  await page.getByTestId('project-import').setInputFiles({
    name: 'loss-breakdown.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(createProject(scene, defaultSettings(mode)))),
  })
}

async function openBreakdown(page: Page) {
  const toggle = page.getByTestId('loss-breakdown-toggle')
  await toggle.click()
  await expect(page.getByTestId('loss-breakdown')).toBeVisible()
  return page.getByTestId('loss-breakdown')
}

function numericValue(text: string | null): number {
  const value = Number.parseFloat(text ?? '')
  expect(Number.isFinite(value), `Expected numeric value, received ${text}`).toBe(true)
  return value
}

test('acoustic budget total matches the exact probe reading and a closed door contributes its material loss', async ({ page }) => {
  await ready(page)
  const panel = await openBreakdown(page)
  const total = panel.getByTestId('loss-budget-total')
  const probe = page.getByTestId('probe-value')
  await expect(total).toHaveAttribute('data-value')
  const contributions = await panel.locator('[data-contribution-db]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-contribution-db'))))
  expect(Math.abs(contributions.reduce((sum, value) => sum + value, 0) - numericValue(await total.getAttribute('data-value')))).toBeLessThanOrEqual(1e-9)
  expect(numericValue(await total.getAttribute('data-value'))).toBeCloseTo(numericValue(await probe.innerText()), 1)

  const hallDoor = panel.locator('[data-testid="loss-term"][data-opening-id="hall-door"]')
  await expect(hallDoor).toHaveAttribute('data-contribution-db', '-6')
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('door-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(hallDoor).toHaveAttribute('data-contribution-db', '0')
})

test('selecting a loss term highlights its wall and opening without creating undo history', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await ready(page)
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toBeDisabled()
  const panel = await openBreakdown(page)
  const doorTerm = panel.locator('[data-testid="loss-term"][data-opening-id="hall-door"]')
  await doorTerm.click()
  await expect(doorTerm).toHaveAttribute('aria-pressed', 'true')
  const canvas = page.getByTestId('field-canvas')
  await expect(canvas).toHaveAttribute('data-highlight-wall-id', 'hall-partition')
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', 'hall-door')
  const fixture = createDemoScene()
  const hit = evaluatePoint(fixture, defaultSettings('acoustics'), fixture.probes[0]!.position).crossings[0]!.hit
  await expect(canvas).toHaveAttribute('data-highlight-hit', hit.join(','))
  await expect(undo).toBeDisabled()
  if (test.info().project.name === 'chromium') await page.screenshot({ path: 'reports/screenshots/loss-breakdown.png' })

  await page.getByTestId('loss-highlight-clear').click()
  await expect(canvas).toHaveAttribute('data-highlight-wall-id', '')
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', '')
  await doorTerm.click()
  await page.getByTestId('loss-breakdown-toggle').click()
  await expect(canvas).toHaveAttribute('data-highlight-wall-id', '')
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', '')
})

test('scene input and domain changes clear a stale loss highlight', async ({ page }) => {
  await ready(page)
  const panel = await openBreakdown(page)
  await panel.locator('[data-testid="loss-term"][data-opening-id="hall-door"]').click()
  const canvas = page.getByTestId('field-canvas')
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', 'hall-door')
  await page.getByTestId('door-toggle').click()
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', '')

  await panel.locator('[data-testid="loss-term"][data-opening-id="hall-door"]').click()
  await page.getByTestId('mode-radio').click()
  await expect(canvas).toHaveAttribute('data-highlight-wall-id', '')
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', '')
})

test('radio budget exposes propagation components and its total matches the probe reading', async ({ page }) => {
  await ready(page)
  await page.getByTestId('mode-radio').click()
  await expect(page.getByTestId('probe-value')).not.toContainText('—', { timeout: 15_000 })
  const panel = await openBreakdown(page)
  const total = panel.getByTestId('loss-budget-total')
  expect(numericValue(await total.getAttribute('data-value'))).toBeCloseTo(numericValue(await page.getByTestId('probe-value').innerText()), 1)
  await expect(panel).toContainText(/EIRP/i)
  await expect(panel).toContainText(/gain/i)
  await expect(panel).toContainText(/FSPL|free.space path loss/i)
  await expect(panel).toContainText(/Other modeled loss/i)
})

test('loss breakdown opens by keyboard, fits on a 320px viewport, and passes an accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await ready(page)
  const toggle = page.getByTestId('loss-breakdown-toggle')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByTestId('loss-breakdown')
  await expect(panel).toBeVisible()
  const crossing = panel.getByTestId('loss-term').first()
  await crossing.focus()
  await page.keyboard.press('Enter')
  await expect(crossing).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-highlight-opening-id', 'hall-door')
  const dimensions = await panel.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
  const scan = await new AxeBuilder({ page }).include('[data-testid="loss-breakdown"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
  if (test.info().project.name === 'chromium') await panel.screenshot({ path: 'reports/screenshots/loss-breakdown-mobile.png' })
})

test('probe selection and project replacement discard a highlight without editing either project', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await ready(page)
  const scene = createDemoScene()
  scene.probes.push({ id: 'second-probe', name: 'Near source', levelId: 'main', position: [3, 8, 1.5] })
  await importProject(page, scene)
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', '2')
  const panel = await openBreakdown(page)
  await panel.getByTestId('loss-term').first().click()
  const canvas = page.getByTestId('field-canvas')
  await expect(canvas).toHaveAttribute('data-highlight-opening-id', 'hall-door')
  await page.getByTestId('mobile-object-select').selectOption('second-probe')
  await expect(canvas).toHaveAttribute('data-highlight-wall-id', '')
  await expect(panel.getByTestId('loss-term')).toHaveCount(0)

  await page.getByTestId('mobile-object-select').selectOption('hallway-probe')
  await panel.getByTestId('loss-term').first().click()
  await importProject(page)
  await expect(canvas).toHaveAttribute('data-probe-count', '1')
  await expect(canvas).toHaveAttribute('data-highlight-wall-id', '')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('an imported scene with no probes reports the loss budget as unavailable', async ({ page }) => {
  await ready(page)
  const scene = createDemoScene()
  scene.probes = []
  await importProject(page, scene)
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-probe-count', '0')
  const panel = await openBreakdown(page)
  await expect(panel.getByTestId('loss-budget-unavailable')).toBeVisible()
  await expect(panel.getByTestId('loss-budget-total')).toHaveCount(0)
})
