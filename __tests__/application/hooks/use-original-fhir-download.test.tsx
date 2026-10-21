import { act, renderHook, waitFor } from '@testing-library/react'
import { useOriginalFhirDownload } from '@/src/application/hooks/use-original-fhir-download'

let mockImportId = 'first'
const mockHasOriginal = jest.fn()
const mockLoadOriginal = jest.fn()
const mockLoadBundle = jest.fn()
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
    load: () => mockLoadBundle(),
  },
}))
jest.mock('@/src/infrastructure/fhir/services/local-bundle-mutation-queue', () => ({
  serializeLocalBundleMutation: (callback: () => Promise<unknown>) => mockSerialize(callback),
}))

beforeEach(() => {
  mockImportId = 'first'
  mockHasOriginal.mockReset().mockResolvedValue(true)
  mockLoadOriginal.mockReset()
  mockLoadBundle.mockReset().mockResolvedValue(null)
  mockSerialize.mockReset().mockImplementation((callback: () => Promise<unknown>) => callback())
  mockCreateObjectURL.mockReset()
  URL.createObjectURL = mockCreateObjectURL
})

it('labels the unchanged original Blob with its own source patient and national ID', async () => {
  const original = new Blob(['unchanged original FHIR'])
  mockLoadOriginal.mockResolvedValue(original)
  mockLoadBundle.mockResolvedValue({ resourceType: 'Bundle', entry: [{ resource: {
    resourceType: 'Patient', id: 'source-patient', name: [{ text: '王小明' }],
    identifier: [
      { type: { coding: [{ code: 'MR' }] }, value: 'chart-123' },
      { type: { coding: [{ code: 'NI' }] }, value: 'A123456789' },
    ],
  } }] })
  mockCreateObjectURL.mockReturnValue('blob:original')
  let downloadedName = ''
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadedName = this.download
  })
  const { result } = renderHook(() => useOriginalFhirDownload())
  await waitFor(() => expect(result.current.available).toBe(true))
  await act(() => result.current.download())
  expect(downloadedName).toMatch(/^FHIR_original_王小明_A123456789_\d{8}\.json$/)
  expect(mockCreateObjectURL).toHaveBeenCalledWith(original)
  click.mockRestore()
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
