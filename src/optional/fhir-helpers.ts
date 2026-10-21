// Shared public medication helpers retained from 80c3a767c^; no CDSS engine.
import type { MedicationEntity, DiagnosticReportEntity } from "@/src/core/entities/clinical-data.entity"
import { decodeBase64, stripHtmlToText } from "@/src/core/utils/clinical-documents.utils"


/**
 * 記錄來源是健保雲端病歷／健康存摺：跨院所的「處方」紀錄，只有「開過這張處方」
 * 與「沒有這張處方」兩種狀態。Bridge 由 `authoredOn + expectedSupplyDuration`
 * 推算 `status`：供應期內寫 `active`、供應期過了寫 `completed`；不會出現
 * `on-hold` 或 `stopped`，也沒有 MedicationStatement 可以再確認一次。
 *
 * 因此 `completed` 只代表「這批藥發完了」，不代表停藥：慢性處方箋晚幾天回診、
 * 換一家院所回補處方，都會讓供應期短暫斷開。供應結束後 30 天內的處方仍視為
 * 使用中（晚領藥不是停藥），超過 30 天才視為沒有在用。
 *
 * 反過來說，跨院所資料裡「沒有紀錄」本身就是證據：不必再對醫師說「資料中未見
 * 不等於沒有使用」。
 */
const PRESCRIPTION_GRACE_DAYS = 30


const DAY_MS = 24 * 60 * 60 * 1000


/**
 * Statuses that void a prescription record, mirroring `EXCLUDED_MEDICATION_STATUS`
 * in the profile adapter. Everything else is admitted — including `unknown` and
 * a missing status — and whether the patient is taking it is then decided by the
 * supply window alone.
 *
 * This is a denylist rather than an `active|completed|on-hold|stopped` allowlist
 * because `unknown` is a legal FHIR status and the NHI cloud record carries no
 * lifecycle of its own: the bridge writes `unknown` on every MedicationRequest
 * it emits, so the allowlist dropped every real prescription and left the packs
 * scanning an empty medication list.
 */
const EXCLUDED_MEDICATION_STATUSES = new Set(['cancelled', 'entered-in-error'])


/**
 * `Duration` -> days. Only units that can be read with certainty are converted;
 * anything else (including a missing unit) is reported as unreadable so the
 * caller treats the supply window as absent rather than guessing at it.
 */
function supplyDurationDays(duration: unknown): number | undefined {
  const quantity = duration as {
    value?: unknown
    unit?: unknown
    code?: unknown
  } | null | undefined
  const value = Number(quantity?.value)
  if (!Number.isFinite(value) || value <= 0) return undefined

  const unit = String(quantity?.code ?? quantity?.unit ?? '').trim().toLowerCase()
  if (/^(?:d|day|days|天|日)$/.test(unit)) return value
  if (/^(?:wk|w|week|weeks|週|周|星期)$/.test(unit)) return value * 7
  if (/^(?:mo|month|months|月|個月)$/.test(unit)) return value * 30
  if (/^(?:a|y|yr|year|years|年)$/.test(unit)) return value * 365
  if (/^(?:h|hr|hour|hours|小時)$/.test(unit)) return value / 24
  return undefined
}


/** `authoredOn + dispenseRequest.expectedSupplyDuration`, when both are readable. */
function supplyEndMs(medication: MedicationEntity): number | undefined {
  const days = supplyDurationDays(medication.dispenseRequest?.expectedSupplyDuration)
  if (days === undefined) return undefined
  const startMs = Date.parse(medication.authoredOn ?? '')
  if (!Number.isFinite(startMs)) return undefined
  return startMs + days * DAY_MS
}


/**
 * The one definition of "病人有在用這個藥" for the whole adapter: an `active`
 * prescription, or a `completed` one whose supply ran out no more than
 * PRESCRIPTION_GRACE_DAYS ago. A `completed` prescription with no readable
 * supply window cannot be placed in time, so it does not count.
 */
export function isMedicationBeingTaken(
  medication: MedicationEntity,
  now: Date = new Date(),
): boolean {
  const status = (medication.status ?? '').trim().toLowerCase()
  if (EXCLUDED_MEDICATION_STATUSES.has(status)) return false
  if (status === 'active') return true
  // `completed`, `unknown` and a missing status all describe a prescription the
  // record does not settle either way, so the supply window is what decides.
  // `on-hold`, `stopped` and `draft` do settle it, and settle it as not taken.
  if (status !== 'completed' && status !== 'unknown' && status !== '') return false
  const endMs = supplyEndMs(medication)
  if (endMs === undefined) return false
  return now.getTime() - endMs <= PRESCRIPTION_GRACE_DAYS * DAY_MS
}


/**
 * The day this prescription's supply runs out, as an ISO date. Undefined under
 * exactly the condition that stops a `completed` prescription from counting as
 * taken, so a caller that has no date here has no supply window to report.
 */
