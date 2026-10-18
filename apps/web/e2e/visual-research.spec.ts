import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createSyntheticVisualAsset, createSyntheticVisualManifest } from '../../../packages/test-fixtures/visual-example'

const roomAssetSha256 = '14f5c2425e69891d4e045e21dd76c48bd8fa3f69b9b02e3880a5afba9a012697'
const violinAssetSha256 = '6cb5a33059da30752a49324ab6f84721bb29527bac3810e0856283f0ab59a6dc'

async function openResearch(page: Page) {
  await page.getByTestId('research-open').click()
  const dialog = page.getByTestId('research-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function openVisualTab(dialog: ReturnType<Page['getByTestId']>) {
  await dialog.getByRole('button', { name: 'Visual splats', exact: true }).click()
  return dialog.getByTestId('visual-lab')
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

async function downloadBytes(page: Page, button: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(button).click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return readFile(path!)
}

async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let index = 0; index < frames; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }, count)
}

async function compareCanvasPngs(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(async ({ beforePng, afterPng }) => {
    const bitmap = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0))
      return createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    }
    const [a, b] = await Promise.all([bitmap(beforePng), bitmap(afterPng)])
    if (a.width !== b.width || a.height !== b.height) throw new Error('Canvas screenshot sizes changed between registrations.')
    const surface = new OffscreenCanvas(a.width, a.height)
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not decode canvas screenshots for pixel comparison.')
    context.drawImage(a, 0, 0)
    const aData = context.getImageData(0, 0, a.width, a.height).data
    context.clearRect(0, 0, a.width, a.height)
    context.drawImage(b, 0, 0)
    const bData = context.getImageData(0, 0, b.width, b.height).data
    const top = Math.min(60, Math.floor(a.height / 4))
    const bottom = Math.max(top + 1, a.height - 100)
    // Dialog scroll can move the canvas onto a different fractional CSS pixel.
    // Element screenshots then clip one row/column differently. Align at most
    // one pixel, while comparing the same interior scene with strict thresholds.
    let best = { meanAbsoluteRgbError: Infinity, fractionPixelsOver8: 1, dx: 0, dy: 0 }
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
      let absoluteError = 0
      let pixelsOverTolerance = 0
      let pixelCount = 0
      for (let y = top + 1; y < bottom - 1; y++) for (let x = 1; x < a.width - 1; x++) {
        const aIndex = (y * a.width + x) * 4
        const bIndex = ((y + dy) * b.width + x + dx) * 4
        const differences = [0, 1, 2].map(channel => Math.abs(aData[aIndex + channel]! - bData[bIndex + channel]!))
        absoluteError += differences[0]! + differences[1]! + differences[2]!
        if (Math.max(...differences) > 8) pixelsOverTolerance += 1
        pixelCount += 1
      }
      const result = { meanAbsoluteRgbError: absoluteError / (pixelCount * 3), fractionPixelsOver8: pixelsOverTolerance / pixelCount, dx, dy }
      if (result.meanAbsoluteRgbError < best.meanAbsoluteRgbError) best = result
    }
    a.close()
    b.close()
    return best
  }, { beforePng: before.toString('base64'), afterPng: after.toString('base64') })
}

async function verifyMicWasNotRequested(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as Window & { __visualMicRequests?: number }).__visualMicRequests ?? 0)).toBe(0)
}

test('metric room renders registered splats, previews cameras, and leaves the field project unchanged', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices
    if (!media) return
    Object.assign(window, { __visualMicRequests: 0 })
    Object.defineProperty(media, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const state = window as Window & { __visualMicRequests: number }
        state.__visualMicRequests += 1
        throw new Error('Visual inspection must not request a microphone')
      },
    })
  })
  await page.goto('/?spatial-webgl=1')
  const before = await exportProject(page)
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-room').click()
  await expect(visual.getByTestId('visual-title')).toContainText('Synthetic study room')
  await expect(visual.getByTestId('visual-registration')).toContainText('translation [1, 2, 0]')
  await expect(visual.getByTestId('visual-frame-label')).toHaveText('WORLD / METRES / Z UP')
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)
  await expect(visual.getByTestId('visual-renderer-status')).toContainText('WebGL2', { timeout: 30_000 })
  await expect(visual.getByTestId('visual-status')).toContainText('Registered world frame')
  await expect(visual.getByTestId('visual-backend')).toContainText('WebGL 2')

  const canvas = visual.getByTestId('visual-canvas')
  await expect(canvas).toHaveAttribute('data-backend', 'webgl')
  const canvasPath = testInfo.outputPath('visual-room.png')
  await mkdir(dirname(canvasPath), { recursive: true })
  const withRoom = await canvas.screenshot({ path: canvasPath })
  expect(withRoom.byteLength).toBeGreaterThan(1000)
  const camera = visual.getByTestId('visual-camera-select')
  await expect(camera.locator('option')).toHaveCount(4)
  await camera.selectOption('illustrative-front')
  await nextFrames(page)
  const cameraPreview = await canvas.screenshot()
  expect(cameraPreview).not.toEqual(withRoom)
  await visual.getByTestId('visual-reset').click()
  await expect(camera).toHaveValue('')
  await nextFrames(page)

  const appearance = visual.getByTestId('visual-toggle-asset')
  const beforeHide = await canvas.screenshot()
  await appearance.uncheck()
  await nextFrames(page)
  const withoutAppearance = await canvas.screenshot()
  expect(withoutAppearance).not.toEqual(beforeHide)
  await appearance.check()
  const cameras = visual.getByTestId('visual-toggle-cameras')
  await cameras.uncheck()
  await expect(cameras).not.toBeChecked()
  await cameras.check()
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await nextFrames(page)
  await visual.getByTestId('visual-reset').click()
  await expect(canvas).toBeVisible()
  await verifyMicWasNotRequested(page)

  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await exportProject(page)
  expect(after.scene).toEqual(before.scene)
  expect(after.settings).toEqual(before.settings)
})

