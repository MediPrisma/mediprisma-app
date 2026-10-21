import type { L } from '../types'

export type HfPrognosisModelId = 'maggic' | 'life-preserved' | 'shfm' | 'gwtg-hf'
export type PrognosisEndpoint = 'all-cause-mortality' | 'survival' | 'in-hospital-mortality'
export type PrognosisHorizon = '1-year' | '2-year' | '3-year' | '5-year' | 'index-admission'
export interface PrognosisInputEvidence {
  value: string
  date?: string
  source?: string
}
export type PrognosisEvidence = Readonly<Record<string, PrognosisInputEvidence | undefined>>
export interface PrognosisModel {
  id: HfPrognosisModelId
  name: string
  version: string
  setting: 'chronic-hf' | 'hf-admission'
  outcome: L
  population: L
  endpoint: PrognosisEndpoint
  horizons: readonly PrognosisHorizon[]
  fields: readonly { key: string; label: L }[]
  references: readonly { label: string; url: string }[]
  calculatorUrl: string
  /**
   * The medical calculator that already implements the model, where one does
   * (MAGGIC, LIFE-Preserved): the list opens it — its inputs, autofill and
   * result — rather than a read-only checklist (clinician feedback
   * 2026-09-28: 「醫療計算機明明有，直接複用就好」).
   */
  calculatorId?: string
}
const l = (zh: string, en: string): L => ({ zh, en })
const fields = {
  age: l('年齡', 'Age'), sex: l('性別（原模型定義）', 'Sex (model definition)'),
  LVEF: l('LVEF', 'LVEF'), nyha: l('NYHA 功能分級', 'NYHA class'),
  bloodPressure: l('收縮壓', 'Systolic blood pressure'), serumCreatinine: l('Creatinine', 'Creatinine'),
  bodyMassIndex: l('BMI', 'BMI'), diabetes: l('糖尿病', 'Diabetes'), copd: l('COPD', 'COPD'),
  smoking: l('目前吸菸', 'Current smoking'), hfDuration: l('HF 診斷病程', 'HF duration'),
  betaBlocker: l('β 阻斷劑使用', 'Beta-blocker use'), aceArb: l('ACEI／ARB 使用', 'ACE inhibitor / ARB use'),
  ischemic: l('缺血性病因', 'Ischemic etiology'), bodyWeight: l('體重', 'Weight'),
  sodium: l('Na', 'Sodium'), hemoglobin: l('Hb', 'Hemoglobin'), lymphocytes: l('淋巴球百分比', 'Lymphocyte percentage'),
  uricAcid: l('尿酸', 'Uric acid'), totalCholesterol: l('總膽固醇', 'Total cholesterol'),
  shfmTherapy: l('用藥種類與劑量、利尿劑及裝置治療（依 SHFM 版本）', 'Medication types/doses, diuretics and devices (SHFM version-specific)'),
  heartRate: l('入院心率', 'Admission heart rate'), BUN: l('入院 BUN', 'Admission BUN'),
  race: l('種族欄位（原模型定義，需明確核對）', 'Race (original model definition; explicit verification required)'),
}
const f = (...keys: (keyof typeof fields)[]) => keys.map(key => ({ key, label: fields[key] }))

