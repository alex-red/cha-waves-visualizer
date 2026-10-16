import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerTemplatePath = resolve(scriptDirectory, 'offline-worker.js')
const offlineHeaderRules = [
  '/sw.js',
  '  Cache-Control: no-store',
  '/offline-build.json',
  '  Cache-Control: no-store',
  '',
].join('\n')

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    if (entry.isFile()) return [path]
    return []
  }))
  return nested.flat().sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

function isPrecacheAsset(path, publicDirectory) {
  const urlPath = `/${relative(publicDirectory, path).split(sep).join('/')}`
  const basename = urlPath.slice(urlPath.lastIndexOf('/') + 1)
  if (urlPath === '/_headers' || urlPath === '/sw.js' || urlPath === '/offline-build.json') return false
  if (basename.endsWith('.map')) return false
  if (urlPath === '/200.html' || urlPath === '/404.html') return false
  return true
}

async function getPrecacheAssets(publicDirectory) {
  const files = await listFiles(publicDirectory)
  const paths = files.filter((path) => isPrecacheAsset(path, publicDirectory))
  if (!paths.some((path) => relative(publicDirectory, path).split(sep).join('/') === 'index.html')) {
    throw new Error(`Generated app entry point is missing: ${resolve(publicDirectory, 'index.html')}`)
  }

  return Promise.all(paths.map(async (path) => {
    const bytes = await readFile(path)
    return {
      url: `/${relative(publicDirectory, path).split(sep).map(encodeURIComponent).join('/')}`,
      sha256: sha256Hex(bytes),
      bytes,
      size: bytes.byteLength,
    }
  }))
}

function hashBuild(assets, workerTemplate, headers) {
  const hash = createHash('sha256')
  for (const asset of assets) {
    const urlBytes = Buffer.from(asset.url, 'utf8')
    hash.update(String(urlBytes.byteLength)).update('\0').update(urlBytes)
    hash.update(String(asset.bytes.byteLength)).update('\0').update(asset.bytes)
  }
  hash.update(String(workerTemplate.byteLength)).update('\0').update(workerTemplate)
  hash.update(String(headers.byteLength)).update('\0').update(headers)
  return hash.digest('hex')
}

async function expectedFiles(publicDirectory, command) {
  const headersPath = resolve(publicDirectory, '_headers')
  const existingHeaders = await readFile(headersPath)
  let headersText = existingHeaders.toString('utf8')
  const hasOfflineHeaders = headersText.endsWith(offlineHeaderRules)
  if (command === 'verify' && !hasOfflineHeaders) {
    throw new Error(`Offline cache headers are missing from ${headersPath}`)
  }
  if (hasOfflineHeaders) headersText = headersText.slice(0, -offlineHeaderRules.length)
  const finalHeadersText = `${headersText.replace(/\n*$/, '\n')}${offlineHeaderRules}`
  const finalHeaders = Buffer.from(finalHeadersText, 'utf8')
  const assets = await getPrecacheAssets(publicDirectory)
  const workerTemplate = await readFile(workerTemplatePath)
  const version = hashBuild(assets, workerTemplate, finalHeaders)
  const metadata = {
    version,
    assetCount: assets.length,
    totalBytes: assets.reduce((total, asset) => total + asset.size, 0),
  }
  const precache = assets.map(({ url, sha256 }) => ({ url, sha256 }))
  const workerText = workerTemplate.toString('utf8')
    .replaceAll('__OFFLINE_VERSION__', version)
    .replace('__OFFLINE_ASSET_COUNT__', String(metadata.assetCount))
    .replace('__OFFLINE_TOTAL_BYTES__', String(metadata.totalBytes))
    .replace('__OFFLINE_PRECACHE__', JSON.stringify(precache))

  if (workerText.includes('__OFFLINE_')) throw new Error('Offline worker template contains an unexpanded placeholder')

  return {
    headersPath,
    headers: finalHeaders,
    workerPath: resolve(publicDirectory, 'sw.js'),
    worker: Buffer.from(workerText, 'utf8'),
    metadataPath: resolve(publicDirectory, 'offline-build.json'),
    metadata: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
    metadataValue: metadata,
  }
}

export async function generateOfflineBuild(publicDirectory) {
  const expected = await expectedFiles(publicDirectory, 'generate')
  await writeFile(expected.headersPath, expected.headers)
  await writeFile(expected.workerPath, expected.worker)
  await writeFile(expected.metadataPath, expected.metadata)
  return expected.metadataValue
}

export async function verifyOfflineBuild(publicDirectory) {
  const expected = await expectedFiles(publicDirectory, 'verify')
  const [headers, worker, metadata] = await Promise.all([
    readFile(expected.headersPath),
    readFile(expected.workerPath),
    readFile(expected.metadataPath),
  ])
  for (const [path, actual, wanted] of [
    [expected.headersPath, headers, expected.headers],
    [expected.workerPath, worker, expected.worker],
    [expected.metadataPath, metadata, expected.metadata],
  ]) {
    if (!actual.equals(wanted)) throw new Error(`Generated offline artifact is missing or stale: ${path}`)
  }
  return expected.metadataValue
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
        ? await verifyOfflineBuild(publicDirectory)
        : await generateOfflineBuild(publicDirectory)
      console.log(`${command === 'verify' ? 'Verified' : 'Generated'} offline build ${result.version}: ${result.assetCount} assets, ${result.totalBytes} bytes.`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
