/**
 * Centralized Error Handling
 * Export all error classes and utilities
 */

export { BaseError } from './base.error'
export { AiError, AiErrorCode } from './ai.error'
export { FhirError, FhirErrorCode } from './fhir.error'
export { ValidationError, ValidationErrorCode } from './validation.error'

import type { BaseError } from './base.error'

/**
 * Type guard to check if error is a BaseError
 */
export function isBaseError(error: unknown): error is BaseError {
  return error !== null && 
         typeof error === 'object' && 
         'getUserMessage' in error &&
         'toJSON' in error
}

/**
 * Error message mapping for common errors
 */
interface ErrorMapping {
  pattern: RegExp
  message: string
}

const CONTEXT_WINDOW_EXCEEDED_PATTERN = /ContextWindowExceededError|maximum context length|context window.{0,40}(?:exceed|overflow)|prompt contains at least \d+ input tokens/i

const ERROR_MAPPINGS: ErrorMapping[] = [
  {
    pattern: /monthly_budget_exhausted/i,
    message: '院內 AI 本月 US$100 額度已用完，本次請求未送往 Azure。'
  },
  {
    pattern: /budget_unavailable/i,
    message: '院內 AI 額度設定暫時無法使用，本次請求未送往 Azure。請聯絡管理者。'
  },
  {
    pattern: /AI_OUTPUT_TRUNCATED|OpenAI-compatible local model output limit reached/i,
    message: '地端模型已達輸出長度上限，摘要尚未完成。請縮小「資料選擇」範圍或精簡自訂提示詞後重試。'
  },
  {
    pattern: /AI_CONNECTION_INTERRUPTED|OpenAI-compatible local model connection interrupted/i,
    message: '地端模型連線中斷，可能是服務端或網路逾時。請確認服務狀態、縮小「資料選擇」範圍後重試。'
  },
  // OpenAI-compatible gateways (notably LiteLLM) wrap this under several
  // nested error/cause shapes. Keep it ahead of generic 400/provider text so
  // an exhausted automatic context retry never dumps the raw routing payload
  // into every summary card.
  {
    pattern: CONTEXT_WINDOW_EXCEEDED_PATTERN,
    message: '📚 病歷內容超過模型可處理的長度。系統已嘗試自動縮減；請再縮小「資料選擇」範圍，或改用內容視窗更大的模型。'
  },
  // Guest/anonymous proxy session couldn't be obtained CLIENT-side (no Firebase
  // ID token) — most often iOS storage/ITP, private mode, or a stale cached
  // build. Distinct from the server "sign-in required" 401 below so the message
  // can point at the real fix (refresh / own key). Must come first to win.
  {
    pattern: /proxy session unavailable/i,
    message: '🔐 訪客連線失敗 - 取不到免費額度的連線權杖（常見於手機隱私／無痕設定或舊版快取）。請重新整理頁面；若仍不行，請改用自己的 API Key 或登入。'
  },
  // Proxy auth / quota (the Firebase Functions respond with these)
  {
    pattern: /sign-?in required|invalid or expired session/i,
    message: '🔐 內建額度僅供登入使用者 - 請先登入，或在設定中加入自己的 API Key'
  },
  {
    pattern: /daily quota exceeded|(?:daily|today).{0,30}(?:free )?(?:quota|usage|limit).{0,30}(?:exceed|used up)|(?:free|built-?in).{0,20}(?:quota|usage).{0,20}(?:exceed|used up)/i,
    message: '📊 今日免費使用量已用完。請明天再試，或到「設定」加入自己的 API Key 繼續使用。'
  },
  // API Key errors (most common)
  {
    pattern: /401|unauthorized|authentication failed.*check.*api key|incorrect api key|invalid api key|invalid_api_key|api_key_invalid/i,
    message: '🔑 API Key 錯誤 - 請檢查您的 API key 是否正確設定'
  },
  // Rate limit
  {
    pattern: /rate limit|429/i,
    message: '⏱️ 請求次數超過限制 - 請稍後再試'
  },
  // Timeout
  {
    pattern: /openai-compatible local model response timed out/i,
    message: '⏰ 地端模型回應逾時 - 請縮小「資料選擇」範圍、改用較快的模型，或確認地端模型仍在運作'
  },
  {
    pattern: /timeout|timed out/i,
    message: '⏰ 請求逾時 - 請檢查網路連線或稍後再試'
  },
  // iOS Safari/WebKit's text for a fetch blocked/failed at the network layer
  // (desktop Chrome says "Failed to fetch"). On iPhone this is almost always a
  // content blocker, "Prevent Cross-Site Tracking", or Private Browsing blocking
  // the cross-origin call to the proxy / Google token endpoint. Keep it ABOVE
  // the generic network rule so the message can name the real cause.
  {
    pattern: /load failed/i,
    message: '🌐 連線被擋下 - 在 iPhone 上常見於「無痕瀏覽」、「防止跨網站追蹤」或內容封鎖器擋住了連線。請改用一般視窗、把本站加入追蹤保護例外或關閉封鎖器後重試，或在「設定」改用自己的 API Key。'
  },
  // Network errors
  {
    pattern: /network error|failed to fetch|fetch failed/i,
    message: '🌐 網路連線問題 - 請檢查網路連線'
  },
  {
    pattern: /upstream(?: request)? (?:failed|failure|error)|upstream_error/i,
    message: 'AI 服務暫時無法回應，請稍後重試；若持續發生，請改用其他模型。'
  },
  // Service unavailable
  {
    pattern: /service.*unavailable|500|502|503/i,
    message: '🔧 服務暫時無法使用 - 請稍後再試'
  },
  // Quota/billing
  {
    pattern: /quota|billing/i,
    message: '💳 配額或帳單問題 - 請檢查 API 帳戶餘額'
  },
  // Model not found
  {
    pattern: /model.*not found|invalid model/i,
    message: '🤖 模型不可用 - 請選擇其他模型'
  },
  // Content filter
  {
    pattern: /content.*filtered|safety/i,
    message: '🛡️ 內容安全過濾 - 請調整問題內容'
  },
  // AI SDK RetryError. Specific nested causes (quota/auth/rate limit/etc.) are
  // matched above first; this fallback prevents the raw retry implementation
  // detail from reaching end users when the final cause is unknown.
  {
    pattern: /failed after \d+ attempts/i,
    message: 'AI 服務暂時無法完成請求，請稍後再試。'
  },
]

