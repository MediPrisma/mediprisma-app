/** @jest-environment node */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import { withModelReporting } from '@/src/infrastructure/ai/streaming/model-reporting.middleware'
import { createModelExecution, reportModelExecution, modelExecutionNotice, markModelExecutionUnreported } from '@/src/shared/utils/ai-model-execution'

function response(parts: unknown[], modelVersion?: string) {
  return new Response(`data: ${JSON.stringify({
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], modelVersion,
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

test.each([undefined, 'gemini-4-hydrogen'])('tracks completed missing reports without treating pending metadata as missing (%s)', async (firstModel) => {
  let execution = createModelExecution('gemini-4-hydrogen')
  const fetch = jest.fn()
    .mockResolvedValueOnce(response([{ functionCall: { name: 'lookup', args: {} }, thoughtSignature: 'fixture-signature' }], firstModel))
    .mockResolvedValueOnce(response([{ text: 'Synthetic final answer' }], 'gemini-4-hydrogen'))
  const sdk = createGoogleGenerativeAI({ apiKey: 'fixture-key', fetch })
  const result = streamText({
    model: withModelReporting(sdk('gemini-4-hydrogen'), true,
      (id) => { execution = reportModelExecution(execution, id) },
      () => { execution = markModelExecutionUnreported(execution) }),
    prompt: 'Use lookup and answer', stopWhen: stepCountIs(2),
    tools: { lookup: tool({ description: 'Local fixture', inputSchema: z.object({}), execute: async () => 'synthetic data' }) },
  })
  expect(await result.text).toBe('Synthetic final answer')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(execution.actualModelId).toBe('gemini-4-hydrogen')
  if (firstModel) {
    expect(modelExecutionNotice(execution, 'zh-TW')).toBeNull()
    expect(execution.hasUnreportedSteps).not.toBe(true)
  } else {
    expect(modelExecutionNotice(execution, 'zh-TW')).toContain('無法確認')
    expect(execution.hasUnreportedSteps).toBe(true)
  }
})
