import { type Page } from '@playwright/test'

/**
 * Mock AI streaming for E2E — no real model, no network, fully deterministic,
 * but streamed TOKEN-BY-TOKEN OVER TIME so it actually reproduces the load that
 * froze the UI (re-rendering the growing reply every ~100ms).
 *
 * How it works: we override `window.fetch` (via addInitScript, before any app
 * code runs, so the AI SDK's proxy fetch — which captures `globalThis.fetch` —
 * calls ours). For the AI proxy POST we return a streaming Response whose
 * ReadableStream enqueues OpenAI Chat Completions SSE frames on a timer; every
 * other request (Firebase auth/firestore, assets) passes through untouched.
 *
 * We also install a `longtask` PerformanceObserver so the test can assert the
 * main thread never blocks for long during streaming — the real freeze guard.
 */

/** Embedded in the test prompt; lets the fetch shim identify the chat POST. */
export const STREAM_PROBE_MARKER = 'E2E_STREAM_PROBE_7f3a'

/**
 * A long, multi-block markdown reply: headings, paragraphs, a GFM table, a
 * fenced code block, tight + nested lists — repeated so it's long enough that a
 * "re-parse the whole message every tick" regression blocks the main thread
 * visibly. The table header literal `| 項目 |` is asserted to NOT appear as raw
 * text, proving it rendered as a real table (not the plain-text band-aid).
 */
const SECTION = [
  '## 住院重點',
  '病人為 65 歲男性，因**發燒**與咳嗽三天入院，疑似社區型肺炎。生命徵象穩定，無呼吸窘迫，會診感染科後續追蹤。',
  '### 問題清單',
  '1. 社區型肺炎（CAP）\n2. 第二型糖尿病，血糖控制不佳\n3. 高血壓',
  '### 用藥與數值',
  '| 項目 | 數值 | 參考範圍 |\n| --- | --- | --- |\n| CRP | 86 mg/L | < 5 |\n| WBC | 13.2 ×10⁹/L | 4–10 |\n| 血糖 | 244 mg/dL | 70–140 |',
  '### 建議醫囑（範例）',
  '```text\nAmoxicillin/Clavulanate 875/125 mg PO q12h\nNS 1000 mL IV run 12h\nCheck CXR + blood culture x2\n```',
  '> 若 48 小時內未退燒或出現低血壓，需重新評估抗生素與培養結果。',
].join('\n\n')

export const MOCK_REPLY_MARKDOWN = [
  SECTION,
  SECTION.replace('住院重點', '病程追蹤'),
  SECTION.replace('住院重點', '出院準備'),
  '### 追蹤計畫',
  '- 每日追蹤體溫與 CRP\n- 出院前確認口服抗生素耐受\n- 安排糖尿病衛教與門診追蹤',
].join('\n\n')

export interface MockStreamOptions {
  /** Model to pin. Default GPT-Nano — the model the freeze was first seen on. */
  model?: string
  /** Markdown the mocked stream returns. Default MOCK_REPLY_MARKDOWN. */
  markdown?: string
  /** Chars per SSE frame (smaller = more frames = more like token streaming). */
  chunkSize?: number
  /** Delay between frames in ms (spreads the stream over real wall-clock time). */
  delayMs?: number
  /**
   * Simulate a stalled upstream: emit this many frames, then STOP (never close
   * the stream, never send more) so the client's idle watchdog must fire. Used
   * to test the streaming timeout / anti-hang guard.
   */
  stallAfter?: number
  /** Pin the client's stream idle-timeout (ms) for this page (test seam). */
  idleTimeoutMs?: number
  /**
   * Optional prompt-specific replies for pages that launch more than one AI
   * pipeline at once (for example the unified summary + safety generation).
   * The first request-body substring match wins; `markdown` remains the
   * fallback for requests that do not match an entry.
   */
  replies?: Array<{ includes: string; markdown: string }>
}

/**
 * Preset the selected model + install the streaming fetch shim + a longtask
 * observer. MUST be called BEFORE importBundle (the init-script has to run on
 * first load).
 */
