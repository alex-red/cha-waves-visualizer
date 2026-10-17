import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateHostingHeaders } from './static-security.mjs'
import { createLocalScanApi } from './lib/local-scan-api.mjs'
import { SATELLITE_LIMITS, validateSatelliteCapture } from '../packages/satellite.ts'
import { validateProbeBatch } from '../packages/probe-batch.ts'

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)))
const defaultRoot = resolve(scriptDirectory, '../apps/web/.output/public')
const mime = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

function send(response, status, headers, body = '') {
  const content = Buffer.from(body)
  response.writeHead(status, { ...headers, 'Content-Length': content.length })
  response.end(response.req?.method === 'HEAD' ? undefined : content)
}

function sendJson(response, status, payload, headers) {
  send(response, status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(payload))
}

function errorJson(response, status, code, message, headers, extraHeaders = {}) {
  sendJson(response, status, { error: message, code }, { ...headers, ...extraHeaders })
}

function drainAndError(request, response, status, code, message, headers, extraHeaders = {}) {
  request.resume()
  return errorJson(response, status, code, message, headers, extraHeaders)
}

function suggestedOrigins(request, externalOrigin) {
  if (externalOrigin && isExternalProxyRequest(request, externalOrigin)) return [externalOrigin]
  const protocol = request.socket.encrypted ? 'https:' : 'http:'
  const host = request.headers.host
  let port
  try { port = new URL(`${protocol}//${host}`).port } catch { return [] }
  return privateLanAddresses().map(address => `${protocol}//${address}${port ? `:${port}` : ''}`)
}

export function validateExternalOrigin(value) {
  if (typeof value !== 'string' || value.length > 512) throw new Error('--external-origin must be one HTTPS origin without a path, query, fragment, or credentials.')
  let parsed
  try { parsed = new URL(value) } catch {
    throw new Error('--external-origin must be one HTTPS origin without a path, query, fragment, or credentials.')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) {
    throw new Error('--external-origin must be one HTTPS origin without a path, query, fragment, or credentials.')
  }
  return parsed.origin
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  if (normalized === '::1') return true
  const octets = normalized.split('.').map(Number)
  return octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127
}

function isLoopbackHost(host) {
  if (typeof host !== 'string' || host.length > 255) return false
  try {
    const url = new URL(`http://${host}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
    if (url.hostname === 'localhost' || url.hostname === '[::1]') return true
    const octets = url.hostname.split('.').map(Number)
    return octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127
  } catch {
    return false
  }
}

function isExternalProxyRequest(request, externalOrigin) {
  const host = request.headers.host
  if (typeof host !== 'string' || host.length > 255) return false
  let hostMatchesExternalOrigin = false
  try {
    const parsedHost = new URL(`http://${host}`)
    if (parsedHost.username || parsedHost.password || parsedHost.pathname !== '/' || parsedHost.search || parsedHost.hash) return false
    hostMatchesExternalOrigin = new URL(`https://${host}`).origin === externalOrigin
  } catch { return false }
  return request.headers.origin === externalOrigin && isLoopbackAddress(request.socket.remoteAddress) &&
    (hostMatchesExternalOrigin || isLoopbackHost(host))
}

export function privateLanAddresses(interfaces = networkInterfaces()) {
  const addressesFound = new Map()
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      const octets = address.address.split('.').map(Number)
      const ipv4 = address.family === 'IPv4' || address.family === 4
      const privateLan = ipv4 && (
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
      )
      if (!privateLan || address.internal) continue
      const priority = /^(?:en\d+|enp\d+s\d+(?:f\d+)?|enx\w+|eth\d+|eno\d+|ens\d+|em\d+|wlan\d*|wlo\d+|wlp\S*|wlx\S*)$/i.test(interfaceName)
        ? 0
        : /(?:bridge|vmnet|utun|docker|veth|tap|tun|virbr|vbox|tailscale|zerotier|podman|cni|flannel|^br-|^wg\d|^zt\d)/i.test(interfaceName)
          ? 2
          : 1
      const previous = addressesFound.get(address.address)
      if (!previous || priority < previous.priority || (priority === previous.priority && interfaceName.localeCompare(previous.interfaceName) < 0)) {
        addressesFound.set(address.address, { priority, interfaceName })
      }
    }
  }
  return [...addressesFound.entries()]
    .sort(([addressA, infoA], [addressB, infoB]) =>
      infoA.priority - infoB.priority || infoA.interfaceName.localeCompare(infoB.interfaceName) ||
      compareIpv4(addressA, addressB)
    )
    .map(([address]) => address)
}

