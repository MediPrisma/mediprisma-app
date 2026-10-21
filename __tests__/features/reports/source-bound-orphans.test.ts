import { calculateReportTabCounts } from '@/features/clinical-summary/reports/utils/report-tab-counts'
import { orphanResultObservations } from '@/features/ips-export/utils/ips-helpers'

const observation = (key: string, day: string) => ({ id: 'same', clinicalSourceNodeKey: key, status: 'final', code: { text: 'Synthetic lab' }, category: [{ coding: [{ code: 'laboratory' }] }], valueQuantity: { value: 10 }, effectiveDateTime: day })
const report = (members: any[]) => ({ id: 'report', clinicalSourceNodeKey: 'report-node', status: 'final', code: { text: 'Synthetic report' }, category: [{ coding: [{ code: 'LAB' }] }], effectiveDateTime: '2026-07-01', result: [{ reference: 'https://foreign.example/fhir/Observation/same' }], _observations: members })

it('keeps a graph-rejected foreign reference observation as an orphan in tab counts and IPS', () => {
  const local = observation('local', '2026-07-02')
  const reports: any = [report([])]
  expect(orphanResultObservations(reports, [local] as any)).toEqual([local])
  expect(calculateReportTabCounts(reports, [], [local]).all).toBe(calculateReportTabCounts(reports).all + 1)
})

it('only excludes the actual source member when a second orphan reuses its logical id', () => {
  const member = observation('member', '2026-07-01')
  const orphan = observation('orphan', '2026-07-02')
  const reports: any = [report([member])]
  expect(orphanResultObservations(reports, [member, orphan] as any)).toEqual([orphan])
  expect(calculateReportTabCounts(reports, [], [member, orphan]).all).toBe(calculateReportTabCounts(reports).all + 1)
})
