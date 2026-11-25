/**
 * DOAC 劑量計算機 opened from the AF page's dose point (DP-09) on the dev-only
 * scenario harness, P9: an 80-year-old woman on apixaban 5 mg bid whose weight
 * fell 61 → 58 kg, Cr 1.3. Covers #463 (co-medications prefilled 無), #466
 * (懷孕或哺乳 prefilled 無 for a woman) and #469 (every yes/no question the
 * record cannot answer prefilled 無), and that the dose the point shows is the
 * one the calculator gives.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'

test.use({ viewport: { width: 1280, height: 900 } })

/** P9's AF page on the day given: her last weight (58 kg) is from 2026-09-27. */
async function openAfPage(page: Page, today: string) {
  await page.clock.setFixedTime(new Date(today))
  await page.goto('/dev/cdss-scenarios')
  await page.evaluate(() => localStorage.setItem('medical-note-locale', 'zh-TW'))
  await page.locator('button[data-scenario="p9-hfpef-af-dose"]').click()
  await page.waitForURL('**/cdss-scenarios/view')
  await page.goto('/dev/cdss-scenarios/view?w=1280')
  await page.getByRole('group', { name: '選擇疾病指引' }).first().getByRole('button', { name: /^心房顫動/ }).click({ timeout: 90_000 })
  await expect(page.getByTestId('cdss-visit-book')).toBeVisible({ timeout: 60_000 })
}

test('opened from the AF dose point, it carries the latest weight, defaults the unanswered questions to 無 and gives the label dose', async ({ page }) => {
  test.setTimeout(150_000)
  // The weight is 25 days old: within the 90 the calculator allows.
  await openAfPage(page, '2026-10-22T04:00:00Z')

  // The dose point names the patient's figures and the reduced dose.
  const point = page.locator('[data-book-dp="DP-09"]')
  await expect(point).toContainText('58 kg')
  await expect(point.getByRole('row').filter({ hasText: /^apixaban/ })).toContainText('2.5 mg bid')

  await page.getByTestId('cdss-book-calculators').click()
  await expect(page.getByTestId('cdss-book-calculator-doac-dose')).toContainText('→ DP-09')
  await page.getByTestId('cdss-book-calculator-doac-dose').click()
  const panel = page.getByTestId('cdss-book-calculator-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('DP-09')

  // The latest weight, not the earlier 61 kg.
  await expect(panel.locator('#calc-weight')).toHaveValue('58')
  await expect(panel.locator('#calc-scr')).toHaveValue('1.3')

  // #466 / #469: questions the record does not answer read 無, each saying so.
  for (const key of ['dialysis', 'liver_enzymes', 'bilirubin_high', 'pregnancy', 'gi_risk']) {
    await expect(panel.locator(`#calc-${key}`), key).toHaveText('無')
  }
  await expect(panel).toContainText('預設無；懷孕或哺乳請改為「有」')
  // #463 / #469: all 13 co-medications filled 無, none left to pick.
  await expect(panel.getByTestId('calc-group-ddi')).toContainText('13 項無')
  await expect(panel.getByTestId('calc-group-ddi')).not.toContainText('未填')

  // The label dose: apixaban reduced on age ≥80 and weight ≤60 kg, against the current 5 mg bid.
  const results = panel.getByTestId('doac-dose-results')
  await expect(results.getByTestId('doac-agent-apixaban')).toContainText('2.5 mg bid')
  await expect(results.getByTestId('doac-agent-rivaroxaban')).toContainText('15 mg qd')
  await expect(results.getByTestId('doac-agent-edoxaban')).toContainText('30 mg qd')
  await expect(results.getByTestId('doac-agent-dabigatran')).toContainText('110 mg bid')
  await expect(results.getByTestId('doac-regimen-check')).toContainText('apixaban 5 mg bid：仿單劑量為 2.5 mg bid')
  await expect(results.getByTestId('doac-shared-missing')).toHaveCount(0)
  // CrCl is the computed one only: no field to type another into.
  await expect(panel.getByText('CrCl 手動覆寫')).toHaveCount(0)
})

test('a weight over 90 days old is not carried: the field is blank, focused, and nothing is dosed until one is typed', async ({ page }) => {
  test.setTimeout(150_000)
  // 110 days after her last weight.
  await openAfPage(page, '2027-01-15T04:00:00Z')
  await page.getByTestId('cdss-book-calculators').click()
  await page.getByTestId('cdss-book-calculator-doac-dose').click()
  const panel = page.getByTestId('cdss-book-calculator-panel')
  await expect(panel).toBeVisible()

  const weight = panel.locator('#calc-weight')
  await expect(weight).toHaveValue('')
  await expect(weight).toBeFocused()
  await expect(panel.getByTestId('calc-expired-weight')).toContainText('最近一筆 58 kg（2026-09-27，3 個月前）已超過 90 天，未帶入')
  const results = panel.getByTestId('doac-dose-results')
  await expect(results).toContainText('CrCl 未算')
  await expect(results.getByTestId('doac-agent-apixaban')).toHaveAttribute('data-verdict', 'missing')

  // Typed in the cursor already there: the same dose as with a recent weight on file.
  await page.keyboard.type('58')
  await expect(panel.getByTestId('calc-expired-weight')).toHaveCount(0)
  await expect(results.getByTestId('doac-agent-apixaban')).toContainText('2.5 mg bid')
})
