// 總覽「用藥」 — the therapies running (or just stopped) inside the overview
// window, with the change verdict computed against the FULL prescription
// history so "new" really means new.
//
// Its own hook rather than a section of useOverviewData: the medication part
// is self-contained (raw prescriptions + window in, the card's list out), and
// apart it can be tested on its own.
import { useMemo } from 'react'
import { medicationClinicalIdentityKey } from '@/src/shared/utils/fhir-display-helpers'
import { computeDurationDays } from '@/features/clinical-summary/medications/utils/duration-helpers'
import { humanDoseAmount, displayDosageInstruction, doseUnlessRepeated } from '@/features/clinical-summary/medications/utils/dose-helpers'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { useGroupedMedications } from '@/features/clinical-summary/medications/hooks/useGroupedMedications'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'
import { medicationRecordedTreatmentEnd } from '@/src/core/utils/clinical-context-selection.utils'
import {
  classifyMedicationChanges,
  overlapsOverviewWindow,
  toDayKey,
  type OverviewMedChange,
  type OverviewMedFact,
  type OverviewWindow,
} from '../utils/overview-selectors'

export interface OverviewMedItem {
  id: string
  key: string
  title: string
  /** Product name when it differs from the ingredient name (medical audience). */
  secondaryTitle?: string
  doseText: string
  category?: string
  institution?: string
  day?: string
  isChronic: boolean
  isInactive: boolean
  /** Still running, or finished within MEDICATION_RECENTLY_FINISHED_DAYS. */
  isCurrent: boolean
  daysRemaining?: number
  /** The day the supply runs to (YYYY-MM-DD), from the source's dates. */
  supplyEndDay?: string
  change?: OverviewMedChange
  row: MedicationRow
}

export interface OverviewMedsData {
  items: OverviewMedItem[]
  count: number
  changeCount: number
}

const MEDICATION_INACTIVE_STATUSES = new Set(['stopped', 'completed', 'cancelled', 'entered-in-error', 'on-hold', 'draft'])

/**
 * Identity used only for medication change detection. A refill can switch NHI
 * product/package codes while continuing the same ingredient; treating that
 * switch as a new medicine produces a false 新增 badge. Keep the stricter
 * product identity for rendered-row grouping. Prefer the governed ingredient
 * name here, with ATC5 as a fallback when the terminology lacks one.
 */
function medicationChangeIdentityKey(medication: any): string {
  const sourceIngredient = medication?.drugTerminology?.ingredientText
  const ingredient = typeof sourceIngredient === 'string'
    ? sourceIngredient
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase('en')
      .replace(/\s*([+/,])\s*/g, '$1')
      .replace(/\s+/g, ' ')
    : ''
  if (ingredient) return `ingredient|${ingredient}`

  const concept = medication?.medicationCodeableConcept
    || medication?.code
    || medication?.resource?.code
  const atc = Array.isArray(concept?.coding)
    ? concept.coding.find((coding: any) => (
      typeof coding?.code === 'string'
      && /(?:whocc\.no\/atc|atc)/i.test(coding?.system ?? '')
      && /^[A-Z]\d{2}[A-Z]{2}\d{2}$/i.test(coding.code.trim())
    ))?.code.trim().toUpperCase()
    : undefined
  return atc ? `atc5|${atc}` : medicationClinicalIdentityKey(medication)
}

/**
 * How long a finished prescription stays on the overview's medication list.
 *
 * The card answers "what is this patient on?", and over a three-month window
 * that question was drowned by every short course an admission or an ER visit
 * dispensed. So the default list is what is still running, plus what ran out
 * recently — because "ran out and has not come back" is itself worth seeing.
 *
 * 14 days rather than 7: a 28-day chronic supply that lapsed ten days ago is
 * exactly the case a summary should surface, while an antibiotic course from a
 * stay three weeks ago is not. 異動 is unaffected — a therapy stopped earlier
 * in the window still shows there, because that is the question that filter
 * asks.
 */
const MEDICATION_RECENTLY_FINISHED_DAYS = 14

function daysBetween(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`)
  const to = Date.parse(`${toDay}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY
  return Math.round((to - from) / 86400000)
}

/**
 * The supply span a prescription covers, as raw source days.
 *
 * Shared by the display filter and the change-detection fact list so the two
 * can never disagree about when a prescription ran — a disagreement there
 * would show a drug in the list while classifying it out of the window, or
 * the reverse.
 */
