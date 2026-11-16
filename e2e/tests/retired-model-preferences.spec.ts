import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel, openChatInput, chatPanel } from '../fixtures/import'
import { mockAiStream, STREAM_PROBE_MARKER } from '../fixtures/mock-stream'

test('old Nano preferences show and request the current chat and summary defaults', async ({ page }) => {
  test.setTimeout(90_000)
  await mockAiStream(page, { model: 'gemini-4-hydrogen', markdown: 'Synthetic migration response.' })
  await page.addInitScript(() => {
    localStorage.setItem('ai-config-storage', JSON.stringify({ state: { model: 'gpt-5.4-nano' }, version: 0 }))
    localStorage.setItem('model-prefs', JSON.stringify({
      state: { prefs: { chat: 'gpt-5.4-nano', insights: 'gpt-5.4-nano' } }, version: 0,
    }))
    localStorage.setItem('medical-summary-prefs', JSON.stringify({
      state: { modelId: 'gpt-5.4-nano', autoGenerate: false }, version: 0,
    }))
    const captured: string[] = []
    Object.assign(window, { __migrationModelIds: captured })
    const send = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (String(input).includes('e2e-proxy.test') && typeof init?.body === 'string') {
        const model = JSON.parse(init.body).model
        if (typeof model === 'string') captured.push(model)
      }
      return send(input, init)
    }
  })
  await importBundle(page)
  await openFeaturePanel(page)
  const summary = page.getByRole('tabpanel', { name: '醫療摘要' })
  await expect(summary.getByTestId('model-picker-trigger')).toContainText('Gemini 3.1 Flash-Lite')
  await summary.getByTestId('medical-summary-empty-generate').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __migrationModelIds: string[] }).__migrationModelIds))
    .toContain('gemini-3.1-flash-lite')
  const input = await openChatInput(page)
  await expect(chatPanel(page).getByTestId('model-picker-trigger')).toContainText('Gemini 4 Hydrogen')
  await input.fill(`Synthetic question ${STREAM_PROBE_MARKER}`)
  await page.getByRole('button', { name: '傳送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __migrationModelIds: string[] }).__migrationModelIds))
    .toContain('gemini-4-hydrogen')
  expect(await page.evaluate(() => (window as unknown as { __migrationModelIds: string[] }).__migrationModelIds))
    .not.toContain('gpt-5.4-nano')
})
