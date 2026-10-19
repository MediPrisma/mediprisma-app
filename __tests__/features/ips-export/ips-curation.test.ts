import {
  curateForIps,
  LATEST_PER_ANALYTE_K,
  LOOKBACK_YEARS,
} from '@/features/ips-export/utils/ips-curation'
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import type { DataFilters, DataSelection } from '@/src/core/entities/clinical-context.entity'
import {
  DEFAULT_DATA_FILTERS,
  DEFAULT_DATA_SELECTION,
} from '@/src/shared/constants/data-selection.constants'

// A fixed "now" so time-range filtering is deterministic.
const NOW = new Date('2026-06-08T00:00:00Z')

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86400000).toISOString()
}

function emptyCollection(): ClinicalDataCollection {
  return {
    conditions: [],
    medications: [],
    medicationRemainingSummaries: [],
    allergies: [],
    observations: [],
    vitalSigns: [],
    diagnosticReports: [],
    imagingStudies: [],
    procedures: [],
    encounters: [],
    documentReferences: [],
    compositions: [],
    immunizations: [],
    consents: [],
    devices: [],
    carePlans: [],
  }
}

function selection(overrides: Partial<DataSelection> = {}): DataSelection {
  return { ...DEFAULT_DATA_SELECTION, ...overrides }
}

function filters(overrides: Partial<DataFilters> = {}): DataFilters {
  return { ...DEFAULT_DATA_FILTERS, ...overrides }
}

describe('curateForIps — time-range curation (labs / reports)', () => {
  it('drops diagnostic reports older than the lab time window', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'recent', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(30) },
      { id: 'old', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(800) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: '6m', labDepth: 'all' }),
      now: NOW,
    })
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(['recent'])
  })

  it('keeps only the latest report per panel when version=latest', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'cbc-old', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(40) },
      { id: 'cbc-new', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(5) },
      { id: 'lipid', code: { text: 'Lipid Panel' }, effectiveDateTime: isoDaysAgo(10) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: 'latest' }),
      now: NOW,
    })
    const ids = out.diagnosticReports.map((r) => r.id).sort()
    expect(ids).toEqual(['cbc-new', 'lipid'])
  })

  it('excludes lab reports entirely when the labReports category is unselected', () => {
    const data = emptyCollection()
    data.diagnosticReports = [{ id: 'cbc', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(1) }]
    const out = curateForIps({
      data,
      selection: selection({ labReports: false }),
      filters: filters(),
      now: NOW,
    })
    expect(out.diagnosticReports).toHaveLength(0)
  })
})

