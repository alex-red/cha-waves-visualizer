import { createServer, type Server } from 'node:http'
import { cp, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type Page } from '@playwright/test'
import { generateOfflineBuild } from '../../../scripts/offline-build.mjs'
import { generateHostingHeaders } from '../../../scripts/static-security.mjs'

type Variant = 'a' | 'b'
type Fixture = {
  root: string
  roots: Record<Variant, string>
  headers: Record<Variant, Record<string, string>>
  versions: Record<Variant, string>
}
type RunningSite = {
  baseURL: string
  setVariant: (variant: Variant) => void
  corruptBuildB: () => void
  close: () => Promise<void>
}

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
}

let fixture: Fixture

test.describe.configure({ mode: 'serial' })

async function createFixture(): Promise<Fixture> {
  const output = await realpath(resolve('apps/web/.output/public'))
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'cha-offline-update-')))
  const roots: Record<Variant, string> = { a: resolve(root, 'a'), b: resolve(root, 'b') }
  const versions = {} as Record<Variant, string>
  const headers = {} as Record<Variant, Record<string, string>>

  for (const variant of ['a', 'b'] as const) {
    await cp(output, roots[variant], { recursive: true })
    const directory = resolve(roots[variant], '_nuxt')
    const marker = variant.toUpperCase()
    if (variant === 'a') await writeFile(resolve(directory, 'offline-old-fixture.js'), "globalThis.offlineFixture = 'A'\n")
    if (variant === 'b') await writeFile(resolve(directory, 'offline-new-fixture.js'), "globalThis.offlineFixture = 'B-new'\n")
    await writeFile(resolve(roots[variant], 'foreign-sw.js'), "self.addEventListener('install', event => event.waitUntil(self.skipWaiting())); self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));")
    const indexPath = resolve(roots[variant], 'index.html')
    const html = await readFile(indexPath, 'utf8')
    await writeFile(indexPath, html.replace('</body>', `<div id="offline-build-fixture">${marker}</div></body>`))
    headers[variant] = (await generateHostingHeaders(roots[variant])).headers
    versions[variant] = (await generateOfflineBuild(roots[variant])).version
  }

  return { root, roots, headers, versions }
}

async function startSite(siteFixture: Fixture): Promise<RunningSite> {
  let current: Variant = 'a'
  let corruptB = false
  const server: Server = createServer(async (request, response) => {
    const method = request.method
    const commonHeaders = {
      ...siteFixture.headers[current],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Resource-Policy': 'same-origin',
    }
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { ...commonHeaders, Allow: 'GET, HEAD' })
      response.end('Method not allowed')
      return
    }

    const rawPath = (request.url ?? '/').split('?')[0] || '/'
    let pathname: string
    try {
      if (!rawPath.startsWith('/') || rawPath.startsWith('//')) throw new URIError('Invalid path')
      pathname = decodeURIComponent(rawPath)
    } catch {
      response.writeHead(400, commonHeaders)
      response.end('Bad request')
      return
    }
    const segments = pathname.split('/')
    if (pathname.includes('\\') || pathname.includes('\0') || segments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) {
      response.writeHead(400, commonHeaders)
      response.end('Bad request')
      return
    }

    let filePath = resolve(siteFixture.roots[current], `.${pathname}`)
    try {
      const actual = await realpath(filePath)
      if (actual !== siteFixture.roots[current] && !actual.startsWith(`${siteFixture.roots[current]}${sep}`)) throw new Error('Outside fixture root')
      if ((await stat(actual)).isDirectory()) filePath = resolve(actual, 'index.html')
      else filePath = actual
      const finalPath = await realpath(filePath)
      if (finalPath !== siteFixture.roots[current] && !finalPath.startsWith(`${siteFixture.roots[current]}${sep}`)) throw new Error('Outside fixture root')
      let content = await readFile(finalPath)
      if (current === 'b' && corruptB && pathname === '/_nuxt/offline-new-fixture.js') content = Buffer.from(`${content.toString('utf8')}\n// integrity failure fixture\n`)
      response.writeHead(200, {
        ...commonHeaders,
        'Content-Type': MIME_TYPES[extname(finalPath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': content.length,
      })
      response.end(method === 'HEAD' ? undefined : content)
    } catch {
      response.writeHead(404, commonHeaders)
      response.end('Not found')
    }
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the offline fixture server')

  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    setVariant: variant => { current = variant },
    corruptBuildB: () => { corruptB = true },
    close: () => new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  }
}

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })
}

