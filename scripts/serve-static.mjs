import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateHostingHeaders } from './static-security.mjs'

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)))
const configuredRoot = resolve(scriptDirectory, '../apps/web/.output/public')
const port = Number(process.env.PORT || 4173)
const mime = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function send(response, status, headers, body = '') {
  const content = Buffer.from(body)
  response.writeHead(status, {
    ...headers,
    'Content-Length': content.length,
  })
  response.end(response.req?.method === 'HEAD' ? undefined : content)
}

async function main() {
  const root = await realpath(configuredRoot)
  const { headers: security } = await generateHostingHeaders(root)
  const responseHeaders = { ...security, 'Cache-Control': 'no-store' }

  createServer(async (request, response) => {
    response.req = request

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, { ...responseHeaders, Allow: 'GET, HEAD' }, 'Method not allowed')
      return
    }

    const target = request.url ?? ''
    const queryIndex = target.indexOf('?')
    const rawPath = (queryIndex < 0 ? target : target.slice(0, queryIndex)) || '/'
    let pathname

    try {
      if (!rawPath.startsWith('/') || rawPath.startsWith('//')) throw new URIError('Invalid request target')
      pathname = decodeURIComponent(rawPath)
    } catch {
      send(response, 400, responseHeaders, 'Bad request')
      return
    }

    const segments = pathname.split('/')
    if (
      pathname.includes('\\') || pathname.includes('\0') ||
      segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))
    ) {
      send(response, 400, responseHeaders, 'Bad request')
      return
    }

    let filePath = resolve(root, `.${pathname}`)
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      send(response, 400, responseHeaders, 'Bad request')
      return
    }

    try {
      // Hosting metadata is build configuration, not a downloadable site asset.
      if (filePath === resolve(root, '_headers')) throw new Error('Not found')

      const actualPath = await realpath(filePath)
      if (actualPath !== root && !actualPath.startsWith(`${root}${sep}`)) {
        send(response, 404, responseHeaders, 'Not found')
        return
      }

      if ((await stat(actualPath)).isDirectory()) filePath = resolve(actualPath, 'index.html')
      else filePath = actualPath

      const finalPath = await realpath(filePath)
      if (finalPath !== root && !finalPath.startsWith(`${root}${sep}`)) {
        send(response, 404, responseHeaders, 'Not found')
        return
      }

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
  }).listen(port, '127.0.0.1', () => console.log(`Cha Waves static preview: http://127.0.0.1:${port}`))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
