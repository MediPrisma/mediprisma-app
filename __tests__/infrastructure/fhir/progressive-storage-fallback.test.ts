import { webcrypto } from 'crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { deserialize, serialize } from 'node:v8'
import { IDBFactory as FakeIDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'

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
afterEach(() => { jest.restoreAllMocks(); sessionStorage.clear() })

async function service() {
  jest.resetModules()
  return (await import('@/src/infrastructure/fhir/services/local-bundle.service')).LocalBundleService
}
const chart = () => ({ resourceType: 'Bundle', entry: [
  { resource: { resourceType: 'Patient', id: 'synthetic-patient' } },
  { resource: { resourceType: 'DiagnosticReport', id: 'image-a', presentedForm: [{ contentType: 'image/png', data: 'AQID' }] } },
] })

test.each(['read', 'key', 'marker'] as const)('guarded import stays usable in memory when session storage %s is unavailable', async mode => {
  const local = await service()
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem
  if (mode === 'read') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (this === sessionStorage) throw new DOMException('synthetic storage restriction', 'SecurityError')
    return get.call(this, key)
  })
  else jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === sessionStorage && (mode === 'key' ? key === '__bundle_session_key__' : key === 'fhir_bundle_override')) {
      throw new DOMException('synthetic storage quota', 'QuotaExceededError')
    }
    return set.call(this, key, value)
  })
  const bundle = chart(), source = new Blob([JSON.stringify(bundle)])
  await local.save(bundle, { importId: 'cloud-a', originalFhir: source, signal: new AbortController().signal })
  expect(local.getActiveImportId()).toBe('cloud-a')
  expect(await local.load()).toEqual(bundle)
  expect((bundle.entry[1].resource as any).presentedForm[0].data).toBe('AQID')
  expect(await local.loadOriginalFhir()).toBe(source)
  mockEnrich.mockResolvedValueOnce({ bundle: { ...bundle, id: 'enriched-cloud' }, report: { status: 'enriched', linkedRequestCount: 1 } })
  expect(await local.parseStored()).not.toBeNull()
  const queue = await import('@/src/infrastructure/fhir/services/local-bundle-mutation-queue')
  await queue.serializeLocalBundleMutation(async () => {})
  for (const importId of ['visits-a', 'final-a']) {
    const updated = { ...chart(), id: importId }, updatedSource = new Blob([JSON.stringify(updated)])
    await local.save(updated, { importId, originalFhir: updatedSource, signal: new AbortController().signal })
    expect(local.getActiveImportId()).toBe(importId)
    expect(await local.load()).toEqual(updated)
    expect(await local.loadOriginalFhir()).toBe(updatedSource)
  }
})

test('storage restriction does not swallow a cancellation or a changed active import guard', async () => {
  const local = await service(), previous = chart(), source = new Blob(['previous source'])
  await local.save(previous, { importId: 'previous', originalFhir: source })
  const restriction = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('synthetic restriction', 'SecurityError') })
  const controller = new AbortController()
  await expect(local.save(chart(), { importId: 'cancelled', signal: controller.signal, beforeCommit: () => controller.abort('cancelled') })).rejects.toBeDefined()
  expect(local.getActiveImportId()).toBe('previous')
  expect(await local.load()).toEqual(previous)
  await expect(local.save(chart(), { importId: 'stale', signal: new AbortController().signal, beforeCommit: () => { throw new Error('active import changed') } })).rejects.toThrow('active import changed')
  expect(local.getActiveImportId()).toBe('previous')
  restriction.mockRestore()
  expect(await (await local.loadOriginalFhir())!.text()).toBe(await source.text())
})

