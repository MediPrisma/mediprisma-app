import { generateMedicalSummaryUseCase as useCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import type { MedicalSummaryResult } from '@/src/core/entities/medical-summary.entity'

test('retrying another card preserves the original excerpts on every retained claim', () => {
  const evidence = [{ source: 'D1', quote: 'Possible pneumonia; follow-up assessment pending.' }]
  const claim = { sourceKeys: ['D1'], documentEvidence: evidence }
  const result = {
    headline: '來源文件待追蹤事項',
    problems: [{ label: '疑似肺炎', kind: 'discharge', basis: '文件', ...claim }],
    medicationEducation: [{ name: 'Synthetic medication', benefit: '文件記載用途', attention: '依醫囑', ...claim }],
    sourceIndex: [],
  } as unknown as MedicalSummaryResult
  const retained = useCase.createAiDraftFromResult(result)
  const retried = useCase.mergeModuleResult(retained, 'overview', { headline: '新標題', medicationEducation: [] })
  for (const item of [retained.problems[0], retained.medicationEducation[0]]) {
    expect(item.documentEvidence).toEqual(evidence)
  }
  expect(retried.problems[0].documentEvidence).toEqual(evidence)
  retained.problems[0].documentEvidence![0].quote = 'changed copy'
  expect(result.problems[0].documentEvidence![0].quote).toBe(evidence[0].quote)
})
