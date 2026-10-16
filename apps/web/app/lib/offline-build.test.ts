import { afterEach, describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { generateOfflineBuild, verifyOfflineBuild } from '../../../../scripts/offline-build.mjs'

const tempDirectories: string[] = []

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'cha-offline-test-'))
  tempDirectories.push(root)
  const publicDirectory = resolve(root, 'public')
  await mkdir(resolve(publicDirectory, 'assets'), { recursive: true })
  await writeFile(resolve(publicDirectory, 'index.html'), '<!doctype html><script type="module" src="/assets/app.js"></script>')
  await writeFile(resolve(publicDirectory, '_headers'), '/*\n  X-Frame-Options: DENY\n')
  await writeFile(resolve(publicDirectory, 'assets/app.js'), 'import("./lazy.js"); new Worker("./worker.js");')
  await writeFile(resolve(publicDirectory, 'assets/lazy.js'), 'export const lazy = true')
  await writeFile(resolve(publicDirectory, 'assets/worker.js'), 'self.onmessage = () => {}')
  await writeFile(resolve(publicDirectory, 'assets/app.js.map'), '{"version":3}')
  await writeFile(resolve(publicDirectory, '200.html'), 'hosting fallback')
  return publicDirectory
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('offline build artifacts', () => {
  it('generates deterministic versions and includes lazy chunks and workers while excluding hosting files', async () => {
    const directory = await fixture()
    const first = await generateOfflineBuild(directory)
    const worker = await readFile(resolve(directory, 'sw.js'), 'utf8')
    const second = await generateOfflineBuild(directory)
    const generatedWorker = await readFile(resolve(directory, 'sw.js'), 'utf8')

    expect(second).toEqual(first)
    expect(generatedWorker).toBe(worker)
    expect(worker).toContain('/assets/app.js')
    expect(worker).toContain('/assets/lazy.js')
    expect(worker).toContain('/assets/worker.js')
    expect(worker).not.toContain('app.js.map')
    expect(worker).not.toContain('200.html')
    expect(worker).not.toContain('/_headers')
    expect(worker).not.toContain('/sw.js')
    expect(worker).not.toContain('/offline-build.json')
    expect(first.assetCount).toBe(4)
    expect(first.totalBytes).toBe(Buffer.byteLength(await readFile(resolve(directory, 'index.html'))) +
      Buffer.byteLength('import("./lazy.js"); new Worker("./worker.js");') +
      Buffer.byteLength('export const lazy = true') + Buffer.byteLength('self.onmessage = () => {}'))
    await expect(verifyOfflineBuild(directory)).resolves.toEqual(first)
  })

  it('changes version when an asset or hosting header changes and detects tampered metadata', async () => {
    const directory = await fixture()
    const initial = await generateOfflineBuild(directory)
    await writeFile(resolve(directory, 'assets/lazy.js'), 'export const lazy = false')
    const sourceChanged = await generateOfflineBuild(directory)
    expect(sourceChanged.version).not.toBe(initial.version)

    await writeFile(resolve(directory, '_headers'), '/*\n  X-Frame-Options: SAMEORIGIN\n')
    const headersChanged = await generateOfflineBuild(directory)
    expect(headersChanged.version).not.toBe(sourceChanged.version)

    await writeFile(resolve(directory, 'offline-build.json'), '{"version":"stale","assetCount":0,"totalBytes":0}\n')
    await expect(verifyOfflineBuild(directory)).rejects.toThrow(/missing or stale/)
  })

  it('changes the build version when the worker template changes', async () => {
    const directory = await fixture()
    const scriptDirectory = resolve(tempDirectories[0]!, 'scripts-copy')
    await mkdir(scriptDirectory)
    await copyFile(resolve(process.cwd(), 'scripts/offline-build.mjs'), resolve(scriptDirectory, 'offline-build.mjs'))
    await copyFile(resolve(process.cwd(), 'scripts/offline-worker.js'), resolve(scriptDirectory, 'offline-worker.js'))
    const copiedGenerator = await import(pathToFileURL(resolve(scriptDirectory, 'offline-build.mjs')).href)
    const initial = await copiedGenerator.generateOfflineBuild(directory)
    await writeFile(resolve(scriptDirectory, 'offline-worker.js'), `${await readFile(resolve(scriptDirectory, 'offline-worker.js'), 'utf8')}\n// worker behavior changed\n`)
    const changed = await copiedGenerator.generateOfflineBuild(directory)
    expect(changed.version).not.toBe(initial.version)
  })

  it('detects tampered generated worker and stale asset metadata', async () => {
    const directory = await fixture()
    await generateOfflineBuild(directory)
    await writeFile(resolve(directory, 'sw.js'), `${await readFile(resolve(directory, 'sw.js'), 'utf8')}\n// tampered\n`)
    await expect(verifyOfflineBuild(directory)).rejects.toThrow(/missing or stale/)
    await generateOfflineBuild(directory)
    await writeFile(resolve(directory, 'assets/app.js'), 'changed after generation')
    await expect(verifyOfflineBuild(directory)).rejects.toThrow(/missing or stale/)
  })

  it('encodes public filenames so precache keys match browser request URLs', async () => {
    const directory = await fixture()
    await writeFile(resolve(directory, 'assets/room étude.js'), 'export const room = true')
    await generateOfflineBuild(directory)
    const source = await readFile(resolve(directory, 'sw.js'), 'utf8')
    expect(source).toContain('/assets/room%20%C3%A9tude.js')
    const environment = makeWorkerEnvironment(source, async (input: any) => {
      const url = typeof input === 'string' ? input : input.url
      return response(await readFile(resolve(directory, decodeURIComponent(new URL(url).pathname.slice(1)))), url)
    })
    await dispatch(environment.handlers, 'install', {})
    let result: any
    environment.handlers.get('fetch')!({ request: { method: 'GET', url: 'https://waves.example/assets/room%20%C3%A9tude.js' }, respondWith(value: any) { result = value } })
    await expect(result.then((value: any) => value.text())).resolves.toBe('export const room = true')
  })
})

