import { webcrypto } from 'crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { deserialize, serialize } from 'node:v8'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { LOCAL_BUNDLE_STORAGE_KEY } from '@/src/infrastructure/fhir/services/local-bundle-scope'

// Builds before 2026-06-12 kept the imported chart in plaintext: in IndexedDB
// under `current`, and before 2026-06-04 as JSON in localStorage. Such a record
// has no age and no owning tab, so a shared workstation must not present it
// as the patient being viewed now.

const originalCrypto = globalThis.crypto
const originalBlob = globalThis.Blob, originalClone = globalThis.structuredClone, originalIDB = globalThis.indexedDB
const mockEnrich = jest.fn()
jest.mock('@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.worker-client', () => ({ enrichBundleWithNhiDrugTerminologyOffMainThread: (...args: unknown[]) => mockEnrich(...args) }))

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true })
  globalThis.structuredClone = <T,>(value: T): T => deserialize(serialize(value))
})
beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new FakeIDBFactory(), configurable: true })
  mockEnrich.mockReset().mockImplementation(async bundle => ({ bundle, report: { status: 'skipped', linkedRequestCount: 0 } }))
})
afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
  Object.defineProperty(globalThis, 'Blob', { value: originalBlob, configurable: true })
  Object.defineProperty(globalThis, 'indexedDB', { value: originalIDB, configurable: true })
  globalThis.structuredClone = originalClone
})
afterEach(() => { sessionStorage.clear(); localStorage.clear() })

async function service() {
  jest.resetModules()
  return (await import('@/src/infrastructure/fhir/services/local-bundle.service')).LocalBundleService
}

const oldChart = () => ({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'synthetic-old-patient' } }] })
const currentChart = () => ({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'synthetic-current-patient' } }] })

function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mediprisma', 2)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('bundles')
      req.result.createObjectStore('images')
    }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => run(req.result).then(resolve, reject).finally(() => req.result.close())
  })
}

function put(store: string, key: string, value: unknown): Promise<void> {
  return withDb(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function keys(store: string): Promise<IDBValidKey[]> {
  return withDb(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

test('a plaintext chart left in IndexedDB by an older build is removed, not shown', async () => {
  await put('bundles', 'current', oldChart())
  const local = await service()

  expect(await local.load()).toBeNull()
  expect(local.getActiveImportId()).toBeNull()
  expect(await keys('bundles')).toEqual([])
})

test('a chart kept as JSON in localStorage by an older build is removed, not shown', async () => {
  localStorage.setItem(LOCAL_BUNDLE_STORAGE_KEY, JSON.stringify(oldChart()))
  const local = await service()

  expect(await local.load()).toBeNull()
  expect(local.getActiveImportId()).toBeNull()
  expect(localStorage.getItem(LOCAL_BUNDLE_STORAGE_KEY)).toBeNull()
  expect(await keys('bundles')).toEqual([])
})

test('plaintext images from an older build are swept and cannot be opened', async () => {
  await put('images', 'legacy-image', new Blob(['synthetic image bytes'], { type: 'image/png' }))
  const local = await service()

  expect(await local.load()).toBeNull()
  expect(await keys('images')).toEqual([])
  expect(await local.getImage('legacy-image')).toBeNull()
})

test('a current encrypted import still loads after an older plaintext chart is swept', async () => {
  await put('bundles', 'current', oldChart())
  const local = await service()
  const chart = currentChart()
  await local.save(chart, { importId: 'current-import' })

  // A fresh tab-local read goes back to IndexedDB, past the memory cache.
  const reloaded = await service()
  expect(await reloaded.load()).toEqual(chart)
  expect(reloaded.getActiveImportId()).toBe('current-import')
  expect(await keys('bundles')).toEqual(['current-import'])
})
