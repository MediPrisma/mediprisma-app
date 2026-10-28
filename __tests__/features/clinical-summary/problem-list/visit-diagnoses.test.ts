import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'
import { buildVisitDiagnoses, isVisitCodeCondition } from '@/features/clinical-summary/problem-list/utils/visit-diagnoses'

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

const VGH = { source: 'https://web9.vghtpe.gov.tw/emr/qemr/' }
const CLOUD = { source: 'https://medcloud2.nhi.gov.tw/' }
const ENCOUNTER_DX = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis' }] }]

function hospitalDx(id: string, encounterId: string, day: string, code: string, display: string): ConditionEntity {
  return {
    id,
    meta: VGH,
    category: ENCOUNTER_DX,
    code: { coding: [{ system: ICD, code, display }] },
    recordedDate: day,
    encounter: { reference: `https://example.invalid/fhir/Encounter/${encounterId}` },
  } as ConditionEntity
}

describe('buildVisitDiagnoses', () => {
  it('takes only reasonCode[0], never the secondary diagnoses', () => {
    const rows = buildVisitDiagnoses(
      [visit('e1', '2026-03-01', [['E11.9', '第二型糖尿病'], ['E78.5', '高血脂症'], ['I10', '高血壓']])],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['E11.9'])
  })

  it('merges repeat visits into one row with count, earliest and latest date', () => {
    const rows = buildVisitDiagnoses(
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
    const rows = buildVisitDiagnoses(
      [visit('e1', '2025-11-01', [['N18.3', 'CKD 3']]), visit('e2', '2026-08-01', [['N18.5', 'CKD 5']])],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code).sort()).toEqual(['N18.3', 'N18.5'])
  })

  it('sorts by visit count, then by latest visit', () => {
    const rows = buildVisitDiagnoses(
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
    const rows = buildVisitDiagnoses(
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
    const rows = buildVisitDiagnoses(
      [visit('e1', '2026-01-01', [['C50911', '乳癌']]), visit('e2', '2026-02-01', [['I10', 'HTN']])],
      conditions,
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['I10'])
  })

  it('ignores cancelled / entered-in-error visits and non-ICD primary codes', () => {
    const rows = buildVisitDiagnoses(
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
    const rows = buildVisitDiagnoses(
      [{ id: 'e1', period: { start: '2026-01-01' }, reasonCode: [{ text: 'C50.912,N95.1' }] }],
      [],
      'zh-TW',
    )
    expect(rows.map((r) => r.code)).toEqual(['C50.912'])
  })

  it('merges hospital visit Conditions and 雲端 claims into one row per code', () => {
    const conditions = [
      hospitalDx('c1', 'vgh-0507', '2026-05-07', 'C50.912', 'Malignant neoplasm of unspecified site of left female breast'),
      hospitalDx('c2', 'vgh-0303', '2026-03-03', 'C50.912', 'Malignant neoplasm of unspecified site of left female breast'),
    ]
    const hospitalVisit = (id: string, start: string, ranks: string[]): EncounterEntity => ({
      id, meta: VGH, class: { code: 'AMB' }, period: { start },
      serviceProvider: { display: '臺北榮總' }, serviceType: { text: '146(乳醫中心門診 )' },
      diagnosis: ranks.map((conditionId, index) => ({ condition: { reference: `Condition/${conditionId}` }, rank: index + 1 })),
    } as EncounterEntity)
    const cloud = (id: string, start: string) => visit(id, `${start}T00:00:00+08:00`, [['C50.912', '左側女性乳房未明示部位惡性腫瘤']],
      { meta: CLOUD, serviceProvider: { display: '臺北榮總;門診;0601160016' } } as Partial<EncounterEntity>)
    const rows = buildVisitDiagnoses(
      [hospitalVisit('vgh-0507', '2026-05-07T17:36:52+08:00', ['c1']), hospitalVisit('vgh-0303', '2026-03-03T14:16:12+08:00', ['c2']),
        cloud('m1', '2026-06-24'), cloud('m2', '2026-05-07'), cloud('m3', '2025-11-17')],
      conditions,
      'zh-TW',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'C50912',
      description: '左側女性乳房未明示部位惡性腫瘤',
      // 5/7 was seen by both sources: one visit, not two.
      visitCount: 4,
      firstDate: '2025-11-17',
      lastDate: '2026-06-24',
      hospital: true,
      secondaryOnly: false,
      institutions: ['臺北榮總'],
      conditionIds: ['c1', 'c2'],
    })
    const may = rows[0].visits.find((v) => v.day === '2026-05-07')!
    expect(may.sources.sort()).toEqual(['cloud', 'hospital'])
    expect(may.department).toBe('乳醫中心門診')
    expect(may.originalText).toBe('Malignant neoplasm of unspecified site of left female breast')
    // A hospital-only visit keeps its English wording beside the Chinese row name.
    expect(rows[0].visits.find((v) => v.day === '2026-03-03')).toMatchObject({
      sources: ['hospital'],
      originalText: 'Malignant neoplasm of unspecified site of left female breast',
    })
    expect(rows[0].visits.find((v) => v.day === '2026-06-24')?.originalText).toBeUndefined()
  })

  it('marks a code the hospital only ever gave as a secondary diagnosis', () => {
    const conditions = [
      hospitalDx('c1', 'v1', '2026-03-03', 'C50.912', 'Breast cancer'),
      hospitalDx('c2', 'v1', '2026-03-03', 'N95.1', 'Menopausal and female climacteric states'),
    ]
    const rows = buildVisitDiagnoses(
      [{ id: 'v1', meta: VGH, period: { start: '2026-03-03' }, reasonCode: [{ text: 'C50.912,N95.1' }],
        diagnosis: [{ condition: { reference: 'Condition/c1' }, rank: 1 }, { condition: { reference: 'Condition/c2' }, rank: 2 }] } as EncounterEntity],
      conditions,
      'zh-TW',
    )
    expect(rows.map((r) => [r.code, r.secondaryOnly, r.visitCount])).toEqual([['C50.912', false, 1], ['N95.1', true, 1]])
  })

  it('folds diabetes codes into one row and counts each visit once', () => {
    const rows = buildVisitDiagnoses(
      [
        visit('e1', '2026-01-02', [['E11.9', '第二型糖尿病，未伴有併發症']]),
        visit('e2', '2026-01-23', [['E11.9', '第二型糖尿病，未伴有併發症']]),
        visit('e3', '2025-10-14', [['E11.65', '第二型糖尿病，伴有高血糖']]),
      ],
      [],
      'zh-TW',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'E11',
      code: 'E11.9',
      description: '第二型糖尿病',
      visitCount: 3,
      firstDate: '2025-10-14',
      lastDate: '2026-01-23',
      variants: [
        { code: 'E11.9', description: '第二型糖尿病，未伴有併發症', visitCount: 2 },
        { code: 'E11.65', description: '第二型糖尿病，伴有高血糖', visitCount: 1 },
      ],
    })
  })

  it('keeps a statused Condition on the recorded list and its code out of the visits', () => {
    const recorded = { ...hospitalDx('c1', 'v1', '2026-01-01', 'I10', 'HTN'), clinicalStatus: 'active' } as ConditionEntity
    expect(isVisitCodeCondition(recorded)).toBe(false)
    expect(isVisitCodeCondition(hospitalDx('c2', 'v1', '2026-01-01', 'I10', 'HTN'))).toBe(true)
    expect(isVisitCodeCondition({ id: 'c3', code: { coding: [{ system: ICD, code: 'I10' }] } })).toBe(false)
    expect(isVisitCodeCondition({ ...hospitalDx('c4', 'v1', '2026-01-01', 'I10', 'HTN'),
      code: { coding: [{ system: 'http://snomed.info/sct', code: '38341003' }] } })).toBe(false)
    const rows = buildVisitDiagnoses([visit('e1', '2026-02-01', [['I10', 'HTN']])], [recorded], 'zh-TW')
    expect(rows).toEqual([])
  })
})
