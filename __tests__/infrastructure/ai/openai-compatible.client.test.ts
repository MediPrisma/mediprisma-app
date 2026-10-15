import {
  createConfiguredOpenAiCompatibleFetch,
  hiddenReasoningOffRequestFields,
  createOpenAiCompatibleFetch,
  createOpenAiCompatibleGatewayFetch,
  testOpenAiCompatibleAgentCapability,
  testOpenAiCompatibleConnection,
} from '@/src/infrastructure/ai/openai-compatible/openai-compatible.client'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { asSchema, type FlexibleSchema } from '@ai-sdk/provider-utils'
import { TextDecoderStream as NodeTextDecoderStream } from 'node:stream/web'

if (typeof globalThis.TextDecoderStream === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoderStream', {
    configurable: true,
    value: NodeTextDecoderStream,
  })
}

jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({
  getProxyIdToken: jest.fn(async () => 'firebase-id-token'),
}))
jest.mock('@/src/infrastructure/ai/utils/app-check', () => ({
  getAppCheckToken: jest.fn(async () => 'app-check-token'),
}))

const profile = {
  enabled: true,
  baseUrl: 'https://llm.intra.example/v1',
  modelId: 'hospital-model',
  apiKey: 'hospital-secret',
}

const openRouterProfile = {
  enabled: true,
  baseUrl: 'https://openrouter.ai/api/v1',
  modelId: 'qwen/qwen3.6-35b-a3b',
  apiKey: 'openrouter-secret',
}

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 404 ? 'Not Found' : 'OK',
  json: async () => body,
} as Response)

const streamBody = (value: string): ReadableStream<Uint8Array> => {
  const encoded = new TextEncoder().encode(value)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })
}

const sseResponse = (events: unknown[]): Response => {
  const payload = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    'data: [DONE]\n\n',
  ].join('')
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: streamBody(payload),
  } as Response
}

const errorResponse = (status: number, message: string): Response => {
  const payload = JSON.stringify({ error: { message } })
  return {
    ok: false,
    status,
    statusText: message,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: streamBody(payload),
    text: async () => payload,
  } as Response
}

const firstToolCallStream = () => sseResponse([
  {
    id: 'chatcmpl-probe-1',
    model: 'hospital-model',
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: 'call-probe-1',
          type: 'function',
          function: {
            name: 'getDataOverview',
            arguments: '{}',
          },
        }],
      },
      finish_reason: null,
    }],
  },
  {
    id: 'chatcmpl-probe-1',
    model: 'hospital-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  },
])

const firstOpenRouterToolCallStream = () => sseResponse([
  {
    id: 'chatcmpl-openrouter-probe-1',
    model: 'qwen/qwen3.6-35b-a3b',
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        reasoning_details: [{
          type: 'reasoning.text',
          text: 'I should call the requested synthetic tool.',
          signature: 'signed-reasoning-detail',
          format: 'unknown',
        }],
      },
      finish_reason: null,
    }],
  },
  {
    id: 'chatcmpl-openrouter-probe-1',
    model: 'qwen/qwen3.6-35b-a3b',
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call-openrouter-probe-1',
          type: 'function',
          function: {
            name: 'getDataOverview',
            arguments: '{}',
          },
        }],
      },
      finish_reason: null,
    }],
  },
  {
    id: 'chatcmpl-openrouter-probe-1',
    model: 'qwen/qwen3.6-35b-a3b',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  },
])

const finalTextStream = (content: string) => sseResponse([
  {
    id: 'chatcmpl-probe-2',
    model: 'hospital-model',
    choices: [{
      index: 0,
      delta: { role: 'assistant', content },
      finish_reason: null,
    }],
  },
  {
    id: 'chatcmpl-probe-2',
    model: 'hospital-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  },
])

function agentRoundTripFetch(finalText?: string | ((nonce: string) => string)) {
  return jest.fn(async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const body = JSON.parse(String(init?.body)) as {
      messages?: Array<{ role?: string; content?: string }>
    }
    const toolMessage = body.messages?.find((message) => message.role === 'tool')
    if (!toolMessage) return firstToolCallStream()
    const nonce = JSON.parse(String(toolMessage.content)).data.nonce as string
    const responseText = typeof finalText === 'function'
      ? finalText(nonce)
      : finalText ?? nonce
    return finalTextStream(responseText)
  }) as jest.MockedFunction<typeof fetch>
}

