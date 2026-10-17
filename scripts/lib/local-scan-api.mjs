import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRecordedEchoScan, parseEchoScan, serializeEchoScan } from '../../packages/echo-scan.ts'

const MAX_SCAN_BYTES = 10 * 1024 * 1024
const MAX_SCAN_FILES = 100
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function isWithin(parent, path) {
  const rel = relative(parent, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`))
}

async function canonicalPaths(captureDir, keyFile, safeRoot) {
  let captureInfo
  try { captureInfo = await lstat(captureDir) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  if (captureInfo && (!captureInfo.isDirectory() || captureInfo.isSymbolicLink())) throw new Error('Capture directory must be a real directory.')
  async function resolveThroughRealParent(target) {
    const tail = [target.split(/[\\/]/).at(-1)]
    let parent = dirname(target)
    while (true) {
      try { return join(await realpath(parent), ...tail) }
      catch (error) {
        if (error?.code !== 'ENOENT') throw error
        const next = dirname(parent)
        if (next === parent) throw error
        tail.unshift(parent.split(/[\\/]/).at(-1))
        parent = next
      }
    }
  }
  const canonicalCaptureDir = captureInfo ? await realpath(captureDir) : await resolveThroughRealParent(captureDir)
  const canonicalKeyFile = await resolveThroughRealParent(keyFile)
  if (safeRoot) {
    const canonicalRoot = await realpath(safeRoot)
    if (isWithin(canonicalRoot, canonicalCaptureDir) || isWithin(canonicalRoot, canonicalKeyFile)) {
      throw new Error('Owner API key and capture directory must be outside the static site root.')
    }
  }
  await mkdir(dirname(canonicalKeyFile), { recursive: true, mode: 0o700 })
  await mkdir(canonicalCaptureDir, { recursive: true, mode: 0o700 })
  const actualCaptureDir = await realpath(canonicalCaptureDir)
  if (actualCaptureDir !== canonicalCaptureDir) throw new Error('Capture directory changed while it was being initialized.')
  return { captureDir: canonicalCaptureDir, keyFile: canonicalKeyFile }
}

async function readBounded(handle, limit) {
  const chunks = []
  let total = 0
  while (total <= limit) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (!bytesRead) break
    chunks.push(buffer.subarray(0, bytesRead))
    total += bytesRead
  }
  if (total > limit) throw new Error('File exceeds its allowed size.')
  return Buffer.concat(chunks, total)
}

async function readOrCreateKey(keyFile) {
  await mkdir(dirname(keyFile), { recursive: true, mode: 0o700 })
  try {
    const handle = await open(keyFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0))
    let keyBytes
    try {
      const info = await handle.stat()
      if (!info.isFile() || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || (info.mode & 0o777) !== 0o600 || info.size > 512) {
        throw new Error('Owner API key file must be a regular owner-only 0600 file no larger than 512 bytes.')
      }
      keyBytes = await readBounded(handle, 512)
    } finally { await handle.close() }
    if (!keyBytes) {
      throw new Error('Owner API key file must be a regular owner-only 0600 file.')
    }
    const key = keyBytes.toString('utf8')
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Owner API key file has invalid contents.')
    return key
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const key = randomBytes(32).toString('base64url')
  const handle = await open(keyFile, 'wx', 0o600)
  try { await handle.writeFile(key, 'utf8'); await handle.sync() } finally { await handle.close() }
  await chmod(keyFile, 0o600)
  return key
}

async function ensureCaptureDir(captureDir) {
  const info = await lstat(captureDir)
  if (!info.isDirectory() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Capture directory must be a real owner-owned directory.')
  await chmod(captureDir, 0o700)
}

function validId(id) { return typeof id === 'string' && ID_PATTERN.test(id) }

async function checkedFile(captureDir, id) {
  if (!validId(id)) return undefined
  const path = join(captureDir, `${id}.json`)
  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0))
    const info = await handle.stat()
    if (!info.isFile() || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || (info.mode & 0o777) !== 0o600 || info.size > MAX_SCAN_BYTES) { await handle.close(); return undefined }
    return { path, info, handle }
  } catch { await handle?.close().catch(() => {}); return undefined }
}

function forbiddenBrowserHeaders(headers) {
  return Object.keys(headers).some(name => name.toLowerCase() === 'origin' || name.toLowerCase().startsWith('sec-fetch-'))
}

function requestAllowed(request, key, port) {
  const auth = request.headers.authorization
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false
  const candidate = Buffer.from(auth.slice(7))
  const expected = Buffer.from(key)
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return false
  const remote = (request.socket.remoteAddress || '').toLowerCase().replace(/^::ffff:/, '')
  const peerLoopback = remote === '::1' || /^127(?:\.\d{1,3}){3}$/.test(remote)
  return peerLoopback && request.headers.host === `127.0.0.1:${port}` && !forbiddenBrowserHeaders(request.headers)
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })
  response.end(body)
}

/** Local, loopback-only read API for owner-exported scan archives. */
export async function createLocalScanApi({ captureDir, keyFile, port = 4176, host = '127.0.0.1', safeRoot }) {
  if (!captureDir || !keyFile) throw new Error('captureDir and keyFile are required.')
  if (host !== '127.0.0.1') throw new Error('Owner API must bind to 127.0.0.1.')
  const canonical = await canonicalPaths(resolve(captureDir), resolve(keyFile), safeRoot ? resolve(safeRoot) : undefined)
  captureDir = canonical.captureDir
  keyFile = canonical.keyFile
  await ensureCaptureDir(captureDir)
  const key = await readOrCreateKey(keyFile)
  let boundPort = port
  let snapshotQueue = Promise.resolve()

  async function listScans() {
    const entries = await readdir(captureDir, { withFileTypes: true })
    const candidates = entries.filter(entry => entry.name.endsWith('.json') && validId(entry.name.slice(0, -5))).sort((a, b) => a.name.localeCompare(b.name))
    if (candidates.length > MAX_SCAN_FILES) throw new Error('Archive exceeds the 100 scan file limit.')
    const scans = []
    for (const entry of candidates) {
      if (!entry.isFile()) continue
      const id = entry.name.slice(0, -5)
      const file = await checkedFile(captureDir, id)
      if (!file) continue
      const bytes = await readBounded(file.handle, MAX_SCAN_BYTES).finally(() => file.handle.close())
      if (bytes.length > MAX_SCAN_BYTES) continue
      try {
        if (JSON.parse(bytes.toString('utf8')).format !== 'cha-echo-scan-v3') continue
        const parsed = parseEchoScan(bytes.toString('utf8')).document
        if (parsed.format !== 'cha-echo-scan-v3' || parsed.mode !== 'recorded') continue
        const recordings = parsed.recordings
        const times = recordings.map(item => item.capturedAt).sort((a, b) => Date.parse(a) - Date.parse(b))
        scans.push({ id, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length,
          recordingCount: recordings.length, batchCount: parsed.batches?.length ?? 0,
          firstCapturedAt: times[0] ?? null, lastCapturedAt: times.at(-1) ?? null })
      } catch { /* Invalid archive files are never exposed. */ }
    }
    return { format: 'cha-echo-local-scans-v1', scans }
  }

  async function writeSnapshotNow(id, recordings, batches = []) {
    if (!validId(id)) throw new Error('Archive id is invalid.')
    const text = serializeEchoScan(createRecordedEchoScan(recordings, [], batches))
    const bytes = Buffer.from(text)
    if (bytes.length > MAX_SCAN_BYTES) throw new Error('Archive scan exceeds 10 MiB.')
    const existing = await readdir(captureDir, { withFileTypes: true })
    const files = existing.filter(entry => entry.name.endsWith('.json'))
    const target = join(captureDir, `${id}.json`)
    if (!files.some(entry => entry.name === `${id}.json`) && files.length >= MAX_SCAN_FILES) throw new Error('Archive is at its 100 scan file limit.')
    const temp = join(captureDir, `.${id}.${randomUUID()}.tmp`)
    const handle = await open(temp, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } catch (error) { await handle.close(); await unlink(temp).catch(() => {}); throw error }
    await handle.close()
    try { await rename(temp, target) } catch (error) { await unlink(temp).catch(() => {}); throw error }
    return { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
  }

  function writeSnapshot(id, recordings, batches = []) {
    const operation = snapshotQueue.then(() => writeSnapshotNow(id, recordings, batches))
    snapshotQueue = operation.catch(() => {})
    return operation
  }

  async function getDetails() {
    return { captureDir, keyFile, port: boundPort }
  }

  const server = createServer(async (request, response) => {
    if (!requestAllowed(request, key, boundPort)) return send(response, 403, '')
    if (request.method !== 'GET') return send(response, 405, '', { Allow: 'GET' })
    const target = request.url || ''
    if (target === '/v1/scans') {
      try { return send(response, 200, JSON.stringify(await listScans()), { 'Content-Type': 'application/json; charset=utf-8' }) }
      catch { return send(response, 503, '') }
    }
    const match = /^\/v1\/scans\/([A-Za-z0-9_-]{1,128})$/.exec(target)
    if (!match) return send(response, 404, '')
    const file = await checkedFile(captureDir, match[1])
    if (!file) return send(response, 404, '')
    try {
      const bytes = await readBounded(file.handle, MAX_SCAN_BYTES).finally(() => file.handle.close())
      if (bytes.length > MAX_SCAN_BYTES) return send(response, 404, '')
      if (JSON.parse(bytes.toString('utf8')).format !== 'cha-echo-scan-v3') return send(response, 404, '')
      const { document } = parseEchoScan(bytes.toString('utf8'))
      if (document.format !== 'cha-echo-scan-v3' || document.mode !== 'recorded') return send(response, 404, '')
      const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`
      return send(response, 200, bytes, { 'Content-Type': 'application/json', ETag: etag })
    } catch { return send(response, 404, '') }
  })
  server.on('listening', () => { boundPort = server.address().port })
  server.requestTimeout = 10_000
  return { server, writeSnapshot, listScans, getDetails, get key() { return key }, get port() { return boundPort } }
}