async function offlinePanel(page: Page) {
  await page.getByTestId('saved-homes').click()
  const dialog = page.getByRole('dialog', { name: 'Your homes' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function enableOffline(page: Page) {
  const dialog = await offlinePanel(page)
  await dialog.getByTestId('offline-enable').click()
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  await expect(dialog.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'true')
  return dialog
}

test.beforeAll(async () => {
  fixture = await createFixture()
})

test.afterAll(async () => {
  if (fixture) await rm(fixture.root, { recursive: true, force: true })
})

test('a complete B update waits, saves and reloads while an old tab can still lazy-load offline', async ({ page }) => {
  test.setTimeout(90_000)
  const site = await startSite(fixture)
  try {
    await page.goto(site.baseURL)
    await ready(page)
    await expect(page.locator('#offline-build-fixture')).toHaveText('A')
    const oldTab = page
    const oldTabPanel = await enableOffline(oldTab)
    await oldTabPanel.getByRole('button', { name: 'Close' }).click()

    const updater = await page.context().newPage()
    await updater.goto(site.baseURL)
    await ready(updater)
    await expect(updater.locator('#offline-build-fixture')).toHaveText('A')
    site.setVariant('b')

    const panel = await offlinePanel(updater)
    await panel.getByTestId('offline-check-update').click()
    await expect(panel.getByTestId('offline-apply-update')).toBeVisible({ timeout: 60_000 })
    await expect(panel.getByTestId('offline-update-notice')).toBeVisible()
    await panel.getByRole('button', { name: 'Close' }).click()

    await updater.getByTestId('probe-x').fill('13.4')
    await updater.getByTestId('probe-x').press('Tab')
    await ready(updater)
    const updaterPanel = await offlinePanel(updater)
    await expect(updaterPanel.getByTestId('offline-apply-update')).toBeEnabled()
    await updater.evaluate(() => {
      const prototype = IDBObjectStore.prototype
      const originalPut = prototype.put
      prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        prototype.put = originalPut
        this.transaction.abort()
        throw new DOMException('Synthetic quota exhaustion', 'QuotaExceededError')
      }
    })
    await updaterPanel.getByTestId('offline-apply-update').click()
    await expect(updaterPanel.getByRole('alert')).toContainText('This home could not be saved. Close Homes and export a JSON backup before reloading.')
    await expect(updater.locator('#offline-build-fixture')).toHaveText('A')
    await expect(updaterPanel.getByTestId('offline-apply-update')).toBeVisible()
    const waitingUpdate = await updater.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.waiting))
    expect(waitingUpdate).toBe(true)

    await updaterPanel.getByTestId('offline-apply-update').click()
    await expect(updater.locator('#offline-build-fixture')).toHaveText('B', { timeout: 30_000 })
    await expect(updater.getByTestId('probe-x')).toHaveValue('13.4')
    await expect(updater.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })

    await updater.context().setOffline(true)
    await expect(oldTab.getByTestId('offline-connection')).toHaveText('Offline')
    const oldChunk = await oldTab.evaluate(async () => {
      const response = await fetch('/_nuxt/offline-old-fixture.js')
      return { status: response.status, body: await response.text() }
    })
    expect(oldChunk.status).toBe(200)
    expect(oldChunk.body).toContain("offlineFixture = 'A'")
    await oldTab.getByTestId('view-cutaway').click()
    await expect(oldTab.getByTestId('cutaway-canvas')).toBeVisible({ timeout: 20_000 })
    await expect(oldTab.getByTestId('cutaway-canvas')).toHaveAttribute('data-backend', /webgpu|webgl/, { timeout: 20_000 })
  } finally {
    await page.context().setOffline(false)
    await site.close()
  }
})