function medicationWindowDays(
  medication: any,
  knownStatus?: string,
): { startDay?: string; endDay?: string; supplyEndDay?: string } {
  const dosage = medication?.dosageInstruction?.[0] || medication?.dosage?.[0]
  const status = knownStatus ?? (typeof medication?.status === 'string'
    ? medication.status.toLowerCase()
    : '')
  const start = medication?.authoredOn
    ?? medication?.effectiveDateTime
    ?? medication?.dispenseRequest?.validityPeriod?.start
  let end = medicationRecordedTreatmentEnd(medication)
  // The day the supply runs to, as a calendar day: the source's own end when
  // it has one, else the start day plus the supplied days. Never from the
  // rounded-up remaining-day count, which can land a day late.
  let supplyEndDay = toDayKey(end)
  if (!end && start && (medication?.dispenseRequest?.expectedSupplyDuration || dosage?.timing?.repeat?.boundsDuration)) {
    const days = computeDurationDays({
      expectedDuration: medication?.dispenseRequest?.expectedSupplyDuration,
      boundsDuration: dosage?.timing?.repeat?.boundsDuration,
    })
    const date = new Date(start)
    if (days && !Number.isNaN(date.getTime())) {
      // Match the medication tab's source-duration coverage calculation.
      date.setDate(date.getDate() + days - 1)
      end = date.toISOString()
      const startDay = toDayKey(start)
      if (startDay) {
        const [y, m, d] = startDay.split('-').map(Number)
        supplyEndDay = new Date(Date.UTC(y, m - 1, d + days - 1)).toISOString().slice(0, 10)
      }
    }
  }
  return {
    startDay: toDayKey(start),
    endDay: toDayKey(end ?? (MEDICATION_INACTIVE_STATUSES.has(status)
      ? medication?.effectiveDateTime ?? medication?.authoredOn
      : undefined)),
    supplyEndDay,
  }
}

export interface OverviewMedsResult {
  meds: OverviewMedsData
  /** The window's row model, which 就診 also reads. */
  medicationRows: MedicationRow[]
}

