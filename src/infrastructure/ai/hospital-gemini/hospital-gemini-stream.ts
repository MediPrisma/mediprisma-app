// Runs one AI feature request (summary, custom summary, standard chat) on 院內
// Gemini. The request carries the same messages any other model gets; Gemini's
// web page takes one text box, so they are joined into a single prompt.
//
// Chat continues the same Gemini conversation: after an answer, the exact
// system prompt and user turns that produced it are remembered with Gemini's
// sessionId. The next turn whose earlier messages match sends only the new
// question into that session. Anything else (another patient, a changed
// clinical context, a reload) starts a new conversation with the whole text.
import {
  askHospitalGemini,
  getHospitalGeminiInfo,
  HospitalGeminiError,
  type AskHospitalGeminiOptions,
  type HospitalGeminiAnswer,
} from './hospital-gemini-bridge'
import type { AiQueryRequest, AiQueryResponse } from '@/src/core/entities/ai.entity'
import { HOSPITAL_GEMINI_MODEL_ID } from '@/src/shared/constants/ai-models.constants'
import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'

export interface HospitalGeminiStreamConfig {
  messages: { role: string; content: string; images?: { data: string }[] }[]
  signal: AbortSignal
  onChunk: (content: string) => void
}

type Ask = (options: AskHospitalGeminiOptions) => Promise<HospitalGeminiAnswer>

const MAX_SESSIONS = 20
/** conversation key → Gemini sessionId, oldest first. */
const sessions = new Map<string, string>()

/** Exact system and user text; an answer counts only as a turn boundary. */
function conversationKey(messages: HospitalGeminiStreamConfig['messages']): string {
  return JSON.stringify(messages.map((message) =>
    message.role === 'assistant' ? ['assistant'] : [message.role, message.content]))
}

function rememberSession(key: string, sessionId: string): void {
  sessions.delete(key)
  sessions.set(key, sessionId)
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
}

/** Test seam: forget every remembered conversation. */
export function resetHospitalGeminiSessions(): void {
  sessions.clear()
  knownCapacity = null
}

const LABELS: Record<string, string> = { user: '【使用者】', assistant: '【AI 回答】' }

/** One prompt from the whole request, for a new Gemini conversation. */
export function flattenHospitalGeminiPrompt(messages: HospitalGeminiStreamConfig['messages']): string {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content.trim())
  const turns = messages.filter((message) => message.role !== 'system')
  const body = turns.length === 1 && turns[0].role === 'user'
    ? [turns[0].content.trim()]
    : turns.map((message) => `${LABELS[message.role] ?? `【${message.role}】`}\n${message.content.trim()}`)
  return [...system, ...body].filter(Boolean).join('\n\n')
}

export function planHospitalGeminiRequest(messages: HospitalGeminiStreamConfig['messages']): {
  prompt: string
  sessionId: string | null
} {
  const lastAnswer = messages.map((message) => message.role).lastIndexOf('assistant')
  const sessionId = lastAnswer >= 0 ? sessions.get(conversationKey(messages.slice(0, lastAnswer + 1))) : undefined
  if (!sessionId) return { prompt: flattenHospitalGeminiPrompt(messages), sessionId: null }
  const followUp = messages.slice(lastAnswer + 1)
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')
  return { prompt: followUp, sessionId }
}

export interface HospitalGeminiFailure {
  message: string
  /** Exactly what would have been pasted, so the clinician can paste it by hand. */
  prompt: string
}

let failureListener: ((failure: HospitalGeminiFailure) => void) | null = null

/** The app shows a failure with a 「複製提示」 action; returns the unsubscribe. */
export function setHospitalGeminiFailureListener(listener: (failure: HospitalGeminiFailure) => void): () => void {
  failureListener = listener
  return () => { if (failureListener === listener) failureListener = null }
}

export async function streamHospitalGemini(
  config: HospitalGeminiStreamConfig,
  ask: Ask = askHospitalGemini,
  capacity: Capacity = extensionCapacity,
): Promise<void> {
  const { prompt, sessionId } = planHospitalGeminiRequest(config.messages)
  try {
    await runHospitalGemini(config, prompt, sessionId, ask, capacity)
  } catch (error) {
    // The user's stop ends quietly, like every other model.
    if (config.signal.aborted) return
    if (error instanceof Error) failureListener?.({ message: error.message, prompt: flattenHospitalGeminiPrompt(config.messages) })
    throw error
  }
}

/** Non-streaming callers (custom summaries) get the finished answer. */
export async function queryHospitalGemini(request: AiQueryRequest, ask: Ask = askHospitalGemini): Promise<AiQueryResponse> {
  const signal = request.signal ?? new AbortController().signal
  let text = ''
  await streamHospitalGemini({ messages: request.messages, signal, onChunk: (markdown) => { text = markdown } }, ask)
  if (signal.aborted) {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    throw abort
  }
  return {
    text,
    metadata: {
      modelId: HOSPITAL_GEMINI_MODEL_ID,
      provider: 'gemini',
      modelExecution: reportModelExecution(createModelExecution(request.modelId, HOSPITAL_GEMINI_MODEL_ID), HOSPITAL_GEMINI_MODEL_ID),
    },
  }
}

// One standard summary starts its overview, full summary and safety scan
// together. The extension says how many questions it answers at once
// (maxConcurrent, vghtpe-fhir-bridge #176); an older version answers one and
// replies BUSY to the rest. Requests beyond that wait here, in order, and one
// stopped while waiting is never sent.
type Capacity = () => Promise<number>

let knownCapacity: Promise<number> | null = null

/** Asked once per page; an extension that did not answer is asked again next time. */
const extensionCapacity: Capacity = () => {
  knownCapacity ??= getHospitalGeminiInfo().then((info) => {
    if (info.status === 'unavailable') knownCapacity = null
    return info.maxConcurrent ?? 1
  }, () => {
    knownCapacity = null
    return 1
  })
  return knownCapacity
}

let active = 0
/** Each waiter receives a running slot handed over by a finishing request. */
const waiters: (() => void)[] = []

function releaseSlot(): void {
  const next = waiters.shift()
  if (next) next()
  else active -= 1
}

function waitForSlot(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const take = () => {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const abort = () => {
      const index = waiters.indexOf(take)
      if (index >= 0) waiters.splice(index, 1)
      reject(new HospitalGeminiError('CANCELLED'))
    }
    waiters.push(take)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function inTurn<T>(signal: AbortSignal, capacity: Capacity, send: () => Promise<T>): Promise<T> {
  const limit = await capacity()
  if (signal.aborted) throw new HospitalGeminiError('CANCELLED')
  if (active < limit) active += 1
  else await waitForSlot(signal)
  try {
    return await send()
  } finally {
    releaseSlot()
  }
}

async function runHospitalGemini(
  config: HospitalGeminiStreamConfig,
  prompt: string,
  sessionId: string | null,
  ask: Ask,
  capacity: Capacity,
): Promise<void> {
  if (config.messages.some((message) => message.images?.length)) {
    throw new HospitalGeminiError('IMAGES_UNSUPPORTED')
  }
  let shown = ''
  const show = (markdown: string) => {
    if (markdown === shown || config.signal.aborted) return
    shown = markdown
    config.onChunk(markdown)
  }
  const answer = await inTurn(config.signal, capacity, () => ask({ prompt, sessionId, signal: config.signal, onText: show }))
  if (!answer.markdown.trim()) throw new HospitalGeminiError('EMPTY_ANSWER')
  show(answer.markdown)
  if (answer.sessionId) rememberSession(conversationKey([...config.messages, { role: 'assistant', content: '' }]), answer.sessionId)
}
