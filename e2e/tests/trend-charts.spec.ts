import { test, expect } from '../fixtures/test'
import { quietGuidedTours } from '../fixtures/guided-tour'
import { type Page } from '@playwright/test'
import { importBundle } from '../fixtures/import'

async function openReportsSubTab(page: Page, subTab: string) {
  await importBundle(page)
  await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
  await page.getByRole('tab').filter({ hasText: subTab }).first().click()
}

test.describe('trend charts (v0.15.18–v0.16.0 features)', () => {
  test('blood-pressure trend is reachable and shows SBP/DBP', async ({ page }) => {
    await openReportsSubTab(page, '生命徵象')
    // The composite-BP trend button (added so vital-sign BP rows get a trend).
    await page.getByRole('button', { name: '查看趨勢', exact: true }).first().click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await expect(detailPanel).toContainText('Blood Pressure')
    await detailPanel.getByRole('tab', { name: '趨勢圖表' }).click()
    // Abbreviated component labels remain visible in the right-pane chart.
    await expect(detailPanel.getByText(/SBP/).first()).toBeVisible()
    await expect(detailPanel.getByText(/DBP/).first()).toBeVisible()
  })

  test('single-analyte trend shows the chart with always-on value labels and normal-range band', async ({ page }) => {
    await openReportsSubTab(page, '檢驗')
    // The 檢驗 tab defaults to 依採檢日 day-cards (one card per day×institution);
    // the per-analyte 查看趨勢 trend lives in the 單項列表 flat view.
    await page.getByRole('button', { name: '單項列表' }).click()
    // Select the fixture analyte that owns the asserted range/value. Using the
    // first trend button is order-dependent and can open Sodium (no range).
    await page.getByRole('searchbox', { name: '搜尋檢驗名稱、結果、機構、日期...' }).fill('Albumin')
    const albuminRow = page.locator('[data-row-id]').filter({ hasText: '4.3 g/dL' })
    await expect(albuminRow).toBeVisible()
    await albuminRow.getByRole('button', { name: '查看趨勢', exact: true }).click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await expect(detailPanel.getByRole('img', { name: /檢驗趨勢圖/ })).toBeVisible()
    // Reference-range label + an always-on value label on a point.
    await expect(detailPanel.getByText('共同參考範圍')).toBeVisible()
    await expect(detailPanel.getByText('4.3').first()).toBeVisible()
  })

  test('dragging a box over the trend zooms in, and a box without two results explains why it did not', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await openReportsSubTab(page, '檢驗')
    await page.getByRole('button', { name: '單項列表' }).click()
    await page.getByRole('searchbox', { name: '搜尋檢驗名稱、結果、機構、日期...' }).fill('Albumin')
    const albuminRow = page.locator('[data-row-id]').filter({ hasText: '4.3 g/dL' })
    await albuminRow.getByRole('button', { name: '查看趨勢', exact: true }).click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await detailPanel.getByRole('button', { name: '全部' }).click()
    const chart = detailPanel.getByRole('img', { name: /檢驗趨勢圖，共 3 筆/ })
    await expect(chart).toBeVisible()
    // The how-to sits in the chart's status row, above the plot.
    const cue = detailPanel.getByText('在圖上按住滑鼠左右拖曳，框出要放大的時間')
    await expect(cue).toBeVisible()
    const box = (await chart.boundingBox())!
    expect((await cue.boundingBox())!.y + (await cue.boundingBox())!.height).toBeLessThanOrEqual(box.y)
    const midY = box.y + box.height / 2

    // While dragging, the box follows the pointer, the tooltip stays hidden
    // and the status row reads out the selection.
    await page.mouse.move(box.x + 75, midY)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 20, midY, { steps: 12 })
    await expect(chart.getByTestId('trend-drag-selection')).toBeVisible()
    await expect(detailPanel.getByText(/^選取 .* · 3 筆，放開即可放大$/)).toBeVisible()
    await page.mouse.up()
    await expect(detailPanel.getByText(/^已放大 2024\/03\/06–2026\/06\/02$/)).toBeVisible()
    await expect(chart.getByTestId('trend-drag-selection')).toHaveCount(0)
    await expect(detailPanel.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'false')
    await detailPanel.getByRole('button', { name: '還原' }).click()

    // A short box that holds at most one result does not zoom, and says so.
    await page.mouse.move(box.x + 75, midY)
    await page.mouse.down()
    await page.mouse.move(box.x + 100, midY, { steps: 4 })
    await page.mouse.up()
    await expect(detailPanel.getByText('選取範圍內少於兩筆結果，未放大。')).toBeVisible()
    await expect(detailPanel.getByRole('button', { name: '還原' })).toHaveCount(0)
  })

  test('the chart does not move between idle, dragging, zoomed and reset', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await openReportsSubTab(page, '檢驗')
    await page.getByRole('button', { name: '單項列表' }).click()
    await page.getByRole('searchbox', { name: '搜尋檢驗名稱、結果、機構、日期...' }).fill('Albumin')
    const albuminRow = page.locator('[data-row-id]').filter({ hasText: '4.3 g/dL' })
    await albuminRow.getByRole('button', { name: '查看趨勢', exact: true }).click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await detailPanel.getByRole('button', { name: '全部' }).click()
    const chart = detailPanel.getByRole('img', { name: /檢驗趨勢圖/ })
    await expect(chart).toBeVisible()
    const top = async () => (await chart.boundingBox())!.y
    const idle = await top()
    const box = (await chart.boundingBox())!
    const midY = box.y + box.height / 2

    await page.mouse.move(box.x + 75, midY)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 20, midY, { steps: 8 })
    await expect(detailPanel.getByText(/^選取 /)).toBeVisible()
    expect(await top()).toBe(idle)
    await page.mouse.up()
    await expect(detailPanel.getByRole('button', { name: '還原' })).toBeVisible()
    expect(await top()).toBe(idle)
    await detailPanel.getByRole('button', { name: '還原' }).click()
    await expect(detailPanel.getByRole('button', { name: '還原' })).toHaveCount(0)
    expect(await top()).toBe(idle)
  })

  test('a release in the same task as the last drag move settles on the release point', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await openReportsSubTab(page, '檢驗')
    await page.getByRole('button', { name: '單項列表' }).click()
    await page.getByRole('searchbox', { name: '搜尋檢驗名稱、結果、機構、日期...' }).fill('Albumin')
    const albuminRow = page.locator('[data-row-id]').filter({ hasText: '4.3 g/dL' })
    await albuminRow.getByRole('button', { name: '查看趨勢', exact: true }).click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await detailPanel.getByRole('button', { name: '全部' }).click()
    const chart = detailPanel.getByRole('img', { name: /檢驗趨勢圖，共 3 筆/ })
    await expect(chart).toBeVisible()
    const box = (await chart.boundingBox())!
    const midY = box.y + box.height / 2

    await page.mouse.move(box.x + 75, midY)
    await page.mouse.down()
    // Move to the far end and release inside one JS task, as a fast flick
    // does, then let any deferred work run.
    await chart.evaluate((element, { x, y }) => {
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window }
      element.dispatchEvent(new PointerEvent('pointermove', init))
      element.dispatchEvent(new PointerEvent('pointerup', init))
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, { x: box.x + box.width - 20, y: midY })
    await page.mouse.up()

    await expect(detailPanel.getByText(/^已放大 2024\/03\/06–2026\/06\/02$/)).toBeVisible()
    await expect(detailPanel.getByText('選取範圍內少於兩筆結果，未放大。')).toHaveCount(0)
    await expect(chart.getByTestId('trend-drag-selection')).toHaveCount(0)
  })

  test('releasing a drag over the axis keeps the time under the pointer', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await openReportsSubTab(page, '檢驗')
    await page.getByRole('button', { name: '單項列表' }).click()
    await page.getByRole('searchbox', { name: '搜尋檢驗名稱、結果、機構、日期...' }).fill('Albumin')
    const albuminRow = page.locator('[data-row-id]').filter({ hasText: '4.3 g/dL' })
    await albuminRow.getByRole('button', { name: '查看趨勢', exact: true }).click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await detailPanel.getByRole('button', { name: '全部' }).click()
    const chart = detailPanel.getByRole('img', { name: /檢驗趨勢圖，共 3 筆/ })
    await expect(chart).toBeVisible()
    const box = (await chart.boundingBox())!

    // Just before the middle result → past the last one, then down onto the
    // X axis and release there.
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 8 })
    await page.mouse.move(box.x + box.width - 20, box.y + box.height - 4, { steps: 4 })
    await page.mouse.up()

    await expect(detailPanel.getByText(/^已放大 2025\/02\/12–2026\/06\/02$/)).toBeVisible()
  })

  test('phone cumulative trend uses the same visible close action as other report trends', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await importBundle(page)
    await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
    // 直式 (stacked) is the default cumulative layout: every category is
    // already on screen, so the 生化 section is reached by scrolling to it
    // rather than by selecting a sub-tab.
    await page.locator('[data-cumulative-jump-chip="chem"]').click()

    const trendAction = page
      .locator('[data-cumulative-section="chem"]')
      .getByRole('button', { name: /^查看 .+ 趨勢$/ })
      .first()
    await expect(trendAction).toBeVisible()
    await trendAction.click()

    await expect(page.getByRole('button', { name: '功能' })).toHaveAttribute('aria-pressed', 'true')
    const detailPanel = page.getByRole('region', { name: '功能' })
    await expect(detailPanel.getByTestId('cumulative-trend-detail')).toBeVisible()
    await expect(detailPanel.getByRole('button', { name: '關閉', exact: true })).toBeVisible()

    await detailPanel.getByRole('button', { name: '關閉', exact: true }).click()

    await expect(page.getByRole('button', { name: '臨床摘要' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('tab').filter({ hasText: '報告' }).first())
      .toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('tab', { name: '累積報告', exact: true }))
      .toHaveAttribute('data-state', 'active')
  })

  test('phone report history action reveals its detail instead of appearing unresponsive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await openReportsSubTab(page, '影像')

    const reportViewport = page
      .locator('[role="tabpanel"][data-state="active"] [data-slot="scroll-area-viewport"]')
      .first()
    await reportViewport.evaluate((element) => { element.scrollTop = 180 })
    const historyAction = page.getByRole('button', { name: '查看歷史紀錄', exact: true }).first()
    await historyAction.scrollIntoViewIfNeeded()
    const originScrollTop = await reportViewport.evaluate((element) => element.scrollTop)

    await historyAction.click()

    await expect(page.getByRole('button', { name: '功能' })).toHaveAttribute('aria-pressed', 'true')
    const detailPanel = page.getByRole('region', { name: '功能' })
    await expect(detailPanel).toBeVisible()
    await expect(detailPanel).toContainText('歷史紀錄')

    await detailPanel.getByRole('button', { name: '關閉', exact: true }).click()

    // Closing is a back action on phones: return to the clinical browser and
    // preserve the Reports / Imaging context that launched the history.
    await expect(page.getByRole('button', { name: '臨床摘要' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('tab').filter({ hasText: '報告' }).first())
      .toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('tab').filter({ hasText: '影像' }).first())
      .toHaveAttribute('data-state', 'active')
    await expect(historyAction).toBeVisible()
    await page.waitForTimeout(300)
    await expect.poll(async () => reportViewport.evaluate((element) => element.scrollTop))
      .toBe(originScrollTop)
  })

  test('phone closes a deep demo history detail at the exact originating row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.addInitScript(() => {
      localStorage.setItem('medical-note-locale', 'zh-TW')
      localStorage.setItem('medical-note-audience', 'medical')
      localStorage.setItem('medical-note-audience-selected', '1')
      localStorage.setItem('medical-note-onboarding-v1', '1')
      localStorage.setItem('medical-note-left-browser-tour-v1', '1')
    })
    await quietGuidedTours(page)
    await page.goto('/')
    await page.getByTestId('welcome-demo-card').click()
    await expect(page.getByText('陳大明').first()).toBeAttached({ timeout: 30_000 })
    await page.getByRole('button', { name: '臨床摘要' }).click()
    await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
    await page.getByRole('tab').filter({ hasText: /^全部/ }).first().click()

    const reportViewport = page
      .locator('[role="tabpanel"][data-state="active"] [data-slot="scroll-area-viewport"]')
      .first()
    const ctRow = page.locator('[data-row-id]').filter({ hasText: 'CT, without contrast' })

    // Exercise the real virtualized list without filtering: CT 2026/01/14 is
    // well below the first rendered window, which is where display:none used
    // to discard the virtualizer's position and return near the 2018 records.
    for (let attempt = 0; attempt < 20 && await ctRow.count() === 0; attempt += 1) {
      await reportViewport.evaluate((element) => { element.scrollTop += 420 })
      await page.waitForTimeout(60)
    }
    await expect(ctRow).toContainText('2026/1/14')
    await expect(ctRow).toBeVisible()

    // Keep the target comfortably inside the viewport so Playwright/browser
    // click preparation does not introduce its own last-moment scroll.
    await ctRow.evaluate((row) => {
      const viewport = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
      if (!viewport) throw new Error('reports viewport not found')
      const rowRect = row.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      viewport.scrollTop += rowRect.top - viewportRect.top - viewport.clientHeight / 2
    })
    await page.waitForTimeout(100)

    const historyAction = ctRow.getByRole('button', { name: '查看歷史紀錄', exact: true }).first()
    const origin = await ctRow.evaluate((row) => {
      const viewport = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
      if (!viewport) throw new Error('reports viewport not found')
      return {
        scrollTop: viewport.scrollTop,
        rowTop: row.getBoundingClientRect().top,
        rowId: row.dataset.rowId,
      }
    })

    await historyAction.click()
    const detailPanel = page.getByRole('region', { name: '功能' })
    await expect(detailPanel).toContainText('歷史紀錄')
    await detailPanel.getByRole('button', { name: '關閉', exact: true }).click()

    await expect(page.getByRole('button', { name: '臨床摘要' }))
      .toHaveAttribute('aria-pressed', 'true')
    const returnedRow = page.locator(`[data-row-id="${origin.rowId}"]`)
    await expect(returnedRow).toBeVisible()
    await expect.poll(async () => returnedRow.evaluate((row) => {
      const viewport = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
      if (!viewport) throw new Error('reports viewport not found after close')
      return {
        scrollTop: Math.round(viewport.scrollTop),
        rowTop: Math.round(row.getBoundingClientRect().top),
      }
    })).toEqual({
      scrollTop: Math.round(origin.scrollTop),
      rowTop: Math.round(origin.rowTop),
    })
  })
})
