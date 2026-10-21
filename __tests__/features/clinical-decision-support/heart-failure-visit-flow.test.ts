/**
 * The visit as a model: which step the clinician is on, which single next step
 * outranks the rest, and what the list of today's actions is grouped into.
 *
 * Pure input, pure output. The ordering rules are the part of this screen that
 * can be wrong in a way a reader would not notice — a safety alert sitting
 * below an unanswered question, a step that says 「完成」 with a row nobody
 * decided — so they are checked here rather than through a rendered tree.
 */
import {
  buildHeartFailureVisitFlow,
} from '@/features/clinical-decision-support/renderers/heart-failure-visit-flow'
import { buildHeartFailureBoard } from '@/features/clinical-decision-support/renderers/heart-failure-board'
import {
  buildClinicVitals,
  type ClinicVitals,
} from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import type { PhenotypeAnswer } from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import type { PhysicianDecisionMap } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import type {
  CdssRecommendation,
  CdssResult,
  ClinicalEvidence,
} from '@/features/clinical-decision-support/types'

const NOW = new Date('2026-09-11T14:05:00+08:00')

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

const lvef = evidence('LVEF', '32%', 'LVEF', '2026-07-14')
const potassium = evidence('K', '4.9 mmol/L', 'potassium', '2026-08-25')

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

/** The DP-00 card, carrying the pack's own question and its two option labels. */
function phenotypeCard(extra: Partial<CdssRecommendation> = {}): CdssRecommendation {
  return recommendation('heart-failure-phenotype', {
    moduleGroup: 'assessment',
    domain: 'diagnosis',
    status: 'no-action',
    priority: 'routine',
    title: '進入 HFrEF（LVEF <50%） 路徑',
    overviewEvidenceFactKey: 'LVEF',
    patientEvidence: [lvef],
    physicianInputRequests: [{
      kind: 'hf-suspicion',
      label: '您懷疑這位病人有心衰竭嗎？',
      options: [
        { id: 'suspected', label: '是，懷疑心衰竭' },
        { id: 'not-suspected', label: '否，本次不懷疑' },
      ],
    }],
    ...extra,
  })
}

function result(overrides: Partial<CdssResult> = {}): CdssResult {
  return {
    title: '心衰竭個人化照護指引',
    summary: '',
    packId: 'heart-failure-cdss',
    packVersion: '1.13.0',
    recommendations: [
      phenotypeCard(),
      recommendation('heart-failure-medication-safety', {
        moduleGroup: 'monitoring',
        domain: 'safety',
        status: 'actionable',
        priority: 'high',
        title: '目前處方掃到 ESC 點名的 1 類藥物：NSAID',
        overviewEvidenceFactKey: 'hfHarmfulNsaid',
        patientEvidence: [evidence('NSAID', '目前用藥中：Diclofenac 50mg', 'hfHarmfulNsaid', '2026-08-25')],
        nextActions: ['停用 diclofenac：HFrEF 應避免 NSAID'],
      }),
      recommendation('heart-failure-hfref-gdmt', {
        status: 'review',
        priority: 'high',
        title: 'HFrEF 四大 FMT 支柱已確認 3/4 類',
        patientEvidence: [lvef],
      }),
      recommendation('heart-failure-ras-inhibition', {
        status: 'actionable',
        title: 'HFrEF 目前用 ACEI／ARB，建議換成 ARNI',
        overviewEvidenceFactKey: 'aceArbTherapy',
        patientEvidence: [
          evidence('ACEI／ARB', '目前用藥中：Valsartan 80mg', 'aceArbTherapy', '2026-08-20'),
        ],
        nextActions: ['ARB → ARNI（sacubitril/valsartan）'],
      }),
      recommendation('heart-failure-mra', {
        status: 'actionable',
        title: 'HFrEF 適用 MRA，目前無處方',
        overviewEvidenceFactKey: 'mraTherapy',
        patientEvidence: [evidence('MRA', '目前未使用', 'mraTherapy'), potassium],
        missingData: [],
        nextActions: ['起始 MRA（spironolactone 12.5–25 mg）'],
      }),
      recommendation('heart-failure-beta-blocker', {
        status: 'no-action',
        priority: 'routine',
        title: '已有具 HFrEF 實證的 β 阻斷劑處方',
        overviewEvidenceFactKey: 'hfEvidenceBetaBlockerTherapy',
        patientEvidence: [
          evidence('β 阻斷劑', '目前用藥中：Bisoprolol 2.5mg', 'hfEvidenceBetaBlockerTherapy', '2026-08-20'),
        ],
        nextActions: ['依最高耐受劑量持續 β 阻斷劑'],
      }),
      recommendation('heart-failure-sglt2', {
        status: 'no-action',
        priority: 'routine',
        title: '已有 SGLT2i 處方',
        overviewEvidenceFactKey: 'sglt2Therapy',
        patientEvidence: [
          evidence('SGLT2i', '目前用藥中：Dapagliflozin 10mg', 'sglt2Therapy', '2026-08-20'),
        ],
        nextActions: ['SGLT2i 使用中，維持'],
      }),
      recommendation('heart-failure-monitoring', {
        moduleGroup: 'monitoring',
        domain: 'monitoring',
        status: 'needs-data',
        title: '缺 NT-proBNP 基準',
        missingData: ['NT-proBNP'],
        nextActions: ['抽 NT-proBNP 作為基準；1 週後追蹤 K 與腎功能。'],
      }),
      recommendation('heart-failure-iron', {
        status: 'no-action',
        priority: 'routine',
        title: '鐵缺乏目前無需處理',
        nextActions: ['本次無需處理'],
      }),
    ],
    notEvaluated: [],
    disclaimer: '',
    ...overrides,
  }
}

