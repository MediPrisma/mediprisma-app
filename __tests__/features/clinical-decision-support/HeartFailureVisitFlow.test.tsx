/**
 * The visit flow, rendered, wired to the real stores.
 *
 * What it holds is the promise the restructure was for: one question is asked
 * in one place, answering it moves the count, a recommendation can be decided
 * on the row it appears on, and switching to the original board and back does
 * not lose anything the clinician said.
 */
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ClinicalDecisionSupportView } from '@/features/clinical-decision-support/renderers/ClinicalDecisionSupportView'
import {
  useClinicVitals,
  useClinicVitalsStore,
} from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import {
  usePhenotypeAnswer,
  usePhenotypeAnswerStore,
} from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import {
  usePhysicianDecisions,
  usePhysicianDecisionsStore,
} from '@/features/clinical-decision-support/stores/physician-decisions.store'
import type { CdssLayout } from '@/features/clinical-decision-support/stores/layout-preference.store'
import type {
  CdssRecommendation,
  CdssResult,
  ClinicalEvidence,
} from '@/features/clinical-decision-support/types'
import { decisionReasonIds } from '@/features/clinical-decision-support/renderers/heart-failure-visit-flow'

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({ diagnosticReports: [] }),
}))

const PATIENT = 'flow-patient'

function evidence(label: string, value: string, factKey: string, date?: string): ClinicalEvidence {
  return {
    label,
    value,
    factKeys: [factKey],
    ...(date
      ? { sources: [{ resourceType: 'Observation', resourceId: `${factKey}-${date}`, date }] }
      : {}),
  }
}

function recommendation(
  id: string,
  input: Partial<CdssRecommendation> & { physicianInputRequests?: unknown } = {},
): CdssRecommendation {
  return {
    id,
    moduleName: `模組 ${id}`,
    moduleGroup: 'treatment',
    domain: 'medication',
    priority: 'medium',
    status: 'review',
    title: `判斷 ${id}`,
    recommendation: `建議 ${id}`,
    rationale: `理由 ${id}`,
    patientEvidence: [],
    nextActions: [`下一步 ${id}`],
    guidelineReferences: [],
    safetyBoundary: `邊界 ${id}`,
    ...input,
  } as CdssRecommendation
}

function heartFailureResult(): CdssResult {
  return {
    title: '心衰竭個人化照護指引',
    summary: '',
    packId: 'heart-failure-cdss',
    packVersion: '1.13.0',
    recommendations: [
      recommendation('heart-failure-phenotype', {
        moduleGroup: 'assessment',
        domain: 'diagnosis',
        status: 'no-action',
        priority: 'routine',
        title: '進入 HFrEF（LVEF <50%） 路徑',
        overviewEvidenceFactKey: 'LVEF',
        patientEvidence: [evidence('LVEF', '32%', 'LVEF', '2026-07-14')],
        physicianInputRequests: [{
          kind: 'hf-suspicion',
          label: '您懷疑這位病人有心衰竭嗎？',
          options: [
            { id: 'suspected', label: '是，懷疑心衰竭' },
            { id: 'not-suspected', label: '否，本次不懷疑' },
          ],
        }],
      }),
      recommendation('heart-failure-mra', {
        status: 'actionable',
        title: 'HFrEF 適用 MRA，目前無處方',
        overviewEvidenceFactKey: 'mraTherapy',
        patientEvidence: [evidence('MRA', '目前未使用', 'mraTherapy')],
        nextActions: ['起始 MRA（spironolactone 12.5–25 mg）'],
      }),
      recommendation('heart-failure-congestion-diuretic', {
        status: 'needs-data',
        title: '鬱血證據表沒有任何已開啟的項目',
        nextActions: ['在本次評估回答鬱血徵象後再決定利尿策略。'],
        evidenceTables: [{
          concept: 'congestion',
          items: [
            {
              id: 'congestion:pitting-edema',
              label: { zh: '下肢水腫', en: 'Pitting oedema' },
              category: 'examination',
              derivability: 'physician-entered',
              direction: 'unknown',
              defaultEnabled: false,
            },
            {
              id: 'congestion:exertional-dyspnea',
              label: { zh: '勞力性呼吸困難', en: 'Exertional dyspnoea' },
              category: 'examination',
              derivability: 'physician-entered',
              direction: 'unknown',
              defaultEnabled: false,
            },
            {
              id: 'congestion:nyha',
              label: { zh: 'NYHA 分級', en: 'NYHA class' },
              category: 'examination',
              derivability: 'physician-entered',
              direction: 'unknown',
              defaultEnabled: false,
            },
          ],
          supportsCount: 0,
          againstCount: 0,
          unknownCount: 3,
          limitations: [],
          evidenceReferences: [],
        }],
      }),
    ],
    notEvaluated: [],
    disclaimer: '本工具不取代臨床判斷。',
  }
}

