import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readdir, unlink, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createSatelliteServer, parseArgs, privateLanAddresses, validateExternalOrigin } from './satellite-server.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cha-satellite-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Satellite test</title>')
  const server = await createSatelliteServer({ root, ...options })
  const origin = 'http://satellite.test'
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const request = (path, init = {}) => new Promise(resolve => {
    const url = new URL(path, origin)
    const target = path.startsWith('/') ? path : `${url.pathname}${url.search}`
    const headers = { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), origin, host: url.host, ...Object.fromEntries(Object.entries(init.headers || {}).map(([key, value]) => [key.toLowerCase(), value])) }
    const bodyChunks = init.body === undefined ? [] : Array.isArray(init.body) ? init.body : [Buffer.from(init.body)]
    let bodyDrained = false
    const bodyStream = (async function* () {
      for (const chunk of bodyChunks) yield Buffer.from(chunk)
      bodyDrained = true
    })()
    const req = Readable.from(bodyStream)
    Object.assign(req, { method: init.method || 'GET', url: target, headers, socket: { remoteAddress: init.remoteAddress || 'test-client', encrypted: init.encrypted ?? false } })
    let status
    const responseHeaders = new Headers()
    const res = {
      req,
      writeHead(code, values) { status = code; for (const [key, value] of Object.entries(values)) responseHeaders.set(key, String(value)); return this },
      end(value = '') { const responseBody = Buffer.from(value).toString('utf8'); resolve({ status, headers: responseHeaders, bodyDrained, json: async () => JSON.parse(responseBody), text: async () => responseBody }) },
    }
    server.emit('request', req, res)
  })
  return { origin, request, server }
}

async function createSession(request) {
  const response = await request('/api/satellite/sessions', { method: 'POST', body: '{}' })
  assert.equal(response.status, 201)
  return response.json()
}

function pcmPayload(id, overrides = {}) {
  return {
    id,
    capturedAt: '2026-10-15T12:30:00.000Z',
    position: { xM: 1.25, yM: 3 },
    sampleRate: 8_000,
    pcm16Base64: Buffer.alloc(16).toString('base64'),
    durationMs: 1,
    ...overrides,
  }
}

test('serves the generated site with mic-only same-origin permission and no-store', async t => {
  const { request } = await fixture(t)
  const response = await request('/')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('permissions-policy'), /microphone=\(self\)/)
  assert.match(response.headers.get('permissions-policy'), /camera=\(\).*geolocation=\(\)/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(await response.text(), /Satellite test/)
})

test('creates a bounded session, joins a phone, accepts and polls audio, and deletes it', async t => {
  const { request } = await fixture(t)
  const session = await createSession(request)
  assert.equal(session.token.length, 43)
  assert.deepEqual(session.suggestedOrigins, privateLanAddresses().map(address => `http://${address}`))
  const auth = { Authorization: `Bearer ${session.token}` }
  const initial = await request('/api/satellite/session', { headers: auth })
  assert.deepEqual((await initial.json()).captures, [])
  const joined = await request('/api/satellite/join', { method: 'POST', headers: auth, body: JSON.stringify({ deviceLabel: 'Pixel 10' }) })
  assert.equal(joined.status, 200)
  assert.deepEqual(await joined.json().then(({ joined, deviceLabel }) => ({ joined, deviceLabel })), { joined: true, deviceLabel: 'Pixel 10' })

  const capture = pcmPayload('capture-1', { deviceLabel: 'Pixel 10' })
  const posted = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(capture) })
  assert.equal(posted.status, 201)
  assert.deepEqual((await posted.json()).capture, capture)
  const duplicate = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(capture) })
  assert.equal(duplicate.status, 409)
  assert.equal((await duplicate.json()).code, 'DUPLICATE_CAPTURE')

  const snapshot = await request('/api/satellite/session', { headers: auth })
  assert.deepEqual(await snapshot.json(), {
    expiresAt: session.expiresAt,
    joined: true,
    deviceLabel: 'Pixel 10',
    captures: [capture],
    batches: [],
  })
  const deleted = await request('/api/satellite/session', { method: 'DELETE', headers: auth })
  assert.equal(deleted.status, 200)
  const afterDelete = await request('/api/satellite/session', { headers: auth })
  assert.equal(afterDelete.status, 404)
})