function response(body: string | Buffer, url: string, options: { status?: number; type?: string; redirected?: boolean } = {}) {
  const bytes = Buffer.from(body)
  return {
    status: options.status ?? 200,
    type: options.type ?? 'basic',
    redirected: options.redirected ?? false,
    url,
    clone() { return response(bytes, url, options) },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    async text() { return bytes.toString() },
  }
}

function makeWorkerEnvironment(source: string, fetchImpl: (input: string, options?: unknown) => Promise<ReturnType<typeof response>>) {
  const handlers = new Map<string, (event: any) => void>()
  const storage = new Map<string, Map<string, ReturnType<typeof response>>>()
  const clients = { windows: [] as unknown[], claimed: 0, async claim() { this.claimed++ }, async matchAll() { return this.windows } }
  let skipWaitingCalls = 0
  const caches = {
    async open(name: string) {
      if (!storage.has(name)) storage.set(name, new Map())
      const entries = storage.get(name)!
      return {
        async match(url: string) { return entries.get(url) },
        async put(url: string, value: ReturnType<typeof response>) { entries.set(url, value) },
      }
    },
    async keys() { return [...storage.keys()] },
    async match(url: string, options: { cacheName: string }) { return storage.get(options.cacheName)?.get(url) },
    async delete(name: string) { return storage.delete(name) },
  }
  const self = {
    location: { origin: 'https://waves.example' },
    registration: { scope: 'https://waves.example/' },
    clients,
    addEventListener(type: string, handler: (event: any) => void) { handlers.set(type, handler) },
    async skipWaiting() { skipWaitingCalls++ },
  }
  vm.runInNewContext(source, { self, caches, crypto: webcrypto, URL, fetch: fetchImpl })
  return { handlers, storage, clients, caches, get skipWaitingCalls() { return skipWaitingCalls } }
}

