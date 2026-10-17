import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { parseDoctorArgs, probeSatelliteOrigin, readBoundedBody, SATELLITE_DOCTOR_MAX_BODY_BYTES, validateOrigin } from './satellite-doctor.mjs'

const appHtml = '<!doctype html><html><head><title>Cha Waves | Home field study</title></head><body>Echo Lab</body></html>'
const appResponse = (overrides = {}) => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', 'permissions-policy': 'camera=(), microphone=(self), geolocation=()' },
  body: appHtml,
  bodyTooLarge: false,
  ...overrides,
})
const relayResponse = (overrides = {}) => ({
  status: 401,
  headers: { 'content-type': 'application/json' },
  body: '{"error":"Provide a bearer token.","code":"TOKEN_REQUIRED"}',
  bodyTooLarge: false,
  ...overrides,
})
function responseSequence(responses, requests = []) {
  return {
    requests,
    async requestImpl(url, options) {
      requests.push({ url: `${url.origin}${url.pathname}`, options })
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    },
  }
}

test('accepts canonical HTTPS and loopback HTTP origins, including Bun argument separator', () => {
  assert.equal(validateOrigin('https://device.example.ts.net'), 'https://device.example.ts.net')
  assert.equal(validateOrigin('https://example.test/'), 'https://example.test')
  assert.equal(validateOrigin('http://127.0.0.1:4175'), 'http://127.0.0.1:4175')
  assert.equal(validateOrigin('http://[::1]:4175'), 'http://[::1]:4175')
  assert.deepEqual(parseDoctorArgs(['--', '--origin', 'http://localhost:4175', '--timeout-ms', '2500', '--json']), {
    origin: 'http://localhost:4175', timeoutMs: 2500, json: true, help: false,
  })
})

test('rejects secrets, paths, noncanonical roots, and non-loopback HTTP without echoing values', () => {
  for (const origin of [
    'https://user:top-secret@example.test',
    'https://example.test/private-path',
    'https://example.test/?token=top-secret',
    'https://example.test/#top-secret',
    'http://example.test',
    'ftp://localhost',
  ]) {
    assert.throws(() => validateOrigin(origin), error => {
      assert.equal(error.message.includes('top-secret'), false)
      return true
    })
  }
  assert.throws(() => parseDoctorArgs(['--origin', 'https://example.test', '--timeout-ms', '999999']), /timeout-ms/)
})

test('recognizes the app and relay using unauthenticated GETs with matching Origin', async () => {
  const origin = 'http://127.0.0.1:4175'
  const fake = responseSequence([appResponse(), relayResponse()])
  const result = await probeSatelliteOrigin(origin, { requestImpl: fake.requestImpl })
  assert.equal(result.ok, true)
  assert.equal(result.app.recognized, true)
  assert.equal(result.app.microphonePolicy, 'self')
  assert.equal(result.relay.available, true)
  assert.equal(result.secureContext.originIsSecureContextCandidate, true)
  assert.deepEqual(fake.requests.map(({ url }) => url), [
    `${origin}/`, `${origin}/api/satellite/session`,
  ])
  assert.deepEqual(fake.requests[1].options.headers, { Origin: origin, Accept: 'application/json' })
  assert.equal('Authorization' in fake.requests[1].options.headers, false)
  assert.equal('Cookie' in fake.requests[1].options.headers, false)
})

test('detects static preview as an unavailable relay instead of treating fallback HTML as success', async () => {
  const origin = 'http://localhost:4175'
  const fake = responseSequence([
    appResponse({ status: 404 }),
    relayResponse({ status: 404, headers: { 'content-type': 'text/html' }, body: appHtml }),
  ])
  const result = await probeSatelliteOrigin(origin, { requestImpl: fake.requestImpl })
  assert.equal(result.app.status, 404)
  assert.equal(result.app.recognized, false)
  assert.equal(result.relay.available, false)
  assert.equal(result.ok, false)
  assert.match(result.diagnostics.join(' '), /static preview server/)
})

test('reports oversized responses and microphone policy disabled by server headers', async () => {
  const origin = 'http://localhost:4175'
  const fake = responseSequence([
    appResponse({ body: '', bodyTooLarge: true, headers: { 'content-type': 'text/html', 'permissions-policy': 'microphone=()' } }),
    relayResponse(),
  ])
  const result = await probeSatelliteOrigin(origin, { requestImpl: fake.requestImpl })
  assert.equal(result.app.bodyTooLarge, true)
  assert.equal(result.app.recognized, false)
  assert.equal(result.relay.available, true)
  assert.match(result.diagnostics.join(' '), /Permissions-Policy disables microphone/)

  const blocked = responseSequence([
    appResponse({ headers: { 'content-type': 'text/html', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' } }),
    relayResponse(),
  ])
  const blockedResult = await probeSatelliteOrigin(origin, { requestImpl: blocked.requestImpl })
  assert.equal(blockedResult.app.recognized, true)
  assert.equal(blockedResult.relay.available, true)
  assert.equal(blockedResult.ok, false)
})

test('reads response bodies only up to the configured byte bound', async () => {
  assert.deepEqual(await readBoundedBody(Readable.from([Buffer.from('safe'), Buffer.from(' body')]), 9), {
    body: 'safe body', bodyTooLarge: false,
  })
  assert.deepEqual(await readBoundedBody(Readable.from([Buffer.alloc(8), Buffer.alloc(3)]), 10), {
    body: '', bodyTooLarge: true,
  })
  assert.deepEqual(await readBoundedBody(Readable.from([Buffer.alloc(SATELLITE_DOCTOR_MAX_BODY_BYTES + 1)])), {
    body: '', bodyTooLarge: true,
  })
})

test('recognizes the generated app page at roughly 172 KiB', async () => {
  const largeApp = `${appHtml}${'x'.repeat(172 * 1024 - appHtml.length)}`
  assert.ok(Buffer.byteLength(largeApp) > 64 * 1024)
  assert.deepEqual(await readBoundedBody(Readable.from([Buffer.from(largeApp)])), { body: largeApp, bodyTooLarge: false })
  const fake = responseSequence([
    appResponse({ body: largeApp }),
    relayResponse(),
  ])
  const result = await probeSatelliteOrigin('http://localhost:4175', { requestImpl: fake.requestImpl })
  assert.equal(result.app.recognized, true)
  assert.equal(result.ok, true)
})

test('applies one bounded timeout to slow response reads and never echoes response bodies', async () => {
  const origin = 'http://localhost:4175'
  const requests = []
  const requestImpl = async (url, options) => {
    requests.push({ url: url.pathname, timeoutMs: options.timeoutMs })
    if (url.pathname === '/') await new Promise(resolve => setTimeout(resolve, 20))
    const error = new Error('Request timed out.')
    error.code = 'ETIMEDOUT'
    throw error
  }
  const before = Date.now()
  const result = await probeSatelliteOrigin(origin, { timeoutMs: 150, requestImpl })
  assert.equal(result.ok, false)
  assert.ok(Date.now() - before < 1_000)
  assert.equal(requests.length, 2)
  assert.ok(requests[1].timeoutMs < requests[0].timeoutMs)
  assert.match(result.diagnostics.join(' '), /timed out/)
  assert.equal(JSON.stringify(result).includes('Bearer'), false)
})