describe('curateForIps — labDepth + 2-year lookback + relax (IPS Results 語意)', () => {
  it('exports the expected constants (relax K=3, lookback 2y)', () => {
    expect(LATEST_PER_ANALYTE_K).toBe(3)
    expect(LOOKBACK_YEARS).toBe(2)
  })

  it('applies the 2-year lookback for ANY depth — decoupled from the depth value', () => {
    // 解耦決策:回溯窗是 IPS 層機制,不綁 depth 值。即使 depth='all'(全部),
    // 2 年前的報告仍被回溯窗剔除。
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'recent', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(30) },
      { id: 'over-2y', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(900) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: 'all' }),
      now: NOW,
    })
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(['recent'])
  })

  it('depth=8 keeps up to 8 reports per analyte within the lookback', () => {
    const data = emptyCollection()
    data.diagnosticReports = Array.from({ length: 10 }, (_, i) => ({
      id: `cbc-${i}`,
      code: { text: 'CBC' },
      effectiveDateTime: isoDaysAgo(i * 10 + 1), // all within 2y
    }))
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: '8' }),
      now: NOW,
    })
    // 10 readings, capped to the newest 8.
    expect(out.diagnosticReports).toHaveLength(8)
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(
      ['cbc-0', 'cbc-1', 'cbc-2', 'cbc-3', 'cbc-4', 'cbc-5', 'cbc-6', 'cbc-7'],
    )
  })

  it('keeps the latest 3 reports per analyte within the 2-year lookback', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'cbc-1', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(5) },
      { id: 'cbc-2', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(30) },
      { id: 'cbc-3', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(90) },
      { id: 'cbc-4', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(180) }, // 4th → dropped
      { id: 'cbc-ancient', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(900) }, // > 2y → dropped
      { id: 'lipid', code: { text: 'Lipid Panel' }, effectiveDateTime: isoDaysAgo(200) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: '3' }),
      now: NOW,
    })
    expect(out.diagnosticReports.map((r) => r.id).sort()).toEqual([
      'cbc-1', 'cbc-2', 'cbc-3', 'lipid',
    ])
  })

  it('applies the same latest-3 / 2-year semantics to orphan observations', () => {
    const data = emptyCollection()
    data.observations = [
      { id: 'k-1', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(1) },
      { id: 'k-2', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(10) },
      { id: 'k-3', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(20) },
      { id: 'k-4', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(40) }, // 4th → dropped
      { id: 'k-old', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(800) }, // > 2y → dropped
      { id: 'na', code: { text: 'Na' }, effectiveDateTime: isoDaysAgo(3) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: '3' }),
      now: NOW,
    })
    expect(out.observations.map((o) => o.id).sort()).toEqual(['k-1', 'k-2', 'k-3', 'na'])
  })

  it('still honors a narrower labReportTimeRange (intersection with the lookback)', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'recent', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(10) },
      { id: 'outside-window', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(300) }, // < 2y but > 6m
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: '6m', labDepth: '3' }),
      now: NOW,
    })
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(['recent'])
  })

  it('relaxes to latest-1-per-analyte / unbounded when NO labs fall within 2 years', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      { id: 'cbc-3y', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(1100) },
      { id: 'cbc-4y', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(1500) },
      { id: 'lipid-3y', code: { text: 'Lipid Panel' }, effectiveDateTime: isoDaysAgo(1200) },
    ]
    data.observations = [
      { id: 'k-old', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(1300) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: '3' }),
      now: NOW,
    })
    // 每項目最近 1 筆、不限時間。
    expect(out.diagnosticReports.map((r) => r.id).sort()).toEqual(['cbc-3y', 'lipid-3y'])
    expect(out.observations.map((o) => o.id)).toEqual(['k-old'])
  })

  it('does NOT relax when the 2-year window has ANY result (orphan obs only)', () => {
    const data = emptyCollection()
    // 報告都在 2 年前,但有一筆 2 年內的 orphan observation → 整體不為空,
    // 不放寬:舊報告不得復活。
    data.diagnosticReports = [
      { id: 'cbc-old', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(1100) },
    ]
    data.observations = [
      { id: 'k-recent', code: { text: 'K' }, effectiveDateTime: isoDaysAgo(30) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labReportTimeRange: 'all', labDepth: '3' }),
      now: NOW,
    })
    expect(out.diagnosticReports).toHaveLength(0)
    expect(out.observations.map((o) => o.id)).toEqual(['k-recent'])
  })

  it('yields nothing when the patient has no labs at all (no phantom relax)', () => {
    const data = emptyCollection()
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ labDepth: '3' }),
      now: NOW,
    })
    expect(out.diagnosticReports).toHaveLength(0)
    expect(out.observations).toHaveLength(0)
  })
})

describe('curateForIps — imaging reports honor the imagingReports toggle (P2)', () => {
  const imagingReport = (id: string, daysAgo: number) => ({
    id,
    code: { text: 'Chest X-ray' },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
    effectiveDateTime: isoDaysAgo(daysAgo),
  })

  it('drops imaging-category reports when imagingReports is OFF (labs unaffected)', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      imagingReport('xray', 10),
      { id: 'cbc', code: { text: 'CBC' }, effectiveDateTime: isoDaysAgo(10) },
    ]
    const out = curateForIps({
      data,
      selection: selection({ imagingReports: false }),
      filters: filters({ labReportTimeRange: 'all', labDepth: 'all' }),
      now: NOW,
    })
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(['cbc'])
  })

  it('filters imaging reports by the imaging time window, not the lab window', () => {
    const data = emptyCollection()
    data.diagnosticReports = [
      imagingReport('xray-recent', 30),
      imagingReport('xray-old', 800), // outside imagingReportTimeRange 1y
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({
        labReportTimeRange: 'all',
        labDepth: 'all',
        imagingReportTimeRange: '1y',
        imagingReportVersion: 'all',
      }),
      now: NOW,
    })
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(['xray-recent'])
  })

  it('excludes imaging reports from labReports gating and from the lab depth path', () => {
    const data = emptyCollection()
    data.diagnosticReports = [imagingReport('xray', 10)]
    const out = curateForIps({
      data,
      selection: selection({ labReports: false, imagingReports: true }),
      filters: filters({ labDepth: '3' }),
      now: NOW,
    })
    // labReports OFF 不影響影像報告。
    expect(out.diagnosticReports.map((r) => r.id)).toEqual(['xray'])
  })
})

