import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { getClinicalDataRepository } from '@/src/application/composition'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

jest.mock('@/src/application/composition')
jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({ usePatientQuery: () => ({ data: { id: 'p' }, isLoading: false, isFetching: false }) }))

it('retains explicit Roche identifier result and hasMember derivations through the common hook', async () => {
  const identifier = (value: string, system = 'https://dip.roche.com/synthetic') => ({ system, value })
  const bundle = { resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'p' } },
    { resource: { resourceType: 'List', id: 'results', code: { text: 'Results' }, contained: [
      { resourceType: 'Observation', id: 'group', identifier: [identifier('group')], status: 'final', code: { text: 'Group' }, hasMember: [{ identifier: identifier('leaf') }] },
      { resourceType: 'Observation', id: 'leaf', identifier: [identifier('leaf')], status: 'final', code: { text: 'Leaf' }, valueString: 'correct value' },
      { resourceType: 'Observation', id: 'other', identifier: [identifier('leaf', 'https://other.invalid')], status: 'final', code: { text: 'Other' }, valueString: 'unrelated value' },
    ] } },
    { resource: { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Report' }, result: [{ identifier: identifier('group') }] } },
    { resource: { resourceType: 'DiagnosticReport', id: 'ambiguous', status: 'final', code: { text: 'Ambiguous report' }, result: [{ identifier: { value: 'leaf' } }] } },
  ] }
  const original = JSON.stringify(bundle)
  const collection = LocalBundleService.parse(bundle)!.collection
  jest.mocked(getClinicalDataRepository).mockResolvedValue({ fetchAllClinicalData: async () => collection } as any)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => useClinicalData(), { wrapper })
  try {
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const report = result.current.diagnosticReports.find(row => row.sourceId === 'report')!
    expect(report._observations?.map(row => row.sourceId)).toEqual(['group', 'leaf'])
    expect(report._observations?.[1].valueString).toBe('correct value')
    expect(report._observations?.every(row => result.current.observations.includes(row))).toBe(true)
    expect(result.current.diagnosticReports.find(row => row.sourceId === 'ambiguous')!._observations ?? []).toEqual([])
    expect(JSON.stringify(bundle)).toBe(original)
  } finally { unmount(); queryClient.clear() }
})
