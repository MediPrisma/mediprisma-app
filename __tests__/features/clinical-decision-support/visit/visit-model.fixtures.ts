/**
 * Hand-written visit decision models shaped like brief §7.
 *
 * These stand in for `buildVisitDecisionModel` while the pack builds it. They
 * are not clinical fixtures: every word in them is what the pack is expected to
 * print, so the host tests can prove the host prints it — and only it — in the
 * right place. When the pack ships, `visit-model.pack.test.tsx` builds the
 * same scenarios from the real pack.
 */
import type {
  DecisionPointView,
  VisitAction,
  VisitAsk,
  VisitDecisionModel,
} from '@/features/clinical-decision-support/types'

type PointInput = Partial<DecisionPointView> & Pick<DecisionPointView, 'dp' | 'label' | 'state'>

export function point(input: PointInput): DecisionPointView {
  return {
    semanticId: input.dp.toLowerCase(),
    block: 'treatment',
    group: 'treatment',
    actions: [],
    moduleIds: [],
    source: 'hf',
    ...input,
  }
}

export function action(
  id: string,
  label: string,
  decisionKind: VisitAction['decisionKind'],
  extra: Partial<VisitAction> = {},
): VisitAction {
  return { id, label, decisionKind, ...extra }
}

const DECLINE = [
  action('defer', '暫緩', 'deferred'),
  action('contraindicated', '禁忌', 'contraindicated'),
  action('preference', '病人意願', 'patient-preference'),
]

export function hfAsks(weightPrefill?: VisitAsk['prefill']): VisitAsk[] {
  return [
    {
      id: 'dyspnoea-trend',
      label: '喘',
      options: [
        { value: 'worse', label: '變差' },
        { value: 'stable', label: '穩定' },
        { value: 'better', label: '進步' },
      ],
    },
    {
      id: 'weight-trend',
      label: '體重',
      options: [
        { value: 'up', label: '增加' },
        { value: 'same', label: '不變' },
        { value: 'down', label: '減少' },
      ],
      ...(weightPrefill ? { prefill: weightPrefill } : {}),
    },
  ]
}

export function afAsks(): VisitAsk[] {
  return [
    { id: 'af-symptoms', label: 'AF 症狀', options: [{ value: 'yes', label: '有' }, { value: 'no', label: '無' }] },
    { id: 'bleeding', label: '出血', options: [{ value: 'yes', label: '有' }, { value: 'no', label: '無' }] },
  ]
}

/** The 01 and 03 points a follow-up HF visit carries, all settled or absent. */
function hfStatusPoints(overrides: Partial<Record<string, Partial<DecisionPointView>>> = {}): DecisionPointView[] {
  return [
    point({ dp: 'DP-24', label: '今日分流', state: 'done', block: 'status', group: 'triage', why: '無急症、無出血紀錄', ...overrides['DP-24'] }),
    point({ dp: 'DP-01', label: '確診與分型', state: 'done', block: 'status', group: 'diagnosis', why: 'HFrEF · LVEF 30%（06-01）', moduleIds: ['heart-failure-phenotype'], ...overrides['DP-01'] }),
    point({ dp: 'DP-04', label: '重新評估', state: 'done', block: 'status', group: 'diagnosis', why: '觸發條件都沒出現', ...overrides['DP-04'] }),
    point({ dp: 'DP-00', label: '是否懷疑 HF', state: 'done', block: 'status', group: 'diagnosis', ...overrides['DP-00'] }),
    point({ dp: 'DP-34', label: 'HFpEF 證實', state: 'not-applicable', block: 'status', group: 'diagnosis', why: 'LVEF <50%', ...overrides['DP-34'] }),
    point({ dp: 'DP-02', label: '基線評估', state: 'not-applicable', block: 'status', group: 'diagnosis', ...overrides['DP-02'] }),
    point({ dp: 'DP-29', label: '病因', state: 'not-included', block: 'status', group: 'diagnosis', ...overrides['DP-29'] }),
    point({ dp: 'DP-30', label: '缺血與瓣膜', state: 'not-included', block: 'status', group: 'diagnosis', ...overrides['DP-30'] }),
  ]
}

