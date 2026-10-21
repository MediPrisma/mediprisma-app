import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { isMedicationContentOnlyIncomplete } from '@/src/core/utils/clinical-query-status'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
/**
 * Clinical Data Query Hook (React Query)
 *
 * Replaces ClinicalDataProvider with React Query for better server state management.
 *
 * Benefits:
 * - Automatic caching and background refetching
 * - No unnecessary re-renders
 * - Built-in loading and error states
 * - Dependent queries (waits for patient data)
 *
 * PROGRESSIVE LOADING — one React Query per resource type (see
 * clinical-data-fetch-plan). A single Promise.all query used to hold the whole
 * chart hostage to its slowest search, so the left panel stayed blank until
 * Observation finished paginating. Each type now settles on its own and
 * `resourceReady` lets a card gate on the types it actually renders.
 *
 * What did NOT change: `isLoading` / `isFetching` are still ALL-OR-NOTHING.
 * See the note on them below — the AI pipeline depends on it.
 */

import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { getClinicalSourceLifecycleEpoch, subscribeClinicalSourceLifecycle, getClinicalSourceCaptureEpoch, subscribeClinicalSourceCaptures } from '@/src/infrastructure/fhir/services/clinical-source-session'
import type {
  ClinicalDataCollection,
  ClinicalDataQueryKey,
  ClinicalDataQueryStatus,
  ClinicalSourceMetadata,
  ObservationEntity,
} from '@/src/core/entities/clinical-data.entity'
import {
  CLINICAL_DATA_QUERY_ROOT,
  CLINICAL_RESOURCE_UNITS,
  clinicalDataSourceQueryKey,
  clinicalResourceQueryKey,
  loadClinicalResource,
  resolveClinicalDataSource,
  type ClinicalResourceId,
  type ClinicalResourceReadyKey,
  type ClinicalResourceResult,
} from './clinical-data-fetch-plan'
import { usePatientQuery } from '../patient/use-patient-query.hook'
import {
  CLINICAL_SESSION_GC_TIME,
  CLINICAL_SESSION_STALE_TIME,
} from './clinical-session-cache'

const BLOCKING_FHIR_QUERY_KEYS = new Set([
  'Condition',
  'MedicationRequest',
  'AllergyIntolerance',
  'Observation',
  'DiagnosticReport',
  'Encounter',
])

const EMPTY_ARRAY: any[] = []

const NOTHING_READY = Object.freeze(
  Object.fromEntries([
    ...CLINICAL_RESOURCE_UNITS.map((unit) => [unit.id, false]),
    ['vitalSigns', false],
  ]) as Record<ClinicalResourceReadyKey, boolean>,
)

/** Entity arrays keyed by unit id — same element types the collection uses, so
 * consumers keep their precise entity typing. */
type ClinicalEntityMap = { [K in ClinicalResourceId]: ClinicalDataCollection[K] }

interface ClinicalResourceAggregate {
  entities: ClinicalEntityMap
  vitalSigns: ObservationEntity[]
  sourceMetadata?: ClinicalSourceMetadata
  clinicalSource?: ClinicalReconciliationResult
  readClinicalSource?: () => ClinicalReconciliationResult | undefined
  resourceQueryStatus: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>>
  /** Per type: its own query has settled (or is disabled, matching the
   * all-types behaviour when there is no patient to query for). */
  resourceReady: Record<ClinicalResourceReadyKey, boolean>
  anyLoading: boolean
  anyFetching: boolean
  /** Every type has produced data or an error — the gate for handing the whole
   * collection to consumers that reason over the complete chart. */
  allSettled: boolean
  error: Error | null
}

/**
 * Fold the per-type query results into one snapshot.
 *
 * Module-level (never re-created per render) on purpose: useQueries memoises
 * `combine` output only while the function identity is stable, and that memo is
 * what keeps this hook's return value referentially stable across unrelated
 * parent renders — AI/context consumers use it as a memo key.
 */
