import {
  filterMedicationRecords,
  selectMedicationRecords,
} from '@/src/core/utils/clinical-context-selection.utils'

const med = (id: string, text: string, authoredOn: string, days: number) => ({
  id, status: 'unknown', authoredOn,
  medicationCodeableConcept: { text },
  dispenseRequest: { expectedSupplyDuration: { value: days, unit: 'd' } },
})

describe('filterMedicationRecords latest-known floor', () => {
  const now = Date.parse('2026-06-15')
  const filters: any = { medicationStatus: 'active', medicationChronic: 'all', medicationTimeRange: '6m' }
  const data = { encounters: [{ period: { start: '2026-06-15' } }] }

  it('adds recently dispensed lapsed medicines when nothing is current', () => {
    const meds = [
      med('a', 'Chemo premed A', '2026-04-01', 3),
      med('b', 'Antiemetic B', '2026-03-20', 5),
      med('c', 'Antiemetic B', '2026-01-10', 5),
      med('d', 'Ancient drug', '2023-01-10', 5),
    ]
    const ids = filterMedicationRecords(meds, filters, data, now).map((m) => m.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('does not engage when enough medicines are current', () => {
    const meds = Array.from({ length: 6 }, (_, i) => med(`cur${i}`, `Drug ${i}`, '2026-06-01', 90))
    meds.push(med('lapsed', 'Old drug', '2026-02-01', 3))
    const ids = filterMedicationRecords(meds, filters, data, now).map((m) => m.id)
    expect(ids).not.toContain('lapsed')
    expect(ids).toHaveLength(6)
  })

  // The AI medication section has to LABEL the floor rows differently from the
  // current ones, so the split has to be readable — not re-derived from the
  // flat list by a second copy of the rule.
  it('reports which records the floor added, without changing the flat list', () => {
    const meds = [
      med('a', 'Chemo premed A', '2026-04-01', 3),
      med('b', 'Antiemetic B', '2026-03-20', 5),
      med('c', 'Ancient drug', '2023-01-10', 5),
    ]
    const split = selectMedicationRecords(meds, filters, data, now)
    expect(split.selected).toEqual([])
    expect(split.floor.map((m) => m.id)).toEqual(['a', 'b'])
    expect(filterMedicationRecords(meds, filters, data, now)).toEqual([...split.selected, ...split.floor])
  })

  it('reports no floor records when enough medicines are current', () => {
    const meds = Array.from({ length: 6 }, (_, i) => med(`cur${i}`, `Drug ${i}`, '2026-06-01', 90))
    meds.push(med('lapsed', 'Old drug', '2026-02-01', 3))
    expect(selectMedicationRecords(meds, filters, data, now).floor).toEqual([])
  })

  it('never engages when the user is not filtering to 使用中', () => {
    const meds = [med('a', 'Chemo premed A', '2026-04-01', 3)]
    const allFilters: any = { ...filters, medicationStatus: 'all' }
    expect(selectMedicationRecords(meds, allFilters, data, now).floor).toEqual([])
  })
})
