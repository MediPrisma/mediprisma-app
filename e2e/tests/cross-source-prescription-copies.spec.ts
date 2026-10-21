import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { importBundle, openLeftTab } from '../fixtures/import'

const bundlePath = path.join(__dirname, '../fixtures/cross-source-prescription-copies.json')

test('one hospital prescription with two cloud copies renders one comparison with all originals', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await importBundle(page, { bundlePath })
  const panel = await openLeftTab(page, /^用藥$/)
  const comparison = panel.locator('summary').filter({ hasText: /1 筆院內藥囑 \/ 2 筆雲端紀錄/ })
  await expect(comparison).toHaveCount(1)
  await expect(comparison).toBeVisible()
  await expect(panel.locator('[data-medication-list-surface] li')).toHaveCount(1)
  await expect(panel.getByText('Exemestane 25 mg', { exact: true })).toHaveCount(1)
  if (!(await comparison.evaluate(element => (element.parentElement as HTMLDetailsElement).open))) await comparison.click()
  await expect(panel.getByText('雲端 1', { exact: true })).toBeVisible()
  await expect(panel.getByText('雲端 2', { exact: true })).toBeVisible()
  await expect(panel.getByText(/藥囑筆數與來源對應尚未確認/)).toBeVisible()
  await expect(panel.getByText(/總量 28/)).toHaveCount(2)

  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const summary = page.getByRole('button', { name: '摘要', exact: true })
    if (width < 768 && await summary.isVisible()) await summary.click()
    await expect(comparison).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
})
