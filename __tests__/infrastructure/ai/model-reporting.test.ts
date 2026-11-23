/** @jest-environment node */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText } from 'ai'
import { withModelReporting } from '@/src/infrastructure/ai/streaming/model-reporting.middleware'

function geminiResponse(modelVersion?: string) {
  return new Response([
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] } }], modelVersion },
    { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }], modelVersion,
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } },
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('provider-reported model identity through the real Google SDK', () => {
  it.each(['gemini-3.1-flash-lite', 'gemini-4-hydrogen'])('preserves %s from raw SSE metadata', async (actual) => {
    const onModelReported = jest.fn()
    const fetch = jest.fn().mockResolvedValue(geminiResponse(actual))
    const sdk = createGoogleGenerativeAI({ apiKey: 'fixture-key', fetch })
    const result = streamText({
      model: withModelReporting(sdk('gemini-4-hydrogen'), true, onModelReported),
      prompt: 'hello',
    })
    expect(await result.text).toBe('Hello')
    expect(onModelReported).toHaveBeenCalledTimes(2)
    expect(onModelReported).toHaveBeenNthCalledWith(1, null)
    expect(onModelReported).toHaveBeenCalledWith(actual)
    expect((await result.response).modelId).toBe(actual)
    expect(fetch.mock.calls[0][0]).toContain('gemini-4-hydrogen:streamGenerateContent')
  })

  it('does not fabricate confirmation when modelVersion is absent', async () => {
    const onModelReported = jest.fn()
    const sdk = createGoogleGenerativeAI({ apiKey: 'fixture-key', fetch: jest.fn().mockResolvedValue(geminiResponse()) })
    const result = streamText({ model: withModelReporting(sdk('gemini-4-hydrogen'), true, onModelReported), prompt: 'hello' })
    expect(await result.text).toBe('Hello')
    expect(onModelReported.mock.calls).toEqual([[null]])
  })
})
