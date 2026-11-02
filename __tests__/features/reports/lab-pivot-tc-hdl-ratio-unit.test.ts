import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'

// Some hospitals upload the total-cholesterol/HDL ratio with a mg/dL unit
// (雲端病歷 export, 2026-11-03), and the 血脂 column header read "TC/HDL mg/dL".
// A ratio has no unit. Values are synthetic.
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
let seq = 0
const lipid = (text: string, loinc: string, value: number, unit: string, date = '2026-04-04') => ({
  resourceType: 'Observation', id: `lipid-${seq++}`, status: 'final', effectiveDateTime: date,
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text, coding: [{ system: 'http://loinc.org', code: loinc }, { system: NHI, code: '09043C' }] },
  valueQuantity: { value, unit },
})

it('shows the TC/HDL ratio without the source mass unit', () => {
  const rows = buildLabPivots([
    lipid('Total Cholesterol/HDL-C Ratio', '9830-1', 3.2, 'mg/dL'),
    lipid('Total Cholesterol/HDL-C Ratio', '9830-1', 3.6, 'mg/dL', '2026-01-04'),
    lipid('HDL-C', '2085-9', 52, 'mg/dL'),
  ]).lipid.rows
  const ratio = rows.find(r => r.testKey === 'TC/HDL RATIO')!
  expect(ratio.unit).toBeUndefined()
  expect(ratio.values.get('2026-04-04')).toMatchObject({ value: '3.2', unit: undefined })
  expect(ratio.trendChartable).toBe(true)
  // Real concentrations keep their unit.
  expect(rows.find(r => r.testKey === 'HDL')?.unit).toBe('mg/dL')
})
