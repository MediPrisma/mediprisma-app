import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { importBundle, openLeftTab } from '../fixtures/import'

const bundlePath = path.join(__dirname, '../fixtures/hospital-medications-bundle.json')

test('hospital names support ingredient/product switching, ingredient search, provenance, and timeline', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T04:00:00Z'))
  await importBundle(page, { bundlePath })
  const panel = await openLeftTab(page, /^用藥$/)
  await expect(panel.getByText('Letrozole 2.5 mg', { exact: true })).toBeVisible()
  await expect(panel.getByText('Exemestane 25 mg', { exact: true })).toBeVisible()
  await expect(panel.getByText('Trastuzumab emtansine 100 mg', { exact: true })).toBeVisible()
  await expect(panel.getByText('Trastuzumab emtansine 160 mg', { exact: true })).toBeVisible()

  await panel.getByRole('button', { name: '商品名', exact: true }).click()
  await expect(panel.getByText('Femara FC tab 2.5 mg', { exact: true })).toBeVisible()
  await expect(panel.getByText('Aromasin SC tab 25 mg', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '成分名', exact: true }).click()

  const search = panel.getByRole('searchbox')
  await search.fill('exemestane')
  const ingredient = panel.getByText('Exemestane 25 mg', { exact: true })
  await expect(ingredient).toBeVisible()
  await panel.locator('span[tabindex="0"]').filter({ hasText: 'Exemestane 25 mg' }).focus()
  const tooltip = page.getByTestId('medication-terminology-tooltip')
  await expect(tooltip.getByText('Aromasin SC tab 25 mg', { exact: true })).toBeVisible()
  await expect(tooltip.getByRole('link', { name: '成分對照來源' })).toBeVisible()
  await expect(tooltip).not.toContainText('健保藥品主檔')
  await page.keyboard.press('Escape')

  await search.fill('unlisted')
  await panel.locator('span[tabindex="0"]').filter({ hasText: 'Unlisted product' }).focus()
  await expect(tooltip.getByText('成分未確認')).toBeVisible()
  await page.keyboard.press('Escape')

  await search.fill('')
  await panel.getByRole('button', { name: '時間軸', exact: true }).click()
  await expect(panel.locator('[data-timeline-drug-label]').filter({ hasText: 'Exemestane 25 mg' })).toBeVisible()
  await expect(panel.locator('[data-timeline-drug-label]').filter({ hasText: 'Trastuzumab emtansine 100 mg' })).toBeVisible()
})

test('hospital ingredient names and long combinations stay inside the medication pane across viewport widths', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T04:00:00Z'))
  await importBundle(page, { bundlePath })
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    if (width < 768) {
      const summarySwitcher = page.getByRole('button', { name: '摘要', exact: true })
      if (await summarySwitcher.isVisible()) await summarySwitcher.click()
    }
    const panel = await openLeftTab(page, /^用藥$/)
    await expect(panel.getByText('Tricalcium phosphate / Cholecalciferol', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: '商品名', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    for (const element of await panel.locator('[data-medication-list-surface] li').all()) {
      expect(await element.evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return rect.left >= -1 && rect.right <= window.innerWidth + 1
      })).toBe(true)
    }
  }
})
