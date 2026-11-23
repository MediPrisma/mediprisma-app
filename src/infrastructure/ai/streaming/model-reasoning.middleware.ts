import { wrapLanguageModel } from 'ai'
import type { ModelDefinition } from '@/src/shared/constants/ai-models.constants'

type Model = Parameters<typeof wrapLanguageModel>[0]['model']

/** Apply the same defaults to streaming, non-streaming and agent steps. */
export function withModelReasoningDefaults(model: Model, definition: ModelDefinition) {
  if (!definition.reasoningEffort) return model
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        maxOutputTokens: params.maxOutputTokens ?? definition.defaultMaxOutputTokens,
        providerOptions: {
          ...params.providerOptions,
          ...(definition.provider === 'openai' ? {
            openai: {
              // The installed SDK does not recognise GPT-6 model IDs yet.
              forceReasoning: true,
              reasoningEffort: definition.reasoningEffort,
              ...params.providerOptions?.openai,
            },
          } : {
            anthropic: {
              thinking: { type: 'adaptive' },
              effort: definition.reasoningEffort,
              ...params.providerOptions?.anthropic,
            },
          }),
        },
      }),
    },
  })
}
