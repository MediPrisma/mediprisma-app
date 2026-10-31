import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { importBundle, openLeftTab } from '../fixtures/import'

const bundlePath = path.join(__dirname, '../fixtures/cross-source-prescription-copies.json')

test('one hospital prescription owns the compact row and keeps cloud originals in an on-demand popover', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await importBundle(page, { bundlePath })
  const panel = await openLeftTab(page, /^用藥$/)
  const comparison = panel.getByRole('button', { name: '院內：查看來源紀錄' })
  await expect(comparison).toHaveCount(1)
  await expect(comparison).toBeVisible()
  await expect(panel.locator('[data-medication-list-surface] li')).toHaveCount(1)
  await expect(panel.getByText('Exemestane 25 mg', { exact: true })).toHaveCount(1)
  await expect(panel.locator('[data-medication-row-layout] details')).toHaveCount(0)
  await expect(panel.getByText(/含跨來源比較組/)).toHaveCount(0)
  const sources = page.getByRole('dialog', { name: '來源紀錄' })
  await expect(sources).not.toBeVisible()
  await comparison.click()
  await expect(sources.getByText('院內', { exact: true })).toBeVisible()
  await expect(sources.getByText('雲端 1', { exact: true })).toBeVisible()
  await expect(sources.getByText('雲端 2', { exact: true })).toBeVisible()
  await expect(sources.getByText(/總量 28/)).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(sources).not.toBeVisible()
  await expect(comparison).toBeFocused()

  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const summary = page.getByRole('button', { name: '摘要', exact: true })
    if (width < 768 && await summary.isVisible()) await summary.click()
    await expect(comparison).toBeVisible()
    await comparison.click()
    await expect(sources).toBeVisible()
    const bounds = await sources.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
})