function flowFor(input: {
  result?: CdssResult
  clinicVitals?: ClinicVitals
  phenotypeAnswer?: PhenotypeAnswer
  decisions?: PhysicianDecisionMap
  patientId?: string | undefined
} = {}) {
  const packResult = input.result ?? result()
  const board = buildHeartFailureBoard(packResult, 'zh-TW', NOW)
  if (!board) throw new Error('the heart-failure board should build for this pack')
  return buildHeartFailureVisitFlow({
    board,
    result: packResult,
    isEnglish: false,
    now: NOW,
    ...(input.clinicVitals ? { clinicVitals: input.clinicVitals } : {}),
    ...(input.phenotypeAnswer ? { phenotypeAnswer: input.phenotypeAnswer } : {}),
    decisions: input.decisions ?? {},
    patientId: 'patientId' in input ? input.patientId : 'p1',
  })
}

const SUSPECTED: PhenotypeAnswer = {
  hfSuspicion: 'suspected',
  answeredOn: '2026-09-11',
  modifiedAt: { hfSuspicion: '2026-09-11T06:05:00.000Z' },
}

/** Everything questions 2–6 can be answered with, in one statement. */
function answeredVitals(): ClinicVitals {
  return buildClinicVitals({
    nyhaClass: 'II',
    signAnswers: {
      // ② every common symptom
      'exertional-dyspnea': 'present',
      orthopnea: 'absent',
      'paroxysmal-nocturnal-dyspnea': 'not-assessed',
      'fatigue-exercise-intolerance': 'present',
      'reported-ankle-swelling': 'present',
      'abdominal-bloating': 'absent',
      // ④ every common sign
      rales: 'absent',
      jvp: 'absent',
      'pitting-edema': 'present',
    },
    compensationStatus: 'compensated',
    entries: {
      systolic: { value: 118 },
      diastolic: { value: 72 },
      heartRate: { value: 76 },
      oxygenSaturation: { value: 97 },
    },
  }, NOW)
}

