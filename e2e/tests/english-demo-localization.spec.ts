import { expect, test } from '../fixtures/test'
import { quietGuidedTours } from '../fixtures/guided-tour'
import { openFeaturePanel } from '../fixtures/import'
import type { Page } from '@playwright/test'

const HAN_TEXT = /\p{Script=Han}/u

async function setStoredLocale(page: Page, locale?: 'en' | 'zh-TW') {
  await page.addInitScript((storedLocale?: string) => {
    localStorage.clear()
    if (storedLocale) localStorage.setItem('medical-note-locale', storedLocale)
    localStorage.setItem('medical-note-audience', 'medical')
    localStorage.setItem('medical-note-audience-selected', '1')
    localStorage.setItem('medical-note-onboarding-v1', '1')
    localStorage.setItem('medical-note-left-browser-tour-v1', '1')
  }, locale)
  await quietGuidedTours(page)
}

async function expectVisiblePageHasNoHanText(page: Page) {
  expect(await page.locator('body').innerText()).not.toMatch(HAN_TEXT)
}

async function expectElementInsideViewport(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight
  })).toBe(true)
}

test('starts in Traditional Chinese when no language preference exists', async ({ page }) => {
  await setStoredLocale(page)
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  await expect(page.getByRole('heading', { name: '歡迎使用 MediPrisma' })).toBeVisible()
  const headerLanguageButton = page.getByRole('button', { name: '語言: 繁體中文' })
  await expect(headerLanguageButton).toBeVisible()
  await expect(headerLanguageButton).toContainText('中文')

  const entryLanguageGroup = page.getByRole('group', { name: 'Language / 語言' })
  await expect(entryLanguageGroup).toBeVisible()
  await expect(entryLanguageGroup.getByRole('button', { name: '繁體中文' })).toHaveAttribute('aria-pressed', 'true')
  await entryLanguageGroup.getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Welcome to MediPrisma' })).toBeVisible()
})

test('English demo keeps UI and de-identified demo labels in English', async ({ page }) => {
  test.setTimeout(120_000)
  await setStoredLocale(page, 'en')
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Welcome to MediPrisma' })).toBeVisible()
  await expect(page.getByText('NHI My Health Bank', { exact: false }).first()).toBeVisible()
  await expectVisiblePageHasNoHanText(page)

  await page.getByRole('button', { name: 'Language: English' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Traditional Chinese' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByTestId('welcome-demo-card').click()

  await expect(page.getByRole('button', { name: /Exit demo/ })).toBeVisible({ timeout: 90_000 })
  await openFeaturePanel(page)
  await expect(page.getByText('Da-Ming Chen', { exact: true }).first()).toBeVisible()

  for (const tab of ['Patient Info', 'Visit History', 'Reports', 'Medications', 'Documents']) {
    const tabButton = page.getByRole('tab', { name: tab, exact: true })
    await tabButton.click()
    await expect(tabButton).toHaveAttribute('data-state', 'active')
    await expectVisiblePageHasNoHanText(page)
  }

  // Scope each check to its own panel: the cumulative report keeps tiny
  // institution labels mounted in an inactive tab, so a page-wide `.first()`
  // resolves to a hidden copy.
  await page.getByRole('tab', { name: 'Patient Info', exact: true }).click()
  const patientPanel = page.getByRole('tabpanel', { name: 'Patient Info' })
  await expect(page.getByText('Early-stage chronic kidney disease follow-up')).toBeVisible()
  await expect(patientPanel.getByText('C Hospital', { exact: true }).first()).toBeVisible()

  await page.getByRole('tab', { name: 'Visit History', exact: true }).click()
  const visitsPanel = page.getByRole('tabpanel', { name: 'Visit History' })
  await expect(visitsPanel.getByText('A Hospital', { exact: true }).first()).toBeVisible()
  await expect(visitsPanel.getByText('A Pharmacy', { exact: true }).first()).toBeVisible()

  await page.getByRole('tab', { name: 'Documents', exact: true }).click()
  await expect(page.getByText('NHI-FHIR Bridge (system-generated)', { exact: false })).toBeVisible()
})

test('entry language selector fits and switches without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setStoredLocale(page, 'en')
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Welcome to MediPrisma' })).toBeVisible()
  await expectElementInsideViewport(page, 'h2')
  const entryLanguageGroup = page.getByRole('group', { name: 'Language' })
  await expect(entryLanguageGroup).toBeVisible()
  await expect(entryLanguageGroup.getByRole('button', { name: 'Traditional Chinese' }))
    .toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.setViewportSize({ width: 844, height: 390 })
  const welcomeMain = page.locator('main')
  await expect.poll(
    () => welcomeMain.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true)
  await welcomeMain.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(page.getByText('Your health data stays in your browser on this device.')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await entryLanguageGroup.getByRole('button', { name: 'Traditional Chinese' }).click()

  await expect(page.getByRole('heading', { name: '歡迎使用 MediPrisma' })).toBeVisible()
  await expectElementInsideViewport(page, 'h2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
