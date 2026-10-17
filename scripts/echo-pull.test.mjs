import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, chmod, readFile, writeFile, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEchoPullArguments, pullEchoScan, readLocalApiKey, requestLocalScan, validateLocalOrigin, validateScanListing } from './echo-pull.mjs'
import { createLocalScanApi } from './lib/local-scan-api.mjs'
import { createSyntheticEchoScan } from '../packages/echo-scan.ts'

const key = 's'.repeat(43)
const scan = { format: 'cha-echo-scan-v3', mode: 'recorded', recordings: [], reviews: [], batches: [] }

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'cha-echo-pull-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

async function listen(t, server) {
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  assert.equal(server.address().address, '127.0.0.1')
  return `http://127.0.0.1:${server.address().port}`
}

test('pull arguments require an explicit scan/output pair and a canonical direct loopback origin', () => {
  assert.deepEqual(parseEchoPullArguments(['--help']), { help: true })
  assert.equal(parseEchoPullArguments([]).origin, 'http://127.0.0.1:4176')
  assert.equal(parseEchoPullArguments(['--', '--scan', 'room_1', '--output', '/tmp/one.json']).scanId, 'room_1')
  for (const args of [['--scan', 'one'], ['--output', 'one'], ['--scan', '../one', '--output', 'x'], ['--key-file', 'x', '--key-file', 'y'], ['--unknown']]) assert.throws(() => parseEchoPullArguments(args))
  for (const origin of ['https://127.0.0.1:4176', 'http://localhost:4176', 'http://127.0.0.1:4176/', `http://${key}@127.0.0.1:4176`, 'http://example.com', 'http://127.0.0.1:4176/?x=1']) {
    assert.throws(() => validateLocalOrigin(origin), error => !error.message.includes(key))
  }
})

test('owner key loading rejects shared, linked, oversized and invalid credential files without exposing contents', async t => {
  const dir = await directory(t), path = join(dir, 'key')
  await writeFile(path, key, { mode: 0o600 })
  assert.equal(await readLocalApiKey(path), key)
  await chmod(path, 0o644)
  await assert.rejects(() => readLocalApiKey(path), /0600/)
  await chmod(path, 0o600)
  const link = join(dir, 'linked')
  await symlink(path, link)
  await assert.rejects(() => readLocalApiKey(link), /unavailable/)
  await writeFile(path, 'x'.repeat(513))
  await assert.rejects(() => readLocalApiKey(path), error => !error.message.includes(key))
  await writeFile(path, 'invalid-key')
  await assert.rejects(() => readLocalApiKey(path), /format/)
})

test('lists and retrieves exact archive bytes using owner authentication, preserving hashes and existing outputs', async t => {
  const dir = await directory(t), keyFile = join(dir, 'owner-key'), captureDir = join(dir, 'archive')
  const api = await createLocalScanApi({ keyFile, captureDir, port: 0 })
  const origin = await listen(t, api.server)
  const capture = { id: 'synthetic-probe', capturedAt: '2026-01-01T00:00:00.000Z', position: { xM: 0, yM: 0 }, sampleRate: 8000, durationMs: 1, pcm16Base64: Buffer.alloc(16).toString('base64') }
  await api.writeSnapshot('one', [capture], [])
  const listed = await pullEchoScan({ origin, keyFile })
  assert.equal(listed.scans.length, 1)
  assert.equal(listed.scans[0].recordingCount, 1)
  assert.ok(!JSON.stringify(listed).includes(await readLocalApiKey(keyFile)))
  const output = join(dir, 'downloaded.json')
  const result = await pullEchoScan({ origin, keyFile, scanId: 'one', output })
  const downloaded = await readFile(output), original = await readFile(join(captureDir, 'one.json'))
  assert.deepEqual(downloaded, original)
  assert.equal(result.sha256, listed.scans[0].sha256)
  assert.equal(result.sha256, createHash('sha256').update(downloaded).digest('hex'))
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  await assert.rejects(() => pullEchoScan({ origin, keyFile, scanId: 'one', output }), /already exists/)
  assert.deepEqual(await readFile(output), original)
})

test('rejects malformed or secret-bearing listings instead of echoing arbitrary API fields', () => {
  assert.deepEqual(validateScanListing(Buffer.from('{"format":"cha-echo-local-scans-v1","scans":[]}')), { format: 'cha-echo-local-scans-v1', scans: [] })
  for (const value of [{ format: 'cha-echo-local-scans-v1', scans: [], ownerKey: key }, { format: 'bad', scans: [] }, { format: 'cha-echo-local-scans-v1', scans: [{ id: null }] }]) {
    assert.throws(() => validateScanListing(Buffer.from(JSON.stringify(value))), error => !error.message.includes(key))
  }
})

test('does not follow redirects and bounds response size and total request duration', async t => {
  let behavior = 'redirect'
  const server = createServer((_request, response) => {
    if (behavior === 'redirect') { response.writeHead(302, { Location: 'http://example.com/' }); response.end() }
    else if (behavior === 'oversize') { response.writeHead(200); response.end(Buffer.alloc(64 * 1024 + 1)) }
    else { response.writeHead(200); response.write(' ') }
  })
  const origin = await listen(t, server)
  await assert.rejects(() => requestLocalScan({ origin, key }), /HTTP 302/)
  behavior = 'oversize'
  await assert.rejects(() => requestLocalScan({ origin, key }), /size limit/)
  behavior = 'stalled'
  await assert.rejects(() => requestLocalScan({ origin, key, timeoutMs: 25 }), /timed out/)
})

test('will not save a valid scan whose exact bytes do not match its ETag', async t => {
  const dir = await directory(t), keyFile = join(dir, 'key'), output = join(dir, 'untrusted.json')
  await writeFile(keyFile, key, { mode: 0o600 })
  const server = createServer((_request, response) => { response.writeHead(200, { ETag: `"${'0'.repeat(64)}"` }); response.end(JSON.stringify(scan)) })
  const origin = await listen(t, server)
  await assert.rejects(() => pullEchoScan({ origin, keyFile, scanId: 'one', output }), /hash/)
  await assert.rejects(() => stat(output), { code: 'ENOENT' })
})

test('failed authentication and invalid selected scans never create an output file', async t => {
  const dir = await directory(t), keyFile = join(dir, 'key'), output = join(dir, 'rejected.json')
  await writeFile(keyFile, key, { mode: 0o600 })
  let status = 403, body = ''
  const server = createServer((_request, response) => {
    response.writeHead(status, { ETag: `"${createHash('sha256').update(body).digest('hex')}"` })
    response.end(body)
  })
  const origin = await listen(t, server)
  const attempt = () => pullEchoScan({ origin, keyFile, scanId: 'one', output })
  await assert.rejects(attempt, /HTTP 403/)
  status = 200
  for (const invalid of ['{', JSON.stringify({ ...scan, recordings: 'invalid' })]) {
    body = invalid
    await assert.rejects(attempt)
    await assert.rejects(() => stat(output), { code: 'ENOENT' })
  }
  body = JSON.stringify(createSyntheticEchoScan({ widthM: 6.4, depthM: 4.8, originXM: -1, originYM: 2 }, []))
  await assert.rejects(attempt, /synthetic/)
  await assert.rejects(() => stat(output), { code: 'ENOENT' })
})