function hfOutlookPoints(): DecisionPointView[] {
  return [
    point({ dp: 'DP-17', label: '監測排程', state: 'info', block: 'outlook', group: 'plan' }),
    point({ dp: 'DP-18', label: '回診間隔', state: 'info', block: 'outlook', group: 'plan' }),
    point({ dp: 'DP-16', label: '裝置候選', state: 'not-included', block: 'outlook', group: 'devices' }),
    point({ dp: 'DP-19', label: '進階 HF 轉介', state: 'not-included', block: 'outlook', group: 'devices' }),
  ]
}

const DONE_PILLARS = {
  ras: point({ dp: 'DP-07', label: 'RAS 抑制', state: 'done', why: 'sacubitril/valsartan 97/103 mg bid（目標）', moduleIds: ['heart-failure-ras'], chain: [{ id: 'whether', state: 'done', text: 'HFrEF → 需要' }, { id: 'which', state: 'done', text: 'ARNI' }, { id: 'dose', state: 'done', text: '97/103 mg bid' }] }),
  bb: point({ dp: 'DP-08', label: 'β 阻斷劑', state: 'done', why: 'bisoprolol 10 mg（目標）', moduleIds: ['heart-failure-beta-blocker'] }),
  mra: point({ dp: 'DP-09', label: 'MRA', state: 'done', why: 'spironolactone 25 mg', moduleIds: ['heart-failure-mra'] }),
  sglt2: point({ dp: 'DP-10', label: 'SGLT2i', state: 'done', why: 'dapagliflozin 10 mg', moduleIds: ['heart-failure-sglt2'] }),
}

/** P4 · HFrEF stable and optimised: nothing to decide. */
export function p4Model(): VisitDecisionModel {
  return {
    packId: 'heart-failure-cdss',
    stage: 'follow-up',
    triggers: [],
    headline: 'HFrEF · 四支柱都在目標劑量，今天沒有要改的藥',
    keyValues: [
      { key: 'LVEF', label: 'LVEF', value: '32%', date: '2026-03-02' },
      { key: 'bodyWeight', label: '體重', value: '74 kg', date: '2026-09-27', trend: 'flat' },
    ],
    asks: hfAsks({ value: 'same', basis: '紀錄：74→74 kg（08-20→09-27）' }),
    queue: [],
    points: [
      ...hfStatusPoints(),
      DONE_PILLARS.ras, DONE_PILLARS.bb, DONE_PILLARS.mra, DONE_PILLARS.sglt2,
      point({ dp: 'DP-06', label: '鬱血與利尿劑', state: 'done', headline: '維持目前利尿劑', moduleIds: ['heart-failure-congestion-diuretic'] }),
      point({ dp: 'DP-11', label: '安全例外', state: 'done', why: 'K、SBP、HR、eGFR 都在範圍內' }),
      point({ dp: 'DP-26', label: '暫停與重啟', state: 'not-included' }),
      ...hfOutlookPoints(),
    ],
    coverage: { total: 37, included: 25 },
  }
}

