/**
 * @jest-environment node
 *
 * Every paraprotein matcher against labels × decorations: Greek and ASCII
 * κ / λ, K/L, kappa / lambda, full-width, 游離 / 總, (S) / (U) / serum / urine,
 * "Serum protein electrophoresis", M-spike / M protein / Mprotein, and lane
 * names. Word boundaries must hold after Greek letters and must never let
 * the "m" of "Serum" start an M-protein.
 */
import { paraproteinIdentity } from '@/src/shared/utils/paraprotein-analytes'
import { getAnalyteDisplayForMode } from '@/src/shared/utils/lab-analyte-display.utils'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { samplePatient, sampleCollection } from '../../infrastructure/ai/tools/fixtures'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const fullWidth = (s: string) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))

let seq = 0
function row(item: string, nhi: string, value: number | string = 10, specimen?: string, date = '2026-10-01') {
  seq += 1
  return {
    resourceType: 'Observation', id: `pps-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [{ system: NHI, code: nhi }] },
    ...(typeof value === 'number' ? { valueQuantity: { value, unit: 'mg/L' } } : { valueString: value }),
    ...(specimen ? { specimen: { display: specimen } } : {}),
    effectiveDateTime: `${date}T08:00:00+08:00`,
  }
}
const key = (item: string, nhi: string, value?: number | string, specimen?: string) =>
  paraproteinIdentity(row(item, nhi, value, specimen))?.key ?? null

// 12160B: label → base column (serum). Decorations add the specimen.
const LIGHT_CHAIN: Array<[string, string]> = [
  ['Free κ', 'KAPPA-FREE'], ['Free λ', 'LAMBDA-FREE'], ['Free κ/λ', 'KL-RATIO-FREE'],
  ['free kappa', 'KAPPA-FREE'], ['free lambda', 'LAMBDA-FREE'], ['Free K/L', 'KL-RATIO-FREE'],
  ['Free kappa/lambda ratio', 'KL-RATIO-FREE'], ['FLC κ', 'KAPPA-FREE'], ['sFLC λ', 'LAMBDA-FREE'],
  ['FLC κ/λ ratio', 'KL-RATIO-FREE'], ['游離κ', 'KAPPA-FREE'], ['游離 λ', 'LAMBDA-FREE'], ['游離κ/λ比值', 'KL-RATIO-FREE'],
  ['Total κ', 'KAPPA-TOTAL'], ['Total λ', 'LAMBDA-TOTAL'], ['Total κ/λ', 'KL-RATIO-TOTAL'],
  ['總κ', 'KAPPA-TOTAL'], ['總 λ', 'LAMBDA-TOTAL'], ['Kappa total', 'KAPPA-TOTAL'], ['Total K/L ratio', 'KL-RATIO-TOTAL'],
]
const NEUTRAL = ['κ', 'λ', 'κ/λ', 'Kappa', 'Lambda', 'K/L ratio', 'Kappa/Lambda']

describe('12160B light-chain labels × decorations', () => {
  const failures: string[] = []
  const check = (label: string, want: string | RegExp, specimen?: string) => {
    const got = key(label, '12160B', 10, specimen)
    const ok = typeof want === 'string' ? got === want : !!got && want.test(got)
    if (!ok) failures.push(`${JSON.stringify(label)}${specimen ? ` [${specimen}]` : ''}: ${got} ≠ ${want}`)
  }
  for (const [label, base] of LIGHT_CHAIN) {
    for (const form of [label, label.toUpperCase(), fullWidth(label), `${label} (S)`, `Serum ${label}`, `血清${label}`]) {
      check(form, `PP:${base}`)
    }
    for (const form of [`${label} (U)`, `Urine ${label}`, `尿${label}`, `U-${label}`]) check(form, `PP:U:${base}`)
    check(label, `PP:U:${base}`, 'Urine')
  }
  for (const label of NEUTRAL) {
    for (const form of [label, fullWidth(label), `${label} (S)`]) check(form, /^PP:KL:/)
    check(`${label} (U)`, /^PP:U:KL:/)
  }
  it(`resolves ${LIGHT_CHAIN.length * 11 + NEUTRAL.length * 4} labelled light-chain rows`, () => {
    expect(failures).toEqual([])
  })
})

describe('M-protein abbreviations need a word start', () => {
  it.each([
    ['M-protein', '09065B', 'PP:M-PROTEIN'], ['M protein', '09065B', 'PP:M-PROTEIN'], ['Mprotein', '09065B', 'PP:M-PROTEIN'],
    ['M-spike', '09065B', 'PP:M-PROTEIN'], ['M spike', '09065B', 'PP:M-PROTEIN'], ['Serum M-protein', '09065B', 'PP:M-PROTEIN'],
    ['M蛋白', '09065B', 'PP:M-PROTEIN'], ['Paraprotein', '09065B', 'PP:M-PROTEIN'], ['ＭＰＲＯＴＥＩＮ', '09065B', 'PP:M-PROTEIN'],
    ['M-protein', '09100B', 'PP:U:M-PROTEIN'],
    ['M-protein', '12103B', 'PP:M-PROTEIN'],
  ])('%s under %s → %s', (label, nhi, want) => {
    expect(key(label, nhi, 1)).toBe(want)
  })

  it.each([
    'Serum protein electrophoresis', 'SERUM PROTEIN', 'Serum protein', 'Total protein', 'Albumin', 'Gamma globulin',
    'Alpha-2 globulin', 'Beta globulin', 'Immunoglobulin', 'Sum protein',
  ])('SPEP row %s is not an M-protein', (label) => {
    expect(key(label, '09065B', 1)).toBeNull()
  })

  it('a numeric "Serum protein electrophoresis" under 12103B stays in the report column', () => {
    expect(key('Serum protein electrophoresis', '12103B', 7)).toBe('PP:IFE')
  })
})

describe('report orders: lane names and methods', () => {
  it.each([
    ['IgG', '12103B'], ['IgA', '12103B'], ['IgM', '12103B'], ['κ', '12103B'], ['λ', '12103B'], ['Kappa', '12103B'],
    ['Lambda', '12103B'], ['Free κ', '12103B'], ['IFE', '12103B'], ['Immunofixation', '12103B'], ['免疫固定電泳', '12103B'],
    ['IEP', '12103B'], ['免疫電泳', '12103B'],
  ])('%s under %s → serum report column', (label, nhi) => {
    expect(key(label, nhi, 'Present')).toBe('PP:IFE')
  })

  it.each([
    ['IEP', 'PP:U:IEP'], ['Immunoelectrophoresis', 'PP:U:IEP'], ['免疫電泳', 'PP:U:IEP'],
    ['IFE', 'PP:U:IFE'], ['免疫固定電泳', 'PP:U:IFE'], ['IgG', 'PP:U:IFE'],
  ])('urine 12103B %s → %s', (label, want) => {
    expect(key(label, '12103B', 'Negative', 'Urine')).toBe(want)
  })
})

describe('individual-observation views keep the lane name', () => {
  it.each(['IgG', 'IgA', 'Kappa', 'IFE'])('%s under 12103B reads as itself, not the report column', (label) => {
    const obs = row(label, '12103B', 'Present')
    expect(getAnalyteDisplayForMode(obs, 'medical', 'en', 'standardized')).toBe(label)
    expect(getAnalyteDisplayForMode(obs, 'medical', 'zh-TW', 'standardized')).toBe(label)
  })
})

describe('AI category query never drops a lane or merges specimens', () => {
  const tools = (observations: any[]) => createFhirTools(() => ({
    patient: samplePatient, collection: { ...sampleCollection, observations, vitalSigns: [] },
  }))

  it('returns every lane of a LOINC-less multi-lane IFE report', async () => {
    const date = '2026-10-05'
    const observations = [
      row('IFE', '12103B', 'No monoclonal band', undefined, date),
      row('IgG', '12103B', 'Present', undefined, date),
      row('IgA', '12103B', 'Absent', undefined, date),
      row('Kappa', '12103B', 'Present', undefined, date),
      row('Lambda', '12103B', 'Absent', undefined, date),
    ]
    const result = await (tools(observations).queryLabResultsByCategory as any).execute({ category: 'immuno' })
    expect(result.analyteCount).toBe(5)
    const values = result.data.map((g: any) => g.results[0].value).sort()
    expect(values).toEqual(['Absent', 'Absent', 'No monoclonal band', 'Present', 'Present'])
    expect(new Set(result.availableAnalytes).size).toBe(5)
    for (const label of ['IgG', 'IgA', 'Kappa', 'Lambda']) {
      expect(result.availableAnalytes.some((a: string) => a.includes(label))).toBe(true)
    }
  })

  it('keeps a neutral serum κ and a neutral urine κ apart', async () => {
    const result = await (tools([
      row('Kappa', '12160B', 12), row('Kappa', '12160B', 30, 'Urine'),
    ]).queryLabResultsByCategory as any).execute({ category: 'immuno' })
    expect(result.analyteCount).toBe(2)
    expect(result.availableAnalytes.some((a: string) => /urine/i.test(a))).toBe(true)
  })
})
