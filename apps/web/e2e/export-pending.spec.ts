import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function readExport(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8'))
}

async function sourceScreen(page: Page, point: [number, number]) {
  const box = await page.getByTestId('field-canvas').boundingBox()
  if (!box) throw new Error('Plan canvas is not visible')
  const pad = Math.min(80, box.width * .1)
  const scale = Math.min((box.width - 2 * pad) / 14, (box.height - 2 * pad) / 10)
  return { x: box.x + (box.width - 14 * scale) / 2 + point[0] * scale,
    y: box.y + box.height - (box.height - 10 * scale) / 2 - point[1] * scale }
}

test('export uses committed scene while its field is pending and is disabled during a drag preview', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const state = { hold: false }
    Object.assign(window, { __chaPendingExportTest: state })
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', event => {
          if ((window as unknown as { __chaPendingExportTest: typeof state }).__chaPendingExportTest.hold) event.stopImmediatePropagation()
        }, { capture: true })
      }
    }
  })

  await page.goto('/')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
  await page.evaluate(() => { (window as unknown as { __chaPendingExportTest: { hold: boolean } }).__chaPendingExportTest.hold = true })
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('solver-status')).toContainText('Calculating field')

  const exported = await readExport(page)
  expect(exported.scene.openings.some((opening: { kind: string; isOpen?: boolean }) => opening.kind === 'door' && opening.isOpen)).toBe(true)

  const start = await sourceScreen(page, [2, 7.8])
  const end = await sourceScreen(page, [4.4, 7.6])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await expect(page.getByTestId('solver-status')).toContainText('Preview')
  await expect(page.getByTestId('project-export')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.evaluate(() => { (window as unknown as { __chaPendingExportTest: { hold: boolean } }).__chaPendingExportTest.hold = false })
})
