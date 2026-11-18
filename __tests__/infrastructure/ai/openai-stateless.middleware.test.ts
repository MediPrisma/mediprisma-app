/** @jest-environment node */
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { withOpenAiStatelessResponses } from '@/src/infrastructure/ai/streaming/openai-stateless.middleware'

it.each(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'])('%s carries encrypted reasoning and tool results through a stateless two-step request', async (modelId) => {
  const requests: any[] = []
  const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(init!.body as string))
    const output = requests.length === 1 ? [
      { type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'encrypted-test-content' },
      { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'lookup', arguments: '{}' },
    ] : [
      { type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: '2026-06-02: 32', annotations: [] }] },
    ]
    return new Response(JSON.stringify({ id: `resp_${requests.length}`, created_at: 1788912000, model: modelId, output }), {
      headers: { 'content-type': 'application/json' },
    })
  })
  const model = withOpenAiStatelessResponses(createOpenAI({ apiKey: 'test', fetch: fetchMock }).responses(modelId))
  const execute = jest.fn(async () => ({ date: '2026-06-02', value: 32 }))
  const result = await generateText({
    model,
    prompt: 'Find latest result',
    tools: { lookup: tool({ inputSchema: z.object({}), execute }) },
    stopWhen: stepCountIs(2),
    // The proxy policy must win while unrelated caller options survive.
    providerOptions: { openai: { store: true, reasoningEffort: 'low' } },
    maxRetries: 0,
  })
  expect(result.text).toBe('2026-06-02: 32')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(requests).toHaveLength(2)
  for (const request of requests) {
    expect(request.store).toBe(false)
    expect(request.reasoning.effort).toBe('low')
    expect(request.include).toContain('reasoning.encrypted_content')
    expect(request.input.some((item: any) => item.type === 'item_reference')).toBe(false)
  }
  expect(requests[1].input).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'reasoning', encrypted_content: 'encrypted-test-content' }),
    expect.objectContaining({ type: 'function_call', call_id: 'call_test' }),
    expect.objectContaining({ type: 'function_call_output', call_id: 'call_test', output: JSON.stringify({ date: '2026-06-02', value: 32 }) }),
  ]))
})
