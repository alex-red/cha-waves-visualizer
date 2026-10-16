import { onMounted, onUnmounted, ref } from 'vue'

const WORKER_PATH = '/sw.js'
const WORKER_SCOPE = '/'
const CACHE_PREFIX = 'cha-waves-offline-'
const STATUS_TIMEOUT_MS = 5000
const ACTIVATION_TIMEOUT_MS = 8000
const INSTALL_TIMEOUT_MS = 30000

type WorkerStatus = {
  type: 'STATUS'
  version: string
  assetCount: number
  totalBytes: number
  ready: boolean
}

type BuildMetadata = {
  version: string
  assetCount: number
  totalBytes: number
}

export type OfflinePersistenceState = 'unknown' | 'granted' | 'declined' | 'unavailable'

function isWorkerStatus(value: unknown): value is WorkerStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<WorkerStatus>
  return status.type === 'STATUS'
    && typeof status.version === 'string'
    && Number.isFinite(status.assetCount)
    && Number.isFinite(status.totalBytes)
    && typeof status.ready === 'boolean'
}

function isBuildMetadata(value: unknown): value is BuildMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Partial<BuildMetadata>
  return typeof metadata.version === 'string'
    && Number.isFinite(metadata.assetCount)
    && Number.isFinite(metadata.totalBytes)
}

