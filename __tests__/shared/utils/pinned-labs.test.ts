// 自訂檢驗 — the pinnable catalog and the per-pin latest/previous reader.
import {
  findPinnableLab,
  getPinnableLabCatalog,
  isPinnedLabReminder,
  makePinnedLabReminder,
  parsePinnedLabId,
  pinnedLabReminderLabel,
  resolvePinnedLab,
  searchPinnableLabs,
} from '@/src/shared/utils/pinned-labs'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'

function obs(code: string, date: string, value: number | string, opts: {
  unit?: string
  interpretation?: string
  comparator?: string
  status?: string
} = {}) {
  return {
    resourceType: 'Observation',
    code: { text: code },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    ...(opts.status ? { status: opts.status } : {}),
    ...(typeof value === 'number'
      ? { valueQuantity: { value, unit: opts.unit, ...(opts.comparator ? { comparator: opts.comparator } : {}) } }
      : { valueString: value }),
    ...(opts.interpretation ? { interpretation: [{ coding: [{ code: opts.interpretation }] }] } : {}),
  }
}

describe('pinnable catalog', () => {
  const catalog = getPinnableLabCatalog()
  const ids = new Set(catalog.map((entry) => entry.id))

  it('lists each analyte individually and category-scoped', () => {
    for (const id of ['chem:CREA', 'chem:ALT', 'chem:AST', 'chem:K', 'lipid:LDL', 'lipid:HDL', 'lipid:TG', 'chem:NT-PROBNP', 'glucose:HBA1C']) {
      expect(ids.has(id)).toBe(true)
    }
    // No duplicate ids.
    expect(ids.size).toBe(catalog.length)
  })

  it('keeps the eGFR formulas as separate analytes', () => {
    expect(ids.has('chem:EGFR(EPI)')).toBe(true)
    expect(ids.has('chem:EGFR(M)')).toBe(true)
  })

  it('finds analytes by Chinese name, abbreviation and loose spelling', () => {
    expect(searchPinnableLabs('肌酸酐').map((e) => e.id)).toContain('chem:CREA')
    expect(searchPinnableLabs('crea').map((e) => e.id)).toContain('chem:CREA')
    expect(searchPinnableLabs('nt pro bnp').map((e) => e.id)).toContain('chem:NT-PROBNP')
    expect(searchPinnableLabs('hba1c').map((e) => e.id)).toContain('glucose:HBA1C')
  })

  it('returns nothing for an analyte the taxonomy does not know', () => {
    expect(searchPinnableLabs('digoxin')).toEqual([])
    expect(searchPinnableLabs('   ')).toEqual([])
  })

  it('offers analytes, not the sort lists’ spellings', () => {
    for (const id of ['urine:GRAVITY', 'urine:SP.GRAVITY', 'urine:PROTEIN', 'urine:KETON', 'urine:CAST1', 'endocrine:DHEAS', 'endocrine:IGF1', 'tumor:PIVKA', 'lipid:RISKF', 'glucose:GLU,1HRPC']) {
      expect(ids.has(id)).toBe(false)
    }
    expect(catalog.some((entry) => entry.categoryId === 'microbio' || entry.categoryId === 'other')).toBe(false)
    // Every option has a human name.
    expect(catalog.every((entry) => entry.nameZh || entry.nameEn)).toBe(true)
  })

  it('names a urine analyte as the urine test, not the serum one', () => {
    expect(findPinnableLab('urine:GLUCOSE')).toMatchObject({ short: 'Glucose(U)', nameZh: '尿糖' })
    expect(findPinnableLab('urine:CREA')).toMatchObject({ short: 'CREA(U)', nameZh: '尿肌酸酐' })
    expect(findPinnableLab('urine:GRAVIT')?.short).toBe('SG')
    expect(findPinnableLab('glucose:GLUCOSE')?.nameZh).toBe('血糖')
  })

  it('offers a key listed in two panels only where results land', () => {
    expect(catalog.filter((entry) => entry.testKey === 'C-PEPTIDE')).toHaveLength(1)
    expect(catalog.filter((entry) => entry.testKey === 'CALCITONIN')).toHaveLength(1)
  })

  it('labels analytes the shared vocabulary cannot name', () => {
    expect(findPinnableLab('lipid:LP(A)')).toMatchObject({ short: 'Lp(a)', nameZh: '脂蛋白(a)' })
    expect(findPinnableLab('chem:HS-TROPONIN T')?.short).toBe('hs-TnT')
    expect(findPinnableLab('endocrine:IPTH')?.short).toBe('iPTH')
  })

  it('looks entries up by id', () => {
    expect(findPinnableLab('lipid:LDL')?.short).toBe('LDL')
    expect(findPinnableLab('chem:NOPE')).toBeUndefined()
  })
})