export async function mockAiStream(page: Page, opts: MockStreamOptions = {}) {
  const model = opts.model ?? 'gpt-5.4-nano'
  const markdown = opts.markdown ?? MOCK_REPLY_MARKDOWN
  const chunkSize = opts.chunkSize ?? 6
  const delayMs = opts.delayMs ?? 8
  const stallAfter = opts.stallAfter ?? -1
  const idleTimeoutMs = opts.idleTimeoutMs ?? 0
  const replies = opts.replies ?? []

  await page.addInitScript(
    ({ model, markdown, marker, chunkSize, delayMs, stallAfter, idleTimeoutMs, replies }) => {
      // 0) Optional: pin the client stream idle-timeout (anti-hang watchdog).
      if (idleTimeoutMs > 0) {
        ;(window as unknown as { __streamIdleTimeoutMs?: number }).__streamIdleTimeoutMs = idleTimeoutMs
      }

      // 1) Force the chat onto `model`. GPT-Nano is proxy-eligible (no user
      //    key) → the chat rides the OpenAI proxy track → an OpenAI-format SSE.
      localStorage.setItem('ai-config-storage', JSON.stringify({ state: { model }, version: 0 }))

      // 2) Record main-thread long tasks (>50ms) with their start offset, so
      //    the test can isolate the streaming window (reset right before send).
      const w = window as unknown as {
        __longTasks?: { d: number; t: number }[]
        __resetLongTasks?: () => void
        __chatCallCount?: number
      }
      w.__longTasks = []
      // Reset per navigation (addInitScript re-runs on reload) — lets a test
      // assert that a reload did NOT trigger a fresh AI call.
      w.__chatCallCount = 0
      w.__resetLongTasks = () => {
        w.__longTasks = []
      }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__longTasks!.push({ d: Math.round(e.duration), t: Math.round(e.startTime) })
          }
        }).observe({ entryTypes: ['longtask'] })
      } catch {
        /* longtask unsupported — assertion will simply see an empty list */
      }

      // 3) Build OpenAI Chat Completions SSE frames for the selected reply.
      // This happens per request because one user action can now launch the
      // medical-summary and safety pipelines concurrently.
      const frame = (delta: Record<string, unknown>, finish: string | null = null) =>
        `data: ${JSON.stringify(model.startsWith('gemini') ? {
          candidates: [{ index: 0, content: { role: 'model', parts: [{ text: delta.content ?? '' }] },
            ...(finish ? { finishReason: 'STOP' } : {}) }],
          modelVersion: model,
        } : {
          id: 'chatcmpl-e2e',
          object: 'chat.completion.chunk',
          created: 0,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`
      const buildFrames = (reply: string) => {
        const frames: string[] = [frame({ role: 'assistant', content: '' })]
        for (let i = 0; i < reply.length; i += chunkSize) {
          frames.push(frame({ content: reply.slice(i, i + chunkSize) }))
        }
        frames.push(frame({}, 'stop'))
        if (!model.startsWith('gemini')) frames.push('data: [DONE]\n\n')
        return frames
      }

      // 4) Override fetch. Only the AI proxy POST is mocked; everything else
      //    (Firebase, assets) passes through.
      const PROXY_HOSTS = /e2e-proxy\.test|cloudfunctions\.net|run\.app/
      const realFetch = window.fetch.bind(window)
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
        const body =
          typeof init?.body === 'string' ? init.body : input instanceof Request ? '' : ''
        const isChatCall = PROXY_HOSTS.test(url) && (body.includes(marker) || init?.method === 'POST')
        if (!isChatCall) return realFetch(input as RequestInfo, init)
        w.__chatCallCount = (w.__chatCallCount ?? 0) + 1
        const selectedReply = replies.find((reply) => body.includes(reply.includes))?.markdown ?? markdown
        const frames = buildFrames(selectedReply)

        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let i = 0
            const pump = () => {
              // Simulate a stalled upstream: after `stallAfter` frames stop
              // emitting AND never close — the client must time out on its own.
              if (stallAfter >= 0 && i >= stallAfter) return
              if (i >= frames.length) {
                controller.close()
                return
              }
              controller.enqueue(enc.encode(frames[i++]))
              setTimeout(pump, delayMs)
            }
            pump()
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
        })
      }
    },
    {
      model,
      markdown,
      marker: STREAM_PROBE_MARKER,
      chunkSize,
      delayMs,
      stallAfter,
      idleTimeoutMs,
      replies,
    },
  )
}

/** Clear collected long tasks (call right before sending to isolate streaming). */
export async function resetLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __resetLongTasks?: () => void }).__resetLongTasks?.())
}

/** Read the long tasks the in-page observer collected: {d:duration, t:start} ms. */
export async function getLongTasks(page: Page): Promise<{ d: number; t: number }[]> {
  return page.evaluate(() => (window as unknown as { __longTasks?: { d: number; t: number }[] }).__longTasks ?? [])
}

/** How many mocked AI chat calls fired since the current navigation loaded. */
export async function getChatCallCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __chatCallCount?: number }).__chatCallCount ?? 0)
}
