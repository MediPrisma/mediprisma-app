import { render, renderHook, screen } from '@testing-library/react'
import { useReportHistory } from '@/features/clinical-summary/reports/hooks/useObservationHistory'
import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { ReportHistoryList } from '@/features/clinical-summary/reports/components/ReportHistoryList'
import { LanguageProvider } from '@/src/application/providers/language.provider'

const mockUseClinicalData = jest.fn()
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({ useClinicalData: () => mockUseClinicalData() }))

const body = 'Synthetic imaging finding: a 4 mm nodule in the left upper lobe is unchanged. No pleural effusion. Follow-up imaging in twelve months is recommended.'
const attachment = (text: string) => ({ contentType: 'text/plain; charset=utf-8', data: Buffer.from(text).toString('base64') })

it('loads attachment-only histories from both original titles of a merged row', () => {
  const common = { resourceType: 'DiagnosticReport', status: 'final', subject: { reference: 'Patient/synthetic' }, effectiveDateTime: '2026-06-24', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }], presentedForm: [attachment(body)] }
  const reports = [
    { ...common, id: 'hospital', code: { text: 'CT/SCAN- CHEST' }, performer: [{ display: 'DOC00000 Example' }], meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] } },
    { ...common, id: 'cloud', code: { text: 'Computed tomography with contrast' }, performer: [{ display: '臺北榮總' }], meta: { source: 'https://medcloud2.nhi.gov.tw/' } },
  ]
  const prior = { ...reports[1], id: 'cloud-prior', effectiveDateTime: '2026-05-24', presentedForm: [attachment('Prior synthetic report. 原始文字附件也必須保留。')] }
  mockUseClinicalData.mockReturnValue({ diagnosticReports: [...reports, prior] })
  const row = buildReportsData(reports).reportRows[0]
  expect(row.diagnosticReportIds).toEqual(['hospital', 'cloud'])
  for (const source of row.sharedReportSources!) {
    const { result } = renderHook(() => useReportHistory(source.title))
    expect(result.current.map(item => item.id)).toEqual(source.reportId === 'hospital' ? ['hospital'] : ['cloud', 'cloud-prior'])
    expect(result.current[0].notes.join('\n')).toContain(body)
    if (source.reportId === 'cloud') expect(result.current[1].notes.join('\n')).toContain('原始文字附件也必須保留')
  }
})

it('preserves conclusion and notes while retaining additional plain text and excluding binary or HTML attachments', () => {
  mockUseClinicalData.mockReturnValue({ diagnosticReports: [{ id: 'mixed', code: { text: 'CT CHEST' }, conclusion: 'Original conclusion', note: [{ text: 'Original note' }], presentedForm: [attachment('Additional plain text'), { contentType: 'text/html', data: Buffer.from('<b>HTML only</b>').toString('base64') }, { contentType: 'application/pdf', data: Buffer.from('Binary only').toString('base64') }] }] })
  const { result } = renderHook(() => useReportHistory('CT CHEST'))
  expect(result.current[0].conclusion).toBe('Original conclusion')
  expect(result.current[0].notes).toEqual(['Original note', 'Additional plain text'])
})

it.each([
  [{ effectivePeriod: { start: '2026-06-24' }, issued: '2026-06-25' }, '2026-06-24'],
  [{ effectiveDateTime: '2026-06-24T23:30:00Z' }, '2026-06-25'],
])('keeps the source examination day in history: %j', (dates, day) => {
  mockUseClinicalData.mockReturnValue({ diagnosticReports: [{ id: 'dated', status: 'final', code: { text: 'CT CHEST' }, category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }], meta: { source: 'https://medcloud2.nhi.gov.tw/' }, conclusion: body, ...dates }] })
  const { result } = renderHook(() => useReportHistory('CT CHEST'))
  expect(result.current[0].calendarDate).toBe(day)
  render(<LanguageProvider><ReportHistoryList data={result.current} /></LanguageProvider>)
  // The runtime locale differs between Windows and Linux CI. Assert the
  // already-verified examination day using that locale's displayed spelling.
  const label = new Intl.DateTimeFormat().format(new Date(`${day}T12:00:00`))
  expect(screen.getByText(label)).toBeVisible()
})
