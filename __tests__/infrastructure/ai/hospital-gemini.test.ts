// 院內 Gemini through a fake 北榮懷爾抓抓: every reply below is synthetic and
// follows extension/gemini-enterprise.js (vghtpe-fhir-bridge #173).
import {
  askHospitalGemini,
  getHospitalGeminiStatus,
  HOSPITAL_GEMINI_PROTOCOL,
  HospitalGeminiError,
  VGHTPE_BRIDGE_EXTENSION_ID,
} from '@/src/infrastructure/ai/hospital-gemini/hospital-gemini-bridge'
import {
  flattenHospitalGeminiPrompt,
  resetHospitalGeminiSessions,
  setHospitalGeminiFailureListener,
  streamHospitalGemini,
} from '@/src/infrastructure/ai/hospital-gemini/hospital-gemini-stream'
import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'
import { getUserErrorMessage } from '@/src/core/errors'
import { HOSPITAL_GEMINI_MODEL_ID } from '@/src/shared/constants/ai-models.constants'

type Listener = (message: unknown) => void

function fakeRuntime(statusReply?: unknown) {
  const sent: unknown[] = []
  const connections: { name: string; posted: unknown[]; emit: Listener; drop: () => void; disconnected: boolean }[] = []
  const runtime = {
    lastError: undefined as { message?: string } | undefined,
    sendMessage: jest.fn((id: string, message: unknown, reply: (response?: unknown) => void) => {
      sent.push({ id, message })
      if (statusReply === undefined) {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
        reply(undefined)
        runtime.lastError = undefined
      } else reply(statusReply)
    }),
    connect: jest.fn((id: string, info: { name: string }) => {
      const messageListeners: Listener[] = []
      const disconnectListeners: (() => void)[] = []
      const connection = {
        name: info.name,
        posted: [] as unknown[],
        disconnected: false,
        emit: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
        drop: () => disconnectListeners.forEach((listener) => listener()),
      }
      connections.push(connection)
      expect(id).toBe(VGHTPE_BRIDGE_EXTENSION_ID)
      return {
        postMessage: (message: unknown) => connection.posted.push(message),
        disconnect: () => { connection.disconnected = true },
        onMessage: { addListener: (listener: Listener) => messageListeners.push(listener) },
        onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
      }
    }),
  }
  return { runtime, sent, connections }
}

describe('getHospitalGeminiStatus', () => {
  it('asks the extension with the documented protocol and returns its state', async () => {
    const { runtime, sent } = fakeRuntime({ ok: true, status: 'ready', cid: 'synthetic-cid', busy: false })
    await expect(getHospitalGeminiStatus(runtime)).resolves.toBe('ready')
    expect(sent).toEqual([{ id: VGHTPE_BRIDGE_EXTENSION_ID, message: { protocol: HOSPITAL_GEMINI_PROTOCOL, action: 'status' } }])
  })

  it.each(['disabled', 'no_tab', 'needs_login'])('passes %s through', async (status) => {
    await expect(getHospitalGeminiStatus(fakeRuntime({ ok: true, status, busy: false }).runtime)).resolves.toBe(status)
  })

  it('is unavailable without the extension, on lastError, on a refusal or an unknown state', async () => {
    await expect(getHospitalGeminiStatus(null)).resolves.toBe('unavailable')
    await expect(getHospitalGeminiStatus(fakeRuntime().runtime)).resolves.toBe('unavailable')
    await expect(getHospitalGeminiStatus(fakeRuntime({ ok: false, error: 'UNTRUSTED_ORIGIN' }).runtime)).resolves.toBe('unavailable')
    await expect(getHospitalGeminiStatus(fakeRuntime({ ok: true, status: 'something-new' }).runtime)).resolves.toBe('unavailable')
  })
})

