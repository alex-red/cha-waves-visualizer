import { defineConfig, devices } from '@playwright/test'

const browserDevices = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const

// Chromium remains the default. Set PLAYWRIGHT_BROWSERS=chromium,firefox,webkit
// to opt into additional engines once their Playwright binaries are installed.
const requestedBrowsers = (process.env.PLAYWRIGHT_BROWSERS ?? 'chromium')
  .split(',')
  .map(browser => browser.trim())
  .filter(Boolean)

const unknownBrowsers = requestedBrowsers.filter(browser => !(browser in browserDevices))
if (unknownBrowsers.length) {
  throw new Error(`Unsupported PLAYWRIGHT_BROWSERS value: ${unknownBrowsers.join(', ')}. Choose chromium, firefox, and/or webkit.`)
}

const projects = [...new Set(requestedBrowsers)].map(browser => ({
  name: browser,
  use: {
    ...browserDevices[browser as keyof typeof browserDevices],
    ...(browser === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL }
      : {}),
  },
}))

const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) throw new Error('PLAYWRIGHT_PORT must be a valid TCP port.')
const previewOrigin = `http://127.0.0.1:${previewPort}`
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === '0'
  ? false
  : process.env.PLAYWRIGHT_REUSE_SERVER === '1'
    ? true
    : !process.env.CI

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: previewOrigin,
    trace: 'retain-on-failure',
  },
  projects,
  webServer: {
    command: 'bun run preview',
    env: { PORT: String(previewPort) },
    url: previewOrigin,
    reuseExistingServer,
    timeout: 120_000,
  },
})
