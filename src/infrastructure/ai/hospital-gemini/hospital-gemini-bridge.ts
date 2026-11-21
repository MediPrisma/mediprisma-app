// 院內 Gemini Enterprise through 北榮懷爾抓抓 (vghtpe-fhir-bridge ≥ 0.16.1,
// extension/gemini-enterprise.js). The extension drives the clinician's own,
// already signed-in Gemini tab: it pastes the prompt, presses send and reads
// the answer back. It never signs in, and it answers only mediprisma.tw/app…
// and local development pages. One question runs at a time (else BUSY).
//
// Same external-messaging channel the 門診助理 uses for the clinic roster:
// chrome.runtime.sendMessage / connect with the extension's id.

/** 北榮懷爾抓抓's Chrome Web Store id; a developer build sets NEXT_PUBLIC_VGHTPE_BRIDGE_EXTENSION_ID. */
export const VGHTPE_BRIDGE_EXTENSION_ID: string =
  process.env.NEXT_PUBLIC_VGHTPE_BRIDGE_EXTENSION_ID || 'eempjoojendpjgpkhljnplchhdkllkgo'
export const HOSPITAL_GEMINI_PROTOCOL = 'vghtpe-gemini-enterprise/1'
/** The extension rejects longer prompts with INVALID_REQUEST. */
export const HOSPITAL_GEMINI_MAX_PROMPT_CHARS = 150_000
const STATUS_TIMEOUT_MS = 3_000

/** `unavailable`: no extension answered (not installed, or an older version). */
export type HospitalGeminiStatus = 'unavailable' | 'disabled' | 'no_tab' | 'needs_login' | 'ready'

const MESSAGES: Record<string, string> = {
  DISABLED: '院內 Gemini 尚未啟用：請在北榮懷爾抓抓的進階設定開啟「院內 Gemini Enterprise」。',
  NO_TAB: '請先開啟並登入院內 Gemini，再重試。',
  NEEDS_LOGIN: '請先開啟並登入院內 Gemini，再重試。',
  LOGGED_OUT: '院內 Gemini 已登出，回答未完成。請重新登入後再試。',
  BUSY: '院內 Gemini 正在回答另一個問題，請等它完成後再試。',
  INVALID_REQUEST: '這次的提示不符合院內 Gemini 的限制（最多 15 萬字），請縮小病歷範圍後再試。',
  UNTRUSTED_ORIGIN: '北榮懷爾抓抓不接受這個網址的請求，請從 mediprisma.tw/app 使用。',
  TIMEOUT: '院內 Gemini 太久沒有完成回答，請到 Gemini 分頁查看或重試。',
  ELEMENT_NOT_FOUND: '在院內 Gemini 頁面找不到輸入框或按鈕（頁面可能改版），請改用「複製提示」手動貼上。',
  INPUT_FAILED: '無法把提示貼進院內 Gemini，請改用「複製提示」手動貼上。',
  SUBMIT_FAILED: '無法在院內 Gemini 送出提示，請改用「複製提示」手動貼上。',
  TAB_CLOSED: '院內 Gemini 分頁在回答途中被關閉，回答未完成。',
  TAB_CHANGED: '院內 Gemini 分頁在回答途中被切換到其他頁面，回答未完成。',
  CANCELLED: '院內 Gemini 的回答已取消。',
  PAGE_ERROR: '院內 Gemini 頁面發生錯誤，回答未完成。',
  NOT_CONNECTED: '找不到北榮懷爾抓抓，或與它的連線中斷，回答未完成。',
  EMPTY_ANSWER: '院內 Gemini 沒有回傳任何文字，請到 Gemini 分頁查看或重試。',
  IMAGES_UNSUPPORTED:'院內 Gemini 目前只能送出文字，請移除圖片後再試。',
}

/** A failed 院內 Gemini request. `message` is the clinician-facing Chinese text. */
export class HospitalGeminiError extends Error {
  readonly hospitalGeminiCode: string
  constructor(code: string) {
    super(MESSAGES[code] ?? `院內 Gemini 發生未預期的錯誤（${code}），回答未完成。`)
    this.name = 'HospitalGeminiError'
    this.hospitalGeminiCode = code
  }
}

