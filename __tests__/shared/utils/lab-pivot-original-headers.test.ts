// Original-name mode keeps the source label as the column header. When two
// or more columns of one table would show the same header, only those get a
// short hint — specimen, else count / %, else free / total, else the
// standardized column label — so every header is unique; a unique source
// label stays exactly as it is.
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOINC = 'http://loinc.org'
let seq = 0
function obs(item: string, opts: { nhi?: string; loinc?: string; value?: number; unit?: string; specimen?: string } = {}) {
  seq += 1
  const { nhi, loinc, value = 10, unit = 'mg/dL', specimen } = opts
  return {
    resourceType: 'Observation', id: `oh-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [...(nhi ? [{ system: NHI, code: nhi }] : []), ...(loinc ? [{ system: LOINC, code: loinc }] : [])] },
    valueQuantity: { value, unit },
    ...(specimen ? { specimen: { display: specimen } } : {}),
    effectiveDateTime: '2026-01-01T08:00:00+08:00',
  }
}

const CORPUS = [
  // same label, serum vs urine → specimen hint
  obs('Free Kappa', { nhi: '12160B', unit: 'mg/L' }),
  obs('Free Kappa', { nhi: '12160B', unit: 'mg/L', specimen: 'Urine' }),
  // same label, free vs total (both serum) → free / total hint
  obs('FLC', { nhi: '12160B', loinc: '36916-5', unit: 'mg/L' }),
  obs('FLC', { nhi: '12160B', loinc: '11050-2', unit: 'mg/L' }),
  // same label, four columns that only the standardized label tells apart
  obs('Kappa', { nhi: '12160B', loinc: '36916-5', unit: 'mg/L' }),
  obs('Kappa', { nhi: '12160B', loinc: '11050-2', unit: 'mg/L' }),
  obs('Kappa', { nhi: '12160B', unit: 'mg/L' }),
  obs('Kappa', { nhi: '12160B', unit: 'mg/L', specimen: 'Urine' }),
  // glucose subtypes under one label
  obs('Glucose', { loinc: '1558-6' }),
  obs('Glucose', { loinc: '2345-7' }),
  // unique labels
  obs('IgG', { nhi: '12025B', value: 1000 }),
  obs('Free Lambda', { nhi: '12160B', unit: 'mg/L' }),
  obs('CRP', { loinc: '1988-5' }),
]

describe.each(['zh-TW', 'en'] as const)('original-mode headers (%s)', (language) => {
  const pivots = buildLabPivots(CORPUS, { nameMode: 'original' })

  it('are unique within every table', () => {
    for (const [category, pivot] of Object.entries(pivots)) {
      const headers = pivot.rows.filter((r) => r.values.size > 0)
        .map((r) => getLabRowDisplayParts(r, 'medical', language, 'original').name)
      expect({ category, headers }).toEqual({ category, headers: [...new Set(headers)] })
    }
  })

  it('leave a unique source label exactly as it is', () => {
    for (const pivot of Object.values(pivots)) {
      const rows = pivot.rows.filter((r) => r.values.size > 0)
      for (const row of rows) {
        const sameLabel = rows.filter((r) => r.displayName.normalize('NFKC').trim().toLowerCase() === row.displayName.normalize('NFKC').trim().toLowerCase())
        const header = getLabRowDisplayParts(row, 'medical', language, 'original').name
        if (sameLabel.length === 1) expect(header).toBe(row.displayName)
        else expect(header.startsWith(row.displayName)).toBe(true)
      }
    }
  })

  it('uses the specimen, then free / total, as the hint when that tells the columns apart', () => {
    const immuno = pivots.immuno.rows.filter((r) => r.values.size > 0)
    const headers = immuno.map((r) => getLabRowDisplayParts(r, 'medical', language, 'original').name)
    const urine = language === 'zh-TW' ? '尿' : 'Urine'
    const serum = language === 'zh-TW' ? '血清' : 'Serum'
    expect(headers).toEqual(expect.arrayContaining([`Free Kappa (${serum})`, `Free Kappa (${urine})`]))
    const free = language === 'zh-TW' ? '游離' : 'free'
    const total = language === 'zh-TW' ? '總' : 'total'
    expect(headers).toEqual(expect.arrayContaining([`FLC (${free})`, `FLC (${total})`]))
  })
})
