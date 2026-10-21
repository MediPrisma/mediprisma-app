import { classifyReport, reportNarrative, extractEcgFindings, isMedicationBeingTaken, medicationAtcCode, medicationDisplayName, medicationSupplyEndDate } from '@voho0000/personalized-care-fhir'
import type { DiagnosticReportEntity, MedicationEntity, ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'

/**
 * Yes/no and graded answers the record (or the CDSS visit) can give a
 * calculator. Named for the HFpEF scores that first used it; MAGGIC and
 * LIFE-Preserved read the rest (diabetes, COPD, β-blocker, ACEI/ARB, NYHA).
 */
export type ClinicalSelectKey = 'afHistory' | 'rhythm' | 'antihypertensives' | 'diabetes' | 'copd' | 'betaBlocker' | 'aceiArb' | 'nyha'
export interface ClinicalSelectValue {
  value: string
  date: string
  testName: string
  facility?: string
  obsId?: string
  resourceType?: 'Condition' | 'Encounter' | 'DiagnosticReport' | 'MedicationRequest' | 'MedicationStatement'
}

// Only explicit AF, never flutter, paced rhythm or a generic non-sinus finding.
function affirmedAf(text: string, includeHistory = false): boolean {
  return text.split(/[\n\r.;。；]/).some(fragment => {
    const match = /atrial\s+fibrillation|心房[顫纖]動|房顫|\bAF(?:ib)?\b/i.exec(fragment)
    if (!match) return false
    const before = fragment.slice(0, match.index)
    const after = fragment.slice(match.index + match[0].length)
    if (!includeHistory && /(?:history\s+of|hx\s+of|既往|病史)[^,，:：]*$/i.test(before)) return false
    return !/(?:\bno\b|\bnot\b|without|absence|rule\s*out|possible|suspect|cannot\s+exclude|\br\/o\b|denies|疑|排除|未見|沒有|無|否認)[^,，:：]*$/i.test(before)
      && !/^\s*(?:\?|absent|not\s+(?:seen|present)|excluded|未見|陰性|不存在)/i.test(after)
  })
}

/** Historical AF is positive evidence even when a later tracing is sinus.
 * A sinus tracing alone cannot establish absence of paroxysmal AF history.
 */
export function ecgSelects(reports: DiagnosticReportEntity[], now: Date): Partial<Record<ClinicalSelectKey, ClinicalSelectValue>> {
  const result: Partial<Record<ClinicalSelectKey, ClinicalSelectValue>> = {}
  const ecgs = reports.flatMap(report => {
    if (['entered-in-error', 'cancelled', 'registered', 'partial', 'preliminary'].includes(report.status ?? '')) return []
    const text = reportNarrative(report)
    const date = report.effectiveDateTime ?? report.effectivePeriod?.start ?? report.issued ?? ''
    if (!text.trim() || classifyReport(report, text) !== 'ecg' || !Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime()) return []
    return [{ report, text, date }]
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  for (const { report, text, date } of ecgs) {
    const af = affirmedAf(text, true)
    if (af && !result.afHistory) result.afHistory = { value: 'yes', date, testName: 'EKG：曾記錄心房顫動（請核對）', obsId: report.id, resourceType: 'DiagnosticReport', facility: report.performer?.find(p => p.display)?.display }
  }
  const latest = ecgs[0]
  if (latest) {
    const { report, text, date } = latest
    const af = affirmedAf(text)
    const sinus = text.split(/[\n\r.;。；]/).some(fragment => !/(?:history|hx|既往|病史)/i.test(fragment) && extractEcgFindings(fragment).rhythm === 'sinus')
    // Conflicting AF and sinus statements need manual interpretation.
    if (af !== sinus) result.rhythm = { value: af ? 'af' : 'sr', date, testName: `最近 EKG：${af ? '心房顫動' : '竇性心律'}（請確認評估時心律）`, obsId: report.id, resourceType: 'DiagnosticReport', facility: report.performer?.find(p => p.display)?.display }
    if (!result.afHistory && /(?:no\s+(?:prior\s+)?history\s+of\s+atrial\s+fibrillation|無心房顫動病史)/i.test(text)) result.afHistory = { value: 'no', date, testName: 'EKG 明載無 AF 病史（請核對）', obsId: report.id, resourceType: 'DiagnosticReport' }
  }
  return result
}

// Ingredient identity, not prescription count or class count. Fixed combinations
// are split by named components; ARNI counts as one therapeutic agent.
const INGREDIENTS = 'amlodipine nifedipine felodipine lercanidipine lacidipine nicardipine nitrendipine verapamil diltiazem captopril enalapril lisinopril ramipril perindopril benazepril fosinopril imidapril quinapril cilazapril trandolapril losartan valsartan candesartan irbesartan telmisartan olmesartan azilsartan eprosartan aliskiren bisoprolol carvedilol metoprolol atenolol nebivolol propranolol labetalol acebutolol betaxolol nadolol pindolol hydrochlorothiazide chlorthalidone indapamide metolazone chlorothiazide furosemide bumetanide torsemide torasemide spironolactone eplerenone amiloride triamterene doxazosin prazosin terazosin clonidine methyldopa moxonidine hydralazine minoxidil reserpine'.split(' ')
const ATC_INGREDIENT: Record<string, string> = { C08CA01: 'amlodipine', C08CA05: 'nifedipine', C08DA01: 'verapamil', C08DB01: 'diltiazem', C09AA01: 'captopril', C09AA02: 'enalapril', C09AA03: 'lisinopril', C09AA04: 'perindopril', C09AA05: 'ramipril', C09CA01: 'losartan', C09CA02: 'eprosartan', C09CA03: 'valsartan', C09CA04: 'irbesartan', C09CA06: 'candesartan', C09CA07: 'telmisartan', C09CA08: 'olmesartan', C09CA09: 'azilsartan', C07AB02: 'metoprolol', C07AB03: 'atenolol', C07AB07: 'bisoprolol', C07AB12: 'nebivolol', C07AG02: 'carvedilol', C03AA03: 'hydrochlorothiazide', C03BA04: 'chlorthalidone', C03BA11: 'indapamide', C03CA01: 'furosemide', C03DA01: 'spironolactone', C03DA04: 'eplerenone', C02CA04: 'doxazosin', C09DX04: 'sacubitril/valsartan' }

export function antihypertensiveSelect(medications: MedicationEntity[], now: Date): ClinicalSelectValue | undefined {
  if (!medications.length) return undefined
  const found = new Map<string, MedicationEntity>()
  let unresolved = false
  for (const med of medications) {
    if (!isMedicationBeingTaken(med, now)) continue
    if (med.authoredOn && Date.parse(med.authoredOn) > now.getTime()) continue
    // An explicit supply expiry outranks stale `active` status. No grace period
    // is inferred here: this is the current-regimen field of a calculator.
    const end = medicationSupplyEndDate(med)
    if (end && end < now.toISOString().slice(0, 10)) continue
    const atc = medicationAtcCode(med) ?? med.atcClassification?.atcCode
    const text = [med.drugTerminology?.ingredientText, medicationDisplayName(med), med.drugTerminology?.officialNameEn].filter(Boolean).join(' ')
    const route = [med.drugTerminology?.doseForm, ...med.dosageInstruction?.map(d => `${d.route?.text ?? ''} ${d.text ?? ''}`) ?? []].join(' ')
    if (/^(S|D)/.test(atc ?? '') || /ophthalm|eye\s*drop|topical|眼|外用|皮膚|\b(?:IV|intravenous|injection)\b|注射/i.test(`${text} ${route}`)) continue
    const names = INGREDIENTS.filter(name => new RegExp(`\\b${name}\\b`, 'i').test(text)).map(name => name === 'torasemide' ? 'torsemide' : name)
    if (/sacubitril/i.test(text)) {
      const index = names.indexOf('valsartan')
      if (index >= 0) names.splice(index, 1)
      names.push('sacubitril/valsartan')
    }
    if (!names.length && atc && ATC_INGREDIENT[atc]) names.push(ATC_INGREDIENT[atc])
    if (atc && /^(?:C09[BDE]|C07[B-F]|C08G|C03E|C02L)/.test(atc) && atc !== 'C09DX04' && names.length < 2) unresolved = true
    for (const name of names) found.set(name, med)
    if (!names.length && (!atc || /^C0[23789]/.test(atc))) unresolved = true
  }
  if (found.size < 2 && unresolved) return undefined
  const first = [...found.values()][0]
  return { value: found.size >= 2 ? 'yes' : 'no', date: now.toISOString().slice(0, 10), testName: `目前有效用藥：${found.size} 種已辨識降壓成分${found.size ? `（${[...found.keys()].join('、')}）` : ''}；依處方推算，請核對實際服用`, obsId: first?.id, resourceType: first?._sourceResourceType ?? 'MedicationRequest', facility: first?.requester?.display ?? first?.informationSource?.display }
}

type DiagnosisCode = { code?: string; system?: string }
function isAfCode(coding: DiagnosisCode): boolean {
  const code = coding.code?.replace(/\./g, '').toUpperCase() ?? ''
  const system = coding.system ?? ''
  if (system && !/icd|snomed/i.test(system)) return false
  if (/snomed/i.test(system)) return code === '49436004'
  return /^(?:I480|I481|I4811|I4819|I482|I4820|I4821|I4891|42731)$/.test(code)
}
export function afDiagnosis(conditions: ConditionEntity[], encounters: EncounterEntity[], now: Date): ClinicalSelectValue | undefined {
  for (const condition of conditions) {
    if (['refuted', 'entered-in-error', 'provisional', 'differential', 'unconfirmed'].includes(condition.verificationStatus ?? '') || condition._inferred) continue
    const date = condition.recordedDate ?? condition.onsetDateTime ?? ''
    if (date && Date.parse(date) > now.getTime()) continue
    const code = condition.code?.coding?.find(isAfCode)
    if (code) return { value: 'yes', date, testName: `AF 診斷碼：${code.code}（請核對）`, obsId: condition.id, resourceType: 'Condition' }
  }
  for (const encounter of encounters) {
    if (['cancelled', 'entered-in-error'].includes(encounter.status ?? '')) continue
    const date = encounter.period?.start ?? ''
    if (date && Date.parse(date) > now.getTime()) continue
    const codes = (encounter.reasonCode ?? []).flatMap(r => r.coding ?? [])
    // Older bridge rows encode the ICD at the beginning of the diagnosis display.
    for (const text of [...(encounter.reasonCode ?? []).map(r => r.text), ...(encounter.diagnosis ?? []).map(d => d.condition?.display)]) {
      const match = text?.match(/^\s*(I48(?:\.?\d{1,2})?|427\.?31)\b/i)
      if (match) codes.push({ code: match[1] })
    }
    const code = codes.find(isAfCode)
    if (code) return { value: 'yes', date, testName: `就醫紀錄 AF 診斷碼：${code.code}（申報診斷，請核對）`, obsId: encounter.id, resourceType: 'Encounter', facility: encounter.serviceProvider?.display }
  }
  return undefined
}

/**
 * A diagnosis the record carries, by its ICD-10 or ICD-9 code, from conditions
 * or encounter diagnoses — 「是」 only. The cloud record covers about a year,
 * so a code it lacks is not a 「否」: that stays the clinician's to answer.
 */
function diagnosisSelect(
  conditions: ConditionEntity[],
  encounters: EncounterEntity[],
  now: Date,
  matches: (code: string) => boolean,
  name: string,
): ClinicalSelectValue | undefined {
  const normal = (code: string | undefined) => code?.replace(/\./g, '').toUpperCase() ?? ''
  for (const condition of conditions) {
    if (['refuted', 'entered-in-error', 'provisional', 'differential', 'unconfirmed'].includes(condition.verificationStatus ?? '') || condition._inferred) continue
    if (['inactive', 'resolved', 'remission'].includes(condition.clinicalStatus ?? '')) continue
    const date = condition.recordedDate ?? condition.onsetDateTime ?? ''
    if (date && Date.parse(date) > now.getTime()) continue
    const code = condition.code?.coding?.find((coding) => (!coding.system || /icd/i.test(coding.system)) && matches(normal(coding.code)))
    if (code) return { value: 'yes', date, testName: `${name}診斷碼：${code.code}（請核對）`, obsId: condition.id, resourceType: 'Condition' }
  }
  for (const encounter of encounters) {
    if (['cancelled', 'entered-in-error'].includes(encounter.status ?? '')) continue
    const date = encounter.period?.start ?? ''
    if (date && Date.parse(date) > now.getTime()) continue
    const codes = (encounter.reasonCode ?? []).flatMap((reason) => reason.coding ?? []).map((coding) => coding.code)
    // Older bridge rows encode the ICD at the beginning of the diagnosis display.
    for (const text of [...(encounter.reasonCode ?? []).map((reason) => reason.text), ...(encounter.diagnosis ?? []).map((item) => item.condition?.display)]) {
      const match = text?.match(/^\s*([A-Z]\d{2}(?:\.?\d{1,4})?|\d{3}(?:\.?\d{1,2})?)\b/i)
      if (match) codes.push(match[1])
    }
    const code = codes.find((candidate) => matches(normal(candidate)))
    if (code) return { value: 'yes', date, testName: `就醫紀錄${name}診斷碼：${code}（申報診斷，請核對）`, obsId: encounter.id, resourceType: 'Encounter', facility: encounter.serviceProvider?.display }
  }
  return undefined
}

/** ICD-10 E08–E13, ICD-9 250. */
const isDiabetesCode = (code: string) => /^(?:E0[89]|E1[0-3])/.test(code) || /^250/.test(code)
/** ICD-10 J43 (emphysema), J44; ICD-9 491, 492, 496. */
const isCopdCode = (code: string) => /^J4[34]/.test(code) || /^(?:491|492|496)/.test(code)

const BETA_BLOCKERS = ['bisoprolol', 'carvedilol', 'metoprolol', 'atenolol', 'nebivolol', 'propranolol', 'labetalol', 'acebutolol', 'betaxolol', 'nadolol', 'pindolol', 'bucindolol']
const ACEI_ARB = ['captopril', 'enalapril', 'lisinopril', 'ramipril', 'perindopril', 'benazepril', 'fosinopril', 'imidapril', 'quinapril', 'cilazapril', 'trandolapril', 'losartan', 'valsartan', 'candesartan', 'irbesartan', 'telmisartan', 'olmesartan', 'azilsartan', 'eprosartan']

/**
 * Whether a current prescription holds a drug of the class — by ingredient
 * name, else by ATC prefix. 「否」 only when the record lists current
 * prescriptions and none is of the class; with none at all, nothing is said.
 * Worded 「依處方推算，請核對實際服用」, as the antihypertensive count is.
 */
function drugClassSelect(
  medications: MedicationEntity[],
  now: Date,
  names: readonly string[],
  atcPrefix: RegExp,
  className: string,
): ClinicalSelectValue | undefined {
  const current = medications.filter((med) => {
    if (!isMedicationBeingTaken(med, now)) return false
    if (med.authoredOn && Date.parse(med.authoredOn) > now.getTime()) return false
    const end = medicationSupplyEndDate(med)
    return !(end && end < now.toISOString().slice(0, 10))
  })
  if (!current.length) return undefined
  for (const med of current) {
    const atc = medicationAtcCode(med) ?? med.atcClassification?.atcCode
    const text = [med.drugTerminology?.ingredientText, medicationDisplayName(med), med.drugTerminology?.officialNameEn].filter(Boolean).join(' ')
    const name = names.find((candidate) => new RegExp(`\\b${candidate}\\b`, 'i').test(text))
    if (name || (atc && atcPrefix.test(atc))) {
      return { value: 'yes', date: med.authoredOn?.slice(0, 10) ?? now.toISOString().slice(0, 10), testName: `目前處方：${name ?? medicationDisplayName(med)}（依處方推算，請核對實際服用）`, obsId: med.id, resourceType: med._sourceResourceType ?? 'MedicationRequest', facility: med.requester?.display ?? med.informationSource?.display }
    }
  }
  return { value: 'no', date: now.toISOString().slice(0, 10), testName: `目前有效處方未見${className}（依處方推算，請核對實際服用）` }
}

export function buildClinicalSelects(reports: DiagnosticReportEntity[], medications: MedicationEntity[], now = new Date(), conditions: ConditionEntity[] = [], encounters: EncounterEntity[] = []): Partial<Record<ClinicalSelectKey, ClinicalSelectValue>> {
  const ecg = ecgSelects(reports, now)
  const diagnosis = afDiagnosis(conditions, encounters, now)
  const uncertainAf = reports.some(r => {
    const text = reportNarrative(r)
    return /atrial\s+fibrillation|心房顫動|\bAF\b/i.test(text) && /possible|suspect|cannot\s+exclude|rule\s*out|\br\/o\b|疑/i.test(text)
  })
  // An unclassified source that explicitly records AF cannot prove its absence.
  // Keep the finding for manual review instead of inferring "no" from an older
  // recognised tracing. Voided, preliminary and future reports are not evidence.
  const unclassifiedAf = reports.some(report => {
    if (['entered-in-error', 'cancelled', 'registered', 'partial', 'preliminary'].includes(report.status ?? '')) return false
    const date = report.effectiveDateTime ?? report.effectivePeriod?.start ?? report.issued ?? ''
    if (!Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime()) return false
    const text = reportNarrative(report)
    return classifyReport(report, text) !== 'ecg' && affirmedAf(text, true)
  })
  const blocksNegativeAf = uncertainAf || unclassifiedAf
  const ecgAfHistory = blocksNegativeAf && ecg.afHistory?.value === 'no' ? undefined : ecg.afHistory
  const afHistory = diagnosis ?? ecgAfHistory ?? (!blocksNegativeAf && ecg.rhythm?.value === 'sr' ? { ...ecg.rhythm, value: 'no', testName: '目前未見 AF 診斷碼或 EKG AF 紀錄；最近 EKG 為竇性心律（請核對陣發性 AF 病史）' } : undefined)
  const diabetes = diagnosisSelect(conditions, encounters, now, isDiabetesCode, '糖尿病')
  const copd = diagnosisSelect(conditions, encounters, now, isCopdCode, 'COPD ')
  const betaBlocker = drugClassSelect(medications, now, BETA_BLOCKERS, /^C07/, ' β 阻斷劑')
  const aceiArb = drugClassSelect(medications, now, ACEI_ARB, /^C09/, ' ACEI／ARB')
  return {
    ...ecg,
    afHistory,
    antihypertensives: antihypertensiveSelect(medications, now),
    ...(diabetes ? { diabetes } : {}),
    ...(copd ? { copd } : {}),
    ...(betaBlocker ? { betaBlocker } : {}),
    ...(aceiArb ? { aceiArb } : {}),
  }
}
