import { CLINICAL_RECONCILIATION_POLICY_VERSION } from '@/src/core/services/clinical-reconciliation'
import { localImportScopeSegment } from '@/src/infrastructure/fhir/services/local-bundle-scope'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
/**
 * Per-resource-type fetch plan for the clinical chart.
 *
 * The chart used to load through a single Promise.all over every FHIR search,
 * so nothing data-bearing rendered until the slowest type finished — normally
 * Observation, whose pagination is strictly sequential. This module cuts that
 * work into one unit per resource type; use-clinical-data-query.hook drives one
 * React Query per unit, so a card can fill as soon as its own type lands.
 *
 * Two invariants the units encode:
 *  - `vitalSigns` is NOT a unit. It is the vitals subset of the Observation
 *    result (OBSERVATION SUPERSET INVARIANT on ClinicalDataCollection), so it
 *    rides along with the observations unit instead of costing a second search.
 *  - a unit owns every `resourceQueryStatus` key its search(es) report, so the
 *    aggregated status map stays complete once all units have settled.
 */

import { getClinicalDataRepository } from '@/src/application/composition'
import type {
  ClinicalDataCollection,
  ClinicalDataQueryKey,
  ClinicalDataQueryStatus,
  ClinicalSourceMetadata,
  ObservationEntity,
} from '@/src/core/entities/clinical-data.entity'
import type { IClinicalDataRepository } from '@/src/core/interfaces/repositories/clinical-data.repository.interface'
import { LocalBundleModeError } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { selectVitalSignObservations } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'

/** Collection fields loaded by their own query. `vitalSigns` is derived. */
export type ClinicalResourceId =
  | 'conditions'
  | 'medications'
  | 'medicationRemainingSummaries'
  | 'allergies'
  | 'observations'
  | 'diagnosticReports'
  | 'imagingStudies'
  | 'procedures'
  | 'encounters'
  | 'documentReferences'
  | 'compositions'
  | 'immunizations'
  | 'consents'
  | 'devices'
  | 'carePlans'

/** Every array the chart exposes, including the derived vitals subset. */
export type ClinicalResourceReadyKey = ClinicalResourceId | 'vitalSigns'

/**
 * The per-type fetchers a repository needs to load progressively.
 *
 * IClinicalDataRepository only declares the core nine — the local-bundle
 * implementation stops there because its parse already produces every type in
 * one pass — so the rest are optional here and resolveClinicalDataSource falls
 * back to a single fetchAllClinicalData when any is missing.
 */
type ClinicalDataFetchers = IClinicalDataRepository & {
  fetchDocumentReferences?(patientId: string): Promise<unknown[]>
  fetchCompositions?(patientId: string): Promise<unknown[]>
  fetchImmunizations?(patientId: string): Promise<unknown[]>
  fetchConsents?(patientId: string): Promise<unknown[]>
  fetchDevices?(patientId: string): Promise<unknown[]>
  fetchCarePlans?(patientId: string): Promise<unknown[]>
  getClinicalSource?(patientId: string): ClinicalReconciliationResult
  getQueryStatus?(key: ClinicalDataQueryKey): ClinicalDataQueryStatus | undefined
}

interface ClinicalResourceUnit {
  id: ClinicalResourceId
  method: keyof ClinicalDataFetchers
  /** resourceQueryStatus keys this unit's search(es) report. */
  statusKeys: readonly ClinicalDataQueryKey[]
}

export const CLINICAL_RESOURCE_UNITS: readonly ClinicalResourceUnit[] = [
  { id: 'conditions', method: 'fetchConditions', statusKeys: ['Condition'] },
  {
    id: 'medications',
    method: 'fetchMedications',
    // One fetcher, two searches: orders and statements are reported separately
    // so the banner can say which half a server refused.
    statusKeys: ['MedicationRequest', 'MedicationStatement'],
  },
  {
    id: 'medicationRemainingSummaries',
    method: 'fetchMedicationRemainingSummaries',
    statusKeys: ['Basic'],
  },
  { id: 'allergies', method: 'fetchAllergies', statusKeys: ['AllergyIntolerance'] },
  {
    id: 'observations',
    method: 'fetchObservations',
    statusKeys: ['Observation', 'Observation:vital-signs'],
  },
  { id: 'diagnosticReports', method: 'fetchDiagnosticReports', statusKeys: ['DiagnosticReport'] },
  { id: 'imagingStudies', method: 'fetchImagingStudies', statusKeys: ['ImagingStudy'] },
  { id: 'procedures', method: 'fetchProcedures', statusKeys: ['Procedure'] },
  { id: 'encounters', method: 'fetchEncounters', statusKeys: ['Encounter'] },
  { id: 'documentReferences', method: 'fetchDocumentReferences', statusKeys: ['DocumentReference'] },
  { id: 'compositions', method: 'fetchCompositions', statusKeys: ['Composition'] },
  { id: 'immunizations', method: 'fetchImmunizations', statusKeys: ['Immunization'] },
  { id: 'consents', method: 'fetchConsents', statusKeys: ['Consent'] },
  { id: 'devices', method: 'fetchDevices', statusKeys: ['Device'] },
  { id: 'carePlans', method: 'fetchCarePlans', statusKeys: ['CarePlan'] },
]

/** The unit that also produces `vitalSigns`. */
const OBSERVATIONS_UNIT_ID: ClinicalResourceId = 'observations'

