import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { useResourceAnchor } from '@/src/application/hooks/use-resource-anchor.hook'
import { useResourceNavigationStore } from '@/src/application/stores/resource-navigation.store'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/application/telemetry/usage-analytics', () => ({ trackEvent: jest.fn() }))

const entries = ['a', 'b'].flatMap(label => [
  { fullUrl: `urn:uuid:encounter-${label}`, resource: { resourceType: 'Encounter', id: 'same-visit', status: 'finished', period: { start: '2026-10-01' }, type: [{ text: `Visit ${label}` }] } },
  { fullUrl: `urn:uuid:condition-${label}`, resource: { resourceType: 'Condition', id: 'same-problem', clinicalStatus: { coding: [{ code: 'active' }] }, category: [{ coding: [{ code: 'problem-list-item' }] }], recordedDate: '2026-10-01', code: { text: `Problem ${label}` }, encounter: { reference: `urn:uuid:encounter-${label}` } } },
  { fullUrl: `urn:uuid:medication-${label}`, resource: { resourceType: 'MedicationRequest', id: 'same-order', status: 'active', authoredOn: '2026-10-01', medicationCodeableConcept: { text: `Drug ${label}` }, encounter: { reference: `urn:uuid:encounter-${label}` } } },
])

beforeEach(() => {
  jest.resetAllMocks()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://ehr.invalid/fhir' } })
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: entries.filter(entry => url.startsWith(`${entry.resource.resourceType}?`)) }))
  HTMLElement.prototype.scrollIntoView = jest.fn()
  useResourceNavigationStore.setState({ pending: null, seq: 0, consumedSeq: 0 })
})

it('keeps colliding generic source IDs distinct through references, AI citations and UI navigation', async () => {
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('patient')
  for (const rows of [data.conditions, data.medications, data.encounters]) {
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.id)).size).toBe(2)
    expect(rows.every(row => row.id?.startsWith('cs'))).toBe(true)
    expect(new Set(rows.map(row => row.sourceId)).size).toBe(1)
  }
  const source = data.clinicalSource!
  for (const row of [...data.conditions, ...data.medications]) {
    const edge = source.graph.references.find(edge => edge.origin.key === row.clinicalSourceNodeKey && edge.path === 'encounter')!
    const encounter = data.encounters.find(candidate => edge.targetKeys.includes(candidate.clinicalSourceNodeKey!))!
    expect(row.encounter?.reference).toBe(`Encounter/${encounter.id}`)
  }
  const scoped = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  const catalog = buildSourceCatalog(scoped).filter(entry => ['Condition', 'MedicationRequest'].includes(entry.resourceType))
  expect(catalog).toHaveLength(4)
  expect(new Set(catalog.map(entry => `${entry.resourceType}/${entry.resourceId}`)).size).toBe(4)
  const claimed = jest.fn()
  function Row({ row, type }: { row: { id?: string }; type: 'Condition' | 'MedicationRequest' }) {
    const ref = useResourceAnchor(type, row.id, () => claimed(type, row.id))
    return <div ref={ref}>{row.id}</div>
  }
  const view = render(<>{data.conditions.map(row => <Row key={row.id} row={row} type="Condition" />)}{data.medications.map(row => <Row key={row.id} row={row} type="MedicationRequest" />)}</>)
  for (const entry of catalog) {
    claimed.mockClear()
    act(() => useResourceNavigationStore.getState().navigate({ resourceType: entry.resourceType, resourceId: entry.resourceId }))
    await waitFor(() => expect(claimed).toHaveBeenCalledTimes(1))
    expect(claimed).toHaveBeenCalledWith(entry.resourceType, entry.resourceId)
  }
  view.unmount()
})

it('preserves legacy generic IDs when there is no collision and folds exact retransmissions only', async () => {
  const single = entries.filter(entry => entry.fullUrl.endsWith('-a'))
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: [...single, ...single].filter(entry => url.startsWith(`${entry.resource.resourceType}?`)) }))
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('patient')
  expect(data.conditions.map(row => row.id)).toEqual(['same-problem'])
  expect(data.medications.map(row => row.id)).toEqual(['same-order'])
  expect(data.encounters.map(row => row.id)).toEqual(['same-visit'])
})
