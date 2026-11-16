import { test, expect } from '../fixtures/test'
import { chatPanel, importBundle, openChatInput } from '../fixtures/import'

test.describe('AI chat agent-only UI', () => {
  test('does not expose mode or clinical-context injection controls', async ({ page }) => {
    await importBundle(page)
    await openChatInput(page)

    const panel = chatPanel(page)
    await expect(panel.getByText('深入', { exact: true })).toHaveCount(0)
    await expect(panel.getByText('一般', { exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '病歷', exact: true })).toHaveCount(0)
    await expect(panel.getByText('自動帶入', { exact: true })).toHaveCount(0)
    await expect(panel.getByTestId('chat-template-insert')).toBeVisible()
    await expect(panel.getByTestId('chat-template-menu')).toBeVisible()
    await expect(panel.getByTestId('chat-template-gallery')).toBeVisible()
    await expect(panel.getByTestId('chat-template-manage')).toBeVisible()
    await expect(panel.getByTestId('chat-ai-settings')).toHaveCount(0)
    await expect(panel.getByText('AI 會依問題判斷是否需要查詢病歷或最新醫學文獻')).toBeVisible()
    await expect(panel.getByText('需要病人資料或最新來源時，模型會自動選擇相應工具。不希望使用病歷時，可開啟「不讀病歷」。')).toBeVisible()
    await expect(panel.getByRole('button', { name: '傳送' })).toBeVisible()
  })

  test('routes locked personal-key models to AI settings', async ({ page }) => {
    await importBundle(page)
    await openChatInput(page)

    const panel = chatPanel(page)
    await panel.getByTestId('model-picker-trigger').click()
    await expect(page.getByTestId('model-picker-key-link-gpt-6-luna')).toHaveCount(0)
    await expect(page.getByTestId('model-picker-key-lock-gpt-6-luna')).toHaveCount(0)

    const keyLink = page.getByTestId('model-picker-key-link-gpt-6.1-terra')
    await expect(keyLink).toContainText('設定金鑰')
    await expect(keyLink).toHaveAccessibleName('GPT-6.1 Terra，設定金鑰')
    await expect(page.getByTestId('model-picker-key-lock-gpt-6.1-terra')).toBeVisible()
    await keyLink.click()

    await expect(page.getByRole('tab', { name: '設定', exact: true })).toHaveAttribute('data-state', 'active')
  })
})
