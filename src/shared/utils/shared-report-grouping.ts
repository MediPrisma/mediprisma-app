import { decodeBase64Utf8 } from './base64.utils'
import { getCodeableConceptText } from './fhir-helpers'
import { inferReportDisplayGroup } from './report-grouping-helpers'
import { getImagingCopySource, getReportDate, isRadiographReport, isReportReceiptClock, reportExaminationHeaderClock, reportIdentifiers, reportExaminationIdentifiers, reportClockInstant, typedReportIdentifierValue } from './report-identity'

export type SharedReportSource = {
  reportId?: string
  /** The source's own FHIR id, shown as 來源紀錄. reportId is the app's row id. */
  sourceRecordId?: string
  /** Original source text retained for cross-source display grouping. */
  narrative?: string
  title: string
  codes: string[]
  codings: Array<{
    system?: string
    code: string
    display?: string
  }>
}

function reportExamDate(report: any): string | undefined {
  return report?.effectiveDateTime || report?.effectivePeriod?.start
}

function radiographClock(report: any): string | undefined {
  const effective = reportExaminationHeaderClock(report) ?? (isReportReceiptClock(report) ? undefined : reportExamDate(report))
  const published = getImagingCopySource(report) === 'cloud' && Array.isArray(report.extension) ? report.extension.find((extension: any) =>
    extension?.url === 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-report-date')?.valueString : undefined
  const timestamp = (value: unknown): number | undefined => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? reportClockInstant(value) : undefined
  // NHI can export two billing rows for the same complete report. Its explicit
  // report timestamp is corroborating report identity, not an exam time.
  const examInstant = timestamp(effective)
  const publishedInstant = timestamp(published)
  return examInstant !== undefined ? `exam:${examInstant}` : publishedInstant !== undefined ? `report:${publishedInstant}` : undefined
}

function reportInstitution(report: any): string | undefined {
  return report?._observations?.[0]?.performer?.[0]?.display
    || report?.performer?.[0]?.display
    || undefined
}

function explicitReference(reference: unknown): string | null {
  return typeof reference === 'string' && reference.trim()
    ? reference.trim()
    : null
}

/**
 * Text that the report row presents as the report narrative. Keep this aligned
 * with useReportsData so grouping never relies on a shorter subset than the
 * clinician reads. Images and viewer capabilities are intentionally excluded:
 * they remain attached to the merged display row as separate source assets.
 */
export function sharedReportNarrative(report: any): string {
  const parts: string[] = []

  if (typeof report?.conclusion === 'string' && report.conclusion.trim()) {
    parts.push(report.conclusion)
  }
  if (Array.isArray(report?.note)) {
    for (const note of report.note) {
      if (typeof note?.text === 'string' && note.text.trim()) parts.push(note.text)
    }
  }
  const conclusionCodes = Array.isArray(report?.conclusionCode)
    ? report.conclusionCode
        .map((concept: any) => getCodeableConceptText(concept))
        .filter((value: string) => value && value !== '—')
    : []
  if (conclusionCodes.length > 0) parts.push(conclusionCodes.join(', '))
  for (const observation of report?._observations ?? []) {
    if (
      typeof observation?.valueString === 'string'
      && observation.valueString.trim().length > 30
    ) {
      parts.push(observation.valueString)
    }
  }
  for (const form of report?.presentedForm ?? []) {
    const contentType = String(form?.contentType ?? '').toLowerCase()
    if (!form?.data || !contentType.startsWith('text/') || contentType.includes('html')) continue
    const decoded = decodeBase64Utf8(form.data).trim()
    if (decoded) parts.push(decoded)
  }

  return parts.join('\n').trim()
}

/** Whitespace-only normalization required for conservative shared-report grouping. */
export function normalizeSharedReportNarrative(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

type SharedReportBoundary = {
  subject: string
  encounter: string
  date: string
  institution: string
  sourceProgram: string
  status: string
}

function sharedReportBoundary(report: any): SharedReportBoundary | null {
  if (report?.clinicalRecordVariant) return null
  const subject = explicitReference(report?.subject?.reference)
  const encounter = report?._encounterInferred
    ? null
    : explicitReference(report?.encounter?.reference)
  const examinationDate = reportExamDate(report)
  const dateValue = examinationDate && isRadiographReport(report) ? getReportDate(report) : examinationDate
  const dateMatch = typeof dateValue === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(dateValue.trim())
    : null
  const date = dateMatch ? dateMatch[0].slice(0, 10) : null
  const dateIsValid = !!dateMatch && (() => {
    const year = Number(dateMatch[1])
    const month = Number(dateMatch[2])
    const day = Number(dateMatch[3])
    const value = new Date(Date.UTC(year, month - 1, day))
    return value.getUTCFullYear() === year
      && value.getUTCMonth() === month - 1
      && value.getUTCDate() === day
  })()
  const institution = normalizeSharedReportNarrative(reportInstitution(report) ?? '')
  const status = typeof report?.status === 'string' ? report.status.trim().toLowerCase() : ''
  const sourceProgram = report?.meta?.tag?.some((tag: any) => tag?.code === 'adult-preventive')
    ? 'adult-preventive'
    : ''

  if (
    !subject
    || !encounter
    || !date
    || !dateIsValid
    || !institution
    || status === 'entered-in-error'
  ) return null

  return { subject, encounter, date, institution, sourceProgram, status }
}

/**
 * A report is eligible only when every boundary is explicit in the source.
 * Local imports may add a date-matched encounter for visit navigation; the
 * `_encounterInferred` marker prevents that convenience link from becoming
 * evidence that two separately billed reports came from the same encounter.
 */
export function sharedReportGroupingKey(report: any): string | null {
  if (isRadiographReport(report) && !isReportReceiptClock(report)) {
    const header = reportExaminationHeaderClock(report)
    const effective = reportExamDate(report)
    // A copied header must never override explicit evidence of a different
    // examination. Only a tagged receipt clock is allowed to differ.
    if (header && effective?.includes('T') && reportClockInstant(header) !== reportClockInstant(effective)) return null
  }
  // Linked studies require resolved study identity, not a common billing
  // narrative. Keep these radiographs outside this automatic projection.
  if (isRadiographReport(report) && report.imagingStudy?.length) return null
  const reportGroup = inferReportDisplayGroup(report)
  const boundary = sharedReportBoundary(report)
  const narrative = normalizeSharedReportNarrative(sharedReportNarrative(report))

  if (
    !boundary
    || !narrative
    || (reportGroup !== 'imaging' && reportGroup !== 'pathology')
  ) return null
  return JSON.stringify([
    boundary.subject,
    boundary.encounter,
    boundary.date,
    boundary.institution,
    boundary.sourceProgram,
    boundary.status,
    narrative,
    // A shared billing narrative must not erase known serial X-ray clocks.
    isRadiographReport(report) ? [radiographClock(report), report.effectivePeriod?.end] : null,
  ])
}

/**
 * Boundary shared by the separately billed 18005C/18007C parts of one echo.
 * Unlike sharedReportGroupingKey this intentionally omits narrative, allowing
 * viewer-only companion records to be attached after an exact-text pair has
 * already proved that the two procedures share one written report.
 */
export function sharedEchoReportFamilyKey(report: any): string | null {
  const codes = new Set(
    (report?.code?.coding ?? [])
      .map((coding: any) => typeof coding?.code === 'string' ? coding.code.trim().toUpperCase() : '')
      .filter(Boolean),
  )
  if (!codes.has('18005C') && !codes.has('18007C')) return null
  const boundary = sharedReportBoundary(report)
  if (!boundary || inferReportDisplayGroup(report) !== 'imaging') return null
  return JSON.stringify([
    boundary.subject,
    boundary.encounter,
    boundary.date,
    boundary.institution,
    boundary.sourceProgram,
    boundary.status,
  ])
}

export function reportSource(report: any): SharedReportSource {
  const title = (getCodeableConceptText(report?.code) || '').trim()
    || report?.id
    || 'Unnamed report'
  const codings: SharedReportSource['codings'] = (report?.code?.coding ?? []).flatMap((coding: any) => {
    const code = typeof coding?.code === 'string' ? coding.code.trim() : ''
    if (!code) return []
    return [{
      ...(typeof coding?.system === 'string' && coding.system.trim()
        ? { system: coding.system.trim() }
        : {}),
      code,
      ...(typeof coding?.display === 'string' && coding.display.trim()
        ? { display: coding.display.trim() }
        : {}),
    }]
  })
  const codes = [...new Set<string>(codings.map((coding) => coding.code))]
  return {
    reportId: report?.id || undefined,
    sourceRecordId: report?.sourceId || report?.id || undefined,
    title,
    codes,
    codings,
  }
}

export function sharedReportSourceIdentity(report: any): string {
  const source = reportSource(report)
  return JSON.stringify([source.title, source.codings])
}

/**
 * Return only exact-text buckets that represent at least two different source
 * procedures. Same-procedure duplicate copies retain the existing bridge-dup
 * and CT handling.
 */
export function qualifyingSharedReportKeys(reports: any[]): Set<string> {
  const sourceIdentities = new Map<string, Set<string>>()
  const radiographIdentifiers = new Map<string, Map<string, string>>()
  const radiographMembers = new Map<string, any[]>()
  const conflicts = new Set<string>()
  const repeatedIdentities = new Set<string>()
  for (const report of reports) {
    if (!report) continue
    const key = sharedReportGroupingKey(report)
    if (!key) continue
    const identities = sourceIdentities.get(key) ?? new Set<string>()
    const identity = sharedReportSourceIdentity(report)
    // Repeated billing identities may be serial examinations whose clocks or
    // accession IDs were omitted. Distinct billing codes alone cannot prove
    // that this whole bucket describes a single radiograph.
    if (isRadiographReport(report) && identities.has(identity)) repeatedIdentities.add(key)
    identities.add(identity)
    sourceIdentities.set(key, identities)
    if (isRadiographReport(report)) {
      radiographMembers.set(key, [...(radiographMembers.get(key) ?? []), report])
      const namespaces = radiographIdentifiers.get(key) ?? new Map<string, string>()
      const values = new Map<string, string[]>()
      for (const identifier of reportIdentifiers(report)) if (identifier?.value) {
        const system = identifier.system ?? ''
        values.set(system, [...(values.get(system) ?? []), typedReportIdentifierValue(identifier)])
      }
      for (const [system, ids] of values) {
        const idSet = JSON.stringify([...new Set(ids)].sort())
        if (namespaces.has(system) && namespaces.get(system) !== idSet) conflicts.add(key)
        namespaces.set(system, idSet)
      }
      radiographIdentifiers.set(key, namespaces)
    }
  }
  for (const [key, members] of radiographMembers) {
    const sameExamClock = members.every(report => radiographClock(report)?.startsWith('exam:'))
    const common = reportExaminationIdentifiers(members[0]).some((id: any) =>
      members.every(report => reportExaminationIdentifiers(report).some((candidate: any) => candidate?.value
        && typedReportIdentifierValue(candidate) === typedReportIdentifierValue(id) && candidate.system === id.system)))
    if (repeatedIdentities.has(key) && !sameExamClock && !common) conflicts.add(key)
    if (sameExamClock) continue
    // NHI's unnumbered billing copy may accompany a numbered image-case copy.
    // An exact full narrative + explicit publication instant can attach that
    // copy to ONE known image case. Publication time alone is never sufficient.
    const nhiCases = new Set(members.flatMap(report => reportIdentifiers(report)
      .filter((id: any) => id?.system === 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/medcloud-imaging-case' && id.value)
      .map(typedReportIdentifierValue)))
    const numberedNhiReport = nhiCases.size === 1 && members.every(report => getImagingCopySource(report) === 'cloud'
      && radiographClock(report)?.startsWith('report:'))
    if (!common && !numberedNhiReport) conflicts.add(key)
  }
  return new Set(
    [...sourceIdentities.entries()]
      .filter(([key, identities]) => identities.size > 1 && !conflicts.has(key))
      .map(([key]) => key),
  )
}

/**
 * Map an unambiguous echo-family boundary to its exact shared narrative key.
 * If the same encounter contains more than one distinct paired narrative, the
 * family is deliberately omitted because viewer-only records cannot be safely
 * assigned to either report.
 */
export function qualifyingSharedEchoFamilyKeys(reports: any[]): Map<string, string> {
  const qualifyingKeys = qualifyingSharedReportKeys(reports)
  const candidates = new Map<string, Map<string, Set<string>>>()

  for (const report of reports) {
    const sharedKey = sharedReportGroupingKey(report)
    const familyKey = sharedEchoReportFamilyKey(report)
    if (!sharedKey || !familyKey || !qualifyingKeys.has(sharedKey)) continue
    const byNarrative = candidates.get(familyKey) ?? new Map<string, Set<string>>()
    const codes = byNarrative.get(sharedKey) ?? new Set<string>()
    for (const code of reportSource(report).codes) codes.add(code.toUpperCase())
    byNarrative.set(sharedKey, codes)
    candidates.set(familyKey, byNarrative)
  }

  const owners = new Map<string, string>()
  for (const [familyKey, byNarrative] of candidates) {
    const pairedNarratives = [...byNarrative.entries()].filter(([, codes]) =>
      codes.has('18005C') && codes.has('18007C'),
    )
    if (pairedNarratives.length === 1) owners.set(familyKey, pairedNarratives[0][0])
  }
  return owners
}

export function sharedReportTitle(
  sources: SharedReportSource[],
  locale: 'en' | 'zh-TW',
  audience: 'medical' | 'patient' = 'medical',
): string | null {
  const codes = new Set(sources.flatMap((source) => source.codes))
  const orderCodes = [...codes].filter((code) => /^\d{5}[A-Z]$/.test(code))
  if (
    orderCodes.length === 2
    && codes.has('18005C')
    && codes.has('18007C')
    && sources.every((source) => source.codes.some((code) => code === '18005C' || code === '18007C'))
  ) {
    return audience === 'patient' && locale === 'zh-TW'
      ? '心臟超音波（含杜卜勒血流）'
      : 'Echocardiography (including Doppler)'
  }
  return null
}
