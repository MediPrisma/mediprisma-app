import type { DiagnosticReport } from '../types/fhir.types'
import { inferReportDisplayGroup } from './report-grouping-helpers'
import {
  qualifyingSharedReportKeys,
  sharedReportGroupingKey,
  sharedReportNarrative,
} from './shared-report-grouping'

type Report = DiagnosticReport & { _observations?: Array<{
  performer?: Array<{ reference?: string; display?: string }>
  valueString?: string; valueQuantity?: unknown; valueCodeableConcept?: unknown; component?: unknown[]
}> }
type Source = 'hospital' | 'cloud'
const VGH_NAMES = new Set(['臺北榮總', '台北榮總', '臺北榮民總醫院', '台北榮民總醫院'])
const DATE = String.raw`\d{4}[/-]\d{2}[/-]\d{2}`
const CLOCK = String.raw`\d{2}:\d{2}(?::\d{2})?`
const SIGNATURE = new RegExp(String.raw`\s+Reported\s+By\s+[^\r\n]{1,180}?\bOn:\s*${DATE}\s*\(${CLOCK}\)\s*,?\s*\(by\s+[^)\r\n]{1,180}\)\s*At:\s*[A-Za-z0-9_-]+?(?:(ACR\s+BI-RADS\s+[0-6])|(Positive\s+Rate\s+Evaluation\s+\d+))?\s*$`, 'i')
const EXAM_HEADER = new RegExp(String.raw`^((?:SONO(?:GRAM)?|CHEST|CT(?:/SCAN)?|MRI|RADIOGRAPH)[^\r\n:.<>]{0,120}\s+)?Date\s+Of\s+Examination:\s*(${DATE})(?:\s+${CLOCK})?\s+Date\s+Of\s+RCP:\s*${DATE}\s*`, 'i')

/** Compare complete clinical text, never a similarity score or a prefix.
 * Only the bridge's recognized administrative wrapper is ignored. Unknown
 * footer formats remain part of the text and therefore fail closed. */
export function normalizeImagingReportCopy(value: string): string {
  let text = value.normalize('NFKC').trim()
  const signature = SIGNATURE.exec(text)
  if (signature) {
    const body = text.slice(0, signature.index)
    const birads = signature[1]?.match(/[0-6]$/)?.[0]
    // BI-RADS is clinical content: a trailing grade is redundant ONLY if the
    // body explicitly contains the same grade. Never discard a conflicting one.
    if (!birads || new RegExp(String.raw`^(?:Impression\s*:?\s*)?BI-RADS\s+(?:category\s+)?${birads}\b`, 'i').test(body)) text = body
  }
  text = text.replace(EXAM_HEADER, '').replace(/^Impression\s*:?\s*/i, '')
  return text.toLowerCase().replace(/\s+/g, '')
}