test('archives accepted captures before relay commit and preserves the existing archive on write failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cha-satellite-owner-'))
  const publicRoot = join(root, 'public')
  await import('node:fs/promises').then(fs => fs.mkdir(publicRoot))
  await writeFile(join(publicRoot, 'index.html'), 'ok')
  const captureDir = join(root, 'captures')
  const { request, server } = await fixture(t, { root: publicRoot, localApi: { captureDir, keyFile: join(root, 'owner-key'), port: 4176 } })
  assert.ok(server.localScanApi)
  assert.equal(server.localScanApi.server.listening, false)
  assert.equal((await request('/v1/scans')).status, 404)
  assert.equal((await stat(join(root, 'owner-key'))).mode & 0o777, 0o600)
  const { token } = await createSession(request)
  for (let index = 0; index < 100; index += 1) await writeFile(join(captureDir, `blocker-${index}.json`), '{}', { mode: 0o600 })
  const path = '/api/satellite/captures'
  const failed = await request(path, { method: 'POST', body: JSON.stringify(pcmPayload('owner-capture')), headers: { authorization: `Bearer ${token}` } })
  assert.equal(failed.status, 503)
  const unchanged = await request('/api/satellite/session', { headers: { authorization: `Bearer ${token}` } })
  assert.deepEqual((await unchanged.json()).captures, [])
  for (const name of await readdir(captureDir)) if (name.startsWith('blocker-')) await unlink(join(captureDir, name))
  const accepted = await request(path, { method: 'POST', body: JSON.stringify(pcmPayload('owner-capture')), headers: { authorization: `Bearer ${token}` } })
  assert.equal(accepted.status, 201)
  const scans = await server.localScanApi.listScans()
  assert.equal(scans.scans.length, 1)
  assert.equal(scans.scans[0].recordingCount, 1)
  assert.equal(scans.scans[0].id.length, 36)
  assert.equal((await request(`/v1/scans/${scans.scans[0].id}`)).status, 404)
  const saved = await readFile(join(captureDir, `${scans.scans[0].id}.json`), 'utf8')
  assert.equal(JSON.parse(saved).recordings[0].pcm16Base64, Buffer.alloc(16).toString('base64'))
  const concurrent = await Promise.all(['parallel-a', 'parallel-b'].map(id => request(path, { method: 'POST', body: JSON.stringify(pcmPayload(id)), headers: { authorization: `Bearer ${token}` } })))
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 201])
  const finalScans = await server.localScanApi.listScans()
  assert.equal(finalScans.scans.length, 1)
  const finalArchive = JSON.parse(await readFile(join(captureDir, `${scans.scans[0].id}.json`), 'utf8'))
  assert.deepEqual(finalArchive.recordings.map(recording => recording.id).sort(), ['owner-capture', 'parallel-a', 'parallel-b'])
  assert.equal(JSON.stringify(finalArchive).includes(token), false)
  const batchSession = await createSession(request)
  const batch = batchPayload('archive-batch')
  const firstBatch = await request('/api/satellite/batches', { method: 'POST', body: JSON.stringify(batch), headers: { authorization: `Bearer ${batchSession.token}` } })
  assert.equal(firstBatch.status, 201)
  const batchArchiveInfo = (await server.localScanApi.listScans()).scans.find(scan => scan.recordingCount === 1)
  const batchArchivePath = join(captureDir, `${batchArchiveInfo.id}.json`)
  const beforeReplay = await readFile(batchArchivePath)
  const replay = await request('/api/satellite/batches', { method: 'POST', body: JSON.stringify(batch), headers: { authorization: `Bearer ${batchSession.token}` } })
  assert.equal(replay.status, 200)
  assert.deepEqual(await readFile(batchArchivePath), beforeReplay)
  assert.equal(JSON.stringify(await server.localScanApi.listScans()).includes(batchSession.token), false)
})