describe('askHospitalGemini', () => {
  it('sends the prompt, shows the accumulated text and resolves with the session', async () => {
    const { runtime, connections } = fakeRuntime()
    const onText = jest.fn()
    const answer = askHospitalGemini({ prompt: 'Synthetic prompt', onText }, runtime)
    const port = connections[0]
    expect(port.name).toBe(HOSPITAL_GEMINI_PROTOCOL)
    expect(port.posted).toEqual([{ action: 'ask', prompt: 'Synthetic prompt' }])
    port.emit({ type: 'delta', markdown: 'Syn' })
    port.emit({ type: 'delta', markdown: 'Synthetic answer' })
    port.emit({ type: 'done', markdown: 'Synthetic answer.', sessionId: 's-1', cid: 'c' })
    await expect(answer).resolves.toEqual({ markdown: 'Synthetic answer.', sessionId: 's-1' })
    expect(onText.mock.calls).toEqual([['Syn'], ['Synthetic answer']])
    expect(port.disconnected).toBe(true)
  })

  it('continues a conversation by sessionId', async () => {
    const { runtime, connections } = fakeRuntime()
    void askHospitalGemini({ prompt: 'Follow-up', sessionId: 's-1' }, runtime).catch(() => {})
    expect(connections[0].posted).toEqual([{ action: 'ask', prompt: 'Follow-up', sessionId: 's-1' }])
  })

  it.each([
    ['TAB_CHANGED', /切換到其他頁面/],
    ['NEEDS_LOGIN', /請先開啟並登入院內 Gemini/],
    ['BUSY', /正在回答另一個問題/],
    ['TIMEOUT', /太久沒有完成/],
    ['SOMETHING_NEW', /未預期的錯誤（SOMETHING_NEW）/],
  ])('rejects %s with a clinician-facing message the error mapper keeps', async (code, text) => {
    const { runtime, connections } = fakeRuntime()
    const answer = askHospitalGemini({ prompt: 'Synthetic prompt' }, runtime)
    connections[0].emit({ type: 'error', code, partial: 'half' })
    const error = await answer.catch((caught) => caught)
    expect(error).toBeInstanceOf(HospitalGeminiError)
    expect(error.hospitalGeminiCode).toBe(code)
    expect(getUserErrorMessage(error)).toMatch(text)
  })

  it('fails when the extension goes away mid-answer', async () => {
    const { runtime, connections } = fakeRuntime()
    const answer = askHospitalGemini({ prompt: 'Synthetic prompt' }, runtime)
    connections[0].emit({ type: 'delta', markdown: 'partial' })
    connections[0].drop()
    await expect(answer).rejects.toMatchObject({ hospitalGeminiCode: 'NOT_CONNECTED' })
  })

  it('cancels on abort: tells the extension and disconnects', async () => {
    const { runtime, connections } = fakeRuntime()
    const controller = new AbortController()
    const answer = askHospitalGemini({ prompt: 'Synthetic prompt', signal: controller.signal }, runtime)
    controller.abort()
    await expect(answer).rejects.toMatchObject({ hospitalGeminiCode: 'CANCELLED' })
    expect(connections[0].posted).toContainEqual({ action: 'cancel' })
    expect(connections[0].disconnected).toBe(true)
  })

  it('refuses without the extension or with an over-long prompt, sending nothing', async () => {
    await expect(askHospitalGemini({ prompt: 'x' }, null)).rejects.toMatchObject({ hospitalGeminiCode: 'NOT_CONNECTED' })
    const { runtime } = fakeRuntime()
    await expect(askHospitalGemini({ prompt: 'x'.repeat(150_001) }, runtime))
      .rejects.toMatchObject({ hospitalGeminiCode: 'INVALID_REQUEST' })
    expect(runtime.connect).not.toHaveBeenCalled()
  })
})

