import { render, within } from '@testing-library/react'
import { HeartFailureVisitFlow } from '@/features/clinical-decision-support/renderers/HeartFailureVisitFlow'
import { buildHeartFailureVisitFlow } from '@/features/clinical-decision-support/renderers/heart-failure-visit-flow'
import { buildHeartFailureBoard } from '@/features/clinical-decision-support/renderers/heart-failure-board'
import { CarriedAnswerContext } from '@/features/clinical-decision-support/renderers/visit/carried-answer-context'
import type { CdssResult } from '@/features/clinical-decision-support/types'
import type { PhenotypeAnswer } from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import type { ClinicVitals } from '@/features/clinical-decision-support/stores/clinic-vitals.store'

const now = new Date('2026-09-12T10:00:00+08:00')
const result = {
  packId: 'heart-failure-cdss', packVersion: '2.0.0', title: 'HF', summary: '', notEvaluated: [], disclaimer: '',
  recommendations: [{
    id: 'heart-failure-phenotype', moduleName: '分型', moduleGroup: 'assessment', domain: 'diagnosis', priority: 'routine',
    status: 'no-action', title: 'HFpEF', recommendation: '', rationale: '',
    patientEvidence: [{ label: 'LVEF', value: '60%', factKeys: ['LVEF'] }], nextActions: [], guidelineReferences: [], safetyBoundary: '',
  }],
} as CdssResult
const answer: PhenotypeAnswer = { answeredOn: '2026-09-12', hfSuspicion: 'suspected', diagnosis: 'hfpEF', hfpEfConfirmed: true } as PhenotypeAnswer
const vitals: ClinicVitals = { entries: {}, signAnswers: {}, nyhaClass: { value: 'III', modifiedAt: now.toISOString(), assessedOn: '2026-09-12' } }

function view(lookup: (key: string) => string | null) {
  const board = buildHeartFailureBoard(result, 'zh-TW', now)!
  const flow = buildHeartFailureVisitFlow({ board, result, isEnglish: false, now, clinicVitals: vitals, phenotypeAnswer: answer, decisions: {}, patientId: 'p' })
  return <CarriedAnswerContext.Provider value={lookup}>
    <HeartFailureVisitFlow flow={flow} board={board} isEnglish={false} now={now} expandedId={null} onToggle={jest.fn()}
      renderDetail={() => null} clinicVitals={vitals} onSaveClinicVitals={jest.fn()} phenotypeAnswer={answer}
      onAnswerPhenotype={jest.fn()} packVersion="2.0.0" />
  </CarriedAnswerContext.Provider>
}

test('the 三區塊 layout says a carried NYHA grade was carried, and from which day, instead of 「最後修改」 today', () => {
  // The label drops the year only for this year's dates, so the carried day is this year's.
  const { rerender } = render(view(key => (key === 'nyha' ? `${new Date().getFullYear()}-09-01` : null)))
  const nyha = document.getElementById('cdss-hf-question-nyha')!
  expect(within(nyha).getByText('帶入 · 09/01')).toBeVisible()
  expect(within(nyha).queryByText(/最後修改/)).not.toBeInTheDocument()
  rerender(view(() => null))
  expect(within(document.getElementById('cdss-hf-question-nyha')!).queryByText(/帶入 ·/)).not.toBeInTheDocument()
})