/** P5 · HFrEF titrating, with AF on apixaban. */
export function p5Model(): VisitDecisionModel {
  return {
    packId: 'heart-failure-cdss',
    stage: 'follow-up',
    triggers: [],
    headline: 'HFrEF（LVEF 30%，2026-06-01）· 追蹤期 · 併 AF',
    keyValues: [
      { key: 'LVEF', label: 'LVEF', value: '30%', date: '2026-06-01' },
      { key: 'potassium', label: 'K', value: '4.6', date: '2026-09-10' },
      { key: 'eGFR', label: 'eGFR', value: '48', date: '2026-09-10', trend: 'down' },
    ],
    asks: hfAsks({ value: 'same', basis: '紀錄：70→70 kg（08-20→09-27）' }),
    queue: ['DP-07', 'DP-09', 'DP-10'],
    points: [
      ...hfStatusPoints(),
      point({
        dp: 'DP-07', label: 'RAS 抑制', state: 'act', group: 'pillars',
        headline: 'ramipril → 換 ARNI？', why: 'LVEF 30%、ACEi 中；SBP 112、K 4.6、eGFR 48',
        chain: [{ id: 'whether', state: 'done', text: 'HFrEF → 需要' }, { id: 'which', state: 'current', text: 'ramipril（ACEi）→ ARNI 優先' }, { id: 'dose', state: 'later', text: '換藥後重新起算' }],
        actions: [
          action('switch-arni', '換 ARNI', 'prescribed', { primary: true, responseCheck: { text: 'K、Cr、血壓', interval: '1–2 週' } }),
          action('keep-acei', '維持 ACEi', 'reviewed'),
          ...DECLINE,
        ],
        moduleIds: ['heart-failure-ras'],
      }),
      point({
        dp: 'DP-08', label: 'β 阻斷劑', state: 'confirm', group: 'pillars',
        headline: 'bisoprolol 2.5 mg／目標 10 mg', why: 'HR 82、SBP 112',
        chain: [{ id: 'whether', state: 'done', text: 'HFrEF → 需要' }, { id: 'which', state: 'done', text: 'bisoprolol' }, { id: 'dose', state: 'current', text: '2.5 mg／目標 10 mg' }],
        actions: [
          action('uptitrate-bb', '上調至 5 mg', 'dose-adjusted', { primary: true, responseCheck: { text: '心率、血壓' } }),
          action('bb-max-tolerated', '已達耐受上限', 'at-max-tolerated', { reopenWhen: 'HR <50、SBP 明顯下降或新的 HF 住院' }),
        ],
        moduleIds: ['heart-failure-beta-blocker'],
      }),
      point({
        dp: 'DP-09', label: 'MRA', state: 'act', group: 'pillars',
        headline: '開始 MRA？', why: 'K 4.6（<5.0）、eGFR 48（>30）',
        chain: [{ id: 'whether', state: 'current', text: '未使用 · 可開始' }, { id: 'which', state: 'later', text: 'spironolactone／eplerenone' }, { id: 'dose', state: 'later', text: '起始後依 K、Cr 調整' }],
        actions: [
          action('start-mra', '開始 MRA', 'prescribed', { primary: true, responseCheck: { text: 'K、Cr、血壓', interval: '1–2 週' } }),
          ...DECLINE,
        ],
        moduleIds: ['heart-failure-mra'],
      }),
      point({
        dp: 'DP-10', label: 'SGLT2i', state: 'act', group: 'pillars',
        headline: '開始 SGLT2i？', why: 'eGFR 48（≥20），沒有第 1 型糖尿病紀錄',
        actions: [action('start-sglt2', '開始 SGLT2i', 'prescribed', { primary: true }), ...DECLINE],
        moduleIds: ['heart-failure-sglt2'],
      }),
      point({ dp: 'DP-06', label: '鬱血與利尿劑', state: 'done', group: 'congestion', headline: '維持目前利尿劑', moduleIds: ['heart-failure-congestion-diuretic'] }),
      point({ dp: 'DP-14', label: 'AF 抗凝', state: 'done', group: 'af', source: 'af', why: 'apixaban 5 mg bid · 減量條件 0/3', moduleIds: ['af-anticoagulation'], chain: [{ id: 'whether', state: 'done', text: '已抗凝' }, { id: 'which', state: 'done', text: 'DOAC' }, { id: 'dose', state: 'done', text: '5 mg bid' }] }),
      point({ dp: 'DP-28', label: 'AF 心率節律', state: 'done', group: 'af', source: 'af', why: 'HR 82' }),
      point({ dp: 'DP-15', label: '心臟復健', state: 'info', group: 'care', moduleIds: ['cardiac-rehabilitation'] }),
      point({ dp: 'DP-26', label: '暫停與重啟', state: 'not-included', group: 'pillars' }),
      point({ dp: 'DP-13', label: '其他藥物', state: 'not-applicable', group: 'pillars', why: 'FMT 尚未補齊' }),
      ...hfOutlookPoints(),
    ],
    coverage: { total: 37, included: 25 },
  }
}

