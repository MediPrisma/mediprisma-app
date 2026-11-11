import type { AiTokenUsage } from '@/src/core/entities/ai.entity'

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

/**
 * Token counts exactly as the AI service reported them, whichever dialect it
 * speaks (Chat Completions, Responses, Gemini, or the AI SDK shape).
 * A side the service did not report stays undefined; nothing is estimated.
 */
export function readTokenUsage(raw: unknown): AiTokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  const inputTokens = count(u.inputTokens) ?? count(u.input_tokens) ?? count(u.prompt_tokens) ?? count(u.promptTokenCount)
  // Gemini bills hidden reasoning as output but reports it apart from the visible candidates.
  const candidates = count(u.candidatesTokenCount)
  const outputTokens = count(u.outputTokens) ?? count(u.output_tokens) ?? count(u.completion_tokens) ??
    (candidates === undefined ? undefined : candidates + (count(u.thoughtsTokenCount) ?? 0))
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) }
}
