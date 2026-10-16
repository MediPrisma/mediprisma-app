import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CumulativeLabReport } from '@/features/clinical-summary/reports/components/CumulativeLabReport'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import {
  RightDetailProvider,
  useRightDetail,
} from '@/src/application/providers/right-detail.provider'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'

jest.mock('@/src/shared/utils/lab-trend.utils', () => {
  const actual = jest.requireActual('@/src/shared/utils/lab-trend.utils')
  return {
    ...actual,
    buildLabTrendSeries: jest.fn(actual.buildLabTrendSeries),
  }
})

const mockBuildLabTrendSeries = jest.mocked(buildLabTrendSeries)

const observations = [
  {
    id: 'crp-1',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
    effectiveDateTime: '2026-01-01',
    valueQuantity: { value: 0.5, unit: 'mg/dL' },
  },
  {
    id: 'crp-2',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
    effectiveDateTime: '2026-07-01',
    valueQuantity: { value: 0.8, unit: 'mg/dL' },
  },
]

function RightDetailHost() {
  const { detail } = useRightDetail()
  return detail ? <aside data-testid="right-detail-host">{detail.node}</aside> : null
}

function Providers({ children, detailHost = false }: { children: ReactNode; detailHost?: boolean }) {
  return (
    <LanguageProvider>
      <AudienceProvider>
        <RightDetailProvider>
          {children}
          {detailHost && <RightDetailHost />}
        </RightDetailProvider>
      </AudienceProvider>
    </LanguageProvider>
  )
}

describe('CumulativeLabReport trend entry', () => {
  it('opens eGFR despite a formula in the unit field and explains the retained excluded result', async () => {
    const renal = ['mL/min/1.73m2', 'mL/min/1.73m²', 'eGFR(MDRD)'].map((unit, index) => ({
      id: `egfr-${index}`, status: 'final', code: { text: 'eGFR' },
      effectiveDateTime: `2026-01-0${index + 1}`,
      valueQuantity: { value: 70 - index * 5, unit },
    }))
    render(<Providers detailHost><CumulativeLabReport observations={renal} activeCategoryId="chem" /></Providers>)
    fireEvent.click(screen.getByRole('button', { name: /查看 eGFR 趨勢/ }))
    const detail = await screen.findByTestId('cumulative-trend-detail')
    expect(detail).toHaveTextContent('其餘單位或血氣檢體分組顯示')
    expect(detail).toHaveTextContent('eGFR(MDRD)')
    expect(detail).toHaveTextContent('另有較新結果')
    expect(detail).toHaveTextContent('其他單位／檢體組，未納入目前曲線')
    expect(detail).toHaveTextContent('較前次')
    const picker = screen.getByRole('combobox', { name: '繪圖單位／檢體' })
    fireEvent.change(picker, { target: { value: JSON.stringify(['eGFR(MDRD)', '']) } })
    expect(detail).not.toHaveTextContent('較前次')
    expect(detail).toHaveTextContent('至少需要兩筆')
  })
  beforeEach(() => {
    mockBuildLabTrendSeries.mockClear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // The trend detail/dialog are loaded with next/dynamic (the charting library
  // is the heaviest thing in the bundle and only a click needs it), so these
  // assertions await the chunk instead of reading the DOM synchronously.
  it('opens a shared right-pane trend and keeps the selected column highlighted', async () => {
    const { container } = render(
      <Providers detailHost>
        <CumulativeLabReport observations={observations} activeCategoryId="chem" />
      </Providers>,
    )

    // Building the table and changing categories must not construct one full
    // trend series per analyte. Only the analyte the user opens is expanded.
    expect(mockBuildLabTrendSeries).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /查看 CRP 趨勢/ }))

    expect(mockBuildLabTrendSeries).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('right-detail-host')).toBeInTheDocument()
    expect(await screen.findByTestId('cumulative-trend-detail')).toHaveTextContent('最新結果')
    expect(container.querySelector('[data-lab-test-key="CRP"]')).toHaveAttribute('data-trend-active', 'true')
    expect(screen.getByRole('button', { name: /查看 CRP 趨勢/ })).toHaveAttribute(
      'data-detail-source-id',
      expect.stringContaining('cumulative-trend:'),
    )
  })

  it('uses the shared right pane on a phone-sized split workspace', async () => {
    render(
      <Providers detailHost>
        <CumulativeLabReport observations={observations} activeCategoryId="chem" />
      </Providers>,
    )

    fireEvent.click(screen.getByRole('button', { name: /查看 CRP 趨勢/ }))

    expect(screen.getByTestId('right-detail-host')).toBeInTheDocument()
    expect(await screen.findByTestId('cumulative-trend-detail')).toHaveTextContent('最新結果')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog for the standalone fullscreen cumulative report', async () => {
    render(
      <Providers>
        <CumulativeLabReport observations={observations} activeCategoryId="chem" fullHeight />
      </Providers>,
    )

    fireEvent.click(screen.getByRole('button', { name: /查看 CRP 趨勢/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /CRP.*檢驗趨勢/ })).toBeInTheDocument()
  })

  it('does not expose a trend action for a single result', () => {
    render(
      <Providers>
        <CumulativeLabReport observations={observations.slice(0, 1)} activeCategoryId="chem" />
      </Providers>,
    )

    expect(screen.queryByRole('button', { name: /查看 CRP 趨勢/ })).not.toBeInTheDocument()
  })
})
