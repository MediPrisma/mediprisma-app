import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel } from '../fixtures/import'
import path from 'node:path'

for (const width of [390, 1440]) {
  test(`model lineup at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 1000 })
    await importBundle(page)
    await openFeaturePanel(page)
    const panel = page.getByRole('tabpanel', { name: '醫療摘要' })
    await page.locator('[data-sonner-toast] [data-close-button]').evaluateAll(buttons => buttons.forEach(button => (button as HTMLButtonElement).click()))
    await panel.getByTestId('model-picker-trigger').click()
    await expect(page.getByRole('menu')).toBeVisible()
    const menu = page.getByRole('menu')
    for (const label of ['Gemini 3.1 Flash-Lite', 'Gemini 4 Hydrogen', 'GPT-6 Luna', 'Claude Haiku 5.5']) {
      await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeEnabled()
    }
    for (const id of ['gemini-4-argon', 'gemini-4-carbon', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']) {
      await expect(menu.getByTestId(`model-picker-key-link-${id}`)).toHaveCount(1)
    }
    await expect(menu.getByText('GPT-5.4 Nano', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: process.env.MODEL_SHOTS_DIR
      ? path.resolve(process.env.MODEL_SHOTS_DIR, `${process.env.MODEL_SHOTS_PHASE}-${width}.png`)
      : testInfo.outputPath(`model-lineup-${width}.png`) })
    await menu.evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.screenshot({ path: process.env.MODEL_SHOTS_DIR
      ? path.resolve(process.env.MODEL_SHOTS_DIR, `${process.env.MODEL_SHOTS_PHASE}-${width}-lower.png`)
      : testInfo.outputPath(`model-lineup-${width}-lower.png`) })

  })
}
