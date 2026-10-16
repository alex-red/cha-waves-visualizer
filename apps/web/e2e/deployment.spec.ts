import { expect, test, type Page } from '@playwright/test'

function parseCsp(policy: string) {
  return new Map(policy.split(';').map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/)
    return [name, sources] as const
  }))
}

async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

test('static deployment headers protect the app while allowing its hashed bootstrap and worker', async ({ page, baseURL }) => {
  const externalRequests: string[] = []
  const policyErrors: string[] = []
  const origin = new URL(baseURL!).origin
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url())
  })
  page.on('console', (message) => {
    if (/content security policy|refused to (?:load|connect|execute)/i.test(message.text())) policyErrors.push(message.text())
  })

  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  const headers = response!.headers()
  const csp = headers['content-security-policy']
  expect(csp).toBeTruthy()
  const directives = parseCsp(csp)
  expect(directives.get('default-src')).toEqual(["'self'"])
  expect(directives.get('connect-src')).toEqual(["'self'"])

  const scriptSources = directives.get('script-src') ?? []
  expect(scriptSources).toContain("'self'")
  expect(scriptSources.some((source) => /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(source))).toBe(true)
  expect(scriptSources).not.toContain("'unsafe-inline'")
  expect(scriptSources).not.toContain("'unsafe-eval'")
  expect(directives.get('style-src')).toContain("'unsafe-inline'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('no-referrer')

  // Reaching a computed reading exercises the generated field worker under the deployment CSP.
  await waitForWorkspace(page)
  await page.getByTestId('view-cutaway').click()
  await expect(page.getByTestId('cutaway-canvas')).toHaveAttribute('data-backend', /webgpu|webgl/, { timeout: 20_000 })
  expect(externalRequests).toEqual([])
  expect(policyErrors).toEqual([])
})

test('preview does not expose its hosting configuration and rejects malformed encoded paths', async ({ request }) => {
  const headersFile = await request.get('/_headers')
  expect(headersFile.status()).toBe(404)

  const malformedPath = await request.get('/%E0%A4%A')
  expect(malformedPath.status()).toBe(400)
  expect(malformedPath.headers()['x-content-type-options']).toBe('nosniff')
})
