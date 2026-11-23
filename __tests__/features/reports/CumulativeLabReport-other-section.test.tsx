import { fireEvent, render, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CumulativeLabReport } from '@/features/clinical-summary/reports/components/CumulativeLabReport'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { useCumulativeReportPrefsStore } from '@/src/application/stores/cumulative-report-prefs.store'

// Laboratory results that fit none of the routine panels fall to 其他. The
// cumulative report used to leave 其他 out, so such a result (blood bank,
// viral PCR, a rare chemistry) was nowhere in it. It is now the last section,
// shown only when it holds data. Values are synthetic.
function TestProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <AudienceProvider>{children}</AudienceProvider>
    </LanguageProvider>
  )
}

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LAB = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]
const crp = { id: 'crp', status: 'final', category: LAB, effectiveDateTime: '2026-04-04',
  code: { coding: [{ system: 'http://loinc.org', code: '1988-5' }] }, valueQuantity: { value: 0.4, unit: 'mg/dL' } }
const aluminum = { id: 'al', status: 'final', category: LAB, effectiveDateTime: '2026-04-04',
  code: { text: 'Aluminum', coding: [{ system: NHI, code: '10002B' }] }, valueQuantity: { value: 12, unit: 'ug/L' } }

const sections = () => [...document.querySelectorAll<HTMLElement>('[data-cumulative-section]')]
  .map((node) => node.getAttribute('data-cumulative-section'))

beforeEach(() => {
  localStorage.clear()
  useCumulativeReportPrefsStore.setState({ layoutMode: 'stacked', range: 'all', categoryOrder: null })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() })
})

it('shows 其他 as the last section when it holds a result', () => {
  render(<CumulativeLabReport observations={[crp, aluminum]} />, { wrapper: TestProviders })
  expect(sections().at(-1)).toBe('other')
  const other = document.querySelector<HTMLElement>('[data-cumulative-section="other"]')!
  expect(other.textContent).toContain('其他')
  expect(other.textContent).toContain('Aluminum')
  expect(other.textContent).toContain('12')
})

it('leaves 其他 out when nothing falls there', () => {
  render(<CumulativeLabReport observations={[crp]} />, { wrapper: TestProviders })
  expect(sections()).not.toContain('other')
})

it('moves 其他 like any other section', () => {
  render(<CumulativeLabReport observations={[crp, aluminum]} />, { wrapper: TestProviders })
  const other = document.querySelector<HTMLElement>('[data-cumulative-section="other"]')!
  const buttons = within(other).getAllByRole('button').filter((button) => /上移|move up/i.test(button.getAttribute('aria-label') ?? ''))
  expect(buttons).toHaveLength(1)
  fireEvent.click(buttons[0])
  const order = sections()
  expect(order.indexOf('other')).toBe(order.length - 2)
})
