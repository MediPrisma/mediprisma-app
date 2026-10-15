import type { CollectorContext, CollectorOperation } from './collector'
import type { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'

/** Scope transport observations without changing arguments, results, retries or cancellation.
 * No global async context: concurrent runs each retain their own capability.
 */
type Ai = ReturnType<typeof useUnifiedAi>
export function withCollectorOperation(ai: Ai, operation?: CollectorOperation): Ai {
  if (!operation) return ai
  const context = (original?: CollectorContext): CollectorContext => ({ ...original, operation })
  return { ...ai,
    query: (messages, options) => ai.query(messages, { ...options, collectorContext: context(options?.collectorContext) }),
    stream: (messages, options) => ai.stream(messages, { ...options, collectorContext: context(options?.collectorContext) }),
  }
}
