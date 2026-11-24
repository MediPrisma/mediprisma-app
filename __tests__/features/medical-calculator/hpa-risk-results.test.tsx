import { fireEvent, render, screen, within } from '@testing-library/react'
import { HpaRiskResults } from '@/features/medical-calculator/components/HpaRiskResults'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { HPA_RISK } from '@/features/medical-calculator/calculators/hpa-risk'
import { calculateHpaRisks } from '@/features/medical-calculator/hpa-risk-model'
import { useLabAutofill, type Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import type { CalcValues } from '@/features/medical-calculator/types'

jest.mock('@/features/medical-calculator/hooks/use-lab-autofill.hook', () => ({
  useLabAutofill: jest.fn(),
}))

const baseline: CalcValues = {
  gender: 'male', age: '50', height: '170', weight: '70', waist: '85',
  sbp: '120', glu: '90', chol: '180', tg: '100', ldlc: '100', hdlc: '50',
  diabetes: 'no', hbp: 'no', smoke: 'no', prior_cvd: 'no',
}

it('truncates the displayed approximate risk instead of rounding it', () => {
  const diabetes = calculateHpaRisks(baseline).find((result) => result.outcome === 'diabetes')!
  expect(diabetes.status).toBe('estimated')
  expect(diabetes.risk!).toBeGreaterThan(16.5)
  expect(diabetes.risk!).toBeLessThan(17)

  render(<HpaRiskResults values={baseline} locale="zh-TW" />)
  const diabetesRow = screen.getByRole('group', { name: '糖尿病' })
  expect(within(diabetesRow).getByText('約16%')).toBeInTheDocument()
  expect(within(diabetesRow).queryByText('約17%')).not.toBeInTheDocument()
})

function renderWithDatedLabs(latestDate: string, overrides: CalcValues = {}) {
  const values = { ...baseline, ...overrides }
  const calc = HPA_RISK[0]
  const autofill: Autofill = {
    sex: values.gender,
    resolve: (source) => {
      const input = calc.inputs.find((item) => item.source && item.source === source)
      if (!input || input.type !== 'number' || !values[input.key]) return undefined
      return {
        value: Number(values[input.key]), unit: input.unit ?? '',
        date: input.key === 'chol' ? '2026-08-01' : latestDate,
      }
    },
  }
  jest.mocked(useLabAutofill).mockReturnValue({
    autofill, isLoading: false, error: null, retry: jest.fn(),
  } as ReturnType<typeof useLabAutofill>)
  // Synthetic, explicitly answered history (the record and presumed answers are tested elsewhere).
  const answeredCalc = {
    ...calc,
    inputs: calc.inputs.map((input) => input.type === 'select' && input.source?.kind !== 'sex'
      ? { ...input, source: undefined, presumed: undefined, defaultValue: values[input.key] }
      : input),
  }
  render(<LanguageProvider>
    <CalculatorDetail calc={answeredCalc} onBack={() => {}} isFavorite={false} onToggleFavorite={() => {}} />
  </LanguageProvider>)
}

it.each([
  ['2026-08-08', 7],
  ['2026-08-09', 8],
  ['2026-09-16', 46],
])('keeps all eligible risks visible with labs ending on %s (%i days apart)', (latestDate, spanDays) => {
  renderWithDatedLabs(latestDate)
  const results = screen.getByRole('region', { name: '五項慢性病風險' })
  expect(within(results).getAllByText(/^約\d+%$/)).toHaveLength(5)
  expect(within(results).getByText('約16%')).toBeInTheDocument()
  expect(screen.queryByText(/已暫停顯示風險/)).not.toBeInTheDocument()
  if (spanDays > 7) {
    expect(screen.getAllByText(new RegExp(`^提醒：檢驗日期相差 ${spanDays} 天`))).toHaveLength(1)
    expect(screen.getByText(/仍會顯示可估算的結果/)).toBeInTheDocument()
  } else {
    expect(screen.queryByText(/^提醒：檢驗日期相差/)).not.toBeInTheDocument()
  }
})

it('still excludes known disease while showing other risks when dates differ', () => {
  renderWithDatedLabs('2026-09-16', { diabetes: 'yes', hbp: 'yes' })
  const results = screen.getByRole('region', { name: '五項慢性病風險' })
  expect(within(results).getAllByText(/^約\d+%$/)).toHaveLength(3)
  expect(within(results).getAllByText(/已有病史，不估新發/)).toHaveLength(2)
  expect(within(results).getAllByRole('button', { name: /此處估計首次發病風險，不適用已確診者/ })).toHaveLength(2)
  expect(screen.getByText(/^提醒：檢驗日期相差 46 天/)).toBeInTheDocument()
})

it.each(['140', '154'])('explains systolic BP %s as an official applicability limit, not a diagnosis', (sbp) => {
  render(<HpaRiskResults values={{ ...baseline, sbp }} locale="zh-TW" />)
  const row = screen.getByRole('group', { name: '高血壓' })
  expect(within(row).getByText('需核對血壓')).toBeInTheDocument()
  expect(within(row).getByText(new RegExp(`${sbp} mmHg ≥140`))).toHaveTextContent('單次讀值非確診')
  expect(within(row).getByRole('button', { name: /國健署試算在 ≥140/ })).toBeInTheDocument()
  expect(within(row).queryByText(/已有病史/)).not.toBeInTheDocument()
  expect(within(row).queryByText(/約\d+%/)).not.toBeInTheDocument()
  expect(within(screen.getByRole('group', { name: '冠心病' })).getByText(/約\d+%/)).toBeInTheDocument()
})

it('keeps controlled known hypertension distinct from an elevated reading', () => {
  render(<HpaRiskResults values={{ ...baseline, hbp: 'yes' }} locale="zh-TW" />)
  const row = screen.getByRole('group', { name: '高血壓' })
  expect(within(row).getByText('已有病史，不估新發')).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: /已填寫有高血壓病史/ })).toBeInTheDocument()
  expect(within(row).queryByText(/需核對血壓/)).not.toBeInTheDocument()
})

