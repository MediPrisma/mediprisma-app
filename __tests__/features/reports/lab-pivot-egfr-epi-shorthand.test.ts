import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'

// Some hospitals upload CKD-EPI eGFR as 「E-GFR(EPI)」 or 「EPI-eGFR」 with no
// LOINC. Stripping the parenthetical keyed them as EGFR(M), so a CKD-EPI value
// sat in the MDRD column and trend. Values are synthetic.
const LAB = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
let seq = 0
const egfr = (text: string, value: number, options: { loinc?: string; method?: string; date?: string } = {}) => ({
  resourceType: 'Observation', id: `egfr-epi-${seq++}`, status: 'final', category: LAB,
  effectiveDateTime: options.date ?? '2026-04-04',
  code: { text, coding: [...(options.loinc ? [{ system: 'http://loinc.org', code: options.loinc }] : []), { system: NHI, code: '09015C' }] },
  ...(options.method ? { method: { text: options.method } } : {}),
  valueQuantity: { value },
})
const key = (o: any) => getLabPivotTestIdentity(o).testKey

it.each(['E-GFR(EPI)', 'EPI-eGFR'])('keys %s as CKD-EPI', (text) => {
  expect(key(egfr(text, 64))).toBe('EGFR(EPI)')
})

it('keeps MDRD and bare eGFR in the MDRD column', () => {
  expect(key(egfr('eGFR(M)', 70, { loinc: '77147-7' }))).toBe('EGFR(M)')
  expect(key(egfr('eGFR', 70))).toBe('EGFR(M)')
})

it('shows the hospital CKD-EPI value in the CKD-EPI column, not under MDRD', () => {
  const rows = buildLabPivots([
    egfr('E-GFR(EPI)', 64),
    egfr('腎絲球過濾率(新) ;(eGFR-CKD-EPI)', 65, { loinc: '62238-1', method: '健保署計算' }),
    egfr('eGFR(M)', 72, { loinc: '77147-7', date: '2026-03-01' }),
  ], { preferInstitutionEgfr: true }).chem.rows
  const cell = (k: string, date: string) => rows.find(row => row.testKey === k)?.values.get(date)?.value
  // The hospital's own value wins over the NHI-calculated one on that day.
  expect(cell('EGFR(EPI)', '2026-04-04')).toBe('64')
  expect(cell('EGFR(M)', '2026-04-04')).toBeUndefined()
  expect(cell('EGFR(M)', '2026-03-01')).toBe('72')
})

it('labels the column CKD-EPI for clinicians', () => {
  const row = buildLabPivots([egfr('E-GFR(EPI)', 64)]).chem.rows.find(r => r.testKey === 'EGFR(EPI)')!
  expect(getLabRowDisplayParts(row, 'medical', 'zh-TW').name).toMatch(/CKD-EPI/)
})
