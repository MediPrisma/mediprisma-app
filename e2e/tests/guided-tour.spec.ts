import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel } from '../fixtures/import'
import { getChatCallCount, mockAiStream } from '../fixtures/mock-stream'

const cases = [
  ...[320, 390, 430, 768, 1024, 1440].map((width) => ({
    width, height: 900, locale: 'zh-TW' as const,
  })),
  { width: 844, height: 390, locale: 'zh-TW' as const },
  { width: 390, height: 844, locale: 'en' as const },
]

async function openTourHub(page: Page, english = false) {
  const hubButton = page.getByRole('button', { name: english ? 'Tours' : '導覽中心', exact: true })
  if (await hubButton.isVisible()) await hubButton.click()
  else {
    await page.getByRole('button', { name: english ? 'More' : '更多', exact: true }).click()
    await page.getByRole('menuitem', { name: english ? 'Tours' : '導覽中心' }).click()
  }
  const hub = page.getByTestId('tour-hub')
  await expect(hub).toBeVisible()
  return hub
}

async function startTour(page: Page, english = false) {
  const hub = await openTourHub(page, english)
  await hub.locator('[data-tour-hub-item="custom-summary"]').click()
  await page.getByRole('button', { name: english ? 'Start from the beginning' : '從頭開始', exact: true }).click()
  await expect(page.locator('#right-tour-title')).toHaveText(customSteps[0].title[english ? 1 : 0])
}

const customSteps = [
  { title: ['用自訂摘要整理你在意的重點', 'Tailor custom summaries to your needs'], target: 'medical-summary-custom-tab' },
  { title: ['從每個模組右側的「編輯」進入', 'Open Edit beside a module'], target: 'custom-summary-edit' },
  { title: ['這裡就是模板編輯畫面', 'This is the template editor'], target: 'custom-summary-fields' },
  { title: ['在「提示」欄位編輯摘要內容要求', 'Edit summary instructions in Prompt'], target: 'custom-summary-prompt' },
  { title: ['決定是否顯示，以及何時產生', 'Choose visibility and when to generate'], target: 'custom-summary-behavior' },
  { title: ['從編輯器右上方分享模板', 'Share from the top of the template editor'], target: 'custom-summary-share' },
  { title: ['從範本庫加入，也能自己新增', 'Add library templates or create your own'], target: 'custom-summary-library' },
  { title: ['「所有範本」就在這裡', 'Find shared templates under All Prompts'], target: 'gallery-tabs' },
  { title: ['用搜尋與篩選找到適合的範本', 'Find a template with search and filters'], target: 'gallery-filters' },
  { title: ['先預覽，再決定是否套用', 'Preview before adding a template'], target: 'gallery-tabs' },
  { title: ['回到模組，按「產生」套用模板', 'Return to the module and select Generate'], target: 'custom-summary-generate' },
  { title: ['用較大的閱讀視窗查看完整結果', 'Read the full result in a larger view'], target: 'custom-summary-open-result' },
  { title: ['完成！需要時可從章節重新開始', 'Done—revisit any chapter when you need it'], target: 'medical-summary-custom-tab' },
]