it('explains fasting glucose 126 without asserting known diabetes', () => {
  render(<HpaRiskResults values={{ ...baseline, glu: '126' }} locale="zh-TW" />)
  const row = screen.getByRole('group', { name: '糖尿病' })
  expect(within(row).getByText('需核對血糖')).toBeInTheDocument()
  expect(within(row).getByText(/126 mg\/dL ≥126/)).toHaveTextContent('單次數值非確診')
  expect(within(row).getByRole('button', { name: /核對空腹狀態及病史/ })).toBeInTheDocument()
  expect(within(row).queryByText(/已有病史/)).not.toBeInTheDocument()
})

it.each([
  ['age', '94', '年齡 94 歲；本地已驗算 35–70 歲（整數）。'],
  ['waist', '130', '腰圍 130 cm；本地已驗算 60–125 cm。'],
])('shows the entered %s and the actual local limit', (key, value, explanation) => {
  render(<HpaRiskResults values={{ ...baseline, [key]: value }} locale="zh-TW" />)
  const row = screen.getByRole('group', { name: '冠心病' })
  expect(within(row).getByText(new RegExp(`${value} 超出驗算範圍`))).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: new RegExp(explanation) })).toBeInTheDocument()
})

it('does not interpret unknown history or missing LDL as normal', () => {
  render(<HpaRiskResults values={{ ...baseline, diabetes: '', ldlc: '' }} locale="zh-TW" />)
  expect(within(screen.getByRole('group', { name: '糖尿病' })).getByText('待填：糖尿病史')).toBeInTheDocument()
  expect(within(screen.getByRole('group', { name: '高血壓' })).getByText('待填：LDL-C')).toBeInTheDocument()
  expect(screen.getByText(/未顯示百分比不代表低風險/)).toBeInTheDocument()
})

