import { test, expect } from '../fixtures/test'

// These routes compile separately on a cold dev server.
test.setTimeout(120_000)

test('CDSS scenario storage actions have auth context', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/dev/cdss-scenarios')
  await page.locator('button[data-scenario="p9-hfpef-af-dose"]').click()
  await page.waitForURL('**/cdss-scenarios/view')
  await expect(page.getByRole('button', { name: '決策地圖 v2' }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('workspace first load has no auth or hydration errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|hydrated|#418/i.test(message.text())) {
      errors.push(message.text())
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '歡迎使用 MediPrisma' })).toBeVisible()
  await expect(page.getByRole('button', { name: '正在恢復登入' })).toHaveCount(0)
  expect(errors).toEqual([])
})
