import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CumulativeLabReport } from '@/features/clinical-summary/reports/components/CumulativeLabReport'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { useCumulativeReportPrefsStore } from '@/src/application/stores/cumulative-report-prefs.store'
import { ReportNameModeProvider } from '@/features/clinical-summary/reports/context/report-name-mode.context'

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <AudienceProvider>{children}</AudienceProvider>
    </LanguageProvider>
  )
}

const NHI_ORDER = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const NHI_PAYMENT = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const MEDICLOUD_EXTENSION = {
  url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-system',
  valueCodeableConcept: { coding: [{ code: 'nhi-medicloud' }] },
}

function differential(
  id: string,
  date: string,
  value: number,
  unit: string,
  options: { loinc?: string; nhiSystem?: string; medicloud?: boolean; text?: string } = {},
) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    ...(options.medicloud ? { extension: [MEDICLOUD_EXTENSION] } : {}),
    code: {
      text: options.text ?? '嗜中性白血球 / Neutrophil',
      coding: [
        ...(options.loinc ? [{ system: 'http://loinc.org', code: options.loinc }] : []),
        { system: options.nhiSystem ?? NHI_ORDER, code: '08013C', display: '白血球分類計數' },
      ],
    },
    valueQuantity: { value, unit },
    effectiveDateTime: date,
  }
}

// The field report: 751-8 (count) and 770-8 (%) share the source label
// 「嗜中性白血球 / Neutrophil」; a MediCloud day sends the same pair uncoded.
const OBSERVATIONS = [
  differential('neu-count-loinc', '2026-09-02', 3.2, '10^3/uL', { loinc: '751-8' }),
  differential('neu-pct-loinc', '2026-09-02', 55, '%', { loinc: '770-8' }),
  differential('neu-count-mc', '2026-09-01', 2900, '/uL', { nhiSystem: NHI_PAYMENT, medicloud: true, text: '嗜中性白血球' }),
  differential('neu-pct-mc', '2026-09-01', 61, '%', { nhiSystem: NHI_PAYMENT, medicloud: true, text: '嗜中性白血球' }),
]

const cell = (container: HTMLElement, key: string, date: string) =>
  container.querySelector<HTMLElement>(`td[data-lab-cell][data-lab-test-key="${key}"][data-lab-date="${date}"] > span`)?.textContent

describe.each(['tabs', 'stacked'] as const)('CumulativeLabReport (%s) — neutrophil count vs percentage', (layoutMode) => {
  beforeEach(() => {
    localStorage.clear()
    useCumulativeReportPrefsStore.setState({ layoutMode, range: 'all', categoryOrder: null })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() })
  })

  it('renders separate ANC and NEU columns, each holding one kind of value', () => {
    const { container } = render(
      <CumulativeLabReport activeCategoryId="cbc" observations={OBSERVATIONS} />,
      { wrapper: TestProviders },
    )

    const neuHeader = container.querySelector<HTMLElement>('th[data-lab-test-key="NEU"]')
    const ancHeader = container.querySelector<HTMLElement>('th[data-lab-test-key="ANC"]')
    expect(neuHeader).not.toBeNull()
    expect(ancHeader).not.toBeNull()
    expect(neuHeader).toHaveTextContent('%')
    expect(ancHeader).toHaveTextContent('ANC')

    expect(cell(container, 'NEU', '2026-09-02')).toBe('55')
    expect(cell(container, 'NEU', '2026-09-01')).toBe('61')
    expect(cell(container, 'ANC', '2026-09-02')).toBe('3.2')
    expect(cell(container, 'ANC', '2026-09-01')).toBe('2900')
    // No same-day "55 / 3.2" merge anywhere in the table.
    const texts = [...container.querySelectorAll('td[data-lab-cell] > span')].map((node) => node.textContent)
    expect(texts.some((text) => text?.includes(' / '))).toBe(false)
  })
})

describe.each(['tabs', 'stacked'] as const)('CumulativeLabReport (%s, original names) — count and % headers differ', (layoutMode) => {
  beforeEach(() => {
    localStorage.clear()
    useCumulativeReportPrefsStore.setState({ layoutMode, range: 'all', categoryOrder: null })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() })
  })

  it('two columns sharing the source label read (#) and (%)', () => {
    const { container } = render(
      <ReportNameModeProvider value="original">
        <CumulativeLabReport activeCategoryId="cbc" observations={OBSERVATIONS.slice(0, 2)} />
      </ReportNameModeProvider>,
      { wrapper: TestProviders },
    )
    const headers = [...container.querySelectorAll<HTMLElement>('th[data-lab-test-key]')]
      .map((th) => th.textContent ?? '')
      .filter((text) => text.includes('Neutrophil'))
    expect(headers).toHaveLength(2)
    expect(headers.some((text) => text.includes('嗜中性白血球 / Neutrophil (#)'))).toBe(true)
    expect(headers.some((text) => text.includes('嗜中性白血球 / Neutrophil (%)'))).toBe(true)
  })
})
