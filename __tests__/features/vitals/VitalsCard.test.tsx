import { render, screen, within } from '@testing-library/react'
import { VitalsCard } from '@/features/clinical-summary/vitals/VitalsCard'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { useLanguage } from '@/src/application/providers/language.provider'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook')
jest.mock('@/src/application/providers/language.provider')

const vitalCategory = [{ coding: [{ code: 'vital-signs' }] }]
const adultPreventive = { meta: { tag: [{ system: 'http://nhi-fhir-bridge/source-program', code: 'adult-preventive' }] } }
const loinc = (code: string) => ({ coding: [{ system: 'http://loinc.org', code }] })

function obs(code: string, value: number, unit: string, effectiveDateTime: string) {
  return { resourceType: 'Observation', category: vitalCategory, code: loinc(code), effectiveDateTime, valueQuantity: { value, unit } }
}
function bp(sys: number, dia: number, effectiveDateTime: string) {
  return {
    resourceType: 'Observation', category: vitalCategory, code: loinc('85354-9'), effectiveDateTime,
    component: [
      { code: loinc('8480-6'), valueQuantity: { value: sys, unit: 'mmHg' } },
      { code: loinc('8462-4'), valueQuantity: { value: dia, unit: 'mmHg' } },
    ],
  }
}
function mockVitals(vitalSigns: any[]) {
  jest.mocked(useClinicalData).mockReturnValue({ vitalSigns, resourceReady: { vitalSigns: true }, error: null } as any)
}