function buildClinicalResults(
  results: Array<{
    data?: ClinicalResourceResult
    error: unknown
    isLoading: boolean
    isFetching: boolean
    isPending: boolean
  }>,
): ClinicalResourceAggregate {
  // Written through an index signature because the loop walks the unit table;
  // the map is read back at its precise per-key entity types.
  const entities = {} as ClinicalEntityMap
  const writeEntities = entities as Record<ClinicalResourceId, any[]>
  const resourceReady = {} as Record<ClinicalResourceReadyKey, boolean>
  const resourceQueryStatus: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}
  let vitalSigns: ObservationEntity[] = EMPTY_ARRAY
  let sourceMetadata: ClinicalSourceMetadata | undefined
  let clinicalSource: ClinicalReconciliationResult | undefined
  let error: Error | null = null
  let anyLoading = false
  let anyFetching = false
  let allSettled = true

  for (let index = 0; index < CLINICAL_RESOURCE_UNITS.length; index += 1) {
    const unit = CLINICAL_RESOURCE_UNITS[index]
    const result = results[index]
    writeEntities[unit.id] = result?.data?.entities ?? EMPTY_ARRAY
    resourceReady[unit.id] = !result?.isLoading && !result?.isFetching
    if (result?.data?.status) Object.assign(resourceQueryStatus, result.data.status)
    // A multi-search unit may have committed one new capture while its cached
    // rows still belong to the previous result. This is pending, never absence.
    if (result?.data && result.isFetching) {
      for (const key of unit.statusKeys) resourceQueryStatus[key] = {
        resourceType: resourceQueryStatus[key]?.resourceType ?? key.split(':')[0],
        state: 'pending', count: undefined,
        message: 'Clinical records are refreshing. The updated result is not complete; absence cannot be concluded.',
      }
    }
    if (result?.data?.vitalSigns) vitalSigns = result.data.vitalSigns
    clinicalSource ??= result?.data?.getClinicalSource?.()
    if (!sourceMetadata && result?.data?.sourceMetadata) {
      sourceMetadata = result.data.sourceMetadata
    }
    if (!error && result?.error) error = result.error as Error
    if (result?.isLoading) anyLoading = true
    if (result?.isFetching) anyFetching = true
    if (result?.isPending || result?.isFetching) allSettled = false
  }

  // Vitals ride along with the Observation query rather than costing a second
  // search, so their readiness is that query's readiness.
  resourceReady.vitalSigns = resourceReady.observations

  const projected = projectClinicalAggregate({ ...entities, vitalSigns, clinicalSource, resourceQueryStatus })
  for (const unit of CLINICAL_RESOURCE_UNITS) writeEntities[unit.id] = projected[unit.id]
  vitalSigns = projected.vitalSigns

  return {
    entities,
    vitalSigns,
    sourceMetadata,
    clinicalSource,
    readClinicalSource: results.find(result => result.data?.getClinicalSource)?.data?.getClinicalSource,
    resourceQueryStatus: projected.resourceQueryStatus,
    resourceReady,
    anyLoading,
    anyFetching,
    allSettled,
    error,
  }
}

// Multiple UI/AI/CDSS subscribers read one projection for the same query snapshot.
// A WeakMap bounds lifetime to React Query's data objects, including patient/import changes.
class ClinicalSnapshot {
  constructor(readonly aggregate: ClinicalResourceAggregate) {}
}
const sharedAggregates = new WeakMap<object, {
  signature: unknown[]
  snapshot: ClinicalSnapshot
}>()
const sharedReprojections = new WeakMap<ClinicalSnapshot, WeakMap<ClinicalReconciliationResult, ClinicalResourceAggregate>>()
// Background refreshes keep one complete, immutable snapshot. Scope changes
// never reuse it; once all searches settle the new graph and rows replace it
// together. A newly committed capture must not rewrite the retained snapshot.
const settledAggregates = new WeakMap<object, { scope: string; aggregate: ClinicalResourceAggregate }>()
const refreshingAggregates = new WeakMap<ClinicalResourceAggregate, ClinicalResourceAggregate>()
function reprojectClinicalSnapshot(snapshot: ClinicalSnapshot, source: ClinicalReconciliationResult | undefined): ClinicalResourceAggregate {
  if (!source || source === snapshot.aggregate.clinicalSource) return snapshot.aggregate
  let projections = sharedReprojections.get(snapshot)
  if (!projections) { projections = new WeakMap(); sharedReprojections.set(snapshot, projections) }
  const cached = projections.get(source)
  if (cached) return cached
  const projected = projectClinicalAggregate({ ...snapshot.aggregate.entities, vitalSigns: snapshot.aggregate.vitalSigns, clinicalSource: source, resourceQueryStatus: snapshot.aggregate.resourceQueryStatus })
  const aggregate = { ...snapshot.aggregate, entities: projected, vitalSigns: projected.vitalSigns, clinicalSource: source, resourceQueryStatus: projected.resourceQueryStatus }
  projections.set(source, aggregate)
  return aggregate
}
function combineClinicalResults(results: Parameters<typeof buildClinicalResults>[0]): ClinicalSnapshot {
  const key = results.find(result => result.data)?.data
  const signature = results.flatMap(result => [result.data, result.error, result.isLoading, result.isFetching, result.isPending])
  const cached = key ? sharedAggregates.get(key) : undefined
  if (cached && cached.signature.every((value, index) => value === signature[index])) return cached.snapshot
  const aggregate = buildClinicalResults(results)
  const snapshot = new ClinicalSnapshot(aggregate)
  if (key) sharedAggregates.set(key, { signature, snapshot })
  return snapshot
}

