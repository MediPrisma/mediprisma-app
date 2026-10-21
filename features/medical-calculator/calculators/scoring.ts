import type { L } from '../types'

/**
 * Optional "計算說明 / Scoring" breakdown for point-based calculators — the
 * per-factor points table + the score→outcome mapping, shown in a collapsible
 * section of the detail view. Kept separate (like CALC_TAGS / CALC_INFO) so the
 * formula defs stay lean, and only authored where the points aren't already
 * visible in the inputs (e.g. banded numeric factors like age/ALT in the HCC
 * score). `points` / `score` / `outcome` strings are language-neutral.
 */
export interface ScoringFactor {
  label: L
  options: { label: L; points: string }[]
}

/** KDIGO-style heat-map colour bands (green → deep red). */
export type GridColor = 'green' | 'yellow' | 'orange' | 'red' | 'deepred'

/** A 2-D colour-coded matrix (e.g. the KDIGO GFR × albuminuria heat map),
 *  rendered as a coloured table in the 計算說明 section. */
export interface ScoringGrid {
  caption?: L
  /** Title over the columns (e.g. 持續白蛋白尿的分期). */
  colAxis?: L
  /** Title beside the rows (e.g. GFR 分期). Shown in the top-left corner. */
  rowAxis?: L
  /** Column headers: a short label + optional sub-label. */
  cols: { label: L; sub?: L }[]
  /** Extra labelled header rows under the column headers (e.g. ACR / PCR ranges).
   *  `cells` are language-neutral strings, one per column. */
  colSubRows?: { label: L; cells: string[] }[]
  /** Row headers: a short label + optional sub-label. */
  rows: { label: L; sub?: L }[]
  /** cells[rowIndex][colIndex] — the coloured body cells. */
  cells: { text: L; color: GridColor }[][]
  /** Legend / explanation under the grid. */
  legend?: L
}

export interface CalcScoring {
  /** For formula-based calculators — the equation, shown in a mono box.
   *  (Score-based calculators use `factors` instead / as well.) */
  formula?: L
  /** Optional colour-coded matrix (e.g. the KDIGO heat map). */
  grid?: ScoringGrid
  /** For score-based calculators — each risk factor and the points for each of
   *  its levels. Omit for pure-formula calculators. */
  factors?: ScoringFactor[]
  /** Total-score (or computed-value) → outcome table. Doubles as the
   *  interpretation-threshold table for formula calculators (e.g. eGFR → CKD
   *  stage). `scoreHeader`/`outcomeHeader` name the two columns. */
  outcome?: {
    scoreHeader: L
    outcomeHeader: L
    /** `score` is a language-neutral range/value (e.g. "≥ 90", "5–9");
     *  `outcome` is bilingual (stage / risk category / percentage). */
    rows: { score: string; outcome: L }[]
  }
  /** Optional note under the table. */
  note?: L
}

