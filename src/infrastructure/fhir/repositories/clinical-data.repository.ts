import { attachReportObservations } from '@/src/core/services/clinical-report-membership'
import { selectClinicalSourceNodes, type ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { captureClinicalSource, invalidateClinicalSource, mutableClinicalProjection, clinicalSourceSession, forgetClinicalSourceSession, knownClinicalSourceSession, readClinicalSource, type ClinicalSourceSession } from '../services/clinical-source-session'
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

  return entries
    .filter((entry: any) => {
      const resourceType = entry.resource?.resourceType
      // Tolerate resourceType-less fixtures, but never map included Medication
      // resources as medication orders/statements.
      return resourceType === sourceType || !resourceType
    })
    .map((entry: any) => {
      const resource = mutableClinicalProjection(entry.resource)
      const source: ClinicalReconciliationResult | undefined = response._clinicalSource
      const edge = source?.graph.references.find(edge =>
        edge.origin.resource === entry.resource && edge.path === 'medicationReference' && edge.status === 'resolved',
      )
      const target = edge ? source?.graph.nodes.find(node => node.key === edge.targetKeys[0]) : undefined
      const referencedMedication = target?.resource.resourceType === 'Medication' ? target.resource : undefined

      return FhirMapper.toMedication({
        ...resource,
        medicationCodeableConcept:
          resource.medicationCodeableConcept ?? mutableClinicalProjection(referencedMedication?.code),
        _sourceResourceType: sourceType,
      })
    })
}

export class FhirClinicalDataRepository implements IClinicalDataRepository {
  private readonly fallbackSessionKey = {}
  private session: ClinicalSourceSession = clinicalSourceSession(this.fallbackSessionKey)

  getClinicalSource(patientId: string): ClinicalReconciliationResult {
    return readClinicalSource(knownClinicalSourceSession(fhirClient) ?? this.session, patientId)
  }

  /** Capture complete successful searches before mapping. Each successful query
   * replaces its active snapshot; failed/partial requests retain the previous one. */
  private async requestSource(url: string, logicalSlot = url): Promise<any> {
    const params = new URLSearchParams(url.split('?')[1] ?? '')
    const patientScope = (params.get('patient') ?? params.get('subject') ?? '').replace(/^Patient\//, '')
    let client: any
    try {
      client = await fhirClient.getClient()
    } catch {
      // A completed response remains usable if session metadata is unavailable.
    }
    const session = client && typeof client === 'object' ? clinicalSourceSession(client, client.state?.serverUrl, fhirClient) : clinicalSourceSession(this.fallbackSessionKey)
    if (!client) forgetClinicalSourceSession(fhirClient)
    this.session = session
    const queryType = url.split('?')[0]
    const cacheKey = JSON.stringify([session.sourceId, patientScope, logicalSlot])
    let response: any
    try {
      response = await fhirClient.requestAllPages(url)
    } catch (error) {
      if (client && (await fhirClient.getClient() !== client || client.state?.serverUrl?.replace(/\/+$/, '') !== session.restBase)) throw new Error('FHIR session changed during query')
      const previous = session.successfulResponses.get(cacheKey)
      if (!previous) throw error
      if (shouldRetryBasicFhirSearch(error) && url === logicalSlot) throw error
      const state = classifyFhirQueryError(error, queryType).state
      if (state === 'unauthorized' || state === 'forbidden' || error instanceof LocalBundleModeError) {
        invalidateClinicalSource(session, cacheKey, patientScope)
        throw error
      }
      return { ...previous, _clinicalSource: previous._clinicalSource, _retainedFailure: error }
    }
    if (client && (await fhirClient.getClient() !== client || client.state?.serverUrl?.replace(/\/+$/, '') !== session.restBase)) throw new Error('FHIR session changed during query')
    const source = captureClinicalSource(session, cacheKey, patientScope,
      (response.entry ?? []).filter((entry: any) => typeof entry.resource?.resourceType === 'string'))
    const includeTypes = queryType === 'DiagnosticReport' ? ['Observation']
      : queryType === 'MedicationRequest' || queryType === 'MedicationStatement' ? ['Medication'] : []
    const projected = { ...response, entry: selectClinicalSourceNodes(source)
      .filter(node => node.resource.resourceType === queryType || includeTypes.includes(node.resource.resourceType))
      .map(node => ({ resource: node.resource, fullUrl: node.fullUrl, _clinicalSourceNodeKey: node.key })) }
    Object.defineProperty(projected, '_clinicalSource', { value: source, enumerable: false })
    session.successfulResponses.set(cacheKey, projected)
    return projected
  }

  private resourceQueryStatus: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}