describe('curateForIps — medications (現用藥 / 慢箋為主, deduped)', () => {
  it('preserves each real source order even when their drug names are identical', () => {
    const data = emptyCollection()
    data.medications = [
      {
        id: 'm1',
        status: 'active',
        authoredOn: isoDaysAgo(60),
        medicationCodeableConcept: { text: 'Amlodipine 5mg' },
      },
      {
        id: 'm2',
        status: 'active',
        authoredOn: isoDaysAgo(2),
        medicationCodeableConcept: { text: 'Amlodipine 5mg' },
      },
    ]
    const out = curateForIps({ data, selection: selection(), filters: filters(), now: NOW })
    expect(out.medications.map(medication => medication.id)).toEqual(['m1', 'm2'])
  })

  it('keeps a chronic prescription even if its latest cycle reads completed', () => {
    const data = emptyCollection()
    data.medications = [
      {
        id: 'chronic',
        status: 'completed',
        authoredOn: isoDaysAgo(10),
        medicationCodeableConcept: { text: 'Metformin 500mg' },
        courseOfTherapyType: { coding: [{ code: 'continuous' }] },
      },
      {
        id: 'finished-acute',
        status: 'completed',
        authoredOn: isoDaysAgo(10),
        medicationCodeableConcept: { text: 'Amoxicillin 250mg' },
      },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ medicationStatus: 'active' }),
      now: NOW,
    })
    expect(out.medications.map((m) => m.id)).toEqual(['chronic'])
  })

  it('honors the acute-only chronic filter', () => {
    const data = emptyCollection()
    data.medications = [
      {
        id: 'chronic',
        status: 'active',
        authoredOn: isoDaysAgo(5),
        medicationCodeableConcept: { text: 'Metformin 500mg' },
        courseOfTherapyType: { coding: [{ code: 'continuous' }] },
      },
      {
        id: 'acute',
        status: 'active',
        authoredOn: isoDaysAgo(5),
        medicationCodeableConcept: { text: 'Ibuprofen 400mg' },
      },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ medicationChronic: 'acute' }),
      now: NOW,
    })
    expect(out.medications.map((m) => m.id)).toEqual(['acute'])
  })
})

describe('curateForIps — problem list', () => {
  it('prefers problem-list-item conditions and filters to active', () => {
    const data = emptyCollection()
    data.conditions = [
      {
        id: 'pli-active',
        clinicalStatus: 'active',
        category: [{ coding: [{ code: 'problem-list-item' }] }],
        code: { text: 'Hypertension' },
      },
      {
        id: 'pli-resolved',
        clinicalStatus: 'resolved',
        category: [{ coding: [{ code: 'problem-list-item' }] }],
        code: { text: 'Old fracture' },
      },
      {
        id: 'encounter-dx',
        clinicalStatus: 'active',
        code: { text: 'Visit diagnosis' },
      },
    ]
    const out = curateForIps({
      data,
      selection: selection({ problemList: true }),
      filters: filters({ problemListStatus: 'active' }),
      now: NOW,
    })
    expect(out.conditions.map((c) => c.id)).toEqual(['pli-active'])
  })

  it('falls back to all conditions when none are tagged problem-list-item', () => {
    const data = emptyCollection()
    data.conditions = [
      { id: 'c1', clinicalStatus: 'active', code: { text: 'Diabetes' } },
      { id: 'c2', clinicalStatus: 'resolved', code: { text: 'Sprain' } },
    ]
    const out = curateForIps({
      data,
      selection: selection({ problemList: true }),
      filters: filters({ problemListStatus: 'active' }),
      now: NOW,
    })
    expect(out.conditions.map((c) => c.id)).toEqual(['c1'])
  })

  it('excludes the Problem List section entirely when problemList is off', () => {
    const data = emptyCollection()
    data.conditions = [
      { id: 'c1', clinicalStatus: 'active', code: { text: 'Diabetes' } },
    ]
    const out = curateForIps({
      data,
      selection: selection({ problemList: false }),
      filters: filters(),
      now: NOW,
    })
    expect(out.conditions).toEqual([])
  })
})

describe('curateForIps — problem list is text-only (no generated SNOMED CT)', () => {
  it('preserves source Condition.code coding and never attaches a derived _sct', () => {
    const data = emptyCollection()
    data.conditions = [
      {
        id: 'dm',
        clinicalStatus: 'active',
        category: [{ coding: [{ code: 'problem-list-item' }] }],
        code: {
          text: '第二型糖尿病',
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
        },
      },
      {
        id: 'uncoded',
        clinicalStatus: 'active',
        category: [{ coding: [{ code: 'problem-list-item' }] }],
        code: { text: 'Some uncoded problem', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'Z99.9' }] },
      },
    ]
    const out = curateForIps({
      data,
      selection: selection({ problemList: true }),
      filters: filters({ problemListStatus: 'active' }),
      now: NOW,
    })
    const dm = out.conditions.find((c) => c.id === 'dm')
    const uncoded = out.conditions.find((c) => c.id === 'uncoded')
    // No SNOMED CT annotation is ever added by curation.
    expect((dm as { _sct?: unknown })?._sct).toBeUndefined()
    expect((uncoded as { _sct?: unknown })?._sct).toBeUndefined()
    // The real source ICD-10 coding is preserved untouched.
    expect(dm?.code?.coding?.[0]).toMatchObject({ code: 'E11.9' })
  })
})