export const CLINICAL_DATA_QUERY_ROOT = 'clinical-data'

/** Third key segment of the shared data-source query. Never a resource id. */
const SOURCE_KEY_SEGMENT = '__source'

export function clinicalDataSourceQueryKey(patientId: string) {
  return [CLINICAL_DATA_QUERY_ROOT, patientId, SOURCE_KEY_SEGMENT, localImportScopeSegment(), CLINICAL_RECONCILIATION_POLICY_VERSION] as const
}

export function clinicalResourceQueryKey(
  patientId: string | undefined,
  id: ClinicalResourceId,
) {
  return [CLINICAL_DATA_QUERY_ROOT, patientId, id, localImportScopeSegment(), CLINICAL_RECONCILIATION_POLICY_VERSION] as const
}

export interface ClinicalDataSource {
  repository: ClinicalDataFetchers
  /**
   * Set only when the repository cannot serve every type on its own: a local
   * import parses the whole bundle in one pass and implements just the core
   * nine fetchers. Materialising that collection ONCE here is what keeps the
   * per-type queries from re-running a multi-megabyte bundle parse 14 times.
   */
  collection: ClinicalDataCollection | null
}

/**
 * Resolve the data source for one load generation.
 *
 * Deliberately not memoised in module state: the SMART-vs-local mode can flip
 * mid-session (import / clear / launch), so the caller caches this behind a
 * React Query entry that ordinary invalidation can drop.
 */
export async function resolveClinicalDataSource(
  patientId: string,
): Promise<ClinicalDataSource> {
  const repository = (await getClinicalDataRepository()) as ClinicalDataFetchers
  const servesEveryType = CLINICAL_RESOURCE_UNITS.every(
    (unit) => typeof repository[unit.method] === 'function',
  )
  return {
    repository,
    collection: servesEveryType ? null : await repository.fetchAllClinicalData(patientId),
  }
}

export interface ClinicalResourceResult {
  /** Read the shared store after any progressive query settles. */
  getClinicalSource?: () => ClinicalReconciliationResult | undefined
  entities: unknown[]
  /** Set by the observations unit only — the vitals subset of `entities`. */
  vitalSigns?: ObservationEntity[]
  status: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>>
  /** Only local imports carry conversion metadata; every unit reads it off the
   * same source object so the hook can take it from whichever unit settles. */
  sourceMetadata?: ClinicalSourceMetadata
}

const EMPTY_ENTITIES: unknown[] = []

/** 'Observation:vital-signs' reports under the plain Observation type. */
function resourceTypeOf(key: ClinicalDataQueryKey): string {
  return key === 'Observation:vital-signs' ? 'Observation' : key
}

function unavailableStatus(unit: ClinicalResourceUnit) {
  const status: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}
  for (const key of unit.statusKeys) {
    status[key] = {
      resourceType: resourceTypeOf(key),
      state: 'error',
      message: 'Clinical data source became unavailable before the query completed.',
    }
  }
  return status
}

function collectStatus(
  unit: ClinicalResourceUnit,
  read: (key: ClinicalDataQueryKey) => ClinicalDataQueryStatus | undefined,
) {
  const status: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}
  for (const key of unit.statusKeys) {
    const value = read(key)
    if (value) status[key] = value
  }
  return status
}

/**
 * Load one resource type.
 *
 * `getSource` is a thunk rather than a value so the 14 concurrent callers share
 * a single source resolution (and a single bundle parse) without this module
 * owning the cache.
 */
export async function loadClinicalResource(
  unit: ClinicalResourceUnit,
  patientId: string,
  getSource: () => Promise<ClinicalDataSource>,
): Promise<ClinicalResourceResult> {
  try {
    const source = await getSource()

    if (source.collection) {
      const collection = source.collection
      return {
        entities: collection[unit.id] as unknown[],
        // Trust the source's own vitals split here: it is what local imports
        // and the demo bundle have always rendered.
        ...(unit.id === OBSERVATIONS_UNIT_ID ? { vitalSigns: collection.vitalSigns } : {}),
        status: collectStatus(unit, (key) => collection.resourceQueryStatus?.[key]),
        sourceMetadata: collection.sourceMetadata,
        getClinicalSource: () => collection.clinicalSource,
      }
    }

    const { repository } = source
    const fetcher = repository[unit.method] as (id: string) => Promise<unknown[]>
    const entities = await fetcher.call(repository, patientId)
    return {
      entities,
      getClinicalSource: repository.getClinicalSource ? () => repository.getClinicalSource!(patientId) : undefined,
      ...(unit.id === OBSERVATIONS_UNIT_ID
        ? { vitalSigns: selectVitalSignObservations(entities as ObservationEntity[]) }
        : {}),
      status: collectStatus(unit, (key) => repository.getQueryStatus?.(key)),
    }
  } catch (error) {
    // The SMART client became unavailable mid-fetch (race against clear /
    // import). Report it per status key so panels render their empty state and
    // the FHIR issues banner explains why, instead of throwing a hard error.
    if (error instanceof LocalBundleModeError) {
      return {
        entities: EMPTY_ENTITIES,
        ...(unit.id === OBSERVATIONS_UNIT_ID ? { vitalSigns: [] } : {}),
        status: unavailableStatus(unit),
      }
    }
    throw error
  }
}