describe('the next step', () => {
  it('states the negative medication-safety finding instead of a generic rescan instruction', () => {
    const packResult = result()
    packResult.recommendations = packResult.recommendations.map((item) => (
      item.id === 'heart-failure-medication-safety'
        ? {
            ...item,
            status: 'no-action',
            patientEvidence: [],
            nextActions: ['新增處方或跨院所回診後重新掃描；本卡不需要額外資料。'],
          }
        : item
    ))

    const flow = flowFor({ result: packResult })
    const safetyRow = flow.actionGroups
      .flatMap((group) => group.rows)
      .find((row) => row.recommendation.id === 'heart-failure-medication-safety')

    expect(safetyRow?.headline).toBe('本次用藥掃描未發現 NSAID 或 COX-2 抑制劑使用紀錄。')
  })

  it('puts an undecided safety alert above an unanswered question 1', () => {
    // A harmful prescription is harmful whether or not this clinician is
    // asking about heart failure today, so it outranks the gate itself.
    const flow = flowFor()

    expect(flow.nextStep.tone).toBe('safety')
    expect(flow.nextStep.message).toContain('先處理安全警訊')
    expect(flow.nextStep.message).toContain('NSAID')
    expect(flow.nextStep.target).toMatchObject({
      kind: 'action',
      moduleId: 'heart-failure-medication-safety',
    })
    expect(flow.nextStep.actionLabel).toBe('看第 1 列')
  })

  it('falls to the first unanswered question once the alert is decided', () => {
    const flow = flowFor({
      decisions: {
        'heart-failure-medication-safety': {
          decision: 'contraindicated',
          reasons: [],
          recordedAt: NOW.toISOString(),
          packVersion: '1.13.0',
        },
      },
    })

    expect(flow.nextStep.tone).toBe('primary')
    expect(flow.nextStep.message).toBe('接下來：您懷疑這位病人有心衰竭嗎？')
    expect(flow.nextStep.target).toEqual({ kind: 'question', questionId: 'hf-suspicion' })
    // On the first open, the clues the record already holds are named, so the
    // reader does not have to hunt for them to answer.
    expect(flow.nextStep.hint).toContain('LVEF 32%')
  })

  it('falls to the first undecided row once every question is answered', () => {
    const decided: PhysicianDecisionMap = {
      'heart-failure-medication-safety': {
        decision: 'contraindicated',
        reasons: [],
        recordedAt: NOW.toISOString(),
        packVersion: '1.13.0',
      },
    }
    const flow = flowFor({
      phenotypeAnswer: SUSPECTED,
      clinicVitals: answeredVitals(),
      decisions: decided,
    })

    expect(flow.openQuestionCount).toBe(0)
    expect(flow.nextStep.tone).toBe('primary')
    expect(flow.nextStep.message).toBe('接下來：ARB → ARNI（sacubitril/valsartan）')
    expect(flow.nextStep.target).toMatchObject({
      kind: 'action',
      moduleId: 'heart-failure-ras-inhibition',
    })
  })

  it('says the visit is complete, with the pack\'s follow-up sentence, once nothing is left', () => {
    const decisions: PhysicianDecisionMap = Object.fromEntries(
      [
        'heart-failure-medication-safety',
        'heart-failure-ras-inhibition',
        'heart-failure-mra',
        'heart-failure-beta-blocker',
        'heart-failure-sglt2',
        'heart-failure-monitoring',
      ].map((id) => [id, {
        decision: 'prescribed' as const,
        reasons: [],
        recordedAt: NOW.toISOString(),
        packVersion: '1.13.0',
      }]),
    )
    const flow = flowFor({
      phenotypeAnswer: SUSPECTED,
      clinicVitals: answeredVitals(),
      decisions,
    })

    expect(flow.decidedCount).toBe(flow.decidableCount)
    expect(flow.nextStep.tone).toBe('ok')
    expect(flow.nextStep.message).toContain('本次完成：複製摘要到病歷')
    // The follow-up clause is the pack's own sentence, never the host's.
    expect(flow.nextStep.message).toContain('1 週後追蹤 K 與腎功能')
    expect(flow.nextStep.target).toEqual({ kind: 'copy' })
  })
})

describe('the step bar', () => {
  it('opens with confirmation in progress and nothing else started', () => {
    const flow = flowFor()
    expect(flow.steps.map((step) => [step.id, step.state])).toEqual([
      ['confirm', 'current'],
      ['assess', 'todo'],
      ['act', 'current'],
      ['record', 'todo'],
    ])
    expect(flow.steps[1].detail).toBe('答「是」後開放')
  })

  it('counts the questions left, and names the phenotype once it is settled', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED })
    const [confirm, assess] = flow.steps

    expect(confirm.state).toBe('done')
    expect(confirm.detail).toContain('是')
    expect(confirm.detail).toContain('HFrEF')
    expect(confirm.detail).toContain('LVEF 32%')
    // ② 症狀, ③ NYHA, ④ 徵象 and ⑤ 代償 are all outstanding here.
    expect(assess.state).toBe('current')
    expect(assess.detail).toBe('還有 4 題')
  })

  it('marks the visit not applicable when the clinician does not suspect heart failure', () => {
    const flow = flowFor({
      phenotypeAnswer: { hfSuspicion: 'not-suspected', answeredOn: '2026-09-11' },
    })

    expect(flow.steps[0].state).toBe('na')
    expect(flow.steps[1].state).toBe('na')
    expect(flow.openQuestionCount).toBe(0)
  })
})

