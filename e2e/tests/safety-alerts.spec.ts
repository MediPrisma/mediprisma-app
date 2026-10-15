import { test, expect } from '../fixtures/test'
import { type Page } from '@playwright/test'
import { enableSummaryAutoGenerate, importBundle, openFeaturePanel } from '../fixtures/import'
import { mockAiStream, getChatCallCount } from '../fixtures/mock-stream'

// The Medical Summary action generates all registered cards in one validated
// batch. Return every exact module block so these tests exercise the current
// unified UI without a real model or network.
const TEST_MODEL_ID = 'gpt-5.4-nano'

const SAFETY_RESULT = {
  scannedCount: 12,
  alerts: [
    {
      severity: 'high',
      title: '藥物過敏衝突',
      detail: '對 Penicillin 嚴重過敏，但處方含 Amoxicillin。',
      evidence: ['Penicillin（嚴重）', 'Amoxicillin 500mg'],
      category: 'allergy',
    },
    {
      severity: 'medium',
      title: '重複用藥',
      detail: 'Metformin 同時開立兩種劑量。',
      evidence: ['Metformin 1000mg', 'Metformin 500mg'],
      category: 'duplicate',
    },
  ],
}

const moduleBlock = (id: string, value: unknown) => [
  `<<<MEDIPRISMA_MODULE:${id}>>>`,
  JSON.stringify(value),
  `<<<END_MEDIPRISMA_MODULE:${id}>>>`,
].join('\n')

const SUMMARY_BATCH_MARKDOWN = [
  moduleBlock('overview', {
    headline: '跨院病歷測試摘要',
    medicationEducation: [],
  }),
  moduleBlock('problems', { problems: [] }),
  moduleBlock('safety', SAFETY_RESULT),
  // 影像與病理重點 runs as its own lane; the mock answers every request with
  // the same text, so the reports lane finds its module here too.
  moduleBlock('reports', { groups: [], unremarkable: [] }),
].join('\n')

async function mockUnifiedSummary(page: Page, autoGenerate = false) {
  await page.addInitScript(
    ({ modelId, autoGenerate }) => {
      localStorage.setItem('medical-summary-prefs', JSON.stringify({
        state: { autoGenerate, modelId },
        version: 0,
      }))
    },
    { modelId: TEST_MODEL_ID, autoGenerate },
  )
  await mockAiStream(page, {
    model: TEST_MODEL_ID,
    markdown: SUMMARY_BATCH_MARKDOWN,
  })
}