function useClinicalResourceAggregate() {
  const { data: patient, isLoading: patientLoading } = usePatientQuery()
  const queryClient = useQueryClient()
  const patientId = patient?.id
  const captureEpoch = useSyncExternalStore(subscribeClinicalSourceCaptures, getClinicalSourceCaptureEpoch, getClinicalSourceCaptureEpoch)
  const sourceEpoch = useSyncExternalStore(subscribeClinicalSourceLifecycle, getClinicalSourceLifecycleEpoch, getClinicalSourceLifecycleEpoch)

  // One shared, session-stable data source per load generation. fetchQuery both collapses the
  // concurrent per-type callers onto a single resolution — critical in
  // local-bundle mode, where resolving the source parses the whole (multi-MB)
  // bundle — and honours explicit invalidation, so an import/clear re-resolves
  // it exactly once without an idle tab re-parsing an unchanged Bundle.
  const getSource = useCallback(
    (id: string) => queryClient.fetchQuery({
      queryKey: clinicalDataSourceQueryKey(id, sourceEpoch),
      queryFn: () => resolveClinicalDataSource(id),
      staleTime: CLINICAL_SESSION_STALE_TIME,
      gcTime: CLINICAL_SESSION_GC_TIME,
      retry: 1,
    }),
    [queryClient, sourceEpoch],
  )

  const snapshot = useQueries({
    queries: CLINICAL_RESOURCE_UNITS.map((unit) => ({
      queryKey: clinicalResourceQueryKey(patientId, unit.id, sourceEpoch),
      queryFn: () => {
        if (!patientId) throw new Error('Patient ID is required')
        return loadClinicalResource(unit, patientId, () => getSource(patientId))
      },
      enabled: !!patientId && !patientLoading,
      staleTime: CLINICAL_SESSION_STALE_TIME,
      gcTime: CLINICAL_SESSION_GC_TIME,
      retry: 1,
    })),
    combine: combineClinicalResults,
  })

  const refetch = useCallback(async () => {
    if (!patientId) return
    // Drop the memoised source too: a retry after an auth failure or a bundle
    // swap must re-resolve the data source, not replay the one the failure came
    // from. It has no observers, so removing it just forces the next
    // fetchQuery to run.
    queryClient.removeQueries({
      queryKey: clinicalDataSourceQueryKey(patientId),
      exact: true,
    })
    await queryClient.refetchQueries({
      queryKey: [CLINICAL_DATA_QUERY_ROOT, patientId],
      type: 'active',
    })
  }, [patientId, queryClient])

  // Patient reads share the capture store but need not refetch clinical queries.
  // The external-store snapshot makes generation changes atomic across subscribers.
  const clinicalSource = useMemo(() => {
    void captureEpoch // Read after a published source revision or a refreshed patient query.
    void patient
    return snapshot.aggregate.readClinicalSource?.() ?? snapshot.aggregate.clinicalSource
  }, [snapshot, captureEpoch, patient])
  const aggregate = reprojectClinicalSnapshot(snapshot, clinicalSource)
  const scope = JSON.stringify([patientId, sourceEpoch])
  useEffect(() => {
    if (aggregate.allSettled && !aggregate.anyFetching && !patientLoading) {
      settledAggregates.set(queryClient, { scope, aggregate })
    }
  }, [aggregate, patientLoading, queryClient, scope])
  if (aggregate.anyFetching && !aggregate.anyLoading && !patientLoading) {
    const settled = settledAggregates.get(queryClient)
    if (settled?.scope === scope) {
      let refreshing = refreshingAggregates.get(settled.aggregate)
      if (!refreshing) {
        refreshing = { ...settled.aggregate, anyFetching: true, readClinicalSource: () => settled.aggregate.clinicalSource }
        refreshingAggregates.set(settled.aggregate, refreshing)
      }
      return { aggregate: refreshing, patientLoading, refetch }
    }
  }
  return { aggregate, patientLoading, refetch }
}

/**
 * Whole-collection view, kept for consumers that reason over the complete chart
 * (IPS export, FHIR tools). `data` stays undefined until EVERY type has
 * settled — those consumers must never mistake a half-loaded chart for a thin
 * one.
 */
