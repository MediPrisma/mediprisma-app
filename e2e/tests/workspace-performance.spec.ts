import { expect, test } from '../fixtures/test'
import { quietGuidedTours } from '../fixtures/guided-tour'
import { type Locator, type Page } from '@playwright/test'

declare global {
  interface Window {
    __mediprismaLongTasks?: number[]
  }
}

const LEFT_TABS = ['病人資訊', '就診紀錄', '報告', '用藥', '文件'] as const
const LEFT_TAB_CONTENT_IDS = ['patient', 'visits', 'reports', 'meds', 'documents'] as const

async function clickAndMeasureTwoPaints(target: Locator) {
  return target.evaluate(async (element) => {
    const startedAt = performance.now()
    const clickable = element as HTMLElement
    clickable.click()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    return performance.now() - startedAt
  })
}

async function mouseDownAndMeasureTwoPaints(target: Locator) {
  return target.evaluate(async (element) => {
    const startedAt = performance.now()
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    return performance.now() - startedAt
  })
}

async function switchLeftTab(page: Page, name: string) {
  const tab = page.getByRole('tab').filter({ hasText: name }).first()
  const duration = await mouseDownAndMeasureTwoPaints(tab)
  await expect(tab).toHaveAttribute('data-state', 'active')
  return duration
}

async function activeLeftViewport(page: Page): Promise<Locator> {
  const viewport = page
    .locator('[role="tabpanel"][data-state="active"] [data-slot="scroll-area-viewport"]')
    .first()
  await expect(viewport).toBeVisible()
  return viewport
}

async function waitForDomQuiescence(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let quietTimer = 0
    let hardTimeout = 0
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(quietTimer)
      window.clearTimeout(hardTimeout)
      observer.disconnect()
      resolve()
    }
    const scheduleQuietCheck = () => {
      window.clearTimeout(quietTimer)
      quietTimer = window.setTimeout(finish, 500)
    }
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) scheduleQuietCheck()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    scheduleQuietCheck()
    hardTimeout = window.setTimeout(finish, 5_000)
  }))
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