function compareIpv4(left, right) {
  const leftOctets = left.split('.').map(Number)
  const rightOctets = right.split('.').map(Number)
  for (let index = 0; index < 4; index += 1) {
    if (leftOctets[index] !== rightOctets[index]) return leftOctets[index] - rightOctets[index]
  }
  return 0
}

function bearerToken(request) {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header)
  return match?.[1]
}

async function readJson(request, limitBytes) {
  const contentType = request.headers['content-type']
  const supportedType = typeof contentType === 'string' && /^application\/json(?:\s*;|$)/i.test(contentType)
  const chunks = []
  let size = 0
  let oversized = false
  for await (const chunk of request) {
    size += chunk.length
    if (size > limitBytes) oversized = true
    else if (!oversized) chunks.push(chunk)
  }
  if (oversized) return { error: { status: 413, code: 'BODY_TOO_LARGE', message: 'Request body exceeds the allowed size.' } }
  if (!supportedType) return { error: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send this request as application/json.' } }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { error: { status: 400, code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }
  }
}

/** Create the same-origin static app and in-memory phone relay server. */
export async function createSatelliteServer({
  root = defaultRoot,
  tls,
  externalOrigin: configuredExternalOrigin,
  now = () => Date.now(),
  tokenFactory = () => randomBytes(SATELLITE_LIMITS.tokenBytes).toString('base64url'),
  localApi,
} = {}) {
  const externalOrigin = configuredExternalOrigin === undefined ? undefined : validateExternalOrigin(configuredExternalOrigin)
  const safeRoot = await realpath(root)
  const { headers: generatedHeaders } = await generateHostingHeaders(safeRoot)
  const responseHeaders = {
    ...generatedHeaders,
    // A phone microphone is needed for a user initiated capture. Keep other device sensors disabled.
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
    'Cache-Control': 'no-store',
  }
  const sessions = new Map()
  const expiredTokens = new Map()
  const requestCounts = new Map()
  const ownerApi = localApi ? await createLocalScanApi({ ...localApi, safeRoot }) : undefined

  async function commitArchived(session, snapshot, commit) {
    const operation = (session.archiveTransaction || Promise.resolve()).then(async () => {
      const values = snapshot()
      if (values) await ownerApi.writeSnapshot(session.archiveId, values.recordings, values.batches)
      return commit()
    })
    session.archiveTransaction = operation.catch(() => {})
    return operation
  }

  function prune() {
    const current = now()
    for (const [token, session] of sessions) {
      if (session.expiresAtMs <= current) {
        sessions.delete(token)
        expiredTokens.set(token, current + 10 * 60 * 1000)
      }
    }
    for (const [token, expiresAt] of expiredTokens) if (expiresAt <= current) expiredTokens.delete(token)
    while (expiredTokens.size > 64) expiredTokens.delete(expiredTokens.keys().next().value)
    for (const [key, bucket] of requestCounts) if (bucket.resetAt <= current) requestCounts.delete(key)
  }

  function originAllowed(request) {
    const origin = request.headers.origin
    // Browsers omit Origin on same-origin GETs; Sec-Fetch-Site distinguishes those from a
    // cross-origin read while still requiring an Origin value for state-changing requests.
    if (typeof origin !== 'string') return request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin'
    if (externalOrigin && isExternalProxyRequest(request, externalOrigin)) return true
    const protocol = request.socket.encrypted ? 'https:' : 'http:'
    const host = request.headers.host
    if (typeof host !== 'string' || host.length > 255) return false
    try {
      const expected = new URL(`${protocol}//${host}`).origin
      return new URL(origin).origin === origin && origin === expected
    } catch {
      return false
    }
  }

  function rateAllowed(request, key, limit) {
    const current = now()
    const address = request.socket.remoteAddress || 'unknown'
    const bucketKey = `${address}:${key}`
    let bucket = requestCounts.get(bucketKey)
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + 60_000 }
      requestCounts.set(bucketKey, bucket)
    }
    bucket.count += 1
    if (requestCounts.size > 512) {
      prune()
      while (requestCounts.size > 512) requestCounts.delete(requestCounts.keys().next().value)
    }
    return bucket.count <= limit ? undefined : Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))
  }

  async function handleApi(request, response, pathname) {
    prune()
    if (!originAllowed(request)) {
      drainAndError(request, response, 403, 'ORIGIN_DENIED', 'Requests to the satellite API must come from this server origin.', responseHeaders)
      return
    }

    const limits = {
      'POST /api/satellite/sessions': 10,
      'GET /api/satellite/session': 180,
      'POST /api/satellite/join': 20,
      'POST /api/satellite/captures': 30,
      'POST /api/satellite/batches': 12,
      'DELETE /api/satellite/session': 20,
    }
    const routeKey = `${request.method} ${pathname}`
    const limit = limits[routeKey]
    if (!limit) {
      drainAndError(request, response, request.method === 'OPTIONS' ? 405 : 404, 'UNSUPPORTED_API_ROUTE', 'This satellite API route is not supported.', responseHeaders, request.method === 'OPTIONS' ? { Allow: 'GET, POST, DELETE' } : {})
      return
    }
    const retryAfter = rateAllowed(request, routeKey, limit)
    if (retryAfter) {
      drainAndError(request, response, 429, 'RATE_LIMITED', 'Too many requests. Wait before trying again.', responseHeaders, { 'Retry-After': String(retryAfter) })
      return
    }

    if (routeKey === 'POST /api/satellite/sessions') {
      const parsed = await readJson(request, 1024)
      if (parsed.error) return errorJson(response, parsed.error.status, parsed.error.code, parsed.error.message, responseHeaders)
      prune()
      if (sessions.size >= SATELLITE_LIMITS.maxSessions) return errorJson(response, 503, 'SESSION_CAPACITY', 'The relay is at its 32-session limit. Try again after a session expires.', responseHeaders)
      const token = tokenFactory()
      const expiresAtMs = now() + SATELLITE_LIMITS.sessionLifetimeMs
      sessions.set(token, { expiresAtMs, joined: false, deviceLabel: '', captures: [], captureIds: new Set(), batches: [], batchIds: new Map(), uploadCount: 0, archiveId: randomUUID(), archiveTransaction: Promise.resolve() })
      return sendJson(response, 201, { token, expiresAt: new Date(expiresAtMs).toISOString(), suggestedOrigins: suggestedOrigins(request, externalOrigin) }, responseHeaders)
    }

    const token = bearerToken(request)
    if (!token) return drainAndError(request, response, 401, 'TOKEN_REQUIRED', 'Provide the session token as a Bearer authorization value.', responseHeaders)
    const session = sessions.get(token)
    if (!session) {
      if (expiredTokens.has(token)) return drainAndError(request, response, 410, 'SESSION_EXPIRED', 'This satellite session has expired. Create a new session to continue.', responseHeaders)
      return drainAndError(request, response, 404, 'SESSION_NOT_FOUND', 'This satellite session does not exist.', responseHeaders)
    }
    if (session.expiresAtMs <= now()) {
      sessions.delete(token)
      return drainAndError(request, response, 410, 'SESSION_EXPIRED', 'This satellite session has expired. Create a new session to continue.', responseHeaders)
    }

    if (routeKey === 'GET /api/satellite/session') {
      return sendJson(response, 200, {
        expiresAt: new Date(session.expiresAtMs).toISOString(),
        joined: session.joined,
        deviceLabel: session.deviceLabel,
        captures: session.captures,
        batches: session.batches,
      }, responseHeaders)
    }
    if (routeKey === 'DELETE /api/satellite/session') {
      const hasBody = Number(request.headers['content-length'] || 0) > 0 || Boolean(request.headers['transfer-encoding'])
      request.resume()
      if (hasBody) return errorJson(response, 400, 'UNEXPECTED_BODY', 'DELETE session requests do not accept a request body.', responseHeaders)
      sessions.delete(token)
      return sendJson(response, 200, { deleted: true }, responseHeaders)
    }

    const parsed = await readJson(request, routeKey === 'POST /api/satellite/captures' ? 720 * 1024 : routeKey === 'POST /api/satellite/batches' ? 4 * 1024 * 1024 : 4096)
    if (parsed.error) return errorJson(response, parsed.error.status, parsed.error.code, parsed.error.message, responseHeaders)
    if (routeKey === 'POST /api/satellite/join') {
      const label = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? parsed.value.deviceLabel : undefined
      if (typeof label !== 'string' || label.trim().length === 0 || label.length > SATELLITE_LIMITS.maxLabelLength || /[\u0000-\u001f\u007f]/.test(label)) {
        return errorJson(response, 400, 'INVALID_DEVICE_LABEL', 'deviceLabel must contain 1–80 printable characters.', responseHeaders)
      }
      session.joined = true
      session.deviceLabel = label.trim()
      return sendJson(response, 200, { joined: true, deviceLabel: session.deviceLabel, expiresAt: new Date(session.expiresAtMs).toISOString() }, responseHeaders)
    }

    if (routeKey === 'POST /api/satellite/batches') {
      const body = parsed.value
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'batch') || !Object.hasOwn(body, 'captures') || !Array.isArray(body.captures) || body.captures.length > 5) {
        return errorJson(response, 400, 'INVALID_BATCH', 'Batch request must contain exactly batch and a captures array with at most five items.', responseHeaders)
      }
      const validatedCaptures = []
      const incomingIds = new Set()
      for (const captureInput of body.captures) {
        const allowedCaptureKeys = ['id', 'capturedAt', 'position', 'sampleRate', 'pcm16Base64', 'durationMs', 'deviceLabel', 'captureBackend', 'signal', 'acquisition']
        if (!captureInput || typeof captureInput !== 'object' || Array.isArray(captureInput) || Object.keys(captureInput).some(key => !allowedCaptureKeys.includes(key)) || !captureInput.position || typeof captureInput.position !== 'object' || Array.isArray(captureInput.position) || Object.keys(captureInput.position).some(key => !['xM', 'yM'].includes(key))) {
          return errorJson(response, 400, 'INVALID_BATCH', 'Batch captures contain unsupported fields.', responseHeaders)
        }
        const validated = validateSatelliteCapture(captureInput)
        if (!validated.ok) return errorJson(response, 400, 'INVALID_BATCH', `Batch capture is invalid: ${validated.reason}`, responseHeaders)
        if (incomingIds.has(validated.value.id)) return errorJson(response, 400, 'INVALID_BATCH', 'Batch captures must have distinct ids.', responseHeaders)
        incomingIds.add(validated.value.id)
        validatedCaptures.push(validated.value)
      }
      const validatedBatch = validateProbeBatch(body.batch, validatedCaptures)
      if (!validatedBatch.ok) return errorJson(response, 400, 'INVALID_BATCH', validatedBatch.reason, responseHeaders)
      const referencedIds = validatedBatch.value.attempts.filter(attempt => attempt.status === 'captured').map(attempt => attempt.captureId)
      if (referencedIds.length !== validatedCaptures.length || referencedIds.some(id => !incomingIds.has(id))) return errorJson(response, 400, 'INVALID_BATCH', 'Batch must reference every supplied capture exactly once.', responseHeaders)
      const existingBatch = session.batchIds.get(validatedBatch.value.id)
      if (existingBatch) {
        const canonicalCaptures = [...validatedCaptures].sort((a, b) => a.id.localeCompare(b.id))
        if (existingBatch.signature === JSON.stringify({ batch: validatedBatch.value, captures: canonicalCaptures })) {
          return sendJson(response, 200, { batch: existingBatch.batch, captures: existingBatch.captures }, responseHeaders)
        }
        return errorJson(response, 409, 'DUPLICATE_BATCH', 'This batch id was already accepted with different data.', responseHeaders)
      }
      if (referencedIds.some(id => session.captureIds.has(id))) return errorJson(response, 409, 'DUPLICATE_CAPTURE', 'A capture id was already accepted in this session.', responseHeaders)
      if (session.uploadCount + validatedCaptures.length > SATELLITE_LIMITS.maxSessionUploads) return errorJson(response, 429, 'SESSION_UPLOAD_LIMIT', 'This session has reached its 1024 accepted-capture limit.', responseHeaders)
      if (session.captures.length + validatedCaptures.length > SATELLITE_LIMITS.maxCaptures || session.batches.length >= SATELLITE_LIMITS.maxBatches) return errorJson(response, 409, 'SESSION_FULL', 'This session has reached its 12-capture or 12-batch limit.', responseHeaders)
      const batch = validatedBatch.value
      const canonicalCaptures = [...validatedCaptures].sort((a, b) => a.id.localeCompare(b.id))
      const signature = JSON.stringify({ batch, captures: canonicalCaptures })
      const commit = () => {
        const racedBatch = session.batchIds.get(batch.id)
        if (racedBatch) return racedBatch.signature === signature
          ? sendJson(response, 200, { batch: racedBatch.batch, captures: racedBatch.captures }, responseHeaders)
          : errorJson(response, 409, 'DUPLICATE_BATCH', 'This batch id was already accepted with different data.', responseHeaders)
        if (referencedIds.some(id => session.captureIds.has(id))) return errorJson(response, 409, 'DUPLICATE_CAPTURE', 'A capture id was already accepted in this session.', responseHeaders)
        if (session.uploadCount + validatedCaptures.length > SATELLITE_LIMITS.maxSessionUploads) return errorJson(response, 429, 'SESSION_UPLOAD_LIMIT', 'This session has reached its 1024 accepted-capture limit.', responseHeaders)
        if (session.captures.length + validatedCaptures.length > SATELLITE_LIMITS.maxCaptures || session.batches.length >= SATELLITE_LIMITS.maxBatches) return errorJson(response, 409, 'SESSION_FULL', 'This session has reached its 12-capture or 12-batch limit.', responseHeaders)
        for (const capture of validatedCaptures) session.captureIds.add(capture.id)
        session.uploadCount += validatedCaptures.length
        session.captures.push(...validatedCaptures)
        session.batches.push(batch)
        session.batchIds.set(batch.id, { batch, captures: validatedCaptures, signature })
        if (!session.joined) { session.joined = true; session.deviceLabel = validatedCaptures.find(capture => capture.deviceLabel)?.deviceLabel || 'Phone' }
        return sendJson(response, 201, { batch, captures: validatedCaptures }, responseHeaders)
      }
      if (!ownerApi) return commit()
      if (session.batchIds.has(batch.id) || referencedIds.some(id => session.captureIds.has(id)) || session.uploadCount + validatedCaptures.length > SATELLITE_LIMITS.maxSessionUploads || session.captures.length + validatedCaptures.length > SATELLITE_LIMITS.maxCaptures || session.batches.length >= SATELLITE_LIMITS.maxBatches) return commit()
      try { return await commitArchived(session, () => session.batchIds.has(batch.id) || referencedIds.some(id => session.captureIds.has(id)) || session.uploadCount + validatedCaptures.length > SATELLITE_LIMITS.maxSessionUploads || session.captures.length + validatedCaptures.length > SATELLITE_LIMITS.maxCaptures || session.batches.length >= SATELLITE_LIMITS.maxBatches ? undefined : { recordings: [...session.captures, ...validatedCaptures], batches: [...session.batches, batch] }, commit) }
      catch { return errorJson(response, 503, 'ARCHIVE_WRITE_FAILED', 'The owner archive could not be saved. Retry this upload.', responseHeaders) }
    }

    const validated = validateSatelliteCapture(parsed.value)
    if (!validated.ok) return errorJson(response, 400, 'INVALID_CAPTURE', validated.reason, responseHeaders)
    if (session.captureIds.has(validated.value.id)) return errorJson(response, 409, 'DUPLICATE_CAPTURE', 'This capture id was already accepted in this session.', responseHeaders)
    if (session.uploadCount >= SATELLITE_LIMITS.maxSessionUploads) return errorJson(response, 429, 'SESSION_UPLOAD_LIMIT', 'This session has reached its 1024 accepted-capture limit.', responseHeaders)
    if (session.captures.length >= SATELLITE_LIMITS.maxCaptures) return errorJson(response, 409, 'SESSION_FULL', 'This session has reached its 12-capture limit.', responseHeaders)
    const commit = () => {
      if (session.captureIds.has(validated.value.id)) return errorJson(response, 409, 'DUPLICATE_CAPTURE', 'This capture id was already accepted in this session.', responseHeaders)
      if (session.uploadCount >= SATELLITE_LIMITS.maxSessionUploads) return errorJson(response, 429, 'SESSION_UPLOAD_LIMIT', 'This session has reached its 1024 accepted-capture limit.', responseHeaders)
      if (session.captures.length >= SATELLITE_LIMITS.maxCaptures) return errorJson(response, 409, 'SESSION_FULL', 'This session has reached its 12-capture limit.', responseHeaders)
      session.captureIds.add(validated.value.id); session.uploadCount += 1; session.captures.push(validated.value)
      if (!session.joined) { session.joined = true; session.deviceLabel = validated.value.deviceLabel || 'Phone' }
      return sendJson(response, 201, { capture: validated.value }, responseHeaders)
    }
    if (!ownerApi) return commit()
    if (session.captureIds.has(validated.value.id) || session.uploadCount >= SATELLITE_LIMITS.maxSessionUploads || session.captures.length >= SATELLITE_LIMITS.maxCaptures) return commit()
    try { return await commitArchived(session, () => session.captureIds.has(validated.value.id) || session.uploadCount >= SATELLITE_LIMITS.maxSessionUploads || session.captures.length >= SATELLITE_LIMITS.maxCaptures ? undefined : { recordings: [...session.captures, validated.value], batches: session.batches }, commit) }
    catch { return errorJson(response, 503, 'ARCHIVE_WRITE_FAILED', 'The owner archive could not be saved. Retry this upload.', responseHeaders) }
  }

  const handleRequest = async (request, response) => {
    response.req = request
    const target = request.url ?? ''
    const queryIndex = target.indexOf('?')
    const rawPath = (queryIndex < 0 ? target : target.slice(0, queryIndex)) || '/'
    let pathname
    try {
      if (!rawPath.startsWith('/') || rawPath.startsWith('//')) throw new URIError('Invalid request target')
      pathname = decodeURIComponent(rawPath)
    } catch {
      return send(response, 400, responseHeaders, 'Bad request')
    }
    if (pathname.startsWith('/api/')) return handleApi(request, response, pathname)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      request.resume()
      return send(response, 405, { ...responseHeaders, Allow: 'GET, HEAD' }, 'Method not allowed')
    }

    const segments = pathname.split('/')
    if (pathname.includes('\\') || pathname.includes('\0') || segments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) {
      return send(response, 400, responseHeaders, 'Bad request')
    }
    let filePath = resolve(safeRoot, `.${pathname}`)
    if (filePath !== safeRoot && !filePath.startsWith(`${safeRoot}${sep}`)) return send(response, 400, responseHeaders, 'Bad request')
    try {
      if (filePath === resolve(safeRoot, '_headers')) throw new Error('Not found')
      const actualPath = await realpath(filePath)
      if (actualPath !== safeRoot && !actualPath.startsWith(`${safeRoot}${sep}`)) return send(response, 404, responseHeaders, 'Not found')
      if ((await stat(actualPath)).isDirectory()) filePath = resolve(actualPath, 'index.html')
      else filePath = actualPath
      const finalPath = await realpath(filePath)
      if (finalPath !== safeRoot && !finalPath.startsWith(`${safeRoot}${sep}`)) return send(response, 404, responseHeaders, 'Not found')
      const data = await readFile(finalPath)
      response.writeHead(200, {
        ...responseHeaders,
        'Content-Type': mime[extname(finalPath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
      })
      response.end(request.method === 'HEAD' ? undefined : data)
    } catch {
      send(response, 404, responseHeaders, 'Not found')
    }
  }

  const handler = (request, response) => {
    void handleRequest(request, response).catch(() => {
      if (response.destroyed) return
      if (response.headersSent) response.destroy()
      else errorJson(response, 400, 'REQUEST_FAILED', 'The request could not be completed.', responseHeaders)
    })
  }

  const server = tls
    ? createHttpsServer(tls, handler)
    : createHttpServer(handler)
  server.requestTimeout = 30_000
  if (ownerApi) server.localScanApi = ownerApi
  let pruningTimer
  server.on('listening', () => {
    if (pruningTimer) clearInterval(pruningTimer)
    pruningTimer = setInterval(prune, 60_000)
    pruningTimer.unref?.()
  })
  server.on('close', () => {
    if (pruningTimer) clearInterval(pruningTimer)
    if (ownerApi?.server.listening) ownerApi.server.close()
    sessions.clear()
    expiredTokens.clear()
    requestCounts.clear()
  })
  return server
}

