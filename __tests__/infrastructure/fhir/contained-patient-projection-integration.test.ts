import { webcrypto } from 'crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { deserialize, serialize } from 'node:v8'
import { IDBFactory } from 'fake-indexeddb'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
jest.mock('@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.worker-client', () => ({ enrichBundleWithNhiDrugTerminologyOffMainThread: async (bundle: unknown) => ({ bundle, report: { status: 'skipped', linkedRequestCount: 0 } }) }))
const original = { crypto: globalThis.crypto, Blob: globalThis.Blob, clone: globalThis.structuredClone, idb: globalThis.indexedDB }
beforeAll(() => {
 Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
 Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true })
 Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true })
 globalThis.structuredClone = <T,>(value: T): T => deserialize(serialize(value))
})
afterAll(async () => {
 await LocalBundleService.clear()
 Object.defineProperty(globalThis, 'crypto', { value: original.crypto, configurable: true })
 Object.defineProperty(globalThis, 'Blob', { value: original.Blob, configurable: true })
 Object.defineProperty(globalThis, 'indexedDB', { value: original.idb, configurable: true })
 globalThis.structuredClone = original.clone
})
function resources(reference: string, reachable = true) {
 const result: any[] = [{ resourceType: 'Patient', id: 'p' }, { resourceType: 'DiagnosticReport', id: 'report', status: 'final', subject: { reference: 'Patient/p' }, code: { text: 'Synthetic report' }, ...(reachable ? { result: [{ reference: '#panel' }] } : {}), contained: [{ resourceType: 'Observation', id: 'panel', status: 'final', hasMember: [{ reference: '#leaf' }] }, { resourceType: 'Observation', id: 'leaf', status: 'final', subject: { reference }, code: { text: 'Synthetic result' }, valueQuantity: { value: 99 } }] }]
 if (reference === '#subject') result[1].contained.push({ resourceType: 'Patient', id: 'subject' })
 return result
}
it.each(['Patient/b', '#subject'])('marks final aggregate and actual tool result coverage incomplete for a reachable contained patient exclusion: %s', async reference => {
 const source = reconcileClinicalSources([{ sourceId: 'synthetic', patientScope: 'p', generation: '1', resources: resources(reference) }])
 const report = source.graph.nodes.find(node => node.resource.resourceType === 'DiagnosticReport')!
 const empty = LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'p' } }] } as any)!.collection
 const collection: any = projectClinicalAggregate({ ...empty, observations: [], diagnosticReports: [{ id: 'report', clinicalSourceNodeKey: report.key }], conditions: [], medications: [], allergies: [], procedures: [], encounters: [], documentReferences: [], resourceQueryStatus: { Observation: { resourceType: 'Observation', state: 'ok', count: 0 }, DiagnosticReport: { resourceType: 'DiagnosticReport', state: 'ok', count: 1 } } } as any, source)
 expect(collection.observations.some((row: any) => row.sourceId === 'leaf')).toBe(false)
 expect(collection.resourceQueryStatus.Observation).toMatchObject({ state: 'error', excludedCount: 1 })
 expect(collection.resourceQueryStatus.DiagnosticReport).toMatchObject({ state: 'error', excludedCount: 1 })
 expect(source.graph.nodes.some(node => node.resource.id === 'leaf')).toBe(true)
 const overview: any = await createFhirTools(() => ({ patient: null, collection })).getDataOverview.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect(overview.data.observations).toMatchObject({ incomplete: true, canConcludeAbsence: false })
})
it('rejects actual Local reachable contained ownership mismatch while preserving the preceding chart, graph and source bytes', async () => {
 const previous = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'p' } }, { resource: { resourceType: 'Observation', id: 'good', status: 'final', valueQuantity: { value: 7 } } }] }
 const raw = new Blob(['\uFEFF', JSON.stringify(previous), '\n'])
 await LocalBundleService.save(previous, { importId: 'previous', originalFhir: raw, signal: new AbortController().signal })
 const graph = (await LocalBundleService.parseStored())!.collection.clinicalSource!
 const incoming = { resourceType: 'Bundle', entry: resources('Patient/b').map(resource => ({ resource })) }
 expect(() => LocalBundleService.parse(incoming as any)).toThrow(/無法安全匯入/)
 expect(await LocalBundleService.load()).toBe(previous)
 expect((await LocalBundleService.parseStored())!.collection.clinicalSource).toBe(graph)
 expect(await (await LocalBundleService.loadOriginalFhir())!.text()).toBe(await raw.text())
})
it('keeps detached contained patient snapshots source-only without rejecting a valid Local chart', () => {
 const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources('Patient/b', false).map(resource => ({ resource })) } as any)!
 expect(parsed.collection.observations).toEqual([])
 expect(parsed.collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'leaf')).toBe(true)
})
