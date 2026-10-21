import { getNhiMedicloudOriginalInstitution, isNhiAuthorityDisplay, isNhiMedicloudObservation, isAdultPreventiveHealthExamResource } from './observation-provenance.utils'
import { getCodeableConceptText } from './fhir-helpers'

export function getReportDate(report: any): string | undefined {
  return report?.effectiveDateTime || report?.effectivePeriod?.start || report?.issued
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
  return [getCodeableConceptText(report?.code).trim(), (getReportDate(report) ?? '').slice(0, 10),
    (getReportInstitution(report) ?? '').trim(), isAdultPreventiveReport(report) ? 'adult-preventive' : '',
    isNhiMedicloudReport(report) ? 'nhi-medicloud' : ''].join('|')
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

