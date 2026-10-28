import { webcrypto } from 'crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { deserialize, serialize } from 'node:v8'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'

const originalCrypto = globalThis.crypto
const originalBlob = globalThis.Blob, originalClone = globalThis.structuredClone, originalIDB = globalThis.indexedDB
jest.mock('@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.worker-client', () => ({
  enrichBundleWithNhiDrugTerminologyOffMainThread: async (bundle: unknown) => ({ bundle, report: { status: 'not-applicable', linkedRequestCount: 0 } }),
}))
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true })
  globalThis.structuredClone = <T,>(value: T): T => deserialize(serialize(value))
})
beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new FakeIDBFactory(), configurable: true })
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
/** A fictional cloud chart: no inline images, like a 雲端病歷 export. */
const cloudChart = () => ({ resourceType: 'Bundle', entry: [
  { resource: { resourceType: 'Patient', id: 'synthetic-patient', gender: 'female' } },
  { resource: { resourceType: 'Observation', id: 'obs-1', status: 'final', code: { text: 'Creatinine' }, subject: { reference: 'Patient/synthetic-patient' }, valueQuantity: { value: 1.1, unit: 'mg/dL' } } },
] })
const chartWithImage = () => ({ resourceType: 'Bundle', entry: [
  ...cloudChart().entry,
  { resource: { resourceType: 'DiagnosticReport', id: 'image-a', status: 'final', code: { text: 'CXR' }, subject: { reference: 'Patient/synthetic-patient' }, presentedForm: [{ contentType: 'image/png', data: 'AQID' }] } },
] })

describe('an import is parsed once, not again when the workspace first reads it', () => {
  test.each([
    ['plain save', false],
    ['guarded progressive save', true],
  ])('%s hands the validator parse to the workspace', async (_label, guarded) => {
    const local = await service()
    const parse = jest.spyOn(local, 'parse')
    const bundle = cloudChart()
    const validated = local.validateImport(bundle, { importId: 'import-a' })
    expect(validated).not.toBeNull()
    await local.save(bundle, { importId: 'import-a', ...(guarded ? { signal: new AbortController().signal } : {}) })

    const shown = await local.parseStored()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(shown?.patient.id).toBe('synthetic-patient')
    expect(shown?.collection).toBe(validated?.collection)
  })

  it('shows exactly what a fresh parse of the saved chart shows', async () => {
    const local = await service()
    const bundle = cloudChart()
    local.validateImport(bundle, { importId: 'import-a' })
    await local.save(bundle, { importId: 'import-a' })
    const shown = await local.parseStored()
    expect(JSON.stringify(shown)).toBe(JSON.stringify(local.parse(cloudChart(), undefined, 'import-a')))
  })

  it('parses again when save moved inline images out of the chart', async () => {
    const local = await service()
    const parse = jest.spyOn(local, 'parse')
    const bundle = chartWithImage()
    local.validateImport(bundle, { importId: 'import-a' })
    await local.save(bundle, { importId: 'import-a' })

    const shown = await local.parseStored()
    expect(parse).toHaveBeenCalledTimes(2)
    // The workspace keeps the stored reference, never the validator's base64 copy.
    expect(JSON.stringify(shown)).not.toContain('"AQID"')
  })

  it('parses again when the chart is saved under another import id or source', async () => {
    const local = await service()
    const parse = jest.spyOn(local, 'parse')
    const first = cloudChart()
    local.validateImport(first, { importId: 'import-a' })
    await local.save(first, { importId: 'import-b' })
    await local.parseStored()
    expect(parse).toHaveBeenCalledTimes(2)

    parse.mockClear()
    const second = cloudChart()
    local.validateImport(second, { importId: 'import-c' })
    await local.save(second, { importId: 'import-c', sourceMetadata: { sourceKind: 'synthetic' } as never })
    await local.parseStored()
    expect(parse).toHaveBeenCalledTimes(2)
  })
})
