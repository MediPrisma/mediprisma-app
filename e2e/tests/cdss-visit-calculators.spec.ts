/**
 * 決策地圖 v2's 計算機 (owner decision 2026-10-19): the list opens from the
 * head of the page and a calculator opens beside it — a panel on the right at
 * desktop widths, a sheet from the bottom on a phone — above the full-window
 * page as well as inside the CDSS panel. Its option lists open above the
 * panel, and nothing pushes the page sideways.
 * Runs on the dev-only scenario harness.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'

async function openBook(page: Page, { width, where }: { width: number; where: 'panel' | 'window' }) {
  await page.goto('/dev/cdss-scenarios')
  await page.evaluate(() => localStorage.setItem('medical-note-locale', 'zh-TW'))
  await page.locator('button[data-scenario="p9-hfpef-af-dose"]').click()
  await page.waitForURL('**/cdss-scenarios/view')
  if (where === 'window') {
    await page.goto(`/dev/cdss-scenarios/view?w=${width}&visit=book`)
  } else {
    await page.goto(`/dev/cdss-scenarios/view?w=${width}`)
    await page.getByRole('button', { name: '決策地圖 v2' }).first().click()
  }
  await expect(page.getByTestId('cdss-visit-book')).toBeVisible({ timeout: 90_000 })
}

const shot = async (page: Page, name: string) => {
  if (!process.env.CALCULATOR_SHOTS) return
  // After the overlays' fade.
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${process.env.CALCULATOR_SHOTS}/${name}.png` })
}

for (const width of [390, 1280]) {
  for (const where of ['panel', 'window'] as const) {
    test.describe(`${width}px, ${where === 'panel' ? 'inside the CDSS panel' : 'full window'}`, () => {
      test.use({ viewport: { width: where === 'panel' && width < 768 ? width + 40 : width, height: 900 } })

      test('opens the list, a calculator beside its point, and an option list above it', async ({ page }) => {
        await openBook(page, { width, where })
        const tag = `${width}-${where}`
        await shot(page, `${tag}-0-page`)
        await page.getByTestId('cdss-book-calculators').click()
        await expect(page.getByTestId('cdss-book-calculator-list')).toBeVisible()
        await expect(page.getByTestId('cdss-book-calculator-maggic')).toContainText('→ DP-19')
        await shot(page, `${tag}-1-list`)

        await page.getByTestId('cdss-book-calculator-maggic').click()
        const panel = page.getByTestId('cdss-book-calculator-panel')
        await expect(panel).toBeVisible()
        const box = (await panel.boundingBox())!
        const viewport = page.viewportSize()!
        if (width >= 768) {
          // A panel on the right, the full height.
          expect(Math.round(box.x + box.width)).toBe(viewport.width)
          expect(box.width).toBeLessThanOrEqual(520)
        } else {
          // A sheet from the bottom, the full width.
          expect(box.width).toBe(viewport.width)
          expect(Math.round(box.y + box.height)).toBe(viewport.height)
        }
        await shot(page, `${tag}-2-panel`)

        // An option list opens above the panel and can be chosen.
        await panel.locator('[data-slot="select-trigger"]').first().click()
        await page.getByRole('option').first().click()
        await expect(page.getByRole('listbox')).toBeHidden()
        await expect(panel).toBeVisible()

        // Esc closes the calculator, not the full-window page behind it.
        await page.keyboard.press('Escape')
        await expect(panel).toBeHidden()
        await expect(page.getByTestId('cdss-visit-book')).toBeVisible()
        await expect(page.getByTestId('cdss-book-calculators')).toBeFocused()

        // A calculator named in a line of the page opens it too: the guideline's 「CHA2DS2-VA」 under DP-14's 看依據.
        const dp14 = page.locator('[data-book-dp="DP-14"]')
        await dp14.getByRole('button', { name: /看依據/ }).click()
        const link = page.locator('[data-calculator-link="cha2ds2-va"]').first()
        await expect(link).toBeVisible()
        await link.scrollIntoViewIfNeeded()
        await shot(page, `${tag}-3-link`)
        await link.click()
        await expect(panel).toBeVisible()
        await expect(panel).toContainText('AF DP-14')
        await page.keyboard.press('Escape')
        await expect(panel).toBeHidden()
        // Focus goes back to the link that opened it (#334 review).
        await expect(link).toBeFocused()

        const overflow = await page.evaluate(() => {
          const book = document.querySelector<HTMLElement>('[data-testid="cdss-visit-book"]')!
          const doc = document.documentElement
          return Math.max(doc.scrollWidth - doc.clientWidth, book.scrollWidth - book.clientWidth)
        })
        expect(overflow).toBe(0)
      })
    })
  }
}
