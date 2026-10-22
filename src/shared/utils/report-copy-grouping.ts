import type { DiagnosticReport as Report } from '../types/fhir.types'
import { getNhiReportModality, inferReportDisplayGroup, isRadiographLabel, IMAGING_EXAM_HEADER as EXAM_HEADER } from './report-grouping-helpers'
import { getImagingCopySource as sourceOf, reportNaturalGroupingKey, isReportReceiptClock, typedReportIdentifierValue } from './report-identity'
import { isTrustedLegacyNhiViewerAttachment } from './nhi-viewer-attachment'
import { isAdultPreventiveHealthExamResource, isNhiAuthorityDisplay } from './observation-provenance.utils'
import {
  qualifyingSharedReportKeys,
  sharedReportGroupingKey,
  sharedReportNarrative,
  sharedReportSourceIdentity,
} from './shared-report-grouping'

type Source = 'hospital' | 'cloud'
const VGH_NAMES = new Set(['臺北榮總', '台北榮總', '臺北榮民總醫院', '台北榮民總醫院'])
const DATE = String.raw`\d{4}[/-]\d{2}[/-]\d{2}`
const CLOCK = String.raw`\d{2}:\d{2}(?::\d{2})?`
const SIGNATURE = new RegExp(String.raw`\s+Reported\s+By\s+(?:(?!\bOn:|Reported\s+By)[^\r\n]){1,180}?\bOn:\s*${DATE}\s*\(${CLOCK}\)\s*,?\s*\(by\s+[^)\r\n]{1,180}\)\s*At:\s*[A-Za-z0-9_-]+?(?:(ACR\s+BI-RADS\s+[0-6])|(Positive\s+Rate\s+Evaluation\s+\d+))?\s*$`, 'i')

function foldFullWidthAscii(value: string): string {
  return value.replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ')
}

/** Safe typography comparison without discarding source signatures/addenda. */
export function normalizeImagingClinicalText(value: string): string {
  // Preserve legacy dictation joins at explicit capitalized-word boundaries
  // and punctuation. Never erase whitespace or case: that would equate
  // numeric tokens, scientific notation, units, or "no table"/"notable".
  return foldFullWidthAscii(value)
    .replace(/([a-z]{2})(?=[A-Z][a-z]{2})/g, '$1 ')
    .replace(/([A-Z]{2})(?=[A-Z][a-z])/g, '$1 ')
    .replace(/([:;])(?=[A-Za-z])/g, '$1 ')
    .replace(/([A-Za-z])\.(?=[A-Za-z])/g, '$1. ')
    .replace(/\s+/g, ' ').trim()
}

/** Compare complete clinical text, never a similarity score or a prefix.
 * Only the bridge's recognized administrative wrapper is ignored. Unknown
 * footer formats remain part of the text and therefore fail closed. */
export function normalizeImagingReportCopy(value: string): string {
  // Fold only full-width ASCII and its space. Compatibility normalization and
  // lowercasing can erase clinical differences: 10²/102, µ/μ or mM/mm.
  let text = foldFullWidthAscii(value).trim().replace(EXAM_HEADER, '')
  // Multiple signatures can bracket a clinical addendum. Never reduce that
  // multi-version document to the text before its first signature.
  const signature = (text.match(/\bReported\s+By\b/gi)?.length ?? 0) === 1 ? SIGNATURE.exec(text) : null
  if (signature) {
    const body = text.slice(0, signature.index)
    const birads = signature[1]?.match(/[0-6]$/)?.[0]
    // BI-RADS is clinical content: a trailing grade is redundant ONLY if the
    // body explicitly contains the same grade. Never discard a conflicting one.
    const grades = [...body.matchAll(/\bBI-RADS\s+(?:category\s+)?([0-6])\b/gi)].map(match => match[1])
    const assessment = new RegExp(String.raw`(?:^|[>\n])\s*(?:Impression\s*:?\s*)?BI-RADS\s+(?:category\s+)?${birads}\b`, 'i')
    if (!birads || (assessment.test(body) && grades.every(grade => grade === birads))) text = body
  }
  text = text.replace(/^Impression\b\s*:?\s*/i, '')
  // Keep token boundaries: list item "1. 2 cm" must never equal "1.2 cm".
  // Missing spaces within words are uncertain content, not an automatic match.
  return text.replace(/\s+/g, ' ').trim()
}

