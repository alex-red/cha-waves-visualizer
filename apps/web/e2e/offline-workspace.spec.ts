import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'

const OWN_CACHE_PREFIX = 'cha-waves-offline-'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
}

async function homes(page: Page) {
  await page.getByTestId('saved-homes').click()
  const dialog = page.getByRole('dialog', { name: 'Your homes' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function enableOffline(page: Page) {
  const dialog = await homes(page)
  await dialog.getByTestId('offline-enable').click()
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'true')
  await expect(dialog.getByText('Offline access is ready for this version.', { exact: true })).toBeVisible()
  return dialog
}

async function exportProject(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as {
    metadata: { id: string; name: string }
    scene: { probes: Array<{ position: [number, number, number] }> }
  }
}

test('offline access is opt-in and opening Homes does not register a worker or create caches', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  const dialog = await homes(page)
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'false')
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-ready', 'false')
  await expect(dialog.getByTestId('offline-enable')).toBeEnabled()

  const browserState = await page.evaluate(async () => ({
    registrations: 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [],
    cacheNames: await caches.keys(),
  }))
  expect(browserState.registrations).toHaveLength(0)
  expect(browserState.cacheNames).toEqual([])
})

test('an enabled copy opens offline, restores edits, loads the lazy cutaway, and exports JSON', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  const initial = await exportProject(page)
  await page.getByTestId('probe-x').fill('13.5')
  await page.getByTestId('probe-x').press('Tab')
  await ready(page)

  const edited = await enableOffline(page)
  await edited.getByRole('button', { name: 'Close' }).click()
  await page.context().setOffline(true)
  const offlineDocument = await page.reload()
  const offlineHeaders = await offlineDocument?.allHeaders()
  expect(offlineHeaders?.['content-security-policy']).toContain("default-src 'self'")
  await ready(page)
  await expect(page.getByTestId('probe-x')).toHaveValue('13.5')

  await page.getByTestId('probe-x').fill('13.3')
  await page.getByTestId('probe-x').press('Tab')
  await ready(page)
  await expect(page.getByTestId('probe-x')).toHaveValue('13.3')
  await page.getByTestId('placement-open').click()
  const placement = page.getByTestId('placement-dialog')
  await placement.getByTestId('placement-run').click()
  await expect(placement.getByTestId('placement-candidate').first()).toBeVisible({ timeout: 20_000 })
  await placement.getByRole('button', { name: 'Close placement explorer', exact: true }).click()

  await page.getByTestId('view-cutaway').click()
  await expect(page.getByTestId('cutaway-canvas')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('cutaway-canvas')).toHaveAttribute('data-backend', /webgpu|webgl/, { timeout: 20_000 })

  const offlineExport = await exportProject(page)
  expect(offlineExport.metadata.id).toBe(initial.metadata.id)
  expect(offlineExport.scene.probes[0]?.position[0]).toBe(13.3)
  await expect(page.getByTestId('offline-connection')).toHaveText('Offline')
  await page.reload()
  await ready(page)
  await expect(page.getByTestId('probe-x')).toHaveValue('13.3')
})

test('removing offline access deletes its cache while keeping other caches and the saved home', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('probe-x').fill('13.2')
  await page.getByTestId('probe-x').press('Tab')
  await ready(page)
  await enableOffline(page)

  await page.evaluate(async () => {
    const cache = await caches.open('another-app-cache')
    await cache.put('/foreign-entry', new Response('keep me'))
  })
  const dialog = page.getByRole('dialog', { name: 'Your homes' })
  await dialog.getByTestId('offline-disable').click()
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'false')

  const afterRemoval = await page.evaluate(async () => ({
    workerPaths: (await navigator.serviceWorker.getRegistrations()).map(registration =>
      [registration.scope, registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL]),
    cacheNames: await caches.keys(),
    foreignEntry: await (await caches.open('another-app-cache')).match('/foreign-entry').then(response => response?.text()),
  }))
  expect(afterRemoval.workerPaths).toEqual([])
  expect(afterRemoval.cacheNames).toEqual(['another-app-cache'])
  expect(afterRemoval.foreignEntry).toBe('keep me')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.reload()
  await ready(page)
  await expect(page.getByTestId('probe-x')).toHaveValue('13.2')
  const preserved = await exportProject(page)
  expect(preserved.scene.probes[0]?.position[0]).toBe(13.2)
})

test('a missing cached document is detected and repaired before going offline again', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await ready(page)
  const initial = await enableOffline(page)
  await initial.getByRole('button', { name: 'Close' }).click()

  const removedDocument = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find(name => name.startsWith('cha-waves-offline-'))
    if (!cacheName) throw new Error('Expected the completed offline cache')
    const cache = await caches.open(cacheName)
    const removed = await cache.delete(`${location.origin}/index.html`)
    return { cacheName, removed }
  })
  expect(removedDocument.removed).toBe(true)

  await page.reload()
  await ready(page)
  const dialog = await homes(page)
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'true')
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-ready', 'false')
  await expect(dialog.getByTestId('offline-enable')).toHaveText('Repair offline copy')
  await dialog.getByTestId('offline-enable').click()
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'true')

  const repaired = await page.evaluate(async cacheName => {
    const cache = await caches.open(cacheName)
    return Boolean(await cache.match(`${location.origin}/index.html`))
  }, removedDocument.cacheName)
  expect(repaired).toBe(true)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.context().setOffline(true)
  await page.reload()
  await ready(page)
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true')
})

for (const outcome of [
  { name: 'grant', result: true, text: /Persistent storage granted/ },
  { name: 'decline', result: false, text: /browser declined persistent storage/ },
] as const) {
  test(`persistent storage ${outcome.name} is shown accurately`, async ({ page }) => {
    await page.addInitScript((persistResult: boolean) => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: async () => false,
          persist: async () => persistResult,
          estimate: async () => ({ usage: 2048, quota: 8192 }),
        },
      })
    }, outcome.result)
    await page.goto('/')
    await ready(page)

    const dialog = await homes(page)
    await dialog.getByTestId('offline-persist').click()
    await expect(dialog.getByTestId('offline-persistence')).toContainText(outcome.text)
  })
}

test('unavailable persistence requests are explained without disabling local work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await page.goto('/')
  await ready(page)

  const dialog = await homes(page)
  await expect(dialog.getByTestId('offline-persistence')).toContainText('Persistent storage requests are unavailable')
  await expect(dialog.getByTestId('offline-persist')).toHaveCount(0)
  await expect(page.getByTestId('project-export')).toBeEnabled()
})

test('the offline panel fits a 320px screen and is accessible and keyboard-dismissible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/')
  await ready(page)

  const trigger = page.getByTestId('saved-homes')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Your homes' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await dialog.getByTestId('offline-enable').click()
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'true')

  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  const violations = (await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()).violations
  expect(violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) }))).toEqual([])

  if (test.info().project.name === 'chromium') {
    await mkdir('reports/screenshots', { recursive: true })
    await page.screenshot({ path: 'reports/screenshots/offline-workspace-phone.png', fullPage: true })
    await page.setViewportSize({ width: 1280, height: 1000 })
    await dialog.evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: 'reports/screenshots/offline-workspace.png', fullPage: true })
    await page.setViewportSize({ width: 320, height: 844 })
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
