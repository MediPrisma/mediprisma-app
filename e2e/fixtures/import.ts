import { type Page, expect } from '@playwright/test'
import path from 'node:path'
import { quietGuidedTours } from './guided-tour'

/** The committed, fully-fictional bundle used by CI and the default flow. */
export const SYNTHETIC_BUNDLE = path.join(__dirname, 'synthetic-bundle.json')

/**
 * Optional local-only real bundle. Point E2E_LOCAL_BUNDLE at a gitignored
 * file (e.g. one of your 50-case exports) to run the suite against real data
 * on your machine. Never committed; CI always uses the synthetic bundle.
 */
export const LOCAL_BUNDLE = process.env.E2E_LOCAL_BUNDLE

/**
 * Imports a FHIR bundle JSON through the header's file input and waits for the
 * patient to render. Exercises the real import → IndexedDB → render path with
 * no SMART auth / Firebase. Returns the bundle path actually used.
 */
export async function importBundle(
  page: Page,
  options: {
    bundlePath?: string
    locale?: 'en' | 'zh-TW'
  } = {},
) {
  const bundlePath = options.bundlePath || LOCAL_BUNDLE || SYNTHETIC_BUNDLE
  // Preset prefs BEFORE the app boots so first-load is deterministic:
  // - requested locale (zh-TW by default because most tests assert Chinese strings)
  // - medical audience, already "selected"
  // - first-run onboarding marked complete
  await page.addInitScript((locale) => {
    localStorage.setItem('medical-note-locale', locale)
    localStorage.setItem('medical-note-audience', 'medical')
    localStorage.setItem('medical-note-audience-selected', '1')
    localStorage.setItem('medical-note-onboarding-v1', '1')
    localStorage.setItem('medical-note-left-browser-tour-v1', '1')
  }, options.locale ?? 'zh-TW')
  await quietGuidedTours(page)
  await page.goto('/')
  // The header file input exists in the server-rendered loading shell, before
  // its change handler is ready. A clean page resolves to Welcome, while a
  // re-import resolves straight back to the persisted patient workspace. Wait
  // for either client-only result before selecting the file so the change
  // cannot be lost during hydration.
  await expect.poll(async () => {
    const welcomeReady = await page.getByTestId('welcome-demo-card').isVisible()
    const patientReady = await page.locator('[data-slot="clinical-patient-context"]').count() > 0
    return welcomeReady || patientReady
  }, { timeout: 20_000 }).toBe(true)
  // Register before choosing the file so a fast import cannot settle between
  // setInputFiles resolving and the next Playwright command.
  await page.evaluate(() => {
    const testWindow = window as Window & { __mediprismaBundleSettled?: boolean }
    testWindow.__mediprismaBundleSettled = false
    window.addEventListener('mediprisma:local-bundle-change-settled', () => {
      testWindow.__mediprismaBundleSettled = true
    }, { once: true })
  })
  // The import button renders in both the header and the welcome screen; both
  // are wired to the same importFile, so the first one is fine.
  await page.getByTestId('import-bundle-input').first().setInputFiles(bundlePath)
  await page.waitForFunction(() => (
    window as Window & { __mediprismaBundleSettled?: boolean }
  ).__mediprismaBundleSettled === true)
  // Import no longer asks anything. The post-import AI decision dialog (「只匯入
  // 並查看」/「自動產生」 plus its consent checkbox) was removed in v0.48 — auto
  // generation is now a plain switch in the 醫療摘要 header, off by default, so
  // import is silent and every spec starts free of background AI.
  // Patient panel renders once the local bundle is active. With the synthetic
  // fixture the name is 王小明; for a real local bundle, just wait for the
  // patient-info heading instead of a specific name.
  if (bundlePath === SYNTHETIC_BUNDLE) {
    // The phone workspace keeps both panels mounted and may restore the 功能
    // panel as active. The patient context is still loaded correctly even when
    // its left-panel copy is temporarily hidden, so wait for DOM attachment
    // rather than coupling data readiness to the current responsive panel.
    await expect(page.getByText('王小明').first()).toBeAttached({ timeout: 20_000 })
  }
  return bundlePath
}

/**
 * Activate a left-panel tab and wait for its panel.
 *
 * The workspace opens on 總覽 since the one-page overview landed (#72), so a
 * spec that asserts on 病人資訊, 就診紀錄, 報告, 用藥 or 文件 content has to say
 * so. Import used to leave 病人資訊 showing, which is why so many specs simply
 * asserted on its cards after `importBundle`.
 *
 * Panels for inactive tabs may be unmounted, so this waits for the tabpanel
 * rather than assuming a hidden one is merely invisible.
 */
