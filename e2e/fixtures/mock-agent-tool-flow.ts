import { type Page } from '@playwright/test'

export const AGENT_TOOL_E2E_MARKER = 'E2E_AGENT_TOOL_FLOW_4c91'

export interface MockAgentToolFlowOptions {
  toolName: string
  input: Record<string, unknown>
  expectedResultIncludes: string[]
  finalMarkdown: string
  model?: string
}

/**
 * Deterministic two-step model mock (Gemini by default):
 *
 *   user prompt -> model tool_call -> real browser-side FHIR tool execution
 *   -> tool result sent back to model -> final answer
 *
 * The second response is successful only when the outbound request really
 * contains every expected fragment from the locally executed tool result.
 * This catches broken registration, wrong data snapshots, mapper omissions,
 * and agent-loop result forwarding without depending on a live model.
 */
export async function mockAgentToolFlow(
  page: Page,
  options: MockAgentToolFlowOptions,
): Promise<void> {
  const model = options.model ?? 'gemini-3.1-flash-lite'

  await page.addInitScript(
    ({ model, marker, toolName, toolInput, expectedResultIncludes, finalMarkdown }) => {
      localStorage.setItem('ai-config-storage', JSON.stringify({ state: { model }, version: 0 }))

      const state = window as unknown as {
        __agentToolRequestBodies?: string[]
        __agentToolResultVerified?: boolean
      }
      state.__agentToolRequestBodies = []
      state.__agentToolResultVerified = false

      const frame = (delta: Record<string, unknown>, finishReason: string | null = null) =>
        `data: ${JSON.stringify(model.startsWith('gemini') ? {
          candidates: [{ index: 0, content: { role: 'model', parts: delta.tool_calls
            ? (delta.tool_calls as Array<{ function: { name: string; arguments: string } }>).map(call => ({ functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) } }))
            : [{ text: delta.content ?? '' }] }, ...(finishReason ? { finishReason: 'STOP' } : {}) }],
          modelVersion: model,
        } : {
          id: 'chatcmpl-agent-tool-e2e',
          object: 'chat.completion.chunk',
          created: 0,
          model,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`

      const toolCallFrames = [
        frame({ role: 'assistant', content: null }),
        frame({
          tool_calls: [{
            index: 0,
            id: 'call_agent_tool_e2e',
            type: 'function',
            function: {
              name: toolName,
              arguments: JSON.stringify(toolInput),
            },
          }],
        }),
        frame({}, 'tool_calls'),
        'data: [DONE]\n\n',
      ]

      const textFrames = (text: string) => [
        frame({ role: 'assistant', content: '' }),
        frame({ content: text }),
        frame({}, 'stop'),
        'data: [DONE]\n\n',
      ]

      const streamResponse = (frames: string[]) => {
        const encoded = new TextEncoder()
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            for (const item of frames) controller.enqueue(encoded.encode(item))
            controller.close()
          },
        }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        })
      }

      const proxyHosts = /e2e-proxy\.test|cloudfunctions\.net|run\.app/
      const realFetch = window.fetch.bind(window)
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
        const body = typeof init?.body === 'string' ? init.body : ''
        const isAgentChat = proxyHosts.test(url)
          && init?.method === 'POST'
          && body.includes(marker)
        if (!isAgentChat) return realFetch(input as RequestInfo, init)

        state.__agentToolRequestBodies!.push(body)
        if (state.__agentToolRequestBodies!.length === 1) {
          return streamResponse(toolCallFrames)
        }

        const verified = expectedResultIncludes.every(fragment => body.includes(fragment))
        // Chat may launch a follow-up-suggestion request after the final
        // answer. Preserve a successful agent-loop verification instead of
        // allowing that unrelated third request to overwrite it.
        state.__agentToolResultVerified = state.__agentToolResultVerified || verified
        return streamResponse(textFrames(
          verified
            ? finalMarkdown
            : `E2E_TOOL_RESULT_MISSING: ${expectedResultIncludes.filter(fragment => !body.includes(fragment)).join(', ')}`,
        ))
      }
    },
    {
      model,
      marker: AGENT_TOOL_E2E_MARKER,
      toolName: options.toolName,
      toolInput: options.input,
      expectedResultIncludes: options.expectedResultIncludes,
      finalMarkdown: options.finalMarkdown,
    },
  )
}

export async function wasAgentToolResultVerified(page: Page): Promise<boolean> {
  return page.evaluate(() => (
    window as unknown as { __agentToolResultVerified?: boolean }
  ).__agentToolResultVerified === true)
}

export async function agentToolRequestCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    window as unknown as { __agentToolRequestBodies?: string[] }
  ).__agentToolRequestBodies?.length ?? 0)
}

export async function agentToolRequestBodies(page: Page): Promise<string[]> {
  return page.evaluate(() => (
    window as unknown as { __agentToolRequestBodies?: string[] }
  ).__agentToolRequestBodies ?? [])
}
