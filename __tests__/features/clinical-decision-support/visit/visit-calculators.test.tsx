/**
 * 計算機 at the head of the decision map (owner decision 2026-10-19: one way
 * in, the map itself unchanged — 「幫我留C就好」): the heart-failure page's
 * guideline calculators listed by chapter, each opened beside its point, and a
 * prognosis result attached to the plan as a note that changes no
 * recommendation (「預後只當附註就好」).
 */
import { useMemo } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { usePhysicianDecisions, usePhysicianDecisionsStore } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { useVisitAnswerRecord, useVisitAnswersStore, visitAnswersOf } from '@/features/clinical-decision-support/stores/visit-answers.store'
import { useVisitCalculatorNotesStore } from '@/features/clinical-decision-support/stores/visit-calculator-notes.store'
import { calculatorNoteText } from '@/features/clinical-decision-support/renderers/visit/VisitCalculators'
import { VisitBookChromeContext } from '@/features/clinical-decision-support/renderers/visit/visit-book-chrome'
import type { CalcResult } from '@/features/medical-calculator/types'
import { scenarioRun, type ScenarioId } from './scenario-models'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ diagnosticReports: [] }),
}))

// The record the list reads: a 72-year-old woman with nothing else on file.
jest.mock('@/features/medical-calculator/hooks/use-lab-autofill.hook', () => {
  const actual = jest.requireActual('@/features/medical-calculator/hooks/use-lab-autofill.hook')
  const autofill = actual.buildAutofill([], { age: 72, gender: 'female' })
  return { ...actual, useLabAutofill: () => ({ autofill, isLoading: false, error: null, retry: jest.fn() }) }
})