interface ExternalPort {
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: { addListener(listener: (message: unknown) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
}

interface ExternalRuntime {
  sendMessage(extensionId: string, message: unknown, reply: (response?: unknown) => void): void
  connect(extensionId: string, info: { name: string }): ExternalPort
  lastError?: { message?: string }
}

/** Chrome exposes `chrome.runtime` to a page only when an installed extension lists it. */
export function externalRuntime(): ExternalRuntime | null {
  const runtime = (globalThis as { chrome?: { runtime?: Partial<ExternalRuntime> } }).chrome?.runtime
  return runtime?.sendMessage && runtime.connect ? runtime as ExternalRuntime : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const STATUSES = new Set(['disabled', 'no_tab', 'needs_login', 'ready'])

export interface HospitalGeminiInfo {
  status: HospitalGeminiStatus
  /** Questions the extension answers at once (vghtpe-fhir-bridge #176); null from older versions, which take one. */
  maxConcurrent: number | null
}

const UNAVAILABLE: HospitalGeminiInfo = { status: 'unavailable', maxConcurrent: null }

export function getHospitalGeminiInfo(runtime = externalRuntime()): Promise<HospitalGeminiInfo> {
  if (!runtime) return Promise.resolve(UNAVAILABLE)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(UNAVAILABLE), STATUS_TIMEOUT_MS)
    try {
      runtime.sendMessage(VGHTPE_BRIDGE_EXTENSION_ID, { protocol: HOSPITAL_GEMINI_PROTOCOL, action: 'status' }, (reply) => {
        clearTimeout(timer)
        // Reading lastError also keeps Chrome from logging "Unchecked runtime.lastError".
        if (runtime.lastError || !isRecord(reply) || reply.ok !== true) return resolve(UNAVAILABLE)
        if (typeof reply.status !== 'string' || !STATUSES.has(reply.status)) return resolve(UNAVAILABLE)
        const max = reply.maxConcurrent
        resolve({
          status: reply.status as HospitalGeminiStatus,
          maxConcurrent: typeof max === 'number' && Number.isInteger(max) && max >= 1 ? max : null,
        })
      })
    } catch {
      clearTimeout(timer)
      resolve(UNAVAILABLE)
    }
  })
}

export function getHospitalGeminiStatus(runtime = externalRuntime()): Promise<HospitalGeminiStatus> {
  return getHospitalGeminiInfo(runtime).then((info) => info.status)
}

export interface HospitalGeminiAnswer {
  markdown: string
  sessionId: string | null
}

export interface AskHospitalGeminiOptions {
  prompt: string
  /** Continue this Gemini conversation; omitted starts a new one. */
  sessionId?: string | null
  signal?: AbortSignal
  /** The whole answer so far (the extension sends the accumulated text). */
  onText?: (markdown: string) => void
}

export function askHospitalGemini(
  { prompt, sessionId, signal, onText }: AskHospitalGeminiOptions,
  runtime = externalRuntime(),
): Promise<HospitalGeminiAnswer> {
  if (!runtime) return Promise.reject(new HospitalGeminiError('NOT_CONNECTED'))
  if (!prompt.trim() || prompt.length > HOSPITAL_GEMINI_MAX_PROMPT_CHARS) {
    return Promise.reject(new HospitalGeminiError('INVALID_REQUEST'))
  }
  if (signal?.aborted) return Promise.reject(new HospitalGeminiError('CANCELLED'))

  return new Promise((resolve, reject) => {
    let settled = false
    let port: ExternalPort
    const finish = (error: HospitalGeminiError | null, answer?: HospitalGeminiAnswer) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', cancel)
      try { port.disconnect() } catch { /* already gone */ }
      if (error) reject(error)
      else resolve(answer!)
    }
    // The extension presses Gemini's stop button on cancel or disconnect.
    const cancel = () => {
      try { port.postMessage({ action: 'cancel' }) } catch { /* disconnect below also cancels */ }
      finish(new HospitalGeminiError('CANCELLED'))
    }
    try {
      port = runtime.connect(VGHTPE_BRIDGE_EXTENSION_ID, { name: HOSPITAL_GEMINI_PROTOCOL })
    } catch {
      reject(new HospitalGeminiError('NOT_CONNECTED'))
      return
    }
    port.onMessage.addListener((message) => {
      if (!isRecord(message)) return
      if (message.type === 'delta' && typeof message.markdown === 'string') {
        if (!settled) onText?.(message.markdown)
      } else if (message.type === 'done' && typeof message.markdown === 'string') {
        finish(null, {
          markdown: message.markdown,
          sessionId: typeof message.sessionId === 'string' ? message.sessionId : null,
        })
      } else if (message.type === 'error') {
        finish(new HospitalGeminiError(typeof message.code === 'string' ? message.code : 'PAGE_ERROR'))
      }
    })
    port.onDisconnect.addListener(() => {
      void runtime.lastError
      finish(new HospitalGeminiError('NOT_CONNECTED'))
    })
    signal?.addEventListener('abort', cancel, { once: true })
    port.postMessage({ action: 'ask', prompt, ...(sessionId ? { sessionId } : {}) })
  })
}