describe('curateForIps — Results observations (orphans only)', () => {
  it('drops observations already nested under a report and vital-sign observations', () => {
    const data = emptyCollection()
    // The data layer surfaces a report-member observation BOTH flat in
    // `observations` (same id) and nested under the report. It also lumps
    // vital-sign observations into the same flat list. Only the true orphan
    // should survive into the Results section.
    const member = { id: 'tsh', code: { text: 'TSH' }, effectiveDateTime: isoDaysAgo(1) }
    data.observations = [
      { id: 'orphan', code: { text: 'Free T4' }, effectiveDateTime: isoDaysAgo(1) },
      { ...member },
      {
        id: 'bp',
        code: { text: 'Blood Pressure' },
        category: [{ coding: [{ code: 'vital-signs' }] }],
        effectiveDateTime: isoDaysAgo(1),
      },
    ]
    data.diagnosticReports = [
      {
        id: 'panel',
        code: { text: 'Thyroid Panel' },
        effectiveDateTime: isoDaysAgo(1),
        _observations: [{ ...member }],
      },
    ]
    const out = curateForIps({
      data,
      // Orphan observations default OFF now — opt in for this dedup test
      selection: selection({ observations: true }),
      filters: filters({ labReportTimeRange: 'all', labDepth: 'all' }),
      now: NOW,
    })
    expect(out.observations.map((o) => o.id)).toEqual(['orphan'])
  })
})

describe('curateForIps — vitals & passthrough', () => {
  it('keeps only the latest vital per type when version=latest', () => {
    const data = emptyCollection()
    data.vitalSigns = [
      { id: 'bp-old', code: { text: 'Blood Pressure' }, effectiveDateTime: isoDaysAgo(20) },
      { id: 'bp-new', code: { text: 'Blood Pressure' }, effectiveDateTime: isoDaysAgo(1) },
      { id: 'hr', code: { text: 'Heart Rate' }, effectiveDateTime: isoDaysAgo(3) },
    ]
    const out = curateForIps({
      data,
      selection: selection(),
      filters: filters({ vitalSignsVersion: 'latest', vitalSignsTimeRange: 'all' }),
      now: NOW,
    })
    expect(out.vitalSigns.map((v) => v.id).sort()).toEqual(['bp-new', 'hr'])
  })

  it('keeps devices/carePlans/consents when their toggles are ON', () => {
    const data = emptyCollection()
    data.devices = [{ id: 'dev-1', type: { text: 'Pacemaker' } }]
    data.carePlans = [{ id: 'cp-1', title: 'Diabetes care', status: 'active' }]
    data.consents = [{ id: 'con-1', status: 'active' }]
    const out = curateForIps({ data, selection: selection(), filters: filters(), now: NOW })
    expect(out.devices).toHaveLength(1)
    expect(out.carePlans).toHaveLength(1)
    expect(out.consents).toHaveLength(1)
  })

  it('drops devices/carePlans/consents when their toggles are OFF', () => {
    const data = emptyCollection()
    data.devices = [{ id: 'dev-1', type: { text: 'Pacemaker' } }]
    data.carePlans = [{ id: 'cp-1', title: 'Diabetes care', status: 'active' }]
    data.consents = [{ id: 'con-1', status: 'active' }]
    const out = curateForIps({
      data,
      selection: selection({ medicalDevices: false, carePlans: false, advanceDirectives: false }),
      filters: filters(),
      now: NOW,
    })
    expect(out.devices).toHaveLength(0)
    expect(out.carePlans).toHaveLength(0)
    expect(out.consents).toHaveLength(0)
  })

  it('filters care plans to active when carePlanStatus=active', () => {
    const data = emptyCollection()
    data.carePlans = [
      { id: 'cp-active', title: 'Active plan', status: 'active' },
      { id: 'cp-done', title: 'Completed plan', status: 'completed' },
    ]
    const activeOnly = curateForIps({ data, selection: selection(), filters: filters({ carePlanStatus: 'active' }), now: NOW })
    expect(activeOnly.carePlans.map((c) => c.id)).toEqual(['cp-active'])
    const all = curateForIps({ data, selection: selection(), filters: filters({ carePlanStatus: 'all' }), now: NOW })
    expect(all.carePlans.map((c) => c.id).sort()).toEqual(['cp-active', 'cp-done'])
  })

  it('empties allergies when the allergies category is unselected', () => {
    const data = emptyCollection()
    data.allergies = [{ id: 'a1', code: { text: 'Penicillin' } }]
    const out = curateForIps({
      data,
      selection: selection({ allergies: false }),
      filters: filters(),
      now: NOW,
    })
    expect(out.allergies).toHaveLength(0)
  })
})
