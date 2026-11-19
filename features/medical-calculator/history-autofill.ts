import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { diagnosisSelect, type ClinicalSelectValue } from './hfpef-clinical-autofill'
import { classifyEncounterClass } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

/**
 * Histories the calculators ask, read from diagnosis codes (conditions and
 * encounter diagnoses) — 「是」 only. A code the record lacks is answered by
 * the input's presumed 「無」 (owner decision 2026-11-19), worded 紀錄未見.
 * Codes are ICD-10 without dots; ICD-9 is not read (owner decision
 * 2026-11-19: the record is ICD-10 now).
 */
export type HistoryKey = 'htn' | 'chf' | 'strokeTiaEmbolism' | 'stroke' | 'vascular' | 'ihd' | 'cadOrStroke' | 'liverDisease' | 'chronicLiverDisease' | 'priorVte' | 'priorDvt' | 'activeCancer' | 'smoker' | 'ifgOrDiabetes' | 'hfOver18Months' | 'hfHospitalization' | 'ascvdOrHf' | 'esrdOrDialysis' | 'rockallComorbid'

/** I10–I16. */
const isHtn = (code: string) => /^I1[0-6]/.test(code)
/** I50, I11.0, I13.0, I13.2, I09.81. */
const isHf = (code: string) => /^(?:I50|I110|I13[02]|I0981)/.test(code)
/** Ischaemic and haemorrhagic stroke and their sequelae: I60–I64, I69. */
const isStroke = (code: string) => /^(?:I6[0-4]|I69)/.test(code)
/** CHA₂DS₂-VA(Sc) S: stroke, TIA (G45 without transient global amnesia G45.4), Z86.73 or arterial embolism (I74). */
const isStrokeTiaEmbolism = (code: string) => isStroke(code) || /^(?:G45[0-35-9]|I74|Z8673)/.test(code)
/** Ischaemic heart disease: I20–I25. */
const isIhd = (code: string) => /^I2[0-5]/.test(code)
/** CHA₂DS₂-VA(Sc) V: prior MI (I21, I22, I25.2), peripheral artery disease or aortic plaque (I70, I73.9). */
const isVascular = (code: string) => /^(?:I2[12]|I252|I70|I739)/.test(code)
/** Liver disease, viral hepatitis, liver cancer, varices or a liver transplant (as the DOAC calculator reads it). */
const isLiverDisease = (code: string) => /^(?:K7[0-7]|B1[5-9]|C22|I85|Z944)/.test(code)
/** HAS-BLED's chronic liver disease: alcoholic liver disease, chronic hepatitis, fibrosis or cirrhosis, portal hypertension, chronic viral hepatitis, varices, liver cancer or transplant. Acute hepatitis alone is not. */
const isChronicLiverDisease = (code: string) => /^(?:K70|K73|K74|K766|B18|I85|C22|Z944)/.test(code)
/** DVT, acute or chronic: I80.1–I80.3, I82.4, I82.5, Z86.718. */
const isDvt = (code: string) => /^(?:I80[1-3]|I82[45]|Z86718)/.test(code)
/** DVT or PE: the above, PE (I26, Z86.711), or Z86.71 unspecified. */
const isVte = (code: string) => isDvt(code) || /^(?:I26|Z8671)/.test(code)
/** Malignancy other than non-melanoma skin cancer: C00–C96 bar C44. */
const isCancer = (code: string) => /^C(?:[0-8]\d|9[0-6])/.test(code) && !/^C44/.test(code)
/** Current tobacco use: F17 bar its remission codes (F17.2x1), Z72.0. */
const isSmoker = (code: string) => /^(?:F17|Z720)/.test(code) && !/^F172\d1/.test(code)
/** Nicotine dependence in remission: F17.2x1. */
const isSmokingRemission = (code: string) => /^F172\d1/.test(code)

