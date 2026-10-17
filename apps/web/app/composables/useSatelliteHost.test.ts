import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({ callbacks: [] as Array<() => void> }))

vi.mock('vue', async importOriginal => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    onBeforeUnmount: (callback: () => void) => lifecycle.callbacks.push(callback),
  }
})

import { useSatelliteHost } from './useSatelliteHost'
import type { SatelliteCapture } from '../../../../packages/satellite'
import { acquisitionFixture } from '../../../../packages/test-fixtures/acquisition'
import { probeBatchFixture } from '../../../../packages/test-fixtures/probe-batch'

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

const token = 's'.repeat(43)
const expiry = '2026-10-15T13:00:00.000Z'

function capture(id = 'capture-1'): SatelliteCapture {
  return {
    id,
    capturedAt: '2026-10-15T12:30:00.000Z',
    position: { xM: 2, yM: 3.5 },
    sampleRate: 8_000,
    pcm16Base64: btoa(String.fromCharCode(...new Array(16).fill(0))),
    durationMs: 1,
    deviceLabel: 'Pixel phone',
  }
}

function snapshot(captures: SatelliteCapture[] = [], joined = false, deviceLabel = '') {
  return { expiresAt: expiry, joined, deviceLabel, captures }
}

function defaultFetch(snapshotPayload = snapshot()) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/sessions')) return json({ token, expiresAt: expiry, suggestedOrigins: ['https://192.168.1.2:4175'] }, 201)
    if (path.endsWith('/session') && init?.method === 'DELETE') return json({ deleted: true })
    if (path.endsWith('/session')) return json(snapshotPayload)
    throw new Error(`Unexpected satellite request: ${path}`)
  })
}

async function flushPromises() {
  for (let count = 0; count < 10; count += 1) await Promise.resolve()
}

beforeEach(() => {
  lifecycle.callbacks.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  lifecycle.callbacks.length = 0
})

