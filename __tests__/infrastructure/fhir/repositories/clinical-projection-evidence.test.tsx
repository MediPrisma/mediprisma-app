import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { buildSourceCatalog, buildLongitudinalInvestigationContext, GenerateMedicalSummaryUseCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { useResourceAnchor } from '@/src/application/hooks/use-resource-anchor.hook'
import { useResourceNavigationStore } from '@/src/application/stores/resource-navigation.store'
import { buildIpsBundle } from '@/features/ips-export/utils/ips-builder'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/application/telemetry/usage-analytics', () => ({ trackEvent: jest.fn() }))

const observation = (version: string, value: number, date: string) => ({ resourceType: 'Observation', id: 'same-fhir-id', meta: { versionId: version }, status: 'final', code: { text: 'Synthetic lab' }, category: [{ coding: [{ code: 'laboratory' }] }], valueQuantity: { value, unit: 'mg/dL' }, effectiveDateTime: date })
const obsEntries = [
  { fullUrl: 'urn:uuid:observation-one', resource: observation('1', 10, '2026-07-01') },
  { fullUrl: 'urn:uuid:observation-two', resource: observation('2', 20, '2026-07-02') },
]
const reportEntries = obsEntries.map((entry, index) => ({ fullUrl: 'urn:uuid:report-' + index, resource: { resourceType: 'DiagnosticReport', id: 'same-report-id', meta: { versionId: String(index + 1) }, status: 'final', code: { text: 'Synthetic report' }, category: [{ coding: [{ code: 'LAB' }] }], effectiveDateTime: entry.resource.effectiveDateTime, result: [{ reference: entry.fullUrl }] } }))

beforeEach(() => {
  jest.resetAllMocks()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://evidence.example/fhir' } })
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Observation?') ? obsEntries : url.startsWith('DiagnosticReport?') ? [...reportEntries, ...obsEntries] : [] }))
  HTMLElement.prototype.scrollIntoView = jest.fn()
  useResourceNavigationStore.setState({ pending: null, seq: 0, consumedSeq: 0 })
})

it('keeps stable distinct record IDs across exact include/query copies and refresh generations', async () => {
  const repository = new FhirClinicalDataRepository()
  const collection = await repository.fetchAllClinicalData('synthetic-patient')
  expect(new Set(collection.observations.map(row => row.id)).size).toBe(2)
  expect(new Set(collection.diagnosticReports.map(row => row.id)).size).toBe(2)
  expect(collection.observations.map(row => row.sourceId)).toEqual(['same-fhir-id', 'same-fhir-id'])
  for (const report of collection.diagnosticReports) {
    const member = report._observations![0]
    expect(member.id).toBe(collection.observations.find(row => row.valueQuantity?.value === member.valueQuantity?.value)?.id)
    expect(report.result![0].reference).toBe('Observation/' + member.id)
  }
  const refreshed = await repository.fetchObservations('synthetic-patient')
  expect(refreshed.map(row => row.id)).toEqual(collection.observations.map(row => row.id))
  expect(refreshed[0].clinicalSourceNodeKey).not.toBe(collection.observations[0].clinicalSourceNodeKey)
})

it('preserves both values through catalog, longitudinal evidence, final metric and IPS export', async () => {
  const collection = await new FhirClinicalDataRepository().fetchAllClinicalData('synthetic-patient')
  const scoped: any = scopeClinicalDataForAi(collection, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  const catalog = buildSourceCatalog(scoped)
  const evidence = buildLongitudinalInvestigationContext(scoped, catalog)
  const observationSources = catalog.filter(entry => entry.resourceType === 'Observation')
  expect(observationSources).toHaveLength(2)
  for (const row of collection.observations) {
    const entry = observationSources.find(source => source.resourceId === row.id)!
    expect(evidence).toContain(`${row.valueQuantity!.value} mg/dL (${row.effectiveDateTime}; ${entry.key})`)
  }
  const result = new GenerateMedicalSummaryUseCase().finalizeResult({ headline: 'Synthetic', medicationEducation: [], problems: [{ label: 'Synthetic lab', kind: 'lab', metricSources: observationSources.map(entry => entry.key) }] }, catalog, { clinicalData: scoped })
  expect(result.problems[0].metric).toContain('10')
  expect(result.problems[0].metric).toContain('20')
  expect(result.sourceIndex.map(entry => entry.resourceId).sort()).toEqual(collection.observations.map(row => row.id).sort())
  expect(JSON.stringify(scoped)).not.toContain('clinicalSource')
  const bundle = buildIpsBundle({ patient: null, data: collection })
  const exported = bundle.entry.map(entry => entry.resource).filter(resource => resource.resourceType === 'Observation')
  expect(exported.map((resource: any) => resource.valueQuantity?.value).sort()).toEqual([10, 20])
  expect(new Set(exported.map(resource => resource.id)).size).toBe(2)
})

it('navigates each cited stable record to its matching UI source row', async () => {
  const collection = await new FhirClinicalDataRepository().fetchAllClinicalData('synthetic-patient')
  const scoped: any = scopeClinicalDataForAi(collection, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  const sources = buildSourceCatalog(scoped).filter(entry => entry.resourceType === 'Observation')
  const claimed = jest.fn()
  function Row({ row }: { row: typeof collection.observations[number] }) {
    const ref = useResourceAnchor('Observation', row.id, () => claimed(row.id))
    return <div ref={ref}>{row.valueQuantity?.value}</div>
  }
  const view = render(<>{collection.observations.map(row => <Row key={row.id} row={row} />)}</>)
  for (const source of sources) {
    claimed.mockClear()
    act(() => useResourceNavigationStore.getState().navigate({ resourceType: source.resourceType, resourceId: source.resourceId }))
    await waitFor(() => expect(claimed).toHaveBeenCalledTimes(1))
    expect(claimed).toHaveBeenCalledWith(source.resourceId)
    expect(collection.observations.find(row => row.id === source.resourceId)).toBeDefined()
  }
  view.unmount()
})

it('unifies fullUrl-only exact copies in scope even when the FHIR source id is absent', async () => {
  const withoutIds = obsEntries.map(entry => ({ ...entry, resource: { ...entry.resource, id: undefined } }))
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Observation?') ? withoutIds : url.startsWith('DiagnosticReport?') ? [...reportEntries, ...withoutIds] : [] }))
  const collection = await new FhirClinicalDataRepository().fetchAllClinicalData('synthetic-patient')
  const scoped = scopeClinicalDataForAi(collection, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  expect(scoped.observations).toHaveLength(2)
  expect(new Set(scoped.observations?.map(row => row.id)).size).toBe(2)
  expect(collection.observations.map(row => row.sourceId)).toEqual([undefined, undefined])
})