describe('VitalsCard', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 28, 10))
    jest.mocked(useLanguage).mockReturnValue({ t: zhTW, locale: 'zh-TW' } as any)
  })
  afterEach(() => jest.useRealTimers())

  it('shows one date for readings a health check took together', () => {
    mockVitals([
      obs('8302-2', 168, 'cm', '2018-02-12T00:00:00+08:00'),
      obs('29463-7', 78, 'kg', '2018-02-12T00:00:00+08:00'),
      bp(154, 88, '2018-02-12T00:00:00+08:00'),
    ])
    const { container } = render(<VitalsCard />)

    expect(container.querySelectorAll('time')).toHaveLength(1)
    expect(container.querySelector('time')).toHaveTextContent('8 年前')
    expect(screen.getByText('154/88 mmHg')).toBeInTheDocument()
    // No heart rate in the source: no empty 心率 — placeholder.
    expect(screen.queryByText('心率')).not.toBeInTheDocument()
  })

  it('dates each reading when they were taken on different days', () => {
    mockVitals([
      obs('8302-2', 168, 'cm', '2018-02-12T00:00:00+08:00'),
      bp(150, 80, '2026-08-25T09:10:00+08:00'),
    ])
    const { container } = render(<VitalsCard />)

    const lines = [...container.querySelectorAll<HTMLElement>('[data-slot="card-content"] p')]
    expect(lines).toHaveLength(2)
    // Newest first, each line carrying its own date — the 2026 blood pressure
    // no longer lends its date to the 2018 height.
    expect(lines[0]).toHaveTextContent('血壓')
    expect(lines[0].querySelector('time')).toHaveAttribute('dateTime', '2026-08-25')
    expect(lines[0]).toHaveTextContent('1 個月前')
    expect(lines[1]).toHaveTextContent('身高')
    expect(lines[1].querySelector('time')).toHaveAttribute('dateTime', '2018-02-12')
    expect(lines[1]).toHaveTextContent('8 年前')
  })

  it('pairs separate systolic and diastolic readings only when taken together', () => {
    mockVitals([
      obs('8480-6', 150, 'mmHg', '2026-08-25T09:10:00+08:00'),
      obs('8462-4', 80, 'mmHg', '2026-08-25T09:10:00+08:00'),
    ])
    const { container } = render(<VitalsCard />)
    expect(screen.getByText('150/80 mmHg')).toBeInTheDocument()
    expect(container.querySelectorAll('time')).toHaveLength(1)
  })

  it('keeps each date when separate systolic and diastolic come from different measurements', () => {
    mockVitals([
      obs('8480-6', 150, 'mmHg', '2026-09-28T09:10:00+08:00'),
      obs('8462-4', 80, 'mmHg', '2018-02-12T00:00:00+08:00'),
    ])
    const { container } = render(<VitalsCard />)

    // Not merged into one 150/80 under the systolic's date.
    expect(screen.queryByText('150/80 mmHg')).not.toBeInTheDocument()
    const lines = [...container.querySelectorAll<HTMLElement>('[data-slot="card-content"] p')]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('收縮壓')
    expect(lines[0]).toHaveTextContent('150 mmHg')
    expect(lines[0].querySelector('time')).toHaveAttribute('dateTime', '2026-09-28')
    expect(lines[1]).toHaveTextContent('舒張壓')
    expect(lines[1]).toHaveTextContent('80 mmHg')
    expect(lines[1].querySelector('time')).toHaveAttribute('dateTime', '2018-02-12')
  })

  it('badges readings the source tags as 成人預防保健, with the date on one line', () => {
    mockVitals([
      { ...obs('8302-2', 155, 'cm', '2026-01-13T00:00:00+08:00'), ...adultPreventive },
      { ...obs('29463-7', 61, 'kg', '2026-01-13T00:00:00+08:00'), ...adultPreventive },
    ])
    const { container } = render(<VitalsCard />)

    const badge = screen.getByTestId('report-source-program')
    expect(badge).toHaveTextContent('成人預防保健')
    // Date and badge share one wrapper, so they wrap to a new line together.
    const time = container.querySelector('time')!
    expect(badge.parentElement).toBe(time.parentElement)
    // The date and its age are separate unbreakable pieces.
    expect([...time.children].map((c) => c.textContent)).toEqual([expect.stringMatching(/2026/), '（8 個月前）'])
  })

  it('counts an untagged blood pressure from the exam day as 成人預防保健', () => {
    mockVitals([
      { ...obs('8302-2', 155, 'cm', '2026-01-13T00:00:00+08:00'), ...adultPreventive },
      { ...obs('39156-5', 25.4, 'kg/m2', '2026-01-13T00:00:00+08:00'), ...adultPreventive },
      // The bridge ships the exam's BP panel without the source-program tag.
      bp(147, 79, '2026-01-13T00:00:00+08:00'),
      // Heart rate is not pulled in: only blood pressure follows the exam day.
      obs('8867-4', 72, 'bpm', '2026-01-13T10:00:00+08:00'),
    ])
    const { container } = render(<VitalsCard />)

    const lines = [...container.querySelectorAll<HTMLElement>('[data-slot="card-content"] p')]
    expect(lines).toHaveLength(2)
    const exam = lines.find((l) => l.textContent?.includes('身高'))!
    expect(exam).toHaveTextContent('血壓')
    expect(within(exam).getByTestId('report-source-program')).toBeInTheDocument()
    const other = lines.find((l) => l.textContent?.includes('心率'))!
    expect(within(other).queryByTestId('report-source-program')).not.toBeInTheDocument()
  })

  it('leaves a blood pressure from another day unbadged', () => {
    mockVitals([
      { ...obs('8302-2', 155, 'cm', '2026-01-13T00:00:00+08:00'), ...adultPreventive },
      bp(138, 76, '2026-08-25T09:10:00+08:00'),
    ])
    const { container } = render(<VitalsCard />)

    const lines = [...container.querySelectorAll<HTMLElement>('[data-slot="card-content"] p')]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('血壓')
    expect(within(lines[0]).queryByTestId('report-source-program')).not.toBeInTheDocument()
    expect(within(lines[1]).getByTestId('report-source-program')).toBeInTheDocument()
  })

  it('shows no badge when nothing is tagged as 成人預防保健', () => {
    mockVitals([obs('8302-2', 168, 'cm', '2018-02-12T00:00:00+08:00')])
    render(<VitalsCard />)
    expect(screen.queryByTestId('report-source-program')).not.toBeInTheDocument()
  })

  it('says there is nothing when the source has no vital signs', () => {
    mockVitals([])
    render(<VitalsCard />)
    expect(screen.getByText('無生命徵象資料。')).toBeInTheDocument()
  })
})
