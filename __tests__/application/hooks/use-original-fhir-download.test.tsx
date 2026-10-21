import { act, renderHook, waitFor } from '@testing-library/react'
import { useOriginalFhirDownload } from '@/src/application/hooks/use-original-fhir-download'

let mockImportId = 'first'
const mockHasOriginal = jest.fn()
const mockLoadOriginal = jest.fn()
const mockSerialize = jest.fn()
const mockCreateObjectURL = jest.fn()

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({
  shouldUseLocalBundle: () => true,
}))
jest.mock('@/src/infrastructure/fhir/services/local-bundle.service', () => ({
  LocalBundleService: {
    getActiveImportId: () => mockImportId,
    hasOriginalFhir: () => mockHasOriginal(),
    loadOriginalFhir: () => mockLoadOriginal(),
  },
}))
jest.mock('@/src/infrastructure/fhir/services/local-bundle-mutation-queue', () => ({
  serializeLocalBundleMutation: (callback: () => Promise<unknown>) => mockSerialize(callback),
}))

beforeEach(() => {
  mockImportId = 'first'
  mockHasOriginal.mockReset().mockResolvedValue(true)
  mockLoadOriginal.mockReset()
  mockSerialize.mockReset().mockImplementation((callback: () => Promise<unknown>) => callback())
  mockCreateObjectURL.mockReset()
  URL.createObjectURL = mockCreateObjectURL
})

it('does not download a replacement patient when an import wins the mutation queue', async () => {
  const { result } = renderHook(() => useOriginalFhirDownload())
  await waitFor(() => expect(result.current.available).toBe(true))
  let runQueued: () => Promise<unknown> = async () => undefined
  let release: (value: unknown) => void = () => undefined
  mockSerialize.mockImplementation((callback: () => Promise<unknown>) => {
    runQueued = callback
    return new Promise(resolve => { release = resolve })
  })
  let downloading: Promise<void>
  act(() => { downloading = result.current.download() })
  mockImportId = 'replacement'
  await act(async () => {
    release(await runQueued())
    await downloading
  })
  expect(mockLoadOriginal).not.toHaveBeenCalled()
  expect(mockCreateObjectURL).not.toHaveBeenCalled()
  expect(result.current.available).toBe(false)
})

it('keeps a local read error visible instead of hiding the download section', async () => {
  mockHasOriginal.mockRejectedValue(new Error('Synthetic IndexedDB read failure'))
  const { result } = renderHook(() => useOriginalFhirDownload())
  await waitFor(() => expect(result.current.failed).toBe(true))
  expect(result.current.isLocal).toBe(true)
})
