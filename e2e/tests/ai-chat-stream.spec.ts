import { test, expect } from '../fixtures/test'
import { importBundle, openChatInput, chatPanel } from '../fixtures/import'
import { mockAiStream, getLongTasks, resetLongTasks, STREAM_PROBE_MARKER } from '../fixtures/mock-stream'

/**
 * AI chat streaming, mocked end to end (no real model — see fixtures/mock-stream).
 * The reply is streamed token-by-token OVER TIME, so this reproduces the load
 * that froze the UI. Guards the block-memoized MarkdownRenderer:
 *  - the streamed reply renders as FORMATTED markdown (table/heading/code), and
 *  - the main thread never blocks for long while streaming (the freeze guard).
 */
test.describe('AI chat streaming (mocked)', () => {
  test('streams formatted markdown without freezing the main thread', async ({ page }) => {
    await mockAiStream(page, { model: 'gemini-3.1-flash-lite' })
    await importBundle(page)

    const textarea = await openChatInput(page)
    await textarea.click()
    await textarea.fill(`請整理重點 ${STREAM_PROBE_MARKER}`)

    // Isolate the streaming window: ignore long tasks from import/first paint.
    await resetLongTasks(page)
    const started = Date.now()
    await page.getByRole('button', { name: '傳送' }).click()

    // Assistant reply renders via MarkdownRenderer → a `.prose` block.
    // (User messages use CollapsibleMessage, so `.prose` is assistant-only.)
    const reply = chatPanel(page).locator('.prose').last()

    // Formatted markdown came through the streaming path...
    await expect(reply.getByRole('table')).toBeVisible({ timeout: 25_000 })
    await expect(reply.getByRole('heading', { name: /住院/ })).toBeVisible()
    await expect(reply.locator('code').first()).toBeVisible()
    // ...all the way to the last block (full reply rendered).
    await expect(reply).toContainText('追蹤計畫')

    const elapsedMs = Date.now() - started

    // The freeze signal: longest main-thread task during streaming only.
    const longTasks = await getLongTasks(page)
    const durations = longTasks.map((x) => x.d)
    const maxTask = durations.length ? Math.max(...durations) : 0
    const totalBlocking = durations.reduce((a, b) => a + Math.max(0, b - 50), 0)
    console.log(
      `[e2e] rendered in ${elapsedMs}ms · longtasks=${durations.length} · max=${maxTask}ms · blocking=${totalBlocking}ms · raw=${JSON.stringify(longTasks)}`,
    )

    // With the block-memoized renderer the worst task stays well under a frame-
    // budget multiple even in dev mode. A regression that re-parses the whole
    // growing message every tick produces multi-hundred-ms tasks (a visible
    // freeze). Dev-mode is noisy, so the bar is generous but still catches it.
    expect(maxTask).toBeLessThan(600)

    // Raw table syntax must NOT leak as literal text — proves a real <table>.
    await expect(reply).not.toContainText('| 項目 |')
  })

  // The hard case: a big GFM table is ONE markdown block (no blank lines), so
  // block-memoization can't skip it — the worst case for the streaming renderer.
  // Guards that even this stays responsive.
  test('streams a single huge block without freezing', async ({ page }) => {
    // A big GFM table — the most expensive thing for remark-gfm to re-parse,
    // and a single block (no blank lines). This is the worst case for the
    // streaming renderer.
    const rows = Array.from(
      { length: 60 },
      (_, i) => `| 檢驗項目 ${i + 1} | ${100 + i} mg/dL | ${i % 2 ? '偏高' : '正常'} | 第 ${i + 1} 次追蹤備註，內容稍長 |`,
    ).join('\n')
    const HUGE_LIST = `| 項目 | 數值 | 狀態 | 備註 |\n| --- | --- | --- | --- |\n${rows}`

    await mockAiStream(page, { model: 'gemini-3.1-flash-lite', markdown: HUGE_LIST, chunkSize: 8, delayMs: 6 })
    await importBundle(page)

    const textarea = await openChatInput(page)
    await textarea.click()
    await textarea.fill(`請列出建議 ${STREAM_PROBE_MARKER}`)

    await resetLongTasks(page)
    const started = Date.now()
    await page.getByRole('button', { name: '傳送' }).click()

    const reply = chatPanel(page).locator('.prose').last()
    await expect(reply).toContainText('檢驗項目 60', { timeout: 25_000 })
    const elapsedMs = Date.now() - started

    const longTasks = await getLongTasks(page)
    const durations = longTasks.map((x) => x.d)
    const maxTask = durations.length ? Math.max(...durations) : 0
    const totalBlocking = durations.reduce((a, b) => a + Math.max(0, b - 50), 0)
    console.log(
      `[e2e][huge-block] rendered in ${elapsedMs}ms · longtasks=${durations.length} · max=${maxTask}ms · blocking=${totalBlocking}ms · raw=${JSON.stringify(durations)}`,
    )
    expect(maxTask).toBeLessThan(600)
  })

  // The real bug behind "GPT-Nano 卡住 10 分鐘沒回應": a stalled/never-closing
  // upstream stream left the UI hanging forever. The idle watchdog must abort it
  // and surface a timeout error instead. Idle timeout pinned to 4s for this page.
  test('a stalled stream times out instead of hanging forever', async ({ page }) => {
    // Emit 3 tokens then stall (never close, never send more).
    await mockAiStream(page, { model: 'gemini-3.1-flash-lite', stallAfter: 3, delayMs: 8, idleTimeoutMs: 4000 })
    await importBundle(page)

    const textarea = await openChatInput(page)
    await textarea.click()
    await textarea.fill(`會卡住的請求 ${STREAM_PROBE_MARKER}`)

    const started = Date.now()
    await page.getByRole('button', { name: '傳送' }).click()

    // The stream stalls; within the idle timeout (4s) the assistant message must
    // expose a retryable timeout alert (getUserErrorMessage maps "timed out" →
    // 逾時), while preserving the partial answer. Allow generous wall-clock
    // for CI.
    const timeoutAlert = chatPanel(page).getByRole('alert')
    await expect(timeoutAlert).toContainText('逾時', { timeout: 15_000 })
    await expect(timeoutAlert.getByRole('button', { name: '重試' })).toBeVisible()
    const elapsedMs = Date.now() - started
    console.log(`[e2e][stall] timed out + surfaced error in ${elapsedMs}ms`)

    // And the input is usable again (Send button back → not stuck loading).
    await expect(page.getByRole('button', { name: '傳送' })).toBeVisible()
  })
})