describe('OpenAI-compatible browser client', () => {
  it('tests /models directly and reports whether the model exists', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({
      data: [
        { id: 'other-model', max_model_len: 32768 },
        { id: 'hospital-model', max_model_len: 131072 },
      ],
    })) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection(profile, { fetchImpl })).resolves.toEqual({
      models: ['other-model', 'hospital-model'],
      modelFound: true,
      usedChatProbe: false,
      detectedContextWindowTokens: 131072,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://llm.intra.example/v1/models')
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer hospital-secret')
  })

  it.each([
    { label: 'context_length', metadata: { context_length: '65536' }, expected: 65536 },
    { label: 'context_window', metadata: { contextWindow: 32768 }, expected: 32768 },
    {
      label: 'smaller top-provider limit',
      metadata: { context_length: 131072, top_provider: { context_length: 98304 } },
      expected: 98304,
    },
  ])('detects the selected model runtime window from $label metadata', async ({
    metadata,
    expected,
  }) => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({
      data: [{ id: 'hospital-model', ...metadata }],
    })) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection(profile, { fetchImpl }))
      .resolves.toMatchObject({ detectedContextWindowTokens: expected })
  })

  it.each([
    { label: 'completion limit', metadata: { max_tokens: 500000 } },
    { label: 'training limit', metadata: { n_ctx_train: 500000 } },
    { label: 'architecture limit', metadata: { max_position_embeddings: 500000 } },
    { label: 'ambiguous model maximum', metadata: { max_context_length: 500000 } },
    { label: 'fractional value', metadata: { max_model_len: 32768.5 } },
    { label: 'too-small value', metadata: { max_model_len: 512 } },
    { label: 'too-large value', metadata: { max_model_len: 2_000_001 } },
  ])('does not auto-apply an unsafe $label', async ({ metadata }) => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({
      data: [{ id: 'hospital-model', ...metadata }],
    })) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection(profile, { fetchImpl }))
      .resolves.toMatchObject({ detectedContextWindowTokens: null })
  })

  it('treats a successful null models payload as an empty model list', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse(null)) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection(profile, { fetchImpl })).resolves.toEqual({
      models: [],
      modelFound: null,
      usedChatProbe: false,
      detectedContextWindowTokens: null,
    })
  })

  it('falls back to a patient-free one-token chat probe when /models is absent', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse(null, 404)) as jest.MockedFunction<typeof fetch>
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(null, 404))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'OK' } }],
      }))

    const result = await testOpenAiCompatibleConnection(
      { ...profile, apiKey: null },
      { fetchImpl },
    )
    expect(result).toEqual({
      models: [],
      modelFound: null,
      usedChatProbe: true,
      detectedContextWindowTokens: null,
    })
    expect(String(fetchImpl.mock.calls[1][0])).toBe(
      'https://llm.intra.example/v1/chat/completions',
    )
    const init = fetchImpl.mock.calls[1][1]
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'hospital-model',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 1,
      stream: false,
    })
  })

  it('uses the configured model literally when /models is forbidden', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse(null, 403)) as jest.MockedFunction<typeof fetch>
    fetchImpl
      .mockResolvedValueOnce(jsonResponse({ error: 'model listing forbidden' }, 403))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'OK' } }],
      }))

    await expect(testOpenAiCompatibleConnection(
      {
        ...profile,
        baseUrl: 'https://llm.intra.example/v1/chat/completions',
        modelId: 'MODEL_NAME',
      },
      { fetchImpl },
    )).resolves.toEqual({
      models: [],
      modelFound: null,
      usedChatProbe: true,
      detectedContextWindowTokens: null,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://llm.intra.example/v1/models',
    )
    expect(String(fetchImpl.mock.calls[1][0])).toBe(
      'https://llm.intra.example/v1/chat/completions',
    )
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
      model: 'MODEL_NAME',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 1,
      stream: false,
    })
  })

  it('surfaces a forbidden Chat Completions probe after /models is forbidden', async () => {
    const forbiddenResponse = {
      ok: false,
      status: 403,
      statusText: '',
      json: async () => null,
    } as Response
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => forbiddenResponse) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection(profile, { fetchImpl }))
      .rejects.toThrow('HTTP 403')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not probe Chat Completions when /models rejects authentication', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({ error: 'invalid key' }, 401)) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection(profile, { fetchImpl }))
      .rejects.toThrow('HTTP 401: invalid key')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('strips the SDK placeholder Authorization header for keyless endpoints', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    try {
      const customFetch = createOpenAiCompatibleFetch(null)
      await customFetch('https://llm.intra.example/v1/chat/completions', {
        headers: { Authorization: 'Bearer local-endpoint-no-auth' },
      })
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
    } finally {
      global.fetch = originalFetch
    }
  })

  it('attaches the configured API key when an SDK omits its Authorization header', async () => {
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>

    await createOpenAiCompatibleFetch('  configured-provider-key  ', fetchMock)(
      'https://openrouter.ai/api/v1/chat/completions',
      { method: 'POST' },
    )

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer configured-provider-key')
  })

  it('routes an explicit Gateway profile through Firebase without confusing the two keys', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({
      data: [{
        id: 'nvidia/nemotron-3-ultra-550b-a55b',
        max_model_len: 262144,
      }],
    })) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleConnection({
      enabled: true,
      baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
      modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
      apiKey: 'nvidia-user-key',
      transport: 'mediprisma-gateway',
    }, {
      fetchImpl,
      gatewayUrl: 'https://gateway.example/proxyOpenAiCompatibleGateway',
    })).resolves.toMatchObject({
      modelFound: true,
      detectedContextWindowTokens: 262144,
    })

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://gateway.example/proxyOpenAiCompatibleGateway',
    )
    const headers = new Headers(fetchImpl.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer firebase-id-token')
    expect(headers.get('X-Firebase-AppCheck')).toBe('app-check-token')
    expect(headers.get('X-Upstream-API-Key')).toBe('nvidia-user-key')
    expect(headers.get('X-Upstream-Base-URL')).toBe(
      'https://integrate.api.nvidia.com/v1',
    )
    expect(headers.get('X-Upstream-Path')).toBe('models')
  })

  it('keeps standard Nemotron request bodies unchanged', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    try {
      const originalBody = JSON.stringify({
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
        messages: [{ role: 'user', content: 'Summarize this text.' }],
      })
      await createConfiguredOpenAiCompatibleFetch({
        ...profile,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
      })('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        body: originalBody,
      })

      expect(fetchMock.mock.calls[0][1]?.body).toBe(originalBody)
    } finally {
      global.fetch = originalFetch
    }
  })

  it('adds required Nemotron chat-template fields to Agent requests', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    try {
      await createConfiguredOpenAiCompatibleFetch({
        ...profile,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
      })('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'nvidia/nemotron-3-ultra-550b-a55b',
          messages: [],
          tools: [{ type: 'function', function: { name: 'probe' } }],
          tool_choice: 'auto',
        }),
      })

      const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
      expect(requestBody).toEqual({
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
        messages: [],
        tools: [{ type: 'function', function: { name: 'probe' } }],
        tool_choice: 'auto',
        chat_template_kwargs: {
          enable_thinking: true,
          force_nonempty_content: true,
        },
      })
      expect(requestBody.reasoning_budget).toBeUndefined()
    } finally {
      global.fetch = originalFetch
    }
  })

  it('does not modify normal configured request bodies for other endpoints', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    try {
      const originalBody = JSON.stringify({ model: 'hospital-model', messages: [] })
      await createConfiguredOpenAiCompatibleFetch(profile)(
        'https://llm.intra.example/v1/chat/completions',
        { method: 'POST', body: originalBody },
      )

      expect(fetchMock.mock.calls[0][1]?.body).toBe(originalBody)
    } finally {
      global.fetch = originalFetch
    }
  })

  it('refuses to send credentials through a non-HTTPS Gateway URL', () => {
    expect(() => createOpenAiCompatibleGatewayFetch({
      ...profile,
      transport: 'mediprisma-gateway',
    }, {
      gatewayUrl: 'http://gateway.example/proxyOpenAiCompatibleGateway',
    })).toThrow('MediPrisma Gateway must use HTTPS')
  })

  it('verifies a patient-free streamed tool call, result round-trip, and final nonce', async () => {
    const fetchImpl = agentRoundTripFetch()

    await expect(testOpenAiCompatibleAgentCapability(profile, { fetchImpl }))
      .resolves.toEqual({ status: 'verified' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstRequest = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    const secondRequest = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))
    const productionFhirTools = createFhirTools(() => ({
      patient: null,
      collection: null,
    }))
    const productionToolNames = Object.keys(productionFhirTools).sort()
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://llm.intra.example/v1/chat/completions',
    )
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization'))
      .toBe('Bearer hospital-secret')
    expect(firstRequest).toMatchObject({
      model: 'hospital-model',
      stream: true,
      max_tokens: 1024,
      stream_options: { include_usage: true },
      tool_choice: {
        type: 'function',
        function: { name: 'getDataOverview' },
      },
      messages: [{
        role: 'system',
        content: 'This is a capability test with synthetic data only. Follow the requested tool flow exactly.',
      }, {
        role: 'user',
        content: 'Call getDataOverview. After its result arrives, reply with only the nonce inside result.data.',
      }],
    })
    expect(firstRequest.chat_template_kwargs).toBeUndefined()
    expect(firstRequest.reasoning_budget).toBeUndefined()
    expect(productionToolNames.length).toBeGreaterThan(10)
    expect(firstRequest.tools).toHaveLength(productionToolNames.length)
    expect(firstRequest.tools.map((entry: { function: { name: string } }) => (
      entry.function.name
    )).sort()).toEqual(productionToolNames)
    for (const requestTool of firstRequest.tools as Array<{
      type: string
      function: {
        name: keyof typeof productionFhirTools
        description?: string
        parameters: unknown
      }
    }>) {
      const productionTool = productionFhirTools[requestTool.function.name]
      expect(requestTool.type).toBe('function')
      expect(requestTool.function.description).toBe(productionTool.description)
      expect(requestTool.function.parameters).toEqual(
        asSchema(productionTool.inputSchema as FlexibleSchema<unknown>).jsonSchema,
      )
    }
    // The probe's request contains only fixed prompts and static tool schemas;
    // no clinical resource payload is present because the production tool
    // factory is bound to a null patient/collection above.
    expect(firstRequest.messages).toHaveLength(2)
    expect(secondRequest.tools).toHaveLength(productionToolNames.length)
    expect(secondRequest.tools.map((entry: { function: { name: string } }) => (
      entry.function.name
    )).sort()).toEqual(productionToolNames)
    expect(secondRequest.tool_choice).toBe('none')
    expect(secondRequest.messages.slice(-2)).toEqual([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({
          id: 'call-probe-1',
          function: expect.objectContaining({
            name: 'getDataOverview',
          }),
        })],
      }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call-probe-1',
      }),
    ])
  })

  it('preserves OpenRouter reasoning details across the Agent tool round-trip', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ role?: string; content?: string }>
      }
      const toolMessage = body.messages?.find((message) => message.role === 'tool')
      if (!toolMessage) return firstOpenRouterToolCallStream()
      const nonce = JSON.parse(String(toolMessage.content)).data.nonce as string
      return finalTextStream(nonce)
    }) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleAgentCapability(openRouterProfile, { fetchImpl }))
      .resolves.toEqual({ status: 'verified' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstRequest = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    const secondRequest = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))
    expect(firstRequest).toMatchObject({
      model: 'qwen/qwen3.6-35b-a3b',
      max_tokens: 8192,
      reasoning: { effort: 'low' },
    })
    expect(secondRequest).toMatchObject({
      max_tokens: 8192,
      reasoning: { effort: 'low' },
      tool_choice: 'none',
    })
    const assistantMessage = secondRequest.messages.find(
      (message: { role?: string }) => message.role === 'assistant',
    )
    expect(assistantMessage.reasoning_details).toEqual([
      expect.objectContaining({
        type: 'reasoning.text',
        signature: 'signed-reasoning-detail',
      }),
    ])
    expect(assistantMessage.tool_calls).toEqual([
      expect.objectContaining({
        id: 'call-openrouter-probe-1',
        function: expect.objectContaining({ name: 'getDataOverview' }),
      }),
    ])
  })

  it('allows a three-minute cold-start window by default', async () => {
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout')
    try {
      await expect(testOpenAiCompatibleAgentCapability(profile, {
        fetchImpl: agentRoundTripFetch(),
      })).resolves.toEqual({ status: 'verified' })
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 180_000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('uses low reasoning effort for every gpt-oss Agent probe request', async () => {
    const fetchImpl = agentRoundTripFetch()

    await expect(testOpenAiCompatibleAgentCapability({
      ...profile,
      modelId: 'gpt-oss:120b',
    }, { fetchImpl })).resolves.toEqual({ status: 'verified' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const call of fetchImpl.mock.calls) {
      const request = JSON.parse(String(call[1]?.body))
      expect(request.reasoning_effort).toBe('low')
    }
  })

  it('allows the hosted Nemotron probe seven minutes for both reasoning steps', async () => {
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout')
    try {
      await expect(testOpenAiCompatibleAgentCapability({
        ...profile,
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
      }, {
        fetchImpl: agentRoundTripFetch(),
      })).resolves.toEqual({ status: 'verified' })
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 420_000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('runs both Agent probe steps through the explicit Firebase Gateway transport', async () => {
    const fetchImpl = agentRoundTripFetch()
    const gatewayConfig = {
      ...profile,
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      modelId: 'nvidia/nemotron-3-ultra-550b-a55b',
      transport: 'mediprisma-gateway' as const,
    }

    await expect(testOpenAiCompatibleAgentCapability(gatewayConfig, {
      fetchImpl,
      gatewayUrl: 'https://gateway.example/proxyOpenAiCompatibleGateway',
    })).resolves.toEqual({ status: 'verified' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const [input, init] of fetchImpl.mock.calls) {
      expect(String(input)).toBe('https://gateway.example/proxyOpenAiCompatibleGateway')
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer firebase-id-token')
      expect(headers.get('X-Upstream-API-Key')).toBe('hospital-secret')
      expect(headers.get('X-Upstream-Base-URL')).toBe(
        'https://integrate.api.nvidia.com/v1',
      )
      expect(headers.get('X-Upstream-Path')).toBe('chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        max_tokens: 1024,
        reasoning_budget: 1024,
        chat_template_kwargs: {
          enable_thinking: true,
          force_nonempty_content: true,
        },
      })
    }
  })

  it('reports inconclusive when the endpoint ignores the forced tool call', async () => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => finalTextStream('I cannot call tools')) as
      jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleAgentCapability(profile, { fetchImpl }))
      .resolves.toMatchObject({
        status: 'inconclusive',
        reason: expect.stringContaining('tool-call'),
      })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unknown client error', 'invalid request body', 'inconclusive'],
    ['temporary capability outage', 'Tool calling is temporarily unavailable', 'inconclusive'],
    ['forced-choice incompatibility', 'tool_choice is not supported', 'inconclusive'],
    ['schema incompatibility', 'Function schema is unsupported', 'inconclusive'],
    ['explicit capability error', 'Tool calling is not supported by this model', 'unsupported'],
    ['explicit model capability error', 'This model does not support tools', 'unsupported'],
  ])('classifies an %s without overclaiming support', async (
    _label,
    message,
    expectedStatus,
  ) => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => errorResponse(400, message)) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleAgentCapability(profile, { fetchImpl }))
      .resolves.toMatchObject({ status: expectedStatus })
  })

  it('redacts provider credentials from Agent check details', async () => {
    const leakedSkKey = 'sk-examplecredential123456'
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => errorResponse(
      400,
      `Rejected Bearer hospital-secret and ${leakedSkKey}`,
    )) as jest.MockedFunction<typeof fetch>

    const result = await testOpenAiCompatibleAgentCapability(profile, { fetchImpl })

    expect(result.status).toBe('inconclusive')
    expect(result.reason).toContain('Bearer [TOKEN_REDACTED]')
    expect(result.reason).toContain('[API_KEY_REDACTED]')
    expect(result.reason).not.toContain('hospital-secret')
    expect(result.reason).not.toContain(leakedSkKey)
  })

  it('redacts a configured credential before truncating check details', async () => {
    const apiKey = 'nvapi-secret-that-crosses-the-display-limit'
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => errorResponse(
      400,
      `${'x'.repeat(290)} ${apiKey}`,
    )) as jest.MockedFunction<typeof fetch>

    const result = await testOpenAiCompatibleAgentCapability({
      ...profile,
      apiKey,
    }, { fetchImpl })

    expect(result.reason).not.toContain('nvapi-secret')
    expect(result.reason).not.toContain(apiKey)
  })

  it('reports inconclusive when the tool flow works but final nonce adherence does not', async () => {
    const fetchImpl = agentRoundTripFetch('not-the-tool-nonce')

    await expect(testOpenAiCompatibleAgentCapability(profile, { fetchImpl }))
      .resolves.toMatchObject({
        status: 'inconclusive',
        reason: expect.stringContaining('nonce'),
      })
  })

  it.each([
    ['quotes', (nonce: string) => `"${nonce}"`],
    ['Markdown', (nonce: string) => `\`${nonce}\``],
    ['a short explanatory prefix', (nonce: string) => `The nonce is ${nonce}`],
  ])('accepts a nonce wrapped in %s after a valid tool round-trip', async (
    _label,
    responseText,
  ) => {
    const fetchImpl = agentRoundTripFetch(responseText)

    await expect(testOpenAiCompatibleAgentCapability(profile, { fetchImpl }))
      .resolves.toEqual({ status: 'verified' })
  })

  it.each([
    ['authentication', async () => errorResponse(401, 'invalid key')],
    ['network', async () => { throw new TypeError('Failed to fetch') }],
  ])('reports an inconclusive %s failure', async (_label, implementation) => {
    const fetchImpl = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => implementation()) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleAgentCapability(profile, { fetchImpl }))
      .resolves.toMatchObject({ status: 'inconclusive' })
  })

  it('reports an inconclusive timeout and aborts the injected fetch', async () => {
    let wasAborted = false
    const fetchImpl = jest.fn((
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => {
        wasAborted = true
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })) as jest.MockedFunction<typeof fetch>

    await expect(testOpenAiCompatibleAgentCapability(profile, {
      fetchImpl,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      status: 'inconclusive',
      reason: expect.stringContaining('timed out'),
    })
    expect(wasAborted).toBe(true)
  })
})