test('a replacement that cannot publish its storage pointer fails instead of acknowledging a newer memory-only snapshot', async () => {
  const local = await service(), previous = chart(), source = new Blob(['previous source'])
  await local.save(previous, { importId: 'previous', originalFhir: source })
  const marker = sessionStorage.getItem('fhir_bundle_override'), key = sessionStorage.getItem('__bundle_session_key__')
  const set = Storage.prototype.setItem
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
    if (this === sessionStorage && name === 'fhir_bundle_override' && value !== marker) throw new DOMException('synthetic quota', 'QuotaExceededError')
    return set.call(this, name, value)
  })
  await expect(local.save(chart(), { importId: 'unpublished', signal: new AbortController().signal })).rejects.toThrow('bundle session marker unavailable')
  expect(sessionStorage.getItem('fhir_bundle_override')).toBe(marker)
  expect(sessionStorage.getItem('__bundle_session_key__')).toBe(key)
  expect(local.getActiveImportId()).toBe('previous')
  expect(await local.load()).toEqual(previous)
  const reloaded = await service()
  expect(await reloaded.load()).toEqual(previous)
  expect(await (await reloaded.loadOriginalFhir())!.text()).toBe(await source.text())
})

test.each([false, true])('a profile write recovers memory-only durability (existing key: %s) before another replacement fails', async existingKey => {
  const local = await service()
  const { getSessionBundleKey } = await import('@/src/infrastructure/fhir/services/bundle-crypto')
  if (existingKey) await getSessionBundleKey({ create: true })
  const put = FakeObjectStore.prototype.put
  const failure = jest.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, recordKey) {
    if (this.name === 'bundles') throw new DOMException('synthetic quota', 'QuotaExceededError')
    return put.call(this, value, recordKey)
  })
  const previous = chart()
  await local.save(previous, { importId: 'recovered-cloud', signal: new AbortController().signal })
  failure.mockRestore()
  await local.setUserEnteredPatientProfile(null)
  const key = sessionStorage.getItem('__bundle_session_key__'), marker = sessionStorage.getItem('fhir_bundle_override')
  jest.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, recordKey) {
    if (this.name === 'bundles' && recordKey === 'rejected-new') throw new DOMException('synthetic quota', 'QuotaExceededError')
    return put.call(this, value, recordKey)
  })
  await expect(local.save(chart(), { importId: 'rejected-new', signal: new AbortController().signal })).rejects.toThrow('已保留先前病歷')
  expect(sessionStorage.getItem('__bundle_session_key__')).toBe(key)
  expect(sessionStorage.getItem('fhir_bundle_override')).toBe(marker)
  const reloaded = await service()
  expect(await reloaded.load()).toEqual(previous)
  expect(reloaded.getActiveImportId()).toBe('recovered-cloud')
})

test('a failed replacement envelope preserves the previous encrypted chart, images and original FHIR across reload', async () => {
  const local = await service(), previous = chart(), source = new Blob([JSON.stringify(previous)])
  await local.save(previous, { importId: 'previous', originalFhir: source, signal: new AbortController().signal })
  const marker = sessionStorage.getItem('fhir_bundle_override'), key = sessionStorage.getItem('__bundle_session_key__')
  const put = FakeObjectStore.prototype.put
  jest.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, recordKey) {
    if (this.name === 'bundles' && recordKey === 'unpublished') throw new DOMException('synthetic quota', 'QuotaExceededError')
    return put.call(this, value, recordKey)
  })
  await expect(local.save(chart(), { importId: 'unpublished', signal: new AbortController().signal })).rejects.toThrow('已保留先前病歷')
  expect(sessionStorage.getItem('fhir_bundle_override')).toBe(marker)
  expect(sessionStorage.getItem('__bundle_session_key__')).toBe(key)
  const reloaded = await service()
  expect(await reloaded.load()).toEqual(previous)
  expect(await (await reloaded.loadOriginalFhir())!.text()).toBe(await source.text())
  const ref = (previous.entry[1].resource as any).presentedForm[0]._imageRef
  expect(Array.from(new Uint8Array(await (await reloaded.getImage(ref))!.arrayBuffer()))).toEqual([1, 2, 3])
})

