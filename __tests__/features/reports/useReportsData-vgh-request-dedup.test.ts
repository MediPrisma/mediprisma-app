import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { calculateReportTabCounts } from '@/features/clinical-summary/reports/utils/report-tab-counts'

// Synthetic, fictional reports. The in-house VGH capture carries the request
// number as an identifier; the copy VGH uploads to the NHI cloud quotes the
// same number in its report header, with a different title, date and spacing.
const HOSPITAL_META = { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }
const CLOUD_META = { source: 'https://medcloud2.nhi.gov.tw/' }
const subject = { reference: 'Patient/synthetic' }

function hospital(id: string, title: string, requestNo: string, conclusion: string) {
  return {
    resourceType: 'DiagnosticReport', id, status: 'final', subject, meta: HOSPITAL_META,
    code: { text: title, coding: [{ system: 'urn:oid:his.report.code', code: title }] },
    identifier: [{ system: 'urn:oid:vgh.report.request', value: requestNo }],
    effectiveDateTime: '2026-05-07T09:48:00+08:00',
    performer: [{ display: 'DOC0001A 王測試' }], resultsInterpreter: [{ display: 'DOC0002B 林判讀' }],
    conclusion,
  }
}

function cloud(id: string, title: string, code: string, requestNo: string, body: string) {
  return {
    resourceType: 'DiagnosticReport', id, status: 'final', subject, meta: CLOUD_META,
    code: { text: title, coding: [{ system: 'https://example.test/nhi-order', code }] },
    effectiveDateTime: '2026-05-15',
    performer: [{ display: '臺北榮總' }],
    conclusion: `正式報告\n\n 申請序號 / 工作號： ${requestNo}/ 開立時間： 2026/04/30 09:55\n\n 開醫囑者： DOC0001A 王測試\n\n ${body}`,
  }
}

const TREADMILL = '3. STAGE:\nSPEED/GRADE(NPH/%)  MINUTES  BLOOD PRESSURE\n(1.7/10)  ( 3\' 0\'\' )  ( 140 / 70 )\nCONCLUSION: THE RESULT WAS Negative'

describe('VGH in-house and NHI cloud copies of one report (request number)', () => {
  it('shows a treadmill report once, using the in-house copy', () => {
    const reports = [
      hospital('vgh-tmx', 'TREADMILL EXERCISE/GRADED EXERCI', 'TEST001', TREADMILL),
      cloud('nhi-tmx', '運動心電圖 ;(Treadmill exercise test)', '18019C', 'TEST001', 'SPEED/GRADE(NPH/%) MINUTES BLOOD PRESSURE (1.7/10) ( 3\' 0\'\' ) ( 140 / 70 )'),
    ]
    const rows = buildReportsData(reports as any).reportRows
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toContain('TREADMILL')
    expect(calculateReportTabCounts(reports as any).all).toBe(1)
  })

  it('folds a cloud echo billed as two lines into the one in-house report', () => {
    const reports = [
      hospital('vgh-echo', 'COLOR,M-MODE+2-D ECHO,', 'TEST002', 'MMode/2D Measurements\nAortic root 30 mm\nConclusion & Comments\n1. Synthetic finding.'),
      cloud('nhi-echo-1', '彩色杜卜勒心臟血流圖 ;(Doppler color flow mapping)', '18007B', 'TEST002', 'MMode/2D Measurements Aortic root 30 mm'),
      cloud('nhi-echo-2', '心臟超音波 ;(Echocardiography (M-mode and sector scan))', '18005B', 'TEST002', 'MMode/2D Measurements Aortic root 30 mm'),
    ]
    expect(buildReportsData(reports as any).reportRows).toHaveLength(1)
  })

  it('keeps reports with different request numbers apart', () => {
    const reports = [
      hospital('vgh-holter', "24HRS.HOLTER'S SCAN", 'TEST003', '*Basic rhythm:\nSynthetic sinus rhythm.'),
      cloud('nhi-holter', "24小時連續性心電圖記錄檢查 ;(24hrs. Holter's scan)", '18008B', 'TEST999', '*Basic rhythm: Synthetic sinus rhythm.'),
    ]
    expect(buildReportsData(reports as any).reportRows).toHaveLength(2)
  })

  it('does not pair across patients', () => {
    const other = { ...cloud('nhi-other', "24小時連續性心電圖記錄檢查 ;(24hrs. Holter's scan)", '18008B', 'TEST004', 'Synthetic.'), subject: { reference: 'Patient/other' } }
    const reports = [hospital('vgh-holter-2', "24HRS.HOLTER'S SCAN", 'TEST004', 'Synthetic.'), other]
    expect(buildReportsData(reports as any).reportRows).toHaveLength(2)
  })
})
