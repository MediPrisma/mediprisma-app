import { formatSourceList } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'

const med = (key: string, display: string, date: string, medicationClass?: string): SummarySourceCatalogEntry => ({
  key, resourceType: 'MedicationRequest', resourceId: `r-${key}`, display, date, organization: '示範藥局',
  ...(medicationClass ? { medicationClass } : {}),
})

describe('formatSourceList', () => {
  it('lists one line per medicine, by ATC class, with its earlier fills — never a dispensing day as a run of keys', () => {
    const text = formatSourceList([
      { key: 'E1', resourceType: 'Encounter', resourceId: 'e1', display: '門診', date: '2026-08-27' },
      // One refill day: eye drops and a dementia medicine side by side.
      med('M1', 'DEMO-XALA EYE DROPS', '2026-08-27', 'latanoprost · S01E ANTIGLAUCOMA PREPARATIONS AND MIOTICS'),
      med('M2', 'DEMO-DONE TABLETS 5MG', '2026-08-27', 'donepezil · N06D ANTI-DEMENTIA DRUGS'),
      med('M3', 'DEMO-XALA EYE DROPS', '2026-07-27', 'latanoprost · S01E ANTIGLAUCOMA PREPARATIONS AND MIOTICS'),
      { key: 'L1', resourceType: 'DiagnosticReport', resourceId: 'l1', display: 'Chest X-ray', date: '2026-06-02' },
    ])
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^\[E1\]/)
    expect(lines[1]).toMatch(/^\[M2\] .*donepezil · N06D/)
    expect(lines[2]).toMatch(/^\[M1\] .*latanoprost · S01E .*earlier fills: M3$/)
    expect(lines[3]).toMatch(/^\[L1\]/)
    expect(lines).toHaveLength(4)
  })
})