test('abort during real encryption leaves the previous key, source and images readable after reload', async () => {
  const local = await service(), previous = chart(), source = new Blob([JSON.stringify(previous)])
  await local.save(previous, { importId: 'previous', originalFhir: source, signal: new AbortController().signal })
  const key = sessionStorage.getItem('__bundle_session_key__'), marker = sessionStorage.getItem('fhir_bundle_override')
  const cancellation = new AbortController(), encrypt = webcrypto.subtle.encrypt.bind(webcrypto.subtle)
  jest.spyOn(webcrypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => { cancellation.abort('cancelled'); return encrypt(...args) })
  await expect(local.save(chart(), { importId: 'aborted', signal: cancellation.signal })).rejects.toBeDefined()
  expect(sessionStorage.getItem('__bundle_session_key__')).toBe(key)
  expect(sessionStorage.getItem('fhir_bundle_override')).toBe(marker)
  const reloaded = await service()
  expect(await reloaded.load()).toEqual(previous)
  expect(await (await reloaded.loadOriginalFhir())!.text()).toBe(await source.text())
  const ref = (previous.entry[1].resource as any).presentedForm[0]._imageRef
  expect(Array.from(new Uint8Array(await (await reloaded.getImage(ref))!.arrayBuffer()))).toEqual([1, 2, 3])
})

test.each(['enriched', 'unavailable', 'not-applicable'])(
  'a late %s terminology refresh cannot overwrite the newer hospital chart or its original source', async status => {
  const local = await service(), queue = await import('@/src/infrastructure/fhir/services/local-bundle-mutation-queue')
  const old = chart(), newer = { ...chart(), id: 'hospital-snapshot' }, original = new Blob([JSON.stringify(newer)])
  await local.save(old, { importId: 'cloud', signal: new AbortController().signal })
  let finish!: (value: unknown) => void
  mockEnrich.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const parsing = local.parseStored()
  while (!finish) await Promise.resolve()
  await queue.serializeLocalBundleMutation(() => local.save(newer, { importId: 'hospital', originalFhir: original, signal: new AbortController().signal }))
  finish({ bundle: { ...old, id: 'late-old-enrichment' }, report: { status, linkedRequestCount: status === 'enriched' ? 1 : 0 } })
  const parsed = await parsing
  await queue.serializeLocalBundleMutation(async () => {})
  expect(local.getActiveImportId()).toBe('hospital')
  expect(await local.load()).toBe(newer)
  expect(parsed).toEqual(local.parse(newer))
  expect(await (await local.loadOriginalFhir())!.text()).toBe(await original.text())
})

test('terminology persistence is queued without deadlocking the importing query refresh', async () => {
  const local = await service(), queue = await import('@/src/infrastructure/fhir/services/local-bundle-mutation-queue')
  const original = chart(), enriched = { ...original, id: 'derived-view' }
  await local.save(original, { importId: 'cloud', signal: new AbortController().signal })
  mockEnrich.mockResolvedValueOnce({ bundle: enriched, report: { status: 'enriched', linkedRequestCount: 1 } })
  await queue.serializeLocalBundleMutation(async () => { expect(await local.parseStored()).not.toBeNull() })
  await queue.serializeLocalBundleMutation(async () => {})
  expect(await local.load()).toBe(enriched)
})

test.each(['enriched', 'unavailable', 'not-applicable'])(
  'a %s terminology refresh resolving after clear does not resurrect the old patient', async status => {
  const local = await service(), queue = await import('@/src/infrastructure/fhir/services/local-bundle-mutation-queue')
  const previous = chart()
  await local.save(previous, { importId: 'cleared', signal: new AbortController().signal })
  let finish!: (value: unknown) => void
  mockEnrich.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const parsing = local.parseStored()
  while (!finish) await Promise.resolve()
  await queue.serializeLocalBundleMutation(() => local.clear())
  finish({ bundle: previous, report: { status, linkedRequestCount: status === 'enriched' ? 1 : 0 } })
  expect(await parsing).toBeNull()
  expect(local.hasData()).toBe(false)
})
