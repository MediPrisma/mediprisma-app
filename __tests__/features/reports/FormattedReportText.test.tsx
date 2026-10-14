import { render, screen } from '@testing-library/react'
import { FormattedReportText } from '@/features/clinical-summary/reports/components/FormattedReportText'

describe('FormattedReportText', () => {
  it('renders a flattened microbiology report as scannable source-faithful rows', () => {
    const raw = '報告結果 開單日期:115/08/14 15:15 採檢日期:115/08/14 15:23 ' +
      '檢驗項目:13021 抗生素敏感性試驗(MIC法)二菌種 檢體編號:11513025188 Specimen:Sputum ' +
      '〔最終報告〕 報告日期:115/08/18 08:32 報告:---------------------------------------- ' +
      ': Final report (最終報告) :Sputum Culture : Sample Type : Sputum ' +
      ': ISOLATE 1 : Klebsiella pneumoniae subsp. pneumoniae, 3+ ' +
      ': ISOLATE 2 : Streptococcus anginosus, 3+ ' +
      ': -------------------- : |Susceptibility | 1 | 2 |'

    render(<FormattedReportText text={raw} />)

    expect(screen.getByText('開單日期:115/08/14 15:15')).toBeInTheDocument()
    expect(screen.getByText('採檢日期:115/08/14 15:23')).toBeInTheDocument()
    expect(screen.getByText('Final report (最終報告)')).toHaveClass('font-semibold')
    expect(screen.getByText('Sputum Culture')).toHaveClass('font-semibold')
    expect(screen.getByText('ISOLATE 1 : Klebsiella pneumoniae subsp. pneumoniae, 3+')).toBeInTheDocument()
    expect(screen.getByText('ISOLATE 2 : Streptococcus anginosus, 3+')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('Susceptibility')
    expect(table).toHaveTextContent('1')
    expect(table).toHaveTextContent('2')
  })
})

describe('echo report layout', () => {
  it('renders only source values and leaves missing measurements blank', () => {
    render(<FormattedReportText text={'DOPPLER ＆ ECHOCARDIOGRAPHIC REPORT: IVSd 1.0 (0.6~1.2)cm EF(biplane) (Normal≧55)% E/Sep e` Conclusion: ● Normal function ● mild AR'} />)
    expect(screen.getByText('IVSd').tagName).toBe('DT')
    expect(screen.getByText('1.0 (0.6~1.2)cm')).toBeInTheDocument()
    expect(screen.queryByText('未填')).not.toBeInTheDocument()
    expect(screen.getByText('E/Sep e`').nextElementSibling).toBeEmptyDOMElement()
    expect(screen.getByText(/Normal≧55/, { selector: 'dd' }).textContent).toBe('(Normal≧55)%')
    expect(screen.getByText('Normal function')).toBeInTheDocument()
    expect(screen.getByText('mild AR')).toBeInTheDocument()
  })
})

describe('original report disclosure', () => {
  it('keeps the exact unformatted source in an initially closed disclosure', () => {
    const raw = '  Findings:\n\n\n  A   0.5 cm lesion.\nImpression:1. Follow up.  '
    const { container } = render(<FormattedReportText text={raw} />)
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')).toHaveTextContent('顯示原始報告')
    expect(details.querySelector('pre')?.textContent).toBe(raw)
    expect(details.querySelector('pre')).not.toBeVisible()
  })
  it('renders source markup as text, never HTML', () => {
    const raw = 'Findings: <img src=x onerror=alert(1)> & unchanged'
    const { container } = render(<FormattedReportText text={raw} />)
    expect(container.querySelector('pre')?.textContent).toBe(raw)
    expect(container.querySelector('img')).toBeNull()
  })

  it('bolds only the label of an inline label heading', () => {
    render(<FormattedReportText text={'CT of chest shows:\nComparison: CT on 2026-5-19.'} />)
    const label = screen.getByText('Comparison:')
    expect(label).toHaveClass('font-semibold')
    expect(label.parentElement?.textContent).toBe('Comparison: CT on 2026-5-19.')
    expect(label.parentElement).not.toHaveClass('font-semibold')
  })
})
