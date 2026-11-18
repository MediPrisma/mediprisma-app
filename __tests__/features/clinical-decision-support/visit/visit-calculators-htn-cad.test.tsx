/**
 * 計算機 on the hypertension and coronary pages (owner request 2026-11-19):
 * the same entry as HF and AF, each page with its own calculators, and the
 * AF ones on the coronary page only where it holds OAC with an antiplatelet.
 * PREVENT-ASCVD stays off the hypertension page (owner decision 2026-11-19).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  CAD_VISIT_CALCULATORS,
  HTN_VISIT_CALCULATORS,
  VisitCalculatorsButton,
  VisitCalculatorsProvider,
  pageHasCalculators,
} from '@/features/clinical-decision-support/renderers/visit/VisitCalculators'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { DecisionPointView } from '@/features/clinical-decision-support/types'

jest.mock('@/features/medical-calculator/hooks/use-lab-autofill.hook', () => {
  const actual = jest.requireActual('@/features/medical-calculator/hooks/use-lab-autofill.hook')
  const autofill = actual.buildAutofill([], { age: 68, gender: 'male' })
  return { ...actual, useLabAutofill: () => ({ autofill, isLoading: false, error: null, retry: jest.fn() }) }
})

jest.mock('@/features/medical-calculator/components/CalculatorDetail', () => ({
  CalculatorDetail: ({ calc }: { calc: { id: string } }) => <div data-testid={`calculator-detail-${calc.id}`} />,
}))

/** A point on the page; any state but 不適用／尚未納入 counts as present. */
function point(source: string, dp: string, state: string = 'needs-review'): DecisionPointView {
  return { dp, source, state, label: dp } as unknown as DecisionPointView
}

function Page({ source, points }: { source: string; points: DecisionPointView[] }) {
  return (
    <VisitCalculatorsProvider isEnglish={false} points={points} sourceOfPage={source} attached={new Set()}>
      <VisitCalculatorsButton chapterOf={() => '章'} goTo={() => {}} />
    </VisitCalculatorsProvider>
  )
}

function listedIds(): string[] {
  fireEvent.click(screen.getByTestId('cdss-book-calculators'))
  const list = screen.getByTestId('cdss-book-calculator-list')
  return within(list).getAllByRole('button').map((button) => button.getAttribute('data-testid')?.replace('cdss-book-calculator-', '') ?? '')
}

describe('計算機 on the HTN and CAD pages', () => {
  it('names only calculators the medical calculator has', () => {
    for (const entry of [...HTN_VISIT_CALCULATORS, ...CAD_VISIT_CALCULATORS].filter((item) => item.calculatorId)) {
      expect(CALCULATORS.some((calc) => calc.id === entry.calculatorId)).toBe(true)
    }
  })

  it('mounts on the four pages with a list, not on others', () => {
    expect(['hf', 'af', 'htn', 'cad'].map(pageHasCalculators)).toEqual([true, true, true, true])
    expect(pageHasCalculators('lipid')).toBe(false)
    expect(pageHasCalculators(undefined)).toBe(false)
  })

  it('lists the hypertension calculators by chapter, the DP-08 risk panels among them', () => {
    render(<Page source="htn" points={[point('htn', 'DP-04'), point('htn', 'DP-07'), point('htn', 'DP-08'), point('htn', 'DP-18')]} />)
    expect(listedIds()).toEqual(['egfr', 'stop-bang', 'risk-inputs', 'prevent-ascvd', 'pce-ascvd', 'hpa-mace', 'ckd-kdigo-risk'])
    // A title where the entry has one; otherwise the calculator's full name, not its last parenthesis.
    expect(screen.getByTestId('cdss-book-calculator-hpa-mace')).toHaveTextContent('國健署心血管風險預測公式')
    expect(screen.getByTestId('cdss-book-calculator-egfr')).toHaveTextContent('eGFR (CKD-EPI 2021)')
  })

  it('drops the points the hypertension page does not have', () => {
    render(<Page source="htn" points={[point('htn', 'DP-04'), point('htn', 'DP-18', 'not-applicable')]} />)
    expect(listedIds()).toEqual(['egfr'])
  })

  it('offers the AF calculators on the coronary page only with OAC and an antiplatelet', () => {
    const { unmount } = render(<Page source="cad" points={[point('cad', 'DP-10'), point('cad', 'DP-16', 'not-applicable')]} />)
    expect(listedIds()).toEqual(['egfr'])
    unmount()
    render(<Page source="cad" points={[point('cad', 'DP-10'), point('cad', 'DP-16'), point('cad', 'DP-27')]} />)
    expect(listedIds()).toEqual(['egfr', 'cha2ds2-va', 'has-bled', 'crcl', 'doac-dose', 'bmi'])
  })

  it('opens the chosen calculator beside the page', () => {
    render(<Page source="htn" points={[point('htn', 'DP-04')]} />)
    fireEvent.click(screen.getByTestId('cdss-book-calculators'))
    fireEvent.click(screen.getByTestId('cdss-book-calculator-egfr'))
    expect(screen.getByTestId('calculator-detail-egfr-ckd-epi-2021')).toBeInTheDocument()
  })

  it('keeps the HF page from listing the HTN or CAD calculators', () => {
    render(<Page source="hf" points={[point('hf', 'DP-34'), point('htn', 'DP-04'), point('cad', 'DP-10')]} />)
    const ids = listedIds()
    expect(ids).not.toContain('egfr')
    expect(ids).toContain('hfa-peff')
  })
})
