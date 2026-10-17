import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile, chmod, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { request as httpRequest } from 'node:http'
import { createLocalScanApi } from './local-scan-api.mjs'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cha-local-scan-'))
  const captureDir = join(dir, 'captures')
  const keyFile = join(dir, 'key')
  const port = 4176
  const api = await createLocalScanApi({ captureDir, keyFile, port })
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const request = (path, headers = {}, method = 'GET') => new Promise(resolve => {
    const req = Readable.from([])
    Object.assign(req, { method, url: path, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${api.key}`, ...headers }, socket: { remoteAddress: '127.0.0.1' } })
    let status
    const responseHeaders = new Headers()
    const res = { writeHead(code, values) { status = code; for (const [key, value] of Object.entries(values)) responseHeaders.set(key, String(value)); return this }, end(body = '') { const bytes = Buffer.from(body); resolve({ status, headers: responseHeaders, json: async () => JSON.parse(bytes.toString()), arrayBuffer: async () => bytes, text: async () => bytes.toString() }) } }
    api.server.emit('request', req, res)
  })
  return { api, captureDir, keyFile, request }
}

test('owner scan API requires authorization and rejects browser and non-loopback requests', async t => {
  const { api, request } = await setup(t)
  assert.equal((await request('/v1/scans', { authorization: 'Bearer wrong' })).status, 403)
  assert.equal((await request('/v1/scans', { origin: 'http://127.0.0.1' })).status, 403)
  assert.equal((await request('/v1/scans', { 'sec-fetch-site': 'same-origin' })).status, 403)
  assert.equal((await request('/v1/scans', {}, 'POST')).status, 405)
  assert.equal(api.server.listening, false)
  assert.equal((await request('/v1/scans', { host: '192.168.1.4:4176' })).status, 403)
  assert.equal((await request('/v1/scans?x=1')).status, 404)
})

test('returns validated scan bytes with hash metadata and ignores symlinks or invalid files', async t => {
  const { api, captureDir, request } = await setup(t)
  const raw = Buffer.from(JSON.stringify({ format: 'cha-echo-scan-v3', mode: 'recorded', recordings: [], reviews: [], batches: [] }, null, 2))
  await writeFile(join(captureDir, 'archive_1.json'), raw, { mode: 0o600 })
  await writeFile(join(captureDir, 'bad.json'), '{ nope', { mode: 0o600 })
  await symlink(join(captureDir, 'archive_1.json'), join(captureDir, 'linked.json'))
  const listed = await (await request('/v1/scans')).json()
  assert.deepEqual(listed, { format: 'cha-echo-local-scans-v1', scans: [{ id: 'archive_1', sha256: createHash('sha256').update(raw).digest('hex'), byteLength: raw.length, recordingCount: 0, batchCount: 0, firstCapturedAt: null, lastCapturedAt: null }] })
  const response = await request('/v1/scans/archive_1')
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), raw)
  assert.equal(response.headers.get('etag'), `"${createHash('sha256').update(raw).digest('hex')}"`)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await request('/v1/scans/linked')).status, 404)
  assert.equal((await request('/v1/scans/bad')).status, 404)
  assert.equal(await readFile(join(captureDir, 'archive_1.json'), 'utf8'), raw.toString())
  assert.equal((await api.getDetails()).port, 4176)
})

test('writes atomic owner-only snapshots and rejects oversized snapshots', async t => {
  const { api, captureDir, keyFile } = await setup(t)
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600)
  assert.equal((await stat(captureDir)).mode & 0o777, 0o700)
  const saved = await api.writeSnapshot('session-123', [], [])
  assert.equal(saved.sha256.length, 64)
  assert.equal(JSON.parse(await readFile(join(captureDir, 'session-123.json'), 'utf8')).format, 'cha-echo-scan-v3')
  await assert.rejects(() => api.writeSnapshot('../escape', [], []), /invalid/)
  await assert.rejects(() => api.writeSnapshot('too-big', [{ id: 'x', capturedAt: 'x', pcm16Base64: 'x'.repeat(11 * 1024 * 1024) }]), /invalid|10 MiB|10485760-byte limit/)
})

test('serializes capacity check and write across concurrent archive ids', async t => {
  const { api, captureDir } = await setup(t)
  for (let index = 0; index < 99; index += 1) await writeFile(join(captureDir, `existing-${index}.json`), '{}', { mode: 0o600 })
  const writes = await Promise.allSettled([
    api.writeSnapshot('concurrent-a', [], []),
    api.writeSnapshot('concurrent-b', [], []),
  ])
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(writes.filter(result => result.status === 'rejected').length, 1)
  const jsonFiles = (await readdir(captureDir)).filter(name => name.endsWith('.json'))
  assert.equal(jsonFiles.length, 100)
  await unlink(join(captureDir, 'existing-0.json'))
  await api.writeSnapshot('after-rejection', [], [])
  assert.equal((await readdir(captureDir)).filter(name => name.endsWith('.json')).length, 100)
})

test('orders capture timestamps by parsed time across fractional precision', async t => {
  const { api } = await setup(t)
  const capture = (id, capturedAt) => ({ id, capturedAt, position: { xM: 0, yM: 0 }, sampleRate: 8_000, pcm16Base64: Buffer.alloc(16).toString('base64'), durationMs: 1 })
  await api.writeSnapshot('date-order', [capture('later', '2026-10-16T01:00:00.9Z'), capture('earlier', '2026-10-16T01:00:00.10Z')])
  const [scan] = (await api.listScans()).scans
  assert.equal(scan.firstCapturedAt, '2026-10-16T01:00:00.10Z')
  assert.equal(scan.lastCapturedAt, '2026-10-16T01:00:00.9Z')
})

test('rejects an unsafe existing owner key file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cha-local-key-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const keyFile = join(dir, 'key')
  await writeFile(keyFile, 'a'.repeat(43), { mode: 0o644 })
  await chmod(keyFile, 0o644)
  await assert.rejects(() => createLocalScanApi({ captureDir: join(dir, 'captures'), keyFile }), /0600/)
  const largeKey = join(dir, 'large-key')
  await writeFile(largeKey, 'a'.repeat(513), { mode: 0o600 })
  await assert.rejects(() => createLocalScanApi({ captureDir: join(dir, 'other-captures'), keyFile: largeKey }), /512 bytes/)
})

test('rejects storage paths inside or aliased into the static root', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cha-local-root-'))
  const safeRoot = join(dir, 'public')
  await import('node:fs/promises').then(fs => fs.mkdir(safeRoot))
  const alias = join(dir, 'alias')
  await import('node:fs/promises').then(fs => fs.symlink(safeRoot, alias))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await assert.rejects(() => createLocalScanApi({ safeRoot, captureDir: join(alias, 'captures'), keyFile: join(dir, 'secret') }), /outside the static site root/)
  await assert.rejects(() => stat(join(safeRoot, 'captures')))
  await assert.rejects(() => createLocalScanApi({ safeRoot, captureDir: join(dir, 'captures'), keyFile: join(safeRoot, 'key') }), /outside the static site root/)
})

test('serves live requests only to canonical loopback clients with the bearer key', async t => {
  const { api, captureDir } = await setup(t)
  await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { if (api.server.listening) await new Promise(resolve => api.server.close(resolve)) })
  const port = api.server.address().port
  const send = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
  const auth = { authorization: `Bearer ${api.key}` }
  const good = await send('/v1/scans', auth)
  assert.equal(good.status, 200)
  assert.deepEqual(JSON.parse(good.body.toString()), { format: 'cha-echo-local-scans-v1', scans: [] })
  assert.equal((await send('/v1/scans')).status, 403)
  assert.equal((await send('/v1/scans', { ...auth, origin: 'http://127.0.0.1' })).status, 403)
  assert.equal((await send('/v1/scans', { ...auth, 'sec-fetch-site': 'same-origin' })).status, 403)
  assert.equal((await send('/v1/scans', auth, 'POST')).status, 405)
  assert.equal((await send('/v1/scans?x=1', auth)).status, 404)
  const text = JSON.stringify({ format: 'cha-echo-scan-v3', mode: 'recorded', recordings: [], reviews: [], batches: [] })
  await writeFile(join(captureDir, 'live.json'), text, { mode: 0o600 })
  await writeFile(join(captureDir, 'oversized.json'), Buffer.alloc(10 * 1024 * 1024 + 1), { mode: 0o600 })
  await symlink(join(captureDir, 'live.json'), join(captureDir, 'live-link.json'))
  assert.equal((await send('/v1/scans/live', { ...auth, host: `localhost:${port}` })).status, 403)
  const actual = await send('/v1/scans/live', auth)
  assert.equal(actual.status, 200)
  assert.equal(actual.body.toString(), text)
  assert.equal((await send('/v1/scans/oversized', auth)).status, 404)
  assert.equal((await send('/v1/scans/live-link', auth)).status, 404)
})