export function useOverviewMeds(
  medications: readonly any[] | undefined,
  window: OverviewWindow,
  audience: 'medical' | 'patient',
  locale: string,
): OverviewMedsResult {
  // Every record gets an explicit id FIRST. `useMedicationRows` falls back to
  // the array position for an id-less record, so the fact list below could
  // only match rows back to raw prescriptions while both walked the identical
  // array. Pinning ids here breaks that coupling, which is what lets the row
  // model be built from a subset without silently repointing every id.
  const identifiedMedications = useMemo(
    () => (Array.isArray(medications) ? medications : []).map(
      (medication: any, index: number) => (
        medication?.id ? medication : { ...medication, id: `med-${index}` }
      ),
    ),
    [medications],
  )

  // Rows are a DISPLAY model — NHI drug-master lookup, dose formatting, i18n —
  // and on a decade-long chart the overview was paying for all of it on every
  // refill ever dispensed (measured: ~50-450ms for 440 prescriptions) to show
  // about twenty. Only prescriptions that touch the window can appear, so only
  // those become rows. An undated record is kept: it cannot be ruled out.
  const displayMedications = useMemo(
    () => identifiedMedications.filter((medication: any) => {
      const { startDay, endDay } = medicationWindowDays(medication)
      if (!startDay && !endDay) return true
      return overlapsOverviewWindow(startDay, endDay, window)
    }),
    [identifiedMedications, window],
  )

  // 慢箋 is a property of the drug across its whole history, not of the
  // refills that happen to fall inside the window.
  const medicationRows = useMedicationRows(displayMedications, audience, locale, identifiedMedications)
  const { activeMedications, inactiveMedicationGroups } = useGroupedMedications(medicationRows)

  // Change detection reads the RAW prescriptions (every refill, including those
  // before the window) so "first ever record" and "dose before the window" are
  // real answers rather than window artefacts.
  const { medicationFacts, medicationDaysByRowId, medicationChangeKeyByRowId } = useMemo(() => {
    const inactiveStatuses = MEDICATION_INACTIVE_STATUSES
    const activeById = new Map<string, MedicationRow>()
    for (const row of medicationRows) activeById.set(row.id, row)
    const days = new Map<string, { startDay?: string; endDay?: string; supplyEndDay?: string }>()
    const changeKeys = new Map<string, string>()
    const facts = identifiedMedications.map((medication: any) => {
      // Ids are pinned above, so this round-trips whether or not the record
      // became a row. Dates stay raw ISO (never the locale-formatted display
      // strings) as the basis for every comparison.
      const rowId = medication.id
      const row = activeById.get(rowId)
      const dosage = medication?.dosageInstruction?.[0] || medication?.dosage?.[0]
      const dose = humanDoseAmount(dosage?.doseAndRate, dosage?.text)
      const frequency = displayDosageInstruction(dosage)
      const signature = [dose, frequency]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter((part) => part && part !== '—')
        .join(' · ')
      const status = typeof medication?.status === 'string'
        ? medication.status.toLowerCase()
        : ''
      const { startDay, endDay, supplyEndDay } = medicationWindowDays(medication, status)
      days.set(rowId, { startDay, endDay, supplyEndDay })
      const changeKey = medicationChangeIdentityKey(medication)
      changeKeys.set(rowId, changeKey)
      return {
        key: changeKey
          || (typeof medication?.medicationCodeableConcept?.text === 'string'
            ? medication.medicationCodeableConcept.text
            : rowId),
        startDay,
        endDay,
        // Prefer the row model's verdict — it already folds in an elapsed
        // supply window — and fall back to the raw status when a raw record
        // has no matching row (defensive; ids come from the same array).
        isActive: row ? !row.isInactive : !inactiveStatuses.has(status) && (!endDay || endDay >= window.endDay),
        dose: dose || undefined,
        frequency: frequency || undefined,
        doseSignature: signature || undefined,
      } satisfies OverviewMedFact
    })
    return {
      medicationFacts: facts,
      medicationDaysByRowId: days,
      medicationChangeKeyByRowId: changeKeys,
    }
  }, [identifiedMedications, medicationRows, window])

  const medChanges = useMemo(
    () => classifyMedicationChanges(medicationFacts, window),
    [medicationFacts, window],
  )

  const meds = useMemo<OverviewMedsData>(() => {
    // One row per therapy: the deduplicated active rows the 用藥 tab shows,
    // plus the newest fill of each drug that is no longer running.
    const candidates: MedicationRow[] = [...activeMedications]
    for (const group of inactiveMedicationGroups) {
      const newest = group.medications[0]
      if (newest) candidates.push(newest)
    }

    const items: OverviewMedItem[] = []
    for (const row of candidates) {
      const key = row.drugKey || row.title
      const change = medChanges.get(medicationChangeKeyByRowId.get(row.id) ?? key)
      const { startDay, endDay, supplyEndDay } = medicationDaysByRowId.get(row.id) ?? {}
      // A prescription belongs to this window when it was written inside it or
      // when its supply period still overlaps it (an ongoing chronic script).
      if (!overlapsOverviewWindow(startDay, endDay ?? startDay, window)) continue
      // Still running, or finished inside the recent tail (see the constant).
      // An undated record cannot be ruled out, so it counts as current.
      const finishedDay = endDay ?? startDay
      const excludedFromCurrent = row.currentnessUncertain || ['cancelled', 'entered-in-error', 'on-hold', 'draft', 'stopped', 'not-taken'].includes(row.status)
      const isCurrent = !excludedFromCurrent && (!row.isInactive || !finishedDay
        || daysBetween(finishedDay, window.endDay) <= MEDICATION_RECENTLY_FINISHED_DAYS)
      const doseText = [doseUnlessRepeated(row.dose, row.frequency), row.frequency]
        .filter((part) => part && part !== '—')
        .join(' · ')
      items.push({
        id: row.id,
        key,
        title: row.title,
        // 商品名, present only when it differs from the ingredient name. Two
        // different products can share one ingredient name — "永豐"生理食鹽水
        // and "濟生"氯化鈉 are both SODIUM CHLORIDE — so the rows are correct
        // but indistinguishable without it.
        secondaryTitle: row.secondaryTitle,
        doseText,
        category: row.category,
        institution: row.pharmacy,
        day: startDay,
        supplyEndDay,
        isChronic: row.isChronic,
        isInactive: row.isInactive,
        isCurrent,
        daysRemaining: excludedFromCurrent ? undefined : row.displayRemainingDays ?? row.daysRemaining,
        change,
        row,
      })
    }

    // Ongoing therapies precede finished/stopped therapies. Within each group,
    // show changes first, then the most recent prescription.
    items.sort((a, b) => {
      if (a.isInactive !== b.isInactive) return a.isInactive ? 1 : -1
      const aChanged = a.change ? 0 : 1
      const bChanged = b.change ? 0 : 1
      if (aChanged !== bChanged) return aChanged - bChanged
      return (b.day ?? '').localeCompare(a.day ?? '')
    })

    return {
      items,
      // The header counts what the default list shows, so it can never promise
      // more rows than the card is willing to render.
      count: items.filter((item) => item.isCurrent).length,
      changeCount: items.filter((item) => !!item.change).length,
    }
  }, [activeMedications, inactiveMedicationGroups, medChanges, medicationDaysByRowId, medicationChangeKeyByRowId, window])

  return { meds, medicationRows }
}
