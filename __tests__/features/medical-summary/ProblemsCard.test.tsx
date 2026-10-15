import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProblemsCard } from '@/features/medical-summary/components/ProblemsCard'
import type { MedicalSummaryResult, SummaryProblem } from '@/src/core/entities/medical-summary.entity'

const sourceIndex: MedicalSummaryResult['sourceIndex'] = [
  { key: 'C1', num: 1, verified: true, resourceType: 'Condition', resourceId: 'cond-1', display: 'Type 2 diabetes' },
  { key: 'L1', num: 2, verified: true, resourceType: 'DiagnosticReport', resourceId: 'rep-1', display: 'HbA1c', date: '2026-04-18' },
  { key: 'M1', num: 3, verified: true, resourceType: 'MedicationRequest', resourceId: 'med-1', display: 'Metformin 500mg' },
  { key: 'E1', num: 4, verified: true, resourceType: 'Encounter', resourceId: 'enc-1', display: 'Endocrinology clinic' },
]

const onNavigate = jest.fn()
beforeEach(() => onNavigate.mockClear())

/** A token's visible text, without the screen-reader hint the link adds. */
function visibleText(element: Element): string {
  const clone = element.cloneNode(true) as Element
  clone.querySelectorAll('.sr-only').forEach((node) => node.remove())
  return clone.textContent ?? ''
}

function renderCard(problem: SummaryProblem) {
  const result = { headline: '', problems: [problem], medicationEducation: [], sourceIndex } as unknown as MedicalSummaryResult
  return render(
    <ProblemsCard
      result={result}
      title="問題清單與負責院所"
      subtitle=""
      metaLabel="{count} 項"
      columnLabels={{ problem: "問題與依據", metric: "關鍵指標", care: "負責院所與用藥" }}
      metricLabel="指標"
      medicationsMoreLabel="+{count} 項"
      abnormalLabels={{ high: "偏高", low: "偏低", abnormal: "異常" }}
      basisLabel="依據:"
      organizationLatestLabel="該院最近紀錄"
      metricNeedsReviewLabel="需核對"
      inferredLabel="由慢箋推定"
      medicationInferredLabel="用藥推定"
      singleValueLabel="單次數值"
      medicationReviewLabel="藥物分類與此問題不符，待核對"
      verifyLabel="待核對"
      legendLabel="= 待核對"
      showAllLabel="顯示全部 {count} 項"
      showLessLabel="收合"
      typeLabel={(resourceType) => resourceType ?? ''}
      unverifiedLabel="來源不存在"
      sourceTypeMismatchLabel="來源類型不符"
      onNavigate={onNavigate}
    />,
  )
}

