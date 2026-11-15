import { wrapLanguageModel } from 'ai'

type Model = Parameters<typeof wrapLanguageModel>[0]['model']

/** Send the catalog's thinking level to a Gemini model unless the caller set one. */
export function withGeminiThinkingLevel(model: Model, thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | undefined) {
  if (!thinkingLevel) return model
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => {
        const google = params.providerOptions?.google ?? {}
        const thinkingConfig = (google.thinkingConfig ?? {}) as Record<string, unknown>
        return {
          ...params,
          providerOptions: {
            ...params.providerOptions,
            google: { ...google, thinkingConfig: { thinkingLevel, ...thinkingConfig } },
          },
        }
      },
    },
  })
}
