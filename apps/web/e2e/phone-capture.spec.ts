import { test as base, expect } from '@playwright/test'
import { createSatelliteServer } from '../../../scripts/satellite-server.mjs'
import { readFile } from 'node:fs/promises'
import { parseEchoScan } from '../../../packages/echo-scan'
import type { SatelliteCapture } from '../../../packages/satellite'

const test = base.extend<{ relayOrigin: string }>({
  relayOrigin: async ({}, use) => {
    const server = await createSatelliteServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start satellite test server')
    try { await use(`http://127.0.0.1:${address.port}`) }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  },
})

test.skip(({ browserName }) => browserName !== 'chromium', 'Fake microphone capture is configured for Chromium.')
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })

test('phone capture pairs without mic access, sends measured PCM, and releases tracks after each capture', async ({ page, relayOrigin }) => {
  const createResponse = await fetch(`${relayOrigin}/api/satellite/sessions`, {
    method: 'POST',
    headers: { Origin: relayOrigin, 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(createResponse.ok).toBe(true)
  const { token } = await createResponse.json() as { token: string }
  expect(token.length).toBeGreaterThanOrEqual(32)

  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    const media = navigator.mediaDevices
    const stats = { calls: 0, tracks: [] as MediaStreamTrack[], uploads: [] as Array<{ id: string; pcm16Base64: string; acquisition: unknown }>, delayNextCaptureResponse: false }
    Object.defineProperty(window, '__phoneCaptureStats', { value: stats, configurable: false })
    const originalGetUserMedia = media.getUserMedia.bind(media)
    media.getUserMedia = async constraints => {
      stats.calls++
      const stream = await originalGetUserMedia(constraints)
      stats.tracks.push(...stream.getTracks())
      return stream
    }
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/satellite/captures') && typeof init?.body === 'string') {
        const payload = JSON.parse(init.body) as { id: string; pcm16Base64: string; acquisition: unknown }
        stats.uploads.push({ id: payload.id, pcm16Base64: payload.pcm16Base64, acquisition: payload.acquisition })
        const shouldDelay = stats.delayNextCaptureResponse
        stats.delayNextCaptureResponse = false
        const response = await originalFetch(input, init)
        if (shouldDelay) {
          return await new Promise<Response>((resolve, reject) => {
            const timeout = window.setTimeout(() => resolve(response), 30_000)
            const onAbort = () => { window.clearTimeout(timeout); reject(new DOMException('Aborted', 'AbortError')) }
            if (init.signal?.aborted) onAbort()
            else init.signal?.addEventListener('abort', onAbort, { once: true })
          })
        }
        return response
      }
      return originalFetch(input, init)
    }
  })

  await page.goto(`${relayOrigin}/?satellite=1&transport=usb#${token}`)
  await expect(page.getByTestId('phone-satellite')).toBeVisible()
  await expect(page.getByTestId('phone-usb-notice')).toContainText('port forwarding must be started manually')
  await page.getByRole('button', { name: 'Pair device' }).click()
  await page.getByRole('radio', { name: 'Single sweep', exact: true }).check()
  await expect(page.getByRole('button', { name: 'Record sweep' })).toBeDisabled()
  expect(await page.evaluate(() => (window as Window & { __phoneCaptureStats: { calls: number } }).__phoneCaptureStats.calls)).toBe(0)

  const coordinateInputs = page.locator('.coordinate-fields input')
  await expect(coordinateInputs).toHaveCount(2)
  const xInput = coordinateInputs.nth(0)
  const yInput = coordinateInputs.nth(1)
  await expect(xInput).toHaveAttribute('aria-label', 'Phone X coordinate (m)')
  await expect(yInput).toHaveAttribute('aria-label', 'Phone Y coordinate (m)')
  await xInput.fill('-2.35')
  await yInput.fill('1.8')

  // A hidden tab cancels only after the microphone has been granted, leaving
  // native permission UI untouched and stopping an already-open track.
  await page.getByRole('button', { name: 'Record sweep' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __phoneCaptureStats: { tracks: MediaStreamTrack[] } }).__phoneCaptureStats.tracks.length)).toBe(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('Recording cancelled. This take was discarded; record again when ready.')).toBeVisible()
  const cancelledTrackState = await page.evaluate(() => (window as Window & { __phoneCaptureStats: { tracks: MediaStreamTrack[] } }).__phoneCaptureStats.tracks[0]?.readyState)
  expect(cancelledTrackState).toBe('ended')
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden') })

  await page.getByRole('button', { name: 'Record sweep' }).click()
  await expect(page.getByText('Capture held locally')).toBeVisible({ timeout: 15_000 })
  const acquisitionDetails = page.getByTestId('echo-acquisition-details')
  await acquisitionDetails.locator('summary').click()
  await expect(acquisitionDetails).toContainText('AudioContext sample frames')
  await expect(acquisitionDetails).toContainText('Missing input')
  await expect(acquisitionDetails).toContainText('Requested off · reported off')
  expect(await page.evaluate(() => (window as Window & { __phoneCaptureStats: { calls: number } }).__phoneCaptureStats.calls)).toBe(2)
  await page.evaluate(() => { (window as Window & { __phoneCaptureStats: { delayNextCaptureResponse: boolean } }).__phoneCaptureStats.delayNextCaptureResponse = true })
  await page.getByRole('button', { name: 'Send capture' }).click()
  await expect.poll(async () => {
    const response = await fetch(`${relayOrigin}/api/satellite/session`, {
      headers: { Origin: relayOrigin, Authorization: `Bearer ${token}` },
    })
    const session = await response.json() as { captures: unknown[] }
    return session.captures.length
  }).toBe(1)
  await page.getByRole('button', { name: 'Cancel send' }).click()
  await expect(page.getByText(/Sending cancelled/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send capture' })).toBeVisible()
  const firstAttempt = await page.evaluate(() => (window as Window & { __phoneCaptureStats: { uploads: Array<{ id: string; pcm16Base64: string }> } }).__phoneCaptureStats.uploads[0])
  await page.getByRole('button', { name: 'Send capture' }).click()
  await expect(page.getByText('Received by computer')).toBeVisible()
  const retriedAttempts = await page.evaluate(() => (window as Window & { __phoneCaptureStats: { uploads: Array<{ id: string; pcm16Base64: string }> } }).__phoneCaptureStats.uploads.slice(0, 2))
  expect(retriedAttempts).toHaveLength(2)
  expect(retriedAttempts[0]).toEqual(firstAttempt)
  expect(retriedAttempts[1]).toEqual(firstAttempt)

  const firstTrackStates = await page.evaluate(() => (window as Window & { __phoneCaptureStats: { tracks: MediaStreamTrack[] } }).__phoneCaptureStats.tracks.map(track => track.readyState))
  expect(firstTrackStates.length).toBe(2)
  expect(firstTrackStates.every(state => state === 'ended')).toBe(true)

  // Simulate a browser without AudioWorklet for the second capture.
  await page.evaluate(() => { Object.defineProperty(window, 'AudioWorkletNode', { value: undefined, configurable: true }) })

  // A successful send returns to the same action, and the next pose is read
  // from the phone's updated manual coordinates.
  await xInput.fill('3.5')
  await yInput.fill('-1.25')
  await page.getByRole('button', { name: 'Record sweep' }).click()
  await expect(page.getByText('Capture held locally')).toBeVisible({ timeout: 15_000 })
  await page.clock.install()
  await page.evaluate(() => { (window as Window & { __phoneCaptureStats: { delayNextCaptureResponse: boolean } }).__phoneCaptureStats.delayNextCaptureResponse = true })
  await page.getByRole('button', { name: 'Send capture' }).click()
  await expect.poll(async () => {
    const response = await fetch(`${relayOrigin}/api/satellite/session`, {
      headers: { Origin: relayOrigin, Authorization: `Bearer ${token}` },
    })
    const session = await response.json() as { captures: unknown[] }
    return session.captures.length
  }).toBe(2)
  await page.clock.fastForward(10_001)
  await expect(page.getByText(/Sending timed out/)).toBeVisible()
  await page.getByRole('button', { name: 'Send capture' }).click()
  await expect(page.getByText('Received by computer')).toBeVisible()
  const timedOutAttempts = await page.evaluate(() => (window as Window & { __phoneCaptureStats: { uploads: Array<{ id: string; pcm16Base64: string }> } }).__phoneCaptureStats.uploads.slice(-2))
  expect(timedOutAttempts).toHaveLength(2)
  expect(timedOutAttempts[0]).toEqual(timedOutAttempts[1])

  const stats = await page.evaluate(() => {
    const value = (window as Window & { __phoneCaptureStats: { calls: number; tracks: MediaStreamTrack[] } }).__phoneCaptureStats
    return { calls: value.calls, states: value.tracks.map(track => track.readyState) }
  })
  expect(stats.calls).toBe(3)
  expect(stats.states).toHaveLength(3)
  expect(stats.states.every(state => state === 'ended')).toBe(true)

  const sessionResponse = await fetch(`${relayOrigin}/api/satellite/session`, {
    headers: { Origin: relayOrigin, Authorization: `Bearer ${token}` },
  })
  expect(sessionResponse.ok).toBe(true)
  const session = await sessionResponse.json() as {
    joined: boolean
    captures: SatelliteCapture[]
  }
  expect(session.joined).toBe(true)
  expect(session.captures).toHaveLength(2)
  expect(session.captures.map(capture => capture.position)).toEqual([
    { xM: -2.35, yM: 1.8 },
    { xM: 3.5, yM: -1.25 },
  ])
  expect(session.captures.map(capture => capture.captureBackend)).toEqual(['audio-worklet', 'script-processor'])
  const workletAcquisition = session.captures[0]!.acquisition!
  expect(workletAcquisition.version).toBe(1)
  expect(workletAcquisition.requested).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  expect(workletAcquisition.timing.precision).toBe('sample-frame')
  expect(workletAcquisition.continuity.status).toBe('observed')
  if (workletAcquisition.continuity.status !== 'observed') throw new Error('Expected observed input counters')
  expect(workletAcquisition.continuity.presentInputFrames + workletAcquisition.continuity.missingInputFrames + workletAcquisition.continuity.unobservedFrames).toBe(workletAcquisition.timing.captureFrames)
  expect(workletAcquisition.timing.scheduledChirpStartFrame - workletAcquisition.timing.captureStartFrame!).toBe(Math.round(session.captures[0]!.sampleRate * .1))
  expect(session.captures[1]!.acquisition!.timing.captureStartFrame).toBeNull()
  expect(session.captures[1]!.acquisition!.timing.precision).toBe('approximate')
  expect(session.captures[1]!.acquisition!.continuity).toEqual({ status: 'unavailable' })
  for (const capture of session.captures) {
    expect(capture.acquisition).toBeDefined()
    expect(capture.acquisition!.applied).not.toHaveProperty('deviceId')
    expect(capture.acquisition!.applied).not.toHaveProperty('groupId')
  }
  for (const capture of session.captures) {
    expect(capture.signal!.peak).toBeGreaterThanOrEqual(capture.signal!.rms)
    expect(capture.signal!.peak).toBeLessThanOrEqual(1)
    expect(capture.signal!.clippedFraction).toBeGreaterThanOrEqual(0)
    expect(capture.signal!.clippedFraction).toBeLessThanOrEqual(1)
    expect(capture.sampleRate).toBeGreaterThanOrEqual(8_000)
    expect(capture.durationMs).toBe(700)
    expect(Buffer.from(capture.pcm16Base64, 'base64').length).toBe(Math.ceil(capture.sampleRate * 700 / 1_000) * 2)
  }
  await page.goto('/')
  await page.getByTestId('echo-open').click()
  await page.getByTestId('echo-import').setInputFiles({ name: 'instrumented.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'cha-echo-scan-v3', mode: 'recorded', recordings: session.captures, reviews: [] })) })
  await expect(page.getByTestId('echo-acquisition-details')).toHaveCount(2)
  await expect(page.getByTestId('echo-acquisition-unknown')).toHaveCount(0)
  const exportEvent = page.waitForEvent('download')
  await page.getByTestId('echo-export').click()
  const exported = parseEchoScan(await readFile((await (await exportEvent).path())!, 'utf8')).document
  expect(exported.format).toBe('cha-echo-scan-v3')
  if (exported.mode !== 'recorded') throw new Error('Expected recorded export')
  expect(exported.recordings.map(capture => capture.acquisition)).toEqual(session.captures.map(capture => capture.acquisition))
  await page.getByTestId('echo-new-scan').click()
  await page.getByTestId('echo-restore-scan').click()
  await expect(page.getByTestId('echo-acquisition-details')).toHaveCount(2)
  expect(pageErrors).toEqual([])
})
