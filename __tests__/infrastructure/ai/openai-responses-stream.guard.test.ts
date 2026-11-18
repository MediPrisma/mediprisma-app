/** @jest-environment node */

import { guardOpenAiResponsesProxyStream } from '@/src/infrastructure/ai/interceptors/openai-responses-stream.guard'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'

function streamingResponse(chunks: string[], contentType = 'text/event-stream'): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  }), {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': '999' },
  })
}

describe('guardOpenAiResponsesProxyStream', () => {
  it('normalizes a bare proxy error split across SSE chunks', async () => {
    const response = guardOpenAiResponsesProxyStream(streamingResponse([
      'data: {"error":"Upstream ',
      'request failed"}\n\n',
    ]))

    const body = await response.text()
    const payload = JSON.parse(body.replace(/^data: /, '').trim())

    expect(payload).toEqual({
      type: 'error',
      sequence_number: 0,
      error: {
        type: 'upstream_error',
        code: 'upstream_error',
        message: 'Upstream request failed',
        param: null,
      },
    })
    expect(response.headers.has('content-length')).toBe(false)
  })

  it('preserves valid Responses events and CRLF framing', async () => {
    const event = 'data: {"type":"response.output_text.delta","item_id":"item-1","delta":"ok"}\r\n\r\n'
    const response = guardOpenAiResponsesProxyStream(streamingResponse([event]))

    await expect(response.text()).resolves.toBe(event)
  })

  it('preserves a legitimate typed error event byte-for-byte', async () => {
    const event = 'data: {"type":"error","sequence_number":7,"error":{"type":"server_error","code":"provider_code","message":"Provider failed","param":"model"}}\n\n'
    const response = guardOpenAiResponsesProxyStream(streamingResponse([event]))

    await expect(response.text()).resolves.toBe(event)
  })

  it('produces an error event accepted by the installed OpenAI Responses parser', async () => {
    const fetch = jest.fn(async () => guardOpenAiResponsesProxyStream(streamingResponse([
      'data: {"error":"Upstream request failed"}\n\n',
    ])))
    const openai = createOpenAI({ apiKey: 'test-key', fetch })
    const errors: unknown[] = []
    const result = streamText({
      model: openai.responses('gpt-6.1-terra'),
      prompt: 'hello',
      maxRetries: 0,
      onError: ({ error }) => {
        errors.push(error)
      },
    })

    for await (const _ of result.textStream) {
      // Drain the provider stream so its Responses schema validates each event.
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: 'error',
      sequence_number: 0,
      error: {
        type: 'upstream_error',
        code: 'upstream_error',
        message: 'Upstream request failed',
        param: null,
      },
    })
  })

  it('does not touch non-SSE responses', () => {
    const response = streamingResponse(['{"error":"Upstream request failed"}'], 'application/json')

    expect(guardOpenAiResponsesProxyStream(response)).toBe(response)
  })
})
