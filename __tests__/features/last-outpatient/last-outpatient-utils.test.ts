import {
  buildPriorLabValues,
  hasHospitalOutpatientVisit,
  isHospitalOutpatientEncounter,
  isHospitalSourcedEncounter,
  isSameClinician,
  normalizeClinicianName,
  withSourceEncounterLink,
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
  it('keeps source-linked results and drops date-inferred links', () => {
    const linked = creatinine('linked', 1.1, '2026-10-09', { encounter: { reference: 'Encounter/hospital-1' } })
    const inferred = creatinine('inferred', 1.2, '2026-10-09', {
      encounter: { reference: 'Encounter/hospital-1' },
      _encounterInferred: true,
    })
    const unlinked = creatinine('unlinked', 1.3, '2026-10-09')
    expect(withSourceEncounterLink([linked, inferred, unlinked]).map((item) => item.id)).toEqual(['linked'])
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
