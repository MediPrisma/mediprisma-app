import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import { createIntranetFetch, intranetGatewayAvailable, INTRANET_LUNA_ID } from '../interceptors/intranet-fetch'

export function createIntranetProvider() {
  if (!intranetGatewayAvailable()) throw new Error('院內 GPT 僅供北榮 app-staging 使用')
  const origin = process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN!
  const sdk = createOpenAI({ baseURL: `${origin}/v1`, apiKey: 'intranet-session', fetch: createIntranetFetch(origin) })
  return {
    isGemini: false,
    model: wrapLanguageModel({
      model: sdk.responses(INTRANET_LUNA_ID),
      middleware: {
        specificationVersion: 'v3',
        transformParams: async ({ params }) => ({
          ...params,
          maxOutputTokens: Math.min(params.maxOutputTokens ?? 2048, 2048),
          providerOptions: {
            ...params.providerOptions,
            openai: { ...params.providerOptions?.openai, store: false },
          },
        }),
      },
    }),
  }
}
