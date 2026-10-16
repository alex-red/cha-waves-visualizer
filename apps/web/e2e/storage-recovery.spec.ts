import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const DATABASE_NAME = 'cha-waves-projects'
const STORE_NAME = 'projects'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function readSavedProject(page: Page) {
  return page.evaluate(async ({ databaseName, storeName }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const projects = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return projects[0]
    } finally {
      db.close()
    }
  }, { databaseName: DATABASE_NAME, storeName: STORE_NAME })
}

async function seedVersionOneProject(page: Page) {
  return page.evaluate(async ({ databaseName, storeName }) => {
    const open = (version: number) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, version)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const db = await open(2)
    let project: any
    try {
      project = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result[0])
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
    if (!project) throw new Error('Expected the app to have saved its starter project')

    project.metadata.id = 'legacy-v1-project'
    project.scene.emitters.find((emitter: { id: string }) => emitter.id === 'speaker').position[0] = 3
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      const deadline = setTimeout(() => reject(new Error('An open connection prevented preparing the v1 fixture')), 5000)
      request.onsuccess = () => { clearTimeout(deadline); resolve() }
      request.onerror = () => { clearTimeout(deadline); reject(request.error) }
      // close() can still be draining a completed transaction in WebKit.
      request.onblocked = () => {}
    })

    const legacyDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'metadata.id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = legacyDb.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).put(project)
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('Could not seed v1 project'))
      })
      return { id: project.metadata.id, sourceX: project.scene.emitters.find((emitter: { id: string }) => emitter.id === 'speaker').position[0] }
    } finally {
      legacyDb.close()
    }
  }, { databaseName: DATABASE_NAME, storeName: STORE_NAME })
}

test('version 1 projects without the updatedAt index migrate and remain loadable', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10000 })

  const legacy = await seedVersionOneProject(page)
  await page.reload()
  await ready(page)
  await expect(page.getByTestId('source-x')).toHaveValue(`${legacy.sourceX.toFixed(1)}`)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10000 })

  const migrated = await page.evaluate(async ({ databaseName, storeName, indexName }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return {
        version: db.version,
        hasUpdatedAtIndex: db.transaction(storeName, 'readonly').objectStore(storeName).indexNames.contains(indexName),
        projects: await new Promise<any[]>((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        }),
      }
    } finally {
      db.close()
    }
  }, { databaseName: DATABASE_NAME, storeName: STORE_NAME, indexName: 'updatedAt' })
  expect(migrated.version).toBe(2)
  expect(migrated.hasUpdatedAtIndex).toBe(true)
  expect(migrated.projects).toHaveLength(1)
  expect(migrated.projects[0].metadata.id).toBe(legacy.id)
})

for (const failure of [
  { kind: 'abort', name: 'AbortError', message: 'Synthetic transaction abort' },
  { kind: 'quota', name: 'QuotaExceededError', message: 'Synthetic quota exhaustion' },
] as const) {
  test(`a ${failure.kind} during autosave preserves the canonical project and still allows export`, async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10000 })
    await page.getByRole('button', { name: 'Save as baseline' }).click()

    const canonical = await readSavedProject(page) as any
    expect(canonical).toBeTruthy()
    expect(canonical.scene.openings.some((opening: { kind: string; isOpen?: boolean }) => opening.kind === 'door' && opening.isOpen)).toBe(false)

    await page.evaluate((failureName) => {
      const prototype = IDBObjectStore.prototype
      const originalPut = prototype.put
      prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        prototype.put = originalPut
        this.transaction.abort()
        throw new DOMException('Synthetic storage write failure', failureName)
      } as typeof prototype.put
    }, failure.name)

    await page.getByTestId('door-toggle').click()
    await ready(page)
    await expect(page.getByTestId('door-toggle')).toContainText('OPEN')
    await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'failed', { timeout: 10000 })
    await expect(page.getByTestId('storage-error')).toBeVisible()

    const stillCanonical = await readSavedProject(page) as any
    expect(stillCanonical.metadata.id).toBe(canonical.metadata.id)
    expect(stillCanonical.scene.openings.some((opening: { kind: string; isOpen?: boolean }) => opening.kind === 'door' && opening.isOpen)).toBe(false)

    const pendingDownload = page.waitForEvent('download')
    await page.getByTestId('project-export').click()
    const download = await pendingDownload
    const exportPath = await download.path()
    expect(exportPath).toBeTruthy()
    const exported = JSON.parse(await readFile(exportPath!, 'utf8'))
    expect(exported.baseline).toBeTruthy()
    expect(exported.scene.openings.some((opening: { kind: string; isOpen?: boolean }) => opening.kind === 'door' && opening.isOpen)).toBe(true)
    expect(exported.metadata.id).toBe(canonical.metadata.id)
  })
}

test('a blocked v1 upgrade reports failure, then releases its late successful connection', async ({ browser }) => {
  const context = await browser.newContext()
  const seedPage = await context.newPage()
  await seedPage.goto('/')
  await ready(seedPage)
  await expect(seedPage.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10000 })
  await seedVersionOneProject(seedPage)

  const oldConnection = await seedPage.evaluateHandle(async (databaseName) => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }), DATABASE_NAME)
  const appPage = await context.newPage()
  await appPage.goto('/')
  await expect(appPage.getByTestId('project-status')).toHaveAttribute('data-state', 'failed', { timeout: 10000 })
  await expect(appPage.getByTestId('storage-error')).toContainText('blocked by another open tab')

  await oldConnection.evaluate(db => db.close())
  await oldConnection.dispose()
  const v3Result = await appPage.evaluate(async (databaseName) => new Promise<{ version?: number; blocked: boolean }>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 3)
    let blocked = false
    request.onblocked = () => { blocked = true }
    request.onsuccess = () => {
      const version = request.result.version
      request.result.close()
      resolve({ version, blocked })
    }
    request.onerror = () => reject(request.error)
    setTimeout(() => reject(new Error('The late v2 connection remained open and blocked the follow-up upgrade')), 3000)
  }), DATABASE_NAME)
  expect(v3Result).toEqual({ version: 3, blocked: false })
  await context.close()
})
