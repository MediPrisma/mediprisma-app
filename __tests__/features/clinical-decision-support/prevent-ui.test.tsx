import { render, screen, fireEvent, within } from '@testing-library/react'
import { PreventReadingContext, PreventRiskSummary } from '@/features/clinical-decision-support/renderers/PreventRiskSummary'
import { buildPreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'
import { usePreventStore } from '@/features/clinical-decision-support/stores/prevent-inputs.store'
import type { CdssRecommendation } from '@/features/clinical-decision-support/types'
test('a history question with no evidence is prefilled 否 and physician answers go to patient-scoped store', () => {
  usePreventStore.getState().activate('synthetic')
  const reading = buildPreventReading({id:'synthetic',facts:{}},{resolve:()=>undefined},{})
  const recommendation = {id:'test',preventSummary:{title:'PREVENT-ASCVD 與 ACC/AHA 2026',recommendation:'請核對',target:'待核對',caveat:'非健保給付',personalize:'請病歷註記',sourceUrl:'https://doi.org/10.1161/CIR.0000000000001423'}} as unknown as CdssRecommendation
  render(<PreventReadingContext.Provider value={reading}><PreventRiskSummary recommendation={recommendation} locale="zh-TW" patientId="synthetic" /></PreventReadingContext.Provider>)
  expect(screen.getByRole('status')).toHaveTextContent('待核對計算資料')
  fireEvent.click(screen.getByText('檢核／補齊 PREVENT 資料'))
  const smoking=screen.getByRole('group', {name:'目前吸菸（近 30 天）'})
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  // Owner 2026-11-16: nothing in the record is a prefilled 否, not 未確認.
  expect(within(smoking).getByRole('button', {name:'× 否'})).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(smoking).getByRole('button', {name:'✓ 是'}))
  expect(usePreventStore.getState().inputs.smoking).toBe('yes')
  expect(screen.getByText('非健保給付')).toBeInTheDocument()
})
