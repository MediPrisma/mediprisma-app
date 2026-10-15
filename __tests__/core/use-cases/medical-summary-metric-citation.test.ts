import { GenerateMedicalSummaryUseCase, buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

const data: any = {
  observations: [
    { id: 'urine', code: { text: 'TURBIDITY' }, valueString: 'Clear', effectiveDateTime: '2026-06-08' },
    { id: 'creatinine', code: { text: 'Creatinine' }, valueQuantity: { value: 1.2, unit: 'mg/dL' }, effectiveDateTime: '2026-06-08' },
    { id: 'a1c', code: { text: 'HbA1c' }, valueQuantity: { value: 7, unit: '%' }, effectiveDateTime: '2026-06-08' },
    { id: 'ca199', code: { text: 'CA 19-9' }, valueQuantity: { value: 35, unit: 'U/mL' }, effectiveDateTime: '2026-06-08' },
    { id: 'ldl', code: { text: 'LDL' }, valueQuantity: { value: 110, unit: 'mg/dL' }, effectiveDateTime: '2026-06-08' },
    { id: 'wbc', code: { text: 'WBC' }, valueQuantity: { value: 9.8, unit: 'K' }, effectiveDateTime: '2026-06-08' },
    { id: 'odd', code: { text: '某院特殊檢驗 ;(Zeta assay)' }, valueQuantity: { value: 3, unit: 'U' }, effectiveDateTime: '2026-06-08' },
    { id: 'ethanol', code: { text: 'Ethanol in Serum, Plasma or Blood' }, valueQuantity: { value: 50, unit: 'mg/dL' }, effectiveDateTime: '2026-06-08' },
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

it.each(['CA 19-9 99 U/mL', 'CA19-9 99 U/mL'])('corrects numeric-name analyte %s and remains stable on retry', metric => {
  const first = run(metric, ['ca199'])
  const second = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData: data })
  for (const result of [first, second]) {
    expect(result.problems[0].metric).toContain('35')
    expect(result.problems[0].metricNeedsReview).toBeUndefined()
    expect(result.problems[0].metricMeta).toBe('2026-06-08')
  }
})

it('does not turn a narrative qualifier into a different analyte', () => {
  const row = run('Rising creatinine 99 → 100 mg/dL', ['creatinine']).problems[0]
  expect(row.metric).toContain('1.2')
  expect(row.metricNeedsReview).toBeUndefined()
})

it('keeps translated patient-facing numeric test names stable on retry', () => {
  const initial = run('CA19-9 99 U/mL', ['ca199'])
  const options = { clinicalData: data, audience: 'patient' as const, locale: 'zh-TW' as const }
  const first = useCase.finalizeResult(useCase.createAiDraftFromResult(initial), catalog, options)
  const second = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, options)
  expect(second.problems[0].metric).toBe(first.problems[0].metric)
  expect(first.problems[0].metricNeedsReview).toBeUndefined()
  expect(second.problems[0].metricNeedsReview).toBeUndefined()
})

it.each(['Cr 99 mg/dL', 'Rising Cr 99 → 100 mg/dL'])('accepts the chart abbreviation %s', metric => {
  const row = run(metric, ['creatinine']).problems[0]
  expect(row.metric).toContain('1.2')
  expect(row.metricNeedsReview).toBeUndefined()
})

it('accepts the plain Chinese lay name on the first patient-mode pass', () => {
  const result = useCase.finalizeResult({ headline: '', problems: [{ label: 'Finding', metric: '低密度脂蛋白膽固醇 130 mg/dL', metricSources: [key('ldl')] }] } as any, catalog, { clinicalData: data, audience: 'patient', locale: 'zh-TW' })
  expect(result.problems[0].metric).toContain('110')
  expect(result.problems[0].metricNeedsReview).toBeUndefined()
})

it('does not interpret a later K unit as a potassium test name', () => {
  const row = run('WBC 12.3 K → 9.8 K', ['wbc']).problems[0]
  expect(row.metric).toContain('9.8')
  expect(row.metricNeedsReview).toBeUndefined()
})

it.each(['某院特殊檢驗 99 U', 'Zeta assay 99 U', '某院特殊檢驗 ;(Zeta assay) 99 U'])('accepts bilingual source name %s and its patient-facing retry', metric => {
  const options = { clinicalData: data, audience: 'patient' as const, locale: 'zh-TW' as const }
  const first = useCase.finalizeResult({ headline: '', problems: [{ label: 'Finding', metric, metricSources: [key('odd')] }] } as any, catalog, options)
  const second = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, options)
  for (const result of [first, second]) {
    expect(result.problems[0].metric).toContain('3 U')
    expect(result.problems[0].metricNeedsReview).toBeUndefined()
    expect(result.problems[0].metricMeta).toBe('2026-06-08')
  }
})

it('preserves commas inside source names while splitting separate test clauses', () => {
  const first = run('Ethanol in Serum, Plasma or Blood 99 mg/dL; HbA1c 88%', ['ethanol', 'a1c'])
  const second = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData: data })
  for (const result of [first, second]) {
    expect(result.problems[0].metric).toContain('50')
    expect(result.problems[0].metric).toContain('7%')
    expect(result.problems[0].metricNeedsReview).toBeUndefined()
  }
  expect(run('Ethanol in Serum, Plasma or Blood 50 mg/dL; baPWV 1500', ['ethanol', 'urine']).problems[0].metricNeedsReview).toBe(true)
})
