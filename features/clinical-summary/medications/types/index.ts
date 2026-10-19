// Medications Types - Re-export from shared
import type {
  CodeableConcept,
  Quantity,
  Period,
  Duration,
  MedicationRequest,
  DosageInstruction,
} from '@/src/shared/types/fhir.types'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import type { HospitalMedicationName } from '@/src/shared/utils/hospital-medication-names'

export type {
  CodeableConcept,
  Quantity,
  Period,
  Duration,
  MedicationRequest,
  DosageInstruction,
}

// Type aliases for backward compatibility
export type DurationLike = Duration
export type PeriodLike = Period
export type Medication = MedicationRequest

export type MedicationNameMode = 'ingredient' | 'product'

export interface MedicationExecutionPeriod {
  /** Source-reported execution start; kept as ISO/FHIR date or dateTime. */
  start?: string
  /** Source-reported execution end; kept as ISO/FHIR date or dateTime. */
  end?: string
}

export interface MedicationRow {
  id: string
  /** Canonical originating visit. Distinct orders within one visit must remain
   *  distinct even when their product and regimen are identical. */
  encounterReference?: string
  /** Original cross-source order ids represented by this row. */
  reconciledOrderIds?: string[]
  sourceComparison?: { status: 'candidate' | 'confirmed'; records: MedicationRow[] }
  /** An actually recorded NHI product code, including an explicit cloud code
   *  retained in a confirmed cross-source order. Never guessed from names. */
  nhiDrugCode?: string
  dataOrigin?: 'hospital' | 'medcloud' | 'integrated'
  sourceOrderIdentifiers?: string[]
  /** Stable source medication key used for grouping; never infer identity from
   *  the audience-facing title because different products can share an
   *  ingredient name. */
  drugKey?: string
  title: string
  /** Optional official product/brand name used when the list's name display
   *  switch is set to product. Patient rows intentionally leave this empty. */
  secondaryTitle?: string
  status: string
  dose?: string
  route?: string
  frequency?: string
  detail?: string
  /** Source-reported total dispensed quantity. The compact medication row
   *  shows the numeric value only, matching the NHI cloud medication layout. */
  totalQuantity?: number
  startedOn?: string
  stoppedOn?: string
  durationDays?: number
  /** Computed end date: startedOn + durationDays (ISO date) */
  endDate?: string
  /** Source calendar day of the start as YYYY-MM-DD. `startedOn`/`endDate`
   *  are locale display strings ("10/1/2026" in en-US), so anything that
   *  compares or groups by date must use these instead. */
  startedOnIso?: string
  /** Calendar day of `endDate` as YYYY-MM-DD (see startedOnIso). */
  endDateIso?: string
  /** Days remaining until endDate (negative if already past) */
  daysRemaining?: number
  /** Primary readout: today's cloud single-prescription snapshot when fresh,
   * otherwise the App's date-based estimate. */
  displayRemainingDays?: number
  displayRemainingSource?: 'cloud-single' | 'app-estimate'
  singlePrescriptionRemainingDays?: number
  singlePrescriptionRemainingCapturedAt?: string
  singlePrescriptionRemainingIsCurrent?: boolean
  /** True if status is stopped/completed OR computed endDate has passed */
  isInactive: boolean
  /** True when FHIR courseOfTherapyType marks the order as 'continuous'
   *  (NHI 慢性處方箋, refillable chronic prescription). */
  isChronic: boolean
  /** The source explicitly marks this outpatient order as self-purchased. */
  selfPurchased?: boolean
  /** Audience-aware drug-category label (e.g. "降血壓藥" or "HYPOTENSIVE AGENTS").
   *  MediCloud ATC3 takes precedence; other sources fall back to FHIR
   *  MedicationRequest.category[0]. Empty when neither is available. */
  category?: string
  /** Official, date-effective drug-master data added by the App. */
  drugTerminology?: MedicationEntity['drugTerminology']
  /** Display-only hospital names; never an exact NHI product identity. */
  hospitalMedicationName?: HospitalMedicationName
  // ── Refill-history aggregate (derived across all MedicationRequests for
  //    this drug). Lets a single row surface compliance / adherence info
  //    without forcing the user to expand the per-drug accordion in the
  //    "Medication History" section.
  /** This refill's prescriber / dispensing pharmacy (requester.display). */
  pharmacy?: string
  /** ICD-10 code from this refill's reasonCode[0].coding[0].code. */
  icdCode?: string
  /** Human-readable ICD-10 description (text or display). */
  icdText?: string
  /** Total number of refills of this drug across the loaded dataset. */
  refillCount: number
  /** Retained for existing row renderers; source reconciliation never folds
   *  independent renewals into an active prescription, so this is zero. */
  overlapCount?: number
  /** First (earliest) refill date for this drug, formatted. */
  firstRefillDate?: string
  /** Originating FHIR resource type. Bridge data is always undefined or
   *  'MedicationRequest'; IPS data uses 'MedicationStatement'. Drives the
   *  per-row source chip (only shown when the list is a mixed source). */
  sourceResourceType?: 'MedicationRequest' | 'MedicationStatement'
  /** Lowercased bilingual search blob: drug name (中文 + English) + NHI code +
   *  drug class (中/英) + indication ICD (碼 + 中/英) + 機構 + date tokens
   *  (西元 + 民國). Lets the 用藥 search match regardless of UI language. */
  searchHaystack: string
}
