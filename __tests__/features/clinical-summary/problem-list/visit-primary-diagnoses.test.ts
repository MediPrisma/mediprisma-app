import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { buildVisitPrimaryDiagnoses } from '@/features/clinical-summary/problem-list/utils/visit-primary-diagnoses'

const ICD = 'http://hl7.org/fhir/sid/icd-10-cm'

function visit(
  id: string,
  start: string,
  codes: Array<[string, string]>,
  extra: Partial<EncounterEntity> = {},
): EncounterEntity {
  return {
    id,
    class: { code: 'AMB' },
    period: { start },
    reasonCode: codes.map(([code, text]) => ({ text, coding: [{ system: ICD, code }] })),
    ...extra,
  }
}

describe('buildVisitPrimaryDiagnoses', () => {
  it('takes only reasonCode[0], never the secondary diagnoses', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [visit('e1', '2026-03-01', [['E11.9', '第二型糖尿病'], ['E78.5', '高血脂症'], ['I10', '高血壓']])],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['E11.9'])
  })

  it('merges repeat visits into one row with count, earliest and latest date', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [
        visit('e2', '2026-06-10', [['E11.9', '第二型糖尿病']]),
        visit('e1', '2025-10-03', [['E11.9', '第二型糖尿病']]),
        visit('e3', '2026-09-10', [['E119', '第二型糖尿病']]),
      ],
      [],
      'zh-TW',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'E119',
      visitCount: 3,
      firstDate: '2025-10-03',
      lastDate: '2026-09-10',
      description: '第二型糖尿病',
      inpatient: false,
      chronicity: 'chronic',
    })
  })

  it('keeps different specificity as separate rows (N18.3 → N18.5 stays visible)', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [visit('e1', '2025-11-01', [['N18.3', 'CKD 3']]), visit('e2', '2026-08-01', [['N18.5', 'CKD 5']])],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code).sort()).toEqual(['N18.3', 'N18.5'])
  })

  it('sorts by visit count, then by latest visit', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [
        visit('a1', '2025-10-01', [['J06.9', 'URI']]),
        visit('b1', '2026-01-01', [['I10', 'HTN']]),
        visit('b2', '2026-02-01', [['I10', 'HTN']]),
        visit('c1', '2026-09-01', [['M54.5', 'LBP']]),
      ],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['I10', 'M54.5', 'J06.9'])
  })

  it('flags a code seen on an admission', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [
        visit('e1', '2026-01-01', [['J18.9', '肺炎']]),
        visit('e2', '2026-01-05', [['J18.9', '肺炎']], { class: { code: 'IMP' } }),
      ],
      [],
      'zh-TW',
    )
    expect(rows[0].inpatient).toBe(true)
  })

  it('leaves codes already on a Condition to the Condition list', () => {
    const conditions: ConditionEntity[] = [
      { id: 'c1', code: { text: '惡性腫瘤', coding: [{ system: ICD, code: 'C50.911' }] } },
    ]
    const rows = buildVisitPrimaryDiagnoses(
      [visit('e1', '2026-01-01', [['C50911', '乳癌']]), visit('e2', '2026-02-01', [['I10', 'HTN']])],
      conditions,
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['I10'])
  })

  it('ignores cancelled / entered-in-error visits and non-ICD primary codes', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [
        visit('e1', '2026-01-01', [['I10', 'HTN']], { status: 'entered-in-error' }),
        visit('e2', '2026-01-02', [['E11.9', 'DM']], { status: 'cancelled' }),
        {
          id: 'e3',
          period: { start: '2026-01-03' },
          reasonCode: [{ coding: [{ system: 'http://snomed.info/sct', code: '38341003' }] }],
        },
        { id: 'e4', period: { start: '2026-01-04' } },
        { id: 'e5', period: { start: '2026-01-05' }, reasonCode: [{ text: '門診追蹤' }] },
      ],
      [],
      'zh-TW',
    )
    expect(rows).toEqual([])
  })

  it('reads the older bridge format where codes sit comma-separated in text', () => {
    const rows = buildVisitPrimaryDiagnoses(
      [{ id: 'e1', period: { start: '2026-01-01' }, reasonCode: [{ text: 'C50.912,N95.1' }] }],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['C50.912'])
  })
})
