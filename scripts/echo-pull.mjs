import { request as requestHttp } from 'node:http'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { open, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ECHO_SCAN_MAX_BYTES, parseEchoScan } from '../packages/echo-scan.ts'

const SCAN_ID = /^[A-Za-z0-9_-]{1,128}$/
const HASH = /^[a-f0-9]{64}$/
const DEFAULT_ORIGIN = 'http://127.0.0.1:4176'
const DEFAULT_KEY_FILE = 'local-captures/.satellite-owner-key'
export const ECHO_PULL_HELP = `Usage: bun run echo:pull -- [--scan <id> --output <path>]

List private local scan snapshots, or save one exact scan for echo:inspect.

  --origin <origin>  Loopback owner API (default: ${DEFAULT_ORIGIN})
  --key-file <path>  Owner key file (default: ${DEFAULT_KEY_FILE})
  --scan <id>        Explicit scan ID from the listing; never silently selects a room
  --output <path>    New output file; existing files are never overwritten
  --help            Show this help

The API must be enabled on the satellite relay. Pairing tokens are not used.
`

export function validateLocalOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('The owner API origin must be a canonical HTTP origin on 127.0.0.1.') }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) {
    throw new Error('The owner API origin must be a canonical HTTP origin on 127.0.0.1.')
  }
  return url.origin
}

export function parseEchoPullArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true }
  const options = { origin: DEFAULT_ORIGIN, keyFile: DEFAULT_KEY_FILE, scanId: undefined, output: undefined }
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (!['--origin', '--key-file', '--scan', '--output'].includes(option) || seen.has(option)) throw new Error('Use each supported option at most once. Run echo:pull --help for usage.')
    seen.add(option)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('Each option requires a value. Run echo:pull --help for usage.')
    if (option === '--origin') options.origin = validateLocalOrigin(value)
    else if (option === '--key-file') options.keyFile = value
    else if (option === '--scan') {
      if (!SCAN_ID.test(value)) throw new Error('The scan ID must contain 1–128 letters, digits, underscores or hyphens.')
      options.scanId = value
    } else options.output = value
  }
  if (Boolean(options.scanId) !== Boolean(options.output)) throw new Error('--scan and --output must be supplied together.')
  return options
}

export async function readLocalApiKey(path) {
  let handle
  try { handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)) }
  catch { throw new Error('Owner key file is unavailable. Enable the local scan API on the relay first.') }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > 512 || (info.mode & 0o777) !== 0o600 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
      throw new Error('Owner key must be a private regular file owned by the current user (mode 0600).')
    }
    const bytes = Buffer.alloc(513)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    const key = bytes.subarray(0, bytesRead).toString('utf8')
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Owner key file has an unsupported format.')
    return key
  } finally {
    await handle.close()
  }
}

/** Direct loopback request: no proxy, redirect, browser credentials or remote origin. */
export async function requestLocalScan({ origin, key, scanId, timeoutMs = 10_000 }) {
  validateLocalOrigin(origin)
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Owner key has an unsupported format.')
  if (scanId !== undefined && !SCAN_ID.test(scanId)) throw new Error('Invalid scan ID.')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('Request timeout is outside supported bounds.')
  const path = scanId === undefined ? '/v1/scans' : `/v1/scans/${scanId}`
  const maximum = scanId === undefined ? 64 * 1024 : ECHO_SCAN_MAX_BYTES
  return new Promise((accept, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else accept(value)
    }
    const request = requestHttp(new URL(path, origin), { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }, response => {
      const chunks = []
      let length = 0
      if (response.statusCode !== 200) {
        response.resume()
        request.destroy()
        finish(new Error(`Local scan API returned HTTP ${response.statusCode}. No scan was saved.`))
        return
      }
      response.on('data', chunk => {
        length += chunk.length
        if (length > maximum) { request.destroy(); finish(new Error('Local scan API response exceeded its size limit.')) }
        else chunks.push(chunk)
      })
      response.on('error', () => finish(new Error('Local scan API response was interrupted.')))
      response.on('end', () => finish(undefined, { bytes: Buffer.concat(chunks), etag: response.headers.etag }))
    })
    const timer = setTimeout(() => { request.destroy(); finish(new Error('Local scan API request timed out.')) }, timeoutMs)
    request.on('error', () => finish(new Error('Could not reach the local scan API. Check that the relay and owner API are running.')))
    request.end()
  })
}

export function validateScanListing(bytes) {
  let input
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('Local scan listing is not valid JSON.') }
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  if (!exact(input, ['format', 'scans']) || input.format !== 'cha-echo-local-scans-v1' || !Array.isArray(input.scans) || input.scans.length > 100) throw new Error('Local scan listing has an unsupported format.')
  const ids = new Set()
  for (const scan of input.scans) {
    if (!exact(scan, ['id', 'sha256', 'byteLength', 'recordingCount', 'batchCount', 'firstCapturedAt', 'lastCapturedAt']) || typeof scan.id !== 'string' || !SCAN_ID.test(scan.id) || ids.has(scan.id) || typeof scan.sha256 !== 'string' || !HASH.test(scan.sha256)
      || !Number.isSafeInteger(scan.byteLength) || scan.byteLength < 1 || scan.byteLength > ECHO_SCAN_MAX_BYTES
      || !Number.isInteger(scan.recordingCount) || scan.recordingCount < 0 || scan.recordingCount > 12
      || !Number.isInteger(scan.batchCount) || scan.batchCount < 0 || scan.batchCount > 12
      || [scan.firstCapturedAt, scan.lastCapturedAt].some(time => time !== null && (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(time) || !Number.isFinite(Date.parse(time))))) {
      throw new Error('Local scan listing contains invalid metadata.')
    }
    ids.add(scan.id)
  }
  return input
}

export async function pullEchoScan(options) {
  const key = await readLocalApiKey(options.keyFile)
  const response = await requestLocalScan({ origin: options.origin, key, scanId: options.scanId })
  if (options.scanId === undefined) return validateScanListing(response.bytes)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)
  const parsed = parseEchoScan(text).document
  if (parsed.mode !== 'recorded') throw new Error('The owner API returned a synthetic scan; no file was saved.')
  const sha256 = createHash('sha256').update(response.bytes).digest('hex')
  if (response.etag !== `"${sha256}"`) throw new Error('The downloaded scan hash did not match its API ETag; no file was saved.')
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  try { await writeFile(output, response.bytes, { flag: 'wx', mode: 0o600 }) }
  catch (cause) { if (cause?.code === 'EEXIST') throw new Error('Output already exists. Choose a new filename to preserve the original.'); throw new Error('The downloaded scan could not be saved.') }
  return { scanId: options.scanId, sha256, byteLength: response.bytes.byteLength, output, recordingCount: parsed.recordings.length, batchCount: parsed.batches?.length ?? 0 }
}

export async function runEchoPull(argv = process.argv.slice(2)) {
  const options = parseEchoPullArguments(argv)
  if (options.help) { process.stdout.write(ECHO_PULL_HELP); return }
  process.stdout.write(`${JSON.stringify(await pullEchoScan(options), null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEchoPull().catch(error => { process.stderr.write(`echo:pull: ${error instanceof Error ? error.message : 'Local retrieval failed.'}\n`); process.exitCode = 1 })
}
