import type { Purpose, L } from '../types'

/** Purpose + disease tags per calculator (keyed by id). Kept out of the
 *  CalculatorDef bodies so the formula definitions stay lean. */
export interface CalcTags {
  purpose: Purpose[]
  diseases: L[]
}

const CKD: L = { en: 'CKD', zh: '慢性腎臟病' }
const CIRRHOSIS: L = { en: 'Cirrhosis', zh: '肝硬化' }
const FIBROSIS: L = { en: 'Liver fibrosis', zh: '肝纖維化' }
const HEPATITIS: L = { en: 'Hepatitis', zh: '肝炎' }
const AFIB: L = { en: 'Atrial fibrillation', zh: '心房顫動' }
const DOSING: L = { en: 'Drug dosing', zh: '藥物劑量' }
const HEART_FAILURE: L = { en: 'Heart failure', zh: '心衰竭' }
const HFPEF_DISEASE: L = { en: 'HFpEF', zh: '射出分率保留型心衰竭' }

export const CALC_TAGS: Record<string, CalcTags> = {
  'prevent-ascvd': { purpose: ['risk', 'prognosis'], diseases: [{ en: 'Dyslipidemia', zh: '血脂異常' }, { en: 'ASCVD prevention', zh: 'ASCVD 預防' }] },
  'egfr-ckd-epi-2021': { purpose: ['formula'], diseases: [CKD] },
  'kfre-4-variable': { purpose: ['prognosis', 'risk'], diseases: [CKD, { en: 'Kidney failure', zh: '腎衰竭' }] },
  'crcl-cockcroft-gault': { purpose: ['formula'], diseases: [CKD, DOSING] },
  'doac-dose-nvaf': { purpose: ['treatment'], diseases: [AFIB, { en: 'Venous thromboembolism', zh: '靜脈血栓栓塞' }, DOSING] },
  'doac-periop': { purpose: ['treatment'], diseases: [AFIB, { en: 'Peri-operative anticoagulation', zh: '手術前後抗凝' }, DOSING] },
  'meld-na': { purpose: ['prognosis'], diseases: [CIRRHOSIS, { en: 'End-stage liver disease', zh: '末期肝病' }] },
  'child-pugh': { purpose: ['prognosis', 'severity'], diseases: [CIRRHOSIS] },
  'fib-4': { purpose: ['diagnosis'], diseases: [FIBROSIS, HEPATITIS] },
  'apri': { purpose: ['diagnosis'], diseases: [FIBROSIS, HEPATITIS] },
  'nafld-fibrosis': { purpose: ['diagnosis', 'prognosis'], diseases: [{ en: 'NAFLD / fatty liver', zh: '脂肪肝' }] },
  'corrected-calcium': { purpose: ['formula'], diseases: [{ en: 'Hypocalcemia', zh: '低血鈣' }] },
  'corrected-sodium': { purpose: ['formula'], diseases: [{ en: 'Hyponatremia', zh: '低血鈉' }, { en: 'Hyperglycemia', zh: '高血糖' }] },
  'anion-gap': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Metabolic acidosis', zh: '代謝性酸中毒' }] },
  'serum-osmolality': { purpose: ['formula'], diseases: [{ en: 'Hyponatremia', zh: '低血鈉' }] },
  'free-water-deficit': { purpose: ['formula', 'treatment'], diseases: [{ en: 'Hypernatremia', zh: '高血鈉' }] },
  'cha2ds2-va': { purpose: ['prognosis', 'risk'], diseases: [AFIB, { en: 'Stroke', zh: '中風' }] },
  'cha2ds2-vasc': { purpose: ['prognosis', 'risk'], diseases: [AFIB, { en: 'Stroke', zh: '中風' }] },
  'h2fpef': { purpose: ['diagnosis'], diseases: [HFPEF_DISEASE] },
  'hfa-peff': { purpose: ['diagnosis'], diseases: [HFPEF_DISEASE] },
  'maggic-hf': { purpose: ['prognosis', 'risk'], diseases: [HEART_FAILURE] },
  'life-preserved': { purpose: ['prognosis', 'risk'], diseases: [HFPEF_DISEASE, HEART_FAILURE] },
  'map': { purpose: ['formula'], diseases: [{ en: 'Shock', zh: '休克' }, { en: 'Hypotension', zh: '低血壓' }] },
  'has-bled': { purpose: ['prognosis', 'risk'], diseases: [AFIB, { en: 'Anticoagulation', zh: '抗凝治療' }] },
  'curb-65': { purpose: ['severity', 'prognosis'], diseases: [{ en: 'Pneumonia', zh: '肺炎' }] },
  'gds-15': { purpose: ['screening'], diseases: [{ en: 'Depression', zh: '憂鬱症' }] },
  'ldl-friedewald': { purpose: ['formula'], diseases: [{ en: 'Dyslipidemia', zh: '血脂異常' }] },
  'eag-from-a1c': { purpose: ['formula'], diseases: [{ en: 'Diabetes', zh: '糖尿病' }] },
  'ideal-body-weight': { purpose: ['formula'], diseases: [DOSING] },
  'bmi': { purpose: ['formula', 'screening'], diseases: [{ en: 'Obesity', zh: '肥胖' }] },
  'qsofa': { purpose: ['prognosis', 'severity'], diseases: [{ en: 'Sepsis', zh: '敗血症' }] },
  'sirs': { purpose: ['diagnosis'], diseases: [{ en: 'Sepsis', zh: '敗血症' }, { en: 'Infection', zh: '感染' }] },
  'gcs': { purpose: ['severity'], diseases: [{ en: 'Head injury', zh: '頭部外傷' }, { en: 'Altered consciousness', zh: '意識障礙' }] },
  'qtc': { purpose: ['formula'], diseases: [{ en: 'Long QT', zh: 'QT 延長' }, { en: 'Arrhythmia', zh: '心律不整' }] },
  'winters': { purpose: ['formula'], diseases: [{ en: 'Metabolic acidosis', zh: '代謝性酸中毒' }] },
  'anc': { purpose: ['formula'], diseases: [{ en: 'Neutropenia', zh: '嗜中性球低下' }] },
  'heart': { purpose: ['prognosis', 'risk'], diseases: [{ en: 'Chest pain', zh: '胸痛' }, { en: 'ACS', zh: '急性冠心症' }] },
  'wells-dvt': { purpose: ['diagnosis', 'risk'], diseases: [{ en: 'DVT', zh: '深部靜脈栓塞' }] },
  'wells-pe': { purpose: ['diagnosis', 'risk'], diseases: [{ en: 'Pulmonary embolism', zh: '肺栓塞' }] },
  'phq-9': { purpose: ['screening', 'severity'], diseases: [{ en: 'Depression', zh: '憂鬱症' }] },
  'gad-7': { purpose: ['screening', 'severity'], diseases: [{ en: 'Anxiety', zh: '焦慮症' }] },
  'cage': { purpose: ['screening'], diseases: [{ en: 'Alcohol use', zh: '飲酒問題' }] },
  'audit-c': { purpose: ['screening'], diseases: [{ en: 'Alcohol use', zh: '飲酒問題' }] },
  'epworth': { purpose: ['screening'], diseases: [{ en: 'Sleep apnea', zh: '睡眠呼吸中止' }, { en: 'Daytime sleepiness', zh: '白天嗜睡' }] },
  'fena': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Acute kidney injury', zh: '急性腎損傷' }] },
  'feurea': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Acute kidney injury', zh: '急性腎損傷' }] },
  'urine-anion-gap': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Metabolic acidosis', zh: '代謝性酸中毒' }, { en: 'RTA', zh: '腎小管酸中毒' }] },
  'ttkg': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Hyperkalemia', zh: '高血鉀' }, { en: 'Hypokalemia', zh: '低血鉀' }] },
  'osmolar-gap': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Toxic alcohol', zh: '毒性酒精中毒' }] },
  'aa-gradient': { purpose: ['formula'], diseases: [{ en: 'Hypoxemia', zh: '低血氧' }] },
  'pf-ratio': { purpose: ['severity', 'formula'], diseases: [{ en: 'ARDS', zh: '急性呼吸窘迫' }, { en: 'Hypoxemia', zh: '低血氧' }] },
  'egfr-mdrd': { purpose: ['formula'], diseases: [CKD] },
  'ckd-kdigo-risk': { purpose: ['prognosis', 'risk'], diseases: [CKD, { en: 'End-stage renal disease', zh: '末期腎病' }] },
  'who-cvd-2019': { purpose: ['prognosis', 'risk', 'screening'], diseases: [{ en: 'Cardiovascular disease', zh: '心血管疾病' }, { en: 'Primary prevention', zh: '初級預防' }] },
  'hpa-chronic-risk-reconstruction': { purpose: ['risk', 'screening'], diseases: [{ en: 'Chronic disease', zh: '慢性病' }, { en: 'Taiwan HPA', zh: '國健署' }] },
  'meld-3': { purpose: ['prognosis'], diseases: [CIRRHOSIS, { en: 'End-stage liver disease', zh: '末期肝病' }] },
  'maddrey-df': { purpose: ['prognosis', 'severity'], diseases: [{ en: 'Alcoholic hepatitis', zh: '酒精性肝炎' }] },
  'hcc-risk-reveal': { purpose: ['prognosis', 'risk', 'screening'], diseases: [HEPATITIS, { en: 'Liver cancer / HCC', zh: '肝癌' }] },
  'glasgow-blatchford': { purpose: ['prognosis', 'risk'], diseases: [{ en: 'GI bleeding', zh: '消化道出血' }] },
  'reticulocyte-index': { purpose: ['diagnosis', 'formula'], diseases: [{ en: 'Anemia', zh: '貧血' }] },
  'nihss': { purpose: ['severity'], diseases: [{ en: 'Stroke', zh: '中風' }] },
  'abcd2': { purpose: ['prognosis', 'risk'], diseases: [{ en: 'TIA', zh: '暫時性腦缺血' }, { en: 'Stroke', zh: '中風' }] },
  'mrs': { purpose: ['prognosis'], diseases: [{ en: 'Stroke', zh: '中風' }] },
  'bisap': { purpose: ['prognosis', 'severity'], diseases: [{ en: 'Pancreatitis', zh: '胰臟炎' }] },
  'ranson': { purpose: ['prognosis', 'severity'], diseases: [{ en: 'Pancreatitis', zh: '胰臟炎' }] },
  'aims65': { purpose: ['prognosis', 'risk'], diseases: [{ en: 'GI bleeding', zh: '消化道出血' }] },
  'rockall': { purpose: ['prognosis', 'risk'], diseases: [{ en: 'GI bleeding', zh: '消化道出血' }] },
}

export function getCalcTags(id: string): CalcTags {
  return CALC_TAGS[id] ?? { purpose: [], diseases: [] }
}
