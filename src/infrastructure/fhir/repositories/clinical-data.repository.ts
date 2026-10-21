// FHIR Clinical Data Repository Implementation
import type { IClinicalDataRepository } from '@/src/core/interfaces/repositories/clinical-data.repository.interface'
import type {
  ConditionEntity,
  MedicationEntity,
  MedicationRemainingSummaryEntity,
  AllergyEntity,
  ObservationEntity,
  DiagnosticReportEntity,
  ImagingStudyEntity,
  ProcedureEntity,
  EncounterEntity,
  DocumentReferenceEntity,
  CompositionEntity,
  ConsentEntity,
  DeviceEntity,
  CarePlanEntity,
  ClinicalDataCollection,
  ClinicalDataQueryKey,
  ClinicalDataQueryStatus,
} from '@/src/core/entities/clinical-data.entity'
import { fhirClient, LocalBundleModeError } from '../client/fhir-client.service'
import { FhirMapper } from '../mappers/fhir.mapper'
import {
  groupSpecialMaterialsByProcedure,
  isMedicationRemainingSummaryBasic,
} from '../mappers/fhir.mapper'
import { FHIR_RESOURCES } from '@/src/shared/constants/fhir-systems.constants'
import {
  classifyFhirQueryError,
  shouldRetryBasicFhirSearch,
  successfulFhirQueryStatus,
} from '../utils/fhir-query-status'
import {
  MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM,
  MEDCLOUD_REMAINING_SUMMARY_CODE,
  MEDCLOUD_SPECIAL_MATERIAL_CODE,
} from '@/src/shared/constants/medcloud.constants'

// Skip console noise for the "no SMART client" sentinel — that's a planned
// fallback (user is in local-bundle mode or the data source went away
// mid-fetch), not a real failure.
function logFhirError(label: string, error: unknown) {
  if (error instanceof LocalBundleModeError) return
  console.error(label, error)
}
function warnFhirError(label: string, error: unknown) {
  if (error instanceof LocalBundleModeError) return
  console.warn(label, error)
}

type MedicationSourceType = 'MedicationRequest' | 'MedicationStatement'

/**
 * Vital signs are a SUBSET of the unfiltered Observation search — FHIR requires
 * `Observation?patient=X` (no category filter) to return vitals, report members
 * and labs alike; see the OBSERVATION SUPERSET INVARIANT on
 * ClinicalDataCollection. Deriving the subset here replaces a second
 * `category=vital-signs` round-trip that re-downloaded rows we already had, on
 * the slowest leg of a chart load (Observation pagination is strictly
 * sequential).
 *
 * The system is deliberately not matched: `vital-signs` is distinctive enough
 * as a code, and servers still emit it under the STU3 category system as well
 * as the R4 one. Any coding in any category entry counts, so a server that
 * files a vital under two classifiers is not missed.
 */
export function selectVitalSignObservations(
  observations: ObservationEntity[],
): ObservationEntity[] {
  return observations.filter((observation) =>
    observation.category?.some((category) =>
      category.coding?.some((coding) => coding.code === 'vital-signs'),
    ),
  )
}

function medicationReferenceCandidates(reference: string): string[] {
  const withoutHistory = reference.split('/_history/')[0]
  const segments = withoutHistory.split('/').filter(Boolean)
  const id = segments.at(-1)
  return [reference, withoutHistory, id, id ? `Medication/${id}` : undefined]
    .filter((candidate): candidate is string => Boolean(candidate))
}

/**
 * Extract the requested medication resources from a searchset and promote the
 * code from included/contained Medication resources when the choice element is
 * a medicationReference. Keeping this at the repository boundary gives the UI
 * one consistent MedicationEntity shape for both SMART and local bundles.
 */
function mapMedicationSearchResponse(
  response: any,
  sourceType: MedicationSourceType,
): MedicationEntity[] {
  const entries = response.entry || []
  const medicationLookup = new Map<string, any>()

  for (const entry of entries) {
    const resource = entry.resource
    if (resource?.resourceType !== 'Medication') continue
    if (entry.fullUrl) medicationLookup.set(entry.fullUrl, resource)
    if (resource.id) {
      medicationLookup.set(resource.id, resource)
      medicationLookup.set(`Medication/${resource.id}`, resource)
    }
  }

  return entries
    .filter((entry: any) => {
      const resourceType = entry.resource?.resourceType
      // Tolerate resourceType-less fixtures, but never map included Medication
      // resources as medication orders/statements.
      return resourceType === sourceType || !resourceType
    })
    .map((entry: any) => {
      const resource = entry.resource
      const reference = resource.medicationReference?.reference as string | undefined
      let referencedMedication: any

      if (reference?.startsWith('#')) {
        referencedMedication = resource.contained?.find(
          (contained: any) => contained.id === reference.slice(1) && contained.resourceType === 'Medication',
        )
      } else if (reference) {
        for (const candidate of medicationReferenceCandidates(reference)) {
          referencedMedication = medicationLookup.get(candidate)
          if (referencedMedication) break
        }
      }

      return FhirMapper.toMedication({
        ...resource,
        medicationCodeableConcept:
          resource.medicationCodeableConcept ?? referencedMedication?.code,
        _sourceResourceType: sourceType,
      })
    })
}