async function dispatch(handlers: Map<string, (event: any) => void>, type: string, event: Record<string, any>) {
  let pending: Promise<unknown> | undefined
  event.waitUntil = (promise: Promise<unknown>) => { pending = promise }
  handlers.get(type)!(event)
  await pending
  return event
}

describe('generated offline service worker', () => {
  it('repairs missing entries through the active worker and preserves remaining entries if repair fails', async () => {
    const directory = await fixture()
    const generated = await generateOfflineBuild(directory)
    let corrupt = false
    const environment = makeWorkerEnvironment(await readFile(resolve(directory, 'sw.js'), 'utf8'), async (input: any) => {
      const url = typeof input === 'string' ? input : input.url
      return response(corrupt ? 'invalid' : await readFile(resolve(directory, new URL(url).pathname.slice(1))), url)
    })
    await dispatch(environment.handlers, 'install', {})
    const entries = environment.storage.get(`cha-waves-offline-${generated.version}`)!
    entries.delete('https://waves.example/index.html')
    let reply: any
    const event = { data: { type: 'REPAIR_CACHE' }, ports: [{ postMessage(value: any) { reply = value } }] }
    await dispatch(environment.handlers, 'message', event)
    expect(reply).toEqual({ type: 'REPAIR_COMPLETE', ready: true })
    expect(entries.has('https://waves.example/index.html')).toBe(true)
    const previous = entries.get('https://waves.example/assets/app.js')
    entries.delete('https://waves.example/index.html')
    corrupt = true
    await dispatch(environment.handlers, 'message', event)
    expect(reply.ready).toBe(false)
    expect(entries.get('https://waves.example/assets/app.js')).toBe(previous)
  })

  it('verifies precache integrity and leaves the previous cache intact when an update fails', async () => {
    const directory = await fixture()
    const generated = await generateOfflineBuild(directory)
    const workerSource = await readFile(resolve(directory, 'sw.js'), 'utf8')
    const calls: string[] = []
    const environment = makeWorkerEnvironment(workerSource, async (input) => {
      calls.push(input)
      if (input.endsWith('/assets/lazy.js')) return response('wrong bytes', input)
      const relativePath = input.replace('https://waves.example/', '')
      return response(await readFile(resolve(directory, relativePath)), input)
    })
    const oldCache = await environment.caches.open('cha-waves-offline-old-version')
    await oldCache.put('https://waves.example/old.js', response('old tab asset', 'https://waves.example/old.js'))

    await expect(dispatch(environment.handlers, 'install', {})).rejects.toThrow(/Precache verification failed/)
    expect(environment.storage.has('cha-waves-offline-old-version')).toBe(true)
    expect(environment.storage.has(`cha-waves-offline-${generated.version}`)).toBe(false)
    expect(environment.skipWaitingCalls).toBe(0)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('serves only exact same-origin GET precache paths, including root mapping', async () => {
    const directory = await fixture()
    const generated = await generateOfflineBuild(directory)
    const workerSource = await readFile(resolve(directory, 'sw.js'), 'utf8')
    const requests: string[] = []
    const environment = makeWorkerEnvironment(workerSource, async (input: any) => {
      const url = typeof input === 'string' ? input : input.url
      requests.push(url)
      if (url.endsWith('/private')) return response('private network response', url)
      const relativePath = url.replace('https://waves.example/', '')
      return response(await readFile(resolve(directory, relativePath)), url)
    })
    await dispatch(environment.handlers, 'install', {})

    const queryEvent: any = { request: { method: 'GET', url: 'https://waves.example/index.html?x=1' } }
    environment.handlers.get('fetch')!(queryEvent)
    expect(queryEvent.respondWith).toBeUndefined()
    const hashEvent: any = { request: { method: 'GET', url: 'https://waves.example/index.html#fragment' } }
    environment.handlers.get('fetch')!(hashEvent)
    expect(hashEvent.respondWith).toBeUndefined()
    const postEvent: any = { request: { method: 'POST', url: 'https://waves.example/index.html' } }
    environment.handlers.get('fetch')!(postEvent)
    expect(postEvent.respondWith).toBeUndefined()
    const foreignEvent: any = { request: { method: 'GET', url: 'https://other.example/index.html' } }
    environment.handlers.get('fetch')!(foreignEvent)
    expect(foreignEvent.respondWith).toBeUndefined()
    let passthrough: any
    const missingEvent: any = { request: { method: 'GET', url: 'https://waves.example/private' }, respondWith(value: Promise<any>) { passthrough = value } }
    environment.handlers.get('fetch')!(missingEvent)
    await expect(passthrough.then((value: any) => value.text())).resolves.toContain('private')

    let rootResponse: any
    const rootEvent: any = { request: { method: 'GET', url: 'https://waves.example/' }, respondWith(value: Promise<any>) { rootResponse = value } }
    environment.handlers.get('fetch')!(rootEvent)
    await expect(rootResponse.then((value: any) => value.text())).resolves.toContain('<!doctype html>')
    expect(generated.assetCount).toBeGreaterThan(0)
    expect(requests.length).toBe(generated.assetCount + 1) // One additional network pass-through for /private.
  })

  it('supports explicit updates and retains prior assets while windows are open', async () => {
    const directory = await fixture()
    const generated = await generateOfflineBuild(directory)
    const workerSource = await readFile(resolve(directory, 'sw.js'), 'utf8')
    const environment = makeWorkerEnvironment(workerSource, async (input: any) => {
      const url = typeof input === 'string' ? input : input.url
      const relativePath = url.replace('https://waves.example/', '')
      return response(await readFile(resolve(directory, relativePath)), url)
    })
    const oldCache = await environment.caches.open('cha-waves-offline-old-version')
    await oldCache.put('https://waves.example/assets/old-chunk.js', response('old chunk', 'https://waves.example/assets/old-chunk.js'))
    await dispatch(environment.handlers, 'install', {})
    expect(environment.skipWaitingCalls).toBe(0)

    await dispatch(environment.handlers, 'message', { data: { type: 'ACTIVATE_UPDATE' } })
    expect(environment.skipWaitingCalls).toBe(1)
    environment.clients.windows = [{}]
    await dispatch(environment.handlers, 'activate', {})
    expect(environment.clients.claimed).toBe(1)
    expect(environment.storage.has('cha-waves-offline-old-version')).toBe(true)

    let oldResponse: any
    environment.handlers.get('fetch')!({ request: { method: 'GET', url: 'https://waves.example/assets/old-chunk.js' }, respondWith(value: any) { oldResponse = value } })
    await expect(oldResponse.then((value: any) => value.text())).resolves.toBe('old chunk')

    let portStatus: any
    await dispatch(environment.handlers, 'message', { data: { type: 'GET_STATUS' }, ports: [{ postMessage(value: any) { portStatus = value } }] })
    expect(portStatus).toMatchObject({ ready: true, version: generated.version })
    environment.storage.get(`cha-waves-offline-${generated.version}`)!.delete('https://waves.example/index.html')
    await dispatch(environment.handlers, 'message', { data: { type: 'GET_STATUS' }, ports: [{ postMessage(value: any) { portStatus = value } }] })
    expect(portStatus.ready).toBe(false)
    await dispatch(environment.handlers, 'message', { data: { type: 'ACTIVATE_UPDATE' } })
    expect(environment.skipWaitingCalls).toBe(1) // An evicted waiting cache cannot replace the active build.

    environment.clients.windows = []
    await dispatch(environment.handlers, 'activate', {})
    expect(environment.storage.has('cha-waves-offline-old-version')).toBe(false)

    let status: unknown
    const source = { postMessage(value: unknown) { status = value } }
    await dispatch(environment.handlers, 'message', { data: { type: 'GET_STATUS' }, source })
    expect(status).toEqual({ type: 'STATUS', version: generated.version, assetCount: generated.assetCount, totalBytes: generated.totalBytes, ready: false })
  })
})