test('closing the relay closes its owner sidecar', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cha-satellite-close-'))
  const publicRoot = join(root, 'public')
  await import('node:fs/promises').then(fs => fs.mkdir(publicRoot))
  await writeFile(join(publicRoot, 'index.html'), 'ok')
  const server = await createSatelliteServer({ root: publicRoot, localApi: { captureDir: join(root, 'captures'), keyFile: join(root, 'owner-key'), port: 4176 } })
  t.after(async () => { if (server.localScanApi.server.listening) await new Promise(resolve => server.localScanApi.server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  await new Promise(resolve => server.localScanApi.server.listen(0, '127.0.0.1', resolve))
  assert.equal(server.localScanApi.server.listening, true)
  server.emit('close')
  assert.equal(server.localScanApi.server.listening, false)
})

test('relay preserves valid acquisition evidence and rejects inconsistent or private telemetry fields', async t => {
  const { request } = await fixture(t)
  const session = await createSession(request)
  const auth = { Authorization: `Bearer ${session.token}` }
  const acquisition = {
    version: 1,
    requested: { echoCancellation: false, noiseSuppression: true, autoGainControl: false },
    applied: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
    timing: { clock: 'audio-context', precision: 'approximate', contextSampleRate: 8_000, captureStartFrame: null, captureFrames: 640, scheduledChirpStartFrame: 0, chirpFrames: 640 },
    continuity: { status: 'unavailable' },
  }
  const audio = { pcm16Base64: Buffer.alloc(1_280).toString('base64'), durationMs: 80 }
  const accepted = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload('telemetry-valid', { ...audio, captureBackend: 'script-processor', acquisition })) })
  assert.equal(accepted.status, 201)
  assert.deepEqual((await accepted.json()).capture.acquisition, acquisition)
  const mismatch = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload('telemetry-mismatch', { ...audio, acquisition: { ...acquisition, timing: { ...acquisition.timing, captureFrames: 639 } } })) })
  assert.equal(mismatch.status, 400)
  assert.equal((await mismatch.json()).code, 'INVALID_CAPTURE')
  const privateSetting = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload('telemetry-private', { ...audio, acquisition: { ...acquisition, applied: { ...acquisition.applied, deviceId: 'secret-device' } } })) })
  assert.equal(privateSetting.status, 400)
})

test('rejects cross-origin, malformed, duplicate and oversized capture data explicitly', async t => {
  const { origin, request } = await fixture(t)
  const session = await createSession(request)
  const auth = { Authorization: `Bearer ${session.token}` }
  const denied = await request('/api/satellite/session', { headers: { ...auth, Origin: 'https://attacker.test' } })
  assert.equal(denied.status, 403)
  assert.equal(typeof (await denied.json()).error, 'string')
  const browserSameOriginGet = await request('/api/satellite/session', { headers: { ...auth, Origin: undefined, 'Sec-Fetch-Site': 'same-origin' } })
  assert.equal(browserSameOriginGet.status, 200)

  const mismatch = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload('mismatch', { durationMs: 2 })) })
  assert.equal(mismatch.status, 400)
  assert.equal((await mismatch.json()).code, 'INVALID_CAPTURE')
  const tooLarge = await request('/api/satellite/captures', {
    method: 'POST', headers: auth,
    body: (() => {
      const json = JSON.stringify(pcmPayload('large', { pcm16Base64: Buffer.alloc(560 * 1024).toString('base64') }))
      return [json.slice(0, 100), json.slice(100)]
    })(),
  })
  assert.equal(tooLarge.status, 413)
  assert.equal(tooLarge.bodyDrained, true)
  assert.equal((await tooLarge.json()).code, 'BODY_TOO_LARGE')
})

test('keeps all twelve captures and reports full sessions without evicting data', async t => {
  let time = Date.parse('2026-10-15T12:00:00Z')
  const { request } = await fixture(t, { now: () => time })
  const session = await createSession(request)
  const auth = { Authorization: `Bearer ${session.token}` }
  for (let i = 0; i < 12; i += 1) {
    const response = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload(`capture-${i}`)) })
    assert.equal(response.status, 201)
  }
  const full = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload('capture-overflow')) })
  assert.equal(full.status, 409)
  assert.equal((await full.json()).code, 'SESSION_FULL')
  const snapshot = await request('/api/satellite/session', { headers: auth })
  assert.deepEqual((await snapshot.json()).captures.map(capture => capture.id), Array.from({ length: 12 }, (_, i) => `capture-${i}`))
  const duplicateAfterEviction = await request('/api/satellite/captures', { method: 'POST', headers: auth, body: JSON.stringify(pcmPayload('capture-0')) })
  assert.equal(duplicateAfterEviction.status, 409)
  time += 30 * 60 * 1000
  const expired = await request('/api/satellite/session', { headers: auth })
  assert.equal(expired.status, 410)
  assert.equal((await expired.json()).code, 'SESSION_EXPIRED')
})

