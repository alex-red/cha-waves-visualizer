import { expect, test, type Page } from '@playwright/test'

async function ready(page: Page) {
  await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-quality', 'balanced', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

test('a worker constructor failure can be retried without reloading the project', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let attempts = 0
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (++attempts === 1) throw new Error('Simulated worker startup failure')
        super(url, options)
      }
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('worker-error')).toBeVisible()
  await expect(page.getByTestId('worker-retry')).toHaveAccessibleName('Restart calculation')
  await page.getByTestId('door-toggle').click()
  await expect(page.getByTestId('worker-error')).toBeVisible()
  await page.getByTestId('worker-retry').click()
  await ready(page)
  await expect(page.getByTestId('worker-error')).toBeHidden()
  await expect(page.getByTestId('source-x')).toHaveValue('2.0')
  await expect(page.getByTestId('door-toggle')).toContainText('OPEN')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await ready(page)
  await expect(page.getByTestId('door-toggle')).toContainText('SHUT')
})

for (const failure of ['error', 'messageerror'] as const) {
  test(`${failure} recovery preserves edits, baseline, history and rejects retired worker results`, async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker
      const state = { workers: [] as Worker[], latest: null as unknown, retiredResult: null as unknown, oldHandler: null as Worker['onmessage'], retired: null as Worker | null }
      Object.assign(window, { __chaWorkerTest: state })
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          state.workers.push(this)
          this.addEventListener('message', event => { state.latest = event.data })
        }
      }
    })
    await page.goto('/')
    await ready(page)
    const baseline = await page.getByTestId('probe-value').innerText()
    await page.getByRole('button', { name: 'Save as baseline' }).click()
    await page.getByTestId('door-toggle').click()
    await ready(page)
    const edited = await page.getByTestId('probe-value').innerText()
    expect(edited).not.toBe(baseline)
    await page.evaluate(kind => {
      const state = (window as unknown as { __chaWorkerTest: { workers: Worker[]; latest: unknown; retiredResult: unknown; oldHandler: Worker['onmessage']; retired: Worker | null } }).__chaWorkerTest
      const retired = state.workers.at(-1)!
      state.retired = retired
      state.retiredResult = state.latest
      state.oldHandler = retired.onmessage
      retired.dispatchEvent(kind === 'error'
        ? new ErrorEvent('error', { message: 'Simulated worker interruption', cancelable: true })
        : new MessageEvent('messageerror'))
    }, failure)
    await expect(page.getByTestId('worker-error')).toBeVisible()
    await expect(page.getByTestId('door-toggle')).toContainText('OPEN')
    await page.getByTestId('worker-retry').click()
    await ready(page)
    await expect(page.getByTestId('worker-error')).toBeHidden()
    await expect(page.getByTestId('probe-value')).toHaveText(edited)
    await expect(page.getByRole('button', { name: 'Compare', exact: false })).toBeEnabled()
    const acceptedRequest = await page.getByTestId('field-canvas').getAttribute('data-request-id')
    await page.evaluate(() => {
      const state = (window as unknown as { __chaWorkerTest: { retiredResult: unknown; oldHandler: Worker['onmessage']; retired: Worker | null } }).__chaWorkerTest
      state.oldHandler?.call(state.retired!, new MessageEvent('message', { data: state.retiredResult }))
    })
    await expect(page.getByTestId('field-canvas')).toHaveAttribute('data-request-id', acceptedRequest!)
    await expect(page.getByTestId('probe-value')).toHaveText(edited)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await ready(page)
    await expect(page.getByTestId('probe-value')).toHaveText(baseline)
  })
}
