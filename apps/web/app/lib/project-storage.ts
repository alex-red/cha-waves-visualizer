import { validateProjectDocument, type ProjectDocument, ProjectError } from '../../../../packages/project'

const DATABASE_NAME = 'cha-waves-projects'
const DATABASE_VERSION = 2
const STORE_NAME = 'projects'
const UPDATED_AT_INDEX = 'updatedAt'

export async function loadProject(id?: string): Promise<ProjectDocument | null> {
  const db = await openDatabase()
  let done: Promise<void> | undefined
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    done = transactionDone(tx)
    const store = tx.objectStore(STORE_NAME)
    const value = id === undefined
      ? await request(store.index(UPDATED_AT_INDEX).openCursor(null, 'prev')).then(cursor => cursor ? validateProjectDocument(cursor.value) : null)
      : await request(store.get(id)).then(item => item === undefined ? null : validateProjectDocument(item))
    await done
    return value
  } catch (error) {
    // If the request failed, let the already-observed transaction settle too.
    // This also avoids an unhandled abort rejection racing the storage error.
    if (done) try { await done } catch { /* request error below is the useful failure */ }
    if (error instanceof ProjectError) throw error
    throw storageError('Could not load the saved project', error)
  } finally {
    db.close()
  }
}

/** List bounded metadata only; large reference images never leave storage in this result. */
export async function listProjects(): Promise<{ id: string; name: string; updatedAt: string }[]> {
  const db = await openDatabase()
  let done: Promise<void> | undefined
  try {
    const tx = db.transaction(STORE_NAME, 'readonly'); done = transactionDone(tx)
    const summaries = await new Promise<{ id: string; name: string; updatedAt: string }[]>((resolve, reject) => {
      const result: { id: string; name: string; updatedAt: string }[] = []
      const cursorRequest = tx.objectStore(STORE_NAME).index(UPDATED_AT_INDEX).openCursor(null, 'prev')
      cursorRequest.onerror = () => reject(cursorRequest.error)
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor || result.length >= 50) { resolve(result); return }
        const metadata = cursor.value?.metadata
        if (metadata && typeof metadata.id === 'string' && typeof metadata.name === 'string' && typeof metadata.updatedAt === 'string') result.push({ id: metadata.id, name: metadata.name, updatedAt: metadata.updatedAt })
        cursor.continue()
      }
    })
    await done; return summaries
  } catch (error) {
    if (done) try { await done } catch { /* preserve original failure */ }
    throw storageError('Could not list local homes', error)
  } finally { db.close() }
}

export async function saveProject(document: ProjectDocument): Promise<void> {
  const project = validateProjectDocument(document)
  const db = await openDatabase()
  let done: Promise<void> | undefined
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    done = transactionDone(tx)
    tx.objectStore(STORE_NAME).put(project)
    await done
  } catch (error) {
    if (done) try { await done } catch { /* use the transaction's storage error below */ }
    throw storageError('Could not save the project. Browser storage may be unavailable or full.', error)
  } finally {
    db.close()
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new ProjectError('STORAGE_UNAVAILABLE', 'IndexedDB is unavailable in this environment'))
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION) } catch (error) {
      reject(storageError('Could not open browser project storage', error))
      return
    }
    let settled = false
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'metadata.id' })
      if (!store.indexNames.contains(UPDATED_AT_INDEX)) store.createIndex(UPDATED_AT_INDEX, 'metadata.updatedAt', { unique: false })
    }
    request.onsuccess = () => {
      if (settled) request.result.close()
      else { settled = true; resolve(request.result) }
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      reject(storageError('Could not open browser project storage', request.error))
    }
    request.onblocked = () => {
      if (settled) return
      settled = true
      reject(new ProjectError('STORAGE_FAILED', 'Project storage upgrade is blocked by another open tab'))
    }
  })
}

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Transaction was aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'))
  })
}

function storageError(message: string, cause: unknown): ProjectError {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : ''
  return new ProjectError('STORAGE_FAILED', `${message}${detail}`)
}