function batchCapture(id, startFrame = 8_000) {
  const frames = 5_600
  return pcmPayload(id, {
    sampleRate: 8_000, durationMs: 700, pcm16Base64: Buffer.alloc(frames * 2).toString('base64'), captureBackend: 'audio-worklet',
    acquisition: {
      version: 1, requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, applied: {},
      timing: { clock: 'audio-context', precision: 'sample-frame', contextSampleRate: 8_000, captureStartFrame: startFrame, captureFrames: frames, scheduledChirpStartFrame: startFrame + 800, chirpFrames: 640 },
      continuity: { status: 'unavailable' },
    },
  })
}

function batchPayload(id, captureId = `${id}-capture`) {
  return {
    batch: {
      version: 1, id, startedAt: '2026-10-16T01:00:00.000Z', endedAt: '2026-10-16T01:00:08.000Z',
      position: { xM: 1.25, yM: 3 }, context: { heightM: 1, orientation: 'screen-up', headingDeg: 90, speakerVolumePercent: 50 },
      playbackGain: 0.1, plannedProbeCount: 5, warmupMs: 1000, probeIntervalMs: 1000, sampleRate: 8_000,
      warmupStartFrame: 0, warmupEndFrame: 8_000,
      attempts: [{ index: 1, status: 'captured', captureId }, { index: 2, status: 'interrupted', reason: 'timeout' }, { index: 3, status: 'not-started' }, { index: 4, status: 'not-started' }, { index: 5, status: 'not-started' }],
    },
    captures: [batchCapture(captureId)],
  }
}

test('accepts and idempotently retries atomic batches, while rejecting broken cross-links without partial storage', async t => {
  const { request } = await fixture(t)
  const session = await createSession(request)
  const auth = { Authorization: `Bearer ${session.token}` }
  const payload = batchPayload('batch-1')
  const accepted = await request('/api/satellite/batches', { method: 'POST', headers: auth, body: JSON.stringify(payload) })
  assert.equal(accepted.status, 201)
  const retry = await request('/api/satellite/batches', { method: 'POST', headers: auth, body: JSON.stringify(payload) })
  assert.equal(retry.status, 200)
  const invalid = batchPayload('batch-invalid')
  invalid.batch.attempts[0].captureId = 'missing-capture'
  const rejected = await request('/api/satellite/batches', { method: 'POST', headers: auth, body: JSON.stringify(invalid) })
  assert.equal(rejected.status, 400)
  const privatePayload = batchPayload('batch-private')
  privatePayload.captures[0].deviceId = 'private-device'
  const privateRejected = await request('/api/satellite/batches', { method: 'POST', headers: auth, body: JSON.stringify(privatePayload) })
  assert.equal(privateRejected.status, 400)
  const snapshot = await (await request('/api/satellite/session', { headers: auth })).json()
  assert.deepEqual(snapshot.captures.map(capture => capture.id), ['batch-1-capture'])
  assert.deepEqual(snapshot.batches.map(batch => batch.id), ['batch-1'])
})

test('unsupported API routes return a JSON explanation', async t => {
  const { request } = await fixture(t)
  const response = await request('/api/satellite/unknown')
  assert.equal(response.status, 404)
  assert.equal((await response.json()).code, 'UNSUPPORTED_API_ROUTE')
  const traversal = await request('/%2e%2e/private.txt')
  assert.equal(traversal.status, 400)
  const hostingMetadata = await request('/_headers')
  assert.equal(hostingMetadata.status, 404)
})

test('limits session creation requests per client', async t => {
  const { request } = await fixture(t)
  for (let i = 0; i < 10; i += 1) await createSession(request)
  const limited = await request('/api/satellite/sessions', { method: 'POST', body: '{}' })
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).code, 'RATE_LIMITED')
  assert.equal(limited.headers.get('retry-after'), '60')
})

