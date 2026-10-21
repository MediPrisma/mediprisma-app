import { webcrypto } from 'crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { deserialize, serialize } from 'node:v8'
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'

const mockEnrich = jest.fn()
jest.mock('@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.worker-client', () => ({ enrichBundleWithNhiDrugTerminologyOffMainThread: (...args: unknown[]) => mockEnrich(...args) }))
const originals = { crypto: globalThis.crypto, Blob: globalThis.Blob, clone: globalThis.structuredClone, idb: globalThis.indexedDB }
beforeAll(() => {
 Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
 Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true })
 globalThis.structuredClone = <T,>(value: T): T => deserialize(serialize(value))
})
beforeEach(() => {
 jest.resetModules()
 Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true })
 sessionStorage.clear()
 mockEnrich.mockReset().mockImplementation(async bundle => ({ bundle, report: { status: 'skipped', linkedRequestCount: 0 } }))
})
afterEach(() => { jest.restoreAllMocks(); sessionStorage.clear() })
afterAll(() => {
 Object.defineProperty(globalThis, 'crypto', { value: originals.crypto, configurable: true })
 Object.defineProperty(globalThis, 'Blob', { value: originals.Blob, configurable: true })
 Object.defineProperty(globalThis, 'indexedDB', { value: originals.idb, configurable: true })
 globalThis.structuredClone = originals.clone
})
function snapshot(value: number, hospital: boolean) {
 return { resourceType: 'Bundle', type: 'collection', entry: [
  { fullUrl: 'https://synthetic.example/fhir/Patient/same-patient', resource: { resourceType: 'Patient', id: 'same-patient' } },
  { fullUrl: 'https://synthetic.example/fhir/Observation/lab', resource: { resourceType: 'Observation', id: 'lab', status: 'final', code: { text: 'Synthetic lab' }, valueQuantity: { value } } },
  { resource: { resourceType: 'Condition', id: 'cloud-condition', code: { text: 'Cloud condition' } } },
  ...(hospital ? [{ resource: { resourceType: 'Condition', id: 'hospital-condition', code: { text: 'Hospital condition' } } }] : []),
  { fullUrl: 'urn:uuid:source-only', resource: { resourceType: 'MolecularSequence', id: 'source-only', observedSeq: hospital ? 'CG' : 'AT' } },
 ] }
}
async function bytes(blob: Blob | null) { return Array.from(new Uint8Array(await blob!.arrayBuffer())) }
async function localService() { return (await import('@/src/infrastructure/fhir/services/local-bundle.service')).LocalBundleService }