/** P6 · HFrEF with potassium 5.7 on an MRA. */
export function p6Model(): VisitDecisionModel {
  return {
    ...p4Model(),
    headline: 'HFrEF · K 5.7（09-24）· 今天有 1 件安全處置',
    keyValues: [{ key: 'potassium', label: 'K', value: '5.7', date: '2026-09-24', trend: 'up' }],
    asks: hfAsks({ value: 'same', basis: '紀錄：80→80 kg（08-20→09-27）' }),
    queue: ['DP-09'],
    points: [
      ...hfStatusPoints(),
      point({ dp: 'DP-07', label: 'RAS 抑制', state: 'info', group: 'pillars', why: 'K ≥5.0：不上調', moduleIds: ['heart-failure-ras'] }),
      DONE_PILLARS.bb,
      point({
        dp: 'DP-09', label: 'MRA', state: 'safety', group: 'pillars',
        headline: 'K 5.7 → 暫停 MRA？', why: 'K 5.7（09-24）>5.5；eGFR 45→38',
        actions: [
          action('hold-mra', '暫停 MRA', 'held', { primary: true, responseCheck: { text: 'K、Cr' }, reopenWhen: 'K 回到 <5.0 時重新開始' }),
          action('halve-mra', '減半劑量', 'dose-adjusted', { responseCheck: { text: 'K、Cr' } }),
          action('keep-mra', '維持（已複驗正常）', 'reviewed'),
        ],
        moduleIds: ['heart-failure-mra-safety'],
      }),
      DONE_PILLARS.sglt2,
      ...hfOutlookPoints(),
    ],
  }
}

/** P7 · HFrEF with worsening congestion. */
export function p7Model(): VisitDecisionModel {
  return {
    ...p4Model(),
    stage: 'reassess',
    triggers: [{ id: 'ntProBnpTrend', text: 'NT-proBNP 1200→2600（08-20→09-24）' }],
    headline: 'HFrEF · 重新評估：鬱血惡化',
    keyValues: [
      { key: 'ntProBnp', label: 'NT-proBNP', value: '2600', date: '2026-09-24', trend: 'up' },
      { key: 'bodyWeight', label: '體重', value: '68 kg', date: '2026-09-27', trend: 'up' },
    ],
    asks: hfAsks({ value: 'up', basis: '紀錄：65→68 kg（08-20→09-27）' }),
    queue: ['DP-06'],
    points: [
      ...hfStatusPoints({ 'DP-04': { state: 'confirm', headline: '找誘因', why: 'NT-proBNP 1200→2600', actions: [action('look-for-trigger', '找誘因', 'reviewed', { primary: true })] } }),
      DONE_PILLARS.ras, DONE_PILLARS.bb, DONE_PILLARS.mra, DONE_PILLARS.sglt2,
      point({
        dp: 'DP-06', label: '鬱血與利尿劑', state: 'act', group: 'congestion',
        headline: '利尿劑加量？', why: '體重 65→68 kg、NT-proBNP 1200→2600',
        actions: [
          action('increase-diuretic', '利尿劑加量', 'dose-adjusted', { primary: true, responseCheck: { text: '體重、K、Cr', interval: '1–2 週' } }),
          action('keep-diuretic', '維持', 'reviewed'),
          action('trigger-first', '先查誘因', 'reviewed'),
          action('defer-diuretic', '暫緩', 'deferred'),
        ],
        moduleIds: ['heart-failure-congestion-diuretic'],
      }),
      ...hfOutlookPoints(),
    ],
  }
}

/** P9 · HFpEF with AF; apixaban due for dose reduction. */
export function p9Model(): VisitDecisionModel {
  return {
    ...p4Model(),
    headline: 'HFpEF（LVEF 58%）· 追蹤期 · 併 AF',
    asks: hfAsks({ value: 'down', basis: '紀錄：61→58 kg（08-20→09-27）' }),
    queue: ['DP-14', 'DP-09'],
    points: [
      ...hfStatusPoints({ 'DP-34': { state: 'done', why: '已記錄的 HFpEF' } }),
      point({
        dp: 'DP-14', label: 'AF 抗凝', state: 'act', group: 'af', source: 'af',
        headline: 'apixaban 5 → 2.5 mg bid？', why: '年齡 80、體重 58：減量條件 2/3',
        actions: [
          action('reduce-apixaban', '減為 2.5 mg bid', 'dose-adjusted', { primary: true, responseCheck: { text: 'Hb、Cr' } }),
          action('keep-apixaban', '維持 5 mg bid', 'reviewed'),
        ],
        moduleIds: ['af-doac-renal-dose-check'],
      }),
      point({
        dp: 'DP-09', label: 'MRA', state: 'act', group: 'pillars',
        headline: '開始 MRA？', why: 'K 4.4、eGFR 40',
        actions: [action('start-mra', '開始 MRA', 'prescribed', { primary: true, responseCheck: { text: 'K、Cr、血壓', interval: '1–2 週' } }), ...DECLINE],
        moduleIds: ['heart-failure-mra'],
      }),
      point({
        dp: 'DP-06', label: '鬱血與利尿劑', state: 'confirm', group: 'congestion',
        headline: '體重減少 3 kg → 利尿劑是否減量？', why: '61→58 kg',
        actions: [
          action('reduce-diuretic', '利尿劑減量', 'dose-adjusted', { primary: true, responseCheck: { text: '體重、K、Cr', interval: '1–2 週' } }),
          action('keep-diuretic', '維持', 'reviewed'),
        ],
        moduleIds: ['heart-failure-congestion-diuretic'],
      }),
      ...hfOutlookPoints(),
    ],
  }
}