describe('hidden-reasoning-off request mapping', () => {
  it('sends the vLLM chat-template flag for an ordinary endpoint model', () => {
    expect(hiddenReasoningOffRequestFields(profile)).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    })
  })

  it('bounds reasoning instead of disabling it for gpt-oss', () => {
    // gpt-oss cannot disable hidden CoT; the lowest budget is the closest it
    // gets, and the vLLM template flag must NOT be sent to it.
    for (const modelId of ['gpt-oss:20b', 'gpt-oss-120b']) {
      expect(hiddenReasoningOffRequestFields({ ...profile, modelId })).toEqual({
        reasoning_effort: 'low',
      })
    }
  })

  it('adds OpenRouter\'s own switch only on the OpenRouter host', () => {
    expect(hiddenReasoningOffRequestFields({
      ...profile,
      baseUrl: 'https://openrouter.ai/api/v1',
    })).toEqual({
      chat_template_kwargs: { enable_thinking: false },
      reasoning: { enabled: false },
    })
    expect(hiddenReasoningOffRequestFields(profile).reasoning).toBeUndefined()
  })

  it('merges the fields into the SDK body without disturbing the request', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    try {
      await createConfiguredOpenAiCompatibleFetch(profile, { hiddenReasoning: 'off' })(
        'https://llm.intra.example/v1/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({ model: 'hospital-model', messages: [], stream: true }),
        },
      )
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        model: 'hospital-model',
        messages: [],
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      })
    } finally {
      global.fetch = originalFetch
    }
  })

  it('leaves the request untouched when the option is absent', async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => jsonResponse({})) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    try {
      const body = JSON.stringify({ model: 'hospital-model', messages: [] })
      await createConfiguredOpenAiCompatibleFetch(profile)(
        'https://llm.intra.example/v1/chat/completions',
        { method: 'POST', body },
      )
      expect(fetchMock.mock.calls[0][1]?.body).toBe(body)
    } finally {
      global.fetch = originalFetch
    }
  })
})
