import { renderHook, waitFor } from '@testing-library/react'
import { useImportBundle } from '@/features/import-bundle/hooks/useImportBundle'

const mockHasData = jest.fn()
const mockLoad = jest.fn()
const mockIsDemoData = jest.fn()
const mockShouldUseLocalBundle = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@/src/infrastructure/fhir/services/local-bundle.service', () => ({
  LocalBundleService: {
    hasData: () => mockHasData(),
    load: () => mockLoad(),
    isDemoData: () => mockIsDemoData(),
  },
}))

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({
  shouldUseLocalBundle: () => mockShouldUseLocalBundle(),
}))

jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({
  purgeAiResultCaches: jest.fn(),
  purgeExpiredAiResultCaches: jest.fn(),
}))

jest.mock('@/src/shared/utils/id.utils', () => ({
  generateId: () => 'test-import-id',
}))

jest.mock('@/src/infrastructure/fhir/services/local-bundle-mutation-queue', () => ({
  serializeLocalBundleMutation: (mutation: () => Promise<void>) => mutation(),
}))

jest.mock('@/src/shared/utils/reset-on-bundle-change', () => ({
  BUNDLE_CHANGED_EVENT: 'mediprisma:local-bundle-changed',
  notifyBundleChangeSettled: jest.fn(),
  notifyBundleChanged: jest.fn(),
}))

describe('useImportBundle initial bundle reconciliation', () => {
  beforeEach(() => {
    mockHasData.mockReset()
    mockLoad.mockReset()
    mockIsDemoData.mockReset()
    mockShouldUseLocalBundle.mockReset()
    mockIsDemoData.mockReturnValue(false)
    mockShouldUseLocalBundle.mockReturnValue(false)
  })

  it('does not publish a shared marker as local data when this tab cannot load it', async () => {
    mockHasData
      .mockReturnValueOnce(true) // origin-wide marker seen before validation
      .mockReturnValue(false) // load() purges the inaccessible record
    mockLoad.mockResolvedValue(null)

    const { result } = renderHook(() => useImportBundle())

    expect(result.current.hasBundle).toBe(false)
    expect(result.current.bundleIsActive).toBe(false)

    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockHasData).toHaveBeenCalledTimes(2))

    expect(result.current.hasBundle).toBe(false)
    expect(result.current.bundleIsActive).toBe(false)
  })

  it('publishes the badge after the current tab successfully loads the bundle', async () => {
    mockHasData.mockReturnValue(true)
    mockLoad.mockResolvedValue({ resourceType: 'Bundle' })
    mockShouldUseLocalBundle.mockReturnValue(true)

    const { result } = renderHook(() => useImportBundle())

    expect(result.current.hasBundle).toBe(false)

    await waitFor(() => expect(result.current.hasBundle).toBe(true))
    expect(result.current.bundleIsActive).toBe(true)
    expect(mockLoad).toHaveBeenCalledTimes(1)
  })
})

jest.mock('@/src/application/hooks/medical-summary/summary-versions.store', () => ({ persistSummaryVersions: jest.fn(async () => {}) }))