export function parseArgs(args) {
  const options = { host: '127.0.0.1', port: 4174 }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--host' || arg === '--port' || arg === '--cert' || arg === '--key' || arg === '--external-origin' || arg === '--local-api-port' || arg === '--local-api-key-file' || arg === '--capture-dir') {
      const value = args[++index]
      if (!value) throw new Error(`${arg} requires a value.`)
      if (arg === '--host') options.host = value
      if (arg === '--port') options.port = Number(value)
      if (arg === '--cert') options.certPath = value
      if (arg === '--key') options.keyPath = value
      if (arg === '--external-origin') options.externalOrigin = validateExternalOrigin(value)
      if (arg === '--local-api-port') options.localApiPort = Number(value)
      if (arg === '--local-api-key-file') options.localApiKeyFile = resolve(value)
      if (arg === '--capture-dir') options.captureDir = resolve(value)
    } else throw new Error(`Unsupported argument: ${arg}`)
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 through 65535.')
  if (Boolean(options.certPath) !== Boolean(options.keyPath)) throw new Error('Provide both --cert and --key to enable HTTPS.')
  const localOptions = [options.localApiPort, options.localApiKeyFile, options.captureDir]
  if (localOptions.some(value => value !== undefined) && localOptions.some(value => value === undefined)) throw new Error('Provide --local-api-port, --local-api-key-file, and --capture-dir together.')
  if (options.localApiPort !== undefined && (!Number.isInteger(options.localApiPort) || options.localApiPort < 1 || options.localApiPort > 65535 || options.localApiPort === options.port)) throw new Error('--local-api-port must be a port from 1 through 65535, different from --port.')
  return options
}

const ownPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const tls = options.certPath ? { cert: await readFile(resolve(options.certPath)), key: await readFile(resolve(options.keyPath)) } : undefined
    const server = await createSatelliteServer({ tls, externalOrigin: options.externalOrigin, ...(options.localApiPort === undefined ? {} : { localApi: { port: options.localApiPort, keyFile: options.localApiKeyFile, captureDir: options.captureDir } }) })
    server.on('close', () => { if (server.localScanApi?.server.listening) server.localScanApi.server.close() })
    process.once('SIGINT', () => { server.close(); if (server.localScanApi?.server.listening) server.localScanApi.server.close() })
    process.once('SIGTERM', () => { server.close(); if (server.localScanApi?.server.listening) server.localScanApi.server.close() })
    if (server.localScanApi) server.localScanApi.server.listen(options.localApiPort, '127.0.0.1', () => console.log(`Owner scan API bound on 127.0.0.1:${options.localApiPort}`))
    server.listen(options.port, options.host, () => {
      const scheme = tls ? 'https' : 'http'
      console.log(`Cha Waves phone satellite bound on ${options.host}:${options.port}`)
      if (options.host === '0.0.0.0' || options.host === '::') {
        const lanOrigins = privateLanAddresses().map(address => `${scheme}://${address}:${options.port}`)
        if (lanOrigins.length) console.log(`LAN origins: ${lanOrigins.join('  ')}`)
      } else {
        console.log(`Open on this device: ${scheme}://${options.host}:${options.port}`)
      }
      if (!tls) console.log('Phone recording: use trusted HTTPS on the LAN, or Android USB with bun run satellite:android and the same port.')
      if (options.externalOrigin) console.log(`Trusted external HTTPS origin: ${options.externalOrigin} (requests are accepted through a loopback proxy only).`)
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