export function medicationSupplyEndDate(
  medication: MedicationEntity,
): string | undefined {
  const endMs = supplyEndMs(medication)
  if (endMs === undefined) return undefined
  return new Date(endMs).toISOString().slice(0, 10)
}


export function medicationDisplayName(medication: MedicationEntity): string {
  return medication.drugTerminology?.ingredientText?.trim()
    || medication.drugTerminology?.officialNameEn?.trim()
    || medication.medicationCodeableConcept?.text
    || medication.medicationCodeableConcept?.coding?.find((coding) => coding.display)?.display
    || medication.medicationReference?.display
    || '未命名藥物'
}
export function medicationAtcCode(medication: MedicationEntity): string | undefined {
  return medication.drugTerminology?.atcCode?.trim()
    || medication.medicationCodeableConcept?.coding?.find(coding => /whocc|atc/i.test(coding.system ?? ''))?.code
}

// Read source-authored report text only. No facts are inferred from missing text.
export function reportNarrative(report: DiagnosticReportEntity & { text?: { div?: string } }): string {
  return [report.conclusion, stripHtmlToText(report.text?.div ?? ''),
    ...(report.presentedForm ?? []).filter(form => /text\/(plain|html)/i.test(form.contentType ?? ''))
      .map(form => form.data ? stripHtmlToText(decodeBase64(form.data)) : ''),
    ...(report._observations ?? []).map(observation => observation.valueString ?? ''),
  ].filter(Boolean).join('\n')
}
export function classifyReport(report: DiagnosticReportEntity, narrative = reportNarrative(report)): 'ecg' | 'echocardiography' | 'other' {
  // LOINC document identity takes precedence over bridge-specific order names.
  // The same digits under another coding system do not identify a LOINC study.
  for (const coding of report.code?.coding ?? []) {
    if (coding.system !== 'http://loinc.org') continue
    if (coding.code === '11524-6') return 'ecg'
    if (coding.code === '59281-6' || coding.code === '80859-2') return 'echocardiography'
  }
  // Keep legacy NHI orders: the two bridges use different coding-system URLs,
  // and older converted bundles may have no system or LOINC coding at all.
  const codes = new Set((report.code?.coding ?? []).map(coding => coding.code?.trim().toUpperCase()))
  if (codes.has('18005C') || codes.has('18007C')) return 'echocardiography'
  if (codes.has('18001C')) return 'ecg'
  const label = [report.code?.text, ...report.code?.coding?.map(coding => coding.display ?? coding.code) ?? []].join(' ')
  if (/echocardiogra|cardiac\s*(?:echo|ultrasound)|心臟超音波|心超|\b(?:echo|TTE|TEE)\b/i.test(label)) return 'echocardiography'
  if (/electrocardiogra|心電圖|\b(?:ECG|EKG)\b/i.test(label)) return 'ecg'
  // Explicit labels in the narrative are accepted; generic findings are not.
  if (/echocardiogra|心臟超音波|心超/i.test(narrative)) return 'echocardiography'
  if (/electrocardiogra|心電圖|\b(?:ECG|EKG)\b/i.test(narrative)) return 'ecg'
  // FHIR permits a category concept or an array. EC/CUS are service-section
  // identifiers; legacy concepts omit the system. Unrelated named catalogues
  // containing the same tokens are ignored.
  const categories: Array<{ coding?: Array<{ system?: string; code?: string }> }> = Array.isArray(report.category)
    ? report.category : report.category ? [report.category] : []
  const sections = categories.flatMap(category => category.coding ?? [])
    .filter(coding => !coding.system || ['http://terminology.hl7.org/CodeSystem/v2-0074', 'http://hl7.org/fhir/v2/0074'].includes(coding.system))
    .map(coding => coding.code?.toUpperCase())
  if (sections.includes('EC')) return 'ecg'
  if (sections.includes('CUS')) return 'echocardiography'
  return 'other'
}
export function extractEcgFindings(text: string): { rhythm?: 'sinus' } {
  const match = /(?:\b(?:normal\s+)?sinus\s+(?:rhythm|bradycardia|tachycardia)\b|竇性心律)/i.exec(text)
  if (!match || /(?:\bno\b|\bnot\b|without|possible|suspect|疑|未見|無)[^,，.;；]*$/i.test(text.slice(0, match.index))) return {}
  return { rhythm: 'sinus' }
}
export function extractEchoMeasurements(text: string): { eOverEPrime?: number } {
  const match = /\bE\s*\/\s*e['′’]?\s*[:=]?\s*(\d+(?:\.\d+)?)(?![\d.])/i.exec(text)
  if (!match || /^\s*(?:[-–~～]|to\b)\s*\d/i.test(text.slice((match.index ?? 0) + match[0].length))) return {}
  return { eOverEPrime: Number(match[1]) }
}
