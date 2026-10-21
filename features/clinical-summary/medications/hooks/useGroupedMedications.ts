// Custom Hook: Group Medications
import { useMemo } from 'react'
import type { MedicationRow } from '../types'

export interface MedicationGroup {
  name: string
  activeMedications: MedicationRow[]
  inactiveMedications: MedicationRow[]
}

export interface MedicationHistoryGroup {
  /** Stable drug/product identity shared with the active row. */
  key: string
  name: string
  count: number
  /** Newest-first historical prescriptions. */
  medications: MedicationRow[]
}

/** Pure grouping logic — exported for direct unit testing (the hook is just
 *  a useMemo wrapper). */
/** The drug a row belongs to. History groups retain every source order. */
export function medicationGroupKey(medication: MedicationRow): string {
  return medication.drugKey || medication.title
}

export function groupMedications(medications: MedicationRow[]) {
  const activeRaw: MedicationRow[] = []
  const inactiveByKey = new Map<string, { name: string; medications: MedicationRow[] }>()
  const groupKeyOf = medicationGroupKey

  medications.forEach((med) => {
    if (med.isInactive) {
      const key = groupKeyOf(med)
      const existing = inactiveByKey.get(key)
      if (existing) {
        existing.medications.push(med)
      } else {
        inactiveByKey.set(key, { name: med.title, medications: [med] })
      }
    } else {
      activeRaw.push(med)
    }
  })

  // Only import reconciliation can prove two source records describe the same
  // order. A renewal, pharmacy fill or second identical same-visit order must
  // remain inspectable; a shared drug/clinic/regimen never deletes its row.
  const active = activeRaw.map((medication) => ({ ...medication, overlapCount: 0 }))

  // Sort inactive fills newest first within each group. medications[0] is the
  // group's representative (row shown, visit banding), so compare calendar
  // days — the display strings are locale-formatted and not zero-padded
  // ("2026/9/30" > "2026/10/1" as text).
  const startDayTs = (m: MedicationRow): number => {
    if (m.startedOnIso) return Date.parse(`${m.startedOnIso}T00:00:00Z`)
    const ms = m.startedOn ? new Date(m.startedOn).getTime() : NaN
    return Number.isNaN(ms) ? -Infinity : ms
  }
  inactiveByKey.forEach((group) => {
    group.medications.sort((a, b) => {
      const byStart = startDayTs(b) - startDayTs(a)
      if (byStart !== 0 && !Number.isNaN(byStart)) return byStart
      return (b.endDateIso || '').localeCompare(a.endDateIso || '')
    })
  })

  const historyGroups = Array.from(
    inactiveByKey.entries(),
    ([key, { name, medications }]): MedicationHistoryGroup => ({
      key,
      name,
      count: medications.length,
      medications,
    }),
  )

  // When the same product has a current prescription, its older fills belong
  // to that current therapy row, and leave the separate stopped-medication
  // section so the drug is not listed twice. When two clinics currently
  // prescribe the same drug, every current row gets the same history: each
  // shows the drug's refill count, so each must be able to open what it
  // counts. The list keeps one of them as the navigation owner.
  const activeHistoryByMedicationId = new Map<string, MedicationHistoryGroup>()
  const attachedHistoryKeys = new Set<string>()
  const historyByKey = new Map(historyGroups.map((group) => [group.key, group]))
  for (const medication of active) {
    const key = groupKeyOf(medication)
    const history = historyByKey.get(key)
    if (!history) continue
    activeHistoryByMedicationId.set(medication.id, history)
    attachedHistoryKeys.add(key)
  }

  return {
    activeMedications: active,
    activeHistoryByMedicationId,
    inactiveMedicationGroups: historyGroups.filter(
      (group) => !attachedHistoryKeys.has(group.key),
    ),
  }
}

export function useGroupedMedications(medications: MedicationRow[]) {
  return useMemo(() => groupMedications(medications), [medications])
}
