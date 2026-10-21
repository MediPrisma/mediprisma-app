import { webcrypto } from 'crypto'

const originalCrypto = globalThis.crypto
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }))
afterAll(() => Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true }))
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
  for (const importId of ['visits-a', 'final-a']) {
    const updated = { ...chart(), id: importId }, updatedSource = new Blob([JSON.stringify(updated)])
    await local.save(updated, { importId, replaceImportId: local.getActiveImportId()!, originalFhir: updatedSource, signal: new AbortController().signal })
    expect(local.getActiveImportId()).toBe(importId)
    expect(await local.load()).toEqual(updated)
    expect(await local.loadOriginalFhir()).toBe(updatedSource)
  }
})

test('storage restriction does not swallow a cancellation or a changed active import guard', async () => {
  const local = await service(), previous = chart(), source = new Blob(['previous source'])
  await local.save(previous, { importId: 'previous', originalFhir: source })
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('synthetic restriction', 'SecurityError') })
  const controller = new AbortController()
  await expect(local.save(chart(), { importId: 'cancelled', signal: controller.signal, beforeCommit: () => controller.abort('cancelled') })).rejects.toBeDefined()
  expect(local.getActiveImportId()).toBe('previous')
  expect(await local.load()).toEqual(previous)
  expect(await local.loadOriginalFhir()).toBe(source)
  await expect(local.save(chart(), { importId: 'stale', signal: new AbortController().signal, beforeCommit: () => { throw new Error('active import changed') } })).rejects.toThrow('active import changed')
  expect(local.getActiveImportId()).toBe('previous')
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
  await expect(local.save(chart(), { importId: 'unpublished', replaceImportId: 'previous', signal: new AbortController().signal })).rejects.toThrow('bundle session marker unavailable')
  expect(sessionStorage.getItem('fhir_bundle_override')).toBe(marker)
  expect(sessionStorage.getItem('__bundle_session_key__')).toBe(key)
  expect(local.getActiveImportId()).toBe('previous')
  expect(await local.load()).toEqual(previous)
  expect(await local.loadOriginalFhir()).toBe(source)
})
