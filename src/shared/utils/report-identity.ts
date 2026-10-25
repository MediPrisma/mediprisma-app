import { getNhiMedicloudOriginalInstitution, isNhiAuthorityDisplay, isNhiMedicloudObservation, isAdultPreventiveHealthExamResource } from './observation-provenance.utils'
import { getCodeableConceptText } from './fhir-helpers'
import { getNhiReportModality, inferReportDisplayGroup, isRadiographLabel, IMAGING_EXAM_HEADER } from './report-grouping-helpers'

export function getImagingCopySource(report: any): 'hospital' | 'cloud' | undefined {
  if (report.meta?.tag?.some((tag: any) => tag?.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement')) return 'hospital'
  if (/^https:\/\/medcloud2\.nhi\.gov\.tw(?:\/|$)/.test(report.meta?.source ?? '')) return 'cloud'
  return undefined
}

export function getReportDate(report: any): string | undefined {
  // This change adds period support for imaging only. Preserve the existing
  // issued-date fallback for unrelated laboratory/pathology report grouping.
  const imaging = inferReportDisplayGroup(report) === 'imaging'
  const value = report?.effectiveDateTime
    || (imaging ? report?.effectivePeriod?.start : undefined)
    || report?.issued
  // Grouping and calendar-window consumers must agree on the examination day.
  // Keep the instant, expressed in the Taiwan source timezone, without changing
  // the original FHIR resource or the date projection of other report groups.
  if (imaging && getImagingCopySource(report) && typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !value.endsWith('+08:00')) {
    const instant = Date.parse(value)
    if (Number.isFinite(instant)) return new Date(instant + 8 * 60 * 60 * 1000).toISOString().replace(/Z$/, '+08:00')
  }
  return value
}

export function isNhiMedicloudReport(report: any): boolean {
  const observations = Array.isArray(report?._observations) ? report._observations : []
  return observations.length > 0 && observations.every(isNhiMedicloudObservation)
}

export function isAdultPreventiveReport(report: any): boolean {
  return isAdultPreventiveHealthExamResource(report)
    || (report?._observations ?? []).some(isAdultPreventiveHealthExamResource)
}

export function isRadiographReport(report: any): boolean {
  if (!report) return false
  if (report.code?.coding?.some((coding: any) => {
    const method = getNhiReportModality(coding?.code)
    return method && method !== 'XR'
  })) return false
  return inferReportDisplayGroup(report) === 'imaging' && (
    report.code?.coding?.some((coding: any) => getNhiReportModality(coding?.code) === 'XR')
    || isRadiographLabel([report.code?.text, ...(report.code?.coding ?? []).map((coding: any) => coding?.display),
      IMAGING_EXAM_HEADER.exec((typeof report.conclusion === 'string' ? report.conclusion : '').normalize('NFKC'))?.[1]].filter(Boolean).join(' ')))
}

export function reportIdentifiers(report: any): any[] {
  return Array.isArray(report?.identifier) ? report.identifier : []
}

export function typedReportIdentifierValue(identifier: any): string {
  const types = Array.isArray(identifier.type?.coding)
    ? identifier.type.coding.map((coding: any) => JSON.stringify([coding?.system ?? '', coding?.code ?? ''])).sort()
    : undefined
  return JSON.stringify([identifier.value, types?.length ? types : identifier.type?.text ?? null])
}

export function isReportReceiptClock(report: any): boolean {
  return getImagingCopySource(report) === 'hospital' && !!report.effectiveDateTime
    && Array.isArray(report.extension) && report.extension.some((extension: any) => extension?.url === 'urn:vgh:report:received-at'
      && extension.valueDateTime === report.effectiveDateTime) === true
}

export function reportExaminationHeaderClock(report: any): string | undefined {
  const header = IMAGING_EXAM_HEADER.exec((typeof report.conclusion === 'string' ? report.conclusion : '').normalize('NFKC'))
  if (!header?.[3]) return undefined
  const timestamp = `${header[2].replaceAll('/', '-')}T${header[3]}+08:00`
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined
}

/** One natural key for the displayed rows and the cross-source guard. */
export function reportNaturalGroupingKey(report: any): string {
  if (report?.clinicalRecordVariant) {
    return `source-record-variant|${JSON.stringify([report.clinicalRecordVariant.groupId, report.id ?? report.clinicalSourceNodeKey])}`
  }
  // A period is an interval. Its explicit bounds must not disappear when an
  // imaging report falls back to the established same-source grouping path.
  const period = inferReportDisplayGroup(report) === 'imaging' && report.effectivePeriod
  const key = [getCodeableConceptText(report?.code).trim(), (getReportDate(report) ?? '').slice(0, 10),
    (getReportInstitution(report) ?? '').trim(), isAdultPreventiveReport(report) ? 'adult-preventive' : '',
    isNhiMedicloudReport(report) ? 'nhi-medicloud' : ''].join('|')
  // Serial radiographs can have identical text on the same day. Do not let
  // the ordinary same-source fallback erase the distinction rejected by the
  // cross-source matcher. Proven shared billing groups still take precedence.
  if (isRadiographReport(report)) {
    const date = report.effectiveDateTime || report.effectivePeriod?.start
    const clock = date?.includes('T') && !isReportReceiptClock(report) ? date : undefined
    const headerClock = reportExaminationHeaderClock(report)
    const identifiers = reportIdentifiers(report).filter((id: any) => id?.value).map((id: any) => [id.system, typedReportIdentifierValue(id)]).sort()
    // Exact source clocks or common identifiers can still establish duplicate
    // previews. A day alone cannot: retain distinct records in that case.
    return `${key}|radiograph:${JSON.stringify([
      clock, headerClock, identifiers,
      report.imagingStudy ?? null,
      !clock && !headerClock && !identifiers.length ? report.id ?? null : null,
      period ? [period.start, period.end] : null,
    ])}`
  }
  return period ? `${key}|period:${JSON.stringify([period.start ?? '', period.end ?? ''])}` : key
}

/** Canonical performing-institution projection shared by report display and grouping. */
export function getReportInstitution(dr: any): string | undefined {
  const observations = Array.isArray(dr?._observations) ? dr._observations : []
  const hasCloudObservation = observations.some(isNhiMedicloudObservation)
  const cloudInstitution = observations
    .map(getNhiMedicloudOriginalInstitution)
    .find((institution: string | undefined): institution is string => !!institution)
  const ordinaryInstitution = observations
    .filter((observation: any) => !isNhiMedicloudObservation(observation))
    .flatMap((observation: any) => observation?.performer ?? [])
    .map((performer: any) => performer?.display?.trim())
    .find((institution: unknown): institution is string => typeof institution === 'string' && !!institution)
  const reportInstitution = (dr?.performer ?? [])
    .map((performer: any) => performer?.display?.trim())
    .find((institution: unknown): institution is string =>
      typeof institution === 'string' && !!institution && !isNhiAuthorityDisplay(institution))
  if (hasCloudObservation) return cloudInstitution || ordinaryInstitution || reportInstitution
  return ordinaryInstitution || reportInstitution
}

