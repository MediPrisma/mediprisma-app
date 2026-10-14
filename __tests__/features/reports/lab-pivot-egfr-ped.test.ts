import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'

// Some 臺北榮總 creatinine reports print 「eGFR(M)」 and 「eGFR(PED)」.
// Stripping the parenthetical used to key the pediatric (Schwartz) value as
// EGFR(M), so one cumulative cell read "181.06 / 106". Values are synthetic.
const LAB = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
let seq = 0
const egfr = (text: string, value: number, loinc?: string, date = '2026-04-04') => ({
  resourceType: 'Observation', id: `egfr-${seq++}`, status: 'final', category: LAB, effectiveDateTime: date,
  code: { text, coding: [...(loinc ? [{ system: 'http://loinc.org', code: loinc }] : []), { system: NHI, code: '09015C' }] },
  valueQuantity: { value, unit: 'mL/min/1.73M^2' },
})
const key = (o: any) => getLabPivotTestIdentity(o).testKey

it.each([
  ['eGFR(PED)', '69405-9'], ['eGFR(PED)', undefined], ['eGFR (PED)', undefined],
  ['eGFR (Schwartz)', undefined], ['Estimated GFR', '50384-7'],
])('keys %s (LOINC %s) as the pediatric formula', (text, loinc) => {
  expect(key(egfr(text, 102, loinc))).toBe('EGFR(PED)')
})

it('keeps MDRD, bare and CKD-EPI eGFR where they were', () => {
  expect(key(egfr('eGFR(M)', 181.06, '69405-9'))).toBe('EGFR(M)')
  expect(key(egfr('eGFR(M)', 181.06))).toBe('EGFR(M)')
  expect(key(egfr('eGFR', 90))).toBe('EGFR(M)')
  expect(key(egfr('eGFR (CKD-EPI)', 90, '62238-1'))).toBe('EGFR(EPI)')
})

it('gives eGFR(M) and eGFR(PED) their own cumulative columns', () => {
  const rows = buildLabPivots([egfr('eGFR(PED)', 102, '69405-9'), egfr('eGFR(M)', 176.97, '69405-9')], { preferInstitutionEgfr: true }).chem.rows
  const cell = (k: string) => rows.find(row => row.testKey === k)?.values.get('2026-04-04')?.value
  // eGFR cells already display as integers; only the column split is new.
  expect(cell('EGFR(M)')).toBe('177')
  expect(cell('EGFR(PED)')).toBe('102')
  const order = rows.map(row => row.testKey)
  expect(order.indexOf('EGFR(M)')).toBeLessThan(order.indexOf('EGFR(PED)'))
})

it('labels the pediatric column eGFR (PED) for clinicians', () => {
  const row = buildLabPivots([egfr('eGFR(PED)', 102, '69405-9')]).chem.rows.find(r => r.testKey === 'EGFR(PED)')!
  expect(getLabRowDisplayParts(row, 'medical', 'zh-TW').name).toBe('eGFR (PED)')
  expect(getLabRowDisplayParts(row, 'medical', 'en').name).toBe('eGFR (PED)')
})

it('files a Schwartz row by its LOINC alone, under a name no alias knows', () => {
  // The LOINC short name is not an alias: only 50384-7 identifies the row.
  const row = egfr('GFR SerPlBld Schwartz-ArVRat', 100, '50384-7')
  expect(categorizeObservation(row)?.id).toBe('chem')
  const cell = buildLabPivots([row]).chem.rows.find(r => r.testKey === 'EGFR(PED)')?.values.get('2026-04-04')?.value
  expect(cell).toBe('100')
})
