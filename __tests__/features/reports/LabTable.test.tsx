import { fireEvent, render, screen, within } from '@testing-library/react'
import { LabReportRow } from '@/features/clinical-summary/reports/components/lab-table/LabReportRow'
import {
  getLabFlag,
  getLabResultParts,
} from '@/features/clinical-summary/reports/components/lab-table/lab-result-cells'
import { stripRangeBrackets } from '@/features/clinical-summary/reports/components/lab-table/lab-table-layout'
import { keepAbnormalLabRows } from '@/features/clinical-summary/reports/utils/lab-abnormal-filter'
import type { Observation, Row } from '@/features/clinical-summary/reports/types'
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

const RANGE_LABELS = { above: '高於參考', below: '低於參考' }

function RightPaneProbe() {
  const { detail } = useRightDetail()
  return <aside data-testid="right-pane" data-source-id={detail?.sourceId ?? ''} />
}

function renderRow(row: Row, variant: 'flat' | 'day' = 'flat', defaultOpen: string[] = []) {
  return render(
    <LanguageProvider>
      <AudienceProvider>
        <RightDetailProvider>
          <LabReportRow row={row} variant={variant} defaultOpen={defaultOpen} />
          <RightPaneProbe />
        </RightDetailProvider>
      </AudienceProvider>
    </LanguageProvider>,
  )
}

const quantity = (id: string, text: string, value: number, unit: string, extra: Partial<Observation> = {}): Observation => ({
  id,
  code: { text },
  effectiveDateTime: '2026-06-02',
  valueQuantity: { value, unit },
  ...extra,
})

const high = { interpretation: { coding: [{ code: 'H' }] } }
const normal = { interpretation: { coding: [{ code: 'N' }] } }

describe('lab table cells', () => {
  it('splits a quantity into value (with comparator) and unit', () => {
    expect(getLabResultParts({ valueQuantity: { value: 0.4, comparator: '<', unit: 'U/mL' } } as Observation))
      .toEqual({ value: '<0.40', unit: 'U/mL', isText: false })
    expect(getLabResultParts({ valueString: 'Negative' } as Observation))
      .toEqual({ value: 'Negative', unit: '', isText: true })
  })

  it('shows the source flag as a letter and a range comparison only as an arrow', () => {
    expect(getLabFlag(quantity('a', 'BUN', 23.7, 'mg/dL', high), 'zh-TW', RANGE_LABELS))
      .toEqual({ text: '↑H', label: '偏高', basis: 'interpretation' })
    expect(getLabFlag(quantity('b', 'Na', 141, 'mEq/L', normal), 'zh-TW', RANGE_LABELS)).toBeNull()
    expect(getLabFlag(quantity('c', 'Glucose', 124, 'mg/dL', {
      referenceRange: [{ low: { value: 70, unit: 'mg/dL' }, high: { value: 100, unit: 'mg/dL' } }],
    }), 'zh-TW', RANGE_LABELS)).toEqual({ text: '↑', label: '高於參考', basis: 'range' })
  })

  it('drops the brackets around a simple range but keeps a stratified source string', () => {
    expect(stripRangeBrackets('[0.72–1.18 mg/dL]')).toBe('0.72–1.18 mg/dL')
    expect(stripRangeBrackets('[0-5:Negative][6-10:Borderline]')).toBe('[0-5:Negative][6-10:Borderline]')
  })
})