describe('ProblemsCard', () => {
  it('lets each column\'s claim open the records behind it, with no citation marks', () => {
    const { container } = renderCard({
      label: 'Type 2 diabetes mellitus',
      basis: '1 claim record',
      kind: 'careplan',
      metric: 'HbA1c 6.6% (single)',
      metricMeta: '2026-04-18',
      managedBy: '甲醫學中心',
      managedByDate: '2026-06-12',
      medications: 'Metformin 500mg',
      sourceKeys: ['C1', 'L1', 'M1'],
      basisSourceKeys: ['C1'],
      metricSourceKeys: ['L1'],
      medicationSourceKeys: ['M1'],
      managedBySourceKey: 'E1',
    })

    expect(container.querySelector('sup')).toBeNull()
    expect(screen.getByRole('button', { name: /^1 claim record\s*（開啟來源：Condition/ })).toBeInTheDocument()
    // The key values are the link, inside the metric cell.
    const metricLink = screen.getByRole('button', { name: /^HbA1c 6\.6% \(single\)\s*（開啟來源：DiagnosticReport/ })
    expect(metricLink.closest('[data-problem-column="metric"]')).not.toBeNull()
    fireEvent.click(metricLink)
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'DiagnosticReport', resourceId: 'rep-1' }))
    expect(screen.getByRole('button', { name: /^甲醫學中心 · 2026-06-12\s*（開啟來源：Encounter/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Metformin 500mg\s*（開啟來源：MedicationRequest/ })).toBeInTheDocument()
    // The basis line carries the problem's records, so the name is plain text.
    expect(screen.queryByRole('button', { name: /^Type 2 diabetes mellitus/ })).not.toBeInTheDocument()
  })

  it('prints a date the value already carries once, not twice', () => {
    const { container } = renderCard({
      label: 'Mitral regurgitation',
      kind: 'other',
      metric: 'Echo: mild MR (2026-07-07)',
      metricMeta: '2026-07-07',
      sourceKeys: ['L1'],
      metricSourceKeys: ['L1'],
    })
    const metric = container.querySelector('[data-problem-column="metric"]')!
    expect(metric.textContent?.match(/2026-07-07/g)).toHaveLength(1)
  })

  it('writes keys in the basis as the records they name', () => {
    renderCard({
      label: 'Type 2 diabetes mellitus',
      basis: '1 claim record (C1) and HbA1c L1',
      kind: 'careplan',
      sourceKeys: ['C1', 'L1'],
      basisSourceKeys: ['C1', 'L1'],
    })
    expect(screen.getByRole('button', {
      name: /^1 claim record \(Type 2 diabetes\) and HbA1c 2026-04-18\s*（2 筆來源）/,
    })).toBeInTheDocument()
  })

  it('says when the date is the facility\'s latest record rather than this problem\'s visit', () => {
    renderCard({
      label: 'Heart failure',
      kind: 'other',
      managedBy: '甲醫學中心 心臟科',
      managedByDate: '2026-06-01',
      managedByScope: 'organization',
      sourceKeys: ['C1'],
      basisSourceKeys: ['C1'],
      managedBySourceKey: 'E1',
    })
    expect(screen.getByText(/甲醫學中心 心臟科 · 該院最近紀錄 2026-06-01/)).toBeInTheDocument()
  })

  it('marks a metric whose trend could not be verified', () => {
    renderCard({
      label: 'Arterial stiffness', kind: 'other', metric: 'baPWV 1544；1547 cm/s', metricNeedsReview: true,
      sourceKeys: ['L1'], basisSourceKeys: ['L1'], metricSourceKeys: ['L1'],
    })
    // Beside the text, outside the two-line clamp, so it is never cut off.
    expect(screen.getByText(/baPWV 1544；1547 cm\/s/).closest('[data-problem-column="metric"]')).toHaveTextContent('需核對')
  })

  it('says when the managing visit was inferred from refills', () => {
    renderCard({
      label: 'T2DM', kind: 'diagnosis', managedBy: '示範甲診所', managedByDate: '2026-01-02', managedByScope: 'inferred',
      sourceKeys: ['M1'], basisSourceKeys: ['M1'], managedBySourceKey: 'E1',
    })
    expect(screen.getByText(/示範甲診所 · 2026-01-02（由慢箋推定）/)).toBeInTheDocument()
  })

  it('tags a problem that rests on medicines alone', () => {
    renderCard({
      label: 'Type 2 diabetes mellitus', kind: 'medication', inferredFromMedication: true,
      sourceKeys: ['M1'], basisSourceKeys: ['M1'],
    })
    expect(screen.getByText(/Type 2 diabetes mellitus/).closest('p')).toHaveTextContent('用藥推定')
    // With no basis line, the name itself opens the problem's records.
    expect(screen.getByRole('button', { name: /^Type 2 diabetes mellitus\s*（開啟來源：MedicationRequest/ })).toBeInTheDocument()
  })

  it('lets the name open a legacy result\'s row-level records', () => {
    renderCard({
      label: 'Type 2 diabetes mellitus',
      kind: 'careplan',
      metric: 'HbA1c 6.6%',
      sourceKeys: ['C1', 'L1'],
    })

    fireEvent.click(screen.getByRole('button', { name: /^Type 2 diabetes mellitus\s*（2 筆來源）/ }))
    fireEvent.click(screen.getByRole('button', { name: /DiagnosticReport · 2026-04-18/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'rep-1' }))
    expect(within(screen.getByText(/HbA1c 6\.6%/)).queryByRole('button')).not.toBeInTheDocument()
  })
  it('shows medicines as short-name tokens with the full name, folding past three', () => {
    const items = ['A', 'B', 'C', 'D', 'E'].map((letter, index) => ({
      key: `M${index + 1}`, name: `Synthetic${letter} 10 mg`, fullName: `SYNTHETIC-${letter} TABLETS 10MG "DEMO"`,
    }))
    const { container } = renderCard({
      label: 'Synthetic condition', kind: 'diagnosis', sourceKeys: ['M1'],
      medicationSourceKeys: items.map((item) => item.key), medicationItems: items,
      medications: items.map((item) => item.fullName).join('、'),
    })
    const tokens = () => [...container.querySelectorAll('[data-problem-medication]')]
    expect(tokens().map(visibleText)).toEqual(['SyntheticA 10 mg', 'SyntheticB 10 mg', 'SyntheticC 10 mg'])
    expect(tokens()[0]).toHaveAttribute('title', 'SYNTHETIC-A TABLETS 10MG "DEMO"')
    // Each token opens its own record (M1 is the only one this index holds).
    fireEvent.click(within(tokens()[0] as HTMLElement).getByRole('button'))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'med-1' }))
    expect(within(tokens()[1] as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
    // One "+N" per layout: +2 beside three tokens (layered), +3 beside two
    // (three columns, where the third token is hidden by the container query).
    expect(screen.getByRole('button', { name: '+3 項' })).toHaveClass('hidden')
    fireEvent.click(screen.getByRole('button', { name: '+2 項' }))
    expect(tokens()).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '收合' }))
    expect(tokens()).toHaveLength(3)
  })
  it('colours a flagged metric value and says so beyond colour', () => {
    const { container } = renderCard({
      label: 'Hypertriglyceridemia', kind: 'lab', sourceKeys: ['L1'], metricSourceKeys: ['L1'],
      metric: 'TG 467 → 103 mg/dL',
      metricSegments: [{ text: 'TG ' }, { text: '467', abnormal: 'high' }, { text: ' → 103 mg/dL' }],
    })
    const flagged = container.querySelector('[data-metric-abnormal="high"]')!
    expect(flagged).toHaveClass('text-clinical-abnormal')
    expect(flagged).toHaveTextContent('467↑（偏高）')
    expect(container.querySelectorAll('[data-metric-abnormal]')).toHaveLength(1)
  })
})

describe('ProblemsCard medicine review', () => {
  it('flags a medicine whose class does not fit the problem, and still shows it', () => {
    const { container } = renderCard({
      label: 'Primary open-angle glaucoma', kind: 'diagnosis', sourceKeys: ['M1'],
      medicationSourceKeys: ['M1'],
      medicationItems: [{ key: 'M1', name: 'Metformin 500 mg', fullName: 'Metformin 500mg' }],
      medicationReviewKeys: ['M1'],
    })
    const token = container.querySelector('[data-problem-medication]')!
    expect(token).toHaveAttribute('data-medication-review', 'true')
    expect(token).toHaveAttribute('title', expect.stringContaining('藥物分類與此問題不符'))
    expect(token).toHaveTextContent('Metformin 500 mg（藥物分類與此問題不符，待核對）')
  })
})