/**
 * The HFpEF card, with criterion (i) in the state the test is about.
 */
function withHfpEfConfirmation(symptomsState: 'met' | 'undetermined'): CdssResult {
  const base = heartFailureResult()
  return {
    ...base,
    recommendations: [
      ...base.recommendations,
      recommendation('heart-failure-hfpef-diagnosis', {
        moduleGroup: 'assessment',
        domain: 'diagnosis',
        status: 'review',
        title: 'HFpEF 診斷（ESC 2026 §5.2.2）',
        physicianInputRequests: [{
          kind: 'hfpef-diagnosis-confirmation',
          label: '確認 HFpEF 診斷？',
        }],
        diagnosticSummary: {
          verdict: '三個條件皆成立，待醫師確認',
          basis: 'ESC 2026 §5.2.2（PDF p.25）Table 10',
          criteria: [
            {
              id: 'symptoms-signs',
              label: '症狀／徵象',
              state: symptomsState,
              detail: symptomsState === 'met' ? '支持 1 項、反對 0 項' : '第 2、3 題未答',
            },
            { id: 'lvef', label: 'LVEF ≥50% 且未曾 <50%', state: 'met', detail: 'LVEF 58%' },
            { id: 'objective-abnormality', label: '客觀結構／功能異常', state: 'met', detail: 'Table 10 支持 5 項' },
          ],
        },
      } as Partial<CdssRecommendation>),
    ],
  }
}

/**
 * The host around the view: the real stores, and a switch between the two
 * faces, so what a clinician answers in one is what the other reads.
 */
function Harness({ result = heartFailureResult() }: { result?: CdssResult } = {}) {
  const [layout, setLayout] = useState<CdssLayout>('flow')
  const clinicVitals = useClinicVitals(PATIENT)
  const setVitals = useClinicVitalsStore((state) => state.setVitals)
  const clearVitals = useClinicVitalsStore((state) => state.clearVitals)
  const phenotypeAnswer = usePhenotypeAnswer(PATIENT)
  const setPhenotypeAnswer = usePhenotypeAnswerStore((state) => state.setAnswer)
  const decisions = usePhysicianDecisions(PATIENT)
  const recordDecision = usePhysicianDecisionsStore((state) => state.recordDecision)
  const clearDecision = usePhysicianDecisionsStore((state) => state.clearDecision)
  return (
    <div>
      <button type="button" data-testid="switch-layout" onClick={() => setLayout(layout === 'flow' ? 'board' : 'flow')}>
        {layout}
      </button>
      <ClinicalDecisionSupportView
        result={result}
        locale="zh-TW"
        layout={layout}
        patientId={PATIENT}
        clinicVitals={clinicVitals}
        onSaveClinicVitals={(patch) => setVitals(PATIENT, patch)}
        onClearClinicVitals={() => clearVitals(PATIENT)}
        phenotypeAnswer={phenotypeAnswer}
        onAnswerPhenotype={(answer) => setPhenotypeAnswer(PATIENT, answer)}
        physicianDecisions={decisions}
        onRecordDecision={(moduleId, input) => recordDecision(PATIENT, moduleId, input)}
        onClearDecision={(moduleId) => clearDecision(PATIENT, moduleId)}
      />
    </div>
  )
}

function suspectHeartFailure() {
  fireEvent.click(screen.getByTestId('cdss-hf-suspicion-option-suspected'))
}

