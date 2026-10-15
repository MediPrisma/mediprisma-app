import { tryExtractJsonValue } from '@/src/core/utils/llm-json.utils'
import { GenerateMedicalSummaryUseCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

const complete = { closeMissingBrackets: true }

describe('tryExtractJsonValue', () => {
  it('closes one omitted final } only when the caller knows the reply was complete', () => {
    const missingOuter = '{"medicationEducation": [], "medicationReview": {"regimen": [{"name": "A", "sources": ["M1"]}]}'
    expect(tryExtractJsonValue(missingOuter, complete)).toEqual({
      medicationEducation: [], medicationReview: { regimen: [{ name: 'A', sources: ['M1'] }] },
    })
    expect(tryExtractJsonValue(missingOuter)).toBeNull()
  })

  it('never turns a truncated reply into a shortened success', () => {
    // Cut mid second event: the tail after the last closer is not empty.
    const midItem = '{"timeline": [{"ref": "E1", "label": "a"}, {"ref": "E2", "lab'
    expect(tryExtractJsonValue(midItem, complete)).toBeNull()
    expect(tryExtractJsonValue(midItem)).toBeNull()
    // Cut exactly at an item boundary: an open list is never closed.
    expect(tryExtractJsonValue('{"timeline": [{"ref": "E1", "label": "a"}', complete)).toBeNull()
    expect(tryExtractJsonValue('{"a": {"b": {"c": [1]}', complete)).toBeNull() // two missing
    expect(tryExtractJsonValue('{"a": "unterminated }', complete)).toBeNull()
    expect(tryExtractJsonValue('{"a": [1}', complete)).toBeNull()
  })

  it('drops one or two surplus closing brackets at the very end only', () => {
    expect(tryExtractJsonValue('{"a": {"b": []}}\n}')).toEqual({ a: { b: [] } })
    expect(tryExtractJsonValue('{"a": 1}}, {"b": 2}')).toBeNull()
  })

  it('inserts a colon missing after an identifier key', () => {
    expect(tryExtractJsonValue('{"trend": "8.2%", "interpretation "需追蹤", "sources": ["O1"]}'))
      .toEqual({ trend: '8.2%', interpretation: '需追蹤', sources: ['O1'] })
  })

  it('escapes a record quote copied inside a string value', () => {
    expect(tryExtractJsonValue('{"regimen": [{"name": "Nifedipine "X.R." 30mg", "sources": ["M1"]}]}'))
      .toEqual({ regimen: [{ name: 'Nifedipine "X.R." 30mg', sources: ['M1'] }] })
  })

  it('does not alter already-valid JSON', () => {
    const valid = '{"a": "He said \\"hi\\"", "b": ["x", "y"], "c": {"d": "{not a brace}"}}'
    expect(tryExtractJsonValue(valid)).toEqual(JSON.parse(valid))
  })

  it('keeps braces inside strings out of the bracket balance', () => {
    expect(tryExtractJsonValue('{"a": {"t": "x}]"}', complete)).toEqual({ a: { t: 'x}]' } })
  })
})

describe('medical summary batch blocks', () => {
  const useCase = new GenerateMedicalSummaryUseCase()
  const block = (id: string, body: string, closed = true) =>
    `<<<MEDIPRISMA_MODULE:${id}>>>\n${body}\n${closed ? `<<<END_MEDIPRISMA_MODULE:${id}>>>` : ''}`

  it('repairs an omitted final } in a block whose end marker arrived', () => {
    const body = '{"problems": [{"label": "糖尿病", "sources": ["C1"]}]'
    expect(useCase.parseBatchModuleResult('problems', block('problems', body))?.problems).toHaveLength(1)
  })

  it('rejects a truncated final block instead of keeping only its first items', () => {
    const truncated = '{"problems": [{"label": "糖尿病", "sources": ["C1"]}, {"label": "高血'
    expect(useCase.parseBatchModuleResult('problems', block('problems', truncated, false))).toBeNull()
    const atBoundary = '{"problems": [{"label": "糖尿病", "sources": ["C1"]}]'
    expect(useCase.parseBatchModuleResult('problems', block('problems', atBoundary, false))).toBeNull()
  })
})
