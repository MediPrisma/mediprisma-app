import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import { AiError, AiErrorCode } from '@/src/core/errors'
import { createIntranetFetch, intranetGatewayAvailable, INTRANET_LUNA_ID } from '../interceptors/intranet-fetch'

export function createIntranetProvider() {
  if (!intranetGatewayAvailable()) throw new Error('院內 GPT 僅供北榮院內入口使用')
  const origin = process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN!
  const sdk = createOpenAI({ baseURL: `${origin}/v1`, apiKey: 'intranet-session', fetch: createIntranetFetch(origin) })
  return {
    isGemini: false,
    model: wrapLanguageModel({
      model: sdk.responses(INTRANET_LUNA_ID),
      middleware: {
        specificationVersion: 'v3',
        wrapStream: async ({ doStream }) => {
          const result = await doStream()
          return {
            ...result,
            stream: result.stream.pipeThrough(new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === 'finish' && chunk.finishReason.unified === 'length') {
                  controller.enqueue({ type: 'error', error: new AiError(
                    '院內模型輸出達到上限，回應尚未完成', AiErrorCode.OUTPUT_TRUNCATED,
                    { modelId: INTRANET_LUNA_ID },
                  ) })
                }
                controller.enqueue(chunk)
              },
            })),
          }
        },
        transformParams: async ({ params }) => ({
          ...params,
          providerOptions: {
            ...params.providerOptions,
            openai: { ...params.providerOptions?.openai, store: false },
          },
        }),
      },
    }),
  }
}