/** P3 · new AF, AF page. `symptoms` rebuilds the model after the ask is answered. */
export function p3Model({ symptoms }: { symptoms?: 'yes' | 'no' } = {}): VisitDecisionModel {
  const rhythm = symptoms === 'yes'
    ? point({
      dp: 'DP-18', label: '節律策略', state: 'act', group: 'R', source: 'af',
      headline: '有症狀 → 討論節律控制？', why: '本次回答：AF 症狀 有',
      actions: [action('discuss-rhythm', '討論節律控制', 'reviewed', { primary: true }), action('rate-only', '心率控制即可', 'reviewed')],
    })
    : point({ dp: 'DP-18', label: '節律策略', state: symptoms === 'no' ? 'done' : 'ask', group: 'R', source: 'af', headline: symptoms === 'no' ? '心率控制即可' : undefined })
  return {
    packId: 'atrial-fibrillation-cdss',
    stage: 'baseline',
    triggers: [],
    headline: '新發 AF · CHA₂DS₂-VA 4 · 尚未抗凝',
    keyValues: [
      { key: 'bloodPressure', label: '血壓', value: '138/84', date: '2026-09-27' },
      { key: 'eGFR', label: 'eGFR', value: '62', date: '2026-09-20' },
    ],
    asks: afAsks(),
    queue: symptoms === 'yes' ? ['DP-07', 'DP-18'] : ['DP-07'],
    points: [
      point({ dp: 'DP-00', label: '今日分流', state: 'done', block: 'status', group: '⓪', source: 'af' }),
      point({ dp: 'DP-04', label: 'AF 篩檢', state: 'done', block: 'status', group: '①', source: 'af', why: 'AF 已確立' }),
      point({
        dp: 'DP-07', label: '要不要抗凝', state: 'act', group: 'A', source: 'af',
        headline: 'CHA₂DS₂-VA 4 → 開始抗凝？', why: '年齡 78、高血壓、糖尿病、女性不計分',
        chain: [{ id: 'whether', state: 'current', text: 'CHA₂DS₂-VA 4' }, { id: 'which', state: 'later', text: 'DOAC' }, { id: 'dose', state: 'later', text: '依減量條件' }],
        actions: [
          action('start-oac', '開始抗凝', 'prescribed', { primary: true, responseCheck: { text: 'Hb、Cr' } }),
          action('defer-oac', '暫緩', 'deferred'),
          action('preference-oac', '病人意願', 'patient-preference'),
        ],
        moduleIds: ['af-anticoagulation'],
      }),
      point({ dp: 'DP-08', label: '哪一種抗凝', state: 'waiting', group: 'A', source: 'af', why: '無機械瓣、無中重度 MS → DOAC' }),
      point({
        dp: 'DP-09', label: '抗凝劑量', state: 'waiting', group: 'A', source: 'af',
        headline: 'apixaban 5 mg bid', why: '減量條件 0/3（年齡 78、體重 62、Cr 0.9）',
        actions: [
          action('apixaban-5', 'apixaban 5 mg bid', 'prescribed', { primary: true, responseCheck: { text: 'Hb、Cr' } }),
          action('other-doac', '其他 DOAC', 'reviewed'),
        ],
        moduleIds: ['af-doac-renal-dose-check'],
      }),
      point({
        dp: 'DP-13', label: '血壓', state: 'confirm', group: 'A', source: 'af',
        headline: '血壓 138/84 → 出血因子？', why: 'SBP 138（09-27）',
        actions: [action('bp-reviewed', '已處理', 'reviewed', { primary: true })],
      }),
      rhythm,
      point({ dp: 'DP-22', label: 'CHA₂DS₂-VA', state: 'info', block: 'outlook', group: 'E', source: 'af', why: '4 分' }),
      point({ dp: 'DP-24', label: '回診與檢驗', state: 'info', block: 'outlook', group: 'E', source: 'af' }),
    ],
    coverage: { total: 25, included: 18 },
  }
}