/** Diabetes E08–E13, or impaired fasting glucose / prediabetes R73.0x (NAFLD fibrosis score). */
const isIfgOrDiabetes = (code: string) => /^(?:E0[89]|E1[0-3]|R730)/.test(code)
/** PREVENT's end-stage kidney disease or dialysis: N18.6, Z99.2, Z49, Z91.15. */
const isEsrdOrDialysis = (code: string) => /^(?:N186|Z992|Z49|Z9115)/.test(code)
/** PREVENT's known CVD: coronary disease, stroke (or its history code Z86.73), PAD or heart failure. */
const isAscvdOrHf = (code: string) => isIhd(code) || isStroke(code) || /^(?:Z8673|I70|I739)/.test(code) || isHf(code)

/** Rockall 3 points: renal failure (N17, N18.4–N18.6, N19, Z99.2), liver failure (K72, K70.4, K76.7) or metastatic cancer (C77–C79). */
const isRockallFailureOrMets = (code: string) => /^(?:N17|N18[4-6]|N19|Z992|K72|K704|K767|C7[7-9])/.test(code)

/** Wells' 「active cancer」: treated within six months. */
const CANCER_WINDOW_DAYS = 183

export function historySelects(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): Partial<Record<HistoryKey, ClinicalSelectValue>> {
  // A history counts once diagnosed, resolved or not.
  const read = (matches: (code: string) => boolean, name: string, withinDays?: number) => diagnosisSelect(conditions, encounters, now, matches, name, withinDays, true)
  const found: Partial<Record<HistoryKey, ClinicalSelectValue | undefined>> = {
    htn: read(isHtn, '高血壓'),
    chf: read(isHf, '心衰竭'),
    strokeTiaEmbolism: read(isStrokeTiaEmbolism, '中風／TIA／栓塞'),
    stroke: read(isStroke, '中風'),
    vascular: read(isVascular, '血管疾病'),
    ihd: read(isIhd, '缺血性心臟病'),
    cadOrStroke: read((code) => isIhd(code) || isStroke(code), '冠心病或中風'),
    liverDisease: read(isLiverDisease, '肝病'),
    chronicLiverDisease: read(isChronicLiverDisease, '慢性肝病'),
    priorVte: read(isVte, 'DVT／PE '),
    priorDvt: read(isDvt, 'DVT '),
    activeCancer: activeCancer(conditions, encounters, now),
    smoker: currentSmoking(conditions, encounters, now),
    ifgOrDiabetes: read(isIfgOrDiabetes, '空腹血糖異常／糖尿病'),
    ascvdOrHf: read(isAscvdOrHf, '心血管疾病'),
    esrdOrDialysis: read(isEsrdOrDialysis, '末期腎病／透析'),
    rockallComorbid: rockallComorbidity(conditions, encounters, now),
    ...heartFailureCourse(conditions, encounters, now),
  }
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value)) as Partial<Record<HistoryKey, ClinicalSelectValue>>
}

/**
 * Wells' 「active cancer」 asks for treatment within six months, which the
 * record does not date. A cancer code on a visit in the last six months reads
 * 「是」 (seen for it, for the clinician to confirm); a cancer known only from
 * older records reads 「unknown」, left blank rather than presumed absent.
 */
function activeCancer(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): ClinicalSelectValue | undefined {
  const recentVisit = diagnosisSelect([], encounters, now, isCancer, '惡性腫瘤（近 6 個月，治療請核對）', CANCER_WINDOW_DAYS, true)
  if (recentVisit) return recentVisit
  // Owner rule 2026-11-19: no visit for it in six months reads 「無」, naming the older code.
  const known = diagnosisSelect(conditions, encounters, now, isCancer, '惡性腫瘤', undefined, true)
  return known && { ...known, value: 'no', testName: `近 6 個月未見癌症就醫；${known.testName.replace(/（.*）$/, '')}，預設無（請核對是否治療中）` }
}

/**
 * Rockall's comorbidity as its option index: 2 for renal or liver failure or
 * metastases (3 points), 1 for heart failure or ischaemic heart disease
 * (2 points). Failure is read from active diagnoses only; heart disease is a
 * history. Neither: the presumed 「無」.
 */
