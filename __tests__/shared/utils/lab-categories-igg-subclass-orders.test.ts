// IgG subclass NHI orders, verified 2026-10-10 against the NHI fee schedule
// (醫療服務給付項目及支付標準, data.gov.tw 174450) and TW Core
// medical-service-payment-tw: 12146B IgG1, 12147B IgG2, 12148B IgG3, 12149B
// IgG4 — each a single analyte — and 08107B G型免疫球蛋白次群定量, the panel
// of all four, billed in the 08 (hematology) section. 12103B is serum
// immunoelectrophoresis; 09040C 全蛋白 is total protein of any specimen.
import { categorizeObservation, categorizeObservationWithReason, LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOCAL = 'https://cloud-wildcatch.invalid/fhir/upstream-local/CodeSystem/his-local-lab'

function obs(item: string, nhi: string, value: number | string = 512, extra: Record<string, any> = {}) {
  return {
    resourceType: 'Observation',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [{ system: NHI, code: nhi, display: '示例醫令' }, { system: LOCAL, code: item, display: item }] },
    ...(typeof value === 'number' ? { valueQuantity: { value, unit: 'mg/dL' } } : { valueString: value }),
    effectiveDateTime: '2026-10-01T08:00:00+08:00',
    ...extra,
  }
}

function placement(o: any): string {
  const id = categorizeObservation(o)?.id ?? 'none'
  return id === 'immuno' ? `immuno/${getLabPivotTestIdentity(o, 'immuno').testKey}` : id
}

const immuno = LAB_CATEGORIES.find((c) => c.id === 'immuno')!

describe('IgG subclass orders', () => {
  it('lists every single-subclass order and the 08107B panel as immunology orders', () => {
    for (const code of ['12146B', '12147B', '12148B', '12149B', '08107B']) {
      expect(immuno.nhiOrderCodes).toContain(code)
    }
  })

  it.each([
    ['12146B', 'IgG1', 'IGG1'], ['12147B', 'IgG2', 'IGG2'], ['12148B', 'IgG3', 'IGG3'], ['12149B', 'IgG4', 'IGG4'],
    ['12146B', '免疫球蛋白G1量', 'IGG1'], ['12149B', '免疫球蛋白G4量', 'IGG4'],
  ])('%s %s → %s', (code, item, key) => {
    expect(placement(obs(item, code))).toBe(`immuno/${key}`)
    expect(categorizeObservationWithReason(obs(item, code)).decidedBy).toBe('code')
  })

  it.each([
    ['IgG1', 'IGG1'], ['IgG2', 'IGG2'], ['IgG3', 'IGG3'], ['IgG4', 'IGG4'],
    ['IgG subclass 2', 'IGG2'], ['免疫球蛋白G3', 'IGG3'],
  ])('08107B (an 08-section order) row %s lands in 免疫 / %s, not 血液', (item, key) => {
    const row = obs(item, '08107B')
    expect(placement(row)).toBe(`immuno/${key}`)
    // A qualitative-looking result does not send it to 尿液 or 血液 either.
    expect(placement(obs(item, '08107B', 'Normal'))).toBe(`immuno/${key}`)
  })

  it.each(['IgG1', 'IgG2', 'IgG3'])('a 12149B row labelled %s never lands in the IgG4 column', (item) => {
    expect(placement(obs(item, '12149B'))).not.toBe('immuno/IGG4')
  })

  it('still refuses an immunology name under another 08-section order', () => {
    expect(placement(obs('IgG', '08011C'))).not.toMatch(/^immuno/)
  })
})

describe('related verified orders', () => {
  it('keeps 12103B serum immunoelectrophoresis out of the immunoglobulin columns', () => {
    for (const item of ['IgG', 'IgA', 'IgM', 'Kappa', 'Lambda']) {
      expect(placement(obs(item, '12103B'))).not.toMatch(/^immuno\/IG/)
    }
  })

  it('decides 09040C 全蛋白 by name or specimen, never by the code alone', () => {
    expect(categorizeObservation(obs('Total protein', '09040C', 7.1))?.id).toBe('chem')
    expect(categorizeObservation(obs('全蛋白', '09040C', 7.1))?.id).toBe('chem')
    expect(categorizeObservation(obs('全蛋白', '09040C', 15, { specimen: { display: 'Urine' } }))?.id).toBe('urine')
    expect(categorizeObservation(obs('Total protein', '09040C', 15, { specimen: { display: 'Urine' } }))?.id).toBe('urine')
    expect(categorizeObservation(obs('PROT(SPOT)', '09040C', 15))?.id).toBe('urine')
  })
})

// 12111C 微量白蛋白 sits in section 12, not 06, yet a spot-urine name already
// says urine. The exception must accept the names' resolved aliases (MALB,
// ACR), not only the literal spellings — whichever bridge wrote the code.
describe('12111C microalbumin names reach 尿液 under either NHI system', () => {
  const HEALTHBANK = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
  it.each([
    'Microalbumin', 'Microalbumin/Creatinine ratio', '微白蛋白', 'Microalbumin (urine)', 'MALB', 'UACR', 'ACR',
    'Alb/Cr ratio', '微白蛋白/肌酸酐比值', 'CALB(SPOT)',
  ])('%s', (item) => {
    const medcloud = obs(item, '12111C', 20)
    const healthbank = { ...medcloud, code: { ...medcloud.code, coding: [{ system: HEALTHBANK, code: '12111C' }] } }
    expect(categorizeObservation(medcloud)?.id).toBe('urine')
    expect(categorizeObservation(healthbank)?.id).toBe('urine')
  })

  it('does not let a serum albumin under a 09 order into 尿液', () => {
    expect(categorizeObservation(obs('Albumin', '09038C', 4))?.id).toBe('chem')
  })
})
