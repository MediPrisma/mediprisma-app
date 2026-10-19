import { fireEvent, render, screen } from '@testing-library/react'
import {
  formatReportInstitution,
  ReportInstitutionLabel,
} from '@/features/clinical-summary/reports/components/ReportInstitutionLabel'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('ReportInstitutionLabel', () => {
  it.each([
    ['in-house', '臺北榮總(院內)'],
    ['cloud-and-in-house', '臺北榮總(院內+雲端)'],
  ] as const)('renders the %s source suffix', (hospitalSource, label) => {
    render(<ReportInstitutionLabel institution="臺北榮民總醫院" hospitalSource={hospitalSource} />)
    expect(screen.getByLabelText(label)).toBeInTheDocument()
    expect(screen.getByText(hospitalSource === 'in-house' ? '(院內)' : '(院內+雲端)')).toHaveClass('shrink-0')
  })
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock,
    })
  })

  it('keeps a compact label and shows the complete institution on hover', async () => {
    const sourceInstitution = '臺北榮民總醫院；門診醫療部影像中心；0601160016'
    const displayInstitution = '臺北榮民總醫院'
    render(<ReportInstitutionLabel institution={sourceInstitution} className="max-w-[10rem]" />)

    const label = screen.getByLabelText(displayInstitution)
    expect(label).toHaveClass('max-w-[10rem]')
    expect(screen.getByText(displayInstitution)).toHaveClass('truncate')
    expect(document.body).not.toHaveTextContent('0601160016')

    fireEvent.pointerMove(label)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(displayInstitution)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('0601160016')
  })

  it('does not remove meaningful digits unless they are a delimited trailing code', () => {
    expect(formatReportInstitution('三軍總醫院803分院')).toBe('三軍總醫院803分院')
    expect(formatReportInstitution('三軍總醫院803分院;門診;123456')).toBe('三軍總醫院803分院')
  })
})