function rockallComorbidity(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): ClinicalSelectValue | undefined {
  // A failure the record marks resolved is not current: old visits for it then do not count, only an active diagnosis.
  const settled = conditions.some((condition) => ['inactive', 'resolved', 'remission'].includes(condition.clinicalStatus ?? '')
    && condition.code?.coding?.some((coding) => isRockallFailureOrMets(coding.code?.replace(/\./g, '').toUpperCase() ?? '')))
  const failure = diagnosisSelect(conditions, settled ? [] : encounters, now, isRockallFailureOrMets, '腎／肝衰竭或轉移癌')
  if (failure) return { ...failure, value: '2' }
  const cardiac = diagnosisSelect(conditions, encounters, now, (code) => isHf(code) || isIhd(code), '心衰竭或缺血性心臟病', undefined, true)
  return cardiac && { ...cardiac, value: '1' }
}

/**
 * MAGGIC's 「HF diagnosed ≥18 months ago」 from the earliest HF code, and
 * LIFE-Preserved's previous HF hospitalization from inpatient stays with an
 * HF code (within six months: 「recent」). Nothing found: their presumed 「無」.
 */
function heartFailureCourse(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): Partial<Record<HistoryKey, ClinicalSelectValue>> {
  const out: Partial<Record<HistoryKey, ClinicalSelectValue>> = {}
  const hits = [
    ...conditions.map((condition) => diagnosisSelect([condition], [], now, isHf, '心衰竭', undefined, true)),
    ...encounters.map((encounter) => diagnosisSelect([], [encounter], now, isHf, '心衰竭', undefined, true)),
  ].filter((hit): hit is ClinicalSelectValue => !!hit && !!hit.date).sort((a, b) => a.date.localeCompare(b.date))
  const first = hits[0]
  if (first) {
    const months = (now.getTime() - Date.parse(first.date)) / (30.44 * 86_400_000)
    out.hfOver18Months = { ...first, value: months >= 18 ? 'yes' : 'no', testName: `最早心衰竭紀錄 ${first.date.slice(0, 10)}（${first.testName.replace(/（.*）$/, '')}；紀錄約涵蓋一年，請核對）` }
  }
  const stays = encounters.filter((encounter) => classifyEncounterClass(encounter.class) === 'inpatient')
  // A stay's diagnosis may be a reference to a loaded Condition rather than a code on the stay.
  const byId = new Map(conditions.map((condition) => [condition.id, condition]))
  const stay = stays.map((encounter) => {
    const linked = (encounter.diagnosis ?? []).map((item) => byId.get(item.condition?.reference?.split('/').pop() ?? '')).filter((condition): condition is ConditionEntity => !!condition)
    const onStay = diagnosisSelect([], [encounter], now, isHf, '心衰竭住院', undefined, true)
    if (onStay) return onStay
    const date = encounter.period?.start ?? ''
    const fromCondition = date && Date.parse(date) <= now.getTime() ? diagnosisSelect(linked, [], now, isHf, '心衰竭', undefined, true) : undefined
    // Dated by the stay, not by the Condition the stay points to.
    return fromCondition && { ...fromCondition, date, obsId: encounter.id, resourceType: 'Encounter' as const, testName: `住院${fromCondition.testName}` }
  }).filter((hit): hit is ClinicalSelectValue => !!hit).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (stay) out.hfHospitalization = { ...stay, value: now.getTime() - Date.parse(stay.date) <= 183 * 86_400_000 ? 'recent' : 'prior' }
  return out
}

/** The latest of the records matching, each read on its own so the newest wins. */
function latest(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date, matches: (code: string) => boolean, name: string, history: boolean): ClinicalSelectValue | undefined {
  const hits = [
    ...conditions.map((condition) => diagnosisSelect([condition], [], now, matches, name, undefined, history)),
    ...encounters.map((encounter) => diagnosisSelect([], [encounter], now, matches, name, undefined, history)),
  ].filter((hit): hit is ClinicalSelectValue => !!hit)
  return hits.sort((a, b) => b.date.localeCompare(a.date))[0]
}

/** Current smoking: the latest tobacco code, unless a remission code is as recent or newer (then 「否」). */
function currentSmoking(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): ClinicalSelectValue | undefined {
  const smoking = latest(conditions, encounters, now, isSmoker, '吸菸', false)
  const remission = latest(conditions, encounters, now, isSmokingRemission, '尼古丁依賴緩解', true)
  if (remission && (!smoking || remission.date >= smoking.date)) return { ...remission, value: 'no' }
  return smoking
}
