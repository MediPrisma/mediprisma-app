import { getNhiMedicloudOriginalInstitution, isNhiAuthorityDisplay, isNhiMedicloudObservation, isAdultPreventiveHealthExamResource } from './observation-provenance.utils'
import { getCodeableConceptText } from './fhir-helpers'
import { getNhiReportModality, inferReportDisplayGroup } from './report-grouping-helpers'

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
  const radiograph = inferReportDisplayGroup(report) === 'imaging' && (
    report.code?.coding?.some((coding: any) => getNhiReportModality(coding?.code) === 'XR')
    || /\bXR\b|x[ -]?ray|radiograph|chest.*view|胸腔檢查/i.test(getCodeableConceptText(report.code)))
  if (radiograph) return `${key}|radiograph:${JSON.stringify([
    getReportDate(report), report.id ?? null,
    (report.identifier ?? []).map((id: any) => [id.system, id.value]).sort(),
    period ? [period.start, period.end] : null,
  ])}`
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