/** Manages the user's explicit offline install and the matching service worker. */
export function useOfflineWorkspace() {
  const supported = ref(false)
  const enabled = ref(false)
  const busy = ref(false)
  const ready = ref(false)
  const online = ref(true)
  const updateReady = ref(false)
  const notice = ref('')
  const error = ref('')
  const version = ref('')
  const latestVersion = ref('')
  const assetCount = ref(0)
  const totalBytes = ref(0)
  const persistenceState = ref<OfflinePersistenceState>('unknown')
  const usageBytes = ref<number | null>(null)
  const quotaBytes = ref<number | null>(null)

  let registration: ServiceWorkerRegistration | null = null
  let disposed = false
  let lifecycleGeneration = 0
  let statusSequence = 0
  let statusKnown = false
  let activationWaiter: (() => void) | undefined
  const listenedWorkers = new Set<ServiceWorker>()

  function isOwnRegistration(candidate: ServiceWorkerRegistration | null | undefined): candidate is ServiceWorkerRegistration {
    const worker = candidate?.active ?? candidate?.waiting ?? candidate?.installing
    if (!worker) return false
    try {
      const url = new URL(worker.scriptURL)
      return url.origin === window.location.origin && url.pathname === WORKER_PATH
    } catch {
      return false
    }
  }

  function setStatus(status: WorkerStatus | null) {
    statusKnown = Boolean(status)
    if (!status) {
      ready.value = false
      return
    }
    version.value = status.version
    assetCount.value = status.assetCount
    totalBytes.value = status.totalBytes
    ready.value = Boolean(registration?.active && status.ready)
    if (ready.value && !updateReady.value && /downloading|status is being checked|complete update is ready/.test(notice.value)) notice.value = 'Offline access is ready for this version.'
  }

  function listenToWorker(worker: ServiceWorker | null) {
    if (!worker || listenedWorkers.has(worker)) return
    listenedWorkers.add(worker)
    worker.addEventListener('statechange', onWorkerStateChange)
  }

  function onWorkerStateChange(event: Event) {
    if (!registration) return
    const worker = event.target as ServiceWorker | null
    listenToWorker(registration.installing)
    listenToWorker(registration.waiting)
    listenToWorker(registration.active)
    updateReady.value = Boolean(registration.waiting)
    if (worker?.state === 'redundant' && worker !== registration.active) {
      error.value = 'The offline files could not be installed. Your current saved version remains available; check for updates to retry.'
    }
    if (registration.active) void refreshStatus()
  }

  function onUpdateFound() {
    if (!registration) return
    listenToWorker(registration.installing)
    updateReady.value = Boolean(registration.waiting)
  }

  function onControllerChange() {
    const isOwnController = Boolean(registration?.active && navigator.serviceWorker.controller === registration.active)
    if (registration && isOwnController) {
      activationWaiter?.()
      activationWaiter = undefined
      enabled.value = true
      listenToWorker(registration.active)
      updateReady.value = Boolean(registration.waiting)
      void refreshStatus()
    }
  }

  function bindRegistration(next: ServiceWorkerRegistration | null) {
    if (registration) registration.removeEventListener('updatefound', onUpdateFound)
    registration = next
    if (!registration) {
      enabled.value = false
      ready.value = false
      updateReady.value = false
      return
    }
    enabled.value = true
    registration.addEventListener('updatefound', onUpdateFound)
    listenToWorker(registration.installing)
    listenToWorker(registration.waiting)
    listenToWorker(registration.active)
    updateReady.value = Boolean(registration.waiting)
  }

  async function readStatus(worker: ServiceWorker | null | undefined): Promise<WorkerStatus | null> {
    if (!worker || worker.state !== 'activated' || typeof MessageChannel === 'undefined') return null
    return new Promise(resolve => {
      const channel = new MessageChannel()
      let done = false
      const finish = (status: WorkerStatus | null) => {
        if (done) return
        done = true
        clearTimeout(timeout)
        channel.port1.close()
        channel.port2.close()
        resolve(status)
      }
      const timeout = setTimeout(() => finish(null), STATUS_TIMEOUT_MS)
      channel.port1.onmessage = event => finish(isWorkerStatus(event.data) ? event.data : null)
      try {
        worker.postMessage({ type: 'GET_STATUS' }, [channel.port2])
      } catch {
        finish(null)
      }
    })
  }

  async function refreshStatus() {
    const currentRegistration = registration
    const worker = currentRegistration?.active
    if (!worker) return
    const sequence = ++statusSequence
    let status = await readStatus(worker)
    // A newly activated worker may still be waking as the replacement page mounts.
    if (!status && !disposed && sequence === statusSequence && registration === currentRegistration && registration.active === worker) {
      status = await readStatus(worker)
    }
    if (disposed || sequence !== statusSequence || registration !== currentRegistration || registration.active !== worker) return
    setStatus(status)
  }

  function waitForInstall(candidate: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
    if (candidate.waiting && candidate.active?.state === 'activated') return Promise.resolve(candidate.waiting)
    const installing = candidate.installing ?? candidate.waiting ?? (candidate.active?.state !== 'activated' ? candidate.active : null)
    if (!installing) return Promise.resolve(candidate.active?.state === 'activated' ? candidate.active : null)

    return new Promise((resolve, reject) => {
      let settled = false
      let installedCheckScheduled = false
      const finish = (worker: ServiceWorker | null, failure?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        candidate.removeEventListener('updatefound', inspect)
        installing.removeEventListener('statechange', inspect)
        if (failure) reject(failure)
        else resolve(worker)
      }
      const inspect = () => {
        if (candidate.waiting && candidate.active?.state === 'activated') {
          finish(candidate.waiting)
          return
        }
        if (installing.state === 'redundant') {
          finish(null, new Error('The offline files could not be installed. Check your connection and try again.'))
          return
        }
        if (installing.state === 'activated') {
          finish(candidate.active ?? installing)
          return
        }
        if (installing.state === 'installed' && !candidate.waiting) {
          if (!installedCheckScheduled) {
            installedCheckScheduled = true
            setTimeout(inspect, 0)
          }
          return
        }
        if (!candidate.installing && candidate.active?.state === 'activated') finish(candidate.active)
      }
      const timeout = setTimeout(() => finish(null, new Error('Offline installation is taking longer than expected. Your current saved version remains available.')),
        INSTALL_TIMEOUT_MS)
      candidate.addEventListener('updatefound', inspect)
      installing.addEventListener('statechange', inspect)
      inspect()
    })
  }

  function onOnline() {
    online.value = true
  }

  function onOffline() {
    online.value = false
  }

  async function inspectExistingRegistration() {
    if (!supported.value || disposed) return
    const generation = lifecycleGeneration
    busy.value = true
    online.value = navigator.onLine
    try {
      const candidate = await navigator.serviceWorker.getRegistration(WORKER_SCOPE)
      if (!disposed && generation === lifecycleGeneration && isOwnRegistration(candidate)) {
        bindRegistration(candidate)
        if (candidate.active?.state === 'activating') await waitForInstall(candidate)
        await refreshStatus()
      }
    } catch {
      // A read-only inspection failure should not make offline controls unusable.
    } finally { if (!disposed && generation === lifecycleGeneration) busy.value = false }
  }

  onMounted(() => {
    online.value = navigator.onLine
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    supported.value = 'serviceWorker' in navigator && 'caches' in window && !import.meta.dev && window.isSecureContext
    void inspectPersistence()
    if (!supported.value) {
      notice.value = 'Offline storage is not available in this browser.'
      return
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    void inspectExistingRegistration()
  })

  onUnmounted(() => {
    disposed = true
    if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    if (registration) registration.removeEventListener('updatefound', onUpdateFound)
    for (const worker of listenedWorkers) worker.removeEventListener('statechange', onWorkerStateChange)
    activationWaiter = undefined
  })

  async function enable(): Promise<boolean> {
    if (busy.value || disposed) return false
    if (!supported.value) {
      error.value = 'This browser does not support offline storage.'
      return false
    }
    busy.value = true
    const generation = ++lifecycleGeneration
    error.value = ''
    notice.value = ''
    try {
      const repairing = Boolean(registration?.active && !ready.value && statusKnown && version.value && !registration.waiting)
      if (repairing && registration?.active) {
        const worker = registration.active
        await new Promise<void>((resolve, reject) => {
          const channel = new MessageChannel()
          const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Repair timed out. Check for an update or try again while connected.')) }, INSTALL_TIMEOUT_MS)
          channel.port1.onmessage = event => {
            clearTimeout(timeout); channel.port1.close()
            if (event.data?.type === 'REPAIR_COMPLETE' && event.data.ready) resolve()
            else reject(new Error('The cached build could not be repaired. Check for an update while connected.'))
          }
          worker.postMessage({ type: 'REPAIR_CACHE' }, [channel.port2])
        })
        await refreshStatus()
        notice.value = ready.value ? 'Offline access is ready for this version.' : 'The offline copy still needs attention. Check for an update.'
        return ready.value
      }
      const next = await navigator.serviceWorker.register(WORKER_PATH, {
        scope: WORKER_SCOPE,
        updateViaCache: 'none',
      })
      if (disposed || generation !== lifecycleGeneration) return false
      if (!isOwnRegistration(next)) throw new Error('The offline worker was not installed at the expected address.')
      bindRegistration(next)
      const installedWorker = await waitForInstall(next)
      if (disposed || generation !== lifecycleGeneration) return false
      if (!installedWorker) throw new Error('The offline worker did not finish installing. Check your connection and try again.')
      await refreshStatus()
      if (next.waiting) updateReady.value = true
      if (ready.value) notice.value = 'Offline access is ready for this version.'
      else notice.value = next.waiting ? 'A complete update is ready to activate.' : 'Offline status is being checked. Keep this tab open.'
      return ready.value
    } catch (cause) {
      if (!registration?.active) bindRegistration(null)
      error.value = cause instanceof Error ? cause.message : 'Could not enable offline access. Check your connection and try again.'
      notice.value = registration?.active ? 'Your existing offline version remains available.' : 'Saved homes are unchanged. Reconnect and try the download again.'
      return false
    } finally {
      busy.value = false
    }
  }

  async function checkForUpdate(): Promise<boolean> {
    if (busy.value || disposed) return false
    if (!supported.value || !registration) {
      error.value = 'Enable offline access before checking for updates.'
      return false
    }
    busy.value = true
    const generation = lifecycleGeneration
    error.value = ''
    notice.value = ''
    try {
      const metadataResponse = await fetch('/offline-build.json', { cache: 'no-store' })
      if (metadataResponse.ok) {
        const metadata: unknown = await metadataResponse.json()
        if (isBuildMetadata(metadata)) latestVersion.value = metadata.version
      }
      await registration.update()
      if (disposed || generation !== lifecycleGeneration) return false
      if (registration.installing) await waitForInstall(registration)
      if (disposed || generation !== lifecycleGeneration) return false
      if (!registration.active && !registration.waiting) throw new Error('The offline worker has no active version. Check your connection and try again.')
      updateReady.value = Boolean(registration.waiting)
      if (updateReady.value) notice.value = 'A new offline version is ready to install.'
      else if (latestVersion.value && version.value && latestVersion.value !== version.value) notice.value = 'A newer build is available. Its offline files are still downloading.'
      else notice.value = online.value ? 'Offline access is up to date.' : 'You are offline. The saved offline version is still available.'
      return updateReady.value
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not check for an update. Your saved offline version is unchanged.'
      notice.value = 'Your saved offline version remains available.'
      return false
    } finally {
      busy.value = false
    }
  }

  async function applyUpdate(): Promise<boolean> {
    if (busy.value || disposed) return false
    const waiting = registration?.waiting
    if (!waiting) {
      error.value = 'There is no downloaded update ready to install.'
      return false
    }
    busy.value = true
    error.value = ''
    notice.value = ''
    const workerChanged = new Promise<boolean>(resolve => {
      let settled = false
      const finish = (changed: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (activationWaiter === onActivated) activationWaiter = undefined
        resolve(changed)
      }
      const onActivated = () => finish(true)
      const timeout = setTimeout(() => finish(false), ACTIVATION_TIMEOUT_MS)
      activationWaiter = onActivated
    })
    try {
      waiting.postMessage({ type: 'ACTIVATE_UPDATE' })
      const changed = await workerChanged
      if (!changed) {
        error.value = 'The update did not become active. Your current offline version remains available.'
        return false
      }
      notice.value = 'The update is active. Reload to open the new version.'
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not activate the update. Your current offline version remains available.'
      return false
    } finally {
      busy.value = false
    }
  }

  async function disable(): Promise<boolean> {
    if (busy.value || disposed) return false
    if (!supported.value) return false
    busy.value = true
    ++lifecycleGeneration
    error.value = ''
    notice.value = ''
    try {
      let candidate = registration
      if (!candidate) candidate = await navigator.serviceWorker.getRegistration(WORKER_SCOPE) ?? null
      if (candidate && isOwnRegistration(candidate)) {
        const unregistered = await candidate.unregister()
        if (!unregistered) throw new Error('The offline worker could not be removed.')
      }
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.filter(name => name.startsWith(CACHE_PREFIX)).map(name => caches.delete(name)))
      bindRegistration(null)
      version.value = ''
      latestVersion.value = ''
      assetCount.value = 0
      totalBytes.value = 0
      ready.value = false
      notice.value = 'Offline files have been removed from this browser.'
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not remove offline files from this browser.'
      return false
    } finally {
      busy.value = false
    }
  }

  async function requestPersistence(): Promise<boolean> {
    if (busy.value || disposed) return false
    const storage = navigator.storage
    if (!storage?.persist || !storage.persisted) {
      persistenceState.value = 'unavailable'
      notice.value = 'This browser does not offer persistent storage for offline files.'
      return false
    }
    busy.value = true
    error.value = ''
    try {
      const alreadyPersisted = await storage.persisted()
      const persisted = alreadyPersisted || await storage.persist()
      if (disposed) return false
      persistenceState.value = persisted ? 'granted' : 'declined'
      if (!persisted) notice.value = 'The browser did not grant persistent storage. Offline files can still be cleared by the browser.'
      else notice.value = 'The browser will try to keep offline files on this device.'
      if (storage.estimate) {
        const estimate = await storage.estimate()
        if (disposed) return false
        usageBytes.value = typeof estimate.usage === 'number' ? estimate.usage : null
        quotaBytes.value = typeof estimate.quota === 'number' ? estimate.quota : null
      }
      return persisted
    } catch (cause) {
      persistenceState.value = 'unavailable'
      error.value = cause instanceof Error ? cause.message : 'Could not request persistent storage.'
      return false
    } finally {
      busy.value = false
    }
  }

  async function inspectPersistence() {
    const storage = navigator.storage
    if (!storage?.persisted || !storage.persist) {
      persistenceState.value = 'unavailable'
      return
    }
    try {
      const persisted = await storage.persisted()
      if (disposed) return
      persistenceState.value = persisted ? 'granted' : 'unknown'
      if (storage.estimate) {
        const estimate = await storage.estimate()
        if (disposed) return
        usageBytes.value = typeof estimate.usage === 'number' ? estimate.usage : null
        quotaBytes.value = typeof estimate.quota === 'number' ? estimate.quota : null
      }
    } catch {
      // Keep the persistence request available when a read-only storage query fails.
    }
  }

  return {
    supported,
    enabled,
    busy,
    ready,
    online,
    updateReady,
    notice,
    error,
    version,
    latestVersion,
    assetCount,
    totalBytes,
    persistenceState,
    usageBytes,
    quotaBytes,
    enable,
    checkForUpdate,
    applyUpdate,
    disable,
    requestPersistence,
  }
}