test.describe('safety alerts (mocked)', () => {
  test('manual summary generation lists safety under 開藥注意', async ({ page }) => {
    await mockUnifiedSummary(page)
    await importBundle(page)
    await openFeaturePanel(page)

    const summaryPanel = page.getByRole('tabpanel', { name: '醫療摘要' })
    await summaryPanel.getByTestId('medical-summary-empty-generate').click()

    // 「重新產生」 replaces the in-flight state only once the batch has finished
    // parsing, so it is the one signal that every module has rendered. Asserting
    // on the section heading first was a race: the card frame appears while the
    // safety module is still streaming, and the default 5s that followed was not
    // always enough for the alerts themselves.
    await expect(summaryPanel.getByRole('button', { name: '重新產生' })).toBeVisible({ timeout: 20_000 })
    await expect(summaryPanel.getByRole('heading', { name: '初診快覽' })).toBeVisible()

    // One neutral list, most important first (owner, 2026-10-02): no
    // high-alert banner, no severity badges, no fold for two alerts.
    const safety = summaryPanel.getByRole('region', { name: '開藥注意' })
    const rows = safety.locator('[data-safety-alerts] > li')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('藥物過敏衝突')
    await expect(rows.nth(1)).toContainText('重複用藥')
    await expect(summaryPanel.getByText(/主動安全警示/)).toHaveCount(0)
    await expect(safety.getByText('高危', { exact: true })).toHaveCount(0)
    await expect(safety.getByText('中危', { exact: true })).toHaveCount(0)
    await expect(summaryPanel.getByRole('button', { name: /其他警示/ })).toHaveCount(0)
    await expect(safety.getByText(/僅供臨床參考/)).toBeVisible()
  })

  test('model picker lists gated models and persists the unified summary choice', async ({ page }) => {
    await importBundle(page)
    await openFeaturePanel(page)
    const summaryPanel = page.getByRole('tabpanel', { name: '醫療摘要' })

    // The picker shows the default model; open it.
    await summaryPanel.getByTestId('model-picker-trigger').click()

    // Free models are selectable; premium models route to key setup.
    await expect(page.getByRole('menuitem', { name: /Claude Haiku 4\.5/ })).toBeVisible()
    const opusKeyLink = page.getByTestId('model-picker-key-link-claude-opus-5')
    await expect(opusKeyLink).toBeVisible()
    await expect(opusKeyLink).toHaveAccessibleName('Claude Opus 5，設定金鑰')

    // Pick a free model → label updates.
    await page.getByRole('menuitem', { name: /Claude Haiku 4\.5/ }).click()
    await expect(summaryPanel.getByTestId('model-picker-trigger')).toContainText('Claude Haiku 4.5')

    // The registered-card summary is the only runtime preference owner. The
    // legacy safety store is a migration surface and the chat model is separate.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('medical-summary-prefs') || ''))
      .toContain('claude-haiku-4-5')
    const legacySafetyPrefs = await page.evaluate(() => localStorage.getItem('safety-alerts-prefs') || '')
    expect(legacySafetyPrefs).not.toContain('claude-haiku-4-5')
    const chatPrefs = await page.evaluate(() => localStorage.getItem('ai-config-storage') || '')
    expect(chatPrefs).not.toContain('claude-haiku-4-5')
  })

  test('auto-generation runs the integrated safety analysis', async ({ page }) => {
    await mockUnifiedSummary(page, true)
    await importBundle(page)
    await openFeaturePanel(page)

    const summaryPanel = page.getByRole('tabpanel', { name: '醫療摘要' })
    await expect(summaryPanel.getByRole('button', { name: '重新產生' })).toBeVisible({ timeout: 20_000 })
    await expect(summaryPanel.getByText('藥物過敏衝突')).toBeVisible()
    await expect(summaryPanel.getByRole('region', { name: '開藥注意' }).getByText('重複用藥')).toBeVisible()
  })

  test('the 自動產生 switch turns background generation on', async ({ page }) => {
    // The init script leaves it off, so nothing generates on import; flipping
    // the switch is the only thing that can start a run. Covers the control
    // itself, which the seeded specs above deliberately bypass.
    await mockUnifiedSummary(page)
    await importBundle(page)
    await openFeaturePanel(page)

    const summaryPanel = page.getByRole('tabpanel', { name: '醫療摘要' })
    await expect(summaryPanel.getByTestId('medical-summary-empty-generate')).toBeVisible()

    await enableSummaryAutoGenerate(page)

    await expect(summaryPanel.getByRole('button', { name: '重新產生' })).toBeVisible({ timeout: 20_000 })
    await expect(summaryPanel.getByText('藥物過敏衝突')).toBeVisible()
  })

  test('a cached unified summary is reused after a page reload — no re-bill', async ({ page }) => {
    await mockUnifiedSummary(page, true)
    await importBundle(page)
    await openFeaturePanel(page)

    const summaryPanel = page.getByRole('tabpanel', { name: '醫療摘要' })
    await expect(summaryPanel.getByRole('button', { name: '重新產生' })).toBeVisible({ timeout: 20_000 })
    await expect(summaryPanel.getByText('藥物過敏衝突')).toBeVisible()
    // One generation is three lane requests on this compact-harness model:
    // the overview, problems + safety, and 影像與病理重點.
    expect(await getChatCallCount(page)).toBe(3)

    // The unified result comes back from encrypted cache. The mock counter
    // resets per navigation, so 0 proves the batch was not billed again.
    await page.reload()
    await openFeaturePanel(page)
    await expect(summaryPanel.getByRole('button', { name: '重新產生' })).toBeVisible({ timeout: 20_000 })
    await expect(summaryPanel.getByText('藥物過敏衝突')).toBeVisible()
    await expect(summaryPanel.getByRole('region', { name: '開藥注意' }).getByText('重複用藥')).toBeVisible()
    expect(await getChatCallCount(page)).toBe(0)
  })
})
