import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  ATRIAL_FIBRILLATION_GUIDELINE_PACK as PACK,
  type CdssPatientProfile,
} from '@voho0000/personalized-care'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import {
  AF_BOARD_CONFIG,
  buildDiseaseBoard,
} from '@/features/clinical-decision-support/renderers/disease-board'
import { useAfAnswersStore } from '@/features/clinical-decision-support/stores/af-answers.store'
const profile: CdssPatientProfile = {
  id: 'synthetic-af-ui',
  evaluatedAt: '2026-09-12T00:00:00+08:00',
  demographics: { sex: 'male' },
  facts: {
    age: { numericValue: 78, zh: '78 歲', en: '78 years' },
    atrialFibrillationDiagnosis: { zh: 'I48.0', en: 'I48.0' },
    heartRate: { numericValue: 88, zh: '88 bpm', en: '88 bpm', date: '2026-09-10' },
  },
}
const result = () => PACK.build({ profile: applyAfCalculatorResults(profile), locale: 'zh-TW' })
function Harness() {
  const [answers, setAnswers] = useState<Record<string, boolean | undefined>>({})
  const p = applyAfCalculatorResults({ ...profile, afClinicalAnswers: answers })
  return (
    <ClinicalDecisionSupportView
      result={PACK.build({ profile: p, locale: 'zh-TW' })}
      locale="zh-TW"
      layout="flow"
      patientId={profile.id}
      afAnswers={answers}
      onAfAnswer={(id, value) => setAnswers((old) => ({ ...old, [id]: value }))}
      profileFacts={p.facts}
    />
  )
}
describe('AF three-section visit flow', () => {
  it('maps all module output without losing no-action rows or adding clinical thresholds', () => {
    const r = result(),
      board = buildDiseaseBoard(r, AF_BOARD_CONFIG, 'zh-TW', profile.facts)!
    expect(board.consumedIds.size).toBe(r.recommendations.length)
    expect([...board.alerts, ...board.groups.flatMap((g) => g.items)]).toHaveLength(
      r.recommendations.length,
    )
    expect(board.headline?.title).toBe(
      r.recommendations.find((r) => r.id === 'af-documented-cha2ds2-vasc')?.title,
    )
    expect(board.metrics.find((m) => m.key === 'heartRate')).toMatchObject({
      value: '88 bpm',
      date: '2026-09-10',
    })
    expect(
      buildDiseaseBoard({ ...r, packId: 'heart-failure-cdss' }, AF_BOARD_CONFIG, 'zh-TW'),
    ).toBeUndefined()
  })
  it('starts with three collapsed sections and preserves every module when expanded', () => {
    render(<Harness />)
    for (const id of ['diagnosis', 'treatment', 'prognosis']) {
      const section = screen.getByTestId(`cdss-af-${id}`)
      expect(within(section).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
      expect(within(section).queryByTestId(/cdss-af-action-/)).not.toBeInTheDocument()
      fireEvent.click(within(section).getByRole('button'))
    }
    expect(screen.getAllByTestId(/^cdss-af-action-/)).toHaveLength(result().recommendations.length)
    const row = screen.getByTestId('cdss-af-action-af-anticoagulation-concordance')
    fireEvent.click(within(row).getByRole('button'))
    expect(within(row).getByText('抗凝與抗栓依據')).toBeInTheDocument()
    expect(within(row).getAllByText(/aspirin／clopidogrel/).length).toBeGreaterThan(0)
    fireEvent.click(
      within(screen.getByTestId('cdss-af-treatment')).getByRole('button', { name: /^治療/ }),
    )
    expect(
      screen.queryByTestId('cdss-af-action-af-anticoagulation-concordance'),
    ).not.toBeInTheDocument()
  })
  it('recomputes both risk scores when a physician confirms or withdraws stroke history', () => {
    render(<Harness />)
    const assessment = screen.getByTestId('cdss-af-prognosis')
    fireEvent.click(within(assessment).getByRole('button'))
    fireEvent.click(within(assessment).getByText(/血栓風險病史/))
    expect(
      within(assessment).getByText('CHA₂DS₂-VA 最低 2 分；CHA₂DS₂-VASc 最低 2 分'),
    ).toBeInTheDocument()
    const stroke = screen.getByRole('group', { name: '中風／TIA／動脈栓塞病史' })
    fireEvent.click(within(stroke).getByRole('button', { name: /^有$/ }))
    expect(
      within(assessment).getByText('CHA₂DS₂-VA 最低 4 分；CHA₂DS₂-VASc 最低 4 分'),
    ).toBeInTheDocument()
    fireEvent.click(within(stroke).getByRole('button', { name: '依病歷／待確定' }))
    expect(
      within(assessment).getByText('CHA₂DS₂-VA 最低 2 分；CHA₂DS₂-VASc 最低 2 分'),
    ).toBeInTheDocument()
  })
  it('defaults known AF to follow-up, switches views without changing diagnosis, and returns after confirmation', () => {
    render(<Harness />)
    const section = screen.getByTestId('cdss-af-diagnosis')
    expect(within(section).getByRole('button', { name: /^追蹤/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    fireEvent.click(within(section).getByRole('button'))
    const modes = within(section).getByRole('group', { name: '診斷或追蹤檢視' })
    expect(within(modes).getByRole('button', { name: '追蹤' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(section).getByText(/症狀與實際服藥/)).toBeInTheDocument()
    expect(within(section).queryByText(/^AF 診斷與超音波/)).not.toBeInTheDocument()
    fireEvent.click(within(modes).getByRole('button', { name: '診斷' }))
    expect(within(section).queryByText(/症狀與實際服藥/)).not.toBeInTheDocument()
    fireEvent.click(within(section).getByText(/^AF 診斷與超音波/))
    const confirmation = within(section).getByRole('group', { name: 'AF／flutter 診斷' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '有' }))
    expect(within(modes).getByRole('button', { name: '追蹤' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(within(modes).getByRole('button', { name: '診斷' }))
    fireEvent.click(within(section).getByText(/^AF 診斷與超音波/))
    fireEvent.click(
      within(within(section).getByRole('group', { name: 'AF／flutter 診斷' })).getByRole('button', {
        name: '無',
      }),
    )
    expect(within(modes).getByRole('button', { name: '診斷' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(within(modes).getByRole('button', { name: '追蹤' }))
    expect(within(section).getByRole('status')).toHaveTextContent('AF 尚未確診')
    fireEvent.click(within(modes).getByRole('button', { name: '診斷' }))
    fireEvent.click(within(section).getByText(/^AF 診斷與超音波/))
    fireEvent.click(
      within(within(section).getByRole('group', { name: 'AF／flutter 診斷' })).getByRole('button', {
        name: '有',
      }),
    )
    expect(within(modes).getByRole('button', { name: '追蹤' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  it('selects one control strategy while keeping anticoagulation available for both', () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByTestId('cdss-af-treatment')).getByRole('button'))
    const rate = screen.getByTestId('af-rate-control')
    const rhythm = screen.getByTestId('af-rhythm-control')
    expect(rate).not.toBeVisible()
    expect(rhythm).not.toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: 'Rate control（心率控制）' }))
    expect(rate).toBeVisible()
    expect(rhythm).not.toBeVisible()
    expect(screen.getByTestId('cdss-af-action-af-anticoagulation-concordance')).toBeVisible()
    expect(within(rate).getByText(/β-blocker／Non-DHP/)).toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: 'Rhythm control（節律控制）' }))
    expect(rate).not.toBeVisible()
    expect(rhythm).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Rate control（心率控制）' })).not.toBeChecked()
    expect(screen.getByTestId('cdss-af-action-af-antiarrhythmic-drug-safety')).toBeVisible()
    expect(screen.getByTestId('cdss-af-action-af-amiodarone-monitoring')).toBeVisible()
    expect(screen.getByTestId('cdss-af-action-af-anticoagulation-concordance')).toBeVisible()
  })
  it('clears memory-only answers when changing patients', () => {
    const s = useAfAnswersStore.getState()
    s.setPatient('a')
    s.answer('a', 'stroke', true)
    expect(useAfAnswersStore.getState().answers.stroke).toBe(true)
    s.setPatient('b')
    expect(useAfAnswersStore.getState().answers).toEqual({})
    s.setPatient('a')
    expect(useAfAnswersStore.getState().answers).toEqual({})
  })
  it('does not replace the classic module renderer', () => {
    render(<ClinicalDecisionSupportView result={result()} locale="zh-TW" layout="classic" />)
    expect(screen.queryByTestId('cdss-af-visit-flow')).not.toBeInTheDocument()
  })
})


it('prefills supported record answers without requiring clinician input', () => {
  const p: CdssPatientProfile = { ...profile, facts: { hypertensionDiagnosis: { zh: '高血壓', en: 'Hypertension', date: '2026-09-01' }, afEchoLavi: { zh: 'LAVI: 42 mL/m²', en: 'LAVI: 42 mL/m²', numericValue: 42, unit: 'mL/m²', date: '2026-09-01' } } }
  render(<ClinicalDecisionSupportView result={PACK.build({ profile: p, locale: 'zh-TW' })} locale="zh-TW" layout="flow" patientId={p.id} afAnswers={{}} onAfAnswer={() => {}} profileFacts={p.facts} />)
  fireEvent.click(within(screen.getByTestId('cdss-af-diagnosis')).getByRole('button', { name: /診斷 核對/ }))
  const la = screen.getByRole('group', { name: '超音波已確認心房擴大（核對原報告）', hidden: true })
  expect(within(la).getByRole('button', { name: '有', hidden: true }).getAttribute('aria-pressed')).toBe('true')
  const htn = screen.getByRole('group', { name: '高血壓病史', hidden: true })
  expect(within(htn).getByRole('button', { name: '有', hidden: true }).getAttribute('aria-pressed')).toBe('true')
})

describe('AF three-section carried answers', () => {
  it('marks an answer carried from a saved record with its day, as the decision map does', async () => {
    const { AF_CLINICAL_QUESTIONS } = await import('@voho0000/personalized-care')
    const { CarriedAnswerContext } = await import('@/features/clinical-decision-support/renderers/visit/carried-answer-context')
    const stroke = AF_CLINICAL_QUESTIONS.find((q) => q.zh === '中風／TIA／動脈栓塞病史')!
    const year = new Date().getFullYear()
    const answers = { [stroke.id]: true }
    const p = applyAfCalculatorResults({ ...profile, afClinicalAnswers: answers })
    const view = (lookup: (key: string) => string | null) => (
      <CarriedAnswerContext.Provider value={lookup}>
        <ClinicalDecisionSupportView result={PACK.build({ profile: p, locale: 'zh-TW' })} locale="zh-TW" layout="flow"
          patientId={profile.id} afAnswers={answers} onAfAnswer={() => {}} profileFacts={p.facts} />
      </CarriedAnswerContext.Provider>
    )
    const { rerender } = render(view((key) => (key === `af:${stroke.id}` ? `${year}-09-01` : null)))
    const assessment = screen.getByTestId('cdss-af-prognosis')
    fireEvent.click(within(assessment).getByRole('button'))
    fireEvent.click(within(assessment).getByText(/血栓風險病史/))
    expect(within(assessment).getByText('帶入 · 09/01')).toBeInTheDocument()
    rerender(view(() => null))
    expect(within(screen.getByTestId('cdss-af-prognosis')).queryByText(/帶入 ·/)).not.toBeInTheDocument()
  })
})
