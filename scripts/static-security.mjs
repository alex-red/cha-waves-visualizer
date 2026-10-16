import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const executableScriptTypes = new Set([
  '',
  'module',
  'importmap',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
])

function getAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

export function inlineScriptHashes(html) {
  const hashes = new Set()
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi

  for (const match of html.matchAll(scriptPattern)) {
    const [, attributes, body] = match
    const type = (getAttribute(attributes, 'type') ?? '').trim().toLowerCase()
    if (getAttribute(attributes, 'src') !== null || !executableScriptTypes.has(type)) continue

    const digest = createHash('sha256').update(body, 'utf8').digest('base64')
    hashes.add(`'sha256-${digest}'`)
  }

  return [...hashes].sort()
}

export function contentSecurityPolicy(htmlDocuments) {
  const scriptHashes = [...new Set(htmlDocuments.flatMap(inlineScriptHashes))].sort()
  const scriptSources = ["'self'", ...scriptHashes].join(' ')

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' blob: data:",
  ].join('; ')
}

export function securityHeaders(csp) {
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}

async function expectedHostingHeaders(publicDirectory) {
  const htmlFiles = (await readdir(publicDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => resolve(publicDirectory, entry.name))
    .sort()

  if (htmlFiles.length === 0) {
    throw new Error(`No generated HTML documents found in ${publicDirectory}`)
  }

  const documents = await Promise.all(htmlFiles.map((file) => readFile(file, 'utf8')))
  const csp = contentSecurityPolicy(documents)
  const headers = securityHeaders(csp)
  const output = [
    '/*',
    ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    '/sw.js',
    '  Cache-Control: no-store',
    '/offline-build.json',
    '  Cache-Control: no-store',
    '',
  ].join('\n')

  return { csp, headers, htmlFiles, output }
}

export async function generateHostingHeaders(publicDirectory) {
  const result = await expectedHostingHeaders(publicDirectory)
  await writeFile(resolve(publicDirectory, '_headers'), result.output, 'utf8')
  return result
}

export async function verifyHostingHeaders(publicDirectory) {
  const result = await expectedHostingHeaders(publicDirectory)
  const existing = await readFile(resolve(publicDirectory, '_headers'), 'utf8')
  if (existing !== result.output) {
    throw new Error(`Generated hosting headers are missing or stale: ${resolve(publicDirectory, '_headers')}`)
  }
  return result
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const publicDirectory = resolve(process.argv[3] ?? 'apps/web/.output/public')
  const command = process.argv[2] ?? 'generate'

  if (command !== 'generate' && command !== 'verify') {
    console.error(`Unknown command: ${command}. Use "generate" or "verify".`)
    process.exitCode = 2
  } else {
    try {
      const result = command === 'verify'
        ? await verifyHostingHeaders(publicDirectory)
        : await generateHostingHeaders(publicDirectory)
      console.log(`${command === 'verify' ? 'Verified' : 'Generated'} ${resolve(publicDirectory, '_headers')} from ${result.htmlFiles.length} HTML documents.`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
