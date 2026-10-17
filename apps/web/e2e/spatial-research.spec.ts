import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

const bundlePath = 'packages/test-fixtures/spatial/bundle.json'
const scanPath = 'packages/test-fixtures/spatial/echo-synthetic.json'

async function openResearch(page: Page) {
  await page.getByTestId('research-open').click()
  const dialog = page.getByTestId('research-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleName('Research Lab')
  return dialog
}

async function exportProject(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as { scene: unknown; settings: unknown }
}

async function importSpatialExample(dialog: ReturnType<Page['getByTestId']>, bundleBytes: Buffer, scanBytes: Buffer) {
  await dialog.getByTestId('research-bundle-import').setInputFiles({ name: 'bundle.json', mimeType: 'application/json', buffer: bundleBytes })
  await dialog.getByTestId('research-sources-import').setInputFiles({ name: 'echo-synthetic.json', mimeType: 'application/json', buffer: scanBytes })
  await dialog.getByTestId('research-import-run').click()
}

test('plane reference stays synthetic, exposes observation evidence, and leaves the project unchanged', async ({ page }) => {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices
    if (!media) return
    Object.assign(window, { __researchMicRequests: 0 })
    Object.defineProperty(media, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const state = window as Window & { __researchMicRequests: number }
        state.__researchMicRequests += 1
        throw new Error('Research Lab must not request a microphone')
      },
    })
  })
  await page.goto('/')
  const before = await exportProject(page)
  const dialog = await openResearch(page)
  await dialog.getByRole('button', { name: '3D plane reference', exact: true }).click()
  await dialog.getByTestId('research-case').selectOption('tilted-wall')
  await dialog.getByTestId('research-run-plane').click()
  await expect(dialog.getByTestId('research-plane-status')).toBeVisible()
  await dialog.getByRole('button', { name: 'Inspect fitted plane', exact: true }).click()
  await expect(dialog.getByTestId('research-evidence')).toContainText('tilted-wall')
  await expect(dialog.getByTestId('research-observation-list')).toContainText('tilted-wall-training-01')
  await expect(dialog.getByTestId('research-observation-list')).toContainText('tilted-wall-training-missing')
  await expect(dialog.getByTestId('research-observation-list')).toContainText('tilted-wall-training-ambiguous')

  await dialog.getByTestId('research-case').selectOption('floor')
  await dialog.getByTestId('research-run-plane').click()
  await dialog.getByRole('button', { name: 'Inspect fitted plane', exact: true }).click()
  await expect(dialog.getByTestId('research-evidence')).toContainText('floor')
  const accessibility = await new AxeBuilder({ page }).include('[data-testid="research-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(accessibility.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  await dialog.evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: test.info().outputPath('research-plane.png') })
  expect(await page.evaluate(() => (window as Window & { __researchMicRequests?: number }).__researchMicRequests ?? 0)).toBe(0)

  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await exportProject(page)
  expect(after.scene).toEqual(before.scene)
  expect(after.settings).toEqual(before.settings)
})

test('observation replay imports local fixtures, preserves its last report on a hash error, and downloads no PCM', async ({ page }) => {
  await page.goto('/')
  const dialog = await openResearch(page)
  await dialog.getByRole('button', { name: 'Observation replay', exact: true }).click()
  await dialog.getByTestId('research-load-example').click()
  const observations = dialog.getByTestId('research-observation-list')
  await expect(observations.locator('article')).toHaveCount(3)
  await expect(observations).toContainText('unknown')

  const bundleBytes = await readFile(bundlePath)
  const scanBytes = await readFile(scanPath)
  await importSpatialExample(dialog, bundleBytes, scanBytes)
  await expect(dialog.getByTestId('research-replay-status')).toBeVisible()
  await expect(observations).toContainText('world-observation')
  await expect(observations).toContainText('rotated-frame-observation')
  await expect(observations).toContainText('unknown-frame-observation')
  const previousReport = await observations.innerText()

  const brokenBundle = JSON.parse(bundleBytes.toString('utf8')) as { sources: Array<{ sha256: string }> }
  brokenBundle.sources[0]!.sha256 = `${brokenBundle.sources[0]!.sha256[0] === '0' ? '1' : '0'}${brokenBundle.sources[0]!.sha256.slice(1)}`
  await importSpatialExample(dialog, Buffer.from(JSON.stringify(brokenBundle)), scanBytes)
  await expect(dialog.getByTestId('research-replay-status')).toContainText(/sha256|hash|checksum/i)
  await expect(observations).toHaveText(previousReport, { useInnerText: true })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByTestId('research-download-report').click(),
  ])
  const reportPath = await download.path()
  expect(reportPath).toBeTruthy()
  const report = await readFile(reportPath!, 'utf8')
  expect(() => JSON.parse(report)).not.toThrow()
  expect(report).not.toContain('pcm16Base64')
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await openResearch(page)
  await reopened.getByRole('button', { name: 'Observation replay', exact: true }).click()
  await expect(reopened.getByTestId('research-observation-list')).toHaveText(previousReport, { useInnerText: true })
  await reopened.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('Research Lab stacks over Echo without discarding its synthetic scan and restores focus', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  const echo = page.getByTestId('echo-dialog')
  await page.getByTestId('echo-example').click()
  await expect(page.getByTestId('echo-result')).toContainText('5 positions')

  await page.getByTestId('research-from-echo').click()
  const research = page.getByTestId('research-dialog')
  await expect(research).toBeVisible()
  await expect(echo).toBeVisible()
  await research.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(research).toBeHidden()
  await expect(echo).toBeVisible()
  await expect(page.getByTestId('research-from-echo')).toBeFocused()
  await expect(page.getByTestId('echo-result')).toContainText('5 positions')
  await page.getByRole('button', { name: 'Close Echo Lab', exact: true }).click()
  await expect(page.getByTestId('echo-open')).toBeFocused()
})

test('Research Lab fits a 390px viewport and has no serious accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const dialog = await openResearch(page)
  await dialog.getByRole('button', { name: 'Observation replay', exact: true }).click()
  await dialog.getByTestId('research-load-example').click()
  const dimensions = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)
  const scan = await new AxeBuilder({ page }).include('[data-testid="research-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(scan.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  await dialog.evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: test.info().outputPath('research-mobile.png') })
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})