describe('useSatelliteHost', () => {
  it('validates batch links before publishing either audio or outcomes and retains stable poll identities', async () => {
    const fixture = probeBatchFixture()
    const payload = { ...snapshot(fixture.captures, true, 'Phone'), batches: [fixture.batch] }
    vi.stubGlobal('fetch', defaultFetch(payload))
    const host = useSatelliteHost()
    await host.start()
    expect(host.batches.value).toEqual([fixture.batch])
    const originalCaptures = host.captures.value, originalBatches = host.batches.value
    await vi.advanceTimersByTimeAsync(1200)
    expect(host.batches.value).toBe(originalBatches)
    expect(host.captures.value).toBe(originalCaptures)
    payload.batches = [{ ...fixture.batch, attempts: [{ index: 1, status: 'captured', captureId: 'missing' }, ...fixture.batch.attempts.slice(1)] }]
    await vi.advanceTimersByTimeAsync(1200)
    expect(host.error.value).toContain('missing capture')
    expect(host.batches.value).toBe(originalBatches)
    expect(host.captures.value).toBe(originalCaptures)
  })
  it('preserves identical acquisition snapshots but exposes changed same-id telemetry to desktop review', async () => {
    const original = { ...capture(), captureBackend: 'audio-worklet' as const, durationMs: 700, pcm16Base64: btoa('\0'.repeat(11_200)), acquisition: acquisitionFixture() }
    const payload = snapshot([original], true, 'Phone')
    vi.stubGlobal('fetch', defaultFetch(payload))
    const host = useSatelliteHost()
    await host.start()
    const stable = host.captures.value
    await vi.advanceTimersByTimeAsync(1200)
    expect(host.captures.value).toBe(stable)
    payload.captures = [{ ...original, acquisition: { ...original.acquisition, applied: { echoCancellation: true } } }]
    await vi.advanceTimersByTimeAsync(1200)
    expect(host.captures.value).not.toBe(stable)
    expect(host.captures.value[0]?.acquisition?.applied.echoCancellation).toBe(true)
  })
  it('starts a valid pairing session, exposes the token, joins the phone, and preserves unchanged capture identity', async () => {
    const phoneCapture = capture()
    const fetchMock = defaultFetch(snapshot([phoneCapture], true, 'Pixel phone'))
    vi.stubGlobal('fetch', fetchMock)
    const host = useSatelliteHost()

    await host.start()
    expect(host.token.value).toBe(token)
    expect(host.expiresAt.value).toBe(expiry)
    expect(host.suggestedOrigins.value).toEqual(['https://192.168.1.2:4175'])
    expect(host.joined.value).toBe(true)
    expect(host.deviceLabel.value).toBe('Pixel phone')
    expect(host.captures.value).toHaveLength(1)
    expect(host.captures.value[0]).toMatchObject({ id: 'capture-1', position: { xM: 2, yM: 3.5 } })
    const originalArray = host.captures.value
    const originalCapture = host.captures.value[0]

    await vi.advanceTimersByTimeAsync(1_200)
    expect(host.captures.value).toBe(originalArray)
    expect(host.captures.value[0]).toBe(originalCapture)
    expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/session'))).toHaveLength(2)
  })

  it('rejects malformed poll data and stops scheduling further polls', async () => {
    const fetchMock = defaultFetch({ ...snapshot(), captures: [{ ...capture(), pcm16Base64: 'not base64' }] })
    vi.stubGlobal('fetch', fetchMock)
    const host = useSatelliteHost()

    await host.start()
    expect(host.error.value).toMatch(/recording was rejected/)
    expect(host.joined.value).toBe(false)
    expect(host.captures.value).toEqual([])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/session'))).toHaveLength(1)
  })

  it('ignores and aborts a stale in-flight poll when the session ends', async () => {
    const pendingPoll = deferred<Response>()
    let pollSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/sessions')) return json({ token, expiresAt: expiry }, 201)
      if (path.endsWith('/session') && init?.method === 'DELETE') return json({ deleted: true })
      if (path.endsWith('/session')) { pollSignal = init?.signal as AbortSignal; return pendingPoll.promise }
      throw new Error(`Unexpected satellite request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = useSatelliteHost()
    const starting = host.start()
    await flushPromises()

    await host.end()
    expect(pollSignal?.aborted).toBe(true)
    pendingPoll.resolve(json(snapshot([capture('late-capture')], true, 'Late phone')))
    await starting
    expect(host.captures.value).toEqual([])
    expect(host.joined.value).toBe(false)
  })

  it('does not install a late poll after the owning component unmounts', async () => {
    const pendingPoll = deferred<Response>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/sessions')) return json({ token, expiresAt: expiry }, 201)
      if (path.endsWith('/session') && init?.method === 'DELETE') return json({ deleted: true })
      if (path.endsWith('/session')) return pendingPoll.promise
      throw new Error(`Unexpected satellite request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = useSatelliteHost()
    const starting = host.start()
    await flushPromises()

    lifecycle.callbacks[0]!()
    pendingPoll.resolve(json(snapshot([capture('late-capture')], true, 'Late phone')))
    await starting
    expect(host.token.value).toBe('')
    expect(host.captures.value).toEqual([])
    expect(host.joined.value).toBe(false)
  })

  it('deletes the server session on end while retaining captures for export', async () => {
    const fetchMock = defaultFetch(snapshot([capture()], true, 'Pixel phone'))
    vi.stubGlobal('fetch', fetchMock)
    const host = useSatelliteHost()
    await host.start()
    const retained = host.captures.value

    await host.end()
    expect(host.token.value).toBe('')
    expect(host.joined.value).toBe(false)
    expect(host.captures.value).toBe(retained)
    expect(host.captures.value[0]?.id).toBe('capture-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/satellite/session', expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }))
  })

  it('does not create duplicate sessions when start is invoked twice while creation is pending', async () => {
    const pendingCreate = deferred<Response>()
    const fetchMock = defaultFetch()
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/sessions')) return pendingCreate.promise
      return defaultFetch(snapshot())(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const host = useSatelliteHost()

    const firstStart = host.start()
    const secondStart = host.start()
    await secondStart
    await flushPromises()
    expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/sessions'))).toHaveLength(1)

    pendingCreate.resolve(json({ token, expiresAt: expiry }, 201))
    await firstStart
    expect(host.token.value).toBe(token)
    expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/sessions'))).toHaveLength(1)
  })
})
