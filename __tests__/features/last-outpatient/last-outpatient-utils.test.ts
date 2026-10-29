import {
  buildPriorLabValues,
  hasHospitalOutpatientVisit,
  isHospitalOutpatientEncounter,
  isHospitalSourcedEncounter,
  isSameClinician,
  normalizeClinicianName,
  orderingVisitIds,
  recentHospitalPhysicians,
  displayClinicianName,
  resultsOrderedAt,
} from '@/features/clinical-summary/last-outpatient/utils/last-outpatient'

const HOSPITAL_META = {
  source: 'https://web9.vghtpe.gov.tw/emr/qemr/',
  tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }],
}
const CLOUD_META = { source: 'https://medcloud2.nhi.gov.tw/imme0008/IMME0008S01' }

const encounter = (id: string, meta: any, overrides: Record<string, unknown> = {}) => ({
  resourceType: 'Encounter',
  id,
  meta,
  status: 'finished',
  class: { code: 'AMB' },
  period: { start: '2026-10-09T09:10:00+08:00' },
  ...overrides,
})

const creatinine = (id: string, value: number, date: string, extra: Record<string, unknown> = {}) => ({
  resourceType: 'Observation',
  id,
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }], text: 'Creatinine' },
  valueQuantity: { value, unit: 'mg/dL' },
  effectiveDateTime: date,
  ...extra,
})

describe('hospital outpatient visibility', () => {
  it('shows the tab only for a chart with a hospital outpatient visit', () => {
    const cloudOnly = [encounter('cloud-1', CLOUD_META), encounter('cloud-2', CLOUD_META)]
    expect(hasHospitalOutpatientVisit(cloudOnly)).toBe(false)
    expect(hasHospitalOutpatientVisit([])).toBe(false)
    expect(hasHospitalOutpatientVisit(undefined)).toBe(false)

    expect(hasHospitalOutpatientVisit([...cloudOnly, encounter('hospital-1', HOSPITAL_META)])).toBe(true)
  })

  it('does not count a hospital admission, emergency visit or a voided outpatient record', () => {
    expect(hasHospitalOutpatientVisit([
      encounter('imp', HOSPITAL_META, { class: { code: 'IMP' } }),
      encounter('emer', HOSPITAL_META, { class: { code: 'EMER' } }),
      encounter('cancelled', HOSPITAL_META, { status: 'cancelled' }),
      encounter('undated', HOSPITAL_META, { period: undefined }),
    ])).toBe(false)
  })

  it('counts a hospital visit that import merged into its cloud record', () => {
    const merged = encounter('cloud-merged', {
      ...CLOUD_META,
      tag: [{ system: 'urn:wildcatch:reconciliation', code: 'cloud-vghtpe-outpatient' }],
    }, { _sourceEncounterRecords: [encounter('hospital-copy', HOSPITAL_META), encounter('cloud-copy', CLOUD_META)] })
    expect(isHospitalSourcedEncounter(merged)).toBe(true)
    expect(isHospitalOutpatientEncounter(merged)).toBe(true)

    const tagOnly = encounter('cloud-tagged', {
      ...CLOUD_META,
      tag: [{ system: 'urn:wildcatch:reconciliation', code: 'cloud-vghtpe-outpatient' }],
    })
    expect(isHospitalSourcedEncounter(tagOnly)).toBe(true)
    expect(isHospitalSourcedEncounter(encounter('plain-cloud', CLOUD_META))).toBe(false)
  })
})

describe('clinician name matching', () => {
  it('folds width, spacing and a trailing title', () => {
    expect(normalizeClinicianName(' 王 志明 醫師 ')).toBe('王志明')
    expect(isSameClinician('王志明', '王志明醫師')).toBe(true)
    expect(isSameClinician('Dr. Wang', 'wang')).toBe(true)
  })

  it('never matches a different or empty name', () => {
    expect(isSameClinician('王志明', '王志銘')).toBe(false)
    expect(isSameClinician('王志明', '王志')).toBe(false)
    expect(isSameClinician('', '')).toBe(false)
    expect(isSameClinician(undefined, '王志明')).toBe(false)
  })
})