test('room downloads reimport byte-for-byte, reject a bad hash, and survive Research Lab close and reopen', async ({ page }) => {
  await page.goto('/?spatial-webgl=1')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-room').click()
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)

  const manifestBytes = await downloadBytes(page, 'visual-download-manifest')
  const assetBytes = await downloadBytes(page, 'visual-download-asset')
  expect(createHash('sha256').update(assetBytes).digest('hex')).toBe(roomAssetSha256)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { asset: { fileName: string; sha256: string } }
  expect(manifest.asset.sha256).toBe(roomAssetSha256)

  await visual.locator('.import-panel > summary').click()
  await visual.getByTestId('visual-manifest-input').setInputFiles({ name: 'synthetic-study-room.visual.json', mimeType: 'application/json', buffer: manifestBytes })
  await visual.getByTestId('visual-asset-input').setInputFiles({ name: manifest.asset.fileName, mimeType: 'application/octet-stream', buffer: assetBytes })
  await visual.getByTestId('visual-import').click()
  await expect(visual.getByTestId('visual-import-status')).toContainText('Ready · 1,883 Gaussians')
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)

  const badManifest = { ...manifest, asset: { ...manifest.asset, sha256: `${manifest.asset.sha256[0] === '0' ? '1' : '0'}${manifest.asset.sha256.slice(1)}` } }
  await visual.getByTestId('visual-manifest-input').setInputFiles({ name: 'synthetic-study-room.visual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badManifest)) })
  await visual.getByTestId('visual-import').click()
  await expect(visual.getByTestId('visual-import-status')).toContainText('Splat SHA256 does not match')
  await expect(visual.getByTestId('visual-title')).toContainText('Synthetic study room')
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)

  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await openResearch(page)
  const reopenedVisual = await openVisualTab(reopened)
  await expect(reopenedVisual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)
  await expect(reopenedVisual.getByTestId('visual-title')).toContainText('Synthetic study room')
  await reopened.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('registered room camera preview is invariant under a shared scale and rigid world transform', async ({ page }, testInfo) => {
  await page.goto('/?spatial-webgl=1')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-room').click()
  await expect(visual.getByTestId('visual-renderer-status')).toContainText('WebGL2', { timeout: 30_000 })
  const camera = visual.getByTestId('visual-camera-select')
  await camera.selectOption('illustrative-front')
  await nextFrames(page)
  const canvas = visual.getByTestId('visual-canvas')
  const beforePath = testInfo.outputPath('visual-registration-before.png')
  await mkdir(dirname(beforePath), { recursive: true })
  const before = await canvas.screenshot({ path: beforePath })

  const originalManifestBytes = await downloadBytes(page, 'visual-download-manifest')
  const assetBytes = await downloadBytes(page, 'visual-download-asset')
  const changedManifest = JSON.parse(originalManifestBytes.toString('utf8')) as ReturnType<typeof createSyntheticVisualManifest>
  changedManifest.registration = {
    status: 'known', scaleMPerUnit: 2.5, rotationXyzw: [0, 0, 0, 1], translationM: [100_000, -100_000, 12], method: 'synthetic',
  }

  await visual.locator('.import-panel > summary').click()
  await visual.getByTestId('visual-manifest-input').setInputFiles({ name: 'synthetic-study-room.visual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changedManifest)) })
  await visual.getByTestId('visual-asset-input').setInputFiles({ name: 'synthetic-study-room.splat', mimeType: 'application/octet-stream', buffer: assetBytes })
  await visual.getByTestId('visual-import').click()
  await expect(visual.getByTestId('visual-registration')).toContainText('translation [100000, -100000, 12]')
  await expect(visual.getByTestId('visual-import-status')).toContainText('Ready · 1,883 Gaussians')

  // Closing/reopening recreates the renderer from the accepted transformed bundle.
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await openResearch(page)
  const reopenedVisual = await openVisualTab(reopened)
  await expect(reopenedVisual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)
  await expect(reopenedVisual.getByTestId('visual-renderer-status')).toContainText('WebGL2', { timeout: 30_000 })
  const reopenedCamera = reopenedVisual.getByTestId('visual-camera-select')
  await reopenedCamera.selectOption('illustrative-front')
  await nextFrames(page)
  const afterPath = testInfo.outputPath('visual-registration-after.png')
  const after = await reopenedVisual.getByTestId('visual-canvas').screenshot({ path: afterPath })
  const difference = await compareCanvasPngs(page, before, after)
  await testInfo.attach('registration-pixel-comparison', { body: JSON.stringify(difference), contentType: 'application/json' })
  expect(difference.meanAbsoluteRgbError).toBeLessThan(0.1)
  expect(difference.fractionPixelsOver8).toBeLessThan(0.005)
  await reopened.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('CC0 violin stays asset-local with unknown registration and only Free orbit', async ({ page }, testInfo) => {
  await page.goto('/?spatial-webgl=1')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-violin').click()
  await expect(visual.getByTestId('visual-title')).toContainText('Violin')
  await expect(visual.getByTestId('visual-import-status')).toContainText('10,000 Gaussians')
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(violinAssetSha256)
  await expect(visual.getByTestId('visual-frame-label')).toHaveText('ASSET FRAME / LOCAL UNITS')
  await expect(visual.getByTestId('visual-unknown-registration')).toContainText('World placement unavailable')
  const camera = visual.getByTestId('visual-camera-select')
  await expect(camera).toHaveValue('')
  await expect(camera.locator('option')).toHaveCount(1)
  await expect(camera.locator('option').first()).toHaveText('Free orbit')
  await expect(visual.getByTestId('visual-renderer-status')).toContainText('WebGL2')
  const canvas = visual.getByTestId('visual-canvas')
  const visible = await canvas.screenshot({ path: testInfo.outputPath('visual-violin.png') })
  await visual.getByTestId('visual-toggle-asset').uncheck()
  await nextFrames(page)
  expect(await canvas.screenshot()).not.toEqual(visible)
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('a distant accepted camera keeps the asset inside its clipping range', async ({ page }, testInfo) => {
  await page.goto('/?spatial-webgl=1')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  const asset = Buffer.from(createSyntheticVisualAsset())
  const manifest = createSyntheticVisualManifest(roomAssetSha256)
  const camera = manifest.cameras[0]!
  // Move 100× farther along the same viewing ray and increase focal length 100×.
  // This remains within the accepted manifest limits, beyond the old far plane.
  camera.position = [3, -737.6, 156.25]
  camera.intrinsics.fx *= 100
  camera.intrinsics.fy *= 100
  await visual.locator('.import-panel > summary').click()
  await visual.getByTestId('visual-manifest-input').setInputFiles({ name: 'distant.visual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) })
  await visual.getByTestId('visual-asset-input').setInputFiles({ name: manifest.asset.fileName, mimeType: 'application/octet-stream', buffer: asset })
  await visual.getByTestId('visual-import').click()
  await expect(visual.getByTestId('visual-renderer-status')).toContainText('WebGL2')
  await visual.getByTestId('visual-camera-select').selectOption(camera.id)
  await nextFrames(page)
  const canvas = visual.getByTestId('visual-canvas')
  const visible = await canvas.screenshot({ path: testInfo.outputPath('visual-distant-camera.png') })
  await visual.getByTestId('visual-toggle-asset').uncheck()
  await nextFrames(page)
  expect(await canvas.screenshot()).not.toEqual(visible)
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('Visual splats fits a 390px viewport and has no critical or serious accessibility findings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?spatial-webgl=1')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-room').click()
  await expect(visual.getByTestId('visual-title')).toBeVisible()
  await expect(visual.getByTestId('visual-renderer-status')).toContainText('WebGL2', { timeout: 30_000 })
  const dimensions = await visual.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }))
  expect(viewport.content).toBeLessThanOrEqual(viewport.width + 1)
  const unusedVerticalSpace = await visual.evaluate(element => {
    const column = element.querySelector('.visual-viewport')!
    const caption = column.querySelector('.boundary')!
    return column.getBoundingClientRect().bottom - caption.getBoundingClientRect().bottom
  })
  expect(unusedVerticalSpace).toBeLessThanOrEqual(24)
  const scan = await new AxeBuilder({ page }).include('[data-testid="visual-lab"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(scan.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  const screenshotPath = testInfo.outputPath('visual-mobile.png')
  await mkdir(dirname(screenshotPath), { recursive: true })
  await visual.getByTestId('visual-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({ path: screenshotPath })
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('WebGL failure keeps the accepted room and evidence downloads usable, and retry preserves the bundle', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(contextId: string, ...args: unknown[]) {
      if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') return null
      return Reflect.apply(original, this, [contextId, ...args]) as ReturnType<typeof original>
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.goto('/?spatial-webgl=1')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-room').click()
  await expect(visual.getByTestId('visual-title')).toContainText('Synthetic study room')
  const rendererError = visual.getByTestId('visual-renderer-error')
  await expect(rendererError).toBeVisible()
  await expect(rendererError).toContainText(/unavailable/i)
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)
  await expect(visual.getByTestId('visual-frame-label')).toHaveText('WORLD / METRES / Z UP')

  const savedManifest = await downloadBytes(page, 'visual-download-manifest')
  const savedAsset = await downloadBytes(page, 'visual-download-asset')
  expect(createHash('sha256').update(savedAsset).digest('hex')).toBe(roomAssetSha256)
  expect(JSON.parse(savedManifest.toString('utf8'))).toHaveProperty('id', 'synthetic-study-room')
  await rendererError.getByRole('button', { name: 'Retry renderer' }).click()
  await expect(rendererError).toBeVisible()
  await expect(visual.getByTestId('visual-title')).toContainText('Synthetic study room')
  await expect(visual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)
  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})

test('late visual import finishing after close cannot replace the retained room', async ({ page }) => {
  await page.addInitScript(() => {
    const state = Object.assign(window, {
      __visualDelayedReadStarted: false,
      __visualDelayedReadFinished: false,
      __visualLateManifestDigestFinished: false,
      __releaseVisualDelayedRead: null as null | (() => void),
    }) as Window & {
      __visualDelayedReadStarted: boolean
      __visualDelayedReadFinished: boolean
      __visualLateManifestDigestFinished: boolean
      __releaseVisualDelayedRead: (() => void) | null
    }
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function() {
      if (this.name !== 'deferred.visual.json') return original.call(this)
      const file = this
      state.__visualDelayedReadStarted = true
      return new Promise<ArrayBuffer>((resolve, reject) => {
        state.__releaseVisualDelayedRead = () => {
          original.call(file).then(resolve, reject).finally(() => { state.__visualDelayedReadFinished = true })
        }
      })
    }
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle)
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const bytes = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        const isLateManifest = new TextDecoder().decode(bytes).includes('Late scene must stay stale')
        const digest = await nativeDigest(algorithm, data)
        if (isLateManifest) state.__visualLateManifestDigestFinished = true
        return digest
      },
    })
  })

  await page.goto('/')
  const dialog = await openResearch(page)
  const visual = await openVisualTab(dialog)
  await visual.getByTestId('visual-example-room').click()
  await expect(visual.getByTestId('visual-title')).toContainText('Synthetic study room')

  const assetBytes = Buffer.from(createSyntheticVisualAsset())
  const manifest = createSyntheticVisualManifest(createHash('sha256').update(assetBytes).digest('hex'))
  manifest.label = 'Late scene must stay stale'
  await visual.locator('.import-panel > summary').click()
  await visual.getByTestId('visual-manifest-input').setInputFiles({ name: 'deferred.visual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) })
  await visual.getByTestId('visual-asset-input').setInputFiles({ name: manifest.asset.fileName, mimeType: 'application/octet-stream', buffer: assetBytes })
  await visual.getByTestId('visual-import').click()
  await page.waitForFunction(() => (window as Window & { __visualDelayedReadStarted?: boolean }).__visualDelayedReadStarted === true)

  await dialog.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(() => {
    const state = window as Window & { __releaseVisualDelayedRead?: (() => void) | null }
    state.__releaseVisualDelayedRead?.()
  })
  await page.waitForFunction(() => (window as Window & { __visualDelayedReadFinished?: boolean }).__visualDelayedReadFinished === true)
  await page.waitForFunction(() => (window as Window & { __visualLateManifestDigestFinished?: boolean }).__visualLateManifestDigestFinished === true)

  const reopened = await openResearch(page)
  const reopenedVisual = await openVisualTab(reopened)
  await expect(reopenedVisual.getByTestId('visual-title')).toContainText('Synthetic study room')
  await expect(reopenedVisual.getByTestId('visual-title')).not.toContainText('Late scene must stay stale')
  await expect(reopenedVisual.getByTestId('visual-import-status')).toContainText('Import cancelled')
  await expect(reopenedVisual.getByTestId('visual-asset-hash')).toHaveText(roomAssetSha256)
  await reopened.getByRole('button', { name: 'Close Research Lab', exact: true }).click()
})
