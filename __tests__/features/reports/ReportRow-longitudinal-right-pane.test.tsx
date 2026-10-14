import { fireEvent, render, screen } from '@testing-library/react'
import { ReportRow } from '@/features/clinical-summary/reports/components/ReportRow'
import { ObservationBlock } from '@/features/clinical-summary/reports/components/ObservationBlock'
import type { Row } from '@/features/clinical-summary/reports/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import {
  RightDetailProvider,
  useRightDetail,
} from '@/src/application/providers/right-detail.provider'

jest.mock('@/features/report-interpretation', () => ({
  ReportInterpretationButton: () => null,
  ReportInterpretationLauncher: () => null,
  ReportInterpretationPanel: () => null,
}))

jest.mock('@/features/clinical-summary/reports/components/ObservationTrendDetail', () => ({
  ObservationTrendDetail: ({ observation }: { observation: { id?: string } | null }) => (
    <div data-testid="longitudinal-detail">{observation?.id}</div>
  ),
}))

function RightPaneProbe() {
  const { detail } = useRightDetail()
  return (
    <aside data-testid="right-pane" data-source-id={detail?.sourceId ?? ''}>
      {detail?.title}
      {detail?.node}
    </aside>
  )
}

function renderRow(row: Row) {
  return render(
    <LanguageProvider>
      <AudienceProvider>
        <RightDetailProvider>
          <ReportRow row={row} defaultOpen={[]} />
          <RightPaneProbe />
        </RightDetailProvider>
      </AudienceProvider>
    </LanguageProvider>,
  )
}

describe('ReportRow longitudinal right-pane behavior', () => {
  // ObservationTrendDetail is loaded with next/dynamic (it owns every chart in
  // the reports workspace), so the detail body arrives a tick after the click.
  it('opens a numeric result trend in the shared right pane without a dialog', async () => {
    const row: Row = {
      id: 'crp-report',
      title: 'CRP',
      meta: 'Laboratory • final',
      group: 'lab',
      effectiveDate: '2026-08-12',
      obs: [{
        id: 'crp-observation',
        code: { text: 'CRP' },
        effectiveDateTime: '2026-08-12',
        valueQuantity: { value: 0.8, unit: 'mg/dL' },
      }],
    }

    renderRow(row)
    fireEvent.click(screen.getByRole('button', { name: '查看趨勢' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute(
      'data-source-id',
      'report-longitudinal:crp-report:crp-observation',
    )
    expect(await screen.findByTestId('longitudinal-detail')).toHaveTextContent('crp-observation')
    expect(screen.getByTestId('right-pane')).toHaveTextContent('CRP· 檢驗趨勢')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('labels a safely derived reference-range comparison without labelling normal rows', () => {
    const row: Row = {
      id: 'chol-report',
      title: 'CHOL',
      meta: 'Laboratory • final',
      group: 'lab',
      effectiveDate: '2026-06-08',
      obs: [{
        id: 'chol-observation',
        code: { text: 'CHOL' },
        valueQuantity: { value: 201, unit: 'mg/dL' },
        referenceRange: [{ text: '<200' }],
      }],
    }

    const { rerender } = renderRow(row)
    expect(screen.getByLabelText('高於參考')).toBeInTheDocument()
    expect(screen.queryByText('未判讀')).not.toBeInTheDocument()

    rerender(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <ReportRow
              row={{
                ...row,
                id: 'ldl-report',
                title: 'LDL',
                obs: [{
                  id: 'ldl-observation',
                  code: { text: 'LDL' },
                  valueQuantity: { value: 114, unit: 'mg/dL' },
                  referenceRange: [{ text: '<130' }],
                }],
              }}
              defaultOpen={[]}
            />
            <RightPaneProbe />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.queryByText('高於參考')).not.toBeInTheDocument()
    expect(screen.queryByText('未判讀')).not.toBeInTheDocument()
  })

  it('shows explicit adult health-exam provenance without inventing a reference range', () => {
    const row: Row = {
      id: 'adult-health-exam-lipid',
      title: 'CHOL',
      meta: 'Observation Group',
      group: 'lab',
      institution: '良安診所',
      sourceProgram: 'adult-preventive',
      effectiveDate: '2024-06-28',
      obs: [{
        id: 'adult-health-exam-cholesterol',
        code: { text: 'CHOL' },
        valueQuantity: { value: 210, unit: 'mg/dL' },
      }],
    }

    renderRow(row)

    expect(screen.getByTestId('report-source-program')).toHaveTextContent('成人預防保健')
    expect(screen.queryByTestId('reference-range-inline')).not.toBeInTheDocument()
  })

  it('opens a text report history in the same right pane without a legacy popup', () => {
    const row: Row = {
      id: 'culture-report',
      title: 'Aerobic Culture',
      rawTitle: 'Aerobic Culture',
      meta: 'Laboratory • final',
      group: 'lab',
      effectiveDate: '2026-08-12',
      obs: [{
        id: 'culture-observation',
        code: { text: 'Report Summary' },
        effectiveDateTime: '2026-08-12',
        valueString: 'No growth',
      }],
    }

    renderRow(row)
    fireEvent.click(screen.getByRole('button', { name: '查看歷史紀錄' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute(
      'data-source-id',
      'report-longitudinal:culture-report:culture-observation',
    )
    expect(screen.getByTestId('longitudinal-detail')).toHaveTextContent('culture-observation')
    expect(screen.getByTestId('right-pane')).toHaveTextContent('Aerobic Culture· 歷史紀錄')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('routes an expanded report observation action to the shared right pane too', () => {
    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <ObservationBlock observation={{
              id: 'nested-observation',
              code: { text: 'HB' },
              effectiveDateTime: '2026-08-12',
              valueQuantity: { value: 12.1, unit: 'g/dL' },
            }} />
            <RightPaneProbe />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看趨勢' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute(
      'data-source-id',
      'observation-longitudinal:nested-observation',
    )
    expect(screen.getByTestId('longitudinal-detail')).toHaveTextContent('nested-observation')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