describe('the questions', () => {
  it('locks questions 2–5 until question 1 is answered', () => {
    const flow = flowFor()
    const states = Object.fromEntries(flow.questions.map((item) => [item.id, item.state]))

    expect(states['hf-suspicion']).toBe('open')
    expect(states.symptoms).toBe('locked')
    expect(states.nyha).toBe('locked')
    expect(states.signs).toBe('locked')
    expect(states.compensation).toBe('locked')
    expect(states['clinic-vitals']).toBeUndefined()
    expect(flow.questions.find((item) => item.id === 'nyha')?.lockedReason)
      .toBe('先回答「HFrEF 還是 HFpEF？」後開放')
  })

  it('folds the rest away and drops the count when the answer is 「否」', () => {
    const flow = flowFor({
      phenotypeAnswer: { hfSuspicion: 'not-suspected', answeredOn: '2026-09-11' },
    })

    const nyha = flow.questions.find((item) => item.id === 'nyha')
    expect(nyha?.state).toBe('locked')
    expect(nyha?.lockedReason).toBe('本次不懷疑心衰竭，其餘題目略過。')
    expect(flow.openQuestionCount).toBe(0)
    // Only what is dangerous whatever the diagnosis is still listed.
    expect(flow.actionGroups.map((group) => group.id)).toEqual(['safety'])
  })

  it('counts 「未評估」 as an answer and never as a negative', () => {
    const flow = flowFor({
      phenotypeAnswer: SUSPECTED,
      clinicVitals: buildClinicVitals({ nyhaClass: 'not-assessed' }, NOW),
    })
    const nyha = flow.questions.find((item) => item.id === 'nyha')

    expect(nyha?.state).toBe('answered')
    expect(nyha?.answerText).toBe('未評估')
  })

  it('asks the symptoms and the signs as two questions, in the visit\'s order', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED })

    expect(flow.questions.map((item) => [item.number, item.id])).toEqual([
      ['1', 'hf-suspicion'],
      ['2', 'symptoms'],
      ['3', 'signs'],
      ['4', 'nyha'],
      ['5', 'compensation'],
    ])
    const symptoms = flow.questions.find((item) => item.id === 'symptoms')
    expect(symptoms?.items?.map((item) => item.term)).toContain('exertional-dyspnea')
    // The tag is for the reader; every answer still travels as its own term.
    expect(symptoms?.items?.find((item) => item.term === 'reported-ankle-swelling')?.side)
      .toBe('systemic')
    expect(symptoms?.items?.filter((item) => !item.common).map((item) => item.term))
      .toEqual(['abdominal-bloating', 'nocturnal-cough', 'bendopnea'])
  })

  it('enters HFrEF directly when the record has an HF diagnosis and LVEF is below 50%', () => {
    const packResult = result()
    const diagnosedResult: CdssResult = {
      ...packResult,
      recommendations: packResult.recommendations.map((item) => item.id === 'heart-failure-phenotype'
        ? {
          ...item,
          patientEvidence: [
            evidence('心衰竭診斷', 'I50.22 慢性收縮性心衰竭', 'heartFailureDiagnosis', '2026-07-01'),
            ...item.patientEvidence,
          ],
          // As the pack asks DP-01 on a diagnosed chart: answered from the record.
          physicianInputRequests: [{
            kind: 'hf-suspicion' as const,
            label: '診斷：HFrEF 還是 HFpEF？',
            detail: '紀錄：I50.22・LVEF 32%（2026-07-01）',
            recordedOptionId: 'hfref',
            selection: 'single' as const,
            options: [{ id: 'hfref', label: 'HFrEF（LVEF <50%）' }],
          }],
        }
        : item),
    }

    const flow = flowFor({ result: diagnosedResult })

    // The same question 1 as every chart, standing on the record's answer.
    expect(flow.questions.map((item) => [item.number, item.id])).toEqual([
      ['1', 'hf-suspicion'],
      ['2', 'symptoms'],
      ['3', 'signs'],
      ['4', 'nyha'],
      ['5', 'compensation'],
    ])
    expect(flow.questions[0]).toMatchObject({ state: 'answered', answerText: 'HFrEF（紀錄）', hint: '紀錄：I50.22・LVEF 32%（2026-07-01）' })
    expect(flow.steps[0]).toMatchObject({ state: 'done' })
    expect(flow.steps[0].detail).toContain('HFrEF · LVEF 32')
    expect(flow.questions.find((item) => item.id === 'symptoms')?.hint).toBeUndefined()
    expect(flow.questions.find((item) => item.id === 'signs')?.hint).toBeUndefined()
  })

  it('folds each answered list onto one line and tallies the two sides', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED, clinicVitals: answeredVitals() })
    const symptoms = flow.questions.find((item) => item.id === 'symptoms')
    const signs = flow.questions.find((item) => item.id === 'signs')

    expect(symptoms?.state).toBe('answered')
    // Grouped by answer, the findings first, so the one row that matters is
    // not lost in a list of 「：−」.
    expect(symptoms?.answerText).toBe('有：勞力性喘、疲倦、腳腫；無：端坐呼吸、腹脹；未評估：PND；2 項未答')
    expect(signs?.answerText).toBe('有：Pitting edema；無：Rales、JVP；3 項未答')
    // 勞力性喘 and 疲倦 on the pulmonary side, 腳腫 and 凹陷性水腫 on the
    // systemic one; the tally is read across both questions.
    expect(signs?.sideTally).toEqual({ pulmonary: 2, systemic: 2 })
    expect(symptoms?.sideTally).toBeUndefined()
  })

  it('leaves a list open while a common row is unanswered, whatever the rest say', () => {
    const flow = flowFor({
      phenotypeAnswer: SUSPECTED,
      clinicVitals: buildClinicVitals({
        signAnswers: { rales: 'absent', jvp: 'absent', ascites: 'absent' },
      }, NOW),
    })

    expect(flow.questions.find((item) => item.id === 'signs')?.state).toBe('open')
  })

  it('puts the HFpEF confirmation last, counts it, and lets 「暫不確認」 finish it', () => {
    // It reads questions ② and ④ to judge criterion (i), so it cannot be asked
    // before them; and it belongs to 本次評估, not to the diagnosis step.
    const asked = result()
    const withConfirmation: CdssResult = {
      ...asked,
      recommendations: [
        ...asked.recommendations,
        recommendation('heart-failure-hfpef-diagnosis', {
          moduleGroup: 'assessment',
          domain: 'diagnosis',
          status: 'review',
          physicianInputRequests: [{
            kind: 'hfpef-diagnosis-confirmation',
            label: '確認 HFpEF 診斷？',
          }],
        } as Partial<CdssRecommendation>),
      ],
    }

    const open = flowFor({ result: withConfirmation, phenotypeAnswer: SUSPECTED })
    const last = open.questions.at(-1)
    expect(last?.id).toBe('hfpef-confirmation')
    expect(last?.number).toBe('6')
    expect(last?.counted).toBe(true)
    expect(last?.state).toBe('open')
    // ① is settled by the suspicion and the LVEF gate alone.
    expect(open.steps[0].state).toBe('done')

    const deferred = flowFor({
      result: withConfirmation,
      phenotypeAnswer: { ...SUSPECTED, hfpEfConfirmed: 'not-assessed' },
    })
    expect(deferred.questions.at(-1)?.state).toBe('answered')
    expect(deferred.questions.at(-1)?.answerText).toBe('暫不確認')

    const confirmed = flowFor({
      result: withConfirmation,
      phenotypeAnswer: { ...SUSPECTED, hfpEfConfirmed: true },
    })
    expect(confirmed.questions.at(-1)?.answerText).toBe('HFpEF 已確認')

    // 「取消確認」 on the original board returns the question to unanswered.
    const undone = flowFor({
      result: withConfirmation,
      phenotypeAnswer: { ...SUSPECTED, hfpEfConfirmed: false },
    })
    expect(undone.questions.at(-1)?.state).toBe('open')
  })

  it('asks the pack\'s own question in the pack\'s own words', () => {
    const flow = flowFor()
    const first = flow.questions[0]

    expect(first.label).toBe('您懷疑這位病人有心衰竭嗎？')
    expect(first.request?.options?.map((option) => option.label))
      .toEqual(['是，懷疑心衰竭', '否，本次不懷疑'])
  })

  it('raises the LVEF gate only where the pack asked for it', () => {
    expect(flowFor().questions.some((item) => item.id === 'lvef-phenotype')).toBe(false)

    const asked = result()
    const withGate = {
      ...asked,
      recommendations: asked.recommendations.map((item) => (
        item.id === 'heart-failure-phenotype'
          ? phenotypeCard({
            physicianInputRequests: [
              {
                kind: 'hf-suspicion',
                label: '您懷疑這位病人有心衰竭嗎？',
                options: [
                  { id: 'suspected', label: '是，懷疑心衰竭' },
                  { id: 'not-suspected', label: '否，本次不懷疑' },
                ],
              },
              { kind: 'lvef-phenotype', label: '這位病人的 LVEF 是多少？', options: [] },
            ],
          } as Partial<CdssRecommendation>)
          : item
      )),
    }
    const gated = flowFor({ result: withGate, phenotypeAnswer: SUSPECTED })
    const gate = gated.questions.find((item) => item.id === 'lvef-phenotype')

    expect(gate?.number).toBe('1b')
    // The gate belongs to step ①; it does not move 「還有 n 題」.
    expect(gate?.counted).toBe(false)
    expect(gated.steps[0].state).toBe('current')
  })
})