export const CALC_SCORING: Record<string, CalcScoring> = {
  'hpa-chronic-risk-reconstruction': {
    formula: { en: 'Approximation: risk (%) ≈ 100 × [1 − exp(−exp(β₀ + Σβᵢxᵢ))]. Separate sex-specific fits for each of five outcomes; not the published official coefficients.', zh: '近似式：風險（%）≈ 100 × [1 − exp(−exp(β₀ + Σβᵢxᵢ))]。五項結果各依性別重建；β 不是官方公布係數。' },
    note: { en: 'The attached 2022 IJERPH paper has CHD, stroke and MACE coefficients, but omits the other two diseases and does not specify all baseline survival terms; its MACE predictors differ from the current public V4 form. See the reconstruction note for the holdout audit.', zh: '所附 2022 年論文有冠心病、中風及 MACE 係數，但沒有另外兩病及全部基準存活率；MACE 變項也與目前公開 V4 表單不同。留出樣本驗算見重建說明。' },
  },
  'prevent-ascvd': {
    formula: { zh: 'ASCVD 風險 (%) = 100 / (1 + exp(−Σ βᵢxᵢ))。使用性別與預測年期專屬係數、年齡／血脂／血壓／eGFR 轉換及交互作用；不是簡單加點量表。', en: 'ASCVD risk (%) = 100 / (1 + exp(−Σ βᵢxᵢ)). Sex- and horizon-specific coefficients with transformed age, lipids, BP, eGFR and interactions; not a point score.' },
    note: { zh: 'ASCVD 與 total CVD／HF 是不同模型。本計算機僅計算 ASCVD 基礎模型；ACC/AHA 治療分層請見高血脂照護指引。', en: 'ASCVD, total CVD and HF are distinct models. This calculator implements base ASCVD only; see dyslipidemia guidance for ACC/AHA treatment stratification.' },
  },
  'h2fpef': {
    formula: { en: 'Score = 2×(BMI >30) + (≥2 antihypertensives) + 3×AF + (PASP >35) + (age >60) + (E/e′ >9).', zh: '分數 = 2×(BMI >30) + (≥2 種降壓藥) + 3×AF + (PASP >35) + (年齡 >60) + (E/e′ >9)。' },
    note: { en: 'Each condition is 1 when present, 0 when absent. Point score: 0–1 low, 2–5 intermediate, 6–9 high probability.', zh: '各條件成立為 1、不成立為 0。加總分數：0–1 低、2–5 中間、6–9 高可能性。' },
  },
  'hfa-peff': {
    factors: [
      { label: { en: 'Functional', zh: '功能領域' }, options: [
        { points: '2', label: { en: 'Septal e′ <7 or lateral e′ <10 cm/s (age ≥75: <5 / <7); average E/e′ ≥15; or TR Vmax >2.8 m/s', zh: 'Septal e′ <7 或 lateral e′ <10 cm/s（≥75 歲：<5／<7）；平均 E/e′ ≥15；或 TR Vmax >2.8 m/s' } },
        { points: '1', label: { en: 'Average E/e′ ≥9 and <15, or absolute GLS <16%', zh: '平均 E/e′ ≥9 且 <15，或 GLS 絕對值 <16%' } },
      ] },
      { label: { en: 'Morphological', zh: '結構領域' }, options: [
        { points: '2', label: { en: 'LAVI >34 (AF >40); or LVMI ≥149 in men / ≥122 in women with RWT >0.42', zh: 'LAVI >34（AF >40）；或 LVMI 男 ≥149／女 ≥122，且 RWT >0.42' } },
        { points: '1', label: { en: 'LAVI 29–34 (AF 34–40); LVMI men ≥115 / women ≥95; RWT >0.42; or LV wall ≥12 mm', zh: 'LAVI 29–34（AF 34–40）；LVMI 男 ≥115／女 ≥95；RWT >0.42；或 LV 壁厚 ≥12 mm' } },
      ] },
      { label: { en: 'Biomarker (pg/mL)', zh: '生物標記（pg/mL）' }, options: [
        { points: '2', label: { en: 'NT-proBNP >220 (AF >660), or BNP >80 (AF >240)', zh: 'NT-proBNP >220（AF >660），或 BNP >80（AF >240）' } },
        { points: '1', label: { en: 'NT-proBNP 125–220 (AF 365–660), or BNP 35–80 (AF 105–240)', zh: 'NT-proBNP 125–220（AF 365–660），或 BNP 35–80（AF 105–240）' } },
      ] },
    ],
    note: { en: 'Maximum 2 points per domain. 0–1: unlikely; 2–4: functional testing; 5–6: supports HFpEF. Missing measurements yield a conservative range, not a validated complete score. The published E/e′ 9–14 band is implemented as 9 ≤ E/e′ <15 for decimal values.', zh: '每領域取最高分，最多 2 分。0–1：可能性低；2–4：功能性檢查；5–6：支持 HFpEF。缺值顯示保守範圍，並非已驗證的完整分數。文獻 E/e′ 9–14 區間以 9 ≤ E/e′ <15 處理小數。' },
  },
  'maggic-hf': {
    formula: {
      en: 'MAGGIC score = LVEF points + age×LVEF points + SBP×LVEF points + BMI points + creatinine points + NYHA points + male (1) + current smoker (1) + diabetes (3) + COPD (2) + HF duration ≥18 months (2) + no beta-blocker (3) + no ACEI/ARB (1).',
      zh: 'MAGGIC 總分 = LVEF 分數 + 年齡×LVEF 分數 + 收縮壓×LVEF 分數 + BMI 分數 + 肌酸酐分數 + NYHA 分數 + 男性（1）+ 目前吸菸（1）+ 糖尿病（3）+ COPD（2）+ 心衰病程 ≥18 個月（2）+ 未用 β 阻斷劑（3）+ 未用 ACEI/ARB（1）。',
    },
    note: {
      en: 'Age and systolic-BP points interact with LVEF; creatinine is converted to µmol/L for the published bands. One- and three-year all-cause mortality are looked up directly from Pocock 2013 Table 4 for scores 0–50, without interpolation, extrapolation or capping.',
      zh: '年齡與收縮壓分數會依 LVEF 層級而變；肌酸酐先換算為 µmol/L 套用原始分層。1 年與 3 年全因死亡率直接查 Pocock 2013 Table 4（0–50 分），不內插、不外推，也不截斷高分。',
    },
  },
  'life-preserved': {
    formula: {
      en: 'For each 3-month age interval: S(HF/CV) = S₀(HF/CV)^exp(LP(HF/CV)); S(non-CV) = S₀(non-CV)^exp(LP(non-CV)); cumulative HF hospitalization/CV-death risk adds prior event-free survival × [1 − S(HF/CV)].',
      zh: '每個 3 個月年齡區間：S（心衰住院／心血管死亡）= S₀^exp（相對風險線性預測值）；S（非心血管死亡）= S₀^exp（相對風險線性預測值）；心衰住院／心血管死亡累積風險逐期加上「前一期無事件存活率 ×［1 − 該期原因別存活率］」。',
    },
    note: {
      en: 'Uses the published sex-specific coefficients and 200 age-specific quarterly baseline survivals (ages 40.00–89.75) from Supplementary Tables S7–S8. Predictors are age, sex, diabetes, smoking, prior/recent HF hospitalization, COPD, AF, NYHA III/IV, ischemic heart disease, NT-proBNP, BMI, heart rate, hemoglobin and eGFR. Eligibility requires no documented LVEF <50%. Non-CV death is a competing event; recent HF hospitalization modifies only the first four intervals. Values outside the author calculator’s displayed ranges are not extrapolated.',
      zh: '採補充資料 Tables S7–S8 公布的性別專屬係數，以及 40.00–89.75 歲共 200 個年齡別季度基準存活率。預測因子含年齡、性別、糖尿病、吸菸、既往／近期心衰住院、COPD、AF、NYHA III/IV、缺血性心臟病、NT-proBNP、BMI、心率、血色素與 eGFR；適用者不得有任何 LVEF <50% 的既往紀錄。非心血管死亡以競爭事件處理；近期心衰住院只修正最初四個季度。超出作者計算機顯示範圍的值不予外推。',
    },
  },
  // Liver-cancer (HCC) risk — transcribed from the NHI 健保存摺 計算說明 table.
  'hcc-risk-reveal': {
    factors: [
      {
        label: { en: 'Sex', zh: '性別' },
        options: [
          { label: { en: 'Female', zh: '女性' }, points: '0' },
          { label: { en: 'Male', zh: '男性' }, points: '2' },
        ],
      },
      {
        label: { en: 'Age', zh: '年齡' },
        options: [
          { label: { en: '0–34 y', zh: '0~34歲' }, points: '0' },
          { label: { en: '35–39 y', zh: '35~39歲' }, points: '1' },
          { label: { en: '40–44 y', zh: '40~44歲' }, points: '2' },
          { label: { en: '45–49 y', zh: '45~49歲' }, points: '3' },
          { label: { en: '50–54 y', zh: '50~54歲' }, points: '4' },
          { label: { en: '55–59 y', zh: '55~59歲' }, points: '5' },
          { label: { en: '≥ 60 y', zh: '60歲以上' }, points: '6' },
        ],
      },
      {
        label: { en: 'S-GPT / ALT', zh: 'S-GPT / ALT' },
        options: [
          { label: { en: '< 15', zh: '＜15' }, points: '0' },
          { label: { en: '15–44', zh: '15~44' }, points: '1' },
          { label: { en: '≥ 45', zh: '≧45' }, points: '3' },
        ],
      },
      {
        label: { en: 'Hepatitis B e antigen (HBeAg)', zh: 'B型肝炎e抗原 (HBeAg)' },
        options: [
          { label: { en: 'Negative', zh: '陰性反應 −' }, points: '0' },
          { label: { en: 'Positive', zh: '陽性反應 +' }, points: '4' },
        ],
      },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '風險分數' },
      outcomeHeader: { en: '10-year HCC risk', zh: '未來10年肝癌發生機率' },
      rows: [
        { score: '≤ 4', outcome: { en: '< 1%', zh: '< 1%' } },
        { score: '5–9', outcome: { en: '1%–10%', zh: '1%–10%' } },
        { score: '10–12', outcome: { en: '10%–25%', zh: '10%–25%' } },
        { score: '13–14', outcome: { en: '30%–50%', zh: '30%–50%' } },
        { score: '15', outcome: { en: '65%', zh: '65%' } },
      ],
    },
    note: {
      en: 'Source: NHI 健保存摺 (simplified REACH-B, without serum HBV DNA). Applies to chronic hepatitis B only.',
      zh: '資料來源：健保存摺（簡化版 REACH-B，未納入血清 HBV DNA）。僅適用於慢性B型肝炎。',
    },
  },
  'egfr-ckd-epi-2021': {
    formula: {
      en: 'eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^−1.200 × 0.9938^age × (1.012 if female)  ·  κ = 0.7 (F) / 0.9 (M);  α = −0.241 (F) / −0.302 (M)',
      zh: 'eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^−1.200 × 0.9938^年齡 ×（女性再乘 1.012）  ·  κ = 0.7（女）/ 0.9（男）；α = −0.241（女）/ −0.302（男）',
    },
    outcome: {
      scoreHeader: { en: 'eGFR (mL/min/1.73m²)', zh: 'eGFR (mL/min/1.73m²)' },
      outcomeHeader: { en: 'CKD stage', zh: 'CKD 分期' },
      rows: [
        { score: '≥ 90', outcome: { en: 'G1 — normal/high', zh: 'G1 — 正常或偏高' } },
        { score: '60–89', outcome: { en: 'G2 — mildly decreased', zh: 'G2 — 輕度下降' } },
        { score: '45–59', outcome: { en: 'G3a — mild–moderate', zh: 'G3a — 輕中度下降' } },
        { score: '30–44', outcome: { en: 'G3b — moderate–severe', zh: 'G3b — 中重度下降' } },
        { score: '15–29', outcome: { en: 'G4 — severely decreased', zh: 'G4 — 重度下降' } },
        { score: '< 15', outcome: { en: 'G5 — kidney failure', zh: 'G5 — 腎衰竭' } },
      ],
    },
    note: {
      en: 'Scr in mg/dL. CKD-EPI creatinine 2021, no race coefficient (Inker LA, et al. NEJM 2021).',
      zh: 'Scr 單位 mg/dL。CKD-EPI 2021 肌酸酐公式，不含種族係數（Inker LA 等，NEJM 2021）。',
    },
  },
  'egfr-mdrd': {
    formula: {
      en: 'eGFR = 175 × Scr^−1.154 × age^−0.203 × (0.742 if female)',
      zh: 'eGFR = 175 × Scr^−1.154 × 年齡^−0.203 ×（女性再乘 0.742）',
    },
    outcome: {
      scoreHeader: { en: 'eGFR (mL/min/1.73m²)', zh: 'eGFR (mL/min/1.73m²)' },
      outcomeHeader: { en: 'CKD stage', zh: 'CKD 分期' },
      rows: [
        { score: '≥ 90', outcome: { en: 'G1 — normal/high', zh: 'G1 — 正常或偏高' } },
        { score: '60–89', outcome: { en: 'G2 — mildly decreased', zh: 'G2 — 輕度下降' } },
        { score: '30–59', outcome: { en: 'G3 — moderately decreased', zh: 'G3 — 中度下降' } },
        { score: '15–29', outcome: { en: 'G4 — severely decreased', zh: 'G4 — 重度下降' } },
        { score: '< 15', outcome: { en: 'G5 — kidney failure', zh: 'G5 — 腎衰竭' } },
      ],
    },
    note: {
      en: 'Scr in mg/dL. 4-variable MDRD (IDMS-traceable), race coefficient omitted.',
      zh: 'Scr 單位 mg/dL。四變數 MDRD（IDMS 可追溯），省略種族係數。',
    },
  },
  'doac-dose-nvaf': {
    formula: {
      en: 'CrCl by Cockcroft–Gault (actual weight), compared unrounded. NVAF: apixaban 2.5 mg bid if ≥2 of age ≥80, weight ≤60 kg, Cr ≥1.5, or CrCl 15–29; rivaroxaban 15 mg qd at CrCl 15–49; edoxaban 30 mg qd if any of CrCl 15–50, weight ≤60 kg, ciclosporin/dronedarone/erythromycin/ketoconazole; dabigatran 110 mg bid at age ≥80 or with verapamil, 150 or 110 mg bid at age 75–80, CrCl 30–50 or GI risk. Acute VTE: apixaban 10 mg bid ×7 d then 5 mg bid; rivaroxaban 15 mg bid ×21 d then 20 mg qd; edoxaban and dabigatran after ≥5 d parenteral, with the same reductions as NVAF. Extended: apixaban 2.5 mg bid; rivaroxaban 10 (or 20) mg qd. Hip/knee: apixaban 2.5 mg bid; rivaroxaban 10 mg qd; dabigatran 220 mg qd (150 mg qd at CrCl 30–50, age ≥75, or verapamil/amiodarone/quinidine).',
      zh: 'CrCl 以 Cockcroft–Gault（實際體重）計算，以未四捨五入值比較。NVAF：apixaban 年齡 ≥80、體重 ≤60 kg、Cr ≥1.5 中 ≥2 項，或 CrCl 15–29 → 2.5 mg bid；rivaroxaban CrCl 15–49 → 15 mg qd；edoxaban CrCl 15–50、體重 ≤60 kg、併用 ciclosporin／dronedarone／erythromycin／ketoconazole 任一 → 30 mg qd；dabigatran 年齡 ≥80 或併用 verapamil → 110 mg bid，75–80 歲、CrCl 30–50 或胃腸出血風險 → 150 或 110 mg bid。急性 VTE：apixaban 10 mg bid ×7 天 → 5 mg bid；rivaroxaban 15 mg bid ×21 天 → 20 mg qd；edoxaban、dabigatran 先注射抗凝 ≥5 天，減量條件同 NVAF。延長治療：apixaban 2.5 mg bid；rivaroxaban 10（或 20）mg qd。髖膝預防：apixaban 2.5 mg bid；rivaroxaban 10 mg qd；dabigatran 220 mg qd（CrCl 30–50、≥75 歲、併用 verapamil／amiodarone／quinidine → 150 mg qd）。',
    },
    note: {
      en: 'Contraindication, not-recommended and avoid rules (renal, dialysis, liver, interactions, pregnancy, unstable PE) take precedence and quote the EU SmPC section and page. Taiwan labels pending pharmacy review.',
      zh: '禁忌、不建議與應避免（腎、透析、肝、交互作用、懷孕、不穩定 PE）優先於劑量，各附 EU SmPC 章節與頁碼。臺灣仿單待藥學部核對。',
    },
  },
  'doac-periop': {
    formula: {
      en: 'Last dose before an elective procedure (EHRA 2021 Fig 14): dabigatran CrCl ≥80 24/48 h, 50–79 36/72 h, 30–49 48/96 h (low/high risk); apixaban, edoxaban, rivaroxaban CrCl ≥30 24/48 h, 15–29 36/48 h; minor risk at trough (12 h bid, 24 h qd). Neuraxial (ASRA 2018): FXa inhibitors 72 h; dabigatran 120 h, graded 72/96/120 h only with reliable renal function and no bleeding risk factor; the longer applies. AF ablation: last dose 12 (–24) h before. Restart: the latest of 6 h (minor) / 24 h (low) / 48 (–72) h (high), catheter removal + 6 h, traumatic puncture + 24 h; haemostasis first.',
      zh: '擇期手術最後一劑（EHRA 2021 Fig 14）：dabigatran CrCl ≥80 24／48 h、50–79 36／72 h、30–49 48／96 h（低／高風險）；apixaban、edoxaban、rivaroxaban CrCl ≥30 24／48 h、15–29 36／48 h；極低風險在谷底做（bid 12 h、qd 24 h）。神經軸（ASRA 2018）：Xa 抑制劑 72 h；dabigatran 120 h，腎功能可靠且無出血風險因子才分級為 72／96／120 h；取較長者。AF 消融：術前 12（–24）h。恢復：取極低 6 h／低 24 h／高 48（–72）h、拔管 +6 h、穿刺出血 +24 h 中最晚者，並先確認止血。',
    },
    note: {
      en: 'No interval for CrCl <15, dialysis, or dabigatran below 30. Skipped doses use the patient’s actual dose times. No bridging; anti-Xa never clears a patient; andexanet is not a pre-operative reversal.',
      zh: 'CrCl <15、透析、dabigatran CrCl <30 不給時數。跳過劑數用病人實際服藥時刻。不橋接；anti-Xa 不據以判定可否手術；andexanet 不作為術前逆轉。',
    },
  },
  'crcl-cockcroft-gault': {
    formula: {
      en: 'CrCl = [(140 − age) × weight × (0.85 if female)] / (72 × Scr)',
      zh: 'CrCl = ［(140 − 年齡) × 體重 ×（女性再乘 0.85）］/ (72 × Scr)',
    },
    outcome: {
      scoreHeader: { en: 'CrCl (mL/min)', zh: 'CrCl (mL/min)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '≥ 60', outcome: { en: 'Preserved', zh: '功能大致正常' } },
        { score: '30–59', outcome: { en: 'Moderate impairment', zh: '中度不足' } },
        { score: '< 30', outcome: { en: 'Severe impairment — check renal dosing', zh: '嚴重不足 — 注意腎臟劑量調整' } },
      ],
    },
    note: {
      en: 'Scr in mg/dL, weight in kg (actual body weight). Cockcroft DW, Gault MH. Nephron 1976.',
      zh: 'Scr 單位 mg/dL，體重單位 kg（實際體重）。Cockcroft DW, Gault MH. Nephron 1976。',
    },
  },
  'kfre-4-variable': {
    formula: {
      en: 'LP = −0.2201×(age/10−7.036) + 0.2467×(male−0.5642) − 0.5567×(eGFR/5−7.222) + 0.4510×(ln ACR−5.137); risk(t) = 1−S₀(t)^exp(LP). Non–North American S₀: 0.9832 (2 y), 0.9365 (5 y).',
      zh: 'LP = −0.2201×(年齡/10−7.036) + 0.2467×(男性−0.5642) − 0.5567×(eGFR/5−7.222) + 0.4510×(ln ACR−5.137)；風險(t) = 1−S₀(t)^exp(LP)。非北美 S₀：0.9832（2 年）、0.9365（5 年）。',
    },
    outcome: {
      scoreHeader: { en: 'KFRE result', zh: 'KFRE 結果' },
      outcomeHeader: { en: 'KDIGO 2024 use', zh: 'KDIGO 2024 應用' },
      rows: [
        { score: '5 y 3%–5%', outcome: { en: 'May inform nephrology referral', zh: '可輔助決定腎臟專科轉介' } },
        { score: '2 y >10%', outcome: { en: 'May inform multidisciplinary-care timing', zh: '可輔助決定多專業照護時機' } },
        { score: '2 y >40%', outcome: { en: 'May inform KRT education and preparation', zh: '可輔助腎臟替代治療衛教與準備' } },
      ],
    },
    note: {
      en: 'ACR is the natural log of mg/g; male = 1 and female = 0. Thresholds supplement rather than replace eGFR, ACR, clinical considerations, and local pathways.',
      zh: 'ACR 以 mg/g 取自然對數；男性 = 1、女性 = 0。閾值用於輔助，不取代 eGFR、ACR、臨床情境與院內流程。',
    },
  },
  'fena': {
    formula: {
      en: 'FENa = (UNa × PCr) / (PNa × UCr) × 100',
      zh: 'FENa =（尿液鈉 × 血清肌酸酐）/（血清鈉 × 尿液肌酸酐）× 100',
    },
    outcome: {
      scoreHeader: { en: 'FENa', zh: 'FENa' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 1%', outcome: { en: 'Prerenal', zh: '腎前性' } },
        { score: '1–2%', outcome: { en: 'Indeterminate', zh: '難以判定' } },
        { score: '> 2%', outcome: { en: 'Intrinsic / ATN', zh: '腎實質性 / ATN' } },
      ],
    },
    note: { en: 'Unreliable on diuretics → use FEUrea instead.', zh: '使用利尿劑時不可靠 → 改用 FEUrea。' },
  },
  'feurea': {
    formula: {
      en: 'FEUrea = (UUrea × PCr) / (BUN × UCr) × 100',
      zh: 'FEUrea =（尿液尿素氮 × 血清肌酸酐）/（血清 BUN × 尿液肌酸酐）× 100',
    },
    outcome: {
      scoreHeader: { en: 'FEUrea', zh: 'FEUrea' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 35%', outcome: { en: 'Prerenal', zh: '腎前性' } },
        { score: '35–50%', outcome: { en: 'Indeterminate', zh: '難以判定' } },
        { score: '> 50%', outcome: { en: 'Intrinsic / ATN', zh: '腎實質性 / ATN' } },
      ],
    },
    note: { en: 'Reliable despite diuretics.', zh: '即使使用利尿劑仍可靠。' },
  },
  'ckd-kdigo-risk': {
    formula: {
      en: 'Step 1: stage GFR (G1–G5) from eGFR. Step 2: stage albuminuria (A1–A3) from ACR (preferred) or PCR. Step 3: read the risk band and follow-up frequency from the GFR × albuminuria grid.',
      zh: '步驟 1：依 eGFR 分 GFR 期別（G1–G5）。步驟 2：依 ACR（優先）或 PCR 分白蛋白尿期別（A1–A3）。步驟 3：由 GFR × 白蛋白尿方格查風險等級與追蹤頻率。',
    },
    grid: {
      caption: { en: 'KDIGO 2012 risk & monitoring heat map', zh: 'KDIGO 2012 風險與追蹤熱圖' },
      colAxis: { en: 'Persistent albuminuria category', zh: '持續白蛋白尿的分期' },
      rowAxis: { en: 'GFR category (mL/min/1.73m²)', zh: 'GFR 分期 (mL/min/1.73m²)' },
      cols: [
        { label: { en: 'A1', zh: 'A1' }, sub: { en: 'Normal', zh: '正常' } },
        { label: { en: 'A2', zh: 'A2' }, sub: { en: 'Moderately ↑', zh: '中度升高' } },
        { label: { en: 'A3', zh: 'A3' }, sub: { en: 'Severely ↑', zh: '重度升高' } },
      ],
      colSubRows: [
        { label: { en: 'ACR (mg/g)', zh: 'ACR (mg/g)' }, cells: ['< 30', '30–300', '> 300'] },
        { label: { en: 'PCR (mg/g)', zh: 'PCR (mg/g)' }, cells: ['< 150', '150–500', '> 500'] },
      ],
      rows: [
        { label: { en: 'G1 (≥ 90)', zh: 'G1 (≥ 90)' }, sub: { en: 'Normal', zh: '正常' } },
        { label: { en: 'G2 (60–89)', zh: 'G2 (60–89)' }, sub: { en: 'Mildly ↓', zh: '輕度下降' } },
        { label: { en: 'G3a (45–59)', zh: 'G3a (45–59)' }, sub: { en: 'Mild–moderate ↓', zh: '輕到中度下降' } },
        { label: { en: 'G3b (30–44)', zh: 'G3b (30–44)' }, sub: { en: 'Moderate–severe ↓', zh: '中到重度下降' } },
        { label: { en: 'G4 (15–29)', zh: 'G4 (15–29)' }, sub: { en: 'Severely ↓', zh: '重度下降' } },
        { label: { en: 'G5 (< 15)', zh: 'G5 (< 15)' }, sub: { en: 'Kidney failure', zh: '腎衰竭' } },
      ],
      cells: [
        [ { text: { en: '1 if CKD', zh: '1（若CKD）' }, color: 'green' }, { text: { en: '1', zh: '1' }, color: 'yellow' }, { text: { en: '2', zh: '2' }, color: 'orange' } ],
        [ { text: { en: '1 if CKD', zh: '1（若CKD）' }, color: 'green' }, { text: { en: '1', zh: '1' }, color: 'yellow' }, { text: { en: '2', zh: '2' }, color: 'orange' } ],
        [ { text: { en: '1', zh: '1' }, color: 'yellow' }, { text: { en: '2', zh: '2' }, color: 'orange' }, { text: { en: '3', zh: '3' }, color: 'red' } ],
        [ { text: { en: '2', zh: '2' }, color: 'orange' }, { text: { en: '3', zh: '3' }, color: 'red' }, { text: { en: '3', zh: '3' }, color: 'red' } ],
        [ { text: { en: '3', zh: '3' }, color: 'red' }, { text: { en: '3', zh: '3' }, color: 'red' }, { text: { en: '4+', zh: '4+' }, color: 'deepred' } ],
        [ { text: { en: '4+', zh: '4+' }, color: 'deepred' }, { text: { en: '4+', zh: '4+' }, color: 'deepred' }, { text: { en: '4+', zh: '4+' }, color: 'deepred' } ],
      ],
      legend: {
        en: 'Numbers = suggested nephrology reviews per year. Colours: green = low risk, yellow = moderately increased, orange = high, red = very high, deep red = kidney failure. "1 if CKD" = once a year only when CKD is confirmed (an isolated green cell with no kidney-damage markers is not CKD).',
        zh: '數字＝每年建議追蹤次數。顏色：綠＝低風險、黃＝中度升高、橙＝高、紅＝極高、深紅＝腎衰竭。「1（若CKD）」＝僅在確診慢性腎臟病時每年追蹤 1 次（綠色且無其他腎損傷指標者未必為 CKD）。',
      },
    },
    note: {
      en: 'Based on the KDIGO 2012 Clinical Practice Guideline for CKD (published Kidney Int Suppl 2013); grid layout as used in Taiwan NHI 健保存摺. ACR assumed in mg/g; ACR/PCR–stage relationships are approximate.',
      zh: '依據 KDIGO 2012 慢性腎臟病臨床指引（2013 年發表於 Kidney Int Suppl）；表格呈現比照台灣健保存摺。ACR 以 mg/g 計；ACR／PCR 對應分期為近似值。',
    },
  },
  'meld-na': {
    formula: {
      en: 'MELD = 0.957·ln(Cr) + 0.378·ln(bilirubin) + 1.120·ln(INR) + 0.643, then ×10 and rounded. If MELD > 11: MELD = MELD + 1.32·(137 − Na) − 0.033·MELD·(137 − Na). Labs floored at 1.0; Cr capped at 4.0 (forced to 4.0 if dialysis ≥2×/week); Na clamped 125–137. Final clamped 6–40.',
      zh: 'MELD = 0.957·ln(肌酸酐) + 0.378·ln(膽紅素) + 1.120·ln(INR) + 0.643，再 ×10 取整。若 MELD > 11：MELD = MELD + 1.32·(137 − Na) − 0.033·MELD·(137 − Na)。各檢驗值下限 1.0；肌酸酐上限 4.0（每週洗腎 ≥2 次則設為 4.0）；鈉夾限 125–137。最終夾限 6–40。',
    },
    outcome: {
      scoreHeader: { en: 'MELD-Na', zh: 'MELD-Na 分數' },
      outcomeHeader: { en: '90-day mortality', zh: '90 天死亡率' },
      rows: [
        { score: '≤ 9', outcome: { en: 'Lower risk (~1.9%)', zh: '風險較低（約 1.9%）' } },
        { score: '10–19', outcome: { en: 'Intermediate risk (~6.0%)', zh: '中度風險（約 6.0%）' } },
        { score: '20–29', outcome: { en: 'High risk (~19.6%)', zh: '高風險（約 19.6%）' } },
        { score: '30–40', outcome: { en: 'Very high risk (~52.6%+)', zh: '極高風險（約 52.6% 以上）' } },
      ],
    },
    note: { en: 'OPTN/UNOS MELD-Na (2016). Drives liver-transplant prioritization.', zh: 'OPTN/UNOS MELD-Na (2016)。用於肝臟移植優先排序。' },
  },
  'meld-3': {
    formula: {
      en: 'MELD 3.0 = 1.33·(female) + 4.56·ln(bili) + 0.82·(137 − Na) − 0.24·(137 − Na)·ln(bili) + 9.09·ln(INR) + 11.14·ln(Cr) + 1.85·(3.5 − alb) − 1.83·(3.5 − alb)·ln(Cr) + 6. Female = 1/0. Bili & INR floored 1.0; Cr clamped 1–3 (3 if dialysis); Na 125–137; albumin 1.5–3.5. Rounded, clamped 6–40.',
      zh: 'MELD 3.0 = 1.33·(女性) + 4.56·ln(膽紅素) + 0.82·(137 − Na) − 0.24·(137 − Na)·ln(膽紅素) + 9.09·ln(INR) + 11.14·ln(肌酸酐) + 1.85·(3.5 − 白蛋白) − 1.83·(3.5 − 白蛋白)·ln(肌酸酐) + 6。女性 = 1/0。膽紅素與 INR 下限 1.0；肌酸酐夾限 1–3（洗腎設 3）；鈉 125–137；白蛋白 1.5–3.5。取整並夾限 6–40。',
    },
    outcome: {
      scoreHeader: { en: 'MELD 3.0', zh: 'MELD 3.0 分數' },
      outcomeHeader: { en: 'Short-term mortality', zh: '短期死亡率' },
      rows: [
        { score: '≤ 9', outcome: { en: 'Lower short-term mortality', zh: '短期死亡率較低' } },
        { score: '10–19', outcome: { en: 'Intermediate risk', zh: '中度風險' } },
        { score: '20–40', outcome: { en: 'High short-term mortality', zh: '短期死亡率高' } },
      ],
    },
    note: { en: 'Kim WR, et al. Gastroenterology 2021. UNOS standard since 2023.', zh: 'Kim WR 等，Gastroenterology 2021。2023 年起為 UNOS 標準。' },
  },
  'child-pugh': {
    factors: [
      { label: { en: 'Total bilirubin (mg/dL)', zh: '總膽紅素 (mg/dL)' }, options: [ { label: { en: '< 2', zh: '< 2' }, points: '1' }, { label: { en: '2–3', zh: '2–3' }, points: '2' }, { label: { en: '> 3', zh: '> 3' }, points: '3' } ] },
      { label: { en: 'Albumin (g/dL)', zh: '白蛋白 (g/dL)' }, options: [ { label: { en: '> 3.5', zh: '> 3.5' }, points: '1' }, { label: { en: '2.8–3.5', zh: '2.8–3.5' }, points: '2' }, { label: { en: '< 2.8', zh: '< 2.8' }, points: '3' } ] },
      { label: { en: 'INR', zh: 'INR' }, options: [ { label: { en: '< 1.7', zh: '< 1.7' }, points: '1' }, { label: { en: '1.7–2.3', zh: '1.7–2.3' }, points: '2' }, { label: { en: '> 2.3', zh: '> 2.3' }, points: '3' } ] },
      { label: { en: 'Ascites', zh: '腹水' }, options: [ { label: { en: 'None', zh: '無' }, points: '1' }, { label: { en: 'Mild (controlled)', zh: '輕度（可控制）' }, points: '2' }, { label: { en: 'Moderate–severe', zh: '中重度' }, points: '3' } ] },
      { label: { en: 'Encephalopathy', zh: '肝腦病變' }, options: [ { label: { en: 'None', zh: '無' }, points: '1' }, { label: { en: 'Grade 1–2', zh: '第 1–2 級' }, points: '2' }, { label: { en: 'Grade 3–4', zh: '第 3–4 級' }, points: '3' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Class / survival (1-yr / 2-yr)', zh: '分級／存活率 (1 年／2 年)' },
      rows: [
        { score: '5–6', outcome: { en: 'Class A — well compensated (~100% / 85%)', zh: 'A 級 — 代償良好（約 100% / 85%）' } },
        { score: '7–9', outcome: { en: 'Class B — significant compromise (~80% / 60%)', zh: 'B 級 — 明顯受損（約 80% / 60%）' } },
        { score: '10–15', outcome: { en: 'Class C — decompensated (~45% / 35%)', zh: 'C 級 — 失代償（約 45% / 35%）' } },
      ],
    },
    note: { en: 'Pugh RN, et al. Br J Surg 1973. Five criteria, 1–3 points each (total 5–15).', zh: 'Pugh RN 等，Br J Surg 1973。五項指標，每項 1–3 分（總分 5–15）。' },
  },
  'fib-4': {
    formula: { en: 'FIB-4 = (age × AST) / (platelets × √ALT). Platelets in 10⁹/L; AST/ALT in U/L.', zh: 'FIB-4 = (年齡 × AST) / (血小板 × √ALT)。血小板單位 10⁹/L；AST 與 ALT 單位 U/L。' },
    outcome: {
      scoreHeader: { en: 'FIB-4', zh: 'FIB-4 值' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 1.45', outcome: { en: 'Advanced fibrosis unlikely', zh: '較不可能為進展性纖維化' } },
        { score: '1.45–3.25', outcome: { en: 'Indeterminate (gray zone)', zh: '無法判定（灰色地帶）' } },
        { score: '> 3.25', outcome: { en: 'Advanced fibrosis likely', zh: '可能為進展性纖維化' } },
      ],
    },
    note: { en: 'Sterling RK, et al. Hepatology 2006.', zh: 'Sterling RK 等，Hepatology 2006。' },
  },
  'apri': {
    formula: { en: 'APRI = (AST / AST-ULN) × 100 / platelets. Platelets in 10⁹/L; AST-ULN defaults to 40 U/L.', zh: 'APRI = (AST / AST 正常上限) × 100 / 血小板。血小板單位 10⁹/L；AST 正常上限預設 40 U/L。' },
    outcome: {
      scoreHeader: { en: 'APRI', zh: 'APRI 值' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 0.5', outcome: { en: 'Significant fibrosis unlikely', zh: '較不可能有明顯纖維化' } },
        { score: '0.5–1.5', outcome: { en: 'Indeterminate', zh: '無法判定' } },
        { score: '> 1.5', outcome: { en: 'Significant fibrosis likely', zh: '可能有明顯纖維化' } },
        { score: '≥ 2.0', outcome: { en: 'Cirrhosis likely', zh: '可能為肝硬化' } },
      ],
    },
    note: { en: 'Wai CT, et al. Hepatology 2003.', zh: 'Wai CT 等，Hepatology 2003。' },
  },
  'nafld-fibrosis': {
    formula: { en: 'NFS = −1.675 + 0.037·age + 0.094·BMI + 1.13·(IFG/diabetes: 1/0) + 0.99·(AST/ALT) − 0.013·platelets − 0.66·albumin. BMI kg/m²; platelets 10⁹/L; albumin g/dL.', zh: 'NFS = −1.675 + 0.037·年齡 + 0.094·BMI + 1.13·(空腹血糖異常/糖尿病:1/0) + 0.99·(AST/ALT) − 0.013·血小板 − 0.66·白蛋白。BMI 單位 kg/m²；血小板 10⁹/L；白蛋白 g/dL。' },
    outcome: {
      scoreHeader: { en: 'NFS', zh: 'NFS 值' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< −1.455', outcome: { en: 'F0–F2, advanced fibrosis unlikely', zh: 'F0–F2，較不可能進展性纖維化' } },
        { score: '−1.455 to 0.676', outcome: { en: 'Indeterminate', zh: '無法判定' } },
        { score: '> 0.676', outcome: { en: 'F3–F4, advanced fibrosis likely', zh: 'F3–F4，可能進展性纖維化' } },
      ],
    },
    note: { en: 'Angulo P, et al. Hepatology 2007. Cutoffs −1.455 and 0.676.', zh: 'Angulo P 等，Hepatology 2007。切點 −1.455 與 0.676。' },
  },
  'maddrey-df': {
    formula: { en: 'Maddrey DF = 4.6 × (PT − control PT) + total bilirubin. PT in seconds (control defaults to 12 s); bilirubin in mg/dL.', zh: 'Maddrey DF = 4.6 × (病人 PT − 對照 PT) + 總膽紅素。PT 單位秒（對照預設 12 秒）；膽紅素單位 mg/dL。' },
    outcome: {
      scoreHeader: { en: 'DF', zh: 'DF 值' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 32', outcome: { en: 'Non-severe', zh: '非重度' } },
        { score: '≥ 32', outcome: { en: 'Severe; consider corticosteroids', zh: '重度；考慮類固醇治療' } },
      ],
    },
    note: { en: 'Maddrey WC, et al. 1978. Severity of alcoholic hepatitis.', zh: 'Maddrey WC 等，1978。評估酒精性肝炎嚴重度。' },
  },
  'corrected-calcium': {
    formula: { en: 'Corrected Ca = measured Ca + 0.8 × (4.0 − albumin)', zh: '校正鈣 = 實測鈣 + 0.8 ×（4.0 − 白蛋白）' },
    outcome: {
      scoreHeader: { en: 'Corrected Ca (mg/dL)', zh: '校正鈣 (mg/dL)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 8.5', outcome: { en: 'Hypocalcemia', zh: '低血鈣' } },
        { score: '8.5–10.5', outcome: { en: 'Within normal range', zh: '正常範圍內' } },
        { score: '> 10.5', outcome: { en: 'Hypercalcemia', zh: '高血鈣' } },
      ],
    },
    note: { en: 'Albumin in g/dL; +0.8 mg/dL per 1 g/dL drop below 4.0.', zh: '白蛋白單位 g/dL；每低於 4.0 一個 g/dL，校正鈣加 0.8 mg/dL。' },
  },
  'corrected-sodium': {
    formula: { en: 'Corrected Na = Na + 2.4 × (glucose − 100) / 100', zh: '校正鈉 = 鈉 + 2.4 ×（血糖 − 100）/ 100' },
    note: { en: 'Hillier factor: +2.4 mmol/L Na per 100 mg/dL glucose above 100. Glucose in mg/dL.', zh: 'Hillier 校正係數：血糖每高於 100 一個 100 mg/dL，鈉加 2.4 mmol/L。血糖單位 mg/dL。' },
  },
  'anion-gap': {
    formula: { en: 'AG = Na − (Cl + HCO₃); albumin-corrected AG = AG + 2.5 × (4.0 − albumin)', zh: '陰離子間隙 = Na −（Cl + HCO₃）；白蛋白校正 AG = AG + 2.5 ×（4.0 − 白蛋白）' },
    outcome: {
      scoreHeader: { en: 'Anion gap (mmol/L)', zh: '陰離子間隙 (mmol/L)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '≤ 12', outcome: { en: 'Normal range (~8–12)', zh: '正常範圍（約 8–12）' } },
        { score: '> 12', outcome: { en: 'Elevated — consider high anion gap metabolic acidosis', zh: '偏高 — 考慮高陰離子間隙代謝性酸中毒' } },
      ],
    },
    note: { en: 'When albumin is entered, the > 12 threshold applies to the albumin-corrected AG.', zh: '若輸入白蛋白，> 12 之判讀以白蛋白校正 AG 為準。' },
  },
  'serum-osmolality': {
    formula: { en: 'Calculated osmolality = 2 × Na + glucose / 18 + BUN / 2.8', zh: '計算滲透壓 = 2 × Na + 血糖 / 18 + BUN / 2.8' },
    outcome: {
      scoreHeader: { en: 'Osmolality (mOsm/kg)', zh: '滲透壓 (mOsm/kg)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 275', outcome: { en: 'Low', zh: '偏低' } },
        { score: '275–295', outcome: { en: 'Normal', zh: '正常' } },
        { score: '> 295', outcome: { en: 'High', zh: '偏高' } },
      ],
    },
    note: { en: 'Glucose & BUN in mg/dL. Measured osmolality is needed for the osmolar gap.', zh: '血糖與 BUN 單位 mg/dL。滲透壓間隙需另測實測滲透壓。' },
  },
  'free-water-deficit': {
    formula: { en: 'Free water deficit = TBW × (Na / 140 − 1); TBW = weight × 0.6 (M) / 0.5 (F)', zh: '自由水缺乏 = 全身體液量 ×（Na / 140 − 1）；全身體液量 = 體重 × 0.6（男）/ 0.5（女）' },
    note: { en: 'Applies in hypernatremia (Na > 145); replace slowly over 48 h.', zh: '適用於高血鈉（Na > 145）；建議 48 小時內緩慢矯正。' },
  },
  'winters': {
    formula: { en: 'Expected PaCO₂ = 1.5 × HCO₃ + 8 ± 2', zh: '預期 PaCO₂ = 1.5 × HCO₃ + 8 ± 2' },
    note: { en: 'For metabolic acidosis. Measured PaCO₂ above range = concurrent respiratory acidosis; below = respiratory alkalosis.', zh: '適用於代謝性酸中毒。實測 PaCO₂ 高於此範圍＝合併呼吸性酸中毒；低於＝呼吸性鹼中毒。' },
  },
  'urine-anion-gap': {
    formula: { en: 'UAG = U_Na + U_K − U_Cl', zh: '尿液陰離子間隙 = 尿鈉 + 尿鉀 − 尿氯' },
    outcome: {
      scoreHeader: { en: 'UAG (mmol/L)', zh: '尿液陰離子間隙 (mmol/L)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 0 (negative)', outcome: { en: 'Appropriate NH₄⁺ excretion (e.g. GI HCO₃ loss / diarrhea)', zh: 'NH₄⁺ 排泄正常（如腸胃道 HCO₃ 流失／腹瀉）' } },
        { score: '≥ 0 (positive)', outcome: { en: 'Impaired NH₄⁺ excretion (e.g. renal tubular acidosis)', zh: 'NH₄⁺ 排泄受損（如腎小管酸中毒 RTA）' } },
      ],
    },
    note: { en: 'Used in the workup of normal-anion-gap metabolic acidosis.', zh: '用於正常陰離子間隙代謝性酸中毒之鑑別。' },
  },
  'ttkg': {
    formula: { en: 'TTKG = (U_K × P_osm) / (P_K × U_osm)', zh: 'TTKG =（尿鉀 × 血清滲透壓）/（血清鉀 × 尿液滲透壓）' },
    outcome: {
      scoreHeader: { en: 'TTKG (in hyperkalemia)', zh: 'TTKG（高血鉀時）' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 7', outcome: { en: 'Suggests hypoaldosteronism', zh: '疑似醛固酮不足' } },
        { score: '≥ 7', outcome: { en: 'Appropriate renal response', zh: '腎臟反應正常' } },
      ],
    },
    note: { en: 'Valid only when urine osmolality > serum osmolality (and U_Na > 25).', zh: '僅當尿液滲透壓 > 血清滲透壓（且尿鈉 > 25）時有效。' },
  },
  'osmolar-gap': {
    formula: { en: 'Osmolar gap = measured − (2 × Na + glucose / 18 + BUN / 2.8 + ethanol / 3.7)', zh: '滲透壓間隙 = 實測 −（2 × Na + 血糖 / 18 + BUN / 2.8 + 乙醇 / 3.7）' },
    outcome: {
      scoreHeader: { en: 'Osmolar gap (mOsm/kg)', zh: '滲透壓間隙 (mOsm/kg)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '≤ 10', outcome: { en: 'Normal', zh: '正常' } },
        { score: '> 10', outcome: { en: 'Elevated — consider toxic alcohols (methanol, ethylene glycol)', zh: '偏高 — 考慮毒性酒精（甲醇、乙二醇）' } },
      ],
    },
    note: { en: 'Ethanol (mg/dL) is optional; the /3.7 term is only added when entered.', zh: '乙醇（mg/dL）為選填；僅在輸入時才加入 /3.7 項。' },
  },
  'cha2ds2-va': {
    formula: { zh: '心衰竭 1 + 高血壓 1 + 年齡 65–74 歲 1 或 ≥75 歲 2 + 糖尿病 1 + 中風／TIA／動脈栓塞 2 + 血管疾病 1（不计性別，0–8 分）', en: 'HF 1 + hypertension 1 + age 65–74: 1 or ≥75: 2 + diabetes 1 + stroke/TIA/arterial embolism 2 + vascular disease 1. No sex point (0–8).' },
    outcome: { scoreHeader: { zh: '分數', en: 'Score' }, outcomeHeader: { zh: 'ESC 2024 抗凝評估', en: 'ESC 2024 OAC assessment' }, rows: [
      { score: '0', outcome: { zh: '低分，需完整病史及臨床評估', en: 'Low score; requires complete history and clinical assessment' } },
      { score: '1', outcome: { zh: '應考慮抗凝', en: 'OAC should be considered' } },
      { score: '≥2', outcome: { zh: '建議抗凝', en: 'OAC recommended' } },
    ] },
    note: { zh: '缺項維持未知並顯示範圍，不以最低分做低風險分類。來源：ESC 2024 Table 10／Recommendation Table 6。', en: 'Missing inputs remain unknown and show a range; do not label low risk from the floor. ESC 2024 Table 10 / Recommendation Table 6.' },
  },
  'cha2ds2-vasc': {
    factors: [
      { label: { en: 'Age', zh: '年齡' }, options: [ { label: { en: '< 65 y', zh: '< 65 歲' }, points: '0' }, { label: { en: '65–74 y', zh: '65–74 歲' }, points: '1' }, { label: { en: '≥ 75 y', zh: '≥ 75 歲' }, points: '2' } ] },
      { label: { en: 'Sex', zh: '性別' }, options: [ { label: { en: 'Male', zh: '男性' }, points: '0' }, { label: { en: 'Female', zh: '女性' }, points: '1' } ] },
      { label: { en: 'CHF / LV dysfunction', zh: '心衰竭／左心室功能不良' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Hypertension', zh: '高血壓' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Diabetes', zh: '糖尿病' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Prior stroke / TIA / thromboembolism', zh: '曾中風／TIA／血栓栓塞' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '2' } ] },
      { label: { en: 'Vascular disease', zh: '血管疾病' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Adjusted annual stroke rate', zh: '校正後每年中風率' },
      rows: [
        { score: '0', outcome: { en: '0.2%', zh: '0.2%' } },
        { score: '1', outcome: { en: '0.6%', zh: '0.6%' } },
        { score: '2', outcome: { en: '2.2%', zh: '2.2%' } },
        { score: '3', outcome: { en: '3.2%', zh: '3.2%' } },
        { score: '4', outcome: { en: '4.8%', zh: '4.8%' } },
        { score: '5', outcome: { en: '7.2%', zh: '7.2%' } },
        { score: '6', outcome: { en: '9.7%', zh: '9.7%' } },
        { score: '7', outcome: { en: '11.2%', zh: '11.2%' } },
        { score: '8', outcome: { en: '10.8%', zh: '10.8%' } },
        { score: '9', outcome: { en: '12.2%', zh: '12.2%' } },
      ],
    },
    note: { en: 'Categories: 0 low, 1 low–moderate, ≥ 2 high. Adjusted rates from Friberg L, et al. Eur Heart J 2012.', zh: '分級：0 低、1 低至中度、≥ 2 高。校正率來自 Friberg L, et al. Eur Heart J 2012。' },
  },
  'map': {
    formula: { en: 'MAP = (SBP + 2 × DBP) / 3', zh: 'MAP = (收縮壓 + 2 × 舒張壓) / 3' },
    outcome: {
      scoreHeader: { en: 'MAP (mmHg)', zh: 'MAP (mmHg)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 65', outcome: { en: 'Organ perfusion at risk', zh: '器官灌流不足風險' } },
        { score: '65–100', outcome: { en: 'Adequate perfusion', zh: '灌流足夠' } },
        { score: '> 100', outcome: { en: 'Elevated', zh: '偏高' } },
      ],
    },
    note: { en: 'Target ≥ 65 mmHg is commonly used to maintain organ perfusion.', zh: '一般以 ≥ 65 mmHg 為維持器官灌流的目標。' },
  },
  'has-bled': {
    factors: [
      { label: { en: 'Hypertension (SBP > 160)', zh: '高血壓（收縮壓 > 160）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Abnormal renal function', zh: '腎功能異常' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Abnormal liver function', zh: '肝功能異常' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Stroke history', zh: '中風病史' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Bleeding history/predisposition', zh: '出血病史或體質' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Labile INR (TTR < 60%)', zh: 'INR 不穩定（TTR < 60%）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Elderly (age > 65)', zh: '年長（年齡 > 65）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Drugs (antiplatelet / NSAID)', zh: '併用藥物（抗血小板／NSAID）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Alcohol (≥ 8 drinks/week)', zh: '飲酒（每週 ≥ 8 份）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Bleeding risk', zh: '出血風險' },
      rows: [
        { score: '0–1', outcome: { en: 'Low bleeding risk', zh: '低出血風險' } },
        { score: '2', outcome: { en: 'Moderate bleeding risk', zh: '中度出血風險' } },
        { score: '≥ 3', outcome: { en: 'High bleeding risk; caution & regular review', zh: '高出血風險；謹慎並定期評估' } },
      ],
    },
    note: { en: 'Max 9 points. ≥ 3 flags high risk but is not a contraindication to anticoagulation (Pisters R, et al. Chest 2010).', zh: '滿分 9 分。≥ 3 分代表高風險，但非抗凝治療之禁忌症（Pisters R, et al. Chest 2010）。' },
  },
  'qtc': {
    formula: { en: 'Bazett QTc = QT / √RR;  Fridericia QTc = QT / ∛RR   (RR seconds = 60 / HR)', zh: 'Bazett QTc = QT / √RR；Fridericia QTc = QT / ∛RR   (RR 秒 = 60 / 心率)' },
    outcome: {
      scoreHeader: { en: 'Bazett QTc (ms)', zh: 'Bazett QTc (ms)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 450', outcome: { en: 'Normal', zh: '正常' } },
        { score: '450–500', outcome: { en: 'Prolonged', zh: '延長' } },
        { score: '> 500', outcome: { en: 'High torsades risk', zh: '高度尖端扭轉風險' } },
      ],
    },
    note: { en: 'Interpretation bands apply to Bazett QTc; Fridericia QTc is reported alongside.', zh: '判讀分級以 Bazett QTc 為準；同時列出 Fridericia QTc 供參考。' },
  },
  'heart': {
    factors: [
      { label: { en: 'History', zh: '病史' }, options: [ { label: { en: 'Slightly suspicious', zh: '稍可疑' }, points: '0' }, { label: { en: 'Moderately suspicious', zh: '中度可疑' }, points: '1' }, { label: { en: 'Highly suspicious', zh: '高度可疑' }, points: '2' } ] },
      { label: { en: 'ECG', zh: '心電圖' }, options: [ { label: { en: 'Normal', zh: '正常' }, points: '0' }, { label: { en: 'Non-specific repolarization', zh: '非特異性再極化' }, points: '1' }, { label: { en: 'Significant ST deviation', zh: '顯著 ST 偏移' }, points: '2' } ] },
      { label: { en: 'Age', zh: '年齡' }, options: [ { label: { en: '< 45 y', zh: '< 45 歲' }, points: '0' }, { label: { en: '45–64 y', zh: '45–64 歲' }, points: '1' }, { label: { en: '≥ 65 y', zh: '≥ 65 歲' }, points: '2' } ] },
      { label: { en: 'Risk factors', zh: '危險因子' }, options: [ { label: { en: 'None', zh: '無' }, points: '0' }, { label: { en: '1–2 risk factors', zh: '1–2 項' }, points: '1' }, { label: { en: '≥ 3 or known atherosclerosis', zh: '≥ 3 項或已知動脈硬化' }, points: '2' } ] },
      { label: { en: 'Troponin', zh: '心肌旋轉素' }, options: [ { label: { en: '≤ normal limit', zh: '≤ 正常上限' }, points: '0' }, { label: { en: '1–3× normal', zh: '1–3 倍' }, points: '1' }, { label: { en: '> 3× normal', zh: '> 3 倍' }, points: '2' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: '6-week MACE risk', zh: '6 週主要心臟事件風險' },
      rows: [
        { score: '0–3', outcome: { en: 'Low risk — 0.9–1.7%', zh: '低風險 — 0.9–1.7%' } },
        { score: '4–6', outcome: { en: 'Moderate risk — 12–16.6%', zh: '中度風險 — 12–16.6%' } },
        { score: '7–10', outcome: { en: 'High risk — 50–65%', zh: '高風險 — 50–65%' } },
      ],
    },
    note: { en: 'Max 10 points (Six AJ, et al. 2008; Backus BE, et al. 2013).', zh: '滿分 10 分（Six AJ, et al. 2008; Backus BE, et al. 2013）。' },
  },
  'wells-dvt': {
    factors: [
      { label: { en: 'Active cancer (treatment within 6 mo)', zh: '活動性癌症（6 個月內治療）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Paralysis/paresis or recent leg immobilization', zh: '下肢癱瘓或近期固定' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Bedridden ≥ 3 days or major surgery within 12 wk', zh: '臥床 ≥ 3 天或 12 週內大手術' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Localized tenderness along deep veins', zh: '深靜脈走向局部壓痛' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Entire leg swollen', zh: '整條腿腫脹' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Calf swelling > 3 cm vs other leg', zh: '小腿較對側腫 > 3 cm' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Pitting edema (symptomatic leg)', zh: '患肢凹陷性水腫' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Collateral superficial veins (non-varicose)', zh: '側枝表淺靜脈（非靜脈曲張）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Previously documented DVT', zh: '曾確診 DVT' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Alternative diagnosis at least as likely', zh: '其他診斷同樣或更可能' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '−2' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Pre-test probability', zh: '前測機率' },
      rows: [
        { score: '≤ 0', outcome: { en: 'DVT unlikely', zh: '不太可能 DVT' } },
        { score: '1–2', outcome: { en: 'Moderate', zh: '中度' } },
        { score: '≥ 3', outcome: { en: 'DVT likely', zh: '可能 DVT' } },
      ],
    },
    note: { en: 'Wells PS, et al. 2003. "Likely" (≥ 2) → imaging; otherwise D-dimer.', zh: 'Wells PS, et al. 2003。「可能」（≥ 2）→ 影像檢查；否則檢驗 D-dimer。' },
  },
  'wells-pe': {
    factors: [
      { label: { en: 'Clinical signs of DVT', zh: 'DVT 臨床徵象' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '3' } ] },
      { label: { en: 'PE is the #1 or equally likely diagnosis', zh: 'PE 為最可能或同等可能診斷' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '3' } ] },
      { label: { en: 'Heart rate > 100', zh: '心率 > 100' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1.5' } ] },
      { label: { en: 'Immobilization ≥ 3 days or surgery within 4 wk', zh: '固定 ≥ 3 天或 4 週內手術' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1.5' } ] },
      { label: { en: 'Previous PE / DVT', zh: '曾有 PE / DVT' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1.5' } ] },
      { label: { en: 'Hemoptysis', zh: '咳血' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Malignancy (treatment within 6 mo)', zh: '惡性腫瘤（6 個月內治療）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Pre-test probability', zh: '前測機率' },
      rows: [
        { score: '< 2', outcome: { en: 'Low', zh: '低' } },
        { score: '2–6', outcome: { en: 'Moderate', zh: '中度' } },
        { score: '> 6', outcome: { en: 'High', zh: '高' } },
      ],
    },
    note: { en: 'Wells PS, et al. 2000. Two-tier: ≤ 4 PE unlikely, > 4 likely.', zh: 'Wells PS, et al. 2000。二分法：≤ 4 不太可能 PE、> 4 可能。' },
  },
  'who-cvd-2019': {
    formula: {
      en: 'Two sex-specific Cox sub-models, each p = 1 − S0^exp(Σ β·(x − x̄)) over age, cholesterol, SBP, diabetes and smoking (with age-interaction terms). MI/CHD and stroke risks combined: p = 1 − (1 − p_MI)(1 − p_stroke). Total cholesterol mg/dL ÷ 38.67 → mmol/L; centering at age 60, chol 6 mmol/L, SBP 120.',
      zh: '兩個性別特定 Cox 子模型，各為 p = 1 − S0^exp(Σ β·(x − x̄))，變數含年齡、膽固醇、收縮壓、糖尿病與吸菸（含年齡交互項）。心肌梗塞與中風合併：p = 1 − (1 − p_MI)(1 − p_中風)。總膽固醇 mg/dL ÷ 38.67 → mmol/L；中心化採年齡 60、膽固醇 6 mmol/L、收縮壓 120。',
    },
    outcome: {
      scoreHeader: { en: '10-year CVD risk', zh: '10 年心血管疾病風險' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 5%', outcome: { en: 'Low risk', zh: '低風險' } },
        { score: '5–< 10%', outcome: { en: 'Moderate risk', zh: '中度風險' } },
        { score: '10–< 20%', outcome: { en: 'High risk', zh: '高風險' } },
        { score: '20–< 30%', outcome: { en: 'Very high risk', zh: '極高風險' } },
        { score: '≥ 30%', outcome: { en: 'Critical risk', zh: '極高風險' } },
      ],
    },
    note: {
      en: 'WHO 2019 core model (Kaptoge S, et al. Lancet Glob Health 2019), pooled un-recalibrated baseline — NOT recalibrated for Taiwan and NOT the official NHI 健保 algorithm. Validated for age 40–80. Reference/comparison only.',
      zh: 'WHO 2019 核心模型（Kaptoge S, et al. Lancet Glob Health 2019），採未校正的合併基準 — 未針對台灣校正、亦非健保署官方演算法。適用年齡 40–80 歲。僅供參考比較。',
    },
  },
  'glasgow-blatchford': {
    factors: [
      { label: { en: 'BUN (mg/dL)', zh: '尿素氮 BUN (mg/dL)' }, options: [ { label: { en: '< 18.2', zh: '< 18.2' }, points: '0' }, { label: { en: '18.2 – < 22.4', zh: '18.2 – < 22.4' }, points: '2' }, { label: { en: '22.4 – < 28', zh: '22.4 – < 28' }, points: '3' }, { label: { en: '28 – < 70', zh: '28 – < 70' }, points: '4' }, { label: { en: '≥ 70', zh: '≥ 70' }, points: '6' } ] },
      { label: { en: 'Hemoglobin — men (g/dL)', zh: '血色素 — 男性 (g/dL)' }, options: [ { label: { en: '≥ 13', zh: '≥ 13' }, points: '0' }, { label: { en: '12 – < 13', zh: '12 – < 13' }, points: '1' }, { label: { en: '10 – < 12', zh: '10 – < 12' }, points: '3' }, { label: { en: '< 10', zh: '< 10' }, points: '6' } ] },
      { label: { en: 'Hemoglobin — women (g/dL)', zh: '血色素 — 女性 (g/dL)' }, options: [ { label: { en: '≥ 12', zh: '≥ 12' }, points: '0' }, { label: { en: '10 – < 12', zh: '10 – < 12' }, points: '1' }, { label: { en: '< 10', zh: '< 10' }, points: '6' } ] },
      { label: { en: 'Systolic BP (mmHg)', zh: '收縮壓 (mmHg)' }, options: [ { label: { en: '≥ 110', zh: '≥ 110' }, points: '0' }, { label: { en: '100 – < 110', zh: '100 – < 110' }, points: '1' }, { label: { en: '90 – < 100', zh: '90 – < 100' }, points: '2' }, { label: { en: '< 90', zh: '< 90' }, points: '3' } ] },
      { label: { en: 'Heart rate ≥ 100', zh: '心率 ≥ 100' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Melena', zh: '黑便' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Syncope', zh: '昏厥' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '2' } ] },
      { label: { en: 'Hepatic disease', zh: '肝臟疾病' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '2' } ] },
      { label: { en: 'Cardiac failure', zh: '心臟衰竭' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '2' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Risk', zh: '風險' },
      rows: [
        { score: '0', outcome: { en: 'Very low risk; consider outpatient management', zh: '極低風險；可考慮門診處理' } },
        { score: '1–5', outcome: { en: 'Low–moderate risk', zh: '低至中度風險' } },
        { score: '≥ 6', outcome: { en: 'High risk; likely needs intervention', zh: '高風險；可能需介入' } },
      ],
    },
    note: { en: 'Range 0–23. Score 0 identifies patients safe for outpatient care.', zh: '範圍 0–23。0 分者可安全於門診照護。' },
  },
  'bisap': {
    factors: [
      { label: { en: 'BUN > 25 mg/dL', zh: '尿素氮 BUN > 25 mg/dL' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Impaired mental status', zh: '意識改變' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'SIRS (≥ 2 criteria)', zh: 'SIRS（≥ 2 項）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Age > 60 y', zh: '年齡 > 60 歲' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Pleural effusion', zh: '肋膜積液' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Mortality', zh: '死亡率' },
      rows: [
        { score: '0–1', outcome: { en: 'Low mortality (< 2%)', zh: '低死亡率（< 2%）' } },
        { score: '2', outcome: { en: 'Intermediate (~2%)', zh: '中度（約 2%）' } },
        { score: '≥ 3', outcome: { en: 'High mortality (5–20%)', zh: '高死亡率（5–20%）' } },
      ],
    },
    note: { en: 'Range 0–5. Assessed within the first 24 h of admission.', zh: '範圍 0–5。於入院 24 小時內評估。' },
  },
  'ranson': {
    factors: [
      { label: { en: 'On admission', zh: '入院時' }, options: [ { label: { en: 'Age > 55 y', zh: '年齡 > 55 歲' }, points: '1' }, { label: { en: 'WBC > 16 ×10⁹/L', zh: '白血球 > 16 ×10⁹/L' }, points: '1' }, { label: { en: 'Glucose > 200 mg/dL', zh: '血糖 > 200 mg/dL' }, points: '1' }, { label: { en: 'AST > 250 U/L', zh: 'AST > 250 U/L' }, points: '1' }, { label: { en: 'LDH > 350 U/L', zh: 'LDH > 350 U/L' }, points: '1' } ] },
      { label: { en: 'At 48 hours', zh: '48 小時後' }, options: [ { label: { en: 'Hct fall > 10%', zh: 'Hct 下降 > 10%' }, points: '1' }, { label: { en: 'BUN rise > 5 mg/dL', zh: 'BUN 上升 > 5 mg/dL' }, points: '1' }, { label: { en: 'Calcium < 8 mg/dL', zh: '血鈣 < 8 mg/dL' }, points: '1' }, { label: { en: 'PaO₂ < 60 mmHg', zh: 'PaO₂ < 60 mmHg' }, points: '1' }, { label: { en: 'Base deficit > 4 mmol/L', zh: '鹼缺失 > 4 mmol/L' }, points: '1' }, { label: { en: 'Fluid sequestration > 6 L', zh: '體液滯留 > 6 L' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Mortality', zh: '死亡率' },
      rows: [
        { score: '0–2', outcome: { en: '~2% mortality', zh: '約 2% 死亡率' } },
        { score: '3–4', outcome: { en: '~15% mortality', zh: '約 15% 死亡率' } },
        { score: '5–6', outcome: { en: '~40% mortality', zh: '約 40% 死亡率' } },
        { score: '≥ 7', outcome: { en: '~100% mortality', zh: '接近 100% 死亡率' } },
      ],
    },
    note: { en: 'Range 0–11 (non-gallstone). ≥ 3 indicates severe pancreatitis.', zh: '範圍 0–11（非膽石性）。≥ 3 表示重度胰臟炎。' },
  },
  'aims65': {
    factors: [
      { label: { en: 'Albumin < 3 g/dL', zh: '白蛋白 < 3 g/dL' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'INR > 1.5', zh: 'INR > 1.5' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Altered mental status', zh: '意識改變' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Systolic BP < 90 mmHg', zh: '收縮壓 < 90 mmHg' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Age > 65 y', zh: '年齡 > 65 歲' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'In-hospital mortality', zh: '院內死亡率' },
      rows: [
        { score: '0', outcome: { en: '0.3% — low risk', zh: '0.3% — 低風險' } },
        { score: '1', outcome: { en: '1.2% — low–moderate risk', zh: '1.2% — 低至中度風險' } },
        { score: '2', outcome: { en: '3.6% — high risk', zh: '3.6% — 高風險' } },
        { score: '3', outcome: { en: '9.8% — high risk', zh: '9.8% — 高風險' } },
        { score: '4', outcome: { en: '21.8% — high risk', zh: '21.8% — 高風險' } },
        { score: '5', outcome: { en: '31.8% — high risk', zh: '31.8% — 高風險' } },
      ],
    },
    note: { en: 'Range 0–5 (Saltzman 2011 derivation cohort). ≥ 2 — consider ICU-level monitoring and urgent endoscopy.', zh: '範圍 0–5（Saltzman 2011 推導世代）。≥ 2 分 — 考慮加護監測與緊急內視鏡。' },
  },
  'rockall': {
    factors: [
      { label: { en: 'Age', zh: '年齡' }, options: [ { label: { en: '< 60', zh: '< 60' }, points: '0' }, { label: { en: '60–79', zh: '60–79' }, points: '1' }, { label: { en: '≥ 80', zh: '≥ 80' }, points: '2' } ] },
      { label: { en: 'Shock', zh: '休克' }, options: [ { label: { en: 'None — SBP ≥ 100, HR < 100', zh: '無 — 收縮壓 ≥ 100、心率 < 100' }, points: '0' }, { label: { en: 'Tachycardia — HR ≥ 100', zh: '心搏過速 — 心率 ≥ 100' }, points: '1' }, { label: { en: 'Hypotension — SBP < 100', zh: '低血壓 — 收縮壓 < 100' }, points: '2' } ] },
      { label: { en: 'Comorbidity', zh: '共病' }, options: [ { label: { en: 'None', zh: '無' }, points: '0' }, { label: { en: 'Cardiac / other major', zh: '心臟或其他重大疾病' }, points: '2' }, { label: { en: 'Renal / liver failure, metastatic', zh: '腎／肝衰竭、轉移癌' }, points: '3' } ] },
      { label: { en: 'Diagnosis (endoscopy)', zh: '診斷（內視鏡）' }, options: [ { label: { en: 'Mallory-Weiss / no lesion', zh: 'Mallory-Weiss／無病灶' }, points: '0' }, { label: { en: 'All other diagnoses', zh: '其他診斷' }, points: '1' }, { label: { en: 'GI malignancy', zh: '消化道惡性腫瘤' }, points: '2' } ] },
      { label: { en: 'Stigmata of recent bleeding', zh: '近期出血徵象' }, options: [ { label: { en: 'None / dark spot', zh: '無／暗色斑點' }, points: '0' }, { label: { en: 'Blood, adherent clot, visible/spurting vessel', zh: '出血、附著血塊、可見或噴血血管' }, points: '2' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Risk', zh: '風險' },
      rows: [
        { score: '≤ 2', outcome: { en: 'Low risk', zh: '低風險' } },
        { score: '3–5', outcome: { en: 'Intermediate risk', zh: '中度風險' } },
        { score: '≥ 6', outcome: { en: 'High risk of rebleeding / death', zh: '再出血／死亡高風險' } },
      ],
    },
    note: { en: 'Full (post-endoscopy) score, range 0–11.', zh: '完整（內視鏡後）分數，範圍 0–11。' },
  },
  'curb-65': {
    factors: [
      { label: { en: 'Confusion (new)', zh: '新發意識混亂' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'BUN > 19 mg/dL', zh: '尿素氮 BUN > 19 mg/dL' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Respiratory rate ≥ 30/min', zh: '呼吸速率 ≥ 30/分' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'SBP < 90 or DBP ≤ 60 mmHg', zh: '收縮壓 < 90 或舒張壓 ≤ 60 mmHg' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Age ≥ 65 y', zh: '年齡 ≥ 65 歲' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: '30-day mortality', zh: '30 天死亡率' },
      rows: [
        { score: '0', outcome: { en: '0.6% — low; consider outpatient', zh: '0.6% — 低風險；可考慮門診' } },
        { score: '1', outcome: { en: '2.7% — low; consider outpatient', zh: '2.7% — 低風險；可考慮門診' } },
        { score: '2', outcome: { en: '6.8% — moderate', zh: '6.8% — 中度風險' } },
        { score: '3', outcome: { en: '14.0% — severe; admit', zh: '14.0% — 重度；建議住院' } },
        { score: '4–5', outcome: { en: '27.8% — severe; assess ICU', zh: '27.8% — 重度；評估加護病房' } },
      ],
    },
    note: { en: '1 pt each (range 0–5): Confusion, Urea > 19, RR ≥ 30, low BP, age ≥ 65.', zh: '每項 1 分（範圍 0–5）：意識混亂、尿素氮 > 19、呼吸速率 ≥ 30、低血壓、年齡 ≥ 65。' },
  },
  'qsofa': {
    factors: [
      { label: { en: 'Respiratory rate ≥ 22/min', zh: '呼吸速率 ≥ 22/分' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Altered mentation (GCS < 15)', zh: '意識改變（GCS < 15）' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Systolic BP ≤ 100 mmHg', zh: '收縮壓 ≤ 100 mmHg' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total score', zh: '總分' },
      outcomeHeader: { en: 'Risk', zh: '風險' },
      rows: [
        { score: '0–1', outcome: { en: 'Low risk', zh: '低風險' } },
        { score: '≥ 2', outcome: { en: 'High risk; assess for sepsis', zh: '高風險；評估敗血症' } },
      ],
    },
    note: { en: 'Range 0–3. ≥ 2 predicts worse outcomes outside the ICU.', zh: '範圍 0–3。≥ 2 於非加護病房預示較差預後。' },
  },
  'sirs': {
    factors: [
      { label: { en: 'Temperature > 38 or < 36 °C', zh: '體溫 > 38 或 < 36 °C' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Heart rate > 90 bpm', zh: '心率 > 90 bpm' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Respiratory rate > 20/min', zh: '呼吸速率 > 20/分' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'WBC > 12 or < 4 ×10⁹/L', zh: '白血球 > 12 或 < 4 ×10⁹/L' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total criteria', zh: '符合項數' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 2', outcome: { en: 'SIRS not met', zh: '未符合 SIRS' } },
        { score: '≥ 2', outcome: { en: 'SIRS present', zh: '符合 SIRS' } },
      ],
    },
    note: { en: 'Range 0–4. ≥ 2 of 4 criteria defines SIRS.', zh: '範圍 0–4。4 項中符合 ≥ 2 項即為 SIRS。' },
  },
  'aa-gradient': {
    formula: {
      en: 'PAO₂ = FiO₂ × (760 − 47) − PaCO₂ / 0.8;  A-a gradient = PAO₂ − PaO₂;  expected ≤ age/4 + 4',
      zh: 'PAO₂ = FiO₂ × (760 − 47) − PaCO₂ / 0.8；A-a 梯度 = PAO₂ − PaO₂；預期值 ≤ 年齡/4 + 4',
    },
    outcome: {
      scoreHeader: { en: 'A-a gradient', zh: 'A-a 梯度' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '≤ age/4 + 4', outcome: { en: 'Within expected range for age', zh: '在年齡預期範圍內' } },
        { score: '> age/4 + 4', outcome: { en: 'Elevated for age — impaired gas exchange', zh: '高於年齡預期 — 氣體交換異常' } },
      ],
    },
    note: { en: 'FiO₂ as %; barometric 760 mmHg, water vapor 47 mmHg, respiratory quotient 0.8.', zh: 'FiO₂ 以 % 輸入；大氣壓 760 mmHg、水蒸氣壓 47 mmHg、呼吸商 0.8。' },
  },
  'pf-ratio': {
    formula: { en: 'P/F ratio = PaO₂ (mmHg) / (FiO₂ / 100)', zh: 'P/F 氧合指數 = PaO₂ (mmHg) / (FiO₂ / 100)' },
    outcome: {
      scoreHeader: { en: 'P/F ratio', zh: 'P/F 氧合指數' },
      outcomeHeader: { en: 'ARDS severity', zh: 'ARDS 嚴重度' },
      rows: [
        { score: '> 300', outcome: { en: 'Normal / no ARDS', zh: '正常 / 無 ARDS' } },
        { score: '201–300', outcome: { en: 'Mild ARDS', zh: '輕度 ARDS' } },
        { score: '101–200', outcome: { en: 'Moderate ARDS', zh: '中度 ARDS' } },
        { score: '≤ 100', outcome: { en: 'Severe ARDS', zh: '重度 ARDS' } },
      ],
    },
    note: { en: 'Berlin ARDS definition, with PEEP ≥ 5 cmH₂O. FiO₂ entered as %.', zh: 'Berlin ARDS 定義，需 PEEP ≥ 5 cmH₂O。FiO₂ 以 % 輸入。' },
  },
  'gcs': {
    factors: [
      { label: { en: 'Eye opening (E)', zh: '睜眼反應 (E)' }, options: [ { label: { en: 'Spontaneous', zh: '自動睜眼' }, points: '4' }, { label: { en: 'To speech', zh: '呼喚睜眼' }, points: '3' }, { label: { en: 'To pain', zh: '疼痛睜眼' }, points: '2' }, { label: { en: 'None', zh: '無反應' }, points: '1' } ] },
      { label: { en: 'Verbal response (V)', zh: '語言反應 (V)' }, options: [ { label: { en: 'Oriented', zh: '正常對話' }, points: '5' }, { label: { en: 'Confused', zh: '答非所問' }, points: '4' }, { label: { en: 'Inappropriate words', zh: '不當字句' }, points: '3' }, { label: { en: 'Incomprehensible sounds', zh: '無法理解的聲音' }, points: '2' }, { label: { en: 'None', zh: '無反應' }, points: '1' } ] },
      { label: { en: 'Motor response (M)', zh: '運動反應 (M)' }, options: [ { label: { en: 'Obeys commands', zh: '遵從指令' }, points: '6' }, { label: { en: 'Localizes pain', zh: '疼痛定位' }, points: '5' }, { label: { en: 'Withdraws from pain', zh: '疼痛回縮' }, points: '4' }, { label: { en: 'Abnormal flexion', zh: '異常屈曲' }, points: '3' }, { label: { en: 'Abnormal extension', zh: '異常伸直' }, points: '2' }, { label: { en: 'None', zh: '無反應' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (E + V + M, 3–15)', zh: '總分（E + V + M，3–15）' },
      outcomeHeader: { en: 'Severity', zh: '嚴重度' },
      rows: [
        { score: '≤ 8', outcome: { en: 'Severe; consider airway protection', zh: '重度；考慮氣道保護' } },
        { score: '9–12', outcome: { en: 'Moderate', zh: '中度' } },
        { score: '13–15', outcome: { en: 'Mild', zh: '輕度' } },
      ],
    },
  },
  'nihss': {
    factors: [
      { label: { en: '1a–1c. Level of consciousness', zh: '1a–1c. 意識程度' }, options: [ { label: { en: '1a LOC (alert → coma)', zh: '1a 意識（清醒→昏迷）' }, points: '0–3' }, { label: { en: '1b LOC questions', zh: '1b 意識提問' }, points: '0–2' }, { label: { en: '1c LOC commands', zh: '1c 意識指令' }, points: '0–2' } ] },
      { label: { en: '2–4. Gaze / fields / face', zh: '2–4. 眼球 / 視野 / 顏面' }, options: [ { label: { en: '2 Best gaze', zh: '2 眼球水平運動' }, points: '0–2' }, { label: { en: '3 Visual fields', zh: '3 視野' }, points: '0–3' }, { label: { en: '4 Facial palsy', zh: '4 顏面麻痺' }, points: '0–3' } ] },
      { label: { en: '5–6. Motor limbs', zh: '5–6. 肢體運動' }, options: [ { label: { en: '5a/5b Motor arm (L / R)', zh: '5a/5b 上肢運動（左／右）' }, points: '0–4 ea' }, { label: { en: '6a/6b Motor leg (L / R)', zh: '6a/6b 下肢運動（左／右）' }, points: '0–4 ea' } ] },
      { label: { en: '7–11. Ataxia / sensory / language', zh: '7–11. 協調 / 感覺 / 語言' }, options: [ { label: { en: '7 Limb ataxia', zh: '7 肢體協調不良' }, points: '0–2' }, { label: { en: '8 Sensory', zh: '8 感覺' }, points: '0–2' }, { label: { en: '9 Best language', zh: '9 語言' }, points: '0–3' }, { label: { en: '10 Dysarthria', zh: '10 構音障礙' }, points: '0–2' }, { label: { en: '11 Extinction / inattention', zh: '11 忽略／不注意' }, points: '0–2' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–42)', zh: '總分（0–42）' },
      outcomeHeader: { en: 'Stroke severity', zh: '中風嚴重度' },
      rows: [
        { score: '0', outcome: { en: 'No stroke symptoms', zh: '無中風症狀' } },
        { score: '1–4', outcome: { en: 'Minor stroke', zh: '輕微中風' } },
        { score: '5–15', outcome: { en: 'Moderate stroke', zh: '中度中風' } },
        { score: '16–20', outcome: { en: 'Moderate–severe stroke', zh: '中重度中風' } },
        { score: '21–42', outcome: { en: 'Severe stroke', zh: '重度中風' } },
      ],
    },
    note: { en: '15 items summed; higher = more severe. Guides thrombolysis / thrombectomy decisions.', zh: '15 個項目加總，分數越高越嚴重。可協助溶栓／取栓決策。' },
  },
  'abcd2': {
    factors: [
      { label: { en: 'Age ≥ 60', zh: '年齡 ≥ 60' }, options: [ { label: { en: 'No', zh: '否' }, points: '0' }, { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'BP ≥ 140/90 mmHg', zh: '血壓 ≥ 140/90 mmHg' }, options: [ { label: { en: 'No', zh: '否' }, points: '0' }, { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
      { label: { en: 'Clinical features', zh: '臨床特徵' }, options: [ { label: { en: 'Other', zh: '其他' }, points: '0' }, { label: { en: 'Speech disturbance, no weakness', zh: '言語障礙、無無力' }, points: '1' }, { label: { en: 'Unilateral weakness', zh: '單側無力' }, points: '2' } ] },
      { label: { en: 'Duration of symptoms', zh: '症狀持續時間' }, options: [ { label: { en: '< 10 min', zh: '< 10 分' }, points: '0' }, { label: { en: '10–59 min', zh: '10–59 分' }, points: '1' }, { label: { en: '≥ 60 min', zh: '≥ 60 分' }, points: '2' } ] },
      { label: { en: 'Diabetes', zh: '糖尿病' }, options: [ { label: { en: 'No', zh: '否' }, points: '0' }, { label: { en: 'Yes', zh: '是' }, points: '1' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–7)', zh: '總分（0–7）' },
      outcomeHeader: { en: 'Risk (2 / 7 / 90-day stroke)', zh: '風險（2／7／90 天中風）' },
      rows: [
        { score: '0–3', outcome: { en: 'Low — 1.0% / 1.2% / 3.1%', zh: '低風險 — 1.0% / 1.2% / 3.1%' } },
        { score: '4–5', outcome: { en: 'Moderate — 4.1% / 5.9% / 9.8%', zh: '中度風險 — 4.1% / 5.9% / 9.8%' } },
        { score: '6–7', outcome: { en: 'High — 8.1% / 11.7% / 17.8%', zh: '高風險 — 8.1% / 11.7% / 17.8%' } },
      ],
    },
    note: { en: 'Stroke risks are the pooled validation cohort (Johnston 2007). An adjunct, not a substitute for specialist assessment.', zh: '中風風險為合併驗證世代之數據（Johnston 2007）。僅為輔助工具，不能取代專科評估。' },
  },
  'mrs': {
    factors: [
      { label: { en: 'Functional status (grade selected)', zh: '功能狀態（選擇等級）' }, options: [ { label: { en: 'No symptoms', zh: '無症狀' }, points: '0' }, { label: { en: 'No significant disability', zh: '無明顯失能' }, points: '1' }, { label: { en: 'Slight disability', zh: '輕度失能' }, points: '2' }, { label: { en: 'Moderate disability (walks unaided)', zh: '中度失能（可自行走動）' }, points: '3' }, { label: { en: 'Moderately severe (needs help walking)', zh: '中重度失能（行走需協助）' }, points: '4' }, { label: { en: 'Severe (bedridden, incontinent)', zh: '重度失能（臥床、失禁）' }, points: '5' }, { label: { en: 'Dead', zh: '死亡' }, points: '6' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Grade (0–6)', zh: '等級（0–6）' },
      outcomeHeader: { en: 'Functional outcome', zh: '功能結果' },
      rows: [
        { score: '0', outcome: { en: 'No symptoms at all', zh: '完全無症狀' } },
        { score: '1', outcome: { en: 'No significant disability — usual activities', zh: '無明顯失能 — 可從事日常活動' } },
        { score: '2', outcome: { en: 'Slight disability — independent but limited', zh: '輕度失能 — 部分活動受限但生活可自理' } },
        { score: '3', outcome: { en: 'Moderate — some help, walks unassisted', zh: '中度失能 — 需部分協助，可自行走動' } },
        { score: '4', outcome: { en: 'Moderately severe — cannot walk / self-care unaided', zh: '中重度失能 — 行走與生活需協助' } },
        { score: '5', outcome: { en: 'Severe — bedridden, incontinent, constant care', zh: '重度失能 — 臥床、失禁、需全時照護' } },
        { score: '6', outcome: { en: 'Dead', zh: '死亡' } },
      ],
    },
    note: { en: 'Grade 0–1 favourable; 2–3 moderate; 4–6 severe. van Swieten 1988.', zh: '0–1 級預後佳；2–3 級中度；4–6 級重度。van Swieten 1988。' },
  },
  'epworth': {
    factors: [
      { label: { en: 'Each of 8 situations — chance of dozing', zh: '八種情境各自的打瞌睡機會' }, options: [ { label: { en: 'Would never doze', zh: '從不打瞌睡' }, points: '0' }, { label: { en: 'Slight chance', zh: '很少' }, points: '1' }, { label: { en: 'Moderate chance', zh: '中等機會' }, points: '2' }, { label: { en: 'High chance', zh: '很可能' }, points: '3' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–24)', zh: '總分（0–24）' },
      outcomeHeader: { en: 'Daytime sleepiness', zh: '白天嗜睡程度' },
      rows: [
        { score: '0–10', outcome: { en: 'Normal', zh: '正常' } },
        { score: '11–14', outcome: { en: 'Mild sleepiness', zh: '輕度嗜睡' } },
        { score: '15–17', outcome: { en: 'Moderate sleepiness', zh: '中度嗜睡' } },
        { score: '18–24', outcome: { en: 'Severe sleepiness', zh: '重度嗜睡' } },
      ],
    },
    note: { en: '8 items, each 0–3. > 10 suggests excessive daytime sleepiness (Johns 1991).', zh: '8 題，每題 0–3 分。> 10 提示白天過度嗜睡（Johns 1991）。' },
  },
  'anc': {
    formula: { en: 'ANC (/µL) = WBC (10⁹/L) × 1000 × (% neutrophils + % bands) / 100', zh: 'ANC (/µL) = 白血球 (10⁹/L) × 1000 × (嗜中性球% + 帶狀核%) / 100' },
    outcome: {
      scoreHeader: { en: 'ANC (/µL)', zh: 'ANC (/µL)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 500', outcome: { en: 'Severe neutropenia', zh: '嚴重嗜中性球低下' } },
        { score: '500–1000', outcome: { en: 'Moderate neutropenia', zh: '中度低下' } },
        { score: '1000–1500', outcome: { en: 'Mild neutropenia', zh: '輕度低下' } },
        { score: '≥ 1500', outcome: { en: 'Normal', zh: '正常' } },
      ],
    },
    note: { en: 'Bands default to 0 if not entered.', zh: '未填帶狀核時預設為 0。' },
  },
  'reticulocyte-index': {
    formula: {
      en: 'Corrected retic = retic% × (Hct / 45);  RPI = corrected retic / maturation factor.  Maturation: Hct ≥ 36 → 1;  26–35 → 1.5;  16–25 → 2;  < 16 → 2.5',
      zh: '校正網狀紅血球 = 網狀紅血球% × (Hct / 45)；RPI = 校正網狀紅血球 / 成熟因子。成熟因子：Hct ≥ 36 → 1；26–35 → 1.5；16–25 → 2；< 16 → 2.5',
    },
    outcome: {
      scoreHeader: { en: 'RPI', zh: 'RPI' },
      outcomeHeader: { en: 'Marrow response', zh: '骨髓反應' },
      rows: [
        { score: '≥ 2', outcome: { en: 'Adequate response (e.g. hemolysis, blood loss)', zh: '反應足夠（如溶血、失血）' } },
        { score: '< 2', outcome: { en: 'Inadequate response (hypoproliferative anemia)', zh: '反應不足（增生不良性貧血）' } },
      ],
    },
  },
  'ldl-friedewald': {
    formula: { en: 'LDL (mg/dL) = Total cholesterol − HDL − (Triglycerides / 5)', zh: 'LDL (mg/dL) = 總膽固醇 − HDL − (三酸甘油酯 / 5)' },
    outcome: {
      scoreHeader: { en: 'LDL (mg/dL)', zh: 'LDL (mg/dL)' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '< 100', outcome: { en: 'Optimal', zh: '理想' } },
        { score: '100–129', outcome: { en: 'Near optimal', zh: '接近理想' } },
        { score: '130–159', outcome: { en: 'Borderline high', zh: '邊緣偏高' } },
        { score: '160–189', outcome: { en: 'High', zh: '偏高' } },
        { score: '≥ 190', outcome: { en: 'Very high', zh: '非常高' } },
      ],
    },
    note: { en: 'Invalid when triglycerides ≥ 400 mg/dL — use a direct LDL assay.', zh: '三酸甘油酯 ≥ 400 mg/dL 時不適用，請改用直接 LDL 檢測。' },
  },
  'eag-from-a1c': {
    formula: { en: 'eAG (mg/dL) = 28.7 × HbA1c(%) − 46.7;  eAG (mmol/L) = eAG(mg/dL) / 18', zh: 'eAG (mg/dL) = 28.7 × HbA1c(%) − 46.7；eAG (mmol/L) = eAG(mg/dL) / 18' },
    outcome: {
      scoreHeader: { en: 'HbA1c', zh: 'HbA1c' },
      outcomeHeader: { en: 'Glycemic range', zh: '血糖範圍' },
      rows: [
        { score: '< 5.7%', outcome: { en: 'Normal range', zh: '正常範圍' } },
        { score: '5.7–6.4%', outcome: { en: 'Prediabetes range', zh: '糖尿病前期' } },
        { score: '≥ 6.5%', outcome: { en: 'Diabetes range', zh: '糖尿病範圍' } },
      ],
    },
    note: { en: 'ADAG study (Nathan 2008).', zh: 'ADAG 研究（Nathan 2008）。' },
  },
  'ideal-body-weight': {
    formula: {
      en: 'IBW (kg) = 50 (M) / 45.5 (F) + 2.3 × (inches − 60), inches = height(cm) / 2.54.  Adjusted BW = IBW + 0.4 × (actual weight − IBW)',
      zh: 'IBW (kg) = 50（男）/ 45.5（女）+ 2.3 ×（英吋 − 60），英吋 = 身高(cm) / 2.54。校正體重 = IBW + 0.4 ×（實際體重 − IBW）',
    },
    outcome: {
      scoreHeader: { en: 'Output', zh: '輸出' },
      outcomeHeader: { en: 'Meaning', zh: '意義' },
      rows: [
        { score: 'IBW', outcome: { en: 'Ideal body weight (Devine)', zh: '理想體重 (Devine)' } },
        { score: 'Adjusted BW', outcome: { en: 'Shown when actual weight is entered; used for dosing', zh: '填入實際體重時顯示；供劑量計算用' } },
      ],
    },
    note: { en: 'Devine 1974.', zh: 'Devine 1974。' },
  },
  'bmi': {
    formula: { en: 'BMI (kg/m²) = weight (kg) / [height (m)]²', zh: 'BMI (kg/m²) = 體重 (kg) / [身高 (m)]²' },
    outcome: {
      scoreHeader: { en: 'BMI (kg/m²)', zh: 'BMI (kg/m²)' },
      outcomeHeader: { en: 'Category', zh: '分類' },
      rows: [
        { score: '< 18.5', outcome: { en: 'Underweight', zh: '體重過輕' } },
        { score: '18.5–23.9', outcome: { en: 'Normal', zh: '正常範圍' } },
        { score: '24–26.9', outcome: { en: 'Overweight', zh: '過重' } },
        { score: '27–29.9', outcome: { en: 'Obesity class I', zh: '輕度肥胖' } },
        { score: '30–34.9', outcome: { en: 'Obesity class II', zh: '中度肥胖' } },
        { score: '≥ 35', outcome: { en: 'Obesity class III', zh: '重度肥胖' } },
      ],
    },
    note: { en: 'Taiwan MOHW cutoffs.', zh: '採衛福部標準。' },
  },
  'gds-15': {
    factors: [
      { label: { en: 'Each item (depression-scored answer)', zh: '每題（憂鬱方向作答）' }, options: [ { label: { en: 'Answer in the depression direction', zh: '答在憂鬱方向' }, points: '1' }, { label: { en: 'Answer in the non-depression direction', zh: '答在非憂鬱方向' }, points: '0' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–15)', zh: '總分（0–15）' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '0–4', outcome: { en: 'Normal', zh: '正常' } },
        { score: '5–8', outcome: { en: 'Suggests mild depression', zh: '疑似輕度憂鬱' } },
        { score: '9–11', outcome: { en: 'Suggests moderate depression', zh: '疑似中度憂鬱' } },
        { score: '12–15', outcome: { en: 'Suggests severe depression', zh: '疑似重度憂鬱' } },
      ],
    },
    note: { en: 'Each item scores 1 in the depression direction (some questions reverse-keyed). ≥ 5 suggests depression — a screen, not a diagnosis.', zh: '每題答在憂鬱方向記 1 分（部分題目為反向計分）。≥ 5 疑似憂鬱——為篩檢非診斷。' },
  },
  'phq-9': {
    factors: [
      { label: { en: 'Each item (over the last 2 weeks)', zh: '每題（最近兩週）' }, options: [ { label: { en: 'Not at all', zh: '完全沒有' }, points: '0' }, { label: { en: 'Several days', zh: '好幾天' }, points: '1' }, { label: { en: 'More than half the days', zh: '一半以上天數' }, points: '2' }, { label: { en: 'Nearly every day', zh: '幾乎每天' }, points: '3' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–27)', zh: '總分（0–27）' },
      outcomeHeader: { en: 'Severity', zh: '嚴重度' },
      rows: [
        { score: '0–4', outcome: { en: 'Minimal', zh: '極輕微' } },
        { score: '5–9', outcome: { en: 'Mild', zh: '輕度' } },
        { score: '10–14', outcome: { en: 'Moderate', zh: '中度' } },
        { score: '15–19', outcome: { en: 'Moderately severe', zh: '中重度' } },
        { score: '20–27', outcome: { en: 'Severe', zh: '重度' } },
      ],
    },
    note: { en: '9 items × 0–3. ≥ 10 suggests major depression; if item 9 (self-harm) > 0, assess safety. A screen, not a diagnosis.', zh: '9 題 × 0–3。≥ 10 疑似重度憂鬱；若第 9 題（自傷）> 0，須評估安全。為篩檢非診斷。' },
  },
  'gad-7': {
    factors: [
      { label: { en: 'Each item (over the last 2 weeks)', zh: '每題（最近兩週）' }, options: [ { label: { en: 'Not at all', zh: '完全沒有' }, points: '0' }, { label: { en: 'Several days', zh: '好幾天' }, points: '1' }, { label: { en: 'More than half the days', zh: '一半以上天數' }, points: '2' }, { label: { en: 'Nearly every day', zh: '幾乎每天' }, points: '3' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–21)', zh: '總分（0–21）' },
      outcomeHeader: { en: 'Severity', zh: '嚴重度' },
      rows: [
        { score: '0–4', outcome: { en: 'Minimal', zh: '極輕微' } },
        { score: '5–9', outcome: { en: 'Mild', zh: '輕度' } },
        { score: '10–14', outcome: { en: 'Moderate', zh: '中度' } },
        { score: '15–21', outcome: { en: 'Severe', zh: '重度' } },
      ],
    },
    note: { en: '7 items × 0–3. ≥ 10 warrants further evaluation. A screen, not a diagnosis.', zh: '7 題 × 0–3。≥ 10 需進一步評估。為篩檢非診斷。' },
  },
  'cage': {
    factors: [
      { label: { en: 'Each item', zh: '每題' }, options: [ { label: { en: 'Yes', zh: '是' }, points: '1' }, { label: { en: 'No', zh: '否' }, points: '0' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–4)', zh: '總分（0–4）' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '0–1', outcome: { en: 'Low concern', zh: '較無疑慮' } },
        { score: '2–4', outcome: { en: 'Clinically significant — assess further', zh: '有臨床意義，需進一步評估' } },
      ],
    },
    note: { en: '1 point per "Yes". ≥ 2 is clinically significant for alcohol use disorder. A screen, not a diagnosis.', zh: '每答「是」記 1 分。≥ 2 對酒精使用障礙具臨床意義。為篩檢非診斷。' },
  },
  'audit-c': {
    factors: [
      { label: { en: 'Each item', zh: '每題' }, options: [ { label: { en: 'Lowest-consumption response', zh: '飲酒量最低的選項' }, points: '0' }, { label: { en: 'Increasing consumption', zh: '飲酒量遞增' }, points: '1–3' }, { label: { en: 'Highest-consumption response', zh: '飲酒量最高的選項' }, points: '4' } ] },
    ],
    outcome: {
      scoreHeader: { en: 'Total (0–12)', zh: '總分（0–12）' },
      outcomeHeader: { en: 'Interpretation', zh: '判讀' },
      rows: [
        { score: '0–3', outcome: { en: 'Low risk', zh: '低風險' } },
        { score: '≥ 4 (M) / ≥ 3 (F)', outcome: { en: 'Suggests hazardous drinking', zh: '疑似危害性飲酒' } },
      ],
    },
    note: { en: '3 items × 0–4. Positive: ≥ 4 (men) / ≥ 3 (women). A screen, not a diagnosis.', zh: '3 題 × 0–4。陽性：≥ 4（男）/ ≥ 3（女）。為篩檢非診斷。' },
  },
}

export function getCalcScoring(id: string): CalcScoring | undefined {
  return CALC_SCORING[id]
}
