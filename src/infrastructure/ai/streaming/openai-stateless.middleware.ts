import { wrapLanguageModel } from 'ai'

/** Match the proxy's store:false policy before the SDK serializes each step. */
export function withOpenAiStatelessResponses(model: Parameters<typeof wrapLanguageModel>[0]['model']) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.openai,
            // This SDK predates GPT-6; preserve reasoning and encrypted tool context.
            ...(model.modelId.startsWith('gpt-6') ? { forceReasoning: true } : {}),
            store: false,
          },
        },
      }),
    },
  })
}