export function useClinicalDataQuery() {
  const {
    isLoading: patientLoading,
    isFetching: patientFetching,
  } = usePatientQuery()
  const { aggregate, refetch } = useClinicalResourceAggregate()

  return useMemo(() => {
    const { entities } = aggregate
    const data: ClinicalDataCollection | undefined = aggregate.allSettled
      ? {
        conditions: entities.conditions,
        medications: entities.medications,
        medicationRemainingSummaries: entities.medicationRemainingSummaries,
        allergies: entities.allergies,
        observations: entities.observations,
        vitalSigns: aggregate.vitalSigns,
        diagnosticReports: entities.diagnosticReports,
        imagingStudies: entities.imagingStudies,
        procedures: entities.procedures,
        encounters: entities.encounters,
        documentReferences: entities.documentReferences,
        compositions: entities.compositions,
        immunizations: entities.immunizations,
        consents: entities.consents,
        devices: entities.devices,
        carePlans: entities.carePlans,
        ...(aggregate.sourceMetadata ? { sourceMetadata: aggregate.sourceMetadata } : {}),
        clinicalSource: aggregate.clinicalSource,
        resourceQueryStatus: aggregate.resourceQueryStatus,
      }
      : undefined

    return {
      data,
      isLoading: patientLoading || aggregate.anyLoading,
      isFetching: patientFetching || aggregate.anyFetching,
      error: aggregate.error,
      refetch,
    }
  }, [aggregate, patientFetching, patientLoading, refetch])
}

// Backward compatibility hook that matches the old ClinicalDataProvider API
export function useClinicalData() {
  const {
    isLoading: patientLoading,
    isFetching: patientFetching,
  } = usePatientQuery()
  const { aggregate, refetch } = useClinicalResourceAggregate()

  // Keep one referentially-stable snapshot until React Query actually changes
  // data or request state. AI/context consumers use this object as a memo key;
  // returning a fresh literal on every parent render invalidated every clinical
  // section and rebuilt the full lab catalog during unrelated tab switches.
  return useMemo(() => {
    const { entities } = aggregate
    const isLoading = patientLoading || aggregate.anyLoading
    const resourceQueryStatus = aggregate.resourceQueryStatus
    const queryIssues = Object.entries(resourceQueryStatus)
      .filter(([, status]) => status && status.state !== 'ok' && status.state !== 'empty' && status.state !== 'pending')
      .filter(([, status]) => !isMedicationContentOnlyIncomplete(status))
    const hasBlockingQueryIssues = queryIssues.some(([key, status]) => BLOCKING_FHIR_QUERY_KEYS.has(key) || (status.invalidModifierCount ?? 0) > 0)

    return {
      conditions: entities.conditions,
      medications: entities.medications,
      medicationRemainingSummaries: entities.medicationRemainingSummaries,
      allergies: entities.allergies,
      observations: entities.observations,
      vitalSigns: aggregate.vitalSigns,
      diagnosticReports: entities.diagnosticReports,
      imagingStudies: entities.imagingStudies,
      procedures: entities.procedures,
      encounters: entities.encounters,
      documentReferences: entities.documentReferences,
      compositions: entities.compositions,
      immunizations: entities.immunizations,
      consents: entities.consents,
      devices: entities.devices,
      carePlans: entities.carePlans,
      sourceMetadata: aggregate.sourceMetadata,
      clinicalSource: aggregate.clinicalSource,
      resourceQueryStatus,
      queryIssues,
      hasBlockingQueryIssues,
      // Per-type readiness for progressive rendering: a card gates on the types
      // it actually renders instead of on the whole chart. Never use this to
      // decide whether clinical data is ABSENT — that is what `isLoading` /
      // `isFetching` below are for.
      resourceReady: patientLoading ? NOTHING_READY : aggregate.resourceReady,
      // ALL-OR-NOTHING, deliberately: true until every resource type has
      // settled. The AI pipeline (use-clinical-ai-input, chat send gating,
      // slot generation) treats a loaded-but-empty chart as clinical absence,
      // so it must never see one type's data while another is still in flight.
      isLoading,
      // React Query keeps isLoading=false while it refreshes cached data in the
      // background. AI consumers must also wait for that refresh: otherwise a
      // patient card can remain available from cache while the matching visits,
      // reports and medications are still being replaced underneath it.
      isFetching: patientFetching || aggregate.anyFetching,
      error: aggregate.error,
      refetch,
    }
  }, [aggregate, patientFetching, patientLoading, refetch])
}
