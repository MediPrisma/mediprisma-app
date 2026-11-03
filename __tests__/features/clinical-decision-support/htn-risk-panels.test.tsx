/**
 * The HTN page's 計算機 panels (plan 05 §19, owner 2026-11-03): PREVENT bound
 * to the same answers the pack's facts are built from, and the HPA
 * reconstruction as the host read it.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { PreventReadingContext } from '@/features/clinical-decision-support/renderers/PreventRiskSummary'
import { HpaReadingContext, HpaVisitPanel, PceReadingContext, PceVisitPanel, PreventVisitPanel, RiskInputsPanel } from '@/features/clinical-decision-support/renderers/visit/HtnRiskPanels'
import { usePreventStore } from '@/features/clinical-decision-support/stores/prevent-inputs.store'
import { buildPreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'
import { buildHpaReading, buildPceReading } from '@/features/clinical-decision-support/utils/htn-risk-readings'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcValues } from '@/features/medical-calculator/types'

type AutofillSource = Parameters<Autofill['resolve']>[0]

const AT = '2026-11-03T09:00:00+08:00'
const profile = { id: 'synthetic-htn', evaluatedAt: AT, facts: {} }
const record: Autofill = {
  sex: 'female',
  resolve: (source?: AutofillSource) => {
    if (!source) return undefined
    if (source.kind === 'age') return { value: 50, unit: 'y', date: '' }
    if (source.kind === 'lab' && source.keys.includes('CHOL')) return { value: 200, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'lab' && source.keys.includes('HDL')) return { value: 50, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'vital' && source.vital === 'waist') return { value: 85, unit: 'cm', date: '2026-10-20' }
    if (source.kind === 'vital' && source.vital === 'sbp') return { value: 128, unit: 'mmHg', date: '2026-10-20' }
    return undefined
  },
}
const answered: CalcValues = { bmi: '24', egfr: '90', dm: 'no', smoking: 'no', statin: 'no', bptreat: 'no', cvd: 'no', subclinical: 'no', genetic: 'no', eskd: 'no', limitedLife: 'no' }

describe('HTN DP-08 panels', () => {
  beforeEach(() => act(() => usePreventStore.getState().activate('synthetic-htn')))

  it('shows the PREVENT ASCVD result with the host caveat and writes an answer to the PREVENT store', () => {
    const reading = buildPreventReading(profile, record, answered)
    const onResult = jest.fn()
    render(
      <PreventReadingContext.Provider value={reading}>
        <PreventVisitPanel isEnglish={false} onResult={onResult} />
      </PreventReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-prevent-panel')
    expect(within(panel).getByTestId('cdss-htn-prevent-headline')).toHaveTextContent(/10 年 ASCVD 風險（PREVENT 基礎模型）\d+\.\d%/)
    expect(panel).toHaveTextContent('AHA 2025 的 7.5% 門檻讀的是 total CVD')
    // The result goes up to the panel's owner, for the 附註 to today's plan.
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ unit: '%', value: reading.result.risk10!.toFixed(1), interpretation: expect.objectContaining({ zh: '10 年 ASCVD（PREVENT 基礎模型）' }) }))
    // The 既有心血管疾病 answer changes the store the pack's facts are built from.
    const cvd = within(panel).getByRole('group', { name: /既有心血管疾病/ })
    fireEvent.click(within(cvd).getByRole('button', { name: /是/ }))
    expect(usePreventStore.getState().inputs.cvd).toBe('yes')
  })

  it('says what is still to confirm before any result reaches the pack', () => {
    const reading = buildPreventReading(profile, record, {})
    render(
      <PreventReadingContext.Provider value={reading}>
        <PreventVisitPanel isEnglish={false} />
      </PreventReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-prevent-panel')
    expect(within(panel).getByTestId('cdss-htn-prevent-headline')).toHaveTextContent(/—.*待核對：.*既有心血管疾病/)
  })

  it('shows the HPA MACE estimate with its level, the five outcomes and where each input came from', () => {
    const prevent = buildPreventReading(profile, record, answered)
    const hpa = buildHpaReading(profile, record, prevent)
    const onResult = jest.fn()
    render(
      <HpaReadingContext.Provider value={hpa}>
        <HpaVisitPanel isEnglish={false} onResult={onResult} />
      </HpaReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-hpa-panel')
    expect(within(panel).getByTestId('cdss-htn-hpa-headline')).toHaveTextContent(/10 年重大心血管事件（MACE）風險\d+(\.\d+)?%[低中高]風險/)
    expect(panel).toHaveTextContent('國健署心血管風險預測公式')
    expect(panel).toHaveTextContent('非官方係數')
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ unit: '%', value: String(hpa.mace!.risk), severity: hpa.mace!.level }))
    expect(panel).toHaveTextContent('重大心血管事件')
    fireEvent.click(within(panel).getByText('讀到的輸入'))
    expect(panel).toHaveTextContent(/腰圍：85 cm · 病歷 · 2026-10-20/)
    expect(panel).toHaveTextContent(/既往冠心病或中風：no · 醫師填/)
  })

  it('explains an estimate it cannot make', () => {
    const prevent = buildPreventReading(profile, { ...record, resolve: (source) => (source?.kind === 'vital' && source.vital === 'waist' ? undefined : record.resolve(source)) }, answered)
    const hpa = buildHpaReading(profile, { ...record, resolve: (source) => (source?.kind === 'vital' && source.vital === 'waist' ? undefined : record.resolve(source)) }, prevent)
    expect(hpa.mace?.status).toBe('missing')
    render(
      <HpaReadingContext.Provider value={hpa}>
        <HpaVisitPanel isEnglish={false} />
      </HpaReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-hpa-panel')
    expect(within(panel).getByTestId('cdss-htn-hpa-headline')).toHaveTextContent(/—.*待填：腰圍/)
  })

  it('shows the Pooled Cohort result with its band and the equations used, and hands it up for the note', () => {
    const reading = buildPreventReading(profile, record, answered)
    const pce = buildPceReading(reading)!
    const onResult = jest.fn()
    render(
      <PreventReadingContext.Provider value={reading}>
        <PceReadingContext.Provider value={pce}>
          <PceVisitPanel isEnglish={false} onResult={onResult} />
        </PceReadingContext.Provider>
      </PreventReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-pce-panel')
    expect(within(panel).getByTestId('cdss-htn-pce-headline')).toHaveTextContent(/10 年 hard ASCVD 風險（2013 ACC\/AHA Pooled Cohort 方程式）\d+\.\d%(低|邊緣|中等|高)風險.*使用白人係數/)
    expect(panel).toHaveTextContent('台灣病人預設「其他族裔」')
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ unit: '%', value: pce.result.risk10!.toFixed(1), extra: [{ label: expect.anything(), value: 'White' }] }))
    // The equation group is a shared field, editable here too.
    const race = within(panel).getByRole('group', { name: /係數族群/ })
    fireEvent.click(within(race).getByRole('button', { name: /非裔美國人/ }))
    expect(usePreventStore.getState().inputs.race).toBe('aa')
  })

  it("the 共用輸入 panel lists every field in groups with its origin, the three results on top, and 確認 records a rule's value as the clinician's", () => {
    const reading = buildPreventReading(
      { ...profile, facts: { type2DiabetesDiagnosis: { zh: '第二型糖尿病 E11.9', en: 'Type 2 diabetes E11.9', date: '2026-01-10' } } },
      { ...record, clinicalSelects: { antihypertensives: { value: 'yes', date: '2026-10-28', testName: '降血壓藥處方供藥中' } } },
      { smoking: 'no', statin: 'no', cvd: 'no', subclinical: 'no', genetic: 'no', eskd: 'no', limitedLife: 'no', bmi: '24', egfr: '90' },
    )
    render(
      <PreventReadingContext.Provider value={reading}>
        <PceReadingContext.Provider value={buildPceReading(reading)}>
          <HpaReadingContext.Provider value={buildHpaReading(profile, record, reading)}>
            <RiskInputsPanel isEnglish={false} />
          </HpaReadingContext.Provider>
        </PceReadingContext.Provider>
      </PreventReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-risk-inputs-panel')
    expect(within(panel).getByTestId('cdss-htn-risk-standing')).toHaveTextContent(/PREVENT-ASCVD\d+\.\d%ACC\/AHA PCE\d+\.\d%國健署 MACE/)
    for (const group of ['基本', '量測', '檢驗', '病史', '用藥']) expect(within(panel).getByRole('region', { name: group })).toBeInTheDocument()
    // Origins named under the fields: the code locks, the rule proposes.
    const dm = within(panel).getByTestId('cdss-risk-field-dm')
    expect(dm).toHaveAttribute('data-origin', 'icd')
    expect(dm).toHaveTextContent('ICD：第二型糖尿病 E11.9')
    expect(within(dm).getByRole('group')).toBeDisabled()
    const bptreat = within(panel).getByTestId('cdss-risk-field-bptreat')
    expect(bptreat).toHaveAttribute('data-origin', 'rule')
    expect(bptreat).toHaveTextContent('規則：降血壓藥處方供藥中')
    expect(bptreat).toHaveTextContent('PREVENT')
    expect(bptreat).toHaveTextContent('PCE')
    fireEvent.click(within(bptreat).getByTestId('cdss-risk-confirm-bptreat'))
    expect(usePreventStore.getState().inputs.bptreat).toBe('yes')
    // The PCE default group is a rule too, with its own 確認.
    expect(within(panel).getByTestId('cdss-risk-field-race')).toHaveAttribute('data-origin', 'rule')
    expect(within(panel).getByTestId('cdss-risk-confirm-race')).toBeInTheDocument()
  })
})