test.describe('guided tours', () => {
  for (const width of [768, 1024, 1440]) {
    test(`uses a compact accessible question-mark guide at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await mockAiStream(page)
      await importBundle(page)
      await openFeaturePanel(page)
      const toast = page.getByRole('button', { name: 'Close toast', exact: true }).first()
      if (await toast.isVisible()) await toast.click()
      await page.getByRole('tab', { name: '醫療摘要', exact: true }).click()
      await page.getByRole('tab', { name: '自訂摘要', exact: true }).click()
      const help = page.getByRole('button', { name: '使用教學', exact: true })
      await expect(help).toBeVisible()
      await expect(help).toHaveAttribute('title', '使用教學')
      await expect(help).toHaveText('')
      await expect(help.locator('svg[aria-hidden="true"]')).toBeVisible()
      const box = await help.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(width < 1024 ? 44 : 24)
      expect(box!.width).toBeLessThanOrEqual(44)
      await page.screenshot({ path: testInfo.outputPath('compact-guide-button.png'), animations: 'disabled' })
      await help.focus()
      await page.keyboard.press('Enter')
      const launcher = page.getByRole('dialog', { name: '自訂摘要詳盡導覽' })
      await expect(launcher).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(launcher).toBeHidden()
      expect(await getChatCallCount(page)).toBe(0)
    })
  }

  for (const width of [390, 1440]) {
    test(`walks getting started from the tour hub and records it at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await mockAiStream(page)
      await importBundle(page)
      await openFeaturePanel(page)
      const hub = await openTourHub(page)
      await page.screenshot({ path: testInfo.outputPath('tour-hub.png') })
      await hub.getByRole('button', { name: '開始', exact: true }).click()
      await expect(hub).toBeHidden()
      const card = page.locator('section[aria-labelledby="guided-tour-title"]')
      const title = page.locator('#guided-tour-title')
      await expect(title).toHaveText('先看總覽')
      const seen: string[] = []
      for (let index = 0; index < 8; index++) {
        // A step whose control is still being looked for keeps its card
        // hidden, and one that is not on screen is skipped; read only a
        // placed card.
        await expect(card).toHaveAttribute('data-tour-card-state', 'placed')
        seen.push(await title.innerText())
        const box = await card.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        const done = card.getByRole('button', { name: '完成', exact: true })
        if (await done.isVisible()) {
          await page.screenshot({ path: testInfo.outputPath('getting-started-last.png') })
          await done.click()
          break
        }
        const previous = seen.at(-1)
        await page.locator('[data-tour-control="guided-next"]').click()
        await expect(title).not.toHaveText(previous!)
      }
      await expect(card).toBeHidden()
      expect(seen[0]).toBe('先看總覽')
      expect(seen.at(-1)).toBe('其他功能，到導覽中心挑著學')
      expect(seen.length).toBeLessThanOrEqual(5)
      const reopened = await openTourHub(page)
      await expect(reopened.getByRole('button', { name: '重看', exact: true })).toBeVisible()
      expect(await getChatCallCount(page)).toBe(0)
    })

    test(`opens the custom-summary guide from the tour hub at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockAiStream(page)
      await importBundle(page)
      await openFeaturePanel(page)
      const hub = await openTourHub(page)
      await hub.locator('[data-tour-hub-item="custom-summary"]').click()
      await expect(hub).toBeHidden()
      const launcher = page.getByRole('dialog', { name: '自訂摘要詳盡導覽' })
      await expect(launcher).toBeVisible()
      await launcher.getByRole('button', { name: '逛範本庫', exact: true }).click()
      const tour = page.locator('section[aria-labelledby="right-tour-title"]')
      await expect(page.locator('#right-tour-title')).toHaveText(customSteps[6].title[0])
      await page.locator('[data-tour-control="right-next"]').click()
      await expect(page.locator('[data-tour="custom-summary-gallery"]')).toBeVisible()
      await tour.getByRole('combobox', { name: '導覽章節' }).selectOption('custom-summary-edit')
      await expect(page.locator('#right-tour-title')).toHaveText(customSteps[1].title[0])
      await expect(page.locator('[data-tour="custom-summary-gallery"]')).toBeHidden()
      await page.locator('[data-tour-control="right-close"]').click()
      await expect(tour).toBeHidden()
      await expect(page.locator('[data-tour="custom-summary-manager"]')).toBeHidden()
      expect(await getChatCallCount(page)).toBe(0)
    })

    test(`opens and replays chapters from the contextual guide at ${width}px in dark mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
      await mockAiStream(page)
      await importBundle(page)
      await openFeaturePanel(page)
      const toast = page.getByRole('button', { name: 'Close toast', exact: true }).first()
      if (await toast.isVisible()) await toast.click()
      const phoneFeatures = page.getByRole('button', { name: '功能', exact: true })
      if (await phoneFeatures.isVisible()) await phoneFeatures.click()
      await page.getByRole('tab', { name: '醫療摘要', exact: true }).click()
      await page.getByRole('tab', { name: '自訂摘要', exact: true }).click()
      const openLocalGuide = async () => {
        if (width < 768) await page.getByRole('button', { name: '摘要設定', exact: true }).click()
        await page.locator('[data-tour="custom-summary-help"]:visible').click()
      }
      await openLocalGuide()
      const launcher = page.getByRole('dialog', { name: '自訂摘要詳盡導覽' })
      await expect(launcher).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('custom-guide-chapters-dark.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(launcher).toBeHidden()
      await expect(page.locator('#right-tour-title')).toBeHidden()
      await openLocalGuide()
      await launcher.getByRole('button', { name: '分享模板', exact: true }).click()
      await expect(page.locator('#right-tour-title')).toHaveText(customSteps[5].title[0])
      await expect(page.locator('[data-tour="custom-summary-share"]:visible')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('custom-guide-share-dark.png'), animations: 'disabled' })
      await page.locator('[data-tour-control="right-close"]').click()
      await expect(page.locator('[data-tour="custom-summary-manager"]')).toBeHidden()
      await expect(page.getByRole('tab', { name: '自訂摘要', exact: true })).toHaveAttribute('aria-selected', 'true')
      expect(await getChatCallCount(page)).toBe(0)
    })
  }

  for (const { width, height, locale } of cases) {
    test(`walks through the real custom template editor at ${width}x${height} (${locale})`, async ({ page }, testInfo) => {
      test.setTimeout(60_000)
      await page.setViewportSize({ width, height })
      await mockAiStream(page)
      await importBundle(page, { locale })
      await openFeaturePanel(page)
      const toast = page.getByRole('button', { name: 'Close toast', exact: true }).first()
      if (await toast.isVisible()) await toast.click()
      const english = locale === 'en'
      await startTour(page, english)

      const next = page.locator('[data-tour-control="right-next"]')
      const back = page.locator('[data-tour-control="right-back"]')
      const title = page.locator('#right-tour-title')
      const dialog = page.locator('section[aria-labelledby="right-tour-title"]')
      const manager = page.locator('[data-tour="custom-summary-manager"]')
      const customTab = page.locator('[data-tour="medical-summary-custom-tab"]')

      let originalPrompt = ''
      for (const [index, step] of customSteps.entries()) {
        await expect(title).toHaveText(step.title[english ? 1 : 0])
        await expect(customTab).toHaveAttribute('aria-selected', 'true')
        const inEditor = index >= 2 && index <= 9
        if (inEditor) await expect(manager).toBeVisible()
        else await expect(manager).toBeHidden()
        const target = page.locator(`[data-tour="${step.target}"]:visible`).first()
        await expect(target).toBeVisible()
        await expect.poll(async () => {
          const a = await target.boundingBox()
          const b = await page.locator('[data-tour-overlay="right-highlight"]').boundingBox()
          if (!a || !b) return false
          return Math.abs(b.x - Math.max(0, a.x - 6)) < 1
            && Math.abs(b.y - Math.max(0, a.y - 6)) < 1
            && Math.abs(b.width - (Math.min(width, a.x + a.width + 6) - Math.max(0, a.x - 6))) < 1
        }).toBe(true)
        const box = await dialog.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        expect(box!.y + box!.height).toBeLessThanOrEqual(height)
        if (index === 2 || index === 3) {
          const field = await target.boundingBox()
          // The instructions must leave the actual fields visible, not cover
          // the prompt box while claiming to show where to edit it.
          const overlapWidth = Math.max(0, Math.min(box!.x + box!.width, field!.x + field!.width) - Math.max(box!.x, field!.x))
          const overlapHeight = Math.max(0, Math.min(box!.y + box!.height, field!.y + field!.height) - Math.max(box!.y, field!.y))
          expect(overlapWidth * overlapHeight).toBe(0)
        }
        if (index === 2) originalPrompt = await manager.locator('textarea').inputValue()
        if (index === 3) {
          await expect(dialog).toContainText(english ? 'Expand editor' : '展開編輯')
          for (let count = 0; count < 8; count++) {
            await page.keyboard.press('Tab')
            expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
          }
          await manager.locator('textarea').focus()
          await expect(next).toBeFocused()
          await page.keyboard.press('Z')
          await expect(manager.locator('textarea')).toHaveValue(originalPrompt)
        }
        if (index === 6) {
          await expect(dialog).toContainText(english ? 'guest edits' : '訪客修改')
          await expect(manager.locator('textarea')).toHaveValue(originalPrompt)
          await expect(manager.getByRole('switch').last()).toHaveAttribute('aria-checked', 'false')
        }
        if (index === 5) {
          await expect(dialog).toContainText(english ? 'Sign-in is required' : '分享需要登入')
          await expect(page.locator('[data-tour="custom-summary-share-form"]')).toBeHidden()
        }
        if (index === 7) await expect(page.getByRole('tab', { name: english ? 'All Prompts' : '所有範本', exact: true })).toHaveAttribute('aria-selected', 'true')
        if (index === 9) await expect(dialog).toContainText(english ? 'No template is available' : '目前沒有可預覽的範本')
        if (index === 10) await expect(dialog).toContainText(english ? 'no item-level source citations' : '沒有逐項來源引註')
        if (index === 11) {
          await expect(dialog).toContainText(english ? 'no summary result yet' : '還沒有摘要結果')
          const promptPreview = page.getByRole('button', {
            name: english
              ? /Open .+ prompt in expanded view/
              : /放大查看「.+」提示內容/,
          }).first()
          await expect(promptPreview).toBeVisible()
          await expect(promptPreview).toBeEnabled()
        }
        await page.screenshot({ path: testInfo.outputPath(`${index}-${step.target}.png`) })
        if (index < customSteps.length - 1) {
          if (index === 10) {
            await page.evaluate(() => {
              const root = document.documentElement
              root.dataset.tourHighlightMissing = 'false'
              const interval = window.setInterval(() => {
                if (!document.querySelector('[data-tour-overlay="right-highlight"]')) {
                  root.dataset.tourHighlightMissing = 'true'
                }
              }, 8)
              window.setTimeout(() => window.clearInterval(interval), 300)
            })
          }
          await next.click()
          if (index === 10) {
            await page.waitForTimeout(320)
            await expect(page.locator('html')).toHaveAttribute('data-tour-highlight-missing', 'false')
          }
        }
      }

      await back.click()
      await expect(title).toHaveText(customSteps[11].title[english ? 1 : 0])
      await back.click()
      await expect(title).toHaveText(customSteps[10].title[english ? 1 : 0])
      await back.click()
      await expect(title).toHaveText(customSteps[9].title[english ? 1 : 0])
      await expect(manager).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(manager).toBeHidden()
      await expect(customTab).toHaveAttribute('aria-selected', 'false')
      expect(await getChatCallCount(page)).toBe(0)
    })
  }

  test('restores an already selected custom view when skipping the editor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockAiStream(page)
    await importBundle(page)
    await openFeaturePanel(page)
    await page.getByRole('tab', { name: '醫療摘要', exact: true }).click()
    const customTab = page.getByRole('tab', { name: '自訂摘要', exact: true })
    await customTab.click()
    await startTour(page)
    const next = page.locator('[data-tour-control="right-next"]')
    for (let i = 0; i < 3; i++) await next.click()
    await expect(page.locator('#right-tour-title')).toHaveText(customSteps[3].title[0])
    await expect(page.locator('[data-tour="custom-summary-manager"]')).toBeVisible()
    await page.getByRole('button', { name: '略過', exact: true }).click()
    await expect(page.locator('[data-tour="custom-summary-manager"]')).toBeHidden()
    await expect(customTab).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '編輯', exact: true }).first().click()
    await expect(page.locator('[data-tour="custom-summary-manager"]')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('[data-tour="custom-summary-manager"]')).toBeHidden()
    expect(await getChatCallCount(page)).toBe(0)
  })

  test('explains the empty custom view without enabling or creating a module', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockAiStream(page)
    await importBundle(page)
    await openFeaturePanel(page)
    await page.getByRole('tab', { name: '醫療摘要', exact: true }).click()
    await page.getByRole('tab', { name: '自訂摘要', exact: true }).click()
    await page.getByRole('button', { name: '編輯', exact: true }).first().click()
    const manager = page.locator('[data-tour="custom-summary-manager"]')
    await manager.getByRole('switch', { name: '啟用此模組', exact: true }).click()
    await page.getByRole('button', { name: '暫不登入，只在本頁使用', exact: true }).click()
    await expect(manager.getByRole('switch', { name: '啟用此模組', exact: true })).toHaveAttribute('aria-checked', 'false')
    const originalPrompt = await manager.locator('textarea').inputValue()
    await manager.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(manager).toBeHidden()
    await startTour(page)
    const next = page.locator('[data-tour-control="right-next"]')
    await next.click()
    await expect(page.locator('#right-tour-description')).toContainText('目前沒有顯示可編輯的模組')
    await next.click()
    await expect(manager).toBeVisible()
    await expect(manager.locator('textarea')).toHaveValue(originalPrompt)
    await expect(manager.getByRole('switch', { name: '啟用此模組', exact: true })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('combobox', { name: '導覽章節', exact: true }).selectOption('custom-summary-generate')
    await expect(page.locator('#right-tour-title')).toHaveText(customSteps[10].title[0])
    await expect(page.locator('#right-tour-description')).toContainText('模組啟用且病歷資料就緒後')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-tour="custom-summary-edit"]')).toHaveCount(0)
    expect(await getChatCallCount(page)).toBe(0)
  })
})