export class FhirClinicalDataRepository implements IClinicalDataRepository {
  private resourceQueryStatus: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}

  private markQuerySuccess(key: ClinicalDataQueryKey, resourceType: string, count: number) {
    this.resourceQueryStatus[key] = successfulFhirQueryStatus(resourceType, count)
  }

  private markQueryFailure(key: ClinicalDataQueryKey, resourceType: string, error: unknown) {
    this.resourceQueryStatus[key] = classifyFhirQueryError(error, resourceType)
  }

  /**
   * Outcome recorded by the most recent fetch of `key`.
   *
   * Callers that drive one query per resource type (see the clinical-data
   * fetch plan) never go through fetchAllClinicalData, so they read each
   * search's outcome here instead of off the aggregated collection. Every
   * fetcher writes its own disjoint key(s), which is what makes it safe to
   * share one repository instance across concurrent per-type fetches.
   */
  getQueryStatus(key: ClinicalDataQueryKey): ClinicalDataQueryStatus | undefined {
    return this.resourceQueryStatus[key]
  }

  private async requestWithBasicFallback(primary: string, fallback?: string): Promise<any> {
    try {
      return await fhirClient.requestAllPages(primary)
    } catch (error) {
      if (!fallback || !shouldRetryBasicFhirSearch(error)) throw error
      warnFhirError('FHIR server rejected optional search features; retrying a basic search:', error)
      return fhirClient.requestAllPages(fallback)
    }
  }

  async fetchAllClinicalData(patientId: string): Promise<ClinicalDataCollection> {
    this.resourceQueryStatus = {}
    const [
      conditions,
      medications,
      medicationRemainingSummaries,
      allergies,
      observations,
      diagnosticReports,
      imagingStudies,
      procedures,
      encounters,
      documentReferences,
      compositions,
      immunizations,
      consents,
      devices,
      carePlans
    ] = await Promise.all([
      this.fetchConditions(patientId),
      this.fetchMedications(patientId),
      this.fetchMedicationRemainingSummaries(patientId),
      this.fetchAllergies(patientId),
      this.fetchObservations(patientId),
      this.fetchDiagnosticReports(patientId),
      this.fetchImagingStudies(patientId),
      this.fetchProcedures(patientId),
      this.fetchEncounters(patientId),
      this.fetchDocumentReferences(patientId),
      this.fetchCompositions(patientId),
      this.fetchImmunizations(patientId),
      this.fetchConsents(patientId),
      this.fetchDevices(patientId),
      this.fetchCarePlans(patientId)
    ])

    // Vitals come out of the Observation result, not a second search — see
    // selectVitalSignObservations. fetchObservations already recorded the
    // mirrored 'Observation:vital-signs' status.
    const vitalSigns = selectVitalSignObservations(observations)

    // Re-attach observations to DiagnosticReports that _include didn't populate.
    // The bridge may not support _include; this mirrors what local-bundle.service does.
    const obsMap = new Map(observations.map(o => [o.id, o]))
    const enrichedDiagnosticReports = diagnosticReports.map(dr => {
      if (Array.isArray((dr as any)._observations) && (dr as any)._observations.length > 0) {
        return dr
      }
      if (!Array.isArray(dr.result) || dr.result.length === 0) return dr
      const resultIds = (dr.result as any[])
        .map((ref: any) => ref.reference?.split('/').pop())
        .filter(Boolean) as string[]
      const matched = resultIds.map(id => obsMap.get(id)).filter((o): o is ObservationEntity => o !== undefined)
      return matched.length > 0 ? { ...dr, _observations: matched } : dr
    })

    // Pharmacy-only MedicationRequests without an encounter reference are
    // intentionally LEFT ORPHAN — they still surface in the medication list,
    // but don't fabricate visits in the visit-history view. This mirrors the
    // NHI 健保存摺 data model: pharmacy events only appear as visits in the
    // IC-card section (where bridge v0.7.1+ tags them with type.text='藥局'),
    // never under the 申報資料 channel. See bridge bug report 2026-05-20.

    return {
      conditions,
      medications,
      medicationRemainingSummaries,
      allergies,
      observations,
      vitalSigns,
      diagnosticReports: enrichedDiagnosticReports,
      imagingStudies,
      procedures,
      encounters,
      documentReferences,
      compositions,
      immunizations,
      consents,
      devices,
      carePlans,
      resourceQueryStatus: { ...this.resourceQueryStatus },
    }
  }

  async fetchMedicationRemainingSummaries(
    patientId: string,
  ): Promise<MedicationRemainingSummaryEntity[]> {
    try {
      const token = encodeURIComponent(
        `${MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM}|${MEDCLOUD_REMAINING_SUMMARY_CODE}`,
      )
      const response = await this.requestWithBasicFallback(
        `Basic?subject=Patient/${patientId}&code=${token}&_count=100`,
        `Basic?subject=Patient/${patientId}&_count=100`,
      )
      const summaries: MedicationRemainingSummaryEntity[] = (response.entry ?? [])
        .map((entry: any) => entry.resource)
        .filter(isMedicationRemainingSummaryBasic)
        .map((resource: any) => FhirMapper.toMedicationRemainingSummary(resource))
      const result = [...new Map(
        summaries.map((summary: MedicationRemainingSummaryEntity) => [summary.id, summary]),
      ).values()]
      this.markQuerySuccess('Basic', 'Basic', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Basic', 'Basic', error)
      warnFhirError('Failed to fetch medication remaining summaries:', error)
      return []
    }
  }

  async fetchConsents(patientId: string): Promise<ConsentEntity[]> {
    try {
      const response = await fhirClient.requestAllPages(
        `Consent?patient=${patientId}&_count=100`
      )
      const result = response.entry?.map((e: any) => FhirMapper.toConsent(e.resource)) || []
      this.markQuerySuccess('Consent', 'Consent', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Consent', 'Consent', error)
      warnFhirError('Failed to fetch consents:', error)
      return []
    }
  }

  async fetchDevices(patientId: string): Promise<DeviceEntity[]> {
    try {
      const response = await fhirClient.requestAllPages(
        `Device?patient=${patientId}&_count=100`
      )
      const result = response.entry?.map((e: any) => FhirMapper.toDevice(e.resource)) || []
      this.markQuerySuccess('Device', 'Device', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Device', 'Device', error)
      warnFhirError('Failed to fetch devices:', error)
      return []
    }
  }

  async fetchCarePlans(patientId: string): Promise<CarePlanEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `CarePlan?patient=${patientId}&_sort=-date&_count=100`,
        `CarePlan?patient=${patientId}&_count=100`,
      )
      const result = response.entry?.map((e: any) => FhirMapper.toCarePlan(e.resource)) || []
      this.markQuerySuccess('CarePlan', 'CarePlan', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('CarePlan', 'CarePlan', error)
      warnFhirError('Failed to fetch care plans:', error)
      return []
    }
  }

  async fetchImmunizations(patientId: string): Promise<import('@/src/core/entities/clinical-data.entity').ImmunizationEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `Immunization?patient=${patientId}&_sort=-date&_count=200`,
        `Immunization?patient=${patientId}&_count=200`,
      )
      const result = response.entry?.map((e: any) => FhirMapper.toImmunization(e.resource)) || []
      this.markQuerySuccess('Immunization', 'Immunization', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Immunization', 'Immunization', error)
      warnFhirError('Failed to fetch immunizations:', error)
      return []
    }
  }

  async fetchConditions(patientId: string): Promise<ConditionEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `Condition?patient=${patientId}&_sort=-recorded-date&_count=100`,
        `Condition?patient=${patientId}&_count=100`,
      )
      const result = response.entry?.map((e: any) => FhirMapper.toCondition(e.resource)) || []
      this.markQuerySuccess('Condition', 'Condition', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Condition', 'Condition', error)
      logFhirError('Failed to fetch conditions:', error)
      return []
    }
  }

  async fetchMedications(patientId: string): Promise<MedicationEntity[]> {
    const searches: Array<{
      sourceType: MedicationSourceType
      primary: string
      fallback: string
    }> = [
      {
        sourceType: 'MedicationRequest',
        primary: `MedicationRequest?patient=${patientId}&_sort=-authoredon&_count=100&_include=MedicationRequest:medication`,
        fallback: `MedicationRequest?patient=${patientId}&_count=100`,
      },
      {
        sourceType: 'MedicationStatement',
        primary: `MedicationStatement?patient=${patientId}&_count=100&_include=MedicationStatement:medication`,
        fallback: `MedicationStatement?patient=${patientId}&_count=100`,
      },
    ]

    const results = await Promise.allSettled(
      searches.map(async ({ sourceType, primary, fallback }) => {
        const response = await this.requestWithBasicFallback(primary, fallback)
        return mapMedicationSearchResponse(response, sourceType)
      }),
    )

    const medications: MedicationEntity[] = []
    results.forEach((result, index) => {
      const sourceType = searches[index].sourceType
      if (result.status === 'fulfilled') {
        medications.push(...result.value)
        this.markQuerySuccess(sourceType, sourceType, result.value.length)
        return
      }
      this.markQueryFailure(sourceType, sourceType, result.reason)
      const log = sourceType === 'MedicationRequest' ? logFhirError : warnFhirError
      log(`Failed to fetch ${sourceType} resources:`, result.reason)
    })

    return medications
  }

  async fetchAllergies(patientId: string): Promise<AllergyEntity[]> {
    try {
      const response = await fhirClient.requestAllPages(
        `AllergyIntolerance?patient=${patientId}&_count=100`
      )
      const result = response.entry?.map((e: any) => FhirMapper.toAllergy(e.resource)) || []
      this.markQuerySuccess('AllergyIntolerance', 'AllergyIntolerance', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('AllergyIntolerance', 'AllergyIntolerance', error)
      logFhirError('Failed to fetch allergies:', error)
      return []
    }
  }

  async fetchObservations(patientId: string): Promise<ObservationEntity[]> {
    try {
      // Fetch all observations (laboratory, procedure, etc.)
      //
      // _count=500 (matching DiagnosticReport) rather than 200: pagination is
      // strictly sequential, so a years-of-data patient turned into dozens of
      // serial round-trips that dominated the whole chart load on hospital
      // Wi-Fi. Servers are free to return fewer per page; this only raises the
      // ceiling we ask for.
      const response = await this.requestWithBasicFallback(
        `Observation?patient=${patientId}&_count=500&_sort=-date`,
        `Observation?patient=${patientId}&_count=500`,
      )

      const result = response.entry?.map((e: any) => FhirMapper.toObservation(e.resource)) || []
      this.markQuerySuccess('Observation', 'Observation', result.length)
      this.markDerivedVitalSignsStatus(result)
      return result
    } catch (error) {
      this.markQueryFailure('Observation', 'Observation', error)
      // Vitals are derived from this search, so its failure is theirs: without
      // the mirrored entry a 401/403 would read as "no vitals recorded".
      this.markQueryFailure('Observation:vital-signs', 'Observation', error)
      logFhirError('Failed to fetch observations:', error)
      return []
    }
  }

  /** The vital-signs key stays in resourceQueryStatus even though no dedicated
   * search runs any more, so the FHIR issues banner and any consumer keyed on
   * it keep working. */
  private markDerivedVitalSignsStatus(observations: ObservationEntity[]) {
    this.markQuerySuccess(
      'Observation:vital-signs',
      'Observation',
      selectVitalSignObservations(observations).length,
    )
  }

  /**
   * Kept to satisfy IClinicalDataRepository. It no longer issues a
   * `category=vital-signs` search: vitals are filtered out of the full
   * Observation result (selectVitalSignObservations). Callers that already
   * hold the observations should filter directly rather than pay for the
   * search again.
   */
  async fetchVitalSigns(patientId: string): Promise<ObservationEntity[]> {
    return selectVitalSignObservations(await this.fetchObservations(patientId))
  }

  async fetchDiagnosticReports(patientId: string): Promise<DiagnosticReportEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `DiagnosticReport?patient=${patientId}&_count=500&_sort=-date&_include=DiagnosticReport:result&_include:iterate=Observation:has-member`,
        `DiagnosticReport?patient=${patientId}&_count=500`,
      )

      const entries = response.entry || []
      const reports = entries
        .filter((e: any) => e.resource?.resourceType === FHIR_RESOURCES.DIAGNOSTIC_REPORT)
        .map((e: any) => e.resource)

      const observations = entries
        .filter((e: any) => e.resource?.resourceType === FHIR_RESOURCES.OBSERVATION)
        .map((e: any) => FhirMapper.toObservation(e.resource))

      const result = reports.map((report: any) =>
        FhirMapper.toDiagnosticReport(report, observations)
      )
      this.markQuerySuccess('DiagnosticReport', 'DiagnosticReport', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('DiagnosticReport', 'DiagnosticReport', error)
      logFhirError('Failed to fetch diagnostic reports:', error)
      return []
    }
  }

  async fetchImagingStudies(patientId: string): Promise<ImagingStudyEntity[]> {
    const mapResponse = (response: any): ImagingStudyEntity[] =>
      response.entry
        ?.filter((e: any) => e.resource?.resourceType === FHIR_RESOURCES.IMAGING_STUDY)
        .map((e: any) => FhirMapper.toImagingStudy(e.resource)) || []

    try {
      const response = await this.requestWithBasicFallback(
        `ImagingStudy?patient=${patientId}&_count=200&_sort=-started`,
        `ImagingStudy?patient=${patientId}&_count=200`,
      )
      const result = mapResponse(response)
      this.markQuerySuccess('ImagingStudy', 'ImagingStudy', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('ImagingStudy', 'ImagingStudy', error)
      // ImagingStudy is optional on many R4 servers. Keep the rest of the chart
      // usable, while resourceQueryStatus tells the UI why this list is empty.
      warnFhirError('Failed to fetch imaging studies:', error)
      return []
    }
  }

  /**
   * Special materials linked to surgeries. Optional enrichment of the
   * procedure rows: a server without these records, or one that refuses the
   * search, leaves the procedures exactly as they were.
   */
  private async fetchSpecialMaterialsByProcedure(patientId: string) {
    try {
      const token = encodeURIComponent(
        `${MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM}|${MEDCLOUD_SPECIAL_MATERIAL_CODE}`,
      )
      const response = await this.requestWithBasicFallback(
        `Basic?subject=Patient/${patientId}&code=${token}&_count=100`,
        `Basic?subject=Patient/${patientId}&_count=100`,
      )
      return groupSpecialMaterialsByProcedure(
        (response.entry ?? []).map((entry: any) => entry.resource),
      )
    } catch (error) {
      warnFhirError('Failed to fetch special-material records:', error)
      return undefined
    }
  }

  async fetchProcedures(patientId: string): Promise<ProcedureEntity[]> {
    const specialMaterials = this.fetchSpecialMaterialsByProcedure(patientId)
    try {
      const response = await this.requestWithBasicFallback(
        `Procedure?patient=${patientId}&_count=100&_sort=-date`,
        `Procedure?patient=${patientId}&_count=100`,
      )
      const specialMaterialsByProcedure = await specialMaterials
      const result = response.entry?.map((e: any) =>
        FhirMapper.toProcedure(e.resource, specialMaterialsByProcedure)) || []
      this.markQuerySuccess('Procedure', 'Procedure', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Procedure', 'Procedure', error)
      logFhirError('Failed to fetch procedures:', error)
      return []
    }
  }

  async fetchEncounters(patientId: string): Promise<EncounterEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `Encounter?patient=${patientId}&_sort=-date&_count=100&_include=Encounter:patient&_include=Encounter:location`,
        `Encounter?patient=${patientId}&_count=100`,
      )
      // _include puts Patient/Location entries in the same bundle — map only
      // actual Encounters (same guard as fetchDiagnosticReports).
      const result = (
        response.entry
          ?.filter((e: any) => e.resource?.resourceType === FHIR_RESOURCES.ENCOUNTER)
          .map((e: any) => FhirMapper.toEncounter(e.resource)) || []
      )
      this.markQuerySuccess('Encounter', 'Encounter', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Encounter', 'Encounter', error)
      logFhirError('Failed to fetch encounters:', error)
      return []
    }
  }

  async fetchDocumentReferences(patientId: string): Promise<DocumentReferenceEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `DocumentReference?patient=${patientId}&_sort=-date&_count=100`,
        `DocumentReference?patient=${patientId}&_count=100`,
      )
      const result = response.entry?.map((e: any) => FhirMapper.toDocumentReference(e.resource)) || []
      this.markQuerySuccess('DocumentReference', 'DocumentReference', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('DocumentReference', 'DocumentReference', error)
      logFhirError('Failed to fetch document references:', error)
      return []
    }
  }

  async fetchCompositions(patientId: string): Promise<CompositionEntity[]> {
    try {
      const response = await this.requestWithBasicFallback(
        `Composition?patient=${patientId}&_sort=-date&_count=100`,
        `Composition?patient=${patientId}&_count=100`,
      )
      const result = response.entry?.map((e: any) => FhirMapper.toComposition(e.resource)) || []
      this.markQuerySuccess('Composition', 'Composition', result.length)
      return result
    } catch (error) {
      this.markQueryFailure('Composition', 'Composition', error)
      logFhirError('Failed to fetch compositions:', error)
      return []
    }
  }
}
