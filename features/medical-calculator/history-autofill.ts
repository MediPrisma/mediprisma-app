import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { diagnosisSelect, type ClinicalSelectValue } from './hfpef-clinical-autofill'

/**
 * Histories the calculators ask, read from diagnosis codes (conditions and
 * encounter diagnoses) — 「是」 only. A code the record lacks is answered by
 * the input's presumed 「無」 (owner decision 2026-11-19), worded 紀錄未見.
 * Codes are ICD-10 or ICD-9 without dots. ICD-9 V codes are left out: they
 * read as ICD-10 injury codes.
 */
export type HistoryKey = 'htn' | 'chf' | 'strokeTiaEmbolism' | 'stroke' | 'vascular' | 'ihd' | 'cadOrStroke' | 'liverDisease' | 'chronicLiverDisease' | 'priorVte' | 'priorDvt' | 'activeCancer' | 'smoker'

/** ICD-10 I10–I16; ICD-9 401–405. */
const isHtn = (code: string) => /^(?:I1[0-6]|40[1-5])/.test(code)
/** ICD-10 I50, I11.0, I13.0, I13.2, I09.81; ICD-9 428 and hypertensive heart disease with failure. */
const isHf = (code: string) => /^(?:I50|I110|I13[02]|I0981|428|402[019]1|404[019][13])/.test(code)
/** Ischaemic and haemorrhagic stroke and their sequelae: ICD-10 I60–I64, I69; ICD-9 430–434, 436, 438. */
const isStroke = (code: string) => /^(?:I6[0-4]|I69|43[0-4]|436|438)/.test(code)
/** CHA₂DS₂-VA(Sc) S: stroke, TIA (G45 without transient global amnesia G45.4) or arterial embolism (I74; ICD-9 435, 444). */
const isStrokeTiaEmbolism = (code: string) => isStroke(code) || /^(?:G45[0-35-9]|I74|Z8673|435|444)/.test(code)
/** Ischaemic heart disease: ICD-10 I20–I25; ICD-9 410–414. */
const isIhd = (code: string) => /^(?:I2[0-5]|41[0-4])/.test(code)
/** CHA₂DS₂-VA(Sc) V: prior MI (I21, I22, I25.2), peripheral artery disease or aortic plaque (I70, I73.9); ICD-9 410, 412, 440, 443.9. */
const isVascular = (code: string) => /^(?:I2[12]|I252|I70|I739|410|412|440|4439)/.test(code)
/** Chronic liver disease, viral hepatitis, liver cancer, varices or a liver transplant (as the DOAC calculator reads it). */
const isLiverDisease = (code: string) => /^(?:K7[0-7]|B1[5-9]|C22|I85|Z944|070|155|456[0-2]|57[0-3])/.test(code)
/** HAS-BLED's chronic liver disease: alcoholic liver disease, chronic hepatitis, fibrosis or cirrhosis, portal hypertension, chronic viral hepatitis, varices, liver cancer or transplant; ICD-9 571, 572.3, 456.0–456.2. Acute hepatitis alone is not. */
const isChronicLiverDisease = (code: string) => /^(?:K70|K73|K74|K766|B18|I85|C22|Z944|571|5723|456[0-2])/.test(code)
/** DVT: ICD-10 I80.1–I80.3, I82.4, Z86.718; ICD-9 451.1, 453.4. */
const isDvt = (code: string) => /^(?:I80[1-3]|I824|Z86718|4511|4534)/.test(code)
/** DVT or PE: the above, PE (I26, Z86.711; ICD-9 415.1), or Z86.71 unspecified. */
const isVte = (code: string) => isDvt(code) || /^(?:I26|Z8671|4151)/.test(code)
/** Malignancy other than non-melanoma skin cancer: ICD-10 C00–C96 bar C44; ICD-9 140–208 bar 173. */
const isCancer = (code: string) => (/^C(?:[0-8]\d|9[0-6])/.test(code) && !/^C44/.test(code)) || (/^(?:1[4-9]\d|20[0-8])/.test(code) && !/^173/.test(code))
/** Current tobacco use: ICD-10 F17 bar its remission codes (F17.2x1), Z72.0; ICD-9 305.1. */
const isSmoker = (code: string) => /^(?:F17|Z720|3051)/.test(code) && !/^F172\d1/.test(code)

/** Wells' 「active cancer」: treated within six months. */
const CANCER_WINDOW_DAYS = 183

export function historySelects(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): Partial<Record<HistoryKey, ClinicalSelectValue>> {
  // A history counts once diagnosed, resolved or not; current smoking and recent cancer do not.
  const read = (matches: (code: string) => boolean, name: string, withinDays?: number) => diagnosisSelect(conditions, encounters, now, matches, name, withinDays, true)
  const current = (matches: (code: string) => boolean, name: string, withinDays?: number) => diagnosisSelect(conditions, encounters, now, matches, name, withinDays)
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
    activeCancer: current(isCancer, '惡性腫瘤（近 6 個月）', CANCER_WINDOW_DAYS),
    smoker: current(isSmoker, '吸菸'),
  }
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value)) as Partial<Record<HistoryKey, ClinicalSelectValue>>
}