// The calculator itself is the medical calculator's own; here it hands back a result.
const MAGGIC_RESULT: CalcResult = {
  value: '24',
  unit: '分',
  extra: [
    { label: { en: '1-year all-cause mortality', zh: '1 年全因死亡率' }, value: '15.3%' },
    { label: { en: '3-year all-cause mortality', zh: '3 年全因死亡率' }, value: '36.6%' },
  ],
}
jest.mock('@/features/medical-calculator/components/CalculatorDetail', () => ({
  CalculatorDetail: ({ calc, onResult }: { calc: { id: string }; onResult?: (result: unknown) => void }) => (
    <div data-testid={`calculator-detail-${calc.id}`}>
      <button type="button" onClick={() => onResult?.(MAGGIC_RESULT)}>算出結果</button>
    </div>
  ),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webStreams = require('node:stream/web')
for (const name of ['TransformStream', 'ReadableStream', 'WritableStream'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = webStreams[name]
  }
}

const PATIENT = 'calculator-patient'

function Page({ id, page }: { id: ScenarioId; page: 'hf' | 'af' }) {
  const decisions = usePhysicianDecisions(PATIENT)
  const record = useVisitAnswerRecord(PATIENT)
  const answers = useMemo(() => visitAnswersOf(record), [record])
  const run = useMemo(() => scenarioRun(id, { page, answers }), [answers, id, page])
  return (
    <VisitBookChromeContext.Provider value={{ inline: true }}>
      <ClinicalDecisionSupportView
        result={run.result}
        locale="zh-TW"
        layout="map"
        patientId={PATIENT}
        visitModel={run.model}
        companionResults={run.companion ? [run.companion] : undefined}
        profileFacts={run.profile.facts}
        physicianDecisions={decisions}
        onRecordDecision={(key, input) => usePhysicianDecisionsStore.getState().recordDecision(PATIENT, key, input)}
        onClearDecision={(key) => usePhysicianDecisionsStore.getState().clearDecision(PATIENT, key)}
        visitAnswers={answers}
        onVisitAnswer={(ask, value) => useVisitAnswersStore.getState().answer(PATIENT, ask, value)}
      />
    </VisitBookChromeContext.Provider>
  )
}

const openList = () => fireEvent.click(screen.getByTestId('cdss-book-calculators'))

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  usePhysicianDecisionsStore.getState().clearDecisions(PATIENT)
  useVisitAnswersStore.getState().clearAnswers(PATIENT)
  useVisitCalculatorNotesStore.setState({ notes: {} })
  ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()
})

describe('決策地圖 v2 · 計算機', () => {
  it('is one button at the head of the HF page; the map and its rows carry no calculator', () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    const button = screen.getByTestId('cdss-book-calculators')
    expect(button).toHaveAccessibleName('計算機，9 個可用')
    expect(within(screen.getByTestId('cdss-book-map')).queryByText(/MAGGIC|HFA-PEFF/)).toBeNull()
    expect(screen.queryByTestId('cdss-book-calculator-list')).toBeNull()
  })

  it('is not on the AF page', () => {
    render(<Page id="p9-hfpef-af-dose" page="af" />)
    expect(screen.queryByTestId('cdss-book-calculators')).toBeNull()
  })

  it('lists the calculators by chapter, each with its point and where it stands for this patient (P9)', () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    openList()
    const list = screen.getByTestId('cdss-book-calculator-list')
    expect(within(list).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      '是哪一型？', '共病：HFpEF 的另一半治療', '裝置與進階',
    ])
    expect(screen.getByTestId('cdss-book-calculator-maggic')).toHaveTextContent('→ DP-19')
    expect(screen.getByTestId('cdss-book-calculator-maggic')).toHaveAttribute('data-status', 'to-fill')
    expect(screen.getByTestId('cdss-book-calculator-cha2ds2-va')).toHaveTextContent('→ DP-14')
    expect(screen.getByTestId('cdss-book-calculator-shfm')).toHaveTextContent('僅資料')
    // GWTG-HF reads an admission's values: never today's chart.
    expect(screen.getByTestId('cdss-book-calculator-gwtg-hf')).toHaveTextContent('住院時適用')
  })

  it('leaves out the AF calculators when the page has no AF, and LIFE-Preserved below an LVEF of 50% (P2)', () => {
    render(<Page id="p2-new-hfref" page="hf" />)
    openList()
    expect(screen.queryByTestId('cdss-book-calculator-cha2ds2-va')).toBeNull()
    expect(screen.queryByTestId('cdss-book-calculator-life-preserved')).toBeNull()
    expect(screen.getByTestId('cdss-book-calculator-maggic')).toBeInTheDocument()
  })

  it('opens a calculator beside its point, and attaches its result to 今天的計畫 as a note only (P9)', () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    openList()
    fireEvent.click(screen.getByTestId('cdss-book-calculator-maggic'))
    // The page is taken to DP-19 behind the panel.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    const panel = screen.getByTestId('cdss-book-calculator-panel')
    expect(within(panel).getByTestId('calculator-detail-maggic-hf')).toBeInTheDocument()
    const attach = within(panel).getByTestId('cdss-book-calculator-attach')
    expect(attach).toBeDisabled()
    fireEvent.click(within(panel).getByText('算出結果'))
    expect(attach).toHaveTextContent('附註到 DP-19')
    fireEvent.click(attach)
    expect(screen.queryByTestId('cdss-book-calculator-panel')).toBeNull()

    const notes = screen.getByTestId('cdss-visit-plan-calculator-notes')
    expect(notes).toHaveTextContent('DP-19 附註：MAGGIC 24 分・1 年全因死亡率 15.3%・3 年全因死亡率 36.6%')
    // A note is not a decision: nothing is recorded.
    expect(screen.getByTestId('cdss-visit-plan-empty')).toBeInTheDocument()

    act(() => {
      fireEvent.click(within(notes).getByRole('button', { name: '移除 DP-19 的附註' }))
    })
    expect(screen.queryByTestId('cdss-visit-plan-calculator-notes')).toBeNull()
  })

  it('opens a model with no formula connected on its data checklist, with nothing to attach', () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    openList()
    fireEvent.click(screen.getByTestId('cdss-book-calculator-shfm'))
    const panel = screen.getByTestId('cdss-book-calculator-panel')
    expect(within(panel).getByTestId('prognosis-calculator-shfm')).toBeInTheDocument()
    expect(within(panel).queryByTestId('cdss-book-calculator-attach')).toBeNull()
  })
})

describe('calculatorNoteText', () => {
  it('writes the result and its first two rows, and says when inputs are empty', () => {
    expect(calculatorNoteText('MAGGIC', MAGGIC_RESULT, 'zh-TW')).toBe('MAGGIC 24 分・1 年全因死亡率 15.3%・3 年全因死亡率 36.6%')
    expect(calculatorNoteText('MAGGIC', { ...MAGGIC_RESULT, completeness: { complete: false, upperBound: 30, missingKeys: ['smoking'] } }, 'en'))
      .toBe('MAGGIC 24 分 · 1-year all-cause mortality 15.3% · 3-year all-cause mortality 36.6% (some inputs empty)')
  })
})