describe("today's actions", () => {
  it('lists the four pillars as ordinary rows carrying what the patient is on', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED })
    const medication = flow.actionGroups.find((group) => group.id === 'actionable')
    const ids = medication?.rows.map((row) => row.recommendation.id)

    expect(ids).toEqual([
      'heart-failure-ras-inhibition',
      'heart-failure-beta-blocker',
      'heart-failure-mra',
      'heart-failure-sglt2',
    ])
    expect(flow.actionGroups.flatMap((group) => group.rows)
      .some((row) => row.recommendation.id === 'heart-failure-hfref-gdmt')).toBe(false)
    const ras = medication?.rows.find((row) => row.recommendation.id === 'heart-failure-ras-inhibition')
    expect(ras?.medications).toBe('Valsartan 80mg')
    expect(ras?.headline).toBe('ARB → ARNI（sacubitril/valsartan）')
    // A pillar already prescribed keeps its row and its buttons: 「目前無需
    // 處理」 is a status, not a reason to hide the decision.
    const sglt2 = medication?.rows.find((row) => row.recommendation.id === 'heart-failure-sglt2')
    expect(sglt2?.status).toBe('no-action')
    expect(sglt2?.decisionKind).toBe('medication')
  })

  it('gives 目前無需處理 no buttons, folds it, and names what it holds', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED })
    const done = flow.actionGroups.find((group) => group.id === 'no-action')

    expect(done?.collapsedByDefault).toBe(true)
    expect(done?.summary).toContain('模組 heart-failure-iron')
    expect(done?.rows.every((row) => row.decisionKind === 'none')).toBe(true)
    expect(done?.rows.every((row) => row.index === undefined)).toBe(true)
  })

  it('numbers the decidable rows continuously and offers a test row two buttons', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED })
    const rows = flow.actionGroups.flatMap((group) => group.rows)

    expect(rows.filter((row) => row.index !== undefined).map((row) => row.index))
      .toEqual([1, 2, 3, 4, 5, 6])
    const test = rows.find((row) => row.recommendation.id === 'heart-failure-monitoring')
    expect(test?.decisionKind).toBe('test')
    expect(flow.decidableCount).toBe(6)
  })

  it('names the concrete missing and stale safety inputs in the FMT monitoring headline', () => {
    const packResult = result()
    packResult.recommendations = [
      ...packResult.recommendations,
      recommendation('heart-failure-fmt-safety', {
        moduleGroup: 'monitoring',
        domain: 'monitoring',
        status: 'needs-data',
        missingData: ['此決策可用的 心率（目前資料完全沒有這一項）'],
        patientEvidence: [
          evidence('血壓', '142/84 mmHg（2026-04-18）（已 147 天，超過 90 天窗）', 'bloodPressure'),
          evidence('eGFR', '48.3 mL/min/1.73m²（2026-07-06）', 'egfr'),
        ],
        nextActions: ['將目前安全資料帶入各藥物 track 的下一個 decision point。'],
      }),
    ]

    const flow = flowFor({ result: packResult, phenotypeAnswer: SUSPECTED })
    const safety = flow.actionGroups.flatMap((group) => group.rows)
      .find((row) => row.recommendation.id === 'heart-failure-fmt-safety')

    expect(safety?.headline).toBe('補齊心率並複驗血壓，再評估藥物調整。')
    expect(safety?.decisionKind).toBe('measurement')
  })

  it('keeps HFpEF in the assessment and omits its duplicate treatment card', () => {
    // The diagnosis is answered in question 6 with the calculator evidence.
    // Repeating the same evidence as a read-only treatment row adds no action.
    const base = result()
    const withHfpEf: CdssResult = {
      ...base,
      recommendations: [
        ...base.recommendations,
        recommendation('heart-failure-hfpef-diagnosis', {
          moduleGroup: 'assessment',
          domain: 'diagnosis',
          physicianInputRequests: [{
            kind: 'hfpef-diagnosis-confirmation',
            label: '確認 HFpEF 診斷？',
          }],
        } as Partial<CdssRecommendation>),
        recommendation('heart-failure-hfpef-treatment', {
          moduleName: 'HFpEF 治療',
          status: 'no-action',
          nextActions: ['由臨床人員確認分型與適應症後，再依完整病歷共同決策。'],
        }),
      ],
    }
    const flow = flowFor({ result: withHfpEf, phenotypeAnswer: SUSPECTED })
    const ids = flow.actionGroups.flatMap((group) => group.rows.map((row) => row.recommendation.id))

    expect(flow.questions.some((question) => question.id === 'hfpef-confirmation')).toBe(true)
    expect(ids).not.toContain('heart-failure-phenotype')
    expect(ids).not.toContain('heart-failure-hfpef-diagnosis')
    expect(ids).not.toContain('heart-failure-hfpef-treatment')
  })

  it('carries the basis from the pack\'s own overview evidence', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED })
    const mra = flow.actionGroups
      .flatMap((group) => group.rows)
      .find((row) => row.recommendation.id === 'heart-failure-mra')

    expect(mra?.basis).toBe('MRA：目前未使用')
  })

  it('adds positive symptoms and PE findings to the loop-diuretic evidence', () => {
    const base = result()
    const withDiuretic = {
      ...base,
      recommendations: [
        ...base.recommendations,
        recommendation('heart-failure-congestion-diuretic', {
          status: 'actionable',
          overviewEvidenceFactKey: 'chestXray',
          patientEvidence: [
            evidence('CXR', 'CXR 符合 cardiomegaly、pleural-effusion', 'chestXray', '2026-07-06'),
          ],
        }),
      ],
    }
    const flow = flowFor({
      result: withDiuretic,
      phenotypeAnswer: SUSPECTED,
      clinicVitals: answeredVitals(),
    })
    const diuretic = flow.actionGroups
      .flatMap((group) => group.rows)
      .find((row) => row.recommendation.id === 'heart-failure-congestion-diuretic')

    expect(diuretic?.basis).toBe(
      '症狀：勞力性喘、疲倦、腳腫 · PE：Pitting edema · CXR 符合 cardiomegaly、pleural-effusion',
    )
    expect(diuretic?.basis).not.toContain('未評估')
  })

  it('omits the duplicate AMT umbrella and keeps HFimpEF as a clinical review', () => {
    const base = result()
    const withUmbrellaModules: CdssResult = {
      ...base,
      recommendations: [
        ...base.recommendations,
        recommendation('heart-failure-additional-medical-therapy', {
          domain: 'medication',
          status: 'review',
          title: '評估其他治療。',
        }),
        recommendation('heart-failure-hfimpEF-therapy', {
          domain: 'medication',
          status: 'review',
          title: '持續原有治療。',
        }),
      ],
    }
    const rows = flowFor({ result: withUmbrellaModules, phenotypeAnswer: SUSPECTED })
      .actionGroups.flatMap((group) => group.rows)

    expect(rows.find((row) => row.recommendation.id === 'heart-failure-additional-medical-therapy'))
      .toBeUndefined()
    expect(rows.find((row) => row.recommendation.id === 'heart-failure-hfimpEF-therapy')?.decisionKind)
      .toBe('review')
  })
})

