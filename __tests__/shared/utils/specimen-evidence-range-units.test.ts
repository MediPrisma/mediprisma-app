// The inspect mode counts only with a reference range that agrees with it,
// and that range must be read in its OWN unit. A serum range in mmol/L
// (Ca 2.1–2.6) beside a mg/dL value is not a "urine-like" range. Sweep:
// analyte × value unit × reference-range unit form × inspect mode — a serum
// result never moves to 尿液 because of a unit mismatch.
import { categorizeObservation } from '@/src/shared/utils/lab-categories'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const INSPECT = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-inspect-mode'

type Range = { text?: string; low?: { value: number; unit?: string }; high?: { value: number; unit?: string } }
function row(item: string, nhi: string, value: number, unit: string, range: Range | undefined, inspect?: string) {
  return {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [{ system: NHI, code: nhi }] },
    valueQuantity: { value, unit },
    ...(range ? { referenceRange: [range] } : {}),
    ...(inspect ? { extension: [{ url: INSPECT, valueString: inspect }] } : {}),
    effectiveDateTime: '2026-10-01T08:00:00+08:00',
  }
}

// Serum reference ranges of each analyte in the units labs print them in.
const SERUM_RANGES: Record<string, { item: string; nhi: string; ranges: Array<[number, number, string]> }> = {
  CA: { item: 'Ca', nhi: '09011C', ranges: [[8.5, 10.5, 'mg/dL'], [2.1, 2.6, 'mmol/L']] },
  CREA: { item: 'Creatinine', nhi: '09015C', ranges: [[0.6, 1.2, 'mg/dL'], [53, 106, 'µmol/L'], [53, 106, 'umol/L'], [0.053, 0.106, 'mmol/L']] },
  TP: { item: 'TP', nhi: '09040C', ranges: [[6, 8.3, 'g/dL'], [60, 83, 'g/L'], [6000, 8300, 'mg/dL']] },
  ALB: { item: 'Albumin', nhi: '09038C', ranges: [[3.5, 5, 'g/dL'], [35, 50, 'g/L']] },
}
const VALUE_UNITS = ['mg/dL', 'mmol/L', 'µmol/L', 'g/L', 'g/dL']
const MODES = ['URINE(SPOT)', '尿液', 'SERUM_YL', undefined]

describe('serum results never move to 尿液 through a reference-range unit mismatch', () => {
  const cases: Array<[string, any]> = []
  for (const { item, nhi, ranges } of Object.values(SERUM_RANGES)) {
    for (const valueUnit of VALUE_UNITS) {
      for (const [low, high, rangeUnit] of ranges) {
        const forms: Array<[string, Range]> = [
          [`range ${rangeUnit}`, { low: { value: low, unit: rangeUnit }, high: { value: high, unit: rangeUnit } }],
          ['range without unit', { low: { value: low }, high: { value: high } }],
          ['text range', { text: `[${low}~${high}]` }],
          ['text range with unit', { text: `${low}-${high} ${rangeUnit}` }],
        ]
        for (const [form, range] of forms) {
          for (const mode of MODES) {
            cases.push([`${item} ${valueUnit}, serum ${form} (${low}–${high} ${rangeUnit}), mode ${mode ?? 'none'}`, row(item, nhi, 5, valueUnit, range, mode)])
          }
        }
      }
      for (const mode of MODES) cases.push([`${item} ${valueUnit}, no range, mode ${mode ?? 'none'}`, row(item, nhi, 5, valueUnit, undefined, mode)])
    }
  }
  it(`holds for all ${cases.length} combinations`, () => {
    const failures = cases.filter(([, o]) => categorizeObservation(o)?.id === 'urine').map(([name]) => name)
    expect(failures).toEqual([])
  })
})

describe('a urine reference range in its own stated unit still supports a urine inspect mode', () => {
  it.each([
    ['Creatinine', '09015C', 85, 'mg/dL', { low: { value: 20, unit: 'mg/dL' }, high: { value: 300, unit: 'mg/dL' } }],
    ['Creatinine', '09015C', 7500, 'µmol/L', { low: { value: 1768, unit: 'µmol/L' }, high: { value: 26520, unit: 'µmol/L' } }],
    ['Ca', '09011C', 12, 'mg/dL', { high: { value: 20, unit: 'mg/dL' } }],
    ['Ca', '09011C', 3, 'mmol/L', { high: { value: 5, unit: 'mmol/L' } }],
  ] as Array<[string, string, number, string, Range]>)('%s %s %s', (item, nhi, value, unit, range) => {
    expect(categorizeObservation(row(item, nhi, value, unit, range, 'URINE(SPOT)'))?.id).toBe('urine')
  })
})
