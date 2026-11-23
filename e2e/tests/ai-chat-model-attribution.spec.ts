import { test, expect } from '../fixtures/test'
import { chatPanel, importBundle, openChatInput } from '../fixtures/import'

for (const firstStepReportsModel of [false, true]) {
  test(`keeps model uncertainty across Gemini tool steps (first reports: ${firstStepReportsModel})`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ai-config-storage', JSON.stringify({ state: { model: 'gemini-4-hydrogen' }, version: 0 }))
      localStorage.setItem('api_key_storage_type', 'sessionStorage')
      sessionStorage.setItem('gemini_api_key', 'e2e-gemini-key')
    })
    let calls = 0
    let receivedToolResult = false
    await page.route('**/generativelanguage.googleapis.com/**', async (route) => {
      const body = route.request().postData() ?? ''
      calls += 1
      const first = calls === 1
      if (!first && body.includes('Mild cardiomegaly noted')) receivedToolResult = true
      const parts = first
        ? [{
          functionCall: { name: 'queryImagingRecords', args: { query: 'Chest X-ray' } },
          thoughtSignature: 'fixture-signature',
        }]
        : [{ text: 'MODEL_ATTRIBUTION_OK：已取得測試影像報告。' }]
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
          ...(!first || firstStepReportsModel ? { modelVersion: 'gemini-4-hydrogen' } : {}),
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        })}\n\n`,
      })
    })
    await importBundle(page)
    const input = await openChatInput(page)
    await input.fill('請查詢 Chest X-ray 測試資料。')
    await page.getByRole('button', { name: '傳送', exact: true }).click()

    const panel = chatPanel(page)
    await expect(panel.locator('.prose').last()).toContainText('MODEL_ATTRIBUTION_OK', { timeout: 30_000 })
    expect(receivedToolResult).toBe(true)
    await expect(panel.getByText('Gemini 4 Hydrogen', { exact: true }).last()).toBeVisible()
    const info = panel.getByRole('button', { name: '模型資訊：API 未回報實際模型' })
    if (firstStepReportsModel) {
      await expect(info).toHaveCount(0)
    } else {
      await expect(info).toBeVisible()
      await info.focus()
      await expect(page.getByRole('tooltip')).toContainText('部分步驟的 API 未回報實際模型')
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: '功能', exact: true }).click()
      await expect(info).toBeVisible()
      await info.focus()
      await expect(page.getByRole('tooltip')).toContainText('無法確認全程使用的模型')
      await expect(panel).not.toContainText('本次未能依選擇的')
    }
  })
}
