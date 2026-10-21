import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CumulativeLabReport } from '@/features/clinical-summary/reports/components/CumulativeLabReport'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { useCumulativeReportPrefsStore } from '@/src/application/stores/cumulative-report-prefs.store'

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <AudienceProvider>{children}</AudienceProvider>
    </LanguageProvider>
  )
}

const crp = (id: string, value: number, comparator?: string) => ({
  id,
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
  effectiveDateTime: '2026-09-05',
  valueQuantity: { value, unit: 'mg/dL', ...(comparator ? { comparator } : {}) },
})

const crpCellText = () =>
  document.querySelector<HTMLElement>('[data-lab-cell][data-lab-test-key="CRP"]')?.textContent

// A source "<0.5" must not read as "0.5" in either layout — the stacked view
// renders its sections through the same table.
describe.each(['tabs', 'stacked'] as const)('CumulativeLabReport comparator (%s)', (layoutMode) => {
  beforeEach(() => {
    localStorage.clear()
    useCumulativeReportPrefsStore.setState({ layoutMode, range: 'latest3', categoryOrder: null })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() })
  })

  it('shows a single value with its comparator', () => {
    render(<CumulativeLabReport activeCategoryId="chem" observations={[crp('a', 0.5, '<')]} />, { wrapper: TestProviders })
    expect(crpCellText()).toBe('<0.5')
  })

  it('shows each same-day value with its own comparator', () => {
    render(
      <CumulativeLabReport activeCategoryId="chem" observations={[crp('a', 0.5, '<'), crp('b', 0.7)]} />,
      { wrapper: TestProviders },
    )
    expect(crpCellText()).toBe('<0.5 / 0.7')
  })
})