describe('LabReportRow', () => {
  it('renders a single result on the column grid and opens its trend from the name', async () => {
    const row: Row = {
      id: 'bun-report',
      title: 'BUN',
      meta: 'Laboratory • final',
      group: 'lab',
      institution: '示範長青醫院',
      effectiveDate: '2026-06-02',
      obs: [quantity('bun-obs', 'BUN', 23.7, 'mg/dL', {
        ...high,
        referenceRange: [{ low: { value: 8, unit: 'mg/dL' }, high: { value: 20, unit: 'mg/dL' } }],
      })],
    }
    renderRow(row)

    const line = screen.getByTestId('lab-result-line')
    expect(within(line).getByTestId('lab-result-value')).toHaveTextContent('23.7')
    expect(within(line).getByTestId('lab-result-value')).toHaveClass('text-clinical-abnormal')
    expect(within(line).getByTestId('lab-result-unit')).toHaveTextContent('mg/dL')
    expect(within(line).getByTestId('lab-flag')).toHaveAttribute('data-flag-basis', 'interpretation')
    expect(within(line).getByTestId('lab-result-range')).toHaveTextContent('8–20 mg/dL')

    fireEvent.click(within(line).getByTestId('lab-result-name'))
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-source-id', 'report-longitudinal:bun-report:bun-obs')
  })

  it('opens a panel to member lines that share the same columns', () => {
    const row: Row = {
      id: 'crea-panel',
      title: 'Creatinine, serum',
      meta: 'Laboratory • final',
      group: 'lab',
      institution: '示範長青醫院',
      effectiveDate: '2026-06-02',
      obs: [
        quantity('crea', 'CREA', 1.93, 'mg/dL', high),
        quantity('egfr', 'eGFR', 32, 'mL/min/1.73m2'),
      ],
    }
    renderRow(row)

    const header = screen.getByTestId('lab-panel-header')
    expect(header).toHaveTextContent('2 項')
    expect(header).toHaveTextContent('1 異常')
    expect(screen.queryAllByTestId('lab-result-line')).toHaveLength(0)

    fireEvent.click(within(header).getByRole('button', { name: /^Creatinine, serum/ }))
    const members = screen.getAllByTestId('lab-result-line')
    expect(members).toHaveLength(2)
    members.forEach((member) => expect(member).toHaveAttribute('data-level', 'member'))
    // Members have no source of their own: the range runs over that track.
    members.forEach((member) => {
      expect(within(member).getByTestId('lab-result-range')).toHaveClass('col-end-8')
      expect(within(member).queryByTestId('lab-result-meta')).not.toBeInTheDocument()
    })
    // Same tracks as a single result: the member grid matches the header grid.
    expect(members[0].className).toContain('@min-[920px]:grid-cols-[1.5rem_10rem')
    expect(header.className).toContain('@min-[920px]:grid-cols-[1.5rem_10rem')
  })

  it('opens a day section to one line per analyte', () => {
    const member: Row = {
      id: 'chem',
      title: 'Chemistry',
      meta: 'Laboratory • final',
      group: 'lab',
      institution: '示範長青醫院',
      effectiveDate: '2026-06-02',
      obs: [quantity('na', 'Na', 141, 'mEq/L'), quantity('k', 'K', 3.7, 'mEq/L')],
    }
    const day: Row = {
      ...member,
      id: 'day:2026-06-02:chem',
      dayGroup: true,
      dayGroupCategoryId: 'chem',
      groupedRows: [member],
    }
    renderRow(day, 'day')

    expect(screen.getByTestId('lab-day-item-count')).toHaveTextContent('2 項')
    fireEvent.click(within(screen.getByTestId('lab-day-section')).getAllByRole('button', { expanded: false })[0])
    expect(screen.getAllByTestId('lab-result-line')).toHaveLength(2)
  })

  it('shows 未判讀 in the flag column, never in front of the range', () => {
    const row: Row = {
      id: 'ro52', title: 'Ro52', meta: '', group: 'lab', effectiveDate: '2026-06-02',
      obs: [quantity('ro52-obs', 'Ro52', 3, 'U/mL', {
        referenceRange: [{ text: '[0-5:Negative;6-10:Borderline;>=11:Positive]' }],
      })],
    }
    renderRow(row)
    const line = screen.getByTestId('lab-result-line')
    expect(within(line).getByTestId('lab-range-unassessed')).toHaveTextContent('未判讀')
    expect(within(line).getByTestId('lab-result-range')).not.toHaveTextContent('未判讀')
  })

  it('lets a long text result run left-aligned from the value column and wrap', () => {
    const row: Row = {
      id: 'culture', title: 'Aerobic Culture', meta: '', group: 'lab', effectiveDate: '2026-01-14',
      obs: [{ id: 'culture-obs', code: { text: 'Aerobic Culture' }, valueString: 'Mixed flora of clinical insignificance' }],
    }
    renderRow(row)
    const value = screen.getByTestId('lab-result-value')
    expect(value).toHaveAttribute('data-text-result', 'long')
    expect(value).toHaveClass('text-left', 'whitespace-normal', 'col-end-6')
    expect(screen.queryByTestId('lab-result-unit')).not.toBeInTheDocument()
  })

  it('shows a MediCloud source as one compact line, details in the bubble', () => {
    const row: Row = {
      id: 'alt-cloud', title: 'ALT', meta: '', group: 'lab', effectiveDate: '2025-08-29',
      sourceProvenance: 'nhi-medicloud',
      obs: [quantity('alt-cloud-obs', 'ALT', 14, 'U/L')],
    }
    renderRow(row)
    const source = within(screen.getByTestId('lab-result-meta')).getByTestId('nhi-medicloud-source')
    expect(source).toHaveAttribute('data-compact', 'true')
    expect(source).toHaveTextContent('健保雲端')
    expect(source).not.toHaveTextContent('院所未提供')
  })

  it('shortens the adult-preventive badge so the institution keeps its room', () => {
    const row: Row = {
      id: 'chol-ap', title: 'CHOL', meta: '', group: 'lab', effectiveDate: '2024-03-12',
      sourceProgram: 'adult-preventive', institution: '示範長青醫院',
      obs: [quantity('chol-ap-obs', 'CHOL', 188, 'mg/dL')],
    }
    renderRow(row)
    const badge = within(screen.getByTestId('lab-result-meta')).getByTestId('report-source-program')
    expect(badge).toHaveTextContent('健')
    expect(badge).toHaveAttribute('aria-label', '成人預防保健')
  })

  it('keeps the full report row for a report the grid cannot carry', () => {
    const row: Row = {
      id: 'ecg',
      title: 'ECG',
      meta: 'Laboratory • final',
      group: 'lab',
      effectiveDate: '2026-06-02',
      obs: [{ id: 'summary', code: { text: 'Report Summary' }, valueString: 'Sinus rhythm' }],
    }
    renderRow(row)
    expect(screen.getByTestId('lab-full-report-row')).toBeInTheDocument()
    expect(screen.queryByTestId('lab-result-line')).not.toBeInTheDocument()
  })
})

describe('keepAbnormalLabRows', () => {
  it('narrows panels to abnormal members and drops normal reports', () => {
    const panel: Row = {
      id: 'p', title: 'Panel', meta: '', group: 'lab',
      obs: [quantity('a', 'CREA', 1.93, 'mg/dL', high), quantity('b', 'eGFR', 60, 'mL/min', normal)],
    }
    const normalRow: Row = { id: 'n', title: 'Na', meta: '', group: 'lab', obs: [quantity('c', 'Na', 141, 'mEq/L', normal)] }
    const result = keepAbnormalLabRows([panel, normalRow])
    expect(result).toHaveLength(1)
    expect(result[0].obs.map((o) => o.id)).toEqual(['a'])
  })
})
