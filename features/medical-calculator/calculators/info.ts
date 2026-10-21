import type { L } from '../types'

/** MDCalc-style "When to Use" (patient population / indication) + "Pearls /
 *  Pitfalls" (caveats, when NOT to rely on it). Kept in a separate map, like
 *  CALC_TAGS, so the formula defs stay lean. */
export interface CalcInfo {
  useWhen?: L
  caveats?: L
}

export const CALC_INFO: Record<string, CalcInfo> = {
  'prevent-ascvd': {
    useWhen: { zh: '30–79 歲初級預防之 10 年 ASCVD 風險；30–59 歲另估 30 年。血脂治療判讀需核對 LDL-C 70–189 mg/dL 及疾病專屬適應症。', en: '10-year ASCVD risk for primary prevention at age 30–79; 30-year risk at age 30–59. Lipid treatment guidance requires LDL-C 70–189 mg/dL and review of disease-specific indications.' },
    caveats: { zh: '本流程排除已有 CVD、亞臨床動脈粥樣硬化、遺傳性 CVD、末期腎病及壽命不足一年者。採美國基礎模型，無台灣校準，不含 UACR/HbA1c/SDI。缺值不補零，不以調整用藥輸入推算治療效益。', en: 'This pathway excludes known CVD, subclinical atherosclerosis, inherited CVD, ESKD and life expectancy under one year. US base model without Taiwanese calibration or UACR/HbA1c/SDI. Missing values are not zero; changing treatment inputs does not estimate treatment benefit.' },
  },
  'h2fpef': {
    useWhen: { en: 'Unexplained exertional dyspnea in adults with preserved EF.', zh: '成人射出分率保留，且有原因未明的活動性呼吸困難。' },
    caveats: { en: 'AF uses diagnosis codes first, then ECG history; a negative reflects available records only. Antihypertensives use deduplicated ingredients in valid prescriptions; confirm actual use. Auto-filled echo values come from one report; review its date, technique and source. A preserved EF alone does not establish HFpEF.', zh: 'AF 先查診斷碼，再查 EKG；「否」僅表示目前紀錄未見 AF，請核對病史。降壓藥按有效處方成分去重推算，請核對實際使用情形。心超值取自同一份報告，請核對日期、測量方式與原文；EF 保留本身不能確診 HFpEF。' },
  },
  'hfa-peff': {
    useWhen: { en: 'Step E in the HFA-PEFF diagnostic workup of stable symptomatic patients with preserved EF.', zh: '穩定、有症狀且 EF 保留者之 HFA-PEFF 診斷流程 Step E。' },
    caveats: { en: 'Confirm age, sex and rhythm. Use averaged E/e′; E and both e′ values are only needed when the average ratio is not provided. Enter NT-proBNP or BNP with a confirmed assay. Missing values are unknown, not normal. Appcardio omits age and sex inputs; this implementation follows consensus-specific thresholds.', zh: '請確認年齡、性別與心律（由最近 EKG 帶入，需核對是否代表評估時心律）。E/e′ 應取平均值；若報告已有平均比值，不必再填 E 波以推算。NT-proBNP 或 BNP 擇已確認的檢驗填入。缺值不視為正常。Appcardio 未提供年齡、性別輸入，本計算機依原始共識門檻判讀。' },
  },
  'maggic-hf': {
    useWhen: { en: 'Discussing 1- and 3-year all-cause mortality in an adult with stable chronic heart failure across the LVEF spectrum.', zh: '成人慢性心衰竭穩定期，用於討論各種 LVEF 範圍的 1 年與 3 年全因死亡率。' },
    caveats: { en: 'Not an acute-decompensation score. Use a clinically coherent stable-time-point dataset and verify medication exposure. The published lookup table covers scores 0–50; higher scores are shown without extrapolating a mortality probability.', zh: '不是急性失代償期評分。請使用同一穩定時點且彼此一致的資料，並核對實際用藥。原始機率表僅涵蓋 0–50 分；超過 50 分時只顯示分數，不外推死亡率。' },
  },
  'life-preserved': {
    useWhen: { en: 'Confirmed HFpEF with current and all prior documented LVEF ≥50%, completed age 40–89, to estimate 2-year, 10-year and remaining-lifetime risk of first HF hospitalization or cardiovascular death.', zh: '已確認 HFpEF、目前及過去所有已記錄 LVEF 均 ≥50%、完成歲數 40–89 歲者，用於估算首次心衰竭住院或心血管死亡的 2 年、10 年與餘生風險。' },
    caveats: { en: 'Do not use preserved LVEF alone to diagnose HFpEF, or apply this model to HF with improved EF after any prior LVEF <50%. Inputs outside the author calculator’s displayed ranges are not extrapolated. The model uses sex-specific SwedeHF baseline risks without Taiwan recalibration and treats non-CV death as a competing event. Investigational prognosis support only—not a medical device or treatment recommendation. Distinguish any prior HF hospitalization from one within the last 6 months.', zh: '不能僅憑 LVEF 保留診斷 HFpEF；若過去曾有 LVEF <50%（HFimpEF），亦不應套用。超出作者計算機顯示範圍的輸入不予外推。模型採用依性別區分的 SwedeHF 基準風險，尚未經台灣校正，並將非心血管死亡視為競爭事件。僅供研究性預後輔助；不是醫療器材或治療建議。請區分任何既往心衰竭住院與近 6 個月內住院。' },
  },
  'egfr-ckd-epi-2021': {
    useWhen: { en: 'Staging and monitoring CKD in stable adults (≥18 y).', zh: '穩定成人（≥18 歲）之慢性腎臟病分期與追蹤。' },
    caveats: { en: 'Assumes steady-state creatinine — unreliable in AKI / rapidly changing renal function; less accurate at extremes of muscle mass, in pregnancy, or amputees.', zh: '假設肌酸酐處於穩定狀態 — 急性腎損傷或腎功能快速變化時不可靠；肌肉量極端、懷孕或截肢者較不準。' },
  },
  'egfr-mdrd': {
    useWhen: { en: 'CKD staging (older equation; CKD-EPI 2021 is now preferred).', zh: '慢性腎臟病分期（較舊公式；現以 CKD-EPI 2021 為優先）。' },
    caveats: { en: 'Underestimates GFR above 60; not validated for AKI or extremes of age/body size. Prefer CKD-EPI 2021.', zh: 'GFR > 60 時會低估；未驗證於急性腎損傷或極端年齡／體型。建議改用 CKD-EPI 2021。' },
  },
  'doac-dose-nvaf': {
    useWhen: { en: 'Checking a DOAC dose against each agent’s label for adult NVAF, acute DVT/PE, extended prevention of recurrent VTE, or prophylaxis after hip or knee replacement.', zh: '成人 NVAF、急性 DVT／PE、VTE 延長治療或髖膝置換後預防，依各藥仿單核對 DOAC 劑量。' },
    caveats: { en: 'EU SmPC rules; the Taiwan labels are pending pharmacy review (edoxaban 15 mg, apixaban with dual inhibitors). VTE indications use their own dose rules, not NVAF’s reductions. Peri-procedural interruption is the separate peri-procedural calculator. Does not assess mechanical valves, mitral stenosis, antiphospholipid syndrome, active bleeding or the choice of agent in cancer-associated VTE. A check beside the guideline card; it does not change the CDSS recommendation.', zh: '依 EU SmPC；臺灣仿單待藥學部核對（edoxaban 15 mg、apixaban 併用雙重抑制劑）。VTE 適應症用各自的劑量規則，不套用 NVAF 的減量條件。手術前後停藥請用另一個停藥計算機。不評估機械瓣、二尖瓣狹窄、抗磷脂症候群、活動性出血與癌症相關 VTE 的藥物選擇。僅為指引卡旁的核對，不改變 CDSS 建議。' },
  },
  'doac-periop': {
    useWhen: { en: 'Planning when to stop a DOAC before an elective procedure, spinal/epidural anaesthesia or AF ablation, and when to restart it.', zh: '計畫擇期手術、脊髓／硬膜外麻醉或 AF 消融前何時停 DOAC、術後何時恢復。' },
    caveats: { en: 'EHRA 2021 and ASRA 2018 are guidelines, not labels; each is quoted with its own page. Intervals are minimums and need the team’s individual judgement. No interval is given for CrCl <15, dialysis or dabigatran below 30. Anti-Xa is a drug-calibrated level with no accepted threshold and never clears a patient. No bridging.', zh: 'EHRA 2021 與 ASRA 2018 是指引，不是仿單，各附頁碼。時數為最低間隔，需由團隊個別判斷。CrCl <15、透析、dabigatran CrCl <30 不給停藥時數。anti-Xa 是藥物校正濃度，沒有公認閾值，不據以判定可否手術。不橋接。' },
  },
  'crcl-cockcroft-gault': {
    useWhen: { en: 'Renal drug dosing in stable adults (the equation most drug labels use).', zh: '穩定成人之腎臟藥物劑量調整（多數藥品仿單採用此公式）。' },
    caveats: { en: 'Assumes stable renal function; uses actual body weight — over/underestimates in obesity or edema (consider ideal/adjusted weight). Not for AKI.', zh: '假設腎功能穩定；採實際體重 — 肥胖或水腫時會高／低估（可考慮理想／校正體重）。不適用於急性腎損傷。' },
  },
  'kfre-4-variable': {
    useWhen: {
      en: 'Estimating 2- and 5-year treated kidney-failure risk in adults with stable CKD G3–G5 (eGFR <60) and a quantitative urine ACR.',
      zh: '成人腎功能穩定的 CKD G3–G5（eGFR <60）且已有定量尿液 ACR 時，估算 2 年與 5 年內需透析或腎臟移植的風險。',
    },
    caveats: {
      en: 'Not validated for CKD G1–G2, children, AKI/rapidly changing kidney function, or semiquantitative ACR. This Taiwan-facing implementation uses the published non–North American calibration. Use disease-specific models for IgA nephropathy or ADPKD where appropriate.',
      zh: '未驗證於 CKD G1–G2、兒童、急性腎損傷／腎功能快速變化或半定量 ACR。本台灣版採已發表的非北美校正；IgA 腎病或 ADPKD 應視情況使用疾病專屬模型。',
    },
  },
  'fena': {
    useWhen: { en: 'Oliguric AKI, to distinguish prerenal from intrinsic (ATN).', zh: '寡尿性急性腎損傷，用以區分腎前性與腎實質性（ATN）。' },
    caveats: { en: 'Unreliable on diuretics, in CKD, or contrast/pigment nephropathy — use FEUrea instead. Interpret only in oliguric AKI.', zh: '使用利尿劑、慢性腎臟病或顯影劑／色素腎病時不可靠 — 請改用 FEUrea。僅在寡尿性急性腎損傷判讀。' },
  },
  'feurea': {
    useWhen: { en: 'Prerenal vs ATN when the patient is on diuretics (where FENa is unreliable).', zh: '病人使用利尿劑（FENa 不可靠）時，區分腎前性與 ATN。' },
    caveats: { en: 'Less extensively validated than FENa; affected by osmotic diuresis. Interpret in oliguric AKI.', zh: '驗證不如 FENa 廣泛；受滲透性利尿影響。於寡尿性急性腎損傷判讀。' },
  },
  'meld-na': {
    useWhen: { en: 'Prognosis / transplant prioritization in chronic liver disease (≥12 y).', zh: '慢性肝病（≥12 歲）之預後／移植優先排序。' },
    caveats: { en: 'Not for acute liver failure. INR is affected by anticoagulants; bilirubin by hemolysis. MELD 3.0 is the current UNOS standard.', zh: '不適用於急性肝衰竭。INR 受抗凝劑影響、膽紅素受溶血影響。MELD 3.0 為現行 UNOS 標準。' },
  },
  'meld-3': {
    useWhen: { en: 'Current (2023–) UNOS liver allocation score, ages ≥12 y.', zh: '現行（2023 年起）UNOS 肝臟分配分數，≥12 歲。' },
    caveats: { en: 'Not for acute liver failure. INR affected by anticoagulants.', zh: '不適用於急性肝衰竭。INR 受抗凝劑影響。' },
  },
  'hcc-risk-reveal': {
    useWhen: { en: 'Estimating 10-year liver-cancer risk in a chronic hepatitis B carrier — a patient-facing risk stratifier (as used in Taiwan NHI 健保存摺).', zh: '估算慢性B型肝炎帶原者未來10年肝癌風險 — 民眾可自用的風險分層工具（同健保存摺）。' },
    caveats: { en: 'Only ~80% accurate and validated in chronic HBV; overestimates in non-HBV patients. Does NOT apply to cirrhosis, HCV/HDV/HIV co-infection, prior HCC, or a sudden ALT rise ≥2×. A screen, not a diagnosis — all HBV carriers need regular follow-up regardless of score.', zh: '準確度約8成、僅驗證於慢性B肝；非B肝患者會高估。不適用於肝硬化、合併C肝/D肝/HIV、肝癌病史或ALT突升≥兩倍者。為風險評估非診斷 — 所有B肝帶原者無論分數高低都需定期追蹤。' },
  },
  'ckd-kdigo-risk': {
    useWhen: { en: 'Staging CKD prognosis and setting follow-up frequency once eGFR and albuminuria (ACR or PCR) are known; a patient-facing risk & monitoring guide (as in Taiwan NHI 健保存摺).', zh: '已知 eGFR 與白蛋白尿（ACR 或 PCR）時，評估慢性腎臟病預後風險與追蹤頻率；民眾可自用的風險與追蹤指引（同健保存摺）。' },
    caveats: { en: 'Assumes ACR in mg/g and steady-state eGFR (unreliable in AKI). ACR↔PCR–to-stage relationships are approximate. Green with no other kidney-damage markers is not CKD. A guide, not a diagnosis — discuss management with a clinician.', zh: 'ACR 以 mg/g 計、假設 eGFR 穩定（急性腎損傷時不準）。ACR／PCR 對應分期為近似值。綠色且無其他腎損傷指標未必為慢性腎臟病。此為參考非診斷 — 處置請與醫師討論。' },
  },
  'who-cvd-2019': {
    useWhen: { en: 'Primary-prevention 10-year CVD risk in adults aged 40–80 without known cardiovascular disease; a patient-facing estimate.', zh: '40–80 歲、無已知心血管疾病成人之10年心血管疾病風險（初級預防）；民眾可自用的估算。' },
    caveats: { en: 'This is the WHO 2019 model, NOT Taiwan\'s official NHI 健保 algorithm (whose coefficients are unpublished) — numbers may differ from 健保存摺. Uses the pooled, un-recalibrated baseline (not East-Asia-specific). Total cholesterol taken in mg/dL and converted to mmol/L. Not for people with established CVD; validated for ages 40–80. A screen, not a diagnosis.', zh: '此為 WHO 2019 模型，非健保署官方演算法（其係數未公開）— 數值可能與健保存摺不同。採用未經區域校正的合併基準（非東亞專屬）。總膽固醇以 mg/dL 輸入並換算為 mmol/L。不適用於已有心血管疾病者；驗證範圍為 40–80 歲。為風險評估非診斷。' },
  },
  'hpa-chronic-risk-reconstruction': {
    useWhen: { en: 'A local, approximate 10-year estimate for Taiwanese adults 35–70, corresponding to the HPA website’s five outcomes.', zh: '35–70 歲成人之五項慢性病未來 10 年風險本地近似估計。' },
    caveats: { en: 'The reconstructed model matched official displayed percentages and grades in the checked synthetic cases, not a clinical validation or a guarantee for all inputs. Ranges describe local testing, not normal values; do not alter a correct value just to obtain a result. Confirm history, fasting status and dates before interpretation.', zh: '重建公式在已驗算的合成案例中，顯示百分比與分級均與官網一致；這不是臨床準確率，也不保證所有輸入。驗算範圍不是正常值範圍，請勿為取得結果而改小或改大正確數值。判讀前請核對病史、空腹狀態與日期。' },
  },
  'child-pugh': {
    useWhen: { en: 'Cirrhosis severity, surgical risk, and prognosis.', zh: '肝硬化嚴重度、手術風險與預後。' },
    caveats: { en: 'Ascites and encephalopathy grading is subjective; less objective than MELD. Not for acute liver failure.', zh: '腹水與肝腦病變分級較主觀；客觀性不如 MELD。不適用於急性肝衰竭。' },
  },
  'fib-4': {
    useWhen: { en: 'Non-invasive fibrosis screen in chronic hepatitis C/B and NAFLD.', zh: '慢性 C／B 型肝炎與脂肪肝之非侵入性纖維化篩檢。' },
    caveats: { en: 'Indeterminate zone (1.45–3.25) is common; less reliable under 35 and over 65 y. Not a substitute for elastography/biopsy.', zh: '灰色地帶（1.45–3.25）常見；< 35 歲與 > 65 歲較不可靠。不能取代彈性造影／切片。' },
  },
  'apri': {
    useWhen: { en: 'Fibrosis / cirrhosis screen, especially hepatitis C where elastography is unavailable.', zh: '纖維化／肝硬化篩檢，尤其無彈性造影可用之 C 型肝炎。' },
    caveats: { en: 'Many patients fall in the indeterminate range; AST rises from non-hepatic causes too.', zh: '許多病人落在無法判定區間；AST 亦可因非肝臟原因上升。' },
  },
  'nafld-fibrosis': {
    useWhen: { en: 'Advanced-fibrosis risk in patients with known NAFLD.', zh: '已知脂肪肝病人之進展性纖維化風險評估。' },
    caveats: { en: 'Has an indeterminate zone; validated for NAFLD only.', zh: '有無法判定區間；僅驗證於脂肪肝。' },
  },
  'maddrey-df': {
    useWhen: { en: 'Alcoholic hepatitis — to decide on corticosteroids (≥32 = severe).', zh: '酒精性肝炎 — 決定是否使用類固醇（≥32 為重度）。' },
    caveats: { en: 'Needs PT in seconds against the local control; reassess steroid response with the Lille score at day 7.', zh: '需以秒為單位之 PT 與當地對照值；第 7 天以 Lille 分數評估類固醇反應。' },
  },
  'glasgow-blatchford': {
    useWhen: { en: 'Upper GI bleed at first presentation — to triage need for admission / intervention.', zh: '上消化道出血初診 — 分流是否需住院／介入。' },
    caveats: { en: 'Pre-endoscopy; a score of 0 identifies very-low-risk patients possibly safe for outpatient care. Does not guide timing of endoscopy.', zh: '內視鏡前使用；0 分代表極低風險、或可門診處理。不用於判斷內視鏡時機。' },
  },
  'bisap': {
    useWhen: { en: 'Early (within 24 h) mortality risk in acute pancreatitis.', zh: '急性胰臟炎早期（24 小時內）死亡風險。' },
    caveats: { en: 'Prognostic, not diagnostic; less granular than APACHE II.', zh: '為預後而非診斷工具；細緻度不如 APACHE II。' },
  },
  'ranson': {
    useWhen: { en: 'Acute pancreatitis severity (requires 48 h to complete).', zh: '急性胰臟炎嚴重度（需 48 小時才完整）。' },
    caveats: { en: 'Full score is only available at 48 h; original criteria are for non-gallstone pancreatitis; largely superseded by BISAP/APACHE for early assessment.', zh: '完整分數需 48 小時；原始準則針對非膽石性胰臟炎；早期評估多已由 BISAP／APACHE 取代。' },
  },
  'aims65': {
    useWhen: { en: 'Upper GI bleed — in-hospital mortality prediction.', zh: '上消化道出血 — 院內死亡率預測。' },
    caveats: { en: 'Predicts mortality, not rebleeding. Simple bedside tool.', zh: '預測死亡率而非再出血。為簡易床邊工具。' },
  },
  'rockall': {
    useWhen: { en: 'Upper GI bleed — rebleeding / mortality risk after endoscopy.', zh: '上消化道出血 — 內視鏡後之再出血／死亡風險。' },
    caveats: { en: 'The full score needs endoscopic findings; a pre-endoscopy (clinical) Rockall is a separate, partial score.', zh: '完整分數需內視鏡發現；內視鏡前（臨床）Rockall 是另一個不完整分數。' },
  },
  'corrected-calcium': {
    useWhen: { en: 'Interpreting total calcium when albumin is low.', zh: '白蛋白偏低時，校正判讀總鈣。' },
    caveats: { en: 'Unreliable in critical illness or marked hypoalbuminemia — ionized calcium is the gold standard. Does not adjust for acid-base.', zh: '危重症或明顯低白蛋白時不可靠 — 離子鈣為黃金標準。未校正酸鹼。' },
  },
  'corrected-sodium': {
    useWhen: { en: 'Estimating true sodium in the presence of hyperglycemia.', zh: '高血糖時估算真實血鈉。' },
    caveats: { en: 'The correction factor is debated (1.6 vs 2.4); most relevant when glucose is markedly elevated.', zh: '校正係數有爭議（1.6 vs 2.4）；血糖顯著升高時最有意義。' },
  },
  'anion-gap': {
    useWhen: { en: 'Evaluating a metabolic acidosis (high- vs normal-gap).', zh: '評估代謝性酸中毒（高／正常間隙）。' },
    caveats: { en: 'Correct for albumin (each 1 g/dL below normal lowers the gap ~2.5); the normal range varies by lab/analyzer.', zh: '需以白蛋白校正（每低 1 g/dL，間隙約低 2.5）；正常範圍因實驗室／分析儀而異。' },
  },
  'serum-osmolality': {
    useWhen: { en: 'Estimating osmolality; comparing with a measured value for the osmolar gap.', zh: '估算滲透壓；與實測值比較以求滲透壓間隙。' },
    caveats: { en: 'Calculated only — pair with a measured osmolality for the osmolar gap; add ethanol when relevant.', zh: '僅為計算值 — 需搭配實測滲透壓才能算間隙；必要時納入乙醇。' },
  },
  'free-water-deficit': {
    useWhen: { en: 'Estimating the water deficit in hypernatremia to guide replacement.', zh: '估算高血鈉之缺水量以指引補充。' },
    caveats: { en: 'An estimate — correct slowly (≤ 10–12 mmol/L/day) to avoid cerebral edema; ongoing losses are not included.', zh: '為估算值 — 需緩慢矯正（每日 ≤ 10–12 mmol/L）以免腦水腫；未計入持續流失。' },
  },
  'ttkg': {
    useWhen: { en: 'Evaluating renal potassium handling in hyper- or hypokalemia.', zh: '評估高／低血鉀時腎臟排鉀能力。' },
    caveats: { en: 'Valid only when urine osm > serum osm and urine Na > 25; the underlying assumptions have been questioned — interpret cautiously.', zh: '僅在尿滲透壓 > 血清滲透壓且尿鈉 > 25 時有效；其假設已受質疑 — 判讀需謹慎。' },
  },
  'urine-anion-gap': {
    useWhen: { en: 'Workup of a normal-anion-gap metabolic acidosis (GI vs renal cause).', zh: '正常陰離子間隙代謝性酸中毒之鑑別（腸胃 vs 腎臟）。' },
    caveats: { en: 'Invalid with volume depletion, ketoacidosis, or other unmeasured urinary anions.', zh: '容積不足、酮酸中毒或尿中有其他未測陰離子時無效。' },
  },
  'osmolar-gap': {
    useWhen: { en: 'Suspected toxic-alcohol ingestion (methanol / ethylene glycol).', zh: '疑似毒性酒精中毒（甲醇／乙二醇）。' },
    caveats: { en: 'A normal gap does not exclude toxic alcohol (especially late); include ethanol; measured osmolality must be by freezing-point depression.', zh: '間隙正常不能排除毒性酒精（尤其晚期）；需納入乙醇；實測滲透壓須以冰點下降法測定。' },
  },
  'winters': {
    useWhen: { en: 'Checking respiratory compensation in a metabolic acidosis.', zh: '檢查代謝性酸中毒之呼吸代償。' },
    caveats: { en: 'Applies to metabolic acidosis only; a measured PaCO₂ outside the expected range signals a mixed disorder.', zh: '僅適用於代謝性酸中毒；實測 PaCO₂ 超出預期範圍代表合併型障礙。' },
  },
  'cha2ds2-va': {
    useWhen: { en: 'ESC 2024 thromboembolic risk assessment in AF.', zh: 'ESC 2024 心房顫動血栓風險評估。' },
    caveats: { en: 'No sex point. Missing histories remain unknown. Scores of 2 or more support OAC; consider at 1. Assess valve disease and clinical exceptions separately.', zh: '不計性別。未填病史保留未知；≥2 分建議抗凝，1 分考慮。瓣膜病與其他特殊情境另外評估。' },
  },
  'cha2ds2-vasc': {
    useWhen: { en: 'Stroke risk in non-valvular atrial fibrillation, to guide anticoagulation.', zh: '非瓣膜性心房顫動之中風風險，用以指引抗凝。' },
    caveats: { en: 'Not for valvular AF / mechanical valves (anticoagulate regardless). Balance against bleeding risk (HAS-BLED).', zh: '不適用於瓣膜性 AF／機械瓣膜（一律抗凝）。需與出血風險（HAS-BLED）權衡。' },
  },
  'has-bled': {
    useWhen: { en: 'Bleeding risk in AF patients being considered for anticoagulation.', zh: '評估擬抗凝之心房顫動病人的出血風險。' },
    caveats: { en: 'A high score is NOT a contraindication — it flags modifiable risks to address. Use alongside CHA₂DS₂-VASc.', zh: '高分並非禁忌症 — 而是提示可介入的風險因子。需與 CHA₂DS₂-VASc 併用。' },
  },
  'map': {
    useWhen: { en: 'Estimating perfusion pressure; target ≥ 65 mmHg in shock / sepsis.', zh: '估算灌流壓；休克／敗血症時目標 ≥ 65 mmHg。' },
    caveats: { en: 'Estimated from cuff BP; an arterial line is more accurate in shock; targets are individualized (e.g. higher in chronic hypertension).', zh: '由壓脈帶血壓估算；休克時動脈導管更準；目標需個別化（如慢性高血壓者較高）。' },
  },
  'qtc': {
    useWhen: { en: 'Assessing QT prolongation and torsades risk (e.g. QT-prolonging drugs).', zh: '評估 QT 延長與尖端扭轉風險（如使用延長 QT 之藥物）。' },
    caveats: { en: 'Bazett over-corrects at high heart rates (use Fridericia); unreliable in wide QRS, AF, or marked brady/tachycardia; thresholds differ by sex.', zh: 'Bazett 在快心率時會過度校正（可用 Fridericia）；寬 QRS、AF 或明顯心搏過快／過慢時不可靠；閾值有性別差異。' },
  },
  'heart': {
    useWhen: { en: 'Risk-stratifying undifferentiated chest pain in the ED for 6-week MACE.', zh: '急診未分類胸痛之 6 週主要心臟事件風險分層。' },
    caveats: { en: 'For suspected ACS only; not for STEMI or unstable patients. Troponin cut-offs are assay-dependent.', zh: '僅用於疑似急性冠心症；不適用於 STEMI 或不穩定病人。心肌旋轉素閾值依檢驗方法而定。' },
  },
  'wells-dvt': {
    useWhen: { en: 'Pretest probability of DVT, before D-dimer / ultrasound.', zh: 'D-dimer／超音波前之深部靜脈栓塞前測機率。' },
    caveats: { en: 'For outpatients with suspected DVT; combine with D-dimer when unlikely. Less validated in inpatients and pregnancy.', zh: '用於疑似 DVT 之門診病人；不太可能時搭配 D-dimer。住院病人與孕婦驗證較少。' },
  },
  'wells-pe': {
    useWhen: { en: 'Pretest probability of PE, to guide D-dimer vs imaging.', zh: '肺栓塞前測機率，指引 D-dimer 或影像。' },
    caveats: { en: 'Use with D-dimer (or PERC in low-risk); if high pretest probability, go straight to imaging.', zh: '搭配 D-dimer（低風險可用 PERC）；高前測機率時直接影像檢查。' },
  },
  'curb-65': {
    useWhen: { en: 'Severity of community-acquired pneumonia, to guide admission.', zh: '社區型肺炎之嚴重度，指引是否住院。' },
    caveats: { en: 'For CAP only (not hospital-acquired / aspiration / immunocompromised); does not account for comorbidities or hypoxia — clinical judgment overrides.', zh: '僅用於社區型肺炎（非院內／吸入性／免疫低下）；未納入共病或低血氧 — 臨床判斷優先。' },
  },
  'qsofa': {
    useWhen: { en: 'A rapid bedside flag for sepsis risk outside the ICU.', zh: '非加護環境快速標記敗血症風險。' },
    caveats: { en: 'A prompt, not a diagnosis; ≥ 2 warrants a sepsis workup. Low sensitivity for early sepsis — do not rule out on qSOFA alone.', zh: '為提示而非診斷；≥ 2 應啟動敗血症評估。對早期敗血症敏感度低 — 不可僅憑 qSOFA 排除。' },
  },
  'sirs': {
    useWhen: { en: 'Screening for a systemic inflammatory response / possible sepsis.', zh: '篩檢全身性發炎反應／可能之敗血症。' },
    caveats: { en: 'Non-specific (trauma, pancreatitis, burns also qualify); largely replaced by SOFA/qSOFA in sepsis definitions.', zh: '非特異（創傷、胰臟炎、燒傷亦符合）；敗血症定義已多改用 SOFA／qSOFA。' },
  },
  'aa-gradient': {
    useWhen: { en: 'Evaluating the mechanism of hypoxemia (V/Q mismatch / shunt vs hypoventilation).', zh: '評估低血氧機轉（V/Q 不匹配／分流 vs 換氣不足）。' },
    caveats: { en: 'Needs an ABG on a known FiO₂ and assumes steady state; the normal gradient widens with age and with high FiO₂.', zh: '需已知 FiO₂ 之動脈血氣並假設穩定狀態；正常梯度隨年齡與高 FiO₂ 增寬。' },
  },
  'pf-ratio': {
    useWhen: { en: 'Grading oxygenation / ARDS severity.', zh: '氧合狀態／ARDS 嚴重度分級。' },
    caveats: { en: 'Berlin criteria assume PEEP ≥ 5; affected by FiO₂ and altitude; requires an arterial PaO₂.', zh: '柏林準則假設 PEEP ≥ 5；受 FiO₂ 與海拔影響；需動脈 PaO₂。' },
  },
  'anc': {
    useWhen: { en: 'Assessing neutropenia and infection risk (e.g. during chemotherapy).', zh: '評估嗜中性球低下與感染風險（如化療期間）。' },
    caveats: { en: '< 500 = high infection risk / febrile-neutropenia precautions. Include bands; automated differentials may vary.', zh: '< 500 為高感染風險／需發熱性嗜中性球低下防護。應納入帶狀核；自動分類可能有差異。' },
  },
  'reticulocyte-index': {
    useWhen: { en: 'Distinguishing a hypoproliferative anemia from an appropriate marrow response.', zh: '區分增生不良性貧血與骨髓反應正常。' },
    caveats: { en: 'Needs Hct and reticulocyte %; RPI ≥ 2 indicates an adequate response. Some labs report absolute reticulocytes instead of %.', zh: '需血球比容與網狀紅血球百分比；RPI ≥ 2 代表反應足夠。部分實驗室報告絕對值而非百分比。' },
  },
  'gcs': {
    useWhen: { en: 'Quantifying and trending consciousness in trauma / altered mental status.', zh: '創傷／意識改變時量化並追蹤意識程度。' },
    caveats: { en: 'Score the best response; ≤ 8 → consider airway protection. Intubation, sedation, or aphasia confound the verbal score.', zh: '取最佳反應計分；≤ 8 應考慮氣道保護。插管、鎮靜或失語會干擾語言分數。' },
  },
  'nihss': {
    useWhen: { en: 'Quantifying acute stroke severity; guides thrombolysis/thrombectomy and tracks course.', zh: '量化急性中風嚴重度；指引溶栓／取栓並追蹤病程。' },
    caveats: { en: 'Requires a trained/certified examiner; less sensitive for posterior-circulation strokes.', zh: '需受訓／認證之施測者；對後循環中風敏感度較低。' },
  },
  'abcd2': {
    useWhen: { en: 'Short-term stroke risk after a TIA, to triage urgency.', zh: 'TIA 後短期中風風險，用以分流緊急度。' },
    caveats: { en: 'An adjunct — does not replace urgent specialist assessment and imaging; misses some high-risk causes (carotid stenosis, AF).', zh: '為輔助 — 不能取代緊急專科評估與影像；會漏掉部分高風險原因（頸動脈狹窄、心房顫動）。' },
  },
  'mrs': {
    useWhen: { en: 'Functional outcome / disability after stroke; a common trial endpoint.', zh: '中風後之功能結果／失能程度；常用之試驗終點。' },
    caveats: { en: 'Inter-rater variability — use a structured interview for consistency.', zh: '評分者間差異大 — 建議用結構式訪談以維持一致。' },
  },
  'epworth': {
    useWhen: { en: 'Screening daytime sleepiness (e.g. suspected OSA or narcolepsy).', zh: '篩檢白天嗜睡（如疑似阻塞型睡眠呼吸中止或猝睡症）。' },
    caveats: { en: 'Subjective self-report; > 10 suggests excessive sleepiness → consider a sleep study. Does not identify the cause.', zh: '為主觀自填；> 10 提示嗜睡過度 → 可考慮睡眠檢查。不能辨識病因。' },
  },
  'gds-15': {
    useWhen: { en: 'Depression screen in older adults; can be self-completed.', zh: '老年人憂鬱篩檢；可由本人自填。' },
    caveats: { en: 'A screen, not a diagnosis; less reliable in dementia. A positive screen (≥ 5) warrants clinical assessment.', zh: '為篩檢而非診斷；失智者較不可靠。陽性（≥ 5）應進一步臨床評估。' },
  },
  'phq-9': {
    useWhen: { en: 'Screening and measuring depression severity; monitoring treatment response.', zh: '憂鬱嚴重度篩檢與量測；追蹤治療反應。' },
    caveats: { en: 'A screen, not a diagnosis; item 9 (self-harm) requires a safety assessment. Confirm with a clinical interview.', zh: '為篩檢而非診斷；第 9 題（自傷）需做安全評估。應以臨床會談確認。' },
  },
  'gad-7': {
    useWhen: { en: 'Screening and measuring generalized-anxiety severity.', zh: '廣泛性焦慮嚴重度篩檢與量測。' },
    caveats: { en: 'A screen, not a diagnosis; also elevated in panic, social anxiety, and PTSD. Confirm clinically.', zh: '為篩檢而非診斷；恐慌症、社交焦慮、創傷後壓力症亦會升高。需臨床確認。' },
  },
  'cage': {
    useWhen: { en: 'A brief screen for alcohol use disorder.', zh: '酒精使用障礙之簡短篩檢。' },
    caveats: { en: 'Less sensitive for heavy/binge drinking patterns (AUDIT-C captures consumption better); asks about lifetime, not current, use.', zh: '對大量／狂飲型態較不敏感（AUDIT-C 較能反映飲酒量）；問的是終生而非近期飲酒。' },
  },
  'audit-c': {
    useWhen: { en: 'Screening for hazardous / heavy drinking (consumption-focused).', zh: '危害性／大量飲酒篩檢（著重飲酒量）。' },
    caveats: { en: 'Sex-specific cut-offs; a positive screen should prompt the full AUDIT or further assessment.', zh: '有性別特定閾值；陽性應進行完整 AUDIT 或進一步評估。' },
  },
  'ldl-friedewald': {
    useWhen: { en: 'Estimating LDL from a standard fasting lipid panel.', zh: '由標準空腹血脂估算 LDL。' },
    caveats: { en: 'Invalid when TG ≥ 400 (or non-fasting with high TG) — use a direct LDL; underestimates LDL when LDL is low and TG high.', zh: 'TG ≥ 400（或非空腹高 TG）時無效 — 應用直接 LDL；LDL 低而 TG 高時會低估。' },
  },
  'eag-from-a1c': {
    useWhen: { en: 'Translating HbA1c into an average glucose for patient discussion.', zh: '將 HbA1c 換算為平均血糖以與病人溝通。' },
    caveats: { en: 'HbA1c is unreliable in hemoglobinopathies, recent transfusion, hemolysis, altered RBC turnover, advanced CKD, or pregnancy.', zh: '血紅素病變、近期輸血、溶血、紅血球更新異常、末期腎病或懷孕時 HbA1c 不可靠。' },
  },
  'ideal-body-weight': {
    useWhen: { en: 'Drug dosing and ventilator tidal-volume settings.', zh: '藥物劑量與呼吸器潮氣量設定。' },
    caveats: { en: 'Devine formula estimate; for some drugs in obesity use adjusted body weight.', zh: 'Devine 公式估算；肥胖者部分藥物應改用校正體重。' },
  },
  'bmi': {
    useWhen: { en: 'Weight-status screening in adults.', zh: '成人體重狀態篩檢。' },
    caveats: { en: "Doesn't distinguish muscle from fat — misclassifies athletes and some elderly; Taiwan/Asian cut-offs are lower than WHO.", zh: '無法區分肌肉與脂肪 — 運動員與部分長者易誤判；台灣／亞洲閾值低於 WHO。' },
  },
}

export function getCalcInfo(id: string): CalcInfo {
  return CALC_INFO[id] ?? {}
}