describe('the record card', () => {
  it('lists every answered field with its own date, and nothing unanswered', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED, clinicVitals: answeredVitals() })
    const labels = flow.carriedFields.map((field) => field.label)

    expect(labels).toContain('NYHA')
    expect(labels).toContain('收縮壓')
    expect(labels).toContain('代償狀態')
    expect(flow.carriedFields.every((field) => field.date.length > 0)).toBe(true)
    // Nothing was asked about a body height this visit, so nothing is listed.
    expect(labels).not.toContain('身高')
  })

  it('writes a four-line summary in the words already on screen', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED, clinicVitals: answeredVitals() })
    const lines = flow.summaryText.split('\n')

    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('LVEF 32%')
    expect(lines[1]).toContain('NYHA：NYHA II')
    expect(lines[1]).toContain('症狀：有：勞力性喘')
    expect(lines[1]).toContain('徵象：有：Pitting edema')
    expect(lines[2]).toContain('118/72')
    expect(lines[2]).toContain('SpO₂ 97%')
    expect(lines[3]).toContain('待決定')
  })
})

describe('without a patient', () => {
  it('says so rather than offering controls that have nowhere to write', () => {
    expect(flowFor({ patientId: undefined }).readOnly).toBe(true)
    expect(flowFor().readOnly).toBe(false)
  })
})