describe('result attribution', () => {
  const linked = creatinine('linked', 1.1, '2026-10-09', { encounter: { reference: 'Encounter/hospital-1' } })
  const inferred = creatinine('inferred', 1.2, '2026-10-09', {
    encounter: { reference: 'Encounter/hospital-1' },
    _encounterInferred: true,
  })
  const unlinked = creatinine('unlinked', 1.3, '2026-10-09')
  // A combined draw: one request served two same-day visits' orders.
  const shared = creatinine('shared', 1.4, '2026-10-09', { _orderEncounterIds: ['hospital-1', 'hospital-2'] })

  it('counts the source link and the orders, never a date-inferred link', () => {
    expect(orderingVisitIds(linked)).toEqual(['hospital-1'])
    expect(orderingVisitIds(inferred)).toEqual([])
    expect(orderingVisitIds(unlinked)).toEqual([])
    expect(orderingVisitIds(shared)).toEqual(['hospital-1', 'hospital-2'])
  })

  it('places a shared result under every visit that ordered it, and marks it shared', () => {
    const first = resultsOrderedAt([linked, inferred, unlinked, shared], new Set(['hospital-1']), 'hospital-1')
    expect(first.results.map((item) => item.id)).toEqual(['linked', 'shared'])
    expect([...first.shared]).toEqual(['shared'])
    expect(first.results.every((item) => item.encounter?.reference === 'Encounter/hospital-1')).toBe(true)

    const second = resultsOrderedAt([linked, inferred, unlinked, shared], new Set(['hospital-2']), 'hospital-2')
    expect(second.results.map((item) => item.id)).toEqual(['shared'])
    expect(second.results[0].encounter?.reference).toBe('Encounter/hospital-2')
  })

  it('treats the source records a visit was projected from as the same visit', () => {
    const projected = resultsOrderedAt([shared], new Set(['visit', 'hospital-1', 'hospital-2']), 'visit')
    expect(projected.results.map((item) => item.id)).toEqual(['shared'])
    expect(projected.shared.size).toBe(0)
  })
})

describe('previous lab values', () => {
  it('uses the latest result from an earlier day, never a same-day copy', () => {
    const prior = buildPriorLabValues([
      creatinine('old', 0.94, '2026-04-02T08:00:00+08:00'),
      creatinine('mid', 1.12, '2026-07-10T08:00:00+08:00'),
      creatinine('now-hospital', 1.26, '2026-10-09T09:40:00+08:00'),
      creatinine('now-cloud', 1.26, '2026-10-09T09:40:00+08:00'),
    ], [])

    expect(prior.get('now-hospital')).toEqual({ value: '1.12', date: '2026-07-10' })
    expect(prior.get('now-cloud')).toEqual({ value: '1.12', date: '2026-07-10' })
    expect(prior.get('mid')).toEqual({ value: '0.94', date: '2026-04-02' })
    expect(prior.has('old')).toBe(false)
  })

  it('reads results held inside a lab report too', () => {
    const prior = buildPriorLabValues([], [
      { resourceType: 'DiagnosticReport', id: 'dr-old', _observations: [creatinine('a', 1.0, '2026-07-10')] },
      { resourceType: 'DiagnosticReport', id: 'dr-new', _observations: [creatinine('b', 1.3, '2026-10-09')] },
    ])
    expect(prior.get('b')).toEqual({ value: '1', date: '2026-07-10' })
  })
})

describe('recent hospital physicians', () => {
  const doctor = (id: string, date: string, name: string, department: string, meta: any = HOSPITAL_META, extra: Record<string, unknown> = {}) =>
    encounter(id, meta, { period: { start: `${date}T09:00:00+08:00` }, participant: [{ individual: { display: name } }], serviceType: { text: department }, ...extra })

  it('lists this chart\'s hospital physicians of the past year, newest first, without staff codes', () => {
    const list = recentHospitalPhysicians([
      doctor('a1', '2026-10-09', '陳怡君 (DOC0001A)', '心臟內科'),
      doctor('a2', '2026-07-10', '陳怡君(DOC0001A)', '心臟內科'),
      doctor('b1', '2026-10-20', '李建國 (DOC0002B)', '腎臟內科'),
      doctor('old', '2025-09-01', '張舊 (DOC0003C)', '家醫科'),
      doctor('cloud', '2026-10-25', '雲端醫師', '家醫科', CLOUD_META),
      doctor('imp', '2026-10-01', '住院醫師', '內科', HOSPITAL_META, { class: { code: 'IMP' } }),
    ], new Date('2026-10-28T00:00:00+08:00'))
    expect(list).toEqual([
      { name: '李建國', departments: ['腎臟內科'], visits: 1, lastVisit: '2026-10-20' },
      { name: '陳怡君', departments: ['心臟內科'], visits: 2, lastVisit: '2026-10-09' },
    ])
  })

  it('treats a staff code as part of the record, not of the name', () => {
    expect(displayClinicianName('王志明 (DOC1234A)')).toBe('王志明')
    expect(isSameClinician('王志明 (DOC1234A)', '王志明')).toBe(true)
  })
})
