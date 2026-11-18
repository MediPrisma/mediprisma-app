import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { diagnosisSelect, type ClinicalSelectValue } from './hfpef-clinical-autofill'

/**
 * Histories the calculators ask, read from diagnosis codes (conditions and
 * encounter diagnoses) — 「是」 only. A code the record lacks is answered by
 * the input's presumed 「無」 (owner decision 2026-11-19), worded 紀錄未見.
 * Codes are ICD-10 without dots; ICD-9 is not read (owner decision
 * 2026-11-19: the record is ICD-10 now).
 */
export type HistoryKey = 'htn' | 'chf' | 'strokeTiaEmbolism' | 'stroke' | 'vascular' | 'ihd' | 'cadOrStroke' | 'liverDisease' | 'chronicLiverDisease' | 'priorVte' | 'priorDvt' | 'activeCancer' | 'smoker'

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
  const known = diagnosisSelect(conditions, encounters, now, isCancer, '惡性腫瘤', undefined, true)
  return known && { ...known, value: 'unknown' }
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
