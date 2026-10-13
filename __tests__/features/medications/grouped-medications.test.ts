// Active-medication merge rules — 慢箋 early refill produces two ACTIVE
// MedicationRequests for the SAME ongoing prescription (same drug, same
// institution, overlapping windows). One card, covering to the latest end.
// The load-bearing counterpart: same drug from DIFFERENT institutions is a
// potential duplicate-therapy / 重複就醫 signal and must NEVER be merged.

import { groupMedications } from '@/features/clinical-summary/medications/hooks/useGroupedMedications'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

let seq = 0
function row(over: Partial<MedicationRow>): MedicationRow {
  seq += 1
  return {
    id: `mr-${seq}`,
    title: over.title ?? `Drug ${seq}`,
    status: 'active',
    isInactive: false,
    isChronic: true,
    refillCount: 1,
    searchHaystack: '',
    ...over,
  } as MedicationRow
}

beforeEach(() => {
  seq = 0
})

describe('groupMedications — active-list merge', () => {
  it('merges same-drug SAME-institution overlapping actives into one row (latest coverage wins)', () => {
    // The reported case: eye drops 6/10→7/8 still active + early refill 7/1→7/29.
    const old = row({ title: '舒而坦 眼藥水', pharmacy: '示範嘉恩醫院', startedOn: '2026-06-10', endDate: '2026-07-08' })
    const renew = row({ title: '舒而坦 眼藥水', pharmacy: '示範嘉恩醫院', startedOn: '2026-07-01', endDate: '2026-07-29' })
    const { activeMedications } = groupMedications([old, renew])
    expect(activeMedications).toHaveLength(1)
    expect(activeMedications[0].endDate).toBe('2026-07-29') // 剩X天 covers to the latest end
    expect(activeMedications[0].overlapCount).toBe(1)       // drives the 已續領 chip
  })

  it('FOLDS a pharmacy dispensing into the prescribing clinic (藥局 ≠ duplicate)', () => {
    // 便通樂: prescribed at 嘉恩醫院 (門診), released at 康健藥局 (藥局). One Rx.
    const hosp = row({ title: '便通樂膜衣錠', pharmacy: '示範嘉恩醫院', startedOn: '2026-06-25', endDate: '2026-07-23' })
    const pharm = row({ title: '便通樂膜衣錠', pharmacy: '示範康健藥局', startedOn: '2026-06-25', endDate: '2026-07-23' })
    const { activeMedications } = groupMedications([hosp, pharm])
    expect(activeMedications).toHaveLength(1)
    expect(activeMedications[0].pharmacy).toBe('示範嘉恩醫院') // names the prescriber, not the pharmacy
    expect(activeMedications[0].overlapCount).toBe(0) // pharmacy pickup ≠ 續領, no chip
  })

  it('KEEPS same drug from TWO DIFFERENT CLINICS as separate rows (real 重複用藥)', () => {
    const clinicA = row({ title: '普拿疼', pharmacy: '示範長青醫院', startedOn: '2026-06-20', endDate: '2026-07-20' })
    const clinicB = row({ title: '普拿疼', pharmacy: '示範嘉恩醫院', startedOn: '2026-06-25', endDate: '2026-07-23' })
    const { activeMedications } = groupMedications([clinicA, clinicB])
    expect(activeMedications).toHaveLength(2)
    expect(activeMedications.map((m) => m.pharmacy).sort()).toEqual(['示範嘉恩醫院', '示範長青醫院'])
  })

  it('shows a pharmacy-only active drug (its prescribing visit is older/inactive)', () => {
    const pharm = row({ title: '葉酸膜衣錠', pharmacy: '示範康健藥局', startedOn: '2026-06-25', endDate: '2026-07-23' })
    const { activeMedications } = groupMedications([pharm])
    expect(activeMedications).toHaveLength(1)
    expect(activeMedications[0].overlapCount).toBe(0)
  })

  it('picks the latest fill even with DISPLAY-formatted non-padded dates (7/29 vs 7/8)', () => {
    // Real MedicationRow dates come out of formatDate() → "2026/7/8" style.
    // Lexicographically "2026/7/29" < "2026/7/8", so a string compare picks
    // the WRONG (old) fill — this pins the timestamp-based comparison.
    const old = row({ title: '派滴兒點眼液', pharmacy: '示範嘉恩醫院', startedOn: '2026/6/10', endDate: '2026/7/8' })
    const renew = row({ title: '派滴兒點眼液', pharmacy: '示範嘉恩醫院', startedOn: '2026/7/1', endDate: '2026/7/29' })
    const { activeMedications } = groupMedications([old, renew])
    expect(activeMedications).toHaveLength(1)
    expect(activeMedications[0].endDate).toBe('2026/7/29')
    expect(activeMedications[0].startedOn).toBe('2026/7/1')
  })

  it('does not merge different drugs from the same institution', () => {
    const a = row({ title: '加斯克兒錠', pharmacy: '示範嘉恩醫院', endDate: '2026-07-23' })
    const b = row({ title: '非潰膜衣錠', pharmacy: '示範嘉恩醫院', endDate: '2026-07-23' })
    expect(groupMedications([a, b]).activeMedications).toHaveLength(2)
  })

  it('does not merge distinct products that share the same ingredient title', () => {
    const a = row({
      drugKey: 'NHI-A',
      title: 'DAPAGLIFLOZIN 10 MG',
      secondaryTitle: 'FORXIGA 10MG',
      pharmacy: 'A院',
    })
    const b = row({
      drugKey: 'NHI-B',
      title: 'DAPAGLIFLOZIN 10 MG',
      secondaryTitle: 'ANOTHER PRODUCT 10MG',
      pharmacy: 'A院',
    })

    expect(groupMedications([a, b]).activeMedications).toHaveLength(2)
  })

  it('treats a missing institution as its own bucket (no cross-merge with named orgs)', () => {
    const named = row({ title: 'X藥', pharmacy: 'A院', endDate: '2026-07-23' })
    const bare = row({ title: 'X藥', pharmacy: undefined, endDate: '2026-07-29' })
    expect(groupMedications([named, bare]).activeMedications).toHaveLength(2)
  })

  it('keeps the merged row at the first-seen list position (stable ordering)', () => {
    const first = row({ title: 'A藥', pharmacy: 'A院', endDate: '2026-07-08' })
    const mid = row({ title: 'B藥', pharmacy: 'A院', endDate: '2026-07-10' })
    const renewOfFirst = row({ title: 'A藥', pharmacy: 'A院', endDate: '2026-07-29' })
    const { activeMedications } = groupMedications([first, mid, renewOfFirst])
    expect(activeMedications.map((m) => m.title)).toEqual(['A藥', 'B藥'])
    expect(activeMedications[0].endDate).toBe('2026-07-29')
  })

  it('inactive rows are untouched by the merge (history keeps every fill)', () => {
    const oldFill = row({ title: 'C藥', pharmacy: 'A院', isInactive: true, startedOn: '2026-01-01' })
    const newFill = row({ title: 'C藥', pharmacy: 'A院', isInactive: true, startedOn: '2026-03-01' })
    const g = groupMedications([oldFill, newFill])
    expect(g.activeMedications).toHaveLength(0)
    expect(g.inactiveMedicationGroups).toHaveLength(1)
    expect(g.inactiveMedicationGroups[0].count).toBe(2) // both fills preserved
  })

  it('attaches prior fills to the current row and removes the duplicate history group', () => {
    const current = row({
      title: 'LEVOTHYROXINE SODIUM .05 MG',
      drugKey: 'NHI-LEVOTHYROXINE',
      id: 'current-levothyroxine',
    })
    const prior = row({
      title: 'LEVOTHYROXINE SODIUM .05 MG',
      drugKey: 'NHI-LEVOTHYROXINE',
      isInactive: true,
      startedOn: '2026-07-06',
    })

    const grouped = groupMedications([current, prior])

    expect(grouped.activeHistoryByMedicationId.get('current-levothyroxine')).toMatchObject({
      key: 'NHI-LEVOTHYROXINE',
      count: 1,
      medications: [prior],
    })
    expect(grouped.inactiveMedicationGroups).toEqual([])
  })

  it('gives shared drug history to every current row when two clinics prescribe it', () => {
    // Each row shows the drug's refill count, so each can open what it counts
    // (MedicationList keeps one of them as the navigation owner).
    const clinicA = row({
      title: '普拿疼',
      drugKey: 'NHI-PANADOL',
      pharmacy: 'A院',
      id: 'active-a',
    })
    const clinicB = row({
      title: '普拿疼',
      drugKey: 'NHI-PANADOL',
      pharmacy: 'B院',
      id: 'active-b',
    })
    const prior = row({
      title: '普拿疼',
      drugKey: 'NHI-PANADOL',
      isInactive: true,
    })

    const grouped = groupMedications([clinicA, clinicB, prior])

    expect(grouped.activeHistoryByMedicationId.size).toBe(2)
    expect(grouped.activeHistoryByMedicationId.get('active-a')?.medications).toEqual([prior])
    expect(grouped.activeHistoryByMedicationId.get('active-b'))
      .toBe(grouped.activeHistoryByMedicationId.get('active-a'))
    expect(grouped.inactiveMedicationGroups).toEqual([])
  })

  it('gives same-named inactive product groups distinct stable keys', () => {
    const first = row({
      drugKey: 'NHI-BRIMONIDINE-A',
      title: 'BRIMONIDINE TARTRATE 1.5 MG/ML',
      isInactive: true,
    })
    const second = row({
      drugKey: 'NHI-BRIMONIDINE-B',
      title: 'BRIMONIDINE TARTRATE 1.5 MG/ML',
      isInactive: true,
    })

    const { inactiveMedicationGroups } = groupMedications([first, second])

    expect(inactiveMedicationGroups).toHaveLength(2)
    expect(inactiveMedicationGroups.map((group) => group.name)).toEqual([
      'BRIMONIDINE TARTRATE 1.5 MG/ML',
      'BRIMONIDINE TARTRATE 1.5 MG/ML',
    ])
    expect(inactiveMedicationGroups.map((group) => group.key)).toEqual([
      'NHI-BRIMONIDINE-A',
      'NHI-BRIMONIDINE-B',
    ])
  })
})
