import { GenerateMedicalSummaryUseCase, buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

const data: any = {
  observations: [
    { id: 'urine', code: { text: 'TURBIDITY' }, valueString: 'Clear', effectiveDateTime: '2026-06-08' },
    { id: 'creatinine', code: { text: 'Creatinine' }, valueQuantity: { value: 1.2, unit: 'mg/dL' }, effectiveDateTime: '2026-06-08' },
    { id: 'a1c', code: { text: 'HbA1c' }, valueQuantity: { value: 7, unit: '%' }, effectiveDateTime: '2026-06-08' },
  ],
  diagnosticReports: [{ id: 'vascular', code: { text: 'Doppler baPWV' }, effectiveDateTime: '2026-06-08', conclusion: 'baPWV right 1500 / left 1600; arterial stiffness' }],
}
const catalog = buildSourceCatalog(data)
const key = (id: string) => catalog.find(x => x.resourceId === id)!.key
const useCase = new GenerateMedicalSummaryUseCase()
const run = (metric: string, ids: string[]) => useCase.finalizeResult({
  headline: '', problems: [{ label: 'Finding', kind: 'lab', basisSources: [key('vascular')], metric, metricSources: ids.map(key) }],
} as any, catalog, { clinicalData: data })

it('retains and flags a vascular metric citing urine instead of silently replacing it', () => {
  const row = run('baPWV 1500 → 1600', ['urine']).problems[0]
  expect(row.metric).toBe('baPWV 1500；1600')
  expect(row.metricNeedsReview).toBe(true)
  expect(row.metricMeta).toBeUndefined()
  expect(row.metricSegments).toBeUndefined()
  expect(row.metricSourceKeys).toEqual([key('urine')])
})

it('continues to correct model numbers for a matching analyte alias', () => {
  const row = run('CREA 99 mg/dL', ['creatinine']).problems[0]
  expect(row.metric).toContain('1.2')
  expect(row.metricNeedsReview).toBeUndefined()
  expect(row.metricMeta).toBe('2026-06-08')
})

it('flags a different numeric test even if its number happens to match', () => {
  expect(run('HbA1c 1.2%', ['creatinine']).problems[0]).toEqual(expect.objectContaining({ metric: 'HbA1c 1.2%', metricNeedsReview: true }))
})

it('does not append an unrelated cited test to a valid metric', () => {
  expect(run('HbA1c 7%', ['a1c', 'creatinine']).problems[0]).toEqual(expect.objectContaining({ metric: 'HbA1c 7%', metricNeedsReview: true }))
})

it('supports multiple named tests while keeping record values authoritative', () => {
  const row = run('HbA1c 99%; CREA 88 mg/dL', ['a1c', 'creatinine']).problems[0]
  expect(row.metric).toContain('7%')
  expect(row.metric).toContain('1.2')
  expect(row.metricNeedsReview).toBeUndefined()
})

it('still flags right/left measurements as non-temporal when correctly cited', () => {
  expect(run('baPWV 1500 → 1600', ['vascular']).problems[0]).toEqual(expect.objectContaining({ metric: 'baPWV 1500；1600', metricNeedsReview: true }))
})

it('retains the conflict and removes every trend arrow across another card retry', () => {
  const first = run('baPWV 1500 → 1600 → 1700', ['urine'])
  const second = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData: data })
  expect(second.problems[0]).toEqual(expect.objectContaining({ metric: 'baPWV 1500；1600；1700', metricNeedsReview: true }))
  expect(second.problems[0].metricMeta).toBeUndefined()
})

it('accepts a Chinese analyte name without confusing a different numeric value for a different test', () => {
  const row = run('肌酸酐 99 mg/dL', ['creatinine']).problems[0]
  expect(row.metric).toContain('1.2')
  expect(row.metricNeedsReview).toBeUndefined()
})