test('guarded cloud to mixed hospital replacement updates the same patient graph atomically and preserves it on cancel/failure', async () => {
 const local = await localService()
 const cloud = snapshot(7, false), cloudRaw = new Blob(['\uFEFF', JSON.stringify(cloud, null, 2), '\r\n'])
 await local.save(cloud, { importId: 'cloud-stage', signal: new AbortController().signal, originalFhir: cloudRaw })
 const cloudParsed = (await local.parseStored())!
 const cloudView = projectClinicalAggregate(cloudParsed.collection)
 expect(cloudView.observations[0].valueQuantity?.value).toBe(7)
 expect(cloudView.conditions).toHaveLength(1)
 const cloudSource = cloudView.clinicalSource!
 expect(cloudSource.graph.nodes.some(node => node.resource.resourceType === 'MolecularSequence')).toBe(true)
 expect(await bytes(await local.loadOriginalFhir())).toEqual(await bytes(cloudRaw))
 const hospital = snapshot(9, true), hospitalRaw = new Blob([JSON.stringify(hospital, null, 1), '\n'])
 await local.save(hospital, { importId: 'hospital-stage', signal: new AbortController().signal, originalFhir: hospitalRaw, beforeCommit: () => expect(local.getActiveImportId()).toBe('cloud-stage') })
 const hospitalParsed = (await local.parseStored())!
 const view = projectClinicalAggregate(hospitalParsed.collection)
 expect(hospitalParsed.patient.id).toBe(cloudParsed.patient.id)
 expect(view.observations).toHaveLength(1)
 expect(view.observations[0].valueQuantity?.value).toBe(9)
 expect(view.conditions).toHaveLength(2)
 const source = view.clinicalSource!
 expect(JSON.stringify(source)).not.toBe(JSON.stringify(cloudSource))
 expect(source.graph.nodes.every(node => node.sourceId === 'local-bundle:hospital-stage')).toBe(true)
 expect(source.graph.nodes.find(node => node.resource.resourceType === 'Observation')?.resource.valueQuantity).toEqual({ value: 9 })
 expect(cloudSource.graph.nodes.find(node => node.resource.resourceType === 'Observation')?.resource.valueQuantity).toEqual({ value: 7 })
 expect(source.graph.nodes.find(node => node.resource.resourceType === 'MolecularSequence')?.fullUrl).toBe('urn:uuid:source-only')
 expect(await bytes(await local.loadOriginalFhir())).toEqual(await bytes(hospitalRaw))
 const controller = new AbortController()
 await expect(local.save(snapshot(66, true), { importId: 'cancelled-stage', signal: controller.signal, beforeCommit: () => controller.abort('synthetic-cancel'), originalFhir: new Blob(['cancelled']) })).rejects.toBeDefined()
 const put = FakeObjectStore.prototype.put
 jest.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
  if (this.name === 'bundles' && key === 'failed-stage') throw new DOMException('Synthetic quota', 'QuotaExceededError')
  return put.call(this, value, key)
 })
 await expect(local.save(snapshot(77, true), { importId: 'failed-stage', signal: new AbortController().signal, originalFhir: new Blob(['failed']) })).rejects.toThrow('已保留先前病歷')
 expect(local.getActiveImportId()).toBe('hospital-stage')
 expect(await local.load()).toBe(hospital)
 expect((await local.parseStored())!.collection.clinicalSource).toBe(source)
 expect(await bytes(await local.loadOriginalFhir())).toEqual(await bytes(hospitalRaw))
})

test('late cloud terminology cannot reintroduce its cached graph after the hospital snapshot publishes', async () => {
 const local = await localService()
 const cloud = snapshot(7, false)
 await local.save(cloud, { importId: 'cloud-stage', signal: new AbortController().signal })
 let finish!: (result: unknown) => void
 mockEnrich.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
 const pending = local.parseStored()
 while (!finish) await Promise.resolve()
 const hospital = snapshot(9, true), raw = new Blob([JSON.stringify(hospital)])
 await local.save(hospital, { importId: 'hospital-stage', signal: new AbortController().signal, originalFhir: raw })
 finish({ bundle: snapshot(88, false), report: { status: 'enriched', linkedRequestCount: 1 } })
 const parsed = (await pending)!
 const view = projectClinicalAggregate(parsed.collection)
 expect(view.observations[0].valueQuantity?.value).toBe(9)
 expect(view.conditions).toHaveLength(2)
 expect(view.clinicalSource!.graph.nodes.every(node => node.sourceId === 'local-bundle:hospital-stage')).toBe(true)
 const queue = await import('@/src/infrastructure/fhir/services/local-bundle-mutation-queue')
 await queue.serializeLocalBundleMutation(async () => {})
 expect(await local.load()).toBe(hospital)
 expect(await bytes(await local.loadOriginalFhir())).toEqual(await bytes(raw))
})

test('a new guarded stage cannot reuse the preceding import graph cache for the same bundle object', async () => {
 const local = await localService(), bundle = snapshot(7, false)
 await local.save(bundle, { importId: 'first-scope', signal: new AbortController().signal })
 const first = (await local.parseStored())!.collection.clinicalSource!
 await local.save(bundle, { importId: 'second-scope', signal: new AbortController().signal })
 const second = (await local.parseStored())!.collection.clinicalSource!
 expect(second).not.toBe(first)
 expect(second.graph.nodes.every(node => node.sourceId === 'local-bundle:second-scope')).toBe(true)
 expect(first.graph.nodes.every(node => node.sourceId === 'local-bundle:first-scope')).toBe(true)
})
