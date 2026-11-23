// 院內 Gemini through a fake 北榮懷爾抓抓: every reply below is synthetic and
// follows extension/gemini-enterprise.js (vghtpe-fhir-bridge #173).
import {
  askHospitalGemini,
  getHospitalGeminiInfo,
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

  it('sends parallel requests one at a time, like a one-question extension needs', async () => {
    let running = false
    const prompts: string[] = []
    const ask = jest.fn(async ({ prompt }: { prompt: string }) => {
      if (running) throw new HospitalGeminiError('BUSY')
      running = true
      prompts.push(prompt)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running = false
      return { markdown: `answer to ${prompt}`, sessionId: null }
    })
    const overview = jest.fn()
    const full = jest.fn()
    // A standard summary starts its overview and full summary together.
    await Promise.all([
      streamHospitalGemini({ messages: [{ role: 'user', content: 'overview' }], signal: signal(), onChunk: overview }, ask),
      streamHospitalGemini({ messages: [{ role: 'user', content: 'full' }], signal: signal(), onChunk: full }, ask),
    ])
    expect(prompts).toEqual(['overview', 'full'])
    expect(overview).toHaveBeenLastCalledWith('answer to overview')
    expect(full).toHaveBeenLastCalledWith('answer to full')
  })

  describe('with the extension\'s own concurrency (vghtpe-fhir-bridge #176)', () => {
    afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome })

    /** A fake extension that answers `limit` questions at once and replies BUSY beyond that. */
    function oneQuestionAtATimeOver(limit: number) {
      let running = 0
      let peak = 0
      const releases: (() => void)[] = []
      const ask = jest.fn(({ prompt }: { prompt: string }) => {
        if (running >= limit) return Promise.reject(new HospitalGeminiError('BUSY'))
        running += 1
        peak = Math.max(peak, running)
        return new Promise<{ markdown: string; sessionId: string }>((resolve) => {
          releases.push(() => { running -= 1; resolve({ markdown: `answer to ${prompt}`, sessionId: `s-${prompt}` }) })
        })
      })
      return { ask, releases, peak: () => peak }
    }
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
    const question = (content: string, onChunk = jest.fn(), controller = new AbortController()) =>
      ({ messages: [{ role: 'user', content }], signal: controller.signal, onChunk })

    it('reads maxConcurrent from the status reply, and none from an older extension', async () => {
      const { runtime } = fakeRuntime({ ok: true, status: 'ready', busy: false, running: 0, maxConcurrent: 3 })
      await expect(getHospitalGeminiInfo(runtime)).resolves.toEqual({ status: 'ready', maxConcurrent: 3 })
      const old = fakeRuntime({ ok: true, status: 'ready', busy: false }).runtime
      await expect(getHospitalGeminiInfo(old)).resolves.toEqual({ status: 'ready', maxConcurrent: null })
    })

    it('sends three questions at once to a new extension and each finishes with its own answer', async () => {
      ;(globalThis as { chrome?: { runtime?: unknown } }).chrome = { runtime: fakeRuntime({ ok: true, status: 'ready', busy: false, running: 0, maxConcurrent: 3 }).runtime }
      const fake = oneQuestionAtATimeOver(3)
      const chunks = { overview: jest.fn(), full: jest.fn(), safety: jest.fn() }
      const runs = (['overview', 'full', 'safety'] as const)
        .map((name) => streamHospitalGemini(question(name, chunks[name]), fake.ask))
      await flush()
      expect(fake.ask).toHaveBeenCalledTimes(3)
      fake.releases.splice(0).reverse().forEach((release) => release())
      await Promise.all(runs)
      expect(fake.peak()).toBe(3)
      expect(chunks.overview).toHaveBeenLastCalledWith('answer to overview')
      expect(chunks.full).toHaveBeenLastCalledWith('answer to full')
      expect(chunks.safety).toHaveBeenLastCalledWith('answer to safety')
    })

    it('keeps an older extension at one question at a time, so it never replies BUSY', async () => {
      ;(globalThis as { chrome?: { runtime?: unknown } }).chrome = { runtime: fakeRuntime({ ok: true, status: 'ready', busy: false }).runtime }
      const fake = oneQuestionAtATimeOver(1)
      const runs = ['overview', 'full', 'safety'].map((name) => streamHospitalGemini(question(name), fake.ask))
      for (let sent = 1; sent <= 3; sent += 1) {
        await flush()
        expect(fake.ask).toHaveBeenCalledTimes(sent)
        fake.releases.shift()!()
      }
      await Promise.all(runs)
      expect(fake.peak()).toBe(1)
    })

    it('never sends a fourth question stopped while it waits for a free slot', async () => {
      const fake = oneQuestionAtATimeOver(3)
      const three = async () => 3
      const runs = ['a', 'b', 'c'].map((name) => streamHospitalGemini(question(name), fake.ask, three))
      const controller = new AbortController()
      const fourth = streamHospitalGemini(question('d', jest.fn(), controller), fake.ask, three)
      await flush()
      expect(fake.ask).toHaveBeenCalledTimes(3)
      controller.abort()
      await expect(fourth).resolves.toBeUndefined()
      fake.releases.splice(0).forEach((release) => release())
      await Promise.all(runs)
      expect(fake.ask).toHaveBeenCalledTimes(3)
    })
  })

  it('never sends a request stopped while it waits its turn', async () => {
    let release!: () => void
    const ask = jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ markdown: 'first', sessionId: null }) }))
    const first = streamHospitalGemini({ messages: [{ role: 'user', content: 'first' }], signal: signal(), onChunk: jest.fn() }, ask)
    const controller = new AbortController()
    const second = streamHospitalGemini({ messages: [{ role: 'user', content: 'second' }], signal: controller.signal, onChunk: jest.fn() }, ask)
    controller.abort()
    await expect(second).resolves.toBeUndefined()
    release()
    await first
    expect(ask).toHaveBeenCalledTimes(1)
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
    // The bridge is asked how many questions it takes before the first one is sent.
    await new Promise((resolve) => setTimeout(resolve, 0))
    connections[0].emit({ type: 'delta', markdown: 'Partial' })
    connections[0].emit({ type: 'done', markdown: 'Partial and complete', sessionId: 's-2' })
    await run
    expect(create).not.toHaveBeenCalled()
    expect(connections[0].posted).toEqual([{ action: 'ask', prompt: 'Synthetic chart\n\nSummarise' }])
    expect(onChunk.mock.calls).toEqual([['Partial'], ['Partial and complete']])
    expect(onModelExecution).toHaveBeenLastCalledWith(expect.objectContaining({ actualModelId: HOSPITAL_GEMINI_MODEL_ID }))
  })
})
