/**
 * HF DP-01's table on the decision map shows the host's HFA-PEFF reading
 * under 本病人, says when LAVI/LVMI were derived from body size, and its name
 * opens the calculator (owner decision 2026-11-22).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import type { HfpefReading, HfpefScoreReading } from '@/features/clinical-decision-support/utils/hfpef-scores'
import { scenarioRun, type ScenarioId } from './scenario-models'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ diagnosticReports: [] }),
}))

// The calculator itself is the medical calculator's own; here only which one opened.
jest.mock('@/features/medical-calculator/components/CalculatorDetail', () => ({
  CalculatorDetail: ({ calc }: { calc: { id: string } }) => <div data-testid={`calculator-detail-${calc.id}`} />,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webStreams = require('node:stream/web')
for (const name of ['TransformStream', 'ReadableStream', 'WritableStream'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = webStreams[name]
  }
}

const score = (patch: Partial<HfpefScoreReading> = {}): HfpefScoreReading => ({
  id: 'hfa-peff',
  name: 'HFA-PEFF',
  score: 5,
  upper: 5,
  maximum: 6,
  bandZh: '支持 HFpEF',
  bandEn: 'Supports HFpEF',
  components: [],
  missing: [],
  missingZh: [],
  missingEn: [],
  date: '2025-07-14',
  matchedTerms: [],
  ...patch,
})

function renderMap(id: ScenarioId, reading: HfpefReading | undefined, locale: 'zh-TW' | 'en' = 'zh-TW') {
  const run = scenarioRun(id, { page: 'hf' })
  render(
    <ClinicalDecisionSupportView
      result={run.result}
      locale={locale}
      layout="map"
      patientId="hfa-peff-map"
      visitModel={run.model}
      companionResults={run.companion ? [run.companion] : undefined}
      profileFacts={run.profile.facts}
      hfpefReading={reading}
    />,
  )
}

const dp01 = () => document.querySelector<HTMLElement>('[data-book-dp="DP-01"]')!

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})

describe('HFA-PEFF on the decision map (HF DP-01)', () => {
  it('shows the score, its band and day, and which indices were derived from BSA', () => {
    renderMap('p9-hfpef-af-dose', { inputs: [], hfaPeff: score({ derived: { bsa: '1.81 m²', lavi: '44.2 mL/m²', lvmi: '152.7 g/m²' } }) })
    const line = within(dp01()).getByTestId('cdss-book-hfa-peff')
    expect(line).toHaveTextContent('HFA-PEFF5／6（支持 HFpEF）（2025-07-14）')
    expect(within(line).getByTestId('cdss-book-hfa-peff-derived'))
      .toHaveTextContent('LAVI 44.2 mL/m²、LVMI 152.7 g/m² 由 LA 容積、LV 質量÷BSA（1.81 m²）推算')
    expect(within(line).queryByTestId('cdss-book-hfa-peff-missing')).toBeNull()
    // Its name is the way into the calculator, as the 計算機 list's.
    fireEvent.click(within(line).getByRole('button', { name: /HFA-PEFF，開啟計算機/ }))
    expect(within(screen.getByTestId('cdss-book-calculator-panel')).getByTestId('calculator-detail-hfa-peff')).toBeInTheDocument()
  })

  it('names only the index derived, and the report\'s missing items, with no note when both are stated', () => {
    renderMap('p9-hfpef-af-dose', { inputs: [], hfaPeff: score({ score: 3, upper: 4, bandZh: '未定 — 需功能性檢查', missing: ['ee'], missingZh: ['E/e′'], missingEn: ['E/e′'], derived: { bsa: '1.81 m²', lavi: '44.2 mL/m²' } }) })
    const line = within(dp01()).getByTestId('cdss-book-hfa-peff')
    expect(line).toHaveTextContent('HFA-PEFF3–4／6（未定 — 需功能性檢查）')
    expect(within(line).getByTestId('cdss-book-hfa-peff-missing')).toHaveTextContent('報告未提供：E/e′（最多再 +1）')
    expect(within(line).getByTestId('cdss-book-hfa-peff-derived')).toHaveTextContent('LAVI 44.2 mL/m² 由 LA 容積÷BSA（1.81 m²）推算')
    expect(line).not.toHaveTextContent('LVMI')
  })

  it('names a missing item without a headroom it cannot add', () => {
    renderMap('p9-hfpef-af-dose', { inputs: [], hfaPeff: score({ missing: ['gls'], missingZh: ['GLS'], missingEn: ['GLS'] }) })
    const missing = within(within(dp01()).getByTestId('cdss-book-hfa-peff')).getByTestId('cdss-book-hfa-peff-missing')
    expect(missing).toHaveTextContent('報告未提供：GLS')
    expect(missing).not.toHaveTextContent('最多再')
  })

  it('has no derived note when the report stated LAVI and LVMI', () => {
    renderMap('p9-hfpef-af-dose', { inputs: [], hfaPeff: score() })
    const line = within(dp01()).getByTestId('cdss-book-hfa-peff')
    expect(line).toHaveTextContent('HFA-PEFF5／6')
    expect(within(line).queryByTestId('cdss-book-hfa-peff-derived')).toBeNull()
  })

  it('writes the line in English on the English page', () => {
    renderMap('p9-hfpef-af-dose', { inputs: [], hfaPeff: score({ derived: { bsa: '1.81 m²', lvmi: '152.7 g/m²' } }) }, 'en')
    const line = within(dp01()).getByTestId('cdss-book-hfa-peff')
    expect(line).toHaveTextContent('HFA-PEFF5/6 (Supports HFpEF) (2025-07-14)')
    expect(line).toHaveTextContent('LVMI 152.7 g/m² derived from LV mass ÷ BSA (1.81 m²)')
  })

  it('is absent when the calculator has no reading', () => {
    renderMap('p9-hfpef-af-dose', { inputs: [] })
    expect(within(dp01()).getByTestId('cdss-book-classification')).toBeInTheDocument()
    expect(screen.queryByTestId('cdss-book-hfa-peff')).toBeNull()
  })

  it('is absent on a reduced ejection fraction', () => {
    renderMap('p2-new-hfref', { inputs: [], hfaPeff: score() })
    expect(within(dp01()).getByTestId('cdss-book-classification')).toBeInTheDocument()
    expect(screen.queryByTestId('cdss-book-hfa-peff')).toBeNull()
  })
})