test('prefers private LAN addresses on physical interfaces over virtual adapters', () => {
  const address = (address, family = 'IPv4', internal = false) => ({ address, family, internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` })
  const interfaces = {
    vmnet8: [address('192.168.56.1')],
    bridge100: [address('172.20.0.1')],
    en1: [address('192.168.1.21')],
    en0: [address('192.168.1.20'), address('fe80::1', 'IPv6')],
    wlan0: [address('10.0.0.4')],
    lo0: [address('192.168.0.2', 'IPv4', true)],
  }
  assert.deepEqual(privateLanAddresses(interfaces), [
    '192.168.1.20', '192.168.1.21', '10.0.0.4', '172.20.0.1', '192.168.56.1',
  ])
})

test('validates one HTTPS root origin for proxy mode', () => {
  assert.equal(validateExternalOrigin('https://scanner.example.ts.net'), 'https://scanner.example.ts.net')
  assert.equal(validateExternalOrigin('https://example.test:8443'), 'https://example.test:8443')
  for (const value of [
    'http://example.test',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test/?q=1',
    'https://example.test/#fragment',
    'https://example.test/',
    'https://example.test,https://evil.test',
  ]) assert.throws(() => validateExternalOrigin(value), /one HTTPS origin/)
  assert.deepEqual(parseArgs(['--host', '127.0.0.1', '--port', '4175', '--external-origin', 'https://example.test']), {
    host: '127.0.0.1', port: 4175, externalOrigin: 'https://example.test',
  })
  assert.throws(() => parseArgs(['--external-origin', 'http://example.test']), /one HTTPS origin/)
})

test('allows the exact external HTTPS origin through loopback proxy and advertises it', async t => {
  const externalOrigin = 'https://scanner.example.ts.net'
  const { request } = await fixture(t, { externalOrigin })
  const response = await request('/api/satellite/sessions', {
    method: 'POST',
    remoteAddress: '127.0.0.1',
    headers: {
      Origin: externalOrigin,
      Host: 'scanner.example.ts.net',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'scanner.example.ts.net',
    },
    body: '{}',
  })
  assert.equal(response.status, 201)
  assert.deepEqual((await response.json()).suggestedOrigins, [externalOrigin])
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})

test('proxy origin allowlist requires the exact origin, loopback peer, and expected or loopback Host', async t => {
  const externalOrigin = 'https://scanner.example.ts.net'
  const { request } = await fixture(t, { externalOrigin })
  const requestSession = init => request('/api/satellite/sessions', { method: 'POST', body: '{}', ...init })
  const allowedLoopbackHost = await requestSession({
    remoteAddress: '::ffff:127.0.0.1',
    headers: { Origin: externalOrigin, Host: 'localhost:4175', 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'attacker.test' },
  })
  assert.equal(allowedLoopbackHost.status, 201)

  const remoteClient = await requestSession({
    remoteAddress: '192.168.1.20',
    headers: { Origin: externalOrigin, Host: 'scanner.example.ts.net', 'X-Forwarded-Proto': 'https' },
  })
  assert.equal(remoteClient.status, 403)
  const wrongOrigin = await requestSession({
    remoteAddress: '::1',
    headers: { Origin: 'https://attacker.test', Host: 'scanner.example.ts.net', 'X-Forwarded-Host': externalOrigin },
  })
  assert.equal(wrongOrigin.status, 403)
  const wrongHost = await requestSession({
    remoteAddress: '127.0.0.1',
    headers: { Origin: externalOrigin, Host: 'attacker.test', 'X-Forwarded-Host': externalOrigin },
  })
  assert.equal(wrongHost.status, 403)
  const wrongScheme = await requestSession({
    remoteAddress: '127.0.0.1',
    headers: { Origin: 'http://scanner.example.ts.net', Host: 'localhost:4175', 'X-Forwarded-Proto': 'https' },
  })
  assert.equal(wrongScheme.status, 403)

  const directHttpSameOrigin = await request('/api/satellite/sessions', {
    method: 'POST', body: '{}', headers: { Origin: 'http://satellite.test', Host: 'satellite.test' },
  })
  assert.equal(directHttpSameOrigin.status, 201)
  const forwardedOnly = await requestSession({
    remoteAddress: '192.168.1.20',
    headers: { Origin: externalOrigin, Host: 'satellite.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'scanner.example.ts.net' },
  })
  assert.equal(forwardedOnly.status, 403)
})
