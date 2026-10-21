// Imaging / pathology report helpers shared by every 初診快覽 consumer that
// reads report text: the AI scope's latest-per-class floor, the overview
// snapshot, and the 影像與病理重點 digest. One definition each, so the three
// cannot disagree about what a report says, which study it is, or which
// modality it belongs to.
import type { DiagnosticReportEntity } from '@/src/core/entities/clinical-data.entity'
import {
  decodeBase64,
  stripHtmlToText,
} from '@/src/core/utils/clinical-documents.utils'
import {
  inferGroupFromDiagnosticReport,
  type ReportGroup,
} from '@/src/shared/utils/report-grouping-helpers'

/** Report groups that reach an AI surface besides the lab tables. Pathology
 *  rides on the imaging selection: a biopsy result is the one report an
 *  oncology second opinion cannot do without. */
export const AI_REPORT_GROUPS: ReadonlySet<string> = new Set(['imaging', 'pathology'])

/** The modality classes the UI names. Anything else is `other`. */
export const REPORT_MODALITY_KINDS = [
  'pathology',
  'pet',
  'ct',
  'mri',
  'echo',
  'us',
  'ecg',
  'xray',
  'other',
] as const
export type ReportModalityKind = (typeof REPORT_MODALITY_KINDS)[number]

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim()
}

/** Modality class of a report: the unit "one latest report per type" is
 *  measured in. Two resources for the same study (a bridge emits a Chinese
 *  and an English row) share a class, so the duplicate is dropped; CT and MRI
 *  do not, so neither hides the other. Higher rank wins the cap. */
export function reportModalityClass(group: string, typeText: string): { cls: string; rank: number } {
  const t = typeText.toLowerCase()
  if (group === 'pathology' || /path|cytolog|biops|病理|切片|細胞/.test(t)) return { cls: 'pathology', rank: 7 }
  if (/\bpet\b|正子/.test(t)) return { cls: 'pet', rank: 6 }
  if (/\bct\b|tomograph|斷層/.test(t)) return { cls: 'ct', rank: 5 }
  if (/\bmri?\b|magnetic|磁振/.test(t)) return { cls: 'mri', rank: 5 }
  // NHI bills one echocardiogram as 超音波心臟圖 (18005C) plus 杜卜勒氏彩色
  // 心臟血流圖 (18007C); both are the echo, not an abdominal ultrasound.
  if (/echo|心臟超音波|超音波心臟|心超|心臟血流/.test(t)) return { cls: 'echo', rank: 4 }
  if (/ultras|sono|超音波/.test(t)) return { cls: 'us', rank: 4 }
  if (/ecg|ekg|electrocardio|心電圖/.test(t)) return { cls: 'ecg', rank: 3 }
  if (/x-?ray|radiograph|chest film|cxr|ｘ光|x光|胸腔檢查/.test(t)) return { cls: 'xray', rank: 1 }
  return { cls: `${group}:${normalizeName(typeText)}`, rank: 2 }
}

/** The report's order name as the source wrote it (text first, then the
 *  first coded display) — the string the modality class is read from. */
export function reportTypeText(report: Pick<DiagnosticReportEntity, 'code'>): string | undefined {
  const text = report.code?.text?.trim()
  if (text) return text
  return report.code?.coding
    ?.map((coding) => coding.display?.trim())
    .find((display): display is string => Boolean(display))
}

export interface ReportModality {
  group: ReportGroup
  cls: string
  rank: number
  kind: ReportModalityKind
}

/** Group (same inference as the AI scope) plus modality class of one report. */
export function reportModality(report: DiagnosticReportEntity): ReportModality {
  const group = inferGroupFromDiagnosticReport(report)
  const typeText = (reportTypeText(report) ?? group).replace(/\s+/g, ' ').trim()
  const { cls, rank } = reportModalityClass(group, typeText)
  const kind = (REPORT_MODALITY_KINDS as readonly string[]).includes(cls)
    ? (cls as ReportModalityKind)
    : 'other'
  return { group, cls, rank, kind }
}

/** True for an imaging or pathology report — the reports AI may read. */
export function isAiScopeReport(report: DiagnosticReportEntity): boolean {
  return AI_REPORT_GROUPS.has(inferGroupFromDiagnosticReport(report))
}

/** NHI cloud records name every CT the same (33071B 電腦斷層造影) whatever the
 *  body part, so "latest per modality" would let a head CT hide a chest CT.
 *  Collapse only what is demonstrably the same study: same modality and day,
 *  plus the same accession identifier OR the very same report text. Bridges
 *  emit one study twice (a Chinese and an English row, often only one of them
 *  carrying the accession) with identical text; two different studies of one
 *  day without an accession differ in text and are both kept. A report is a
 *  duplicate when ANY of its identities was already seen. */
export function reportIdentities(report: DiagnosticReportEntity, cls: string, date: string): string[] {
  const accession = (report.identifier ?? [])
    .map((identifier) => identifier?.value?.trim())
    .find((value): value is string => !!value)
  const text = reportNarrative(report).replace(/\s+/g, ' ').trim().toLowerCase()
  return [
    ...(accession ? [`${cls}|${date}|accession:${accession}`] : []),
    ...(text ? [`${cls}|${date}|text:${text}`] : []),
    // Neither: nothing proves a duplicate, so the report stands alone.
    ...(!accession && !text ? [`${cls}|${date}|resource:${report.id ?? ''}`] : []),
  ]
}

/** Pathology (and some bridge imaging) reports carry their text only as a
 *  presentedForm attachment; without decoding it a consumer would list the
 *  report with no finding, which is worse than omitting it. */
export function reportNarrative(report: DiagnosticReportEntity): string {
  const direct = report.conclusion
    || (report.note ?? []).map((note) => note.text).filter(Boolean).join(' ')
  if (direct?.trim()) return direct
  for (const attachment of (report as { presentedForm?: Array<{ contentType?: string; data?: string }> }).presentedForm ?? []) {
    const contentType = String(attachment?.contentType ?? '').toLowerCase()
    if (!attachment?.data) continue
    if (contentType && !/text|html|xml/.test(contentType)) continue
    const decoded = stripHtmlToText(decodeBase64(attachment.data)).trim()
    if (decoded) return decoded
  }
  return ''
}
