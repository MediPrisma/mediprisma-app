import { isProviderContextWindowExceededError } from '@/src/core/errors'
import {
  clinicalContextTokenTarget,
  fitClinicalContextTextToTokenBudget,
} from '@/src/core/utils/adaptive-clinical-context.utils'
import {
  ContextOverflowError,
  createContextOverflowIssue,
} from '@/src/shared/utils/context-budget'
import { estimateTokens } from '@/src/shared/utils/token-estimator'

const PROVIDER_RETRY_TARGET_FRACTIONS = [0.7, 0.5, 0.35] as const
const TVGH_GEMMA_SAFETY_FRACTION = 0.65

export interface ContextWindowRetryRequest<TRequest, TResult> {
  clinicalContext: string
  contextLimit: number
  modelId: string
  allowProviderRetry?: boolean
  modelName: string
  locale: string
  buildRequest: (clinicalContext: string) => {
    request: TRequest
    /** Complete serialized prompt text, including fixed instructions and
     * source indexes, used by the local preflight estimate. */
    requestText: string
  }
  execute: (request: TRequest) => Promise<TResult>
  onRetry?: (reason: 'local-preflight' | 'provider-overflow', retry: number) => void
}

export interface ContextWindowRetryResult<TResult> {
  value: TResult
  clinicalContext: string
  retryCount: number
}

/** TVGHBrain currently routes to Gemma-family backends. Their tokenizer can
 * count Traditional Chinese considerably more densely than our provider-
 * neutral browser estimate, so leave deterministic headroom before the first
 * request. The provider-overflow retry below remains the final authority. */
export function providerClinicalContextSafetyFraction(modelName: string): number {
  return /(?:tvghbrain|gemma)/i.test(modelName)
    ? TVGH_GEMMA_SAFETY_FRACTION
    : 1
}

/** Execute one structured request with bounded context recovery. Local
 * preflight overflow and a real provider ContextWindowExceededError share the
 * same progressively smaller clinical-context targets. This keeps the retry
 * inside the original generation promise, so batch cancellation, progress,
 * and cache ownership do not briefly settle between attempts. */
export async function runWithContextWindowRetry<TRequest, TResult>(
  options: ContextWindowRetryRequest<TRequest, TResult>,
): Promise<ContextWindowRetryResult<TResult>> {
  const baseTarget = clinicalContextTokenTarget(options.contextLimit)
  const initialSafetyFraction = providerClinicalContextSafetyFraction(options.modelName)
  let clinicalContext = initialSafetyFraction < 1
    ? fitClinicalContextTextToTokenBudget(
        options.clinicalContext,
        Math.max(1, Math.floor(baseTarget * initialSafetyFraction)),
      )
    : options.clinicalContext
  let fallbackIndex = 0
  let retryCount = 0

  const reduceClinicalContext = (): boolean => {
    const currentTokens = estimateTokens(clinicalContext)
    while (fallbackIndex < PROVIDER_RETRY_TARGET_FRACTIONS.length) {
      const fraction = PROVIDER_RETRY_TARGET_FRACTIONS[fallbackIndex]
      fallbackIndex += 1
      const targetTokens = Math.max(1, Math.floor(baseTarget * fraction))
      if (targetTokens >= currentTokens) continue
      const reduced = fitClinicalContextTextToTokenBudget(clinicalContext, targetTokens)
      if (estimateTokens(reduced) >= currentTokens) continue
      clinicalContext = reduced
      retryCount += 1
      return true
    }
    return false
  }

  while (true) {
    const built = options.buildRequest(clinicalContext)
    const localOverflow = createContextOverflowIssue(
      built.requestText,
      options.modelId,
      {
        selectedContext: clinicalContext,
        contextLimit: options.contextLimit,
      },
    )
    if (localOverflow) {
      if (reduceClinicalContext()) {
        options.onRetry?.('local-preflight', retryCount)
        continue
      }
      throw new ContextOverflowError(localOverflow, options.locale)
    }

    try {
      return {
        value: await options.execute(built.request),
        clinicalContext,
        retryCount,
      }
    } catch (error) {
      if (
        options.allowProviderRetry !== false && isProviderContextWindowExceededError(error) &&
        reduceClinicalContext()
      ) {
        options.onRetry?.('provider-overflow', retryCount)
        continue
      }
      throw error
    }
  }
}
