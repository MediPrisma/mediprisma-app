import { withHaikuSummaryEvidenceCheck } from '@/src/core/use-cases/medical-summary/haiku-summary-policy'
import type { AiMessage } from '@/src/core/entities/ai.entity'

it('keeps all source text and schema while appending a Haiku-only evidence reminder', () => {
  const input: AiMessage[] = [
    { role: 'system', content: 'Return the existing JSON schema and module markers.' },
    { role: 'user', content: 'Synthetic source: possible disease X; 2026-01-01 no cardiomegaly.' },
  ]
  const before = JSON.stringify(input)
  const result = withHaikuSummaryEvidenceCheck(input, 'claude-haiku-5-5')
  expect(result[0]).toEqual(input[0])
  expect(result[1].content.startsWith(input[1].content)).toBe(true)
  expect(result[1].content).toMatch(/uncertain history/)
  expect(result[1].content).toMatch(/preserve negation, examination dates/)
  expect(JSON.stringify(input)).toBe(before)
  expect(withHaikuSummaryEvidenceCheck(input, 'gemini-4-hydrogen')).toBe(input)
})
