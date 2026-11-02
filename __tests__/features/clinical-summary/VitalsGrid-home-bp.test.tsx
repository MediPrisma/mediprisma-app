import { render, screen } from '@testing-library/react'
import { VitalsGrid } from '@/features/clinical-summary/vitals/components/VitalsGrid'
import { formatDate } from '@/src/shared/utils/fhir-helpers'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      vitals: {
        noData: '無生命徵象資料', hr: '心率', ageInParens: '（{age}）', ageToday: '今天',
        ageDays: '{n} 天前', ageDaysOne: '1 天前', ageMonths: '{n} 個月前', ageMonthsOne: '1 個月前', ageYears: '{n} 年前', ageYearsOne: '1 年前',
        homeBp: '居家血壓 722', homeBpHint: '只顯示', homeBpCounts: '{days} 天 {sessions}/14 時段', homeBpInsufficient: '資料不足', homeBpIncomplete: '資料可能不完整',
      },
    },
  }),
}))

const BP = { start: '2026-10-24', end: '2026-10-30', systolic: 128, diastolic: 78, heartRate: 70, days: 5, sessions: 9, sufficient: true, dataComplete: true }
const empty = { readings: [] } as any

describe('VitalsGrid: home 722 line', () => {
  it('shows the home week as its own, labelled line, even without clinic readings', () => {
    render(<VitalsGrid vitals={empty} homeBp={BP} />)
    const line = screen.getByTestId('vitals-home-bp')
    expect(screen.getByText('無生命徵象資料')).toBeInTheDocument()
    expect(line).toHaveTextContent('居家血壓 722')
    expect(line).toHaveTextContent('128/78 mmHg')
    expect(line).toHaveTextContent('心率70 bpm')
    // Dates follow the browser's locale, as the clinic readings above do.
    expect(line).toHaveTextContent(`${formatDate('2026-10-24')}–${formatDate('2026-10-30')}`)
    expect(line).toHaveTextContent('5 天 9/14 時段')
    expect(line).not.toHaveTextContent('資料不足')
    expect(line).toHaveAttribute('title', '只顯示')
  })

  it('says when the week has too few readings or was not fully fetched', () => {
    render(<VitalsGrid vitals={empty} homeBp={{ ...BP, heartRate: null, sufficient: false, dataComplete: false }} />)
    const line = screen.getByTestId('vitals-home-bp')
    expect(line).toHaveTextContent('資料不足')
    expect(line).toHaveTextContent('資料可能不完整')
    expect(line).not.toHaveTextContent('心率')
  })

  it('has no home line without a home week', () => {
    render(<VitalsGrid vitals={empty} homeBp={null} />)
    expect(screen.queryByTestId('vitals-home-bp')).not.toBeInTheDocument()
  })
})