/** Catalog only. No calculator is declared operational until its implementation is validated. */
export const HF_PROGNOSIS_MODELS: readonly PrognosisModel[] = [
  {
    id: 'maggic', name: 'MAGGIC', version: 'Pocock-2013', setting: 'chronic-hf',
    outcome: l('1、3 年全因死亡風險', '1- and 3-year all-cause mortality'),
    population: l('慢性心衰竭，原研究涵蓋降低與保留 EF。', 'Chronic HF; derivation included reduced and preserved EF.'),
    endpoint: 'all-cause-mortality', horizons: ['1-year', '3-year'],
    fields: f('age', 'sex', 'LVEF', 'nyha', 'serumCreatinine', 'bloodPressure', 'bodyMassIndex', 'diabetes', 'copd', 'smoking', 'hfDuration', 'betaBlocker', 'aceArb'),
    references: [{ label: 'Pocock et al. 2013 · doi:10.1093/eurheartj/ehs337', url: 'https://pubmed.ncbi.nlm.nih.gov/23095984/' }],
    calculatorUrl: 'https://www.heartfailurerisk.org/',
    calculatorId: 'maggic-hf',
  },
  {
    id: 'shfm', name: 'Seattle Heart Failure Model（SHFM）', version: 'UW-updated-model', setting: 'chronic-hf',
    outcome: l('1、2、5 年存活率', '1-, 2- and 5-year survival'),
    population: l('慢性心衰竭；需核對所採版本、適用族群與授權。', 'Chronic HF; verify the selected version, population and licensing.'),
    endpoint: 'survival', horizons: ['1-year', '2-year', '5-year'],
    fields: f('age', 'sex', 'LVEF', 'nyha', 'bloodPressure', 'ischemic', 'bodyWeight', 'sodium', 'hemoglobin', 'lymphocytes', 'uricAcid', 'totalCholesterol', 'shfmTherapy'),
    references: [
      { label: 'Levy et al. 2006 · doi:10.1161/CIRCULATIONAHA.105.584102', url: 'https://pubmed.ncbi.nlm.nih.gov/16534009/' },
      { label: 'University of Washington · model updates / 5-year survival', url: 'https://depts.washington.edu/shfm/update.php' },
    ],
    calculatorUrl: 'https://depts.washington.edu/shfm/',
  },
  {
    id: 'gwtg-hf', name: 'GWTG-HF', version: 'Peterson-2010', setting: 'hf-admission',
    outcome: l('本次住院期間死亡風險', 'In-hospital mortality during the index admission'),
    population: l('因 HF 住院者，使用入院當時資料；門診最新數值不能自動替代入院值。', 'Patients admitted with HF; use admission data, not the latest outpatient measurements.'),
    endpoint: 'in-hospital-mortality', horizons: ['index-admission'],
    fields: f('age', 'bloodPressure', 'BUN', 'heartRate', 'sodium', 'copd', 'race'),
    references: [{ label: 'Peterson et al. 2010 · doi:10.1161/CIRCOUTCOMES.109.854877', url: 'https://pubmed.ncbi.nlm.nih.gov/20123668/' }],
    calculatorUrl: 'https://www.mdcalc.com/calc/3829/gwtg-heart-failure-risk-score',
  },
  // HFpEF only; last, so the three general models keep their places.
  {
    id: 'life-preserved', name: 'LIFE-Preserved', version: 'calculator', setting: 'chronic-hf',
    outcome: l('HFpEF 首次心衰住院或心血管死亡之短期與終生風險', 'Short-term and lifetime risk of first HF hospitalization or CV death in HFpEF'),
    population: l('HFpEF（LVEF ≥50%）。', 'HFpEF (LVEF ≥50%).'),
    endpoint: 'all-cause-mortality', horizons: ['1-year'],
    fields: [],
    references: [],
    calculatorUrl: '',
    calculatorId: 'life-preserved',
  },
]

/** Admission selection is not implemented: never silently substitute the current chart. */
export function evidenceForModel(model: PrognosisModel, evidence: PrognosisEvidence): PrognosisEvidence {
  return model.setting === 'hf-admission' ? {} : evidence
}

// Stable boundary for a future local formula or AI-SaMD adapter. No patient data
// is sent anywhere by this contract or by the reference links above.
export interface PrognosisRequest {
  requestId: string
  patientId: string
  modelId: string
  modelVersion: string
  inputRevision: string
  endpoint: PrognosisEndpoint
  horizons: readonly PrognosisHorizon[]
  setting: 'chronic-hf' | 'hf-admission'
  encounterId?: string
  /** Verified, normalized inputs, never the read-only evidence preview. */
  inputs: Readonly<Record<string, {
    value: number | string | boolean
    unit?: string
    observedAt?: string
    provenance: 'record' | 'physician'
  }>>
}
export interface PrognosisEstimate {
  horizon: PrognosisHorizon
  probability: number // 0..1; endpoint determines death vs survival
}
export interface PrognosisResponse {
  requestId: string
  patientId: string
  modelId: string
  modelVersion: string
  inputRevision: string
  endpoint: PrognosisEndpoint
  calculatedAt: string
  estimates: readonly PrognosisEstimate[]
}
export interface PrognosisCalculatorAdapter {
  calculate(request: PrognosisRequest): Promise<PrognosisResponse>
}
/** Reject stale results, wrong patients/models/endpoints, and invalid probabilities. */
export function matchesPrognosisRequest(request: PrognosisRequest, response: PrognosisResponse): boolean {
  return !!request.patientId && !!request.modelVersion && !!request.inputRevision
    && (request.setting !== 'hf-admission' || !!request.encounterId)
    && request.horizons.length > 0
    && ['requestId', 'patientId', 'modelId', 'modelVersion', 'inputRevision', 'endpoint'].every(
    key => request[key as keyof PrognosisRequest] === response[key as keyof PrognosisResponse],
  ) && Number.isFinite(Date.parse(response.calculatedAt))
    && response.estimates.length === request.horizons.length
    && new Set(response.estimates.map(item => item.horizon)).size === response.estimates.length
    && response.estimates.every(item => request.horizons.includes(item.horizon)
      && Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 1)
}
