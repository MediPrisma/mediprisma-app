import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { calculateReportTabCounts } from '@/features/clinical-summary/reports/utils/report-tab-counts'
import { reportDisplayGroupingKeys } from '@/src/shared/utils/report-copy-grouping'
import { imagingReportsCategory } from '@/src/core/categories/imaging-reports.category'
import { NHI_VIEWER_REQUEST_EXTENSION_URL } from '@/features/clinical-summary/reports/utils/nhi-viewer-request'

// Fully synthetic findings, preserving the legacy adapter's structural defects.
function fixture(): any[] {
  const cases = [
    ['SONOGRAM- BREAST', '乳房超音波 ;()', '19014C', '> BI-RADS category 2, benign findings. The visible breast tissue is unchanged. Follow up is generally recommended. No occupying lesion is identified.', 'generally recommended', 'ACR BI-RADS 2'],
    ['SONO- HEPATOBILIARY SYSTEM', '其他超音波 ;(Echo for others)', '19005C', 'The visible pancreas is unremarkable. No focal liver lesion is identified. The gallbladder and splenic hilum are unremarkable on this synthetic examination.', 'visible pancreas', ''],
    ['CHEST AP VIEW', '胸腔檢查 (Chest view including each view of chest film)', '32001C', 'Synthetic chest radiograph: no pleural effusion or focal consolidation. The cardiac silhouette is unchanged. Please follow-up regularly.', 'follow-up regularly', ''],
    ['CT/SCAN- CHEST', '電腦斷層造影－有造影劑 (Computed tomography)', '33071B', 'Synthetic CT of the chest was performed. No suspicious pulmonary nodule or pleural effusion is seen. The mediastinum is unremarkable. No change.', 'was performed', 'Positive Rate Evaluation 2'],
  ]
  return cases.flatMap(([title, cloudTitle, code, text, joined, footer], index) => {
    const common = { resourceType: 'DiagnosticReport', status: 'final', subject: { reference: 'Patient/synthetic' }, category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }] }
    const hospital = { ...common, id: `his-${index}`, code: { text: title },
      meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
      performer: [{ display: 'DOC00000 Synthetic' }], encounter: { reference: 'Encounter/hospital' },
      effectiveDateTime: '2026-06-24T11:32:00+08:00',
      extension: [{ url: 'urn:vgh:report:received-at', valueDateTime: '2026-06-24T11:32:00+08:00' }],
      identifier: [{ system: 'urn:oid:vgh.report.request', value: `synthetic-${index}` }],
      conclusion: `${title} Date Of Examination:2026/06/24 11:29:54 Date Of RCP:2026/06/24 ${text.replace(joined, joined.replaceAll(' ', ''))} Reported By Synthetic(License#:TEST) On:2026/06/25(10:30:00),(by Synthetic)At:TEST01${footer}` }
    const cloud = { ...common, id: `cloud-${index}`, effectiveDateTime: '2026-06-24',
      code: { text: cloudTitle, coding: [{ code }, ...(index === 2 ? [{ system: 'http://loinc.org', code: '30745-4', display: 'XR Chest Views' }] : [])] },
      meta: { source: 'https://medcloud2.nhi.gov.tw/' }, performer: [{ display: '臺北榮總' }],
      encounter: { reference: 'Encounter/cloud-claim' }, conclusion: `Impression ${text}`,
      extension: [{ url: 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-report-date', valueString: '2026-06-24T12:18:00' }, { url: NHI_VIEWER_REQUEST_EXTENSION_URL, extension: [
        { url: 'version', valueInteger: 1 }, { url: 'proc-id', valueCode: 'IMUE0130' },
        { url: 'patient-context-hash', valueString: 'b'.repeat(64) }, { url: 'ipl-case-seq-no', valueString: `SYNTHETIC-${index}` },
      ] }] }
    return [hospital, cloud]
  })
}

