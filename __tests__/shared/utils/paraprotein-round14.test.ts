/**
 * @jest-environment node
 */
import { paraproteinIdentity, paraproteinTextBadge } from '@/src/shared/utils/paraprotein-analytes'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOCAL = 'https://example.invalid/fhir/CodeSystem/his-local-lab'

function row(item: string, nhi: string, value: any = 10, date = '2026-10-01') {
  return {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [{ system: NHI, code: nhi }] },
    ...(typeof value === 'object' ? value : typeof value === 'number' ? { valueQuantity: { value, unit: 'mg/L' } } : { valueString: value }),
    effectiveDateTime: `${date}T08:00:00+08:00`,
  }
}

// Isotype badges by ALLOWLIST: only a controlled affirmative template.
describe('isotype badge allowlist', () => {
  it.each([
    'IgG-kappa monoclonal band in gamma region', 'IgA lambda', 'Monoclonal IgM-κ detected', 'Monoclonal IgG-κ present',
    'IgG-κ monoclonal band detected', 'IgG-κ monoclonal protein identified', 'Free lambda light chain detected', 'IgG-κ',
    '單株 IgG-κ 陽性', 'IgA-λ 單株球蛋白',
  ])('%s keeps its isotype badge', (text) => {
    expect(paraproteinTextBadge([`IFE: ${text}`], 'en')).not.toBe('See report')
  })

  it.each([
    'IgG-kappa is undetectable', 'IgG-κ band has disappeared', 'IgG-κ band resolved', 'IgG-κ no longer seen',
    'IgG-κ below detection', 'IgG-κ below the limit of detection', 'IgG-κ not identified on repeat', 'Previously IgG-κ',
    'IgG-κ (previous), now negative', 'IgG-κ 消失', 'IgG-κ 未再見到', '已無 IgG-κ', 'IgG-κ 已消失', 'IgG-κ decreased',
    'IgG-κ, decreasing', 'Persistent faint IgG-κ', 'IgG-κ in remission', 'IgG-κ treated', 'History of IgG-κ myeloma',
    'Known IgG-κ', 'IgG-κ: see comment', 'IgG-κ? correlate', 'IgG-κ not excluded',
  ])('%s → 見報告', (text) => {
    expect(paraproteinTextBadge([`IFE: ${text}`], 'zh-TW')).toBe('見報告')
    expect(paraproteinTextBadge([`IFE: ${text}`], 'en')).toBe('See report')
  })
})

describe('κ/λ ratio direction', () => {
  it.each([
    ['Free kappa/lambda ratio', 'PP:KL-RATIO-FREE'], ['Free κ/λ', 'PP:KL-RATIO-FREE'], ['FLC K/L ratio', 'PP:KL-RATIO-FREE'],
    ['Total kappa/lambda ratio', 'PP:KL-RATIO-TOTAL'],
  ])('%s → %s', (label, want) => {
    expect(paraproteinIdentity(row(label, '12160B', 1))?.key).toBe(want)
  })

  it.each(['Free lambda/kappa ratio', 'Free λ/κ', 'FLC L/K ratio', 'Total lambda/kappa ratio', 'FLC ratio', 'Free light chain ratio'])(
    '%s keeps a source-name column, never the κ/λ ratio', (label) => {
      const key = paraproteinIdentity(row(label, '12160B', 1))?.key
      expect(key).toMatch(/^PP:KL:/)
      expect(key).not.toMatch(/KL-RATIO/)
    },
  )
})

describe('report records keep their comparator and unit', () => {
  it('formats "<0.2 g/L" in the folded record', () => {
    const date = '2026-10-02'
    const pivot = buildLabPivots([
      row('M-band', '12103B', { valueQuantity: { value: 0.2, comparator: '<', unit: 'g/L' } }, date),
      row('IgG', '12103B', 'Absent', date),
    ]).immuno
    const cell = pivot.rows.find((r) => r.testKey === 'PP:IFE')!.values.get(date)!
    expect(cell.allValues).toEqual(['M-band: <0.2 g/L', 'IgG: Absent'])
  })
})

describe('an opaque local item code is not a name', () => {
  function opaque(nhi: string, orderDisplay: string, code = 'L0001') {
    return {
      resourceType: 'Observation', status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { coding: [{ system: NHI, code: nhi, display: orderDisplay }, { system: LOCAL, code }] },
      valueQuantity: { value: 5, unit: 'mg/dL' },
      effectiveDateTime: '2026-10-01T08:00:00+08:00',
    }
  }
  it.each([
    ['09005C', 'Glucose', 'glucose'], ['09015C', 'Creatinine', 'chem'], ['09011C', 'Calcium', 'chem'],
    ['09011C', '鈣', 'chem'], ['09002C', 'BUN', 'chem'], ['12025B', 'IgG', 'immuno'],
  ])('%s with display %s and only an opaque local code → %s', (nhi, display, want) => {
    for (const code of ['L0001', '72-001', 'A12345', '0042']) {
      expect(categorizeObservation(opaque(nhi, display, code))?.id).toBe(want)
    }
  })

  it('names the column after the order display, not the opaque code', () => {
    const identity = getLabPivotTestIdentity(opaque('12025B', 'IgG'), 'immuno')
    expect(identity.testKey).toBe('IGG')
  })
})