describe('streamHospitalGemini', () => {
  beforeEach(() => resetHospitalGeminiSessions())

  const signal = () => new AbortController().signal

  it('joins the system prompt and the request into one prompt', () => {
    expect(flattenHospitalGeminiPrompt([
      { role: 'system', content: 'Synthetic chart and task' },
      { role: 'user', content: 'Summarise' },
    ])).toBe('Synthetic chart and task\n\nSummarise')
  })

  it('continues the same Gemini conversation only when the earlier turns match', async () => {
    const ask = jest.fn()
      .mockResolvedValueOnce({ markdown: 'A1', sessionId: 's-1' })
      .mockResolvedValueOnce({ markdown: 'A2', sessionId: 's-1' })
      .mockResolvedValueOnce({ markdown: 'B1', sessionId: 's-9' })
    const first = [{ role: 'system', content: 'Synthetic patient X' }, { role: 'user', content: 'Q1' }]
    await streamHospitalGemini({ messages: first, signal: signal(), onChunk: jest.fn() }, ask)
    expect(ask.mock.calls[0][0]).toMatchObject({ prompt: 'Synthetic patient X\n\nQ1', sessionId: null })

    // The app may format the stored answer differently; only system and user text must match.
    await streamHospitalGemini({ messages: [...first, { role: 'assistant', content: 'A1 (formatted)' }, { role: 'user', content: 'Q2' }],
      signal: signal(), onChunk: jest.fn() }, ask)
    expect(ask.mock.calls[1][0]).toMatchObject({ prompt: 'Q2', sessionId: 's-1' })

    // Another patient's context never reuses that session.
    await streamHospitalGemini({ messages: [{ role: 'system', content: 'Synthetic patient Y' }, { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q2' }], signal: signal(), onChunk: jest.fn() }, ask)
    expect(ask.mock.calls[2][0]).toMatchObject({ sessionId: null })
    expect(ask.mock.calls[2][0].prompt).toBe('Synthetic patient Y\n\n【使用者】\nQ1\n\n【AI 回答】\nA1\n\n【使用者】\nQ2')
  })

  it('refuses images and an empty answer instead of reporting success', async () => {
    const ask = jest.fn().mockResolvedValue({ markdown: '  ', sessionId: null })
    await expect(streamHospitalGemini({ messages: [{ role: 'user', content: 'Q', images: [{ data: 'data:,' }] }],
      signal: signal(), onChunk: jest.fn() }, ask)).rejects.toMatchObject({ hospitalGeminiCode: 'IMAGES_UNSUPPORTED' })
    expect(ask).not.toHaveBeenCalled()
    await expect(streamHospitalGemini({ messages: [{ role: 'user', content: 'Q' }], signal: signal(), onChunk: jest.fn() }, ask))
      .rejects.toMatchObject({ hospitalGeminiCode: 'EMPTY_ANSWER' })
  })

  it('hands a failure and the whole prompt to the 複製提示 listener', async () => {
    const failures: unknown[] = []
    const unsubscribe = setHospitalGeminiFailureListener((failure) => failures.push(failure))
    try {
      const ask = jest.fn().mockRejectedValue(new HospitalGeminiError('TAB_CHANGED'))
      await expect(streamHospitalGemini({ messages: [{ role: 'system', content: 'Synthetic chart' }, { role: 'user', content: 'Q' }],
        signal: signal(), onChunk: jest.fn() }, ask)).rejects.toMatchObject({ hospitalGeminiCode: 'TAB_CHANGED' })
      expect(failures).toEqual([{ message: expect.stringMatching(/切換到其他頁面/), prompt: 'Synthetic chart\n\nQ' }])
    } finally { unsubscribe() }
  })

  it('ends quietly when the user stops', async () => {
    const controller = new AbortController()
    const ask = jest.fn(async () => {
      controller.abort()
      throw new HospitalGeminiError('CANCELLED')
    })
    await expect(streamHospitalGemini({ messages: [{ role: 'user', content: 'Q' }], signal: controller.signal, onChunk: jest.fn() }, ask))
      .resolves.toBeUndefined()
  })
})

describe('AiSdkStreamAdapter with 院內 Gemini', () => {
  afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome })

  it('routes the model to the extension, never to an SDK provider', async () => {
    const { runtime, connections } = fakeRuntime()
    ;(globalThis as { chrome?: unknown }).chrome = { runtime }
    const create = jest.fn()
    const onChunk = jest.fn()
    const onModelExecution = jest.fn()
    const run = new AiSdkStreamAdapter({ create }).stream({
      model: HOSPITAL_GEMINI_MODEL_ID, apiKey: null, signal: new AbortController().signal, onChunk, onModelExecution,
      messages: [{ role: 'system', content: 'Synthetic chart' }, { role: 'user', content: 'Summarise' }],
    })
    await Promise.resolve()
    connections[0].emit({ type: 'delta', markdown: 'Partial' })
    connections[0].emit({ type: 'done', markdown: 'Partial and complete', sessionId: 's-2' })
    await run
    expect(create).not.toHaveBeenCalled()
    expect(connections[0].posted).toEqual([{ action: 'ask', prompt: 'Synthetic chart\n\nSummarise' }])
    expect(onChunk.mock.calls).toEqual([['Partial'], ['Partial and complete']])
    expect(onModelExecution).toHaveBeenLastCalledWith(expect.objectContaining({ actualModelId: HOSPITAL_GEMINI_MODEL_ID }))
  })
})
