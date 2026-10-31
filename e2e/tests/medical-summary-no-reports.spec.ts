import path from 'path'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel } from '../fixtures/import'
import { mockAiStream } from '../fixtures/mock-stream'

// 影像與病理重點 on a 雲端病歷 chart: 「過去一年無檢查報告」 is a statement
// about the chart itself, so it appears only when the chart holds no report —
// never when a report exists but the summary's scope left it out (PR #237
// review, d834b140). Synthetic bundles only.
const TEST_MODEL_ID = 'gpt-5.4-nano'
const block = (id: string, body: unknown) => `<<<MEDIPRISMA_MODULE:${id}>>>${JSON.stringify(body)}<<<END_MEDIPRISMA_MODULE:${id}>>>`
const REPLY = [
  block('overview', { headline: 'Synthetic review patient', medicationEducation: [] }),
  block('problems', { problems: [] }),
  block('safety', { scannedCount: 0, alerts: [] }),
  block('reports', { groups: [], unremarkable: [] }),
].join('\n')

async function generate(page: import('@playwright/test').Page, bundle: string) {
  await mockAiStream(page, { model: TEST_MODEL_ID, markdown: REPLY })
  await importBundle(page, { bundlePath: path.join(__dirname, '..', 'fixtures', bundle) })
  await openFeaturePanel(page)
  const panel = page.getByRole('tabpanel', { name: '醫療摘要' })
  await panel.getByTestId('medical-summary-empty-generate').click()
  await expect(panel.getByRole('button', { name: '重新產生' })).toBeVisible({ timeout: 20_000 })
  return panel
}

test.describe('cloud-record reports statement (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((modelId) => {
      localStorage.setItem('medical-summary-prefs', JSON.stringify({ state: { autoGenerate: false, modelId }, version: 0 }))
    }, TEST_MODEL_ID)
  })

  test('a report left out of the summary is not called absent', async ({ page }) => {
    await page.addInitScript(() => {
      const profile = { selection: { imagingReports: false, labReports: false }, filters: { imagingReportTimeRange: '1y' } }
      localStorage.setItem('clinicalDataProfiles', JSON.stringify({ insights: profile, chat: profile }))
      localStorage.setItem('clinicalDataActivePreset', JSON.stringify('custom'))
    })
    const panel = await generate(page, 'medcloud-chest-xray-bundle.json')
    await expect(panel.getByText('過去一年無檢查報告', { exact: true })).toHaveCount(0)
  })

  test('a chart with no report says so', async ({ page }) => {
    const panel = await generate(page, 'medcloud-no-reports-bundle.json')
    await expect(panel.getByText('過去一年無檢查報告', { exact: true })).toBeVisible()
  })
})
