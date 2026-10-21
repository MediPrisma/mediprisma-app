import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useImportBundle } from '@/features/import-bundle/hooks/useImportBundle'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { prepareLocalImportFile } from '@/features/import-bundle/services/local-import-file.service'

jest.mock('@/features/import-bundle/services/local-import-file.service', () => ({ prepareLocalImportFile: jest.fn() }))
jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({ purgeAiResultCaches: jest.fn(), purgeExpiredAiResultCaches: jest.fn() }))

it('rejects an ambiguous legacy stored chart while retaining its original downloadable source', async () => {
  const bundle = { resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'first' } },
    { resource: { resourceType: 'Patient', id: 'second' } },
  ] }
  const originalFhir = new Blob([JSON.stringify(bundle)], { type: 'application/fhir+json' })
  try {
    await LocalBundleService.save(bundle, { originalFhir })
    const importId = LocalBundleService.getActiveImportId()
    await expect(LocalBundleService.parseStored()).rejects.toThrow('單一病人的 FHIR Bundle')
    expect(await LocalBundleService.load()).toEqual(bundle)
    expect(await LocalBundleService.loadOriginalFhir()).toBe(originalFhir)
    expect(LocalBundleService.getActiveImportId()).toBe(importId)
  } finally {
    await LocalBundleService.clear()
  }
})

it.each(['multiple-patients', 'foreign-subject'])('keeps the loaded patient and original bytes when a later %s import is rejected', async kind => {
  const single = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'patient-a' } }] }
  const source = JSON.stringify(single)
  const original = new Blob([source], { type: 'application/fhir+json' })
  const multi = kind === 'multiple-patients' ? { resourceType: 'Bundle', entry: [
    { fullUrl: 'https://one.invalid/Patient/patient-a', resource: { resourceType: 'Patient', id: 'patient-a' } },
    { fullUrl: 'https://two.invalid/Patient/patient-a', resource: { resourceType: 'Patient', id: 'patient-a' } },
  ] } : { resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'patient-a' } },
    { resource: { resourceType: 'MedicationRequest', id: 'foreign', subject: { reference: 'Patient/patient-b' } } },
  ] }
  jest.mocked(prepareLocalImportFile)
    .mockResolvedValueOnce({ bundle: single, originalFhir: original } as any)
    .mockResolvedValueOnce({ bundle: multi, originalFhir: new Blob([JSON.stringify(multi)]) } as any)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => useImportBundle(), { wrapper })
  try {
    await act(async () => { await result.current.importFile(new File(['first'], 'first.json')) })
    const importId = LocalBundleService.getActiveImportId()
    await act(async () => { await expect(result.current.importFile(new File(['second'], 'second.json'))).rejects.toThrow('單一病人的 FHIR Bundle') })
    expect(LocalBundleService.getActiveImportId()).toBe(importId)
    expect((await LocalBundleService.load() as any).entry[0].resource.id).toBe('patient-a')
    expect(await LocalBundleService.loadOriginalFhir()).toBe(original)
    expect(result.current.hasBundle).toBe(true)
    expect(result.current.error).toContain('單一病人')
  } finally {
    unmount()
    queryClient.clear()
    await LocalBundleService.clear()
  }
})
