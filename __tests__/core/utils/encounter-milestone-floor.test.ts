import { filterEncounterRecords } from '@/src/core/utils/clinical-context-selection.utils'

const enc = (id: string, start: string, code: string) => ({ id, class: { code }, period: { start } })

describe('filterEncounterRecords milestone floor', () => {
  const encounters = [
    enc('amb-new', '2026-08-25', 'AMB'),
    enc('amb-old', '2025-05-20', 'AMB'),
    enc('imp-old', '2025-05-18', 'IMP'),
    enc('emer-old', '2025-02-11', 'EMER'),
    enc('imp-ancient', '2022-08-08', 'IMP'),
  ]
  const data = { encounters }

  it('keeps admissions and ER visits within 24 months of the newest visit even outside a 6m window', () => {
    const kept = filterEncounterRecords(encounters, '6m', data).map((e) => e.id)
    expect(kept).toContain('amb-new')
    expect(kept).toContain('imp-old')
    expect(kept).toContain('emer-old')
    expect(kept).not.toContain('amb-old')
    expect(kept).not.toContain('imp-ancient')
  })

  it('leaves the all-time window untouched', () => {
    expect(filterEncounterRecords(encounters, 'all', data)).toHaveLength(5)
  })
})
