import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { calculateReportTabCounts } from '@/features/clinical-summary/reports/utils/report-tab-counts'
import { imagingReportsCategory } from '@/src/core/categories/imaging-reports.category'
import { normalizeImagingReportCopy, reportDisplayGroupingKeys, visibleReportGroupingKeys } from '@/src/shared/utils/report-copy-grouping'
import { NHI_VIEWER_REQUEST_EXTENSION_URL } from '@/features/clinical-summary/reports/utils/nhi-viewer-request'
import { getReportDate } from '@/src/shared/utils/report-identity'
import { NHI_MEDICLOUD_SOURCE_EXTENSION_URL } from '@/src/shared/utils/observation-provenance.utils'
import { renderHook } from '@testing-library/react'
import { useEncounterDetails } from '@/features/clinical-summary/visit-history/hooks/useEncounterDetails'
import { formatDate } from '@/src/shared/utils/fhir-helpers'

const BODY = 'Synthetic imaging finding: a 4 mm nodule in the left upper lobe is unchanged. No pleural effusion. Follow-up imaging in twelve months is recommended.'
const FOOTER = ' Reported By Example Radiologist(LicenseRD#:0000) On:2026/06/25(10:30:00),(by Example Radiologist)At:TEST01Positive Rate Evaluation 2'
function pair(): any[] {
  const common = { resourceType: 'DiagnosticReport', status: 'final', subject: { reference: 'Patient/synthetic' }, effectiveDateTime: '2026-06-24', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }] }
  return [
    { ...common, id: 'hospital', code: { text: 'CT/SCAN- CHEST', coding: [{ system: 'urn:oid:his.report.code', code: 'CTCHEST' }] },
      meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
      performer: [{ display: 'DOC00000 Example' }], conclusion: `Impression ${BODY}${FOOTER}` },
    { ...common, id: 'cloud', code: { text: '電腦斷層造影－有造影劑 (Computed tomography)', coding: [{ system: 'https://example.test/order', code: '33072B' }] },
      meta: { source: 'https://medcloud2.nhi.gov.tw/' }, performer: [{ display: '臺北榮總' }], conclusion: `Impression ${BODY}` },
  ]
}