test.describe('clinical workspace performance contract', () => {
  test('keeps warm tab switches, scrolling, and retained DOM bounded', async ({ page }, testInfo) => {
    test.slow()
    await page.addInitScript(() => {
      localStorage.setItem('medical-note-locale', 'zh-TW')
      localStorage.setItem('medical-note-audience', 'medical')
      localStorage.setItem('medical-note-audience-selected', '1')
      localStorage.setItem('medical-note-onboarding-v1', '1')
      localStorage.setItem('medical-note-left-browser-tour-v1', '1')
      window.__mediprismaLongTasks = []
      if ('PerformanceObserver' in window) {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__mediprismaLongTasks?.push(entry.duration)
            }
          }).observe({ type: 'longtask', buffered: true })
        } catch {
          // Older Chromium builds may omit the Long Tasks API. Frame timing
          // and DOM bounds below still exercise the regression contract.
        }
      }
    })
    await quietGuidedTours(page)

    await page.goto('/')
    await page.getByTestId('welcome-demo-card').click()
    const visitsTabDuringLoad = page.getByRole('tab').filter({ hasText: '就診紀錄' }).first()
    await expect(visitsTabDuringLoad).toBeVisible({ timeout: 30_000 })
    // Measure in the browser, as the warm-switch and detail interaction
    // budgets below do. Timing around Playwright's remote click includes
    // protocol/actionability round trips and fails on a busy runner even when
    // the page paints within budget.
    const loadingTabSwitchMs = await mouseDownAndMeasureTwoPaints(visitsTabDuringLoad)
    await expect(visitsTabDuringLoad).toHaveAttribute('data-state', 'active')
    // The interaction contract is the first visible response: selected tab +
    // lightweight loading frame. The tab's heavy workspace intentionally
    // starts mounting on the following frame and is measured separately by
    // warm-switch/scroll/trend budgets below.
    expect(loadingTabSwitchMs).toBeLessThan(500)

    await expect(page.getByText('陳大明').first()).toBeVisible({ timeout: 30_000 })

    // Warm each lazily mounted workspace and any dev-server module compile.
    for (let index = 0; index < LEFT_TABS.length; index += 1) {
      await switchLeftTab(page, LEFT_TABS[index])
      await expect(page.getByTestId(`clinical-tab-content-${LEFT_TAB_CONTENT_IDS[index]}`))
        .toBeAttached()
    }
    await expect(page.getByText('完整文件', { exact: true }).first()).toBeVisible()
    // Hidden workspaces and the summary panel hydrate independently. Establish
    // the retained-DOM baseline only after legitimate async child mounts have
    // stopped, so the assertion detects duplicate retention rather than late
    // completion of the first mount.
    await waitForDomQuiescence(page)

    const nodeCountAfterWarmup = await page.locator('*').count()
    await page.evaluate(() => { window.__mediprismaLongTasks = [] })

    const switchDurations: number[] = []
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const name of LEFT_TABS) {
        switchDurations.push(await switchLeftTab(page, name))
      }
    }

    // A warm switch should feel immediate. The high ceiling deliberately
    // tolerates shared CI runners while still catching second-long regressions.
    const warmTabSwitchP95Ms = percentile(switchDurations, 0.95)
    expect(warmTabSwitchP95Ms).toBeLessThan(500)

    // Returning to a backgrounded tab fires both browser lifecycle events in
    // Chrome. Same-day resume must not rebuild every time-dependent UI/AI
    // projection before the clinician's first click can paint.
    const longTaskCountBeforeResume = await page.evaluate(
      () => window.__mediprismaLongTasks?.length ?? 0,
    )
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const sameDayResumeTabSwitchMs = await switchLeftTab(page, '報告')
    expect(sameDayResumeTabSwitchMs).toBeLessThan(500)
    const sameDayResumeLongTasks = await page.evaluate(
      (startIndex) => (window.__mediprismaLongTasks ?? []).slice(startIndex),
      longTaskCountBeforeResume,
    )
    const longestSameDayResumeTaskMs = Math.max(0, ...sameDayResumeLongTasks)
    expect(longestSameDayResumeTaskMs).toBeLessThan(300)

    await waitForDomQuiescence(page)
    const nodeCountAfterCycles = await page.locator('*').count()
    // First visit may retain a tab, but repeated switching must not append a
    // fresh copy of its clinical DOM on every cycle.
    expect(nodeCountAfterCycles).toBeLessThanOrEqual(nodeCountAfterWarmup + 150)

    await switchLeftTab(page, '報告')
    const trendOpenDurations: number[] = []
    const trendCloseDurations: number[] = []
    for (const analyte of ['WBC', 'RBC', 'Hb', 'PLT', 'NEU']) {
      const trendButton = page.getByRole('button', { name: `查看 ${analyte} 趨勢`, exact: true })
      await expect(trendButton).toBeVisible()
      trendOpenDurations.push(await clickAndMeasureTwoPaints(trendButton))
      await expect(page.getByTestId('cumulative-trend-detail')).toBeVisible()
      const closeButton = page.getByRole('button', { name: '關閉', exact: true })
      trendCloseDurations.push(await clickAndMeasureTwoPaints(closeButton))
      await expect(page.getByTestId('cumulative-trend-detail')).toBeHidden()
    }
    const cumulativeTrendOpenP95Ms = percentile(trendOpenDurations, 0.95)
    expect(cumulativeTrendOpenP95Ms).toBeLessThan(500)
    const cumulativeTrendCloseP95Ms = percentile(trendCloseDurations, 0.95)
    expect(cumulativeTrendCloseP95Ms).toBeLessThan(350)

    await switchLeftTab(page, '用藥')
    const viewport = await activeLeftViewport(page)
    const frameIntervals = await viewport.evaluate(async (element) => {
      const intervals: number[] = []
      let previous = performance.now()
      for (let frame = 0; frame < 30; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const now = performance.now()
        intervals.push(now - previous)
        previous = now
        element.scrollTop += 120
      }
      return intervals
    })
    const medicationScrollFrameP95Ms = percentile(frameIntervals, 0.95)
    expect(medicationScrollFrameP95Ms).toBeLessThan(80)

    const longTasks = await page.evaluate(() => window.__mediprismaLongTasks ?? [])
    const longTaskP95Ms = percentile(longTasks, 0.95)
    const longestMainThreadTaskMs = Math.max(0, ...longTasks)
    // Interaction-specific P95 budgets above are the pass/fail signal for
    // sustained user-visible stalls. This page-wide observer also includes
    // framework, chart, Firestore, and shared-runner background scheduling, so
    // keep its P95 as diagnostic data and apply only a half-second freeze cap.

    const metrics = {
      loadingTabSwitchMs,
      warmTabSwitchP95Ms,
      sameDayResumeTabSwitchMs,
      longestSameDayResumeTaskMs,
      cumulativeTrendOpenP95Ms,
      cumulativeTrendCloseP95Ms,
      medicationScrollFrameP95Ms,
      longTaskP95Ms,
      longestMainThreadTaskMs,
      retainedDomGrowth: nodeCountAfterCycles - nodeCountAfterWarmup,
      samples: {
        warmTabSwitches: switchDurations.length,
        cumulativeTrendOpens: trendOpenDurations.length,
        cumulativeTrendCloses: trendCloseDurations.length,
        medicationScrollFrames: frameIntervals.length,
        longTasks: longTasks.length,
      },
      distributions: {
        cumulativeTrendOpenMs: trendOpenDurations,
        cumulativeTrendCloseMs: trendCloseDurations,
      },
    }

    await testInfo.attach('performance-metrics', {
      body: Buffer.from(`${JSON.stringify(metrics, null, 2)}\n`),
      contentType: 'application/json',
    })
    console.log(`[performance-metrics] ${JSON.stringify(metrics)}`)
    expect(longestMainThreadTaskMs).toBeLessThan(500)
  })
})