describe('generic monitoring reminders', () => {
  it.each([
    '先查找院內近期病歷與出院計畫，再補齊病人自述與量測資料。',
    'Retrieve recent institutional notes and the discharge plan first, then complete patient-reported and measured data.',
  ])('omits the generic reminder and its decision count: %s', (reminder) => {
    const original = result()
    const filtered = flowFor({ result: {
      ...original,
      recommendations: original.recommendations.map(item => item.id === 'heart-failure-monitoring'
        ? { ...item, nextActions: [reminder], status: 'review' } : item),
    } })
    expect(filtered.actionGroups.flatMap(group => group.rows).some(row => row.recommendation.id === 'heart-failure-monitoring')).toBe(false)
    expect(filtered.decidableCount).toBe(flowFor().decidableCount - 1)
    // Concrete test/follow-up instructions remain actionable in the same view.
    expect(flowFor().actionGroups.flatMap(group => group.rows).find(row => row.recommendation.id === 'heart-failure-monitoring')?.headline)
      .toBe('抽 NT-proBNP 作為基準；1 週後追蹤 K 與腎功能。')
  })
})


describe('English chart summary independent of the Chinese interface', () => {
  it('uses English clinical labels and keeps findings, dates, doses and medication provenance', () => {
    const flow = flowFor({ phenotypeAnswer: SUSPECTED, clinicVitals: answeredVitals(), decisions: {
      'heart-failure-mra': { decision: 'dose-adjusted', reasons: [], note: '2.5 → 5 mg', recordedAt: NOW.toISOString(), packVersion: 'test' },
      'heart-failure-monitoring': { decision: 'deferred', reasons: ['patient-refused'], recordedAt: NOW.toISOString(), packVersion: 'test' },
    } })
    expect(flow.englishSummaryText).not.toMatch(/[\u3400-\u9fff]/)
    expect(flow.englishSummaryText).toContain('Heart-failure suspicion: Yes (2026/09/11 14:05)')
    expect(flow.englishSummaryText).not.toContain('Today')
    expect(flow.englishSummaryText).toContain('HFrEF')
    expect(flow.englishSummaryText).toContain('LVEF 32% (2026/07/14)')
    expect(flow.englishSummaryText).toContain('NYHA: II')
    expect(flow.englishSummaryText).toContain('118/72')
    expect(flow.englishSummaryText).toContain('SpO₂ 97%')
    expect(flow.englishSummaryText).toContain('2.5 → 5 mg')
    expect(flow.englishSummaryText).toContain('Patient declined')
    expect(flow.englishSummaryText).toContain('from current medication record')
    expect(flow.englishSummaryText).toContain('Not assessed: PND')
    expect(flow.englishSummaryText).toContain('Symptoms\n  Exertional dyspnoea (+)\n  Orthopnoea (-)')
    expect(flow.englishSummaryText).toContain('\n\nSigns\n  Rales (-)')
    expect(flow.englishSummaryText).toContain('\n\nManagement\n- ')
    expect(flow.englishSummaryText).not.toContain('PND (-)')
  })

  it('does not turn unanswered findings into normal findings or a negative diagnosis', () => {
    const text = flowFor().englishSummaryText
    expect(text).toContain('Heart-failure suspicion: Not assessed')
    expect(text).toContain('NYHA: not assessed')
    expect(text).toContain('Compensation: not assessed')
  })
})
