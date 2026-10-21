/**
 * 計算機 at the head of the decision map (owner decision 2026-10-19: one way
 * in, the map itself unchanged — 「幫我留C就好」): the heart-failure page's
 * guideline calculators listed by chapter, each opened beside its point, and a
 * prognosis result attached to the plan as a note that changes no
 * recommendation (「預後只當附註就好」).
 */
import { useMemo } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import { usePhysicianDecisions, usePhysicianDecisionsStore } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { useVisitAnswerRecord, useVisitAnswersStore, visitAnswersOf } from '@/features/clinical-decision-support/stores/visit-answers.store'
import { useVisitCalculatorNotesStore } from '@/features/clinical-decision-support/stores/visit-calculator-notes.store'
import { HF_VISIT_CALCULATORS, calculatorNoteText } from '@/features/clinical-decision-support/renderers/visit/VisitCalculators'
import { VisitBookChromeContext } from '@/features/clinical-decision-support/renderers/visit/visit-book-chrome'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { CalcResult } from '@/features/medical-calculator/types'
import type { VisitDecisionModel } from '@/features/clinical-decision-support/types'
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

function Page({ id, page, patch }: { id: ScenarioId; page: 'hf' | 'af'; patch?: (model: VisitDecisionModel) => VisitDecisionModel }) {
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
        visitModel={patch ? patch(run.model) : run.model}
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

  // Owner decision 2026-10-21: the DOAC dose calculator (label rules the AF
  // CDSS does not hold) opens from the AF page's dose point, so the AF page
  // has the same button — with AF's calculators only.
  // The peri-procedural calculator sits beside it at the same point.
  it('on the AF page lists AF’s calculators only, the two DOAC calculators beside DP-09 (P9)', () => {
    render(<Page id="p9-hfpef-af-dose" page="af" />)
    expect(screen.getByTestId('cdss-book-calculators')).toHaveAccessibleName('計算機，5 個可用')
    openList()
    expect(screen.getByTestId('cdss-book-calculator-doac-dose')).toHaveTextContent('→ DP-09')
    expect(screen.getByTestId('cdss-book-calculator-doac-periop')).toHaveTextContent('→ DP-09')
    expect(screen.getByTestId('cdss-book-calculator-doac-dose')).toHaveTextContent('DOAC 劑量計算機 · NVAF／VTE 依仿單')
    // The VTE-only questions are not counted to fill on the NVAF dose point:
    // the NVAF calculator's 22 here, plus the indication to confirm, less
    // pregnancy, which the patient's sex now answers.
    expect(screen.getByTestId('cdss-book-calculator-doac-dose')).toHaveTextContent('待填 22')
    expect(screen.getByTestId('cdss-book-calculator-doac-periop')).toHaveTextContent('DOAC 手術前後停藥計算機')
    expect(screen.getByTestId('cdss-book-calculator-cha2ds2-va')).toHaveTextContent('→ DP-14')
    expect(screen.queryByTestId('cdss-book-calculator-maggic')).toBeNull()
    expect(screen.queryByTestId('cdss-book-calculator-hfa-peff')).toBeNull()
  })

  it('keeps the HF page’s list as it was: AF’s dose point is not on it', () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    openList()
    expect(screen.queryByTestId('cdss-book-calculator-doac-dose')).toBeNull()
    expect(screen.queryByTestId('cdss-book-calculator-doac-periop')).toBeNull()
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

describe('決策地圖 v2 · a calculator named in a line of the page', () => {
  it('underlines the name and opens that calculator, without moving the page (P9)', () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    const dp14 = document.querySelector<HTMLElement>('[data-book-dp="DP-14"]')!
    fireEvent.click(within(dp14).getByRole('button', { name: /看依據/ }))
    const links = [...document.querySelectorAll<HTMLButtonElement>('[data-calculator-link]')]
    // Each calculator once a line: 「CrCl <30 或 Cr >2.5」 and 「HF＋AF 用 CHA2DS2-VA」.
    expect(links.map((link) => link.dataset.calculatorLink)).toEqual(expect.arrayContaining(['crcl', 'cha2ds2-va']))
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()
    const link = links.find((item) => item.dataset.calculatorLink === 'cha2ds2-va')!
    expect(link).toHaveAccessibleName(`${link.textContent}，開啟計算機`)
    fireEvent.click(link)
    const panel = screen.getByTestId('cdss-book-calculator-panel')
    expect(within(panel).getByTestId('calculator-detail-cha2ds2-va')).toBeInTheDocument()
    expect(within(panel).getByText(/AF DP-14/)).toBeInTheDocument()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('links the DOAC dose calculator where an AF line names it', () => {
    const pattern = HF_VISIT_CALCULATORS.find((entry) => entry.id === 'doac-dose')!.names
    expect(pattern.test('劑量請用 DOAC 劑量計算機核對。')).toBe(true)
    expect(pattern.test('Check the dose with the DOAC dose calculator.')).toBe(true)
  })

  it('names the 2024 CHA₂DS₂-VA, not the older CHA₂DS₂-VASc', () => {
    const pattern = HF_VISIT_CALCULATORS.find((entry) => entry.id === 'cha2ds2-va')!.names
    expect(pattern.test('CHA₂DS₂-VA ≥2')).toBe(true)
    expect(pattern.test('CHA₂DS₂-VASc ≥2')).toBe(false)
  })
})

describe('決策地圖 v2 · focus after the calculator closes (#334 review)', () => {
  it('goes back to the link in the line that opened it', async () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    const dp14 = document.querySelector<HTMLElement>('[data-book-dp="DP-14"]')!
    fireEvent.click(within(dp14).getByRole('button', { name: /看依據/ }))
    const link = document.querySelector<HTMLButtonElement>('[data-calculator-link="cha2ds2-va"]')!
    link.focus()
    fireEvent.click(link)
    fireEvent.keyDown(screen.getByTestId('cdss-book-calculator-panel'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('cdss-book-calculator-panel')).toBeNull())
    await waitFor(() => expect(link).toHaveFocus())
  })

  it('goes back to 計算機 when it was opened from the list', async () => {
    render(<Page id="p9-hfpef-af-dose" page="hf" />)
    openList()
    fireEvent.click(screen.getByTestId('cdss-book-calculator-maggic'))
    fireEvent.click(within(screen.getByTestId('cdss-book-calculator-panel')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('cdss-book-calculator-panel')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('cdss-book-calculators')).toHaveFocus())
  })
})

describe('calculatorNoteText', () => {
  it('writes the result and its first two rows, and says when inputs are empty', () => {
    expect(calculatorNoteText('MAGGIC', MAGGIC_RESULT, 'zh-TW')).toBe('MAGGIC 24 分・1 年全因死亡率 15.3%・3 年全因死亡率 36.6%')
    expect(calculatorNoteText('MAGGIC', { ...MAGGIC_RESULT, completeness: { complete: false, upperBound: 30, missingKeys: ['smoking'] } }, 'en'))
      .toBe('MAGGIC 24 分 · 1-year all-cause mortality 15.3% · 3-year all-cause mortality 36.6% (some inputs empty)')
  })

  // The real formulas, not a hand-made result (#334 review).
  const compute = (id: string, values: Record<string, string>) => CALCULATORS.find((calc) => calc.id === id)!.compute(values)!
  const LIFE_INPUTS = {
    sex: 'female', lvef: '55', priorReducedLvef: 'no', diabetes: 'no', smoker: 'no', hfHospitalization: 'never',
    copd: 'no', af: 'no', nyha: 'low', ihd: 'no', ntprobnp: '600', bmi: '25', heartRate: '70', hemoglobin: '13', egfr: '60',
  }

  it('keeps LIFE-Preserved\'s event and period with its headline', () => {
    const result = compute('life-preserved', { ...LIFE_INPUTS, age: '72' })
    const text = calculatorNoteText('LIFE-Preserved', result, 'zh-TW')
    expect(text).toMatch(new RegExp(`^LIFE-Preserved ${result.value.replace('.', '\\.')}（2 年風險：心衰住院或心血管死亡）・10 年風險 `))
  })

  it('at 89, names the risk through age 90 and drops the periods with no value', () => {
    const result = compute('life-preserved', { ...LIFE_INPUTS, age: '89' })
    const text = calculatorNoteText('LIFE-Preserved', result, 'zh-TW')
    expect(text.startsWith(`LIFE-Preserved ${result.value}（至 90 歲風險：心衰住院或心血管死亡）`)).toBe(true)
    expect(text).not.toContain('—')
    expect(text).not.toContain('2 年風險')
    expect(text).not.toContain('10 年風險')
  })

  it('keeps MAGGIC\'s 1- and 3-year mortality from the real formula', () => {
    const result = compute('maggic-hf', {
      age: '72', sex: 'female', lvef: '35', nyha: '2', creatinine: '1.4', diabetes: 'yes', betaBlocker: 'yes', sbp: '118',
      bmi: '24', hfDuration: 'yes', smoker: 'no', copd: 'no', aceiArb: 'yes',
    })
    expect(calculatorNoteText('MAGGIC', result, 'zh-TW')).toMatch(/^MAGGIC \d+ pts（估計全因死亡率）・1 年全因死亡率 [\d.]+%・3 年全因死亡率 [\d.]+%$/)
  })
})

describe('LIFE-Preserved is offered on a known LVEF of 50% or above only', () => {
  const offered = (lvef?: string) => {
    const keyValues = (model: VisitDecisionModel) => [
      ...model.keyValues.filter((item) => item.key !== 'LVEF'),
      ...(lvef ? [{ ...model.keyValues.find((item) => item.key === 'LVEF')!, value: lvef }] : []),
    ]
    render(<Page id="p9-hfpef-af-dose" page="hf" patch={(model) => ({ ...model, keyValues: keyValues(model) })} />)
    openList()
    return screen.queryByTestId('cdss-book-calculator-life-preserved') !== null
  }

  it.each([[undefined, false], ['49%', false], ['50%', true]] as const)('LVEF %s → %s', (lvef, shown) => {
    expect(offered(lvef)).toBe(shown)
  })
})
