import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'

// Shapes from 雲端病歷 exports (values synthetic): the bridge ships amylase
// (09017C) and lipase (09064C) with their LOINCs, but 生化 recognised neither,
// so both fell to 其他 — which the cumulative report never shows.
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
let seq = 0
const enzyme = (text: string, loinc: string, nhi: string, value: number) => ({
  resourceType: 'Observation', id: `panc-${seq++}`, status: 'final', effectiveDateTime: '2026-04-04',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text, coding: [{ system: 'http://loinc.org', code: loinc }, { system: NHI, code: nhi }] },
  valueQuantity: { value, unit: 'U/L' },
})
const amylase = enzyme('澱粉脢、血 ;(Amylase (B))', '1798-8', '09017C', 71)
const lipase = enzyme('解脂酶 ;(Lipase)', '3040-3', '09064C', 38)

it('files amylase and lipase under 生化', () => {
  expect(categorizeObservation(amylase)?.id).toBe('chem')
  expect(categorizeObservation(lipase)?.id).toBe('chem')
})

it('gives each its own column in a pancreatic-enzyme group', () => {
  const rows = buildLabPivots([amylase, lipase]).chem.rows
  const row = (key: string) => rows.find(r => r.testKey === key)
  expect(row('AMYLASE')?.values.get('2026-04-04')?.value).toBe('71')
  expect(row('LIPASE')?.values.get('2026-04-04')?.value).toBe('38')
  expect(row('AMYLASE')?.subgroupId).toBe('pancEnzyme')
  expect(row('LIPASE')?.subgroupId).toBe('pancEnzyme')
})

it('labels the amylase column for clinicians', () => {
  const row = buildLabPivots([amylase]).chem.rows.find(r => r.testKey === 'AMYLASE')!
  expect(getLabRowDisplayParts(row, 'medical', 'en').name).toBe('Amylase')
})
