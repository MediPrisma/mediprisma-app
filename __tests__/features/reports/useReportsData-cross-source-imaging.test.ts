import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { calculateReportTabCounts } from '@/features/clinical-summary/reports/utils/report-tab-counts'
import { imagingReportsCategory } from '@/src/core/categories/imaging-reports.category'
import { normalizeImagingReportCopy, reportDisplayGroupingKeys } from '@/src/shared/utils/report-copy-grouping'
import { NHI_VIEWER_REQUEST_EXTENSION_URL } from '@/features/clinical-summary/reports/utils/nhi-viewer-request'

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
    expect(normalizeImagingReportCopy(text + signature.replace('BI-RADS 2', 'BI-RADS 4'))).not.toBe(normalizeImagingReportCopy(text))
    const header = 'SONOGRAM, HEPATOBILIARY SYSTEM Date Of Examination:2026/06/24 14:13:10 Date Of RCP:2026/06/24 '
    expect(normalizeImagingReportCopy(header + BODY)).toBe(normalizeImagingReportCopy(BODY))
    expect(normalizeImagingReportCopy(BODY.replace('4 mm', '5 mm'))).not.toBe(normalizeImagingReportCopy(BODY))
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
  })

  it.each([
    [{ display: '高雄榮民總醫院' }],
    [{ display: '臺北榮總' }, { display: '高雄榮民總醫院' }],
    [{ reference: 'Organization/unknown' }],
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
    expect(text.match(/\[shared narrative; count once\]/g)).toHaveLength(1)
  })
})
