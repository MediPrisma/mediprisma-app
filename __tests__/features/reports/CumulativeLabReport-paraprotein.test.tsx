import { fireEvent, render, screen, within } from '@testing-library/react'
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

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const row = (id: string, nhi: string, text: string, value: string | number, extra: Record<string, any> = {}) => ({
  id,
  status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text, coding: [{ system: NHI, code: nhi }] },
  effectiveDateTime: '2026-09-30',
  ...(typeof value === 'number' ? { valueQuantity: { value, unit: 'mg/L' } } : { valueString: value }),
  ...extra,
})

const LONG_IFE = 'IgG-kappa monoclonal band in the gamma region; free lambda also seen; suggest serum free light chain assay and bone marrow correlation'

describe('CumulativeLabReport 直式 — 免疫 電泳／輕鏈 panel', () => {
  beforeEach(() => {
    localStorage.clear()
    useCumulativeReportPrefsStore.setState({ layoutMode: 'stacked', range: 'latest3', categoryOrder: null })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() })
  })

  it('renders a third table with κ/λ numbers and one-line IFE text cells', () => {
    render(<CumulativeLabReport observations={[
      row('igg', '12025B', 'IGG', 1000, { valueQuantity: { value: 1000, unit: 'mg/dL' } }),
      row('ro52', '12064B', 'Ro52', 'Negative'),
      row('ife', '12103B', 'IFE', LONG_IFE, { interpretation: [{ coding: [{ code: 'A' }] }] }),
      row('lane-igg', '12103B', 'IgG', 'Present'),
      row('mband', '12103B', 'M-band', 0, { valueQuantity: { value: 0.2, comparator: '<', unit: 'g/L' } }),
      row('fk', '12160B', 'Free Kappa', 45.1),
      row('fl', '12160B', 'Free Lambda', 12.0),
      row('uife', '12159B', 'Urine IFE', 'No monoclonal band', { specimen: { display: 'Urine' } }),
    ]} />, { wrapper: TestProviders })

    const immuno = document.querySelector<HTMLElement>('[data-cumulative-section="immuno"]')!
    const tables = immuno.querySelectorAll('table')
    expect(tables).toHaveLength(3)
    expect(tables[2]).toHaveTextContent('電泳／輕鏈')
    // The IgG lane under the IEP order is not in the immunoglobulin table.
    expect(within(tables[0] as HTMLElement).queryByText('Present')).toBeNull()
    expect(tables[2]).toHaveTextContent('45.1')

    const textCells = tables[2].querySelectorAll<HTMLElement>('[data-lab-text-cell]')
    expect(textCells.length).toBe(2)
    const serum = [...textCells].find((cell) => cell.getAttribute('data-lab-test-key') === 'PP:IFE')!
    // A multi-clause report plus a lane: no badge it could misstate.
    expect(serum).toHaveTextContent('見報告')
    expect(serum).not.toHaveTextContent('bone marrow')
    // Text results are never coloured as abnormal.
    expect(serum.className).not.toMatch(/text-clinical-abnormal/)
    const trigger = within(serum).getByRole('button')
    const clamp = trigger.querySelector('[data-lab-text-clamp]')!
    expect(clamp.className).toMatch(/truncate/)
    expect(clamp.className).toMatch(/max-w-/)
    // Keyboard: a real, focusable button that names what it opens.
    expect(trigger.tagName).toBe('BUTTON')
    // Touch target: 44px on mobile (DESIGN.md), compact on desktop rows.
    expect(trigger.className.split(' ')).toContain('max-md:min-h-11')
    expect(trigger.className.split(' ')).toContain('min-h-6')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger.getAttribute('aria-label')).toMatch(/IFE/)
    // Click / tap opens the full report — every folded record with its analyte.
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveTextContent(LONG_IFE)
    expect(panel).toHaveTextContent('IgG: Present')
    // Each record keeps its comparator and unit.
    expect(panel).toHaveTextContent('M-band: <0.2 g/L')
    // Escape closes it and returns focus.
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    const urine = [...textCells].find((cell) => cell.getAttribute('data-lab-test-key') === 'PP:U:IFE')!
    expect(urine).toHaveTextContent('陰性')
    // The urine IFE is not in the 尿液 section.
    expect(document.querySelector('[data-cumulative-section="urine"] table')).toBeNull()
  })
})
