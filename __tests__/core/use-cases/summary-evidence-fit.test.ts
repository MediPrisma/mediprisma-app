import { labClaimConflicts, reportOrganFromQuotes } from '@/src/core/utils/summary-evidence-fit.utils'
import { buildSourceCatalog, GenerateMedicalSummaryUseCase, finalizeReportHighlights } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

test.each([
  ['Hyperuricemia', ['Urine Protein'], true],
  ['Hyperuricemia', ['Uric acid'], false],
  ['Hypokalemia', ['Sodium'], true],
  ['Hypokalemia', ['Potassium'], false],
  ['Anemia', ['Hemoglobin'], false],
  ['Unknown condition', ['Unfamiliar test'], false],
])('checks narrow biochemical evidence without diagnosing: %s', (label, names, conflict) => {
  expect(labClaimConflicts(label, names)).toBe(conflict)
})

test('unrelated lab-only disease remains visible and flagged, without verified metric date', () => {
  const data: any = { observations: [{ id: 'protein', code: { text: 'Urine Protein' }, valueQuantity: { value: 17, unit: 'mg/dL' }, effectiveDateTime: '2026-01-01' }] }
  const catalog = buildSourceCatalog(data)
  const result = new GenerateMedicalSummaryUseCase().finalizeResult({ headline: '', problems: [{ label: 'Hyperuricemia', kind: 'lab', basisSources: [catalog[0].key], metricSources: [catalog[0].key], metric: 'PROT 17 mg/dL' }] } as any, catalog, { clinicalData: data })
  expect(result.problems[0]).toMatchObject({ label: 'Hyperuricemia', flag: true, metricNeedsReview: true })
  expect(result.problems[0].metricMeta).toBeUndefined()
})

test.each([
  ['gynecologic', 'Bone, humeral head, fracture.', 'musculoskeletal'],
  ['musculoskeletal', 'Uterine leiomyoma.', 'gynecologic'],
  ['other', 'Renal cortical cyst.', 'kidney-urinary'],
  ['heart', 'Liver and lung lesions.', 'other'],
  ['heart', 'No specific anatomical term.', 'heart'],
])('uses verified anatomy across organs: %s / %s', (proposed, quote, expected) => {
  expect(reportOrganFromQuotes(proposed as any, [quote])).toBe(expected)
})

test('regroups an actual verified pathology quote without losing the finding or source', () => {
  const data: any = { diagnosticReports: [{ id: 'path', code: { text: 'Surgical pathology' }, category: [{ text: 'pathology' }], conclusion: 'Bone, femoral head, fracture.', effectiveDateTime: '2026-01-01' }] }
  const catalog = buildSourceCatalog(data)
  const key = catalog.find(entry => entry.resourceId === 'path')!.key
  const result = finalizeReportHighlights({ groups: [{ organ: 'gynecologic', points: [{ text: 'Femoral head fracture', sources: [key], quotes: [{ source: key, quote: 'Bone, femoral head, fracture.' }] }] }], unremarkable: [] }, data, catalog)
  expect(result.groups[0].organ).toBe('musculoskeletal')
  expect(result.groups[0].points[0].sources[0].key).toBe(key)
})