function sourceOf(report: Report): Source | undefined {
  if (report.meta?.tag?.some(tag => tag.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement')) return 'hospital'
  if (/^https:\/\/medcloud2\.nhi\.gov\.tw(?:\/|$)/.test(report.meta?.source ?? '')) return 'cloud'
  return undefined
}

/** This adapter's explicit source tag identifies Taipei VGH. An old hospital
 * mapper placed the requesting physician in performer; never interpret that
 * person's display as a hospital, or infer the hospital from report contents. */
export function imagingCopyInstitution(report: Report): string | undefined {
  const performers = [...(report.performer ?? []), ...(report._observations ?? []).flatMap(obs => obs.performer ?? [])]
  const organizations = performers.filter(p => !p.reference || /(?:^|\/)Organization\//.test(p.reference))
  // Only the known legacy DOC physician label can be ignored. An unknown
  // organization/name is not evidence that this particular exam was at VGH.
  if (organizations.some(p => !VGH_NAMES.has(p.display?.trim() ?? '')
    && (p.reference || (p.display?.trim() && !/^DOC[A-Z0-9]+\b/i.test(p.display.trim()))))) return undefined
  if (organizations.some(p => VGH_NAMES.has(p.display?.trim() ?? ''))) return '臺北榮總'
  if (sourceOf(report) === 'hospital') {
    // Explicit contradictory organization evidence beats the adapter default.
    if (organizations.some(p => p.reference && p.display?.trim())) return undefined
    return '臺北榮總'
  }
  return undefined
}

function examDay(report: Report): string | undefined {
  const raw = report.effectiveDateTime ?? report.effectivePeriod?.start
  if (!raw || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw)) return undefined
  const day = raw.slice(0, 10)
  const date = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return undefined
  if (!raw.includes('T')) return day
  const instant = sourceInstant(raw)
  return instant === undefined ? undefined : new Date(instant + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// This source adapter is Taipei VGH: offset-less source times are UTC+08:00.
function sourceInstant(value: string): number | undefined {
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  const instant = Date.parse(explicitZone ? value : `${value}+08:00`)
  return Number.isFinite(instant) ? instant : undefined
}

function examTime(report: Report): string | undefined {
  const header = /Date\s+Of\s+Examination:\s*(\d{4}[/-]\d{2}[/-]\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/i.exec(sharedReportNarrative(report))
  const headerTime = header ? sourceInstant(`${header[1].replaceAll('/', '-')}T${header[2]}`) : undefined
  const value = report.effectiveDateTime ?? report.effectivePeriod?.start ?? ''
  const clock = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(value)?.[1]
  // The bridge supplies midnight when it knows only a date.
  const meaningful = clock && !/^00:00(?::00)?$/.test(clock) ? sourceInstant(value) : undefined
  if (headerTime !== undefined && meaningful !== undefined && headerTime !== meaningful) return 'conflicting-exam-times'
  const instant = headerTime ?? meaningful
  return instant === undefined ? undefined : String(instant)
}

function modality(report: Report): string | undefined {
  const title = [report.code?.text, ...(report.code?.coding ?? []).map(c => c.display)].filter(Boolean).join(' ')
  if (/magnetic|\bmri?\b|磁振|核磁/i.test(title)) return 'MR'
  if (/computed tomography|\bct\b|電腦斷層/i.test(title)) return 'CT'
  if (/sono|ultrason|超音波/i.test(title)) return 'US'
  if (/x[ -]?ray|radiograph|chest.*view|胸腔檢查|[XＸ]光/i.test(title)) return 'XR'
  return undefined
}

export function compareImagingCopies(a: Report, b: Report): number {
  return sharedReportNarrative(b).length - sharedReportNarrative(a).length
    || (a.id ?? '').localeCompare(b.id ?? '')
}

/** Shared grouping projection for rows, tab counts and AI context. Returned
 * keys do not modify source resources. Same-source shared-procedure grouping
 * retains its existing strict boundary; cross-source copies get an additional
 * one-to-one check, so two identical same-day exams cannot be paired by luck. */
export function reportDisplayGroupingKeys(reports: readonly Report[]): Map<Report, string> {
  const keys = new Map<Report, string>()
  const sharedKeys = qualifyingSharedReportKeys([...reports])
  for (const report of reports) {
    if (!report) continue
    const key = sharedReportGroupingKey(report)
    if (key && sharedKeys.has(key)) keys.set(report, key)
  }
  const originalKeys = new Map(keys)
  const buckets = new Map<string, { report: Report; source: Source }[]>()
  for (const report of reports) {
    if (!report || inferReportDisplayGroup(report) !== 'imaging') continue
    // Echo/Doppler and their viewer-only companions have a separate established
    // shared-study path. Do not re-key just part of that family here.
    if (report.code?.coding?.some(coding => ['18005C', '18007C'].includes(coding.code ?? ''))) continue
    // A text match cannot establish equality of independent structured results.
    // Leave those reports separate, including unresolved result references.
    if (report.result?.length
      || report._observations?.some(obs => !obs.valueString || obs.valueString.trim().length <= 30 || obs.valueQuantity || obs.valueCodeableConcept || obs.component?.length)) continue
    const source = sourceOf(report)
    const institution = imagingCopyInstitution(report)
    const method = modality(report)
    const day = examDay(report)
    const subject = report.subject?.reference?.trim()
    if (!source || !institution || !method || !day || !subject || !['final', 'amended', 'corrected'].includes(report.status ?? '')) continue
    if (report.meta?.tag?.some(tag => tag.code === 'adult-preventive')) continue
    const raw = sharedReportNarrative(report)
    const headerDay = /Date\s+Of\s+Examination:\s*(\d{4}[/-]\d{2}[/-]\d{2})/i.exec(raw)?.[1].replaceAll('/', '-')
    if (headerDay && headerDay !== day) continue
    const narrative = normalizeImagingReportCopy(raw)
    // Short stock phrases and explicitly truncated previews cannot identify an exam.
    if (narrative.length < 80 || /…|\.{3}/.test(raw)) continue
    const key = JSON.stringify([subject, day, institution, method, report.status, narrative])
    const bucket = buckets.get(key) ?? []
    bucket.push({ report, source })
    buckets.set(key, bucket)
  }
  for (const [key, bucket] of buckets) {
    const hospital = bucket.filter(item => item.source === 'hospital')
    const cloud = bucket.filter(item => item.source === 'cloud')
    if (!hospital.length || !cloud.length) continue
    const members = new Set(bucket.map(item => item.report))
    const memberKeys = new Set(bucket.map(item => originalKeys.get(item.report)).filter(Boolean))
    // Existing shared-procedure groups are atomic. Never strand excluded members.
    if ([...originalKeys].some(([report, originalKey]) => memberKeys.has(originalKey) && !members.has(report))) continue
    // Multiple billing lines may already be proved to share one exact report.
    // Otherwise repeated identical narratives on either side are ambiguous.
    const isOneExam = (items: typeof bucket) => items.length === 1 || (
      items.every(item => keys.has(item.report))
      && new Set(items.map(item => keys.get(item.report))).size === 1
    )
    if (!isOneExam(hospital) || !isOneExam(cloud)) continue
    const encounters = new Set(bucket.flatMap(({ report }) => !report._encounterInferred && report.encounter?.reference ? [report.encounter.reference] : []))
    if (encounters.size > 1) continue
    const identifiers = new Map<string, Set<string>[]>()
    for (const { report } of bucket) {
      const bySystem = new Map<string, Set<string>>()
      for (const id of report.identifier ?? []) {
        if (id.system && id.value) bySystem.set(id.system, new Set([...(bySystem.get(id.system) ?? []), id.value]))
      }
      for (const [system, values] of bySystem) identifiers.set(system, [...(identifiers.get(system) ?? []), values])
    }
    if ([...identifiers.values()].some(sets => sets.length > 1 && ![...sets[0]].some(value => sets.every(set => set.has(value))))) continue
    const times = bucket.map(item => examTime(item.report)).filter(Boolean)
    if (times.includes('conflicting-exam-times') || new Set(times).size > 1) continue
    for (const { report } of bucket) keys.set(report, `cross-source|${key}`)
  }
  return keys
}