it('keeps missing outcomes to one actionable row with all required fields accessible', () => {
  const onReviewField = jest.fn()
  render(<HpaRiskResults values={{ ...baseline, hbp: '', prior_cvd: '' }} locale="zh-TW" onReviewField={onReviewField} />)
  const row = screen.getByRole('group', { name: '冠心病' })
  expect(within(row).getByText('待填：高血壓史等 2 項 ›')).toBeInTheDocument()
  expect(row.querySelector('p')).not.toBeInTheDocument()
  const action = within(row).getByRole('button', { name: /高血壓史、冠心病／中風病史/ })
  fireEvent.click(action)
  expect(onReviewField).toHaveBeenCalledWith('hbp')
})

it('explains prior cardiovascular history without implying zero risk', () => {
  render(<HpaRiskResults values={{ ...baseline, prior_cvd: 'yes' }} locale="zh-TW" />)
  expect(screen.getAllByRole('button', { name: /不估算再次發病的風險/ })).toHaveLength(3)
  expect(screen.getAllByText(/^約\d+%$/)).toHaveLength(2)
})

it.each(['male', 'female'])('retains five estimates for an eligible %s with no outdated error warning', (gender) => {
  render(<HpaRiskResults values={{ ...baseline, gender }} locale="zh-TW" />)
  expect(screen.getAllByText(/^約\d+%$/)).toHaveLength(5)
  expect(screen.getAllByText(/^(低|中|高)風險$/)).toHaveLength(5)
  expect(screen.queryByText(/合成案例驗算有誤差|官方等級可能不同/)).not.toBeInTheDocument()
  expect(screen.getByText(/高血壓依同性別同年齡比較/)).toBeInTheDocument()
})

it('provides English explanations and field actions', () => {
  const onReviewField = jest.fn()
  render(<HpaRiskResults values={{ ...baseline, sbp: '140' }} locale="en" onReviewField={onReviewField} />)
  const row = screen.getByRole('group', { name: 'Hypertension' })
  expect(within(row).getByText(/Check BP/)).toBeInTheDocument()
  expect(within(row).getByText(/One reading is not a diagnosis/)).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: /Review input/ }))
  expect(onReviewField).toHaveBeenCalledWith('sbp')
})

it('groups every input and lets the user jump from a result to the relevant field', () => {
  renderWithDatedLabs('2026-08-01', { sbp: '154' })
  expect(within(screen.getByRole('group', { name: '基本資料' })).getAllByRole('spinbutton')).toHaveLength(4)
  expect(within(screen.getByRole('group', { name: '病史與吸菸' })).getAllByRole('combobox')).toHaveLength(4)
  expect(within(screen.getByRole('group', { name: '血壓與檢驗' })).getAllByRole('spinbutton')).toHaveLength(6)
  fireEvent.click(within(screen.getByRole('group', { name: '高血壓' })).getByRole('button', { name: /核對欄位/ }))
  expect(screen.getByRole('spinbutton', { name: '收縮壓 (mmHg)' })).toHaveFocus()
  const scrollIntoView = jest.fn()
  const resultContainer = screen.getByRole('region', { name: '五項慢性病風險' }).parentElement!
  resultContainer.scrollIntoView = scrollIntoView
  fireEvent.click(screen.getByRole('button', { name: '回到風險結果' }))
  expect(resultContainer).toHaveFocus()
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
})

it('updates only the affected outcome when a user clears and restores LDL', () => {
  renderWithDatedLabs('2026-08-01')
  const ldl = screen.getByRole('spinbutton', { name: '低密度脂蛋白膽固醇 (mg/dL)' })
  fireEvent.change(ldl, { target: { value: '' } })
  expect(within(screen.getByRole('group', { name: '高血壓' })).getByText('待填：LDL-C ›')).toBeInTheDocument()
  expect(screen.getAllByText(/^約\d+%$/)).toHaveLength(4)
  fireEvent.change(ldl, { target: { value: '100' } })
  expect(screen.getAllByText(/^約\d+%$/)).toHaveLength(5)
})