/** Known legacy QEMR exports lost HTML line-break spaces. Repair only bounded,
 * unambiguous report phrases, never remove all spaces ("no table"/"notable",
 * numbers, units and negations must remain different). This is a comparison
 * projection; the original narrative is retained for each source. */
const QEMR_LAYOUT_REPAIRS = ['ruled out', 'occupying lesion', 'at bilateral', 'Regular follow',
    'generally recommended', 'splenic hilum', 'visible pancreas', 'follow-up regularly',
    'was performed', 'operative change', 'No change', 'Post radiation']
  .map(phrase => [new RegExp(String.raw`\b${phrase.replaceAll(' ', '')}\b`, 'g'), phrase] as const)

// Compare both copies through the same projection. This allowlist comes from
// observed QEMR line-break losses; unknown joins deliberately remain distinct.
// Add repairs only with a source example and positive/negative regression tests.
function imagingCopyLayoutText(value: string): string {
  let text = normalizeImagingReportCopy(value)
  for (const [pattern, phrase] of QEMR_LAYOUT_REPAIRS) text = text.replace(pattern, phrase)
  return text.replace(/([A-Za-z][,:])\s*(?=[A-Za-z0-9])/g, '$1 ').replace(/\s+/g, ' ').trim()
}

/** Old QEMR effectiveDateTime is explicitly the receipt instant, not a second
 * examination clock. Only this evidenced legacy shape permits day matching. */
function hasReceiptClock(report: Report): boolean {
  return isReportReceiptClock(report) && EXAM_HEADER.test(sharedReportNarrative(report).normalize('NFKC'))
}

/** This adapter's explicit source tag identifies Taipei VGH. An old hospital
 * mapper placed the requesting physician in performer; never interpret that
 * person's display as a hospital, or infer the hospital from report contents. */