export async function openLeftTab(page: Page, name: RegExp) {
  const tab = page.getByRole('tab', { name }).first()
  await expect(tab).toBeVisible({ timeout: 20_000 })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  return page.getByRole('tabpanel', { name })
}

/** The 病人資訊 tab, where the patient cards live. */
export async function openPatientTab(page: Page) {
  return openLeftTab(page, /病人資訊|Patient/)
}

/**
 * Turn on 醫療摘要 › 摘要設定 › 自動產生 through the real control.
 *
 * Specs that just need auto-run active across a reload should seed
 * `medical-summary-prefs` in an init script instead — an init script re-runs on
 * every navigation and would overwrite whatever this flipped. Use this when the
 * switch itself is what you are testing.
 */
export async function enableSummaryAutoGenerate(page: Page) {
  await page.getByRole('button', { name: '摘要設定', exact: true }).click()
  const toggle = page.getByRole('switch', { name: '自動產生', exact: true })
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  if ((await toggle.getAttribute('data-state')) !== 'checked') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('data-state', 'checked')
  await page.keyboard.press('Escape')
}

/**
 * Make sure the right-hand 功能 panel is showing.
 *
 * The responsive workspace (#72) starts it collapsed to a rail, so the panel's
 * tabs — 醫療摘要, 臨床對話 — are not in the DOM at all until it is expanded.
 * Specs used to find them straight after import because the panel was open by
 * default.
 *
 * The rail carries its own label (it reports a finished summary, or a running
 * one) so this matches on `data-slot` rather than on text that changes with
 * state.
 */
export async function openFeaturePanel(page: Page) {
  // `header.medicalSummary` is 醫療摘要 in zh-TW and plain "Summary" in en.
  const summaryTab = page.getByRole('tab', { name: /醫療摘要|^Summary$/ }).first()
  // Phone widths have no rail: explicitly select 功能 through the same switcher
  // a reader uses. A helper named openFeaturePanel must leave the panel open at
  // every supported viewport, including after a test crosses the 768px boundary.
  if ((page.viewportSize()?.width ?? 0) < 768) {
    if (await summaryTab.isVisible().catch(() => false)) return summaryTab
    const featureSwitcher = page.getByRole('button', { name: /^(功能|Features)$/ }).first()
    await expect(featureSwitcher).toBeVisible({ timeout: 20_000 })
    await featureSwitcher.click()
    await expect(summaryTab).toBeVisible({ timeout: 20_000 })
    return summaryTab
  }

  const rail = page.locator('[data-slot="clinical-workspace-rail"]').first()
  // The first desktop render is deliberately split while ResizeObserver
  // measures whether the preferred overview width fits. On narrower desktop
  // viewports that transiently exposes the Summary tab, then replaces it with
  // the collapsed rail. Require the open state twice. If a late patient/layout
  // reset restores the rail after a click, click the newly rendered rail again
  // instead of making the whole spec depend on Playwright's test-level retry.
  let matchingOpenObservations = 0
  await expect.poll(async () => {
    if (await summaryTab.isVisible().catch(() => false)) {
      matchingOpenObservations += 1
      return matchingOpenObservations >= 2
    }

    matchingOpenObservations = 0
    if (await rail.isVisible().catch(() => false)) {
      await rail.click({ timeout: 2_000 }).catch(() => undefined)
    }
    return false
  }, { timeout: 20_000, intervals: [100] }).toBe(true)
  return summaryTab
}

/**
 * Activate the 臨床對話 (chat) tab and return its input. Since v0.26 the right
 * panel DEFAULTS to 醫療摘要 (medical summary), so the chat input renders in an
 * inactive tab (mounted-but-hidden) until this tab is selected — and since #72
 * the panel itself starts collapsed, so it has to be opened first.
 */
export async function openChatInput(page: Page) {
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: /臨床對話|Clinical Chat/ }).click()
  const textarea = page.getByPlaceholder(/輸入|Type your/).first()
  await expect(textarea).toBeVisible()
  return textarea
}

/**
 * The 臨床對話 chat tabpanel. Scope reply/message locators to this — the page
 * now renders several `.prose` blocks (medical summary, IPS export…), so a bare
 * page.locator('.prose') no longer means "the chat reply".
 */
export function chatPanel(page: Page) {
  return page.getByRole('tabpanel', { name: /臨床對話|Clinical Chat/ })
}