/** P2 · newly diagnosed HFrEF: baseline, up to five rows. */
export function p2Model(): VisitDecisionModel {
  const start = (dp: string, label: string, headline: string, id: string, button: string, check?: VisitAction['responseCheck']) => point({
    dp, label, state: 'act', group: 'pillars', headline,
    chain: [{ id: 'whether', state: 'current', text: '未使用' }, { id: 'which', state: 'later', text: '' }, { id: 'dose', state: 'later', text: '' }],
    actions: [action(id, button, 'prescribed', { primary: true, ...(check ? { responseCheck: check } : {}) }), ...DECLINE],
  })
  return {
    packId: 'heart-failure-cdss',
    stage: 'baseline',
    triggers: [],
    headline: '新診斷 HFrEF（LVEF 28%，09-12）',
    keyValues: [{ key: 'LVEF', label: 'LVEF', value: '28%', date: '2026-09-12' }],
    asks: hfAsks(),
    queue: ['DP-08', 'DP-07', 'DP-09', 'DP-10'],
    points: [
      point({ dp: 'DP-02', label: '基線評估', state: 'info', block: 'status', group: 'baseline', why: '紀錄缺 ferritin、TSAT、TSH、HbA1c' }),
      point({ dp: 'DP-01', label: '確診與分型', state: 'done', block: 'status', group: 'diagnosis', why: 'HFrEF · LVEF 28%' }),
      point({ dp: 'DP-29', label: '病因', state: 'not-included', block: 'status', group: 'diagnosis' }),
      start('DP-08', 'β 阻斷劑', '開始 β 阻斷劑（bisoprolol 1.25 mg）？', 'start-bb', '開始 β 阻斷劑', { text: '心率、血壓' }),
      start('DP-07', 'RAS 抑制', '開始 ARNI？', 'start-arni', '開始 ARNI', { text: 'K、Cr、血壓', interval: '1–2 週' }),
      start('DP-09', 'MRA', '開始 MRA？', 'start-mra', '開始 MRA', { text: 'K、Cr、血壓', interval: '1–2 週' }),
      start('DP-10', 'SGLT2i', '開始 SGLT2i？', 'start-sglt2', '開始 SGLT2i'),
      ...hfOutlookPoints(),
    ],
    coverage: { total: 37, included: 25 },
  }
}

/** P1 · suspected HFpEF: only 01 works. */
export function p1Model(): VisitDecisionModel {
  return {
    packId: 'heart-failure-cdss',
    stage: 'suspected',
    triggers: [],
    headline: '疑似 HF：NT-proBNP 680、LVEF 62%，沒有 HF 診斷碼',
    keyValues: [
      { key: 'ntProBnp', label: 'NT-proBNP', value: '680', date: '2026-09-20' },
      { key: 'LVEF', label: 'LVEF', value: '62%', date: '2026-09-20' },
    ],
    asks: hfAsks(),
    queue: ['DP-00'],
    points: [
      point({
        dp: 'DP-00', label: '是否懷疑 HF', state: 'act', block: 'status', group: 'diagnosis',
        headline: '懷疑 HF？', why: 'NT-proBNP 680（≥125）、勞力性喘',
        actions: [action('suspect-hf', '是', 'reviewed', { primary: true }), action('not-hf', '否', 'reviewed')],
        moduleIds: ['heart-failure-phenotype'],
      }),
      point({ dp: 'DP-34', label: 'HFpEF 證據', state: 'waiting', block: 'status', group: 'diagnosis', why: 'H₂FPEF 缺 2 項輸入', moduleIds: ['heart-failure-hfpef-diagnosis'] }),
      point({ dp: 'DP-10', label: 'SGLT2i', state: 'not-applicable', group: 'pillars' }),
      point({ dp: 'DP-06', label: '鬱血與利尿劑', state: 'not-applicable', group: 'congestion' }),
      ...hfOutlookPoints(),
    ],
    coverage: { total: 37, included: 25 },
  }
}
