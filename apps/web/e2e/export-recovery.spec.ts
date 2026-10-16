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

test('project export remains available when the worker cannot start', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, {
      construct() {
        throw new Error('Simulated worker startup failure')
      },
    })
  })
  await page.goto('/')
  await expect(page.getByTestId('worker-error')).toBeVisible()
  await expect(page.getByTestId('project-export')).toBeEnabled()

  const exported = await readExport(page)
  expect(exported.format).toBe('cha-waves-project')
  expect(exported.scene.emitters).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'speaker', domain: 'acoustics' }),
    expect.objectContaining({ id: 'access-point', domain: 'radio' }),
  ]))
})

test('project export preserves committed edits and baseline after a runtime worker failure', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const state = { workers: [] as Worker[] }
    Object.assign(window, { __chaExportTest: state })
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        state.workers.push(this)
      }
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
  const originalSourceX = await page.getByTestId('source-x').inputValue()
  await page.getByRole('button', { name: 'Save as baseline' }).click()
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
  await page.evaluate(() => {
    const workers = (window as unknown as { __chaExportTest: { workers: Worker[] } }).__chaExportTest.workers
    workers.at(-1)!.dispatchEvent(new ErrorEvent('error', { message: 'Simulated worker interruption', cancelable: true }))
  })
  await expect(page.getByTestId('worker-error')).toBeVisible()
  await expect(page.getByTestId('project-export')).toBeEnabled()

  const exported = await readExport(page)
  expect(exported.baseline).toBeTruthy()
  expect(exported.baseline.scene.emitters[0].position[0]).toBe(Number(originalSourceX))
  expect(exported.scene.openings.some((opening: { kind: string; isOpen?: boolean }) => opening.kind === 'door' && opening.isOpen)).toBe(true)
})
