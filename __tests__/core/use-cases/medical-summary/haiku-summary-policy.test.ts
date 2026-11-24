import {
  haikuSummaryLaneOptions,
  withHaikuSummaryLanePolicy,
} from '@/src/core/use-cases/medical-summary/haiku-summary-policy'
import type { AiMessage } from '@/src/core/entities/ai.entity'

const HAIKU = 'claude-haiku-5-5'
const input: AiMessage[] = [
  { role: 'system', content: 'Shared rules.\n\nBATCH CARD OUTPUT CONTRACT: Generate all 1 registered cards.' },
  { role: 'user', content: 'Synthetic source: possible disease X; 2026-01-01 no cardiomegaly.' },
]

it('scopes a one-card request and ends it on that card\'s own check, keeping the source text', () => {
  const before = JSON.stringify(input)
  const [system, user] = withHaikuSummaryLanePolicy(input, HAIKU, ['problems'])
  expect(system.content).toContain('BATCH CARD OUTPUT CONTRACT: This request covers ONLY the problems card.')
  expect(system.content.endsWith('Generate all 1 registered cards.')).toBe(true)
  expect(user.content.startsWith(input[1].content)).toBe(true)
  expect(user.content).toMatch(/<<<WORKSHEET>>>[\s\S]*never a pharmacy/)
  expect(JSON.stringify(input)).toBe(before)
})

it('gives each card its own check', () => {
  expect(withHaikuSummaryLanePolicy(input, HAIKU, ['safety'])[1].content).toMatch(/think through every candidate alert/)
  expect(withHaikuSummaryLanePolicy(input, HAIKU, ['reports'])[1].content).toMatch(/Preserve negation, examination dates/)
  expect(withHaikuSummaryLanePolicy(input, HAIKU, ['overview'])[1].content).toMatch(/never romanized or translated/)
})

it('leaves other models and multi-card requests untouched', () => {
  expect(withHaikuSummaryLanePolicy(input, 'gemini-4-hydrogen', ['problems'])).toBe(input)
  expect(withHaikuSummaryLanePolicy(input, HAIKU, ['overview', 'problems'])).toBe(input)
})

it('lets only the safety card think, with room for it', () => {
  expect(haikuSummaryLaneOptions(HAIKU, ['safety'])).toEqual({ claudeThinking: 'adaptive', maxTokens: 16_000 })
  expect(haikuSummaryLaneOptions(HAIKU, ['problems'])).toEqual({})
  expect(haikuSummaryLaneOptions('gpt-6-luna', ['safety'])).toEqual({})
})