const rows = (reports: any[]) => buildReportsData(reports).reportRows
describe('legacy receipt-clock imaging copies', () => {
  it('groups eight rows into four with every original narrative, id and viewer action intact', () => {
    const reports = fixture()
    const before = JSON.stringify(reports)
    const result = rows(reports)
    expect(result).toHaveLength(4)
    expect(calculateReportTabCounts(reports).all).toBe(4)
    expect(result.flatMap(row => row.diagnosticReportIds).sort()).toEqual(reports.map(r => r.id).sort())
    expect(result.flatMap(row => row.sharedReportSources?.map(source => source.narrative)).sort()).toEqual(reports.map(r => r.conclusion).sort())
    expect(result.flatMap(row => row.viewerActions)).toHaveLength(4)
    for (const row of result) {
      const cloudId = row.diagnosticReportIds?.find(id => id.startsWith('cloud-'))!
      expect(row.viewerActions).toHaveLength(1)
      expect(row.viewerActions?.[0]).toMatchObject({ kind: 'live', descriptor: { iplCaseSeqNo: `SYNTHETIC-${cloudId.split('-')[1]}` } })
    }
    expect(JSON.stringify(reports)).toBe(before)
    expect(imagingReportsCategory.getCount(reports, { imagingReportVersion: 'all', imagingReportTimeRange: 'all' }, {} as any)).toBe(4)
  })

  it('retains both cloud billing items in one cross-source CXR group', () => {
    const reports = fixture()
    const secondBilling = JSON.parse(JSON.stringify(reports[5]))
    secondBilling.id = 'cloud-second-billing'
    secondBilling.code.coding[0].code = '32002C'
    secondBilling.extension = secondBilling.extension.filter((extension: any) => extension.valueString)
    reports.push(secondBilling)
    expect(rows(reports)).toHaveLength(4)
    expect(rows(reports).flatMap(row => row.diagnosticReportIds)).toHaveLength(9)
  })

  it.each([false, true])('does not collapse serial same-day CXR with identical findings=%s', identical => {
    const reports = fixture().slice(4, 6)
    const repeated = JSON.parse(JSON.stringify(reports[0]))
    repeated.id = 'his-repeat'
    repeated.identifier[0].value = 'second-exam'
    repeated.effectiveDateTime = '2026-06-24T17:02:00+08:00'
    repeated.extension[0].valueDateTime = repeated.effectiveDateTime
    repeated.conclusion = repeated.conclusion.replace('11:29:54', '16:59:54')
    if (!identical) repeated.conclusion = repeated.conclusion.replace('no pleural effusion', 'new pleural effusion')
    reports.push(repeated)
    expect(reportDisplayGroupingKeys(reports).size).toBe(0)
    expect(rows(reports)).toHaveLength(3)
    expect(calculateReportTabCounts(reports).all).toBe(3)
  })

  it.each(['patient', 'date', 'site', 'findings', 'grade', 'receipt', 'number', 'negation'])('keeps conflicting %s separate', conflict => {
    const reports = fixture().slice(0, 2)
    expect(rows(reports)).toHaveLength(1)
    if (conflict === 'patient') reports[1].subject = { reference: 'Patient/other' }
    if (conflict === 'date') reports[1].effectiveDateTime = '2026-06-25'
    if (conflict === 'site') reports[1].code.text = '肝臟超音波'
    if (conflict === 'findings') reports[1].conclusion += ' Additional suspicious mass.'
    if (conflict === 'grade') reports[0].conclusion = reports[0].conclusion.replace('ACR BI-RADS 2', 'ACR BI-RADS 4')
    if (conflict === 'receipt') reports[0].extension = []
    if (conflict === 'number') { reports[0].conclusion = reports[0].conclusion.replace(' Reported By', ' 1.2 cm Reported By'); reports[1].conclusion += ' 1. 2 cm' }
    if (conflict === 'negation') { reports[0].conclusion = reports[0].conclusion.replace(' Reported By', ' notable Reported By'); reports[1].conclusion += ' no table' }
    expect(rows(reports)).toHaveLength(2)
  })

  it('does not bridge two examinations through strict and legacy matches to one cloud report', () => {
    const reports = fixture().slice(0, 2)
    const strict = JSON.parse(JSON.stringify(reports[0]))
    strict.id = 'separate-examination'
    strict.code.text = 'SONO- BREAST'
    strict.extension = []
    strict.encounter = undefined
    strict.effectiveDateTime = '2026-06-24T10:00:00+08:00'
    strict.conclusion = reports[1].conclusion
    reports[1].encounter = undefined
    reports.push(strict)
    expect(rows(reports)).toHaveLength(3)
    expect([...reportDisplayGroupingKeys(reports).values()].some(key => key.startsWith('cross-source|'))).toBe(false)
  })

  it.each(['胸部X光', '胸部Ｘ光', 'CXR', 'ＣＸＲ', 'CHEST AP', 'CHEST PA', 'Chest PA and Lateral', 'Report'])('preserves uncoded serial radiographs named %s', title => {
    const report = fixture()[4]
    report.code = { text: title }
    const second = JSON.parse(JSON.stringify(report))
    second.id = 'second-radiograph'
    second.effectiveDateTime = '2026-06-24T17:00:00+08:00'
    second.identifier[0].value = 'second-accession'
    expect(rows([report, second])).toHaveLength(2)
    expect(calculateReportTabCounts([report, second]).all).toBe(2)
  })

  it.each(['clock', 'date', 'unidentified'])('does not combine two serial examinations with multiple billing codes, evidence=%s', evidence => {
    const template = fixture()[5]
    template.extension = []
    const reports = ['08:00', '16:00'].flatMap((clock, index) => ['32001C', '32002C'].map(code => ({
      ...template, id: `serial-${clock}-${code}`,
      effectiveDateTime: evidence !== 'clock' ? '2026-06-24' : `2026-06-24T${clock}:00+08:00`,
      code: { ...template.code, coding: [{ code }] },
      identifier: evidence === 'unidentified' ? undefined : [{ system: 'urn:synthetic:accession', value: `EXAM-${index}` }],
    })))
    expect(rows(reports)).toHaveLength(evidence === 'unidentified' ? 4 : 2)
    expect(calculateReportTabCounts(reports).all).toBe(evidence === 'unidentified' ? 4 : 2)
    for (const row of rows(reports)) {
      const ids = row.diagnosticReportIds ?? []
      expect(ids.every(id => id.includes('08:00')) || ids.every(id => id.includes('16:00'))).toBe(true)
    }
  })

  it('preserves numeric punctuation boundaries in legacy layout comparisons', () => {
    const reports = fixture().slice(2, 4)
    reports[0].conclusion = reports[0].conclusion.replace('The visible', 'Segments 1,5 cm. The visible')
    reports[1].conclusion = reports[1].conclusion.replace('The visible', 'Segments 1, 5 cm. The visible')
    expect(rows(reports)).toHaveLength(2)
  })

  it.each(['2026-06-24', '2026-06-24T08:00:00+08:00'])('keeps different linked studies separate with date %s', date => {
    const template = fixture()[5]
    const reports = ['32001C', '32002C'].map((code, index) => ({ ...template,
      id: `study-${index}`, effectiveDateTime: date, code: { ...template.code, coding: [{ code }] },
      imagingStudy: [{ reference: `ImagingStudy/study-${index}` }],
    }))
    expect(rows(reports)).toHaveLength(2)
    expect(calculateReportTabCounts(reports).all).toBe(2)
  })

  it('does not infer a single date-only CXR from different billing codes without report identity', () => {
    const template = fixture()[5]
    const reports = ['32001C', '32002C'].map((code, index) => ({ ...template,
      id: `unknown-${index}`, extension: [], code: { ...template.code, coding: [{ code }] },
    }))
    expect(rows(reports)).toHaveLength(2)
    expect(calculateReportTabCounts(reports).all).toBe(2)
  })

  it.each(['Abdomen X-ray', 'KUB'])('does not let a distinct same-day %s block CXR pairing', title => {
    const reports = fixture().slice(4, 6)
    const abdomen = JSON.parse(JSON.stringify(reports[1]))
    abdomen.id = 'abdomen'
    abdomen.code = { text: title, coding: [{ code: '32006C' }] }
    abdomen.conclusion = 'Synthetic abdominal radiograph. Bowel gas pattern is unremarkable. No visible dilated bowel loop. This is a separate abdominal examination.'
    expect(rows([...reports, abdomen])).toHaveLength(2)
  })
})