  private markQuerySuccess(key: ClinicalDataQueryKey, resourceType: string, count: number, response?: any) {
    const retainedFailure = response?._retainedFailure
    this.resourceQueryStatus[key] = retainedFailure ? classifyFhirQueryError(retainedFailure, resourceType) : successfulFhirQueryStatus(resourceType, count)
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
      return await this.requestSource(primary, primary)
    } catch (error) {
      if (!fallback || !shouldRetryBasicFhirSearch(error)) throw error
      warnFhirError('FHIR server rejected optional search features; retrying a basic search:', error)
      return this.requestSource(fallback, primary)
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

    const clinicalSource = this.getClinicalSource(patientId)
    const enrichedDiagnosticReports = attachReportObservations(diagnosticReports, observations, clinicalSource)

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
      clinicalSource,
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
        .map((resource: any) => FhirMapper.toMedicationRemainingSummary(mutableClinicalProjection(resource)))
      const result = [...new Map(
        summaries.map((summary: MedicationRemainingSummaryEntity) => [summary.id, summary]),
      ).values()]
      this.markQuerySuccess('Basic', 'Basic', result.length, response)
      return result
    } catch (error) {
      this.markQueryFailure('Basic', 'Basic', error)
      warnFhirError('Failed to fetch medication remaining summaries:', error)
      return []
    }
  }

  async fetchConsents(patientId: string): Promise<ConsentEntity[]> {
    try {
      const response = await this.requestSource(
        `Consent?patient=${patientId}&_count=100`
      )
      const result = response.entry?.map((e: any) => FhirMapper.toConsent(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('Consent', 'Consent', result.length, response)
      return result
    } catch (error) {
      this.markQueryFailure('Consent', 'Consent', error)
      warnFhirError('Failed to fetch consents:', error)
      return []
    }
  }

  async fetchDevices(patientId: string): Promise<DeviceEntity[]> {
    try {
      const response = await this.requestSource(
        `Device?patient=${patientId}&_count=100`
      )
      const result = response.entry?.map((e: any) => FhirMapper.toDevice(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('Device', 'Device', result.length, response)
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
      const result = response.entry?.map((e: any) => FhirMapper.toCarePlan(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('CarePlan', 'CarePlan', result.length, response)
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
      const result = response.entry?.map((e: any) => FhirMapper.toImmunization(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('Immunization', 'Immunization', result.length, response)
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
      const result = response.entry?.map((e: any) => FhirMapper.toCondition(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('Condition', 'Condition', result.length, response)
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
        return { medications: mapMedicationSearchResponse(response, sourceType), response }
      }),
    )

    const medications: MedicationEntity[] = []
    results.forEach((result, index) => {
      const sourceType = searches[index].sourceType
      if (result.status === 'fulfilled') {
        medications.push(...result.value.medications)
        this.markQuerySuccess(sourceType, sourceType, result.value.medications.length, result.value.response)
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
      const response = await this.requestSource(
        `AllergyIntolerance?patient=${patientId}&_count=100`
      )
      const result = response.entry?.map((e: any) => FhirMapper.toAllergy(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('AllergyIntolerance', 'AllergyIntolerance', result.length, response)
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

      const result = response.entry?.map((e: any) => ({ ...FhirMapper.toObservation(mutableClinicalProjection(e.resource)), clinicalSourceNodeKey: e._clinicalSourceNodeKey })) || []
      this.markQuerySuccess('Observation', 'Observation', result.length, response)
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
    const observationStatus = this.resourceQueryStatus.Observation
    if (observationStatus && observationStatus.state !== 'ok' && observationStatus.state !== 'empty') {
      this.resourceQueryStatus['Observation:vital-signs'] = { ...observationStatus }
      return
    }
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

      const reportNodeKeys = new Map(entries.map((entry: any) => [entry.resource, entry._clinicalSourceNodeKey]))
      const source: ClinicalReconciliationResult = response._clinicalSource
      const graph = source.graph
      const observationNodes = new Map(graph.nodes
        .filter(node => node.resource.resourceType === 'Observation')
        .map(node => [node.key, node]))
      const resolvedObservations = (origin: unknown, path: RegExp) => graph.references
        .filter(edge => edge.origin.resource === origin && path.test(edge.path) && edge.status === 'resolved')
        .flatMap(edge => edge.targetKeys.map(key => observationNodes.get(key)).filter((node): node is NonNullable<typeof node> => Boolean(node)))
      const result = reports.map((report: any) => {
        const mapped = { ...FhirMapper.toDiagnosticReport(mutableClinicalProjection(report), []), clinicalSourceNodeKey: reportNodeKeys.get(report) as string | undefined }
        const members = resolvedObservations(report, /^result\[\d+\]$/).flatMap(node => [node, ...resolvedObservations(node.resource, /^hasMember\[\d+\]$/)])
        const unique = [...new Map(members.map(node => [node.key, node])).values()]
        return unique.length ? { ...mapped, _observations: unique.map(node => ({ ...FhirMapper.toObservation(mutableClinicalProjection(node.resource) as any), clinicalSourceNodeKey: node.key })) } : mapped
      })
      this.markQuerySuccess('DiagnosticReport', 'DiagnosticReport', result.length, response)
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
        .map((e: any) => FhirMapper.toImagingStudy(mutableClinicalProjection(e.resource))) || []

    try {
      const response = await this.requestWithBasicFallback(
        `ImagingStudy?patient=${patientId}&_count=200&_sort=-started`,
        `ImagingStudy?patient=${patientId}&_count=200`,
      )
      const result = mapResponse(response)
      this.markQuerySuccess('ImagingStudy', 'ImagingStudy', result.length, response)
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
        (response.entry ?? []).map((entry: any) => mutableClinicalProjection(entry.resource)),
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
        FhirMapper.toProcedure(mutableClinicalProjection(e.resource), specialMaterialsByProcedure)) || []
      this.markQuerySuccess('Procedure', 'Procedure', result.length, response)
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
          .map((e: any) => FhirMapper.toEncounter(mutableClinicalProjection(e.resource))) || []
      )
      this.markQuerySuccess('Encounter', 'Encounter', result.length, response)
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
      const result = response.entry?.map((e: any) => FhirMapper.toDocumentReference(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('DocumentReference', 'DocumentReference', result.length, response)
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
      const result = response.entry?.map((e: any) => FhirMapper.toComposition(mutableClinicalProjection(e.resource))) || []
      this.markQuerySuccess('Composition', 'Composition', result.length, response)
      return result
    } catch (error) {
      this.markQueryFailure('Composition', 'Composition', error)
      logFhirError('Failed to fetch compositions:', error)
      return []
    }
  }
}
