/** @jest-environment jsdom */
// The adaptive 初診 window as a mounted runner sees it: every chart is judged
// on its own (not its record count), and the cloud-record year is reverted
// only when this rule set it. Synthetic charts (PR #237 review, d834b140).
import { renderHook } from '@testing-library/react'
import { useAdaptiveDataDefaults } from '@/features/data-selection/hooks/useAdaptiveDataDefaults'
import { DEFAULT_DATA_FILTERS, MEDCLOUD_YEAR_DATA_FILTERS } from '@/src/shared/constants/data-selection.constants'

const mockSetFilters = jest.fn()
const mockSelectAll = jest.fn()
let mockFilters: any
jest.mock('@/src/application/providers/data-selection.provider', () => ({
  useDataSelection: () => ({ filters: mockFilters, activePreset: 'newPatient', selectAllData: mockSelectAll, setFilters: mockSetFilters }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ t: { dataSelection: {} } }) }))
jest.mock('@/src/application/stores/ai-config.store', () => ({ useOpenAiCompatibleProfiles: () => [] }))
jest.mock('sonner', () => ({ toast: { info: jest.fn() } }))

const MEDCLOUD = 'https://medcloud2.nhi.gov.tw'
const OTHER = 'https://example.org/fhir'
// Over 600 records: never "small", so only the window rule applies.
const chart = (source: string, prefix: string) => ({
  encounters: Array.from({ length: 601 }, (_, i) => ({ id: `${prefix}-${i}`, meta: { source }, period: { start: '2026-09-01' } })),
} as any)

beforeEach(() => {
  mockFilters = { ...DEFAULT_DATA_FILTERS }
  mockSetFilters.mockReset()
  mockSelectAll.mockReset()
  localStorage.clear()
})

it('judges a same-size chart from another source after the data clears', () => {
  const { rerender } = renderHook(({ data }) => useAdaptiveDataDefaults(data), { initialProps: { data: chart(OTHER, 'first') } })
  expect(mockSetFilters).not.toHaveBeenCalled()
  rerender({ data: null })
  rerender({ data: chart(MEDCLOUD, 'second') })
  expect(mockSetFilters).toHaveBeenCalledWith(MEDCLOUD_YEAR_DATA_FILTERS)
})

it('judges a same-size chart without the data clearing in between', () => {
  const { rerender } = renderHook(({ data }) => useAdaptiveDataDefaults(data), { initialProps: { data: chart(OTHER, 'first') } })
  rerender({ data: chart(MEDCLOUD, 'second') })
  expect(mockSetFilters).toHaveBeenCalledWith(MEDCLOUD_YEAR_DATA_FILTERS)
})

it('keeps a one-year window the user chose by hand, on first mount and after a reload', () => {
  mockFilters = { ...MEDCLOUD_YEAR_DATA_FILTERS }
  renderHook(() => useAdaptiveDataDefaults(chart(OTHER, 'manual-year')))
  expect(mockSetFilters).not.toHaveBeenCalled()
})

it('reverts the year it applied itself when the next chart is not a cloud record, even after a reload', () => {
  const first = renderHook(({ data }) => useAdaptiveDataDefaults(data), { initialProps: { data: chart(MEDCLOUD, 'cloud') } })
  expect(mockSetFilters).toHaveBeenLastCalledWith(MEDCLOUD_YEAR_DATA_FILTERS)
  first.unmount()
  // Reload: the provider restores the saved year; the marker survives.
  mockFilters = { ...MEDCLOUD_YEAR_DATA_FILTERS }
  mockSetFilters.mockReset()
  renderHook(() => useAdaptiveDataDefaults(chart(OTHER, 'bank')))
  expect(mockSetFilters).toHaveBeenCalledWith(DEFAULT_DATA_FILTERS)
})

it('treats the year as the user\'s once they changed the window, even back to a year', () => {
  const { rerender } = renderHook(({ data }) => useAdaptiveDataDefaults(data), { initialProps: { data: chart(MEDCLOUD, 'cloud') } })
  mockFilters = { ...MEDCLOUD_YEAR_DATA_FILTERS }
  rerender({ data: chart(MEDCLOUD, 'cloud') })
  // The user narrows the window, then picks the same year by hand.
  mockFilters = { ...MEDCLOUD_YEAR_DATA_FILTERS, encounterTimeRange: '3m' }
  rerender({ data: chart(MEDCLOUD, 'cloud') })
  mockFilters = { ...MEDCLOUD_YEAR_DATA_FILTERS }
  rerender({ data: chart(MEDCLOUD, 'cloud') })
  mockSetFilters.mockReset()
  rerender({ data: chart(OTHER, 'bank') })
  expect(mockSetFilters).not.toHaveBeenCalled()
})
