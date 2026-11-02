/**
 * The HTN page's 計算機 panels (plan 05 §19, owner 2026-11-03): PREVENT bound
 * to the same answers the pack's facts are built from, and the HPA
 * reconstruction as the host read it.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { PreventReadingContext } from '@/features/clinical-decision-support/renderers/PreventRiskSummary'
import { HpaReadingContext, HpaVisitPanel, PreventVisitPanel } from '@/features/clinical-decision-support/renderers/visit/HtnRiskPanels'
import { usePreventStore } from '@/features/clinical-decision-support/stores/prevent-inputs.store'
import { buildPreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'
import { buildHpaReading } from '@/features/clinical-decision-support/utils/htn-risk-readings'
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
    render(
      <PreventReadingContext.Provider value={reading}>
        <PreventVisitPanel isEnglish={false} />
      </PreventReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-prevent-panel')
    expect(within(panel).getByRole('status')).toHaveTextContent(/10 年 ASCVD \d+\.\d%/)
    expect(panel).toHaveTextContent('AHA 2025 的 7.5% 門檻讀的是 total CVD')
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
    expect(within(panel).getByRole('status')).toHaveTextContent('輸入尚待核對')
    expect(panel).toHaveTextContent(/需確認：.*既有心血管疾病/)
  })

  it('shows the HPA MACE estimate with its level, the five outcomes and where each input came from', () => {
    const prevent = buildPreventReading(profile, record, answered)
    const hpa = buildHpaReading(profile, record, prevent)
    render(
      <HpaReadingContext.Provider value={hpa}>
        <HpaVisitPanel isEnglish={false} />
      </HpaReadingContext.Provider>,
    )
    const panel = screen.getByTestId('cdss-htn-hpa-panel')
    expect(within(panel).getByRole('status')).toHaveTextContent(/10 年 MACE \d+(\.\d+)?%（[低中高]）/)
    expect(panel).toHaveTextContent('非官方係數')
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
    expect(within(panel).getByRole('status')).toHaveTextContent('MACE 目前無法估計')
    expect(panel).toHaveTextContent(/腰圍/)
  })
})
