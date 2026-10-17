#!/usr/bin/env node
import * as http from 'node:http'
import * as https from 'node:https'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const DEFAULT_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000
export const SATELLITE_DOCTOR_MAX_BODY_BYTES = 512 * 1024

export function parseDoctorArgs(args) {
  const options = { origin: undefined, timeoutMs: DEFAULT_TIMEOUT_MS, json: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--json') options.json = true
    else if (arg === '--origin' || arg === '--timeout-ms') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`)
      if (arg === '--origin') options.origin = validateOrigin(value)
      else options.timeoutMs = Number(value)
    } else throw new Error('Unsupported argument. Use --help for usage.')
  }
  if (!options.help && !options.origin) throw new Error('Provide the target URL with --origin.')
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be an integer from 100 through ${MAX_TIMEOUT_MS}.`)
  }
  return options
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  const octets = host.split('.').map(Number)
  return octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127
}

export function validateOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('--origin must be a canonical HTTP or HTTPS origin.') }
  const canonicalRoot = value === url.origin || value === `${url.origin}/`
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !canonicalRoot) {
    throw new Error('--origin must be a canonical HTTP or HTTPS root origin without credentials, path, query, or fragment.')
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error('HTTP is allowed only for localhost or a loopback IP. Use HTTPS for network origins.')
  }
  return url.origin
}

function requestOnce(target, { timeoutMs, headers = {} }) {
  const transport = target.protocol === 'https:' ? https : http
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let timer
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const request = transport.request(target, {
      method: 'GET',
      headers,
      // Do not consult HTTP(S)_PROXY environment variables. HTTPS retains Node's
      // normal certificate and hostname verification defaults.
      agent: false,
      ...(target.protocol === 'https:' ? { rejectUnauthorized: true } : {}),
    }, response => {
      void readBoundedBody(response).then(body => {
        finish(resolvePromise, { status: response.statusCode ?? 0, headers: response.headers, ...body })
        if (body.bodyTooLarge) response.destroy()
      }, error => finish(rejectPromise, error))
    })
    timer = setTimeout(() => {
      const error = new Error('Request timed out.')
      error.code = 'ETIMEDOUT'
      finish(rejectPromise, error)
      request.destroy(error)
    }, timeoutMs)
    request.on('error', error => finish(rejectPromise, error))
    request.end()
  })
}

export async function readBoundedBody(readable, maxBytes = SATELLITE_DOCTOR_MAX_BODY_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new Error('maxBytes must be a non-negative integer.')
  const chunks = []
  let size = 0
  for await (const chunk of readable) {
    size += chunk.length
    if (size > maxBytes) return { body: '', bodyTooLarge: true }
    chunks.push(Buffer.from(chunk))
  }
  return { body: Buffer.concat(chunks).toString('utf8'), bodyTooLarge: false }
}

function errorSummary(error) {
  if (error?.code === 'ETIMEDOUT') return 'Request timed out.'
  if (error?.code && /CERT|TLS|SSL|VERIFY/i.test(error.code)) {
    return 'TLS certificate verification failed. Check that the origin has a trusted certificate for this hostname.'
  }
  if (error?.code === 'ECONNREFUSED') return 'Connection refused. Check that the satellite server is running on this origin.'
  if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') return 'Origin hostname could not be resolved. Check the URL and network connection.'
  return 'Could not connect to the origin. Check the network and server address.'
}

function inspectApp(response) {
  const contentType = String(response.headers['content-type'] || '')
  const recognized = !response.bodyTooLarge && response.status === 200 && /text\/html/i.test(contentType) &&
    /<html\b/i.test(response.body) && /Cha Waves|Home field study|Echo Lab/i.test(response.body)
  const permissionsPolicy = response.headers['permissions-policy'] || null
  const microphonePolicy = typeof permissionsPolicy === 'string'
    ? (/microphone\s*=\s*\(\)/i.test(permissionsPolicy) ? 'blocked' : /microphone\s*=\s*\(self\)/i.test(permissionsPolicy) ? 'self' : 'unspecified')
    : 'not-provided'
  return {
    status: response.status,
    recognized,
    contentType: contentType || null,
    permissionsPolicy,
    microphonePolicy,
    bodyTooLarge: response.bodyTooLarge,
  }
}

