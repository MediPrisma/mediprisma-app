import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { DEFAULT_DATA_FILTERS, DEFAULT_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'

const obs = (id: string, date: string, text: string, value: number, unit: string) => ({
  id, resourceType: 'Observation', status: 'final',
  code: { text, coding: [{ system: 'http://loinc.org', code: text === 'Platelet' ? '777-3' : '2160-0', display: text }] },
  effectiveDateTime: `${date}T08:00:00Z`,
  valueQuantity: { value, unit },
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
})
const report = (id: string, date: string, text: string) => ({
  id, resourceType: 'DiagnosticReport', status: 'final',
  code: { text },
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
  effectiveDateTime: `${date}T08:00:00Z`,
  conclusion: `finding of ${text}`,
})

describe('first-visit floors in the AI scope', () => {
  it('keeps the latest prescribing analyte from outside the lab window (within 24 months)', () => {
    const input: any = {
      encounters: [{ id: 'e1', class: { code: 'AMB' }, period: { start: '2026-07-01' } }],
      observations: [
        obs('crea-new', '2026-06-20', 'Creatinine', 1.1, 'mg/dL'),
        obs('plt-old', '2025-11-05', 'Platelet', 96, '10*3/uL'),
        obs('plt-ancient', '2023-01-05', 'Platelet', 250, '10*3/uL'),
      ],
    }
    const scoped = scopeClinicalDataForAi(input, DEFAULT_DATA_SELECTION, DEFAULT_DATA_FILTERS, [], Date.parse('2026-07-01'))
    const ids = (scoped.observations ?? []).map((o: any) => o.id)
    expect(ids).toContain('crea-new')
    expect(ids).toContain('plt-old')
    expect(ids).not.toContain('plt-ancient')
  })

  it('keeps the latest report per modality class from outside the imaging window', () => {
    const input: any = {
      encounters: [{ id: 'e1', class: { code: 'AMB' }, period: { start: '2026-07-01' } }],
      diagnosticReports: [
        report('cxr-new', '2026-06-01', '胸腔檢查'),
        report('ct-old', '2025-03-01', '電腦斷層造影－有造影劑'),
        report('ct-older', '2024-12-01', '電腦斷層造影－有造影劑'),
        report('mri-ancient', '2023-01-01', '磁振造影'),
      ],
    }
    const scoped = scopeClinicalDataForAi(input, DEFAULT_DATA_SELECTION, DEFAULT_DATA_FILTERS, [], Date.parse('2026-07-01'))
    const ids = (scoped.diagnosticReports ?? []).map((r: any) => r.id)
    expect(ids).toContain('cxr-new')
    expect(ids).toContain('ct-old')
    expect(ids).not.toContain('ct-older')
    expect(ids).not.toContain('mri-ancient')
  })
})
