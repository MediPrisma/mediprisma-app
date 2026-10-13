// A panel order bills several analytes, and each row of the panel carries
// its own local item code. When that code arrives bare — no code.text, no
// coding display — it is still the row's analyte (WBC, RBC, HGB under one
// 08011C "CBC" order). The order display names the ORDER: it may name a row
// only when the row's own code is an opaque identifier (numeric id, GUID,
// hash-like code). Otherwise every analyte of the panel collapses into one
// "CBC" column and one AI group.
//
// Synthetic rows only.
import { categorizeObservation, getTestDisplayName } from '@/src/shared/utils/lab-categories'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'
import { labCategoryAnalyte } from '@/src/infrastructure/ai/tools/fhir-tools'
import { dualSpecimenAnalyte } from '@/src/shared/utils/specimen-evidence'
import { isOpaqueLocalCode } from '@/src/shared/utils/nhi-order-code'

const MEDCLOUD_NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const HEALTHBANK_NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const LOCAL = 'https://cloud-wildcatch.invalid/fhir/upstream-local/CodeSystem/his-local-lab'

let seq = 0
function row(local: string, order: string, orderDisplay: string, opts: { nhiSystem?: string; localFirst?: boolean; value?: number; unit?: string; day?: number } = {}) {
  const { nhiSystem = MEDCLOUD_NHI, localFirst = true, value = 5, unit = 'mg/dL', day = 1 } = opts
  seq += 1
  const localCoding = { system: LOCAL, code: local }
  const orderCoding = { system: nhiSystem, code: order, display: orderDisplay }
  return {
    resourceType: 'Observation', id: `local-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { coding: localFirst ? [localCoding, orderCoding] : [orderCoding, localCoding] },
    effectiveDateTime: `2026-09-${String(day).padStart(2, '0')}T08:00:00+08:00`,
    valueQuantity: { value, unit },
  }
}

// order, order display, several distinct local analyte codes under it
const PANELS: Array<[string, string, string[]]> = [
  ['08011C', 'CBC', ['WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'MCV']],
  ['08013C', 'DC', ['SEG', 'LYM', 'MONO', 'EOS', 'BASO']],
  ['09099C', '生化檢查', ['BUN', 'CREA', 'NA', 'K', 'AST', 'ALT']],
  ['06013C', '尿一般檢查', ['PH', 'SG', 'PROT', 'GLU', 'KET']],
  ['12064B', '可抽出的核抗體測定—Ro/La抗體', ['SSA', 'SSB', 'RO52']],
  ['12173B', '可抽出的核抗體測定—Sm/RNP抗體', ['SM', 'RNP']],
  ['12137B', '肌肉炎自體抗體組合', ['MI2', 'KU', 'PL7', 'PL12', 'EJ', 'OJ', 'SRP', 'MDA5']],
  ['30022C', '過敏原檢查', ['D1', 'D2', 'F13', 'E1']],
]

const SHAPES: Array<[string, { nhiSystem: string; localFirst: boolean }]> = [
  ['local coding first (MediCloud)', { nhiSystem: MEDCLOUD_NHI, localFirst: true }],
  ['order coding first (MediCloud)', { nhiSystem: MEDCLOUD_NHI, localFirst: false }],
  ['local coding first (健保存摺 system)', { nhiSystem: HEALTHBANK_NHI, localFirst: true }],
]

describe('opaque local codes', () => {
  it.each([
    ['0042', true], ['72-001', true], ['L0001', true], ['A12345', true], ['LB-20031', true],
    ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', true], ['9f86d081884c7d65', true], ['X7F3K9Q2', true],
    ['WBC', false], ['HGB', false], ['RBC', false], ['CA125', false], ['CA199', false], ['B12', false],
    ['T4', false], ['PL12', false], ['PMSCL100', false], ['PMSCL75', false], ['TIF1GAMMA', false], ['MDA5', false], ['F13', false], ['HBA1C', false], ['25OHD', false],
  ])('%s → opaque %s', (code, opaque) => {
    expect(isOpaqueLocalCode(code)).toBe(opaque)
  })
})

describe('the CBC repro: WBC / RBC / HGB under one 08011C "CBC" order', () => {
  it('keeps one column per analyte, never a "CBC" column', () => {
    const rows = ['WBC', 'RBC', 'HGB'].map((code) => row(code, '08011C', 'CBC', { unit: '' }))
    for (const o of rows) expect(getTestDisplayName(o)).toBe(o.code.coding[0].code)
    const pivots = buildLabPivots(rows)
    expect(pivots.cbc.rows.filter((r) => r.values.size > 0).map((r) => r.testKey).sort()).toEqual(['HB', 'RBC', 'WBC'])
  })
})

describe.each(SHAPES)('bare local codes under a panel order — %s', (_shape, shape) => {
  describe.each(PANELS)('%s (%s)', (order, orderDisplay, locals) => {
    const rows = locals.flatMap((code, i) => [
      row(code, order, orderDisplay, { ...shape, value: 10 + i, day: 1 }),
      row(code, order, orderDisplay, { ...shape, value: 20 + i, day: 2 }),
    ])
    const codeOf = (o: any) => o.code.coding.find((c: any) => c.system === LOCAL).code

    it('names every row by its local code, not by the order display', () => {
      for (const o of rows) expect(getTestDisplayName(o)).toBe(codeOf(o))
    })

    it('gives each analyte its own pivot column', () => {
      // Each code has its own values (10+i, 20+i): a merged column shows two
      // values in one day's cell, or fewer columns than analytes.
      const categorized = new Set(rows.filter((o) => categorizeObservation(o)).map(codeOf))
      const filled = Object.values(buildLabPivots(rows)).flatMap((pivot) => pivot.rows.filter((r) => r.values.size > 0))
      for (const r of filled) {
        for (const cell of r.values.values()) {
          expect([r.mapKey, (cell.allValues ?? [cell.value]).length]).toEqual([r.mapKey, 1])
        }
      }
      expect(filled.length).toBe(categorized.size)
    })

    it('gives each analyte its own trend series', () => {
      const pivots = buildLabPivots(rows)
      for (const [categoryId, pivot] of Object.entries(pivots)) {
        for (const r of pivot.rows) {
          const series = buildLabTrendSeries(rows, {
            categoryId, mapKey: r.mapKey, testKey: r.testKey, displayName: r.displayName, nameMode: 'standardized',
          } as any)
          const codes = new Set(series.points.map((p: any) => codeOf(rows.find((x) => x.id === p.id))))
          expect([r.mapKey, codes.size <= 1]).toEqual([r.mapKey, true])
        }
      }
    })

    it('gives each analyte its own AI group', () => {
      const groups = new Map<string, string>()
      for (const o of rows) {
        const cat = categorizeObservation(o)?.id
        if (!cat) continue
        const { key } = labCategoryAnalyte(o, cat)
        const other = groups.get(key)
        if (other !== undefined) expect([key, other]).toEqual([key, codeOf(o)])
        groups.set(key, codeOf(o))
      }
    })
  })
})

describe('an opaque local code still takes the order display', () => {
  it.each([
    ['L0001', '09040C', '全蛋白', 'chem', 'TP'],
    ['0042', '09040C', '全蛋白', 'chem', 'TP'],
    ['72-001', '09038C', '白蛋白', 'chem', 'ALB'],
  ])('%s under %s (%s) → %s/%s', (local, order, display, category, testKey) => {
    const o = row(local, order, display)
    expect(getTestDisplayName(o)).toBe(display)
    expect(categorizeObservation(o)?.id).toBe(category)
    expect(getLabPivotTestIdentity(o, category).testKey).toBe(testKey)
  })
})

describe('specimen evidence reads a bare local code as the row name', () => {
  it('a bare UPCR code under 09040C 全蛋白 is not serum total protein', () => {
    expect(dualSpecimenAnalyte(row('UPCR', '09040C', '全蛋白'))).toBeNull()
  })
  it('a bare TP code is total protein; an opaque one falls back to the order', () => {
    expect(dualSpecimenAnalyte(row('TP', '09040C', '全蛋白'))).toBe('TP')
    expect(dualSpecimenAnalyte(row('L0001', '09040C', '全蛋白'))).toBe('TP')
  })
})