function inspectRelay(response) {
  let payload
  if (!response.bodyTooLarge) {
    try { payload = JSON.parse(response.body) } catch { /* keep response private; status and type suffice */ }
  }
  const available = response.status === 401 && payload?.code === 'TOKEN_REQUIRED'
  return {
    status: response.status,
    available,
    code: payload?.code === 'TOKEN_REQUIRED' ? 'TOKEN_REQUIRED' : null,
    bodyTooLarge: response.bodyTooLarge,
  }
}

/** Probe app and relay endpoints using bounded unauthenticated GET requests only. */
export async function probeSatelliteOrigin(origin, { timeoutMs = DEFAULT_TIMEOUT_MS, requestImpl = requestOnce } = {}) {
  const safeOrigin = validateOrigin(origin)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) throw new Error(`timeoutMs must be an integer from 100 through ${MAX_TIMEOUT_MS}.`)
  const target = new URL(safeOrigin)
  const deadline = Date.now() + timeoutMs
  const diagnostics = []
  const secureContext = target.protocol === 'https:' || isLoopback(target.hostname)
  const result = {
    origin: safeOrigin,
    secureContext: {
      originIsSecureContextCandidate: secureContext,
      note: secureContext
        ? 'The origin is potentially eligible for a secure context; actual phone browser permission is not tested.'
        : 'This origin is not a secure context candidate for microphone access.',
    },
    app: null,
    relay: null,
    diagnostics,
    ok: false,
  }

  let appResponse
  try {
    appResponse = await requestImpl(new URL('/', safeOrigin), { timeoutMs: Math.max(1, deadline - Date.now()) })
    result.app = inspectApp(appResponse)
    if (!result.app.recognized) diagnostics.push('The origin did not return a recognizable Cha Waves HTML app. Check the static build and origin.')
    if (result.app.microphonePolicy === 'blocked') diagnostics.push('The app response Permissions-Policy disables microphone access; use the satellite relay server response headers.')
  } catch (error) {
    result.app = { status: null, recognized: false, error: errorSummary(error) }
    diagnostics.push(result.app.error)
  }

  try {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw Object.assign(new Error('Request timed out.'), { code: 'ETIMEDOUT' })
    const relayResponse = await requestImpl(new URL('/api/satellite/session', safeOrigin), {
      timeoutMs: remaining,
      headers: { Origin: safeOrigin, Accept: 'application/json' },
    })
    result.relay = inspectRelay(relayResponse)
    if (!result.relay.available) {
      if (relayResponse.status === 404 || (relayResponse.status === 200 && /text\/html/i.test(String(relayResponse.headers['content-type'] || '')))) {
        diagnostics.push('The satellite API is unavailable; this may be the static preview server. Start scripts/satellite-server.mjs for phone pairing.')
      } else diagnostics.push('The unauthenticated satellite session endpoint did not return the expected TOKEN_REQUIRED response.')
    }
  } catch (error) {
    result.relay = { status: null, available: false, error: errorSummary(error) }
    diagnostics.push(result.relay.error)
  }

  result.ok = Boolean(result.app?.recognized && result.app?.microphonePolicy !== 'blocked' && result.relay?.available)
  return result
}

export const DOCTOR_HELP = `Usage: node scripts/satellite-doctor.mjs --origin https://host [--timeout-ms 5000] [--json]

Read-only diagnostics for the app and satellite API. HTTPS is recommended for phone microphone access.
HTTP origins are accepted only for localhost and loopback IP addresses.
`

const ownPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  try {
    const options = parseDoctorArgs(process.argv.slice(2))
    if (options.help) console.log(DOCTOR_HELP)
    else {
      const result = await probeSatelliteOrigin(options.origin, { timeoutMs: options.timeoutMs })
      if (options.json) console.log(JSON.stringify(result, null, 2))
      else {
        console.log(`Origin: ${result.origin}`)
        console.log(`App: ${result.app?.recognized ? 'recognized' : `unavailable (HTTP ${result.app?.status ?? 'network error'})`}`)
        console.log(`Satellite API: ${result.relay?.available ? 'available' : `unavailable (HTTP ${result.relay?.status ?? 'network error'})`}`)
        console.log(`Secure-context candidate: ${result.secureContext.originIsSecureContextCandidate ? 'yes' : 'no'} (phone microphone permission is not tested)`)
        for (const diagnostic of result.diagnostics) console.log(`- ${diagnostic}`)
      }
      if (!result.ok) process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