describe('pin ids', () => {
  it('parses category-scoped ids and rejects reminders', () => {
    expect(parsePinnedLabId('chem:CREA')).toEqual({ categoryId: 'chem', testKey: 'CREA' })
    expect(parsePinnedLabId('chem:EGFR(EPI)')).toEqual({ categoryId: 'chem', testKey: 'EGFR(EPI)' })
    expect(parsePinnedLabId(makePinnedLabReminder('Digoxin 濃度'))).toBeNull()
  })

  it('round-trips a reminder label', () => {
    const id = makePinnedLabReminder('  Digoxin 濃度 ')
    expect(isPinnedLabReminder(id)).toBe(true)
    expect(pinnedLabReminderLabel(id)).toBe('Digoxin 濃度')
  })
})

describe('resolvePinnedLab', () => {
  it('returns latest and previous with their own dates', () => {
    const pivots = buildLabPivots([
      obs('CREA', '2026-03-01', 1.1, { unit: 'mg/dL' }),
      obs('CREA', '2026-09-18', 1.32, { unit: 'mg/dL', interpretation: 'H' }),
      obs('CREA', '2026-06-30', 1.28, { unit: 'mg/dL', interpretation: 'H' }),
    ])
    const resolved = resolvePinnedLab(pivots, 'chem:CREA')
    expect(resolved.latest?.date).toBe('2026-09-18')
    expect(resolved.latest?.value).toBe('1.32')
    expect(resolved.latest?.cell.isAbnormal).toBe(true)
    expect(resolved.previous?.date).toBe('2026-06-30')
    expect(resolved.points.map((p) => p.date)).toEqual(['2026-09-18', '2026-06-30', '2026-03-01'])
  })

  it('reports no result rather than guessing', () => {
    const pivots = buildLabPivots([obs('K', '2026-09-18', 4.6, { unit: 'mmol/L' })])
    const resolved = resolvePinnedLab(pivots, 'chem:CREA')
    expect(resolved.latest).toBeUndefined()
    expect(resolved.points).toEqual([])
  })

  it('keeps a comparator in front of the value', () => {
    const pivots = buildLabPivots([obs('CRP', '2026-09-18', 0.5, { unit: 'mg/dL', comparator: '<' })])
    expect(resolvePinnedLab(pivots, 'chem:CRP').latest?.value).toBe('<0.5')
  })

  it('skips entered-in-error results', () => {
    const pivots = buildLabPivots([
      obs('K', '2026-09-01', 4.4, { unit: 'mmol/L' }),
      obs('K', '2026-09-18', 9.9, { unit: 'mmol/L', status: 'entered-in-error' }),
    ])
    expect(resolvePinnedLab(pivots, 'chem:K').latest?.date).toBe('2026-09-01')
  })

  it('ignores reminder ids', () => {
    expect(resolvePinnedLab({}, makePinnedLabReminder('x')).points).toEqual([])
  })

  describe('several records on one day (PR #170 review)', () => {
    it('drops an entered-in-error record before picking, not after merging', () => {
      const pivots = buildLabPivots([
        obs('K', '2026-09-18', 9.9, { unit: 'mmol/L', status: 'entered-in-error' }),
        // The merged cell's status becomes "entered-in-error|final".
        obs('K', '2026-09-18', 4.4, { unit: 'mmol/L', status: 'final' }),
      ])
      const latest = resolvePinnedLab(pivots, 'chem:K').latest
      expect(latest?.value).toBe('4.4')
      expect(latest?.sameDayCount).toBe(1)
    })

    it('keeps the picked value with its own unit', () => {
      const pivots = buildLabPivots([
        obs('CREA', '2026-09-18', 88.4, { unit: 'umol/L' }),
        obs('CREA', '2026-09-18', 1, { unit: 'mg/dL' }),
      ])
      const latest = resolvePinnedLab(pivots, 'chem:CREA').latest
      expect(latest?.value).toBe('88.4')
      expect(latest?.cell.unit).toBe('umol/L')
      expect(latest?.sameDayCount).toBe(2)
    })

    it('keeps the comparator and unit inside a qualitative + quantitative pair (review r2)', () => {
      const pivots = buildLabPivots([
        obs('CRP', '2026-09-18', 'Negative'),
        obs('CRP', '2026-09-18', 0.5, { unit: 'mg/dL', comparator: '<' }),
      ])
      const latest = resolvePinnedLab(pivots, 'chem:CRP').latest
      expect(latest?.value).toBe('Negative (<0.5)')
      expect(latest?.cell.unit).toBe('mg/dL')
      expect(latest?.sameDayCount).toBe(1)
    })

    it('keeps the picked value with its own comparator and flag', () => {
      const pivots = buildLabPivots([
        obs('CRP', '2026-09-18', 0.5, { unit: 'mg/dL', comparator: '<' }),
        obs('CRP', '2026-09-18', 3.2, { unit: 'mg/dL', interpretation: 'H' }),
      ])
      const latest = resolvePinnedLab(pivots, 'chem:CRP').latest
      expect(latest?.value).toBe('<0.5')
      expect(latest?.cell.isAbnormal).toBeFalsy()
      expect(latest?.cell.interpretationCode).toBeUndefined()
    })
  })
})