test('a B asset that fails integrity leaves A complete and usable offline', async ({ page }) => {
  test.setTimeout(90_000)
  const site = await startSite(fixture)
  try {
    await page.goto(site.baseURL)
    await ready(page)
    await expect(page.locator('#offline-build-fixture')).toHaveText('A')
    const panelA = await enableOffline(page)
    await panelA.getByRole('button', { name: 'Close' }).click()

    site.setVariant('b')
    site.corruptBuildB()
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      if (!registration) throw new Error('Expected the version A service worker')
      ;(window as Window & { __offlineWorkerStates?: string[] }).__offlineWorkerStates = []
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          ;(window as Window & { __offlineWorkerStates?: string[] }).__offlineWorkerStates?.push(worker.state)
        })
      })
    })
    const panel = await offlinePanel(page)
    await panel.getByTestId('offline-check-update').click()
    await expect.poll(() => page.evaluate(() => (window as Window & { __offlineWorkerStates?: string[] }).__offlineWorkerStates ?? []), { timeout: 60_000 })
      .toContain('redundant')

    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const worker = registration?.active
      if (!worker) throw new Error('The active version A service worker disappeared')
      const status = await new Promise<{ version: string; ready: boolean }>((resolve, reject) => {
        const channel = new MessageChannel()
        const timeout = setTimeout(() => reject(new Error('Timed out reading the active worker status')), 3000)
        channel.port1.onmessage = event => {
          clearTimeout(timeout)
          resolve(event.data)
          channel.port1.close()
        }
        worker.postMessage({ type: 'GET_STATUS' }, [channel.port2])
      })
      return { status, waiting: Boolean(registration?.waiting), caches: await caches.keys() }
    })
    expect(state.status).toMatchObject({ version: fixture.versions.a, ready: true })
    expect(state.waiting).toBe(false)
    expect(state.caches).toContain(`cha-waves-offline-${fixture.versions.a}`)
    expect(state.caches).not.toContain(`cha-waves-offline-${fixture.versions.b}`)

    await page.context().setOffline(true)
    await page.reload()
    await ready(page)
    await expect(page.locator('#offline-build-fixture')).toHaveText('A')
    await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true')
  } finally {
    await page.context().setOffline(false)
    await site.close()
  }
})

test('removing the app copy leaves an unrelated service worker registration and cache intact', async ({ page }) => {
  test.setTimeout(90_000)
  const site = await startSite(fixture)
  try {
    await page.goto(site.baseURL)
    await ready(page)
    await enableOffline(page)
    await page.evaluate(async () => {
      const cache = await caches.open('another-app-cache')
      await cache.put('/foreign-entry', new Response('keep me'))
      const registration = await navigator.serviceWorker.register('/foreign-sw.js', { scope: '/foreign/' })
      if (registration.active?.state === 'activated') return
      await new Promise<void>((resolve, reject) => {
        const worker = registration.installing ?? registration.waiting ?? registration.active
        if (!worker) return reject(new Error('Foreign service worker did not start installing'))
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve()
          if (worker.state === 'redundant') reject(new Error('Foreign service worker installation failed'))
        })
      })
    })

    const panel = page.getByRole('dialog', { name: 'Your homes' })
    await panel.getByTestId('offline-disable').click()
    await expect(panel.getByTestId('offline-status')).toHaveAttribute('data-enabled', 'false')
    const preserved = await page.evaluate(async () => ({
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({
        scope: registration.scope,
        scriptURL: registration.active?.scriptURL,
      })),
      cacheNames: await caches.keys(),
      entry: await (await caches.open('another-app-cache')).match('/foreign-entry').then(response => response?.text()),
      origin: location.origin,
    }))
    expect(preserved.registrations).toEqual([{ scope: `${preserved.origin}/foreign/`, scriptURL: `${preserved.origin}/foreign-sw.js` }])
    expect(preserved.cacheNames).toEqual(['another-app-cache'])
    expect(preserved.entry).toBe('keep me')
  } finally {
    await page.context().setOffline(false)
    await site.close()
  }
})
