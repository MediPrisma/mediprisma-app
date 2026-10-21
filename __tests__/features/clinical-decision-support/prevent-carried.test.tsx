import { render, screen } from '@testing-library/react'
import { PreventReadingContext, PreventRiskSummary } from '@/features/clinical-decision-support/renderers/PreventRiskSummary'
import { CarriedAnswerContext } from '@/features/clinical-decision-support/renderers/visit/carried-answer-context'
import type { PreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'
import type { CdssRecommendation } from '@/features/clinical-decision-support/types'

const reading = { values: {}, result: { status: 'ineligible', issues: [] },
  fields: [{ input: { key: 'smoking', type: 'select', label: { zh: '吸菸', en: 'Smoking' }, options: [{ value: 'yes', label: { zh: '是', en: 'Yes' } }] },
    value: 'yes', source: 'physician', locked: false, unitError: false }] } as unknown as PreventReading
const recommendation = { preventSummary: { title: 'PREVENT', recommendation: '', target: '', caveat: '', personalize: '', sourceUrl: '' } } as unknown as CdssRecommendation

test('a carried PREVENT answer names its source day instead of 「醫師輸入」', () => {
  const year = new Date().getFullYear()
  const view = (lookup: (key: string) => string | null) => <CarriedAnswerContext.Provider value={lookup}>
    <PreventReadingContext.Provider value={reading}><PreventRiskSummary recommendation={recommendation} locale="zh-TW" patientId="p" /></PreventReadingContext.Provider>
  </CarriedAnswerContext.Provider>
  const { rerender } = render(view(key => (key === 'prevent:smoking' ? `${year}-09-01` : null)))
  expect(screen.getByText('帶入 · 09/01，請確認仍適用')).toBeInTheDocument()
  rerender(view(() => null))
  expect(screen.getByText('醫師輸入，請病歷註記')).toBeInTheDocument()
})
