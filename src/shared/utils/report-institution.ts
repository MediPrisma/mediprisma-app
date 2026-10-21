import { getNhiMedicloudOriginalInstitution, isNhiAuthorityDisplay, isNhiMedicloudObservation } from './observation-provenance.utils'

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