describe('cross-source imaging reports', () => {
  it('retains the evaluation footer even when the cloud copy has more whitespace', () => {
    const reports = pair()
    reports[1].conclusion = BODY.replaceAll(' ', '  \n  ')
    const row = buildReportsData(reports).reportRows[0]
    expect(row.obs.some(obs => obs.valueString?.includes('Positive Rate Evaluation 2'))).toBe(true)
    const changed = { ...reports[1], conclusion: `${BODY}${FOOTER.replace('Evaluation 2', 'Evaluation 3')}` }
    expect(buildReportsData([reports[0], changed]).reportRows).toHaveLength(2)
    changed.conclusion = changed.conclusion.replace('Evaluation 3', 'Evaluation ３')
    expect(buildReportsData([reports[0], changed]).reportRows).toHaveLength(2)
  })

  it.each([null, { code: 123 }])('keeps malformed order codes from breaking the row projection: %j', coding => {
    const report = { ...pair()[0], code: { text: 'CT CHEST', coding: [coding] } }
    expect(() => buildReportsData([report])).not.toThrow()
    expect(getReportDate(report)).toBe('2026-06-24')
    expect(() => buildReportsData([{ ...report, category: undefined }])).not.toThrow()
  })

  it('restores a same-source shared-procedure group when the cloud source is filtered out', () => {
    const reports = pair().map(report => ({ ...report, encounter: { reference: 'Encounter/a' } }))
    const second = { ...reports[0], id: 'hospital-procedure-two', code: { text: 'CT CHEST' } }
    const full = [...reports, second]
    const keys = reportDisplayGroupingKeys(full)
    expect(keys.get(reports[0])).toMatch(/^cross-source\|/)
    const visibleKeys = visibleReportGroupingKeys([reports[0], second], keys)
    expect(visibleKeys.get(reports[0])).toBe(visibleKeys.get(second))
    expect(visibleKeys.get(reports[0])).not.toMatch(/^cross-source\|/)
  })

  it.each([
    { code: { text: 'CT CHEST', coding: [null] } },
    { code: { text: 'CT CHEST', coding: [{ code: 123 }] } },
    { meta: { tag: [null] } },
    { performer: [null] },
    { _observations: [null] },
    { presentedForm: [null] },
    { identifier: [null] },
  ])('keeps malformed imported metadata from breaking grouping: %j', invalid => {
    const reports = pair()
    Object.assign(reports[0], invalid)
    expect(() => reportDisplayGroupingKeys(reports)).not.toThrow()
    expect(reportDisplayGroupingKeys(reports).size).toBe(0)
  })

  it('does not label a signing-only date as an examination date in AI context', () => {
    const report = { ...pair()[0], effectiveDateTime: undefined, issued: '2030-01-19', conclusion: BODY }
    const section = imagingReportsCategory.getContextSection([report], { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }, {} as any)
    expect(JSON.stringify(section)).not.toContain(new Date(report.issued).toLocaleDateString())
  })

  it('renders a lone visible source normally with full-set grouping keys', () => {
    const reports = pair()
    const row = buildReportsData([reports[0]], [], 'standardized', 'medical', 'en', reportDisplayGroupingKeys(reports)).reportRows[0]
    expect(row.sharedReportSources).toBeUndefined()
    expect(row.institution).toBe('DOC00000 Example')
  })

  it('uses the same Taiwan examination day for UTC and local copies', () => {
    const reports = pair()
    reports[0].effectiveDateTime = '2026-06-24T23:30:00Z'
    reports[1].effectiveDateTime = '2026-06-25T07:30:00+08:00'
    expect(getReportDate(reports[0])?.slice(0, 10)).toBe('2026-06-25')
    const rows = buildReportsData(reports).reportRows
    expect(rows).toHaveLength(1)
    expect(rows[0].effectiveDate?.slice(0, 10)).toBe('2026-06-25')
    const filters = { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }
    for (const input of [reports, [reports[0]]]) {
      const section = imagingReportsCategory.getContextSection(input, filters, {} as any)
      const heading = section && !Array.isArray(section) ? section.items[0] : ''
      expect(heading).toContain(formatDate('2026-06-25'))
    }
  })

  it('preserves the source timezone of unrelated imaging reports', () => {
    const report = { ...pair()[0], meta: {}, effectiveDateTime: '2026-06-24T20:00:00-04:00' }
    expect(getReportDate(report)).toBe(report.effectiveDateTime)
  })

  it('retains existing shared pathology groups when a different imaging record is malformed', () => {
    const pathology = pair().map((report, index) => ({ ...report, code: { text: `Pathology ${index}` },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'PAT' }] }],
      encounter: { reference: 'Encounter/pathology' }, performer: [{ display: 'Example hospital' }], conclusion: BODY,
    }))
    const invalid = { ...pair()[0], identifier: [null] }
    const keys = reportDisplayGroupingKeys([...pathology, invalid, pair()[1]])
    expect(keys.has(pathology[0])).toBe(true)
    expect(keys.get(pathology[0])).toBe(keys.get(pathology[1]))
    expect(keys.has(invalid)).toBe(false)
  })

  it('does not label duplicate copies of one visible procedure as a shared-procedure group', () => {
    const reports = pair().map((report, index) => ({ ...report, code: { text: `Pathology ${index}` },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'PAT' }] }],
      encounter: { reference: 'Encounter/pathology' }, performer: [{ display: 'Example hospital' }], conclusion: BODY,
    }))
    const duplicate = { ...reports[0], id: 'duplicate-pathology' }
    const keys = reportDisplayGroupingKeys([...reports, duplicate])
    const rows = buildReportsData([reports[0], duplicate], [], 'standardized', 'medical', 'en', keys).reportRows
    expect(rows).toHaveLength(1)
    expect(rows[0].sharedReportSources).toBeUndefined()
    const extracted = imagingReportsCategory.extractData({ diagnosticReports: [...reports, duplicate] } as any)
      .filter(report => report.id !== reports[1].id)
    const filters = { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }
    expect(imagingReportsCategory.getCount(extracted, filters, {} as any)).toBe(2)
    const section = imagingReportsCategory.getContextSection(extracted, filters, {} as any)
    expect(JSON.stringify(section)).not.toContain('[shared narrative; count once]')
  })

  it('keeps a filtered encounter and AI subset ambiguous when another source candidate exists', () => {
    const reports = pair().map(report => ({ ...report, encounter: { reference: 'Encounter/a' }, _encounterInferred: true }))
    const other = { ...reports[0], id: 'repeated-hospital', encounter: { reference: 'Encounter/b' } }
    const full = [...reports, other]
    expect(buildReportsData(reports, [], 'standardized', 'medical', 'en', reportDisplayGroupingKeys(full)).reportRows).toHaveLength(2)
    const { result } = renderHook(() => useEncounterDetails([], full, [], [], [], [], 'en', 'medical'))
    expect(result.current.get('a')?.reports).toHaveLength(2)
    const extracted = imagingReportsCategory.extractData({ diagnosticReports: full } as any)
      .filter(report => report.id !== other.id)
    const filters = { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }
    expect(imagingReportsCategory.getCount(extracted, filters, {} as any)).toBe(2)
    const section = imagingReportsCategory.getContextSection(extracted, filters, {} as any)
    expect(JSON.stringify(section)).not.toContain('[shared narrative; count once]')
  })

  it.each([
    [['健保署', '臺北榮總'], 2],
    [['臺北榮總'], 1],
  ])('preserves existing laboratory count boundaries for performers %j', (names, expected) => {
    const reports = pair().map(report => ({ ...report,
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }],
      code: { text: 'CBC' }, performer: [{ display: '臺北榮總' }],
      _observations: [{ id: `${report.id}-wbc`, code: { text: 'WBC' }, valueQuantity: { value: 5 }, performer: [{ display: '臺北榮總' }] }],
    }))
    Object.assign(reports[1]._observations[0], {
      performer: (names as string[]).map(display => ({ display })),
      extension: [{ url: NHI_MEDICLOUD_SOURCE_EXTENSION_URL, valueCodeableConcept: { coding: [{ code: 'nhi-medicloud' }] } }],
    })
    expect(calculateReportTabCounts(reports).all).toBe(expected)
  })

  it('groups different titles and wrappers without changing resources', () => {
    const reports = pair()
    const before = JSON.stringify(reports)
    const { reportRows } = buildReportsData(reports)
    expect(reportRows).toHaveLength(1)
    expect(reportRows[0].diagnosticReportIds).toEqual(['hospital', 'cloud'])
    expect(reportRows[0].hospitalSource).toBe('cloud-and-in-house')
    expect(reportRows[0].institution).toBe('臺北榮總')
    expect(reportRows[0].sharedReportSources?.map(source => source.narrative)).toEqual(reports.map(report => report.conclusion))
    expect(reportRows[0].obs.filter(obs => obs.valueString?.includes(BODY))).toHaveLength(1)
    expect(JSON.stringify(reports)).toBe(before)
  })

  it('normalizes only known wrappers and keeps a conflicting BI-RADS grade', () => {
    const text = 'BI-RADS category 2. Synthetic benign breast findings with no suspicious mass or calcification. Annual ultrasound follow-up is recommended.'
    const signature = ' Reported By Example(License #:TEST) On:2026/06/25(10:30:00),(by Example)At:TEST01ACR BI-RADS 2'
    expect(normalizeImagingReportCopy(text + signature)).toBe(normalizeImagingReportCopy(text))
    const breastHeader = 'SONOGRAM BREAST Date Of Examination:2026/06/24 11:30:00 Date Of RCP:2026/06/24 '
    expect(normalizeImagingReportCopy(breastHeader + text + signature)).toBe(normalizeImagingReportCopy(text))
    expect(normalizeImagingReportCopy(breastHeader + text + signature.replace('BI-RADS 2', 'BI-RADS 4'))).not.toBe(normalizeImagingReportCopy(text))
    expect(normalizeImagingReportCopy(text + signature.replace('BI-RADS 2', 'BI-RADS 4'))).not.toBe(normalizeImagingReportCopy(text))
    const header = 'SONOGRAM, HEPATOBILIARY SYSTEM Date Of Examination:2026/06/24 14:13:10 Date Of RCP:2026/06/24 '
    expect(normalizeImagingReportCopy(header + BODY)).toBe(normalizeImagingReportCopy(BODY))
    expect(normalizeImagingReportCopy(BODY.replace('4 mm', '5 mm'))).not.toBe(normalizeImagingReportCopy(BODY))
    expect(normalizeImagingReportCopy(`${text}${signature} ADDENDUM: new mass.`)).not.toBe(normalizeImagingReportCopy(text))
    const prior = `Prior examination showed BI-RADS category 2. ${BODY}`
    expect(normalizeImagingReportCopy(prior + signature)).not.toBe(normalizeImagingReportCopy(prior))
    const addendum = `${BODY} Reported By A(Lic) On:2026/06/25(10:30:00),(by A)At:ST01 ADDENDUM: new mass. Reported By B(Lic) On:2026/06/26(09:00:00),(by B)At:ST01`
    expect(normalizeImagingReportCopy(addendum)).not.toBe(normalizeImagingReportCopy(BODY))
    const copies = pair()
    copies[0].conclusion = addendum
    expect(buildReportsData(copies).reportRows).toHaveLength(2)
  })

  it('preserves numeric and word boundaries when normalizing whitespace', () => {
    const reports = pair()
    const text = 'Findings: 1. 2 cm pulmonary nodule in the left upper lobe. No pleural effusion. Follow-up imaging is recommended.'
    reports[0].conclusion = text
    reports[1].conclusion = text.replace('1. 2', '1.2')
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    reports[1].conclusion = text.replaceAll(' ', '  \n ')
    expect(buildReportsData(reports).reportRows).toHaveLength(1)
    expect(normalizeImagingReportCopy('no table')).not.toBe(normalizeImagingReportCopy('notable'))
  })

  it.each([
    ['SONOGRAM LEFT BREAST', 'SONOGRAM RIGHT BREAST'],
    ['SONOGRAM BREAST', 'SONOGRAM LIVER'],
  ])('does not discard contradictory examination headers: %s / %s', (left, right) => {
    const reports = pair().map((report, index) => ({ ...report, code: { text: 'Ultrasonography' },
      conclusion: `${index ? right : left} Date Of Examination:2026/06/24 Date Of RCP:2026/06/24 ${BODY}`,
    }))
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it.each(['MRI CHEST', 'SONOGRAM CHEST', 'CHEST AP VIEW'])('rejects a %s header on a CT order', header => {
    const reports = pair()
    reports[0].conclusion = `${header} Date Of Examination:2026/06/24 Date Of RCP:2026/06/24 ${BODY}`
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('rejects contradictory modalities across code displays, including dotted C.T.', () => {
    const reports = pair()
    reports[0].code = { text: 'C.T. CHEST', coding: [{ display: 'MRI CHEST' }] }
    reports[1].code = { text: 'MRI CHEST' }
    reports[0].conclusion = BODY
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it.each([
    ['Left breast ultrasound', 'Right breast ultrasound', 'Bilateral breast ultrasound'],
    ['Chest CT', 'Abdominal CT', 'Chest and abdominal CT'],
    ['Chest CT with contrast', 'Chest CT without contrast', 'Chest CT with and without contrast'],
    ['CHEST AP VIEW', 'CHEST PA VIEW', 'CHEST AP AND PA VIEW'],
  ])('rejects contradictory source fields: %s / %s', (text, display, other) => {
    const reports = pair()
    reports[0].code = { text, coding: [{ display }] }
    reports[1].code = { text: other }
    reports[0].conclusion = BODY
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it.each([
    ['Left breast ultrasound', 'Right breast ultrasound'],
    ['Chest CT', 'Brain CT'],
    ['Left knee MRI', 'Left ankle MRI'],
    ['Shoulder ultrasound', 'Ultrasonography, other'],
    ['Chest CT with contrast', 'Chest CT without contrast'],
    ['Breasts ultrasound', 'Liver ultrasound'],
    ['Lungs CT', 'Liver CT'],
    ['Liver ultrasound', 'Gallbladder ultrasound'],
    ['Liver ultrasound', 'Abdominal ultrasound'],
    ['Hepatobiliary ultrasound', 'Liver ultrasound'],
    ['Lung CT', 'Chest CT'],
    ['Brain MRI', 'Head MRI'],
    ['Chest CT with contrast and without contrast', 'Chest CT without contrast'],
    ['Chest CT with and without contrast', 'Chest CT without contrast'],
    ['CHEST AP VIEW', 'CHEST PA VIEW'],
  ])('uses explicit title qualifiers as a conflict check: %s / %s', (left, right) => {
    const reports = pair().map((report, index) => ({ ...report, code: { text: index ? right : left }, conclusion: BODY }))
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it.each([
    ['another patient', { subject: { reference: 'Patient/other' } }],
    ['another day', { effectiveDateTime: '2026-06-23' }],
    ['invalid date', { effectiveDateTime: '2026-02-30' }],
    ['partial date', { effectiveDateTime: '2026-06' }],
    ['unknown date', { effectiveDateTime: undefined, issued: '2026-06-24' }],
    ['another hospital', { performer: [{ display: '高雄榮民總醫院' }] }],
    ['unknown hospital', { performer: [] }],
    ['a person, not hospital', { performer: [{ reference: 'Practitioner/example', display: '臺北榮總' }] }],
    ['unknown source', { meta: {} }],
    ['another modality', { code: { text: 'MRI CHEST' } }],
    ['preliminary report', { status: 'preliminary' }],
    ['corrected report', { status: 'corrected' }],
    ['changed size', { conclusion: `Impression ${BODY.replace('4 mm', '5 mm')}` }],
    ['changed laterality', { conclusion: `Impression ${BODY.replace('left', 'right')}` }],
    ['changed negative', { conclusion: `Impression ${BODY.replace('No pleural', 'Large pleural')}` }],
    ['only a prefix', { conclusion: BODY.slice(0, 105) }],
    ['extra findings', { conclusion: `${BODY} New lymphadenopathy.` }],
    ['truncated preview', { conclusion: `${BODY}...` }],
    ['unknown signing text', { conclusion: `${BODY} Additional interpretation by the reader.` }],
  ])('does not merge %s', (_name, override) => {
    const reports = pair()
    reports[1] = { ...reports[1], ...override }
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('does not match short reports or contradictory exam times', () => {
    expect(buildReportsData(pair().map(report => ({ ...report, conclusion: 'Normal chest radiograph.' }))).reportRows).toHaveLength(2)
    const reports = pair().map((report, index) => ({ ...report, effectiveDateTime: `2026-06-24T${index ? '15' : '11'}:30:00+08:00` }))
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    const headerPair = pair().map((report, index) => ({ ...report,
      conclusion: `CT CHEST Date Of Examination:2026/06/24 ${index ? '15' : '11'}:30:00 Date Of RCP:2026/06/24 ${BODY}`,
    }))
    expect(buildReportsData(headerPair).reportRows).toHaveLength(2)
  })

  it('accepts missing rows without confusing them with report evidence', () => {
    expect(reportDisplayGroupingKeys([null, ...pair()] as any).size).toBe(2)
  })

  it('does not arbitrarily pair repeated same-source exams', () => {
    const reports = pair()
    const duplicate = { ...reports[0], id: 'hospital-repeat' }
    expect(reportDisplayGroupingKeys([...reports, duplicate]).size).toBe(0)
    expect(buildReportsData([...reports, duplicate]).reportRows).toHaveLength(2)
  })

  it.each([0, 1])('does not pull source %s away from an existing truncated copy', index => {
    const reports = pair()
    const truncated = { ...reports[index], id: 'truncated', conclusion: reports[index].conclusion.slice(0, 115) }
    expect(reportDisplayGroupingKeys([...reports, truncated]).size).toBe(0)
    const rows = buildReportsData([...reports, truncated]).reportRows
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.diagnosticReportIds?.includes('truncated'))?.bridgeDupCount).toBe(1)
  })

  it('uses the same institution projection when a truncated copy lists the NHI authority first', () => {
    const reports = pair()
    const truncated = { ...reports[1], id: 'truncated', conclusion: reports[1].conclusion.slice(0, 115),
      performer: [{ display: '衛生福利部中央健康保險署' }, { display: '臺北榮總' }],
    }
    expect(reportDisplayGroupingKeys([...reports, truncated]).size).toBe(0)
    const rows = buildReportsData([...reports, truncated]).reportRows
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.diagnosticReportIds?.includes('truncated'))?.bridgeDupCount).toBe(1)
  })

  it('preserves natural groups across period dates and missing source tags', () => {
    const reports = pair()
    reports[0].effectiveDateTime = undefined
    reports[0].effectivePeriod = { start: '2026-06-24' }
    reports[0].issued = '2026-06-25'
    const truncated = { ...reports[0], id: 'truncated', issued: '2026-06-26', meta: {}, conclusion: reports[0].conclusion.slice(0, 115) }
    expect(reportDisplayGroupingKeys([...reports, truncated]).size).toBe(0)
    const rows = buildReportsData([...reports, truncated]).reportRows
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.diagnosticReportIds?.includes('truncated'))?.bridgeDupCount).toBe(1)
  })

  it('rejects an invalid explicit header time instead of treating it as missing', () => {
    const reports = pair()
    reports[0].conclusion = `CT CHEST Date Of Examination:2026/06/24 25:61:00 Date Of RCP:2026/06/24 Impression ${BODY}`
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('retains a trusted legacy NHI viewer while grouping matching reports', () => {
    const reports = pair()
    const url = 'https://medvpnimg.nhi.gov.tw/ZFP?synthetic=1'
    reports[1].presentedForm = [{ contentType: 'text/html', url }]
    const rows = buildReportsData(reports).reportRows
    expect(rows).toHaveLength(1)
    expect(rows[0].viewerActions).toEqual([{ kind: 'legacy', contentType: 'text/html', url }])
    reports[1].presentedForm[0].data = btoa('Different HTML clinical content')
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('does not treat the NHI authority as a conflicting performing hospital', () => {
    const reports = pair()
    reports[1].performer.push({ display: '衛生福利部中央健康保險署' })
    expect(buildReportsData(reports).reportRows).toHaveLength(1)
  })

  it('retains both images and the exact viewer request', () => {
    const reports = pair().map((report, index) => ({ ...report,
      presentedForm: [{ contentType: 'image/png', data: `synthetic-image-${index}` }],
    }))
    reports[1].extension = [{ url: NHI_VIEWER_REQUEST_EXTENSION_URL, extension: [
      { url: 'version', valueInteger: 1 }, { url: 'proc-id', valueCode: 'IMUE0130' },
      { url: 'patient-context-hash', valueString: 'b'.repeat(64) }, { url: 'ipl-case-seq-no', valueString: 'SYNTHETIC-CASE' },
    ] }]
    const before = buildReportsData([reports[1]]).reportRows[0].viewerActions
    const { reportRows } = buildReportsData(reports)
    expect(reportRows).toHaveLength(1)
    expect(reportRows[0].images).toHaveLength(2)
    expect(reportRows[0].viewerActions).toEqual(before)
    expect(before).toHaveLength(1)
  })

  it('keeps structured or unresolved results separate even if the report text agrees', () => {
    const reports = pair().map((report, index) => ({ ...report,
      _observations: [{ id: `measurement-${index}`, code: { text: 'Size' }, valueQuantity: { value: 4 + index, unit: 'mm' } }],
    }))
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    expect(reportDisplayGroupingKeys(pair().map(report => ({ ...report, result: [{ reference: 'Observation/unresolved' }] })))).toHaveProperty('size', 0)
    expect(reportDisplayGroupingKeys(pair().map(report => ({ ...report,
      result: [{ reference: 'Observation/loaded' }, { reference: 'Observation/unresolved' }],
      _observations: [{ id: 'loaded', valueString: BODY }],
    })))).toHaveProperty('size', 0)
    expect(buildReportsData(pair().map((report, index) => ({ ...report,
      _observations: [{ id: `assessment-${index}`, valueString: `BI-RADS ${index ? 4 : 2}` }],
    }))).reportRows).toHaveLength(2)
  })

  it('does not hide interpretation or status metadata on long narrative observations', () => {
    const reports = pair().map((report, index) => ({ ...report,
      _observations: [{ id: `interpretation-${index}`, valueString: BODY,
        status: index ? 'preliminary' : 'final', interpretation: [{ coding: [{ code: index ? 'A' : 'N' }] }],
      }],
    }))
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    expect(reportDisplayGroupingKeys(pair().map((report, index) => ({ ...report,
      conclusionCode: [{ coding: [{ code: index ? 'A' : 'N', display: 'Finding' }] }],
    })))).toHaveProperty('size', 0)
  })

  it('compares explicit timestamps as instants including their UTC offsets', () => {
    const reports = pair()
    reports[0].effectiveDateTime = '2026-06-24T11:30:00+08:00'
    reports[1].effectiveDateTime = '2026-06-24T11:30:00Z'
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    reports[1].effectiveDateTime = '2026-06-24T03:30:00Z'
    expect(buildReportsData(reports).reportRows).toHaveLength(1)
    reports[1].effectiveDateTime = '2026-06-24T00:00:00Z'
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('validates full-width headers with the same normalization used for matching', () => {
    const reports = pair()
    reports[0].conclusion = `CT CHEST Date Of Examination：２０２６/０６/２３ １１:３０:００ Date Of RCP：２０２６/０６/２４ ${BODY}`
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    reports[0].conclusion = `CT CHEST Date Of Examination：２０２６/０６/２４ １１:３０:００ Date Of RCP：２０２６/０６/２４ ${BODY}`
    reports[1].effectiveDateTime = '2026-06-24T15:30:00+08:00'
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('does not ignore clinical attachments outside the text comparison', () => {
    for (const contentType of ['text/html', 'application/pdf', 'application/xml']) {
      expect(buildReportsData(pair().map((report, index) => ({ ...report,
        presentedForm: [{ contentType, data: btoa(`Different finding ${index}`) }],
      }))).reportRows).toHaveLength(2)
    }
  })

  it('does not resolve an ambiguous repeat merely because latest filtering removed a copy', () => {
    const reports = pair()
    reports.push({ ...reports[0], id: 'hospital-repeat' })
    const filters = { imagingReportVersion: 'latest', imagingReportTimeRange: 'all' }
    const data = { observations: [], encounters: [] }
    expect(imagingReportsCategory.getCount(reports, filters, data as any)).toBe(2)
    const section = imagingReportsCategory.getContextSection(reports, filters, data as any)
    const text = section && !Array.isArray(section) ? section.items.join('\n') : ''
    expect(text).not.toContain('[shared narrative; count once]')
  })

  it('rejects conflicting explicit encounters and same-system exam identifiers', () => {
    const reports = pair()
    reports[0].encounter = { reference: 'Encounter/a' }
    reports[1].encounter = { reference: 'Encounter/b' }
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    reports[1].encounter = reports[0].encounter
    reports[0].identifier = [{ system: 'urn:synthetic:accession', value: 'A' }]
    reports[1].identifier = [{ system: 'urn:synthetic:accession', value: 'B' }]
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
    reports[1].identifier = reports[0].identifier
    expect(buildReportsData(reports).reportRows).toHaveLength(1)
  })

  it('does not split an existing shared report group if a member is ineligible', () => {
    const reports = pair()
    reports[1].encounter = { reference: 'Encounter/cloud' }
    const companion = { ...reports[1], id: 'cloud-companion', code: { text: 'Another CT procedure' },
      _observations: [{ id: 'grade', valueString: 'Grade 2' }],
    }
    const keys = reportDisplayGroupingKeys([...reports, companion])
    expect(keys.get(reports[1])).toBe(keys.get(companion))
    expect(keys.has(reports[0])).toBe(false)
  })

  it.each(['18005C', ' 18005c '])('keeps the established echo family and viewer-only companion together for %s', echoCode => {
    const reports = pair().map(report => ({ ...report, code: { text: 'Cardiac ultrasound' } }))
    reports[1].encounter = { reference: 'Encounter/echo' }
    reports[1].code = { text: 'Cardiac ultrasound', coding: [{ code: echoCode }] }
    const doppler = { ...reports[1], id: 'doppler', code: { text: 'Doppler ultrasound', coding: [{ code: echoCode.replace('5', '7') }] } }
    const viewer = { ...reports[1], id: 'viewer', code: { text: 'Echo viewer', coding: [{ code: echoCode }] }, conclusion: undefined, extension: [{ url: NHI_VIEWER_REQUEST_EXTENSION_URL, extension: [
      { url: 'version', valueInteger: 1 }, { url: 'proc-id', valueCode: 'IMUE0130' },
      { url: 'patient-context-hash', valueString: 'b'.repeat(64) }, { url: 'ipl-case-seq-no', valueString: 'ECHO-SYNTHETIC' },
    ] }] }
    const rows = buildReportsData([...reports, doppler, viewer]).reportRows
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.diagnosticReportIds?.includes('cloud'))?.diagnosticReportIds).toEqual(['cloud', 'doppler', 'viewer'])
    expect(rows.find(row => row.diagnosticReportIds?.includes('cloud'))?.viewerActions).toHaveLength(1)
  })

  it('uses effectivePeriod.start before the later signing date in a merged row', () => {
    const reports = pair()
    reports[0].effectiveDateTime = undefined
    reports[0].effectivePeriod = { start: '2026-06-24' }
    reports[0].issued = '2026-06-25'
    const rows = buildReportsData(reports).reportRows
    expect(rows).toHaveLength(1)
    expect(rows[0].effectiveDate).toBe('2026-06-24')
    expect(calculateReportTabCounts(reports).imaging).toBe(1)
  })

  it.each(['LAB', 'PAT'])('preserves the existing %s date fallback outside imaging', category => {
    expect(getReportDate({ effectivePeriod: { start: '2026-06-24' }, issued: '2026-06-25',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: category }] }],
    })).toBe('2026-06-25')
  })

  it.each([undefined, '2026-06-25'])('preserves the original examination period on shared pathology reports with issued=%s', issued => {
    const reports = pair().map((report, index) => ({ ...report,
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'PAT' }] }],
      code: { text: `Pathology ${index}` }, performer: [{ display: 'Example hospital' }],
      encounter: { reference: 'Encounter/pathology' }, effectiveDateTime: undefined,
      effectivePeriod: { start: '2026-06-24' }, issued, conclusion: BODY,
    }))
    const section = imagingReportsCategory.getContextSection(reports, { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }, { observations: [], encounters: [] } as any)
    const text = section && !Array.isArray(section) ? section.items.join('\n') : ''
    expect(text).toContain(new Date('2026-06-24').toLocaleDateString())
    expect(text).not.toContain(new Date('2026-06-25').toLocaleDateString())
  })

  it('renders a lone source normally when latest filtering removes its paired report', () => {
    const reports = pair()
    reports.push({ ...reports[0], id: 'newer-hospital', effectiveDateTime: '2026-06-25', conclusion: `${BODY} New finding.` })
    const filters = { imagingReportVersion: 'latest', imagingReportTimeRange: 'all' }
    const section = imagingReportsCategory.getContextSection(reports, filters, { observations: [], encounters: [] } as any)
    const text = section && !Array.isArray(section) ? section.items.join('\n') : ''
    expect(text).not.toContain('[shared narrative; count once]')
    expect(imagingReportsCategory.getCount(reports, filters, { observations: [], encounters: [] } as any)).toBe(2)
  })

  it('does not pick a cross-source pair from nearby same-title exams in either input order', () => {
    const reports = pair()
    const neighbor = { ...reports[0], id: 'neighbor', conclusion: `${BODY} An additional new opacity is present.` }
    for (const input of [[...reports, neighbor], [neighbor, ...reports.slice().reverse()]]) {
      expect(buildReportsData(input).reportRows).toHaveLength(3)
      expect(calculateReportTabCounts(input).all).toBe(3)
      expect(calculateReportTabCounts(input).imaging).toBe(2)
    }
  })

  it.each([
    [{ display: '高雄榮民總醫院' }],
    [{ display: '臺北榮總' }, { display: '高雄榮民總醫院' }],
    [{ reference: 'Organization/unknown' }],
    [{ reference: 'urn:uuid:other-hospital', display: '高雄榮民總醫院' }],
    [{ reference: '#org', display: '高雄榮民總醫院' }],
    [{ display: 'Unknown institution' }],
  ])('rejects contradictory or unknown hospital-side facility evidence: %j', (...performer) => {
    const reports = pair()
    reports[0].performer = performer
    expect(buildReportsData(reports).reportRows).toHaveLength(2)
  })

  it('aligns counts and AI source references with the rendered group', () => {
    const reports = pair()
    expect(calculateReportTabCounts(reports).imaging).toBe(1)
    const filters = { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }
    const data = { observations: [], encounters: [] }
    expect(imagingReportsCategory.getCount(reports, filters, data as any)).toBe(1)
    const section = imagingReportsCategory.getContextSection(reports, filters, data as any)
    const text = section && !Array.isArray(section) ? section.items.join('\n') : ''
    expect(text).toContain('[id: hospital]')
    expect(text).toContain('[id: cloud]')
    expect(text).toContain('Source copy (alternate name)')
    expect(text).not.toContain('CT/SCAN- CHEST +')
    expect(text.match(/\[shared narrative; count once\]/g)).toHaveLength(1)
  })
})
