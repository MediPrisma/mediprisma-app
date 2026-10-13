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
export function groupMedications(medications: MedicationRow[]) {
  const activeRaw: MedicationRow[] = []
  const inactiveByKey = new Map<string, { name: string; medications: MedicationRow[] }>()
  const groupKeyOf = (medication: MedicationRow): string =>
    medication.drugKey || medication.title

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

  // ── Collapse duplicate-looking actives into real therapies ──────────────
  // 健保存摺 can carry several ACTIVE MedicationRequests that are really ONE
  // ongoing therapy:
  //   • 慢箋 early refill — the SAME clinic's next fill starts before the
  //     current one ends (eye drops 6/10→7/8 AND 7/1→7/29).
  //   • Pharmacy dispensing — a 社區藥局 RELEASES a 慢箋 the clinic
  //     prescribed. The 藥局 didn't prescribe anything; it's the same Rx being
  //     picked up (便通樂: 嘉恩醫院門診 + 康健藥局釋出).
  // The ONLY genuine duplicate-therapy / 重複用藥 signal is the same drug
  // prescribed by TWO DIFFERENT CLINICS — that stays as separate rows.
  //
  // So: group by drug, treat pharmacies as dispensers (not prescribers), and
  // emit ONE row per distinct PRESCRIBING clinic (folding in that clinic's
  // renewals + any pharmacy dispensing). A drug seen only at a pharmacy (its
  // prescribing visit is older/inactive) still shows — the dispensing is its
  // only active record.
  const isPharmacy = (inst?: string): boolean => /藥局|藥房/.test(inst ?? '')
  // endDate / startedOn are DISPLAY-formatted ("2026/7/8", non-zero-padded),
  // so lexicographic compare mis-orders them ("7/29" < "7/8") — parse to ms.
  const coverageTs = (m: MedicationRow): number => {
    const v = m.endDate || m.startedOn
    const ms = v ? new Date(v).getTime() : NaN
    return Number.isNaN(ms) ? -Infinity : ms
  }
  // Representative fill = furthest future coverage (its 剩X天 answers "how long
  // am I covered?"); on a tie prefer a prescriber over a pharmacy so the row
  // names the clinic.
  const representative = (fills: MedicationRow[]): MedicationRow =>
    [...fills].sort((a, b) => {
      const c = coverageTs(b) - coverageTs(a)
      if (c !== 0) return c
      return (isPharmacy(a.pharmacy) ? 1 : 0) - (isPharmacy(b.pharmacy) ? 1 : 0)
    })[0]

  const byDrug = new Map<string, MedicationRow[]>()
  for (const m of activeRaw) {
    const key = groupKeyOf(m)
    const arr = byDrug.get(key)
    if (arr) arr.push(m)
    else byDrug.set(key, [m])
  }
  const emittedDrugs = new Set<string>()
  const active: MedicationRow[] = []
  for (const m of activeRaw) {
    const key = groupKeyOf(m)
    if (emittedDrugs.has(key)) continue
    emittedDrugs.add(key)
    const fills = byDrug.get(key)!
    const prescriberFills = fills.filter((f) => !isPharmacy(f.pharmacy))
    const prescribers = [...new Set(prescriberFills.map((f) => (f.pharmacy ?? '').trim()))]

    if (prescribers.length <= 1) {
      // One therapy: a single clinic (± its renewals) + any pharmacy pickup,
      // or pharmacy-only. overlapCount flags the 已續領 chip ONLY for a genuine
      // same-clinic early refill — a pharmacy pickup is normal 領藥, merged
      // silently.
      active.push({ ...representative(fills), overlapCount: Math.max(0, prescriberFills.length - 1) })
    } else {
      // Two+ clinics prescribed the same drug → real 重複用藥: one row per
      // clinic (each with its own renewals). Pharmacy pickups dispense one of
      // these, so they don't add rows.
      for (const name of prescribers) {
        const own = prescriberFills.filter((f) => (f.pharmacy ?? '').trim() === name)
        active.push({ ...representative(own), overlapCount: own.length - 1 })
      }
    }
  }

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