/**
 * Build a richer haystack to match against: the AI SDK's APICallError carries
 * the real signal in statusCode / responseBody, NOT always in .message (a
 * proxy 401 frequently has an empty .message — which previously produced an
 * empty error box). The proxy's 401 body contains the "sign-in required" text
 * that the first mapping matches, so include responseBody too.
 */
function buildErrorHaystack(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<object>()

  const visit = (value: unknown, depth: number) => {
    if (value == null || depth > 4) return
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value))
      return
    }
    if (typeof value !== 'object' || seen.has(value)) return
    seen.add(value)

    const item = value as {
      message?: unknown
      statusCode?: unknown
      status?: unknown
      responseBody?: unknown
      name?: unknown
      lastError?: unknown
      cause?: unknown
      errors?: unknown
      error?: unknown
    }
    if (typeof item.message === 'string') parts.push(item.message)
    if (item.statusCode != null) parts.push(`status ${String(item.statusCode)}`)
    if (item.status != null) parts.push(`status ${String(item.status)}`)
    if (typeof item.responseBody === 'string') parts.push(item.responseBody)
    else if (item.responseBody && typeof item.responseBody === 'object') {
      try { parts.push(JSON.stringify(item.responseBody)) } catch { /* ignore cyclic response bodies */ }
    }
    if (typeof item.name === 'string') parts.push(item.name)

    // Vercel AI SDK wraps the actionable APICallError inside RetryError.
    // Inspect both the explicit lastError and the full errors array; cause
    // covers native Error wrapping used by fetch/provider libraries.
    visit(item.lastError, depth + 1)
    visit(item.cause, depth + 1)
    visit(item.error, depth + 1)
    if (Array.isArray(item.errors)) item.errors.forEach((nested) => visit(nested, depth + 1))
  }

  visit(error, 0)
  if (parts.length === 0) parts.push(String(error))
  return parts.join(' ')
}

/**
 * The proxy's daily-quota 403 — matched against BOTH the raw server text and
 * the already-mapped Chinese message, so it works on the original error and on
 * the `new Error(getUserErrorMessage(err))` the chat hooks store in state.
 * The chat UI uses this to show a persistent quota banner with a sign-in CTA
 * instead of only an ❌ line inside the conversation.
 */
const QUOTA_EXCEEDED_PATTERN = /daily quota exceeded|daily.{0,30}free.{0,20}(?:quota|usage|limit).{0,20}(?:exceed|used up)|今日(?:內建額度|免費使用量)已用完/i

export function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false
  return QUOTA_EXCEEDED_PATTERN.test(buildErrorHaystack(error))
}

/** Detect provider-side context rejection, including AI SDK RetryError and
 * LiteLLM's nested Hosted_vllmException response body. This is intentionally
 * distinct from our local ContextOverflowError: callers use it to reduce the
 * prompt and retry before surfacing a final user-facing failure. */
export function isProviderContextWindowExceededError(error: unknown): boolean {
  if (!error) return false
  return CONTEXT_WINDOW_EXCEEDED_PATTERN.test(buildErrorHaystack(error))
}

/**
 * Extract user-friendly message from any error
 * Enhanced with detailed error mapping
 */
export function getUserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const haystack = buildErrorHaystack(error)

  // Chinese pattern table FIRST — typed AiError/FhirError getUserMessage()
  // strings are English, so checking isBaseError before the table used to
  // route the most common failures (401, rate limit, timeout…) around the
  // localized messages (audit D5)
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.pattern.test(haystack)) {
      return mapping.message
    }
  }

  // No pattern matched — fall back to the error type's curated message
  if (isBaseError(error)) {
    return error.getUserMessage()
  }

  // For unknown errors, return the original message — but never an empty string,
  // which would render as a blank error box.
  if (message && message.trim()) {
    return message
  }

  return 'AI 服務發生錯誤，請稍後再試'
}

/**
 * Log error with context
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  if (isBaseError(error)) {
    console.error('[Error]', error.toJSON())
  } else if (error instanceof Error) {
    console.error('[Error]', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      context,
    })
  } else {
    console.error('[Error]', { error: String(error), context })
  }
}
