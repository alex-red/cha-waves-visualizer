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
  use: { ...browserDevices[browser as keyof typeof browserDevices] },
}))

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects,
  webServer: {
    command: 'bun run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
