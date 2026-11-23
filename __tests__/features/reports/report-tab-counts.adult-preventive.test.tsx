import { calculateReportTabCounts } from '@/features/clinical-summary/reports/utils/report-tab-counts'
import { renderHook } from '@testing-library/react'
import bundle from '@/public/demo/demo-bundle.json'
import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { useOrphanObservations } from '@/features/clinical-summary/reports/hooks/useOrphanObservations'
import { groupAdultPreventiveRows } from '@/features/clinical-summary/reports/utils/adult-preventive-grouping'
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'en', t: {} }) }))
it('keeps the initial demo count equal to the rendered All list after adult-exam grouping', () => {
 const resources: any[] = bundle.entry.map(e => e.resource)
 const observations = resources.filter(r => r.resourceType === 'Observation')
 const reports = resources.filter(r => r.resourceType === 'DiagnosticReport').map(r => ({...r, _observations: (r.result ?? []).map((ref: any) => observations.find(o => 'Observation/'+o.id === ref.reference)).filter(Boolean)}))
 const built = buildReportsData(reports)
 const { result } = renderHook(() => useOrphanObservations(observations,built.seenIds,'standardized',resources.filter(r => r.resourceType === 'Composition')))
 const rows = [...built.reportRows, ...result.current]
 const grouped = groupAdultPreventiveRows(rows)
 const procedures = resources.filter(r => r.resourceType === 'Procedure')
 const counts = calculateReportTabCounts(reports, [], observations, procedures, resources.filter(r => r.resourceType === 'Composition'))
 expect(rows.length-grouped.length).toBe(23)
 expect(counts.all).toBe(grouped.length + procedures.length)
 // the 2026-10-23 export adds AFP, CEA, CA 19-9 and a chest X-ray on 10/14
 expect(counts.all).toBe(101)
})

it('groups composition-linked exams by date and institution without merging ordinary results', () => {
 const make = (id: string, day: string, hospital: string) => ({
  id, code: { text: id }, valueString: 'normal', effectiveDateTime: day,
  performer: [{ display: hospital }],
 })
 const observations = [make('a','2026-01-01','Clinic'), make('b','2026-01-01','Clinic'), make('c','2026-01-02','Clinic'), make('d','2026-01-01','Other'), make('ordinary','2026-01-01','Clinic')]
 const compositions = [{ meta: { tag: [{ system: 'http://nhi-fhir-bridge/source-program', code: 'adult-preventive' }] }, section: [{ section: [{ entry: observations.slice(0,4).map(o => ({ reference: `Observation/${o.id}` })) }] }] }]
 const { result } = renderHook(() => useOrphanObservations(observations,new Set(),'standardized',compositions))
 const rows = groupAdultPreventiveRows(result.current)
 expect(rows).toHaveLength(4)
 expect(calculateReportTabCounts([],[],observations,[],compositions).all).toBe(rows.length)
 expect(calculateReportTabCounts([],[],observations,[]).all).toBe(5)
})