export function imagingCopyInstitution(report: Report): string | undefined {
  const performers = [...(report.performer ?? []), ...(report._observations ?? []).flatMap(obs => obs.performer ?? [])]
  // Unresolved URNs/contained references do not establish whether the actor
  // is a person or an institution. Never silently ignore a possible hospital.
  if (performers.some(p => p.reference && !/(?:^|\/)(?:Organization|Practitioner|PractitionerRole)\//.test(p.reference))) return undefined
  const organizations = performers.filter(p => (!p.reference || /(?:^|\/)Organization\//.test(p.reference))
    && !isNhiAuthorityDisplay(p.display ?? ''))
  // Only the known legacy DOC physician label can be ignored. An unknown
  // organization/name is not evidence that this particular exam was at VGH.
  if (organizations.some(p => !VGH_NAMES.has(p.display?.trim() ?? '')
    && (p.reference || (p.display?.trim() && !/^DOC\d+[A-Z0-9]*\b/i.test(p.display.trim()))))) return undefined
  if (organizations.some(p => VGH_NAMES.has(p.display?.trim() ?? ''))) return '臺北榮總'
  if (sourceOf(report) === 'hospital') {
    return '臺北榮總'
  }
  return undefined
}

function sourceDay(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw)) return undefined
  const day = raw.slice(0, 10)
  const date = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return undefined
  if (!raw.includes('T')) return day
  const instant = sourceInstant(raw)
  return instant === undefined ? undefined : new Date(instant + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function examDay(report: Report): string | undefined {
  return sourceDay(report.effectiveDateTime ?? report.effectivePeriod?.start)
}

function periodEnd(report: Report): { day: string; instant?: number } | null | undefined {
  const period = report.effectivePeriod
  if (!period) return undefined
  // FHIR effective[x] is a choice, not two independent examination dates.
  if (report.effectiveDateTime) return null
  if (!period.end) return undefined
  const day = sourceDay(period.end)
  if (!day) return null
  const instant = period.end.includes('T') ? sourceInstant(period.end) : undefined
  const start = period.start?.includes('T') ? sourceInstant(period.start) : undefined
  if (day < (examDay(report) ?? '') || (instant !== undefined && start !== undefined && instant < start)) return null
  return { day, instant }
}

// This source adapter is Taipei VGH: offset-less source times are UTC+08:00.
function sourceInstant(value: string): number | undefined {
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  const instant = Date.parse(explicitZone ? value : `${value}+08:00`)
  return Number.isFinite(instant) ? instant : undefined
}

function examTime(report: Report): string | undefined {
  const header = /Date\s+Of\s+Examination:\s*(\d{4}[/-]\d{2}[/-]\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/i.exec(sharedReportNarrative(report).normalize('NFKC'))
  const headerTime = header ? sourceInstant(`${header[1].replaceAll('/', '-')}T${header[2]}`) : undefined
  if (header && headerTime === undefined) return 'conflicting-exam-times'
  const value = report.effectiveDateTime ?? report.effectivePeriod?.start ?? ''
  const clock = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(value)?.[1]
  // Only a date-only value has unknown time. Explicit midnight (including UTC
  // midnight) remains an instant; it must not bypass conflict detection.
  const meaningful = clock && !isReportReceiptClock(report) ? sourceInstant(value) : undefined
  if (headerTime !== undefined && hasReceiptClock(report)) return String(headerTime)
  if (headerTime !== undefined && meaningful !== undefined && headerTime !== meaningful) return 'conflicting-exam-times'
  const instant = headerTime ?? meaningful
  return instant === undefined ? undefined : String(instant)
}

function modality(report: Report): string | undefined {
  const header = EXAM_HEADER.exec(sharedReportNarrative(report).normalize('NFKC'))?.[1]
  const title = [report.code?.text, ...(report.code?.coding ?? []).map(c => c.display), header].filter(Boolean).join(' ').normalize('NFKC')
    .replace(/\bc\s*\.\s*t\s*\.?/gi, 'ct')
  const methods = [
    ['MR', /magnetic|\bmri?\b|磁振|核磁/i],
    ['CT', /computed tomography|\bct\b|電腦斷層/i],
    ['US', /sono|ultrason|超音波/i],
  ] as const
  const found = new Set<string>(methods.filter(([, pattern]) => pattern.test(title)).map(([method]) => method))
  if ([report.code?.text, ...(report.code?.coding ?? []).map(coding => coding?.display), header]
    .some(label => typeof label === 'string' && isRadiographLabel(label))) found.add('XR')
  for (const coding of report.code?.coding ?? []) {
    const codedMethod = getNhiReportModality(coding?.code)
    if (codedMethod) found.add(codedMethod)
    else if (typeof coding?.code === 'string' && /^\d{5}[A-Z]$/i.test(coding.code.trim())) return undefined
  }
  return found.size === 1 ? [...found][0] : undefined
}

export function compareImagingCopies(a: Report, b: Report): number {
  return Number(!!footerEvaluation(b)) - Number(!!footerEvaluation(a))
    || Number(sourceOf(b) === 'hospital') - Number(sourceOf(a) === 'hospital')
    || sharedReportNarrative(b).replace(/\s+/g, ' ').length - sharedReportNarrative(a).replace(/\s+/g, ' ').length
    || (a.id ?? '').localeCompare(b.id ?? '')
}

function footerEvaluation(report: Report): string | undefined {
  return /Positive\s+Rate\s+Evaluation\s+(\d+)\s*$/i.exec(sharedReportNarrative(report).normalize('NFKC'))?.[1]
}

/** Findings may be templated. Explicit exam labels still constrain a match,
 * even though generic hospital/NHI names are allowed to differ. */
function parseExamLabel(label: string): string[] | null {
  // This is deliberately a bounded recognizer, not a body-site guesser. A new
  // anatomy/protocol term (e.g. knee/ankle) must fail closed until supported.
  const recognized = label
    .replace(/\b(?:CXR|KUB)\b|[XＸ]光/gi, '')
    .replace(/其他/g, '')
    .replace(/\bEcho for others\b/gi, '')
    .replace(/\bc\s*\.\s*t\s*\.?/gi, 'ct')
    .replace(/電腦斷層造影|電腦斷層|磁振造影|磁振|核磁共振|有造影劑|無造影劑|超音波|乳房|胸腔檢查|胸腔|胸部|頭部|頭顱|腦部|頸部|腹部|骨盆|脊椎|左側|右側|雙側|左乳|右乳|雙乳|包括|各種|角度|部位|之/g, '')
    .replace(/\b(?:ct|scan|computed|tomography|chest|thorax|lungs?|head|brain|cranial|neck|abdomen|abdominal|hepatobiliary|liver|gallbladder|pelvis|pelvic|spine|spinal|breasts?|sono|sonogram|sonography|ultrasound|ultrasonography|mri?|magnetic|resonance|imaging|left|right|lt|rt|bilateral|ap|pa|lateral|oblique|xr|x|ray|radiograph(?:y)?|view|views|contrast|with|without|other|system|including|all|various|angles?|and|parts?|of|the|each|film)\b/gi, '')
    .replace(/[\s\p{P}]/gu, '')
  if (recognized) return null
  const left = /\b(?:left|lt)\b|左側|左乳|左肺/i.test(label)
  const right = /\b(?:right|rt)\b|右側|右乳|右肺/i.test(label)
  const side = /\bbilateral\b|雙側|雙乳/i.test(label) || (left && right) ? 'bilateral' : left ? 'left' : right ? 'right' : ''
  const sites = [
    ['breast', /\bbreasts?\b|乳房|左乳|右乳|雙乳/i],
    ['chest', /\b(?:chest|thorax|cxr)\b|胸/i],
    ['lung', /\blungs?\b|肺/i],
    ['head', /\b(?:head|cranial)\b|頭部|頭顱/i],
    ['brain', /\bbrain\b|腦部/i],
    ['neck', /\bneck\b|頸/i],
    ['abdomen', /\b(?:abdomen|abdominal|kub)\b|腹/i],
    ['hepatobiliary', /\bhepatobiliary\b/i],
    ['liver', /\bliver\b|肝/i],
    ['gallbladder', /\bgallbladder\b|膽/i],
    ['pelvis', /\bpelvi[cs]\b|骨盆/i],
    ['spine', /\b(?:spine|spinal)\b|脊椎/i],
  ] as const
  const site = sites.filter(([, pattern]) => pattern.test(label)).map(([name]) => name).join(',')
  const withContrast = (/\bcontrast\b/i.test(label) && /\bwith\b/i.test(label)) || /有造影劑/.test(label)
  const withoutContrast = (/\bcontrast\b/i.test(label) && /\bwithout\b/i.test(label)) || /無造影劑/.test(label)
  const contrast = [withContrast && 'with', withoutContrast && 'without'].filter(Boolean).join(',')
  const view = ['ap', 'pa', 'lateral', 'oblique'].filter(value => new RegExp(`\\b${value}\\b`, 'i').test(label)).join(',')
  return [side, site, contrast, view]
}

function examQualifiers(report: Report): string[] | null {
  const header = EXAM_HEADER.exec(sharedReportNarrative(report).normalize('NFKC'))?.[1]?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
  const labels = [report.code?.text, ...(report.code?.coding ?? []).map(c => c.display), header]
    .filter((label): label is string => !!label?.trim())
  const parsed = labels.map(label => parseExamLabel(label.normalize('NFKC')))
  if (parsed.some(value => value === null)) return null
  const values = parsed as string[][]
  const qualifiers: string[] = []
  for (let index = 0; index < 4; index++) {
    const explicit = new Set(values.map(value => value[index]).filter(Boolean))
    // Different fields describing this same source must agree too. Never turn
    // a left/right disagreement across fields into a bilateral examination.
    if (explicit.size > 1) return null
    qualifiers.push([...explicit][0] ?? '')
  }
  return [header, ...qualifiers, footerEvaluation(report) ?? '']
}

/** Shared grouping projection for rows, tab counts and AI context. Returned
 * keys do not modify source resources. Same-source shared-procedure grouping
 * retains its existing strict boundary; cross-source copies get an additional
 * one-to-one check, so two identical same-day exams cannot be paired by luck. */
export function reportDisplayGroupingKeys(reports: readonly Report[]): Map<Report, string> {
  const originalKeys = new Map<Report, string>()
  try {
    return calculateReportDisplayGroupingKeys(reports, originalKeys)
  } catch {
    // Imported FHIR may contain malformed nested elements. Grouping is an
    // optional display projection: uncertainty must keep reports separate,
    // never prevent the remaining source records from being displayed.
    return originalKeys
  }
}

function calculateReportDisplayGroupingKeys(reports: readonly Report[], originalKeys: Map<Report, string>): Map<Report, string> {
  const keys = new Map<Report, string>()
  const sharedKeys = qualifyingSharedReportKeys([...reports])
  for (const report of reports) {
    if (!report) continue
    const key = sharedReportGroupingKey(report)
    if (key && sharedKeys.has(key)) keys.set(report, key)
  }
  for (const [report, key] of keys) originalKeys.set(report, key)
  const naturalGroups = new Map<string, Report[]>()
  for (const report of reports) {
    if (!report) continue
    const key = reportNaturalGroupingKey(report)
    const group = naturalGroups.get(key)
    if (group) group.push(report)
    else naturalGroups.set(key, [report])
  }
  const buckets = new Map<string, { report: Report; source: Source; qualifiers: string[] }[]>()
  for (const report of reports) {
    if (!report || inferReportDisplayGroup(report) !== 'imaging') continue
    if ('clinicalRecordVariant' in report && report.clinicalRecordVariant) continue
    // Echo/Doppler and their viewer-only companions have a separate established
    // shared-study path. Do not re-key just part of that family here.
    if (report.code?.coding?.some(coding => ['18005C', '18007C'].includes(coding.code?.trim().toUpperCase() ?? ''))) continue
    // Compare plain report narratives only. Even a long valueString Observation
    // may carry an interpretation, status or reference range not represented in
    // that string. Keep all such reports separate rather than hiding metadata.
    if (report.result?.length || report._observations?.length || report.conclusionCode?.length) continue
    // Narrative equality cannot establish DICOM study identity. Keep linked
    // reports separate until a shared study identity can be verified here,
    // including identical/unresolved references and identifier-only links.
    if (report.imagingStudy?.length) continue
    // Only text we actually compare and images may accompany this match.
    // HTML, PDFs and unresolved URL-backed reports may contain extra findings.
    if (report.presentedForm?.some(form => {
      if (isTrustedLegacyNhiViewerAttachment(form) && !form.data) return false
      const type = (form.contentType ?? '').toLowerCase()
      return !type.startsWith('image/') && !(type.startsWith('text/') && !type.includes('html') && form.data)
    })) continue
    const source = sourceOf(report)
    const institution = imagingCopyInstitution(report)
    const method = modality(report)
    const day = examDay(report)
    const subject = report.subject?.reference?.trim()
    if (!source || !institution || !method || !day || !subject || !['final', 'amended', 'corrected'].includes(report.status ?? '')) continue
    if (isAdultPreventiveHealthExamResource(report)
      || report._observations?.some(isAdultPreventiveHealthExamResource)) continue
    const raw = sharedReportNarrative(report)
    const headerDay = /Date\s+Of\s+Examination:\s*(\d{4}[/-]\d{2}[/-]\d{2})/i.exec(raw.normalize('NFKC'))?.[1].replaceAll('/', '-')
    if (headerDay && headerDay !== day) continue
    const narrative = imagingCopyLayoutText(raw)
    // Short stock phrases and explicitly truncated previews cannot identify an exam.
    if (narrative.length < 80 || /…|\.{3}/.test(raw)) continue
    const qualifiers = examQualifiers(report)
    if (!qualifiers) continue
    const key = JSON.stringify([subject, day, institution, method, report.status, narrative])
    const bucket = buckets.get(key) ?? []
    bucket.push({ report, source, qualifiers })
    buckets.set(key, bucket)
  }
  for (const [key, bucket] of buckets) {
    const hospital = bucket.filter(item => item.source === 'hospital')
    const cloud = bucket.filter(item => item.source === 'cloud')
    if (!hospital.length || !cloud.length) continue
    const legacy = hospital.every(item => hasReceiptClock(item.report))
      && cloud.every(item => /^\d{4}-\d{2}-\d{2}$/.test(item.report.effectiveDateTime ?? ''))
    const ends = bucket.map(({ report }) => periodEnd(report))
    if (ends.some(end => end === null)
      || new Set(ends.map(end => end?.day).filter(Boolean)).size > 1
      || new Set(ends.map(end => end?.instant).filter(value => value !== undefined)).size > 1) continue
    const qualifiers = bucket.map(item => item.qualifiers)
    // Unknown/generic labels do not supply evidence. Contradictory explicit
    // headers, laterality or body regions must never disappear with a wrapper.
    if (qualifiers[0].some((_, index) => new Set(qualifiers.map(q => q[index]).filter(Boolean)).size > 1)) continue
    const members = new Set(bucket.map(item => item.report))
    // Do not pull a complete report away from a same-source truncated or
    // otherwise related member that the existing natural grouping owns.
    if (bucket.some(({ report }) => naturalGroups.get(reportNaturalGroupingKey(report))?.some(member => !members.has(member)))) continue
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
    // A cloud claim encounter and a QEMR receipt encounter use source-local
    // identities. They need not be the same visit for a same-day examination.
    if (!legacy && encounters.size > 1) continue
    if (modality(hospital[0].report) === 'XR' && cloud.some(item => !examTime(item.report))) {
      // Look outside the narrative bucket too: two same-day CXR examinations
      // with different findings must not each consume the same date-only copy.
      const site = hospital[0].qualifiers[2]
      const sameDay = reports.filter(report => report && report.status !== 'entered-in-error'
        && report.subject?.reference?.trim() === hospital[0].report.subject?.reference?.trim()
        && examDay(report) === examDay(hospital[0].report)
        && imagingCopyInstitution(report) === imagingCopyInstitution(hospital[0].report)
        && modality(report) === modality(hospital[0].report)
        && (!site || !examQualifiers(report)?.[2] || examQualifiers(report)?.[2] === site))
      if (sameDay.some(report => !members.has(report))) continue
    }
    const identifiers = new Map<string, Set<string>[]>()
    for (const { report } of bucket) {
      const bySystem = new Map<string, Set<string>>()
      for (const id of report.identifier ?? []) {
        if (id.value) {
          const system = id.system ?? ''
          const identity = typedReportIdentifierValue(id)
          bySystem.set(system, new Set([...(bySystem.get(system) ?? []), identity]))
        }
      }
      for (const [system, values] of bySystem) identifiers.set(system, [...(identifiers.get(system) ?? []), values])
    }
    // A shared order cannot override a different accession in the same
    // namespace. Require complete typed sets, independent of array order.
    if ([...identifiers.values()].some(sets => sets.length > 1 && sets.some(set =>
      set.size !== sets[0].size || [...sets[0]].some(value => !set.has(value))))) continue
    const times = bucket.map(item => examTime(item.report)).filter(Boolean)
    if (times.includes('conflicting-exam-times') || new Set(times).size > 1) continue
    // A date-only start must not hide another source's clock occurring after
    // this report explicitly ended. Apply every known bound across the group.
    if (ends.some(end => end?.instant !== undefined && times.some(time => Number(time) > end.instant!))) continue
    for (const { report } of bucket) keys.set(report, `cross-source|${key}`)
  }
  return keys
}

/** Preserve full-set ambiguity decisions, but never describe a lone source or
 * repeated copies of one procedure as a visible shared-procedure group. */
export function visibleReportGroupingKeys(reports: readonly Report[], sourceKeys: ReadonlyMap<Report, string>): Map<Report, string> {
  const visible = new Map<string, Report[]>()
  for (const report of reports) {
    const key = sourceKeys.get(report)
    if (!key) continue
    const members = visible.get(key) ?? []
    members.push(report)
    visible.set(key, members)
  }
  const keys = new Map<Report, string>()
  for (const [key, members] of visible) {
    if (key.startsWith('cross-source|')) {
      const sources = new Set(members.map(sourceOf))
      if (sources.has('hospital') && sources.has('cloud')) {
        for (const report of members) keys.set(report, key)
      } else {
        // A filtered view may retain only the hospital's billed procedures.
        // Restore their established same-source group, never a cross-source label.
        const sharedKeys = qualifyingSharedReportKeys(members)
        for (const report of members) {
          const originalKey = sharedReportGroupingKey(report)
          if (originalKey && sharedKeys.has(originalKey)) keys.set(report, originalKey)
        }
      }
    } else if (new Set(members.map(sharedReportSourceIdentity)).size > 1) {
      for (const report of members) keys.set(report, key)
    }
  }
  return keys
}


