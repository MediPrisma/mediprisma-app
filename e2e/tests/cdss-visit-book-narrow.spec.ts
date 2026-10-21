/**
 * 決策地圖 v2 at a phone's width, inside the CDSS panel and in the full window
 * (`?visit=book`): nothing pushes the page sideways, and every answer and
 * decision button ends inside the window. Before the fix (#219 review):
 *
 * - the English every-visit answers (「Worse / Stable / Better」) and the
 *   CHA₂DS₂-VA items widened the page at 320 and 390 px;
 * - P1's 「你的判斷」 row put 「還不確定」 off screen in 繁中;
 * - the full window's disease tabs widened the book in English.
 *
 * A wide table scrolls inside its own box; the page itself does not.
 * Runs on the dev-only scenario harness.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'

type Where = 'panel' | 'window'

async function openBook(page: Page, { scenario, locale, width, where }: { scenario: string; locale: 'en' | 'zh-TW'; width: number; where: Where }) {
  await page.goto('/dev/cdss-scenarios')
  await page.evaluate((value) => localStorage.setItem('medical-note-locale', value), locale)
  await page.locator(`button[data-scenario="${scenario}"]`).click()
  await page.waitForURL('**/cdss-scenarios/view')
  if (where === 'window') {
    await page.goto(`/dev/cdss-scenarios/view?w=${width}&visit=book`)
  } else {
    await page.goto(`/dev/cdss-scenarios/view?w=${width}`)
    await page.getByRole('button', { name: locale === 'en' ? 'Decision map v2' : '決策地圖 v2' }).first().click()
  }
  await expect(page.getByTestId('cdss-visit-book')).toBeVisible({ timeout: 90_000 })
}

/** How far the page (or the full-window book) scrolls sideways, and any answer or decision button past the window. */
async function sideways(page: Page) {
  return page.evaluate(() => {
    const book = document.querySelector<HTMLElement>('[data-testid="cdss-visit-book"]')!
    const doc = document.documentElement
    const edge = window.innerWidth
    const outside = [...book.querySelectorAll<HTMLElement>('[role="group"] > button, [data-visit-action], [data-visit-primary]')]
      .filter((button) => button.getBoundingClientRect().right > edge + 1)
      .map((button) => button.textContent?.trim())
    return { overflow: Math.max(doc.scrollWidth - doc.clientWidth, book.scrollWidth - book.clientWidth), outside }
  })
}

const CASES = [
  { name: 'P9 HF page (English)', scenario: 'p9-hfpef-af-dose', locale: 'en', ready: '[data-book-ask]' },
  { name: 'P9 AF page (English)', scenario: 'p9-hfpef-af-dose', locale: 'en', ready: '[data-testid="cdss-book-score"]', af: true },
  { name: 'P6 DP-03 answers (English)', scenario: 'p6-hyperkalaemia', locale: 'en', ready: '[data-book-ask]' },
  { name: 'P1 你的判斷 row (繁中)', scenario: 'p1-suspected-hfpef', locale: 'zh-TW', ready: '[data-testid="cdss-book-class-choices"]' },
  // The four pillar starts and their longest names — 「ARNI (ACE inhibitor/ARB
  // when ARNI is not feasible)」 (#201 review, at 320 px on the first map).
  { name: 'P2 pillar starts (English)', scenario: 'p2-new-hfref', locale: 'en', ready: '[data-visit-primary]' },
] as const

for (const width of [320, 390]) {
  for (const where of ['panel', 'window'] as const) {
    test.describe(`${width}px, ${where === 'panel' ? 'inside the CDSS panel' : 'full window'}`, () => {
      test.use({ viewport: { width: where === 'panel' ? width + 40 : width, height: 900 } })

      for (const item of CASES) {
        test(`${item.name} stays inside the window`, async ({ page }) => {
          await openBook(page, { scenario: item.scenario, locale: item.locale, width, where })
          // The full window carries the disease tabs in its own header, over the panel's.
          if ('af' in item) await (where === 'window' ? page.getByTestId('cdss-visit-book') : page).getByTestId('cdss-disease-switch-atrial-fibrillation-cdss').first().click()
          await expect(page.locator(item.ready).first()).toBeVisible()
          expect(await sideways(page)).toEqual({ overflow: 0, outside: [] })
        })
      }
    })
  }
}