describe('the visit flow', () => {
  beforeEach(() => {
    // jsdom has no layout, so the jump-to-question scroll is a no-op here.
    Element.prototype.scrollIntoView = jest.fn()
    localStorage.clear()
    useClinicVitalsStore.setState({ byPatientId: {} })
    usePhenotypeAnswerStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
    usePhysicianDecisionsStore.setState({ byPatientId: {} })
  })

  it('asks about congestion in one place and nowhere else', () => {
    render(<Harness />)
    suspectHeartFailure()

    for (const label of [
      '勞力性呼吸困難（exertional dyspnea）',
      '端坐呼吸（orthopnea）',
      '夜間陣發性呼吸困難（paroxysmal nocturnal dyspnea，PND）',
      '疲倦／運動耐受下降（fatigue／exercise intolerance）',
      '腳腫（ankle swelling，自述）',
    ]) expect(screen.getByText(label)).toBeVisible()

    fireEvent.click(screen.getByTestId('cdss-hf-sign-more-symptoms'))
    for (const label of [
      '腹脹／吃一點就飽（abdominal bloating／early satiety）',
      '夜咳／喘鳴（nocturnal cough／wheeze）',
      '彎腰呼吸困難（bendopnea）',
    ]) expect(screen.getByText(label)).toBeVisible()
    // Weight gain is a sign in ESC 2026 Table 7, and 體重比上次 is asked at every visit.
    expect(screen.queryByText('近期體重增加（recent weight gain，自述）')).toBeNull()

    // One control for 凹陷性水腫 on the whole screen: no board chip strip, and
    // no DP-00 tick-list repeating the same examination.
    expect(screen.getAllByTestId('cdss-hf-flow-sign-pitting-edema')).toHaveLength(1)
    expect(screen.queryByTestId('cdss-hf-congestion-signs')).toBeNull()
    expect(screen.queryByTestId('cdss-hf-symptom-edema')).toBeNull()
    expect(screen.queryByTestId('cdss-hf-compensation-control')).toBeNull()
    expect(screen.getByText('肺部濕囉音（rales）')).toBeVisible()
    expect(screen.getByText('凹陷性水腫（pitting edema）')).toBeVisible()
    fireEvent.click(screen.getByTestId('cdss-hf-sign-more-signs'))
    for (const label of ['第三心音（S3）', '肝頸反流（HJR）', '腹水（ascites）']) expect(screen.getByText(label)).toBeVisible()
    // Hepatomegaly is not asked (a less specific sign in ESC 2026 Table 7).
    expect(screen.queryByText('肝腫大（hepatomegaly）')).toBeNull()
  })

  it('omits the duplicate congestion evidence table from the visit-flow detail', () => {
    render(<Harness />)
    suspectHeartFailure()
    fireEvent.click(screen.getByTestId('cdss-hf-flow-sign-pitting-edema-absent'))
    fireEvent.click(screen.getByTestId('cdss-hf-action-expand-heart-failure-congestion-diuretic'))

    expect(screen.queryByTestId('cdss-evidence-table-heart-failure-congestion-diuretic-congestion')).toBeNull()
    expect(screen.queryByTestId('cdss-evidence-readonly-congestion:pitting-edema')).toBeNull()
    expect(screen.queryByTestId('cdss-evidence-answer-congestion:pitting-edema')).toBeNull()
    expect(screen.getByTestId('cdss-hf-flow-sign-pitting-edema-absent')).toHaveAttribute('aria-pressed', 'true')
  })

  it('answers every symptom or sign as 無 with one press, folded rows included', () => {
    render(<Harness />)
    suspectHeartFailure()
    const remaining = () => screen.getByTestId('cdss-hf-questions-remaining').textContent
    expect(remaining()).toBe('還有 4 題')

    const signsNone = screen.getByTestId('cdss-hf-sign-none-signs')
    expect(signsNone).toHaveTextContent('全部皆無')
    // The rows folded under 「更多」 are named on the button before it writes them.
    expect(signsNone).toHaveTextContent('含收起 3 項')
    fireEvent.click(signsNone)
    for (const term of ['rales', 'jvp', 'pitting-edema']) {
      expect(screen.getByTestId(`cdss-hf-flow-sign-${term}-absent`)).toHaveAttribute('aria-pressed', 'true')
    }
    // The folded rows open by themselves, already reading 無.
    expect(screen.getByTestId('cdss-hf-sign-more-signs')).toHaveAttribute('aria-expanded', 'true')
    for (const term of ['third-heart-sound', 'hepatojugular-reflux', 'ascites']) {
      expect(screen.getByTestId(`cdss-hf-flow-sign-${term}-absent`)).toHaveAttribute('aria-pressed', 'true')
    }
    expect(remaining()).toBe('還有 3 題')
    // Every row it covers reads 無: the button shows pressed and says how to undo.
    expect(screen.getByTestId('cdss-hf-sign-none-signs')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cdss-hf-sign-none-signs')).toHaveTextContent('再按一次復原')
  })

  it('restores the rows as they were when 全部皆無 is pressed again', () => {
    render(<Harness />)
    suspectHeartFailure()
    const remaining = () => screen.getByTestId('cdss-hf-questions-remaining').textContent
    fireEvent.click(screen.getByTestId('cdss-hf-flow-sign-rales-not-assessed'))
    fireEvent.click(screen.getByTestId('cdss-hf-sign-none-signs'))
    expect(screen.getByTestId('cdss-hf-flow-sign-rales-absent')).toHaveAttribute('aria-pressed', 'true')
    expect(remaining()).toBe('還有 3 題')

    fireEvent.click(screen.getByTestId('cdss-hf-sign-none-signs'))
    // rales was 未評估 before the press and is again; the others were unanswered.
    expect(screen.getByTestId('cdss-hf-flow-sign-rales-not-assessed')).toHaveAttribute('aria-pressed', 'true')
    for (const term of ['jvp', 'pitting-edema']) {
      expect(screen.getByTestId(`cdss-hf-flow-sign-${term}-absent`)).toHaveAttribute('aria-pressed', 'false')
    }
    expect(remaining()).toBe('還有 4 題')
    expect(screen.getByTestId('cdss-hf-sign-none-signs')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('cdss-hf-sign-none-signs')).toHaveTextContent('全部皆無')
  })

  it('keeps a row changed after 全部皆無 when the press is undone', () => {
    render(<Harness />)
    suspectHeartFailure()
    fireEvent.click(screen.getByTestId('cdss-hf-sign-none-symptoms'))
    // The patient then mentions orthopnoea: that row is now 有.
    fireEvent.click(screen.getByTestId('cdss-hf-flow-sign-orthopnea-present'))
    const button = screen.getByTestId('cdss-hf-sign-none-symptoms')
    expect(button).toHaveTextContent('其餘皆無')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button)
    expect(screen.getByTestId('cdss-hf-flow-sign-orthopnea-present')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cdss-hf-flow-sign-exertional-dyspnea-absent')).toHaveAttribute('aria-pressed', 'false')
  })

  it('reads 其餘皆無 once a finding is 有, and leaves that finding alone', () => {
    render(<Harness />)
    suspectHeartFailure()
    fireEvent.click(screen.getByTestId('cdss-hf-flow-sign-orthopnea-present'))
    const symptomsNone = screen.getByTestId('cdss-hf-sign-none-symptoms')
    expect(symptomsNone).toHaveTextContent('其餘皆無')
    fireEvent.click(symptomsNone)
    expect(screen.getByTestId('cdss-hf-flow-sign-orthopnea-present')).toHaveAttribute('aria-pressed', 'true')
    for (const term of ['exertional-dyspnea', 'paroxysmal-nocturnal-dyspnea', 'fatigue-exercise-intolerance', 'reported-ankle-swelling', 'abdominal-bloating']) {
      expect(screen.getByTestId(`cdss-hf-flow-sign-${term}-absent`)).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('counts down 還有 n 題 as the questions are answered', () => {
    render(<Harness />)
    const remaining = () => screen.getByTestId('cdss-hf-questions-remaining').textContent

    expect(remaining()).toBe('還有 1 題')
    suspectHeartFailure()
    expect(remaining()).toBe('還有 4 題')

    fireEvent.click(screen.getByTestId('cdss-hf-flow-nyha-II'))
    expect(remaining()).toBe('還有 3 題')

    // Question ④ is answered once every 常見 sign has been answered; the
    // 更多 rows stay optional.
    for (const term of ['rales', 'jvp', 'pitting-edema']) {
      fireEvent.click(screen.getByTestId(`cdss-hf-flow-sign-${term}-absent`))
    }
    expect(remaining()).toBe('還有 2 題')

    for (const term of [
      'exertional-dyspnea',
      'orthopnea',
      'paroxysmal-nocturnal-dyspnea',
      'fatigue-exercise-intolerance',
      'reported-ankle-swelling',
    ]) {
      fireEvent.click(screen.getByTestId(`cdss-hf-flow-sign-${term}-not-assessed`))
    }
    expect(remaining()).toBe('還有 1 題')

    fireEvent.click(screen.getByTestId('cdss-hf-flow-compensation-compensated'))
    expect(remaining()).toBe('本次評估完成')
  })

  it('records a decision on the row, with its date and a way to change it', () => {
    render(<Harness />)
    suspectHeartFailure()

    expect(screen.getByTestId('cdss-hf-action-category-heart-failure-mra')).toHaveTextContent('MRA')
    const mraRow = screen.getByTestId('cdss-hf-action-row-heart-failure-mra')
    const mraStatus = within(mraRow).getByText('可立即處理')
    const mraCategory = screen.getByTestId('cdss-hf-action-category-heart-failure-mra')
    expect(mraStatus.compareDocumentPosition(mraCategory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mraCategory).toHaveClass('bg-violet-100', 'text-violet-800')
    expect(screen.getByTestId('cdss-hf-action-headline-heart-failure-mra')).toHaveTextContent('評估啟用。')
    expect(screen.getByTestId('cdss-hf-action-row-heart-failure-mra')).not.toHaveTextContent('medication reconciliation')
    expect(screen.getByTestId('cdss-hf-action-row-heart-failure-mra')).not.toHaveTextContent('模組 heart-failure-mra')
    expect(screen.getByTestId('cdss-hf-action-category-heart-failure-congestion-diuretic')).toHaveTextContent('Loop 利尿劑')
    expect(screen.getByTestId('cdss-hf-action-headline-heart-failure-congestion-diuretic'))
      .toHaveTextContent('有鬱血症狀或徵象時，依容量狀態調整。')
    expect(screen.queryByText('建議與你的決定')).not.toBeInTheDocument()
    expect(screen.queryByText(/排序＝規則的優先順序/)).not.toBeInTheDocument()
    expect(screen.getByTestId('cdss-hf-actions-decided')).toHaveTextContent('已決定 0 / 2')
    fireEvent.click(screen.getByTestId('cdss-hf-decision-heart-failure-mra-prescribed'))

    const recorded = screen.getByTestId('cdss-hf-decision-recorded-heart-failure-mra')
    expect(recorded).toHaveTextContent('已開立')
    expect(recorded).toHaveTextContent(/今日 \d{2}:\d{2}/)
    expect(screen.getByTestId('cdss-hf-actions-decided')).toHaveTextContent('已決定 1 / 2')

    // 「已開立」 does not retire the row: it is still there, and still open to
    // a different decision.
    expect(screen.getByTestId('cdss-hf-action-row-heart-failure-mra')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cdss-hf-decision-edit-heart-failure-mra'))
    expect(screen.getByTestId('cdss-hf-decision-heart-failure-mra-deferred')).toBeInTheDocument()
  })

  it('uses the same drug-category heading style for all HFrEF foundational therapies', () => {
    const base = heartFailureResult()
    const hfrEfResult: CdssResult = {
      ...base,
      recommendations: [
        ...base.recommendations,
        recommendation('heart-failure-ras-inhibition', {
          status: 'actionable',
          title: '評估建立或最佳化 ARNI（不適用時 ACEI／ARB）。',
        }),
        recommendation('heart-failure-beta-blocker', {
          status: 'needs-data',
          title: '評估建立或最佳化具 HFrEF 實證的 β 阻斷劑。',
          missingData: ['此決策可用的 心率（目前資料完全沒有這一項）'],
        }),
        recommendation('heart-failure-sglt2', {
          status: 'actionable',
          title: '評估建立或持續 SGLT2i。',
        }),
      ],
    }

    render(<Harness result={hfrEfResult} />)
    suspectHeartFailure()

    expect(screen.getByTestId('cdss-hf-action-category-heart-failure-ras-inhibition'))
      .toHaveTextContent('ARNI／ACEI／ARB')
    expect(screen.getByTestId('cdss-hf-action-headline-heart-failure-ras-inhibition'))
      .toHaveTextContent('評估建立或最佳化。')
    expect(screen.getByTestId('cdss-hf-action-category-heart-failure-beta-blocker'))
      .toHaveTextContent('β 阻斷劑')
    expect(screen.getByTestId('cdss-hf-action-headline-heart-failure-beta-blocker'))
      .toHaveTextContent('評估建立或最佳化。')
    expect(screen.getByTestId('cdss-hf-action-row-heart-failure-beta-blocker'))
      .toHaveTextContent('缺：心率')
    expect(screen.getByTestId('cdss-hf-action-row-heart-failure-beta-blocker'))
      .not.toHaveTextContent('目前資料完全沒有這一項')
    expect(screen.getByTestId('cdss-hf-action-subgroup-pillars'))
      .toHaveTextContent('HFrEF 四大支柱')
    expect(screen.getByTestId('cdss-hf-action-subgroup-pillars'))
      .toHaveTextContent('已決定 0 / 4')
    expect(screen.getByTestId('cdss-hf-action-subgroup-symptom-control'))
      .toHaveTextContent('症狀控制')
  })

  it('asks for a reason when a recommendation is deferred', () => {
    render(<Harness />)
    suspectHeartFailure()
    fireEvent.click(screen.getByTestId('cdss-hf-decision-heart-failure-mra-deferred'))

    const reasons = screen.getByTestId('cdss-hf-decision-reasons-heart-failure-mra')
    expect(within(reasons).getAllByRole('button').length).toBeGreaterThan(1)
    expect(screen.queryByTestId('cdss-hf-decision-note-heart-failure-mra')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cdss-hf-decision-reason-heart-failure-mra-other'))
    expect(screen.getByTestId('cdss-hf-decision-note-heart-failure-mra')).toBeVisible()
    fireEvent.click(screen.getByTestId('cdss-hf-decision-reason-heart-failure-mra-other'))
    expect(screen.queryByTestId('cdss-hf-decision-note-heart-failure-mra')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cdss-hf-decision-reason-heart-failure-mra-drug-intolerance'))
    fireEvent.click(screen.getByTestId('cdss-hf-decision-save-heart-failure-mra'))

    expect(screen.getByTestId('cdss-hf-decision-recorded-heart-failure-mra'))
      .toHaveTextContent('不耐受')
  })

  it('clears reasons from another drug decision instead of carrying them into the new choice', () => {
    usePhysicianDecisionsStore.setState({
      byPatientId: {
        [PATIENT]: {
          'heart-failure-mra': {
            decision: 'contraindicated',
            reasons: ['low-egfr'],
            note: '舊的通用原因',
            recordedAt: '2026-09-12T08:00:00.000Z',
            packVersion: 'old',
          },
        },
      },
    })
    render(<Harness />)
    suspectHeartFailure()

    fireEvent.click(screen.getByTestId('cdss-hf-decision-edit-heart-failure-mra'))
    fireEvent.click(screen.getByTestId('cdss-hf-decision-heart-failure-mra-deferred'))

    expect(usePhysicianDecisionsStore.getState().byPatientId[PATIENT]?.['heart-failure-mra'])
      .toMatchObject({ decision: 'deferred', reasons: [] })
    expect(usePhysicianDecisionsStore.getState().byPatientId[PATIENT]?.['heart-failure-mra']?.note)
      .toBeUndefined()
  })

  it('keeps every answer when the reader switches to the original board and back', () => {
    render(<Harness />)
    suspectHeartFailure()
    fireEvent.click(screen.getByTestId('cdss-hf-flow-nyha-III'))
    fireEvent.click(screen.getByTestId('cdss-hf-decision-heart-failure-mra-prescribed'))

    fireEvent.click(screen.getByTestId('switch-layout'))
    expect(screen.getByTestId('cdss-hf-board')).toBeInTheDocument()
    expect(screen.queryByTestId('cdss-hf-visit-flow')).toBeNull()

    fireEvent.click(screen.getByTestId('switch-layout'))
    expect(screen.getByTestId('cdss-hf-question-answer-nyha')).toHaveTextContent('NYHA III')
    expect(screen.getByTestId('cdss-hf-decision-recorded-heart-failure-mra'))
      .toHaveTextContent('已開立')
    expect(screen.getByTestId('cdss-hf-questions-remaining')).toHaveTextContent('還有 3 題')
  })

  it('leads with 「前往第 2 題」 while criterion (i) is undetermined', () => {
    render(<Harness result={withHfpEfConfirmation('undetermined')} />)
    suspectHeartFailure()

    // The useful action is not 「確認」: the symptoms are what would settle the
    // criterion, so the confirmation is offered but does not lead.
    expect(screen.getByTestId('cdss-hf-hfpef-go-to-symptoms')).toHaveTextContent('前往第 2 題')
    expect(screen.getByTestId('cdss-hf-hfpef-confirm')).toBeInTheDocument()
    expect(screen.getByTestId('cdss-hf-hfpef-defer')).toHaveTextContent('暫不確認')
  })

  it('offers the confirmation first once criterion (i) is met, and can be deferred', () => {
    render(<Harness result={withHfpEfConfirmation('met')} />)
    suspectHeartFailure()

    expect(screen.queryByTestId('cdss-hf-hfpef-go-to-symptoms')).toBeNull()
    fireEvent.click(screen.getByTestId('cdss-hf-hfpef-defer'))

    // 「暫不確認」 finishes the question without stating anything.
    expect(screen.getByTestId('cdss-hf-question-answer-hfpef-confirmation'))
      .toHaveTextContent('暫不確認')
    expect(usePhenotypeAnswerStore.getState().byPatientId[PATIENT]?.hfpEfConfirmed)
      .toBe('not-assessed')

    fireEvent.click(screen.getByTestId('cdss-hf-question-edit-hfpef-confirmation'))
    fireEvent.click(screen.getByTestId('cdss-hf-hfpef-confirm'))
    expect(usePhenotypeAnswerStore.getState().byPatientId[PATIENT]?.hfpEfConfirmed).toBe(true)
  })

  it('draws the module list once, not twice', () => {
    render(<Harness />)
    suspectHeartFailure()

    // The generic 個案決策總覽 list is not rendered underneath the flow's own.
    expect(screen.queryByLabelText('個案決策總覽')).toBeNull()
    expect(screen.getAllByTestId('cdss-hf-action-row-heart-failure-mra')).toHaveLength(1)
  })

  it('withholds every control when no patient is loaded', () => {
    render(
      <ClinicalDecisionSupportView
        result={heartFailureResult()}
        locale="zh-TW"
        layout="flow"
      />,
    )

    expect(screen.getByTestId('cdss-hf-questions-read-only')).toHaveTextContent('需載入病人才能作答')
    expect(screen.queryByTestId('cdss-hf-flow-nyha')).toBeNull()
    expect(screen.queryByTestId('cdss-hf-decision-heart-failure-mra')).toBeNull()
  })

  it('labels clinic measurements as measured rather than ordered', () => {
    const base = heartFailureResult()
    const withFmtSafety: CdssResult = {
      ...base,
      recommendations: [
        ...base.recommendations,
        recommendation('heart-failure-fmt-safety', {
          moduleGroup: 'monitoring',
          domain: 'monitoring',
          status: 'needs-data',
          missingData: ['心率'],
          nextActions: ['補齊心率並複驗血壓，再評估藥物調整。'],
        }),
      ],
    }
    render(<Harness result={withFmtSafety} />)
    suspectHeartFailure()

    expect(screen.getByTestId('cdss-hf-decision-heart-failure-fmt-safety-measurements-completed'))
      .toHaveTextContent('已量測')
    expect(screen.queryByTestId('cdss-hf-decision-heart-failure-fmt-safety-ordered'))
      .not.toBeInTheDocument()
  })
})

describe('diuretic decision reasons', () => {
  it('uses true contraindications for contraindicated and clinical adjustment reasons for deferred', () => {
    expect(decisionReasonIds('heart-failure-congestion-diuretic', 'medication', 'contraindicated')).toEqual([
      'anuria', 'drug-hypersensitivity', 'other',
    ])
    const deferred = decisionReasonIds('heart-failure-congestion-diuretic', 'medication', 'deferred')
    expect(deferred).toEqual([
      'no-congestion', 'volume-depletion', 'electrolyte-depletion',
      'worsening-renal-function', 'drug-intolerance', 'patient-refused', 'other',
    ])
    expect(deferred).not.toEqual(expect.arrayContaining(['high-potassium', 'bradycardia', 'low-egfr']))
  })
})

describe('foundational therapy decision reasons', () => {
  it('separates ARNI/ACEI/ARB contraindications from reasons to defer', () => {
    expect(decisionReasonIds('heart-failure-ras-inhibition', 'medication', 'contraindicated')).toEqual([
      'angioedema-history', 'pregnancy', 'acei-arni-overlap', 'arni-aliskiren-diabetes',
      'drug-hypersensitivity', 'other',
    ])
    expect(decisionReasonIds('heart-failure-ras-inhibition', 'medication', 'deferred')).toEqual([
      'symptomatic-hypotension', 'high-potassium', 'worsening-renal-function', 'drug-intolerance',
      'patient-refused', 'cost', 'other',
    ])
  })

  it('uses beta-blocker-specific contraindications and keeps instability under deferral', () => {
    expect(decisionReasonIds('heart-failure-beta-blocker', 'medication', 'contraindicated')).toEqual([
      'high-grade-av-block', 'severe-bradycardia', 'cardiogenic-shock', 'bronchial-asthma',
      'drug-hypersensitivity', 'other',
    ])
    expect(decisionReasonIds('heart-failure-beta-blocker', 'medication', 'deferred')).toEqual([
      'acute-decompensation', 'bradycardia', 'symptomatic-hypotension', 'drug-intolerance',
      'patient-refused', 'cost', 'other',
    ])
  })

  it('uses MRA-specific potassium, kidney and product contraindications', () => {
    expect(decisionReasonIds('heart-failure-mra', 'medication', 'contraindicated')).toEqual([
      'mra-hyperkalemia', 'mra-renal-threshold', 'addison-disease', 'duplicate-mra',
      'drug-hypersensitivity', 'other',
    ])
    expect(decisionReasonIds('heart-failure-mra', 'medication', 'deferred')).toEqual([
      'symptomatic-hypotension', 'worsening-renal-function', 'acute-illness-fasting-surgery',
      'drug-intolerance', 'patient-refused', 'cost', 'other',
    ])
  })

  it('uses SGLT2i-specific contraindications and temporary withholding reasons', () => {
    expect(decisionReasonIds('heart-failure-sglt2', 'medication', 'contraindicated')).toEqual([
      'drug-hypersensitivity', 'other',
    ])
    expect(decisionReasonIds('heart-failure-sglt2', 'medication', 'deferred')).toEqual([
      'volume-depletion', 'ketoacidosis', 'acute-illness-fasting-surgery', 'low-egfr-initiation',
      'drug-intolerance', 'patient-refused', 'cost', 'other',
    ])
  })

  it('does not guess drug-specific physiology for an unknown medication module', () => {
    expect(decisionReasonIds('unknown-medication', 'medication', 'contraindicated')).toEqual([
      'drug-hypersensitivity', 'other',
    ])
    expect(decisionReasonIds('unknown-medication', 'medication', 'deferred')).toEqual([
      'drug-intolerance', 'patient-refused', 'cost', 'other',
    ])
  })
})
