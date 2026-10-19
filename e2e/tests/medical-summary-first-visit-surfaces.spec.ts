import path from 'path'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel } from '../fixtures/import'
import { mockAiStream } from '../fixtures/mock-stream'

// 初診快覽 surfaces the PR #237 audit fixed (2026-10-13): the headline names
// the bridge only when the chart came through it, 開藥注意 says so when a
// finished scan found nothing, and a failed scan is listed once in the error
// banner. Synthetic bundles and a mocked model only.
const TEST_MODEL_ID = 'gpt-5.4-nano'
const block = (id: string, body: unknown) => `<<<MEDIPRISMA_MODULE:${id}>>>${JSON.stringify(body)}<<<END_MEDIPRISMA_MODULE:${id}>>>`
const reply = (safety: string, problems = block('problems', { problems: [] })) => [
  block('overview', { headline: 'Synthetic review patient', medicationEducation: [] }),
  problems,
  safety,
  block('reports', { groups: [], unremarkable: [] }),
].join('\n')
const EMPTY_SCAN = block('safety', { scannedCount: 0, alerts: [] })
const BROKEN_SCAN = '<<<MEDIPRISMA_MODULE:safety>>>{ not json <<<END_MEDIPRISMA_MODULE:safety>>>'

async function generate(page: import('@playwright/test').Page, bundle: string, safety: string, problems?: string) {
  await mockAiStream(page, { model: TEST_MODEL_ID, markdown: reply(safety, problems) })
  await importBundle(page, { bundlePath: path.join(__dirname, '..', 'fixtures', bundle) })
  await openFeaturePanel(page)
  const panel = page.getByRole('tabpanel', { name: '醫療摘要' })
  await panel.getByTestId('medical-summary-empty-generate').click()
  await expect(panel.getByText('Synthetic review patient')).toBeVisible({ timeout: 30_000 })
  return panel
}

test.describe('first-visit summary surfaces (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((modelId) => {
      localStorage.setItem('medical-summary-prefs', JSON.stringify({ state: { autoGenerate: false, modelId }, version: 0 }))
    }, TEST_MODEL_ID)
  })

  test('a cloud-record chart is labelled 健保雲端, and an empty scan says so', async ({ page }) => {
    const panel = await generate(page, 'medcloud-no-reports-bundle.json', EMPTY_SCAN)
    await expect(panel.getByText(/^健保雲端 · 至 /)).toBeVisible()
    const safety = panel.getByRole('region', { name: '開藥注意' })
    await expect(safety.getByText('未發現明顯安全風險。')).toBeVisible({ timeout: 20_000 })
    // Finished: no rescan spinner beside it while the reports lane still runs.
    await expect(safety.getByRole('status')).toHaveCount(0)
  })

  test('a chart from no NHI bridge is not called 健保雲端', async ({ page }) => {
    const panel = await generate(page, 'synthetic-bundle.json', EMPTY_SCAN)
    await expect(panel.getByText(/^資料至 /)).toBeVisible()
    await expect(panel.getByText(/健保雲端 · 至/)).toHaveCount(0)
  })

  test('a failed scan is listed once in the error banner', async ({ page }) => {
    const panel = await generate(page, 'medcloud-no-reports-bundle.json', BROKEN_SCAN)
    const alert = panel.getByRole('alert')
    await expect(alert.getByText('開藥注意', { exact: false })).toHaveCount(1, { timeout: 30_000 })
    await expect(panel.getByRole('region', { name: '開藥注意' })).toHaveCount(0)
  })

  test('a failed problem list leaves an inline comparison-unavailable notice', async ({ page }) => {
    const brokenProblems = '<<<MEDIPRISMA_MODULE:problems>>>{ not json <<<END_MEDIPRISMA_MODULE:problems>>>'
    const panel = await generate(page, 'medcloud-no-reports-bundle.json', EMPTY_SCAN, brokenProblems)
    await expect(panel.getByText('摘要核對未完成：問題清單未產生，請回查原始紀錄')).toBeVisible({ timeout: 30_000 })
    await expect(panel.getByRole('button', { name: '摘要核對', exact: true })).toHaveCount(0)
  })

  test('ordinary wording differences are available through Summary check', async ({ page }) => {
    const panel = await generate(page, 'medcloud-no-reports-bundle.json', EMPTY_SCAN)
    const detail = '與問題清單未完全對應（Synthetic review patient）'
    await expect(panel.getByRole('button', { name: '摘要核對', exact: true })).toBeVisible()
    await expect(page.getByText(detail, { exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: '摘要核對', exact: true }).click()
    const check = page.getByRole('dialog', { name: '摘要核對', exact: true })
    await expect(check.getByText(detail, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(check).toBeHidden()
  })
})
