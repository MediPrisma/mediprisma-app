import fs from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'
import { prepareMedcloudHandoffPage } from '../fixtures/medcloud-handoff'
import { quietGuidedTours } from '../fixtures/guided-tour'

// What the import says when 北榮 data did not arrive: #465 names each missing
// category and why, from the Bundle's capture tags; #467 adds the reason
// 雲端懷爾抓抓 reports when the hospital part never loaded (cloud-only).
// Fictional data throughout.
const FAILURE = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-failure'
const COMPLETENESS = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-completeness'

async function taggedBundle(outputPath: string, tags: object[]) {
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  bundle.meta = { ...(bundle.meta ?? {}), tag: tags }
  await fs.writeFile(outputPath, JSON.stringify(bundle))
  return outputPath
}

test('a partial 北榮 capture names each missing category and its reason, and a complete one clears it', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await importBundle(page, {
    bundlePath: await taggedBundle(testInfo.outputPath('partial.json'), [
      { system: COMPLETENESS, code: 'partial' },
      { system: FAILURE, code: 'reports:timeout', display: '2' },
      { system: FAILURE, code: 'patient:http_error:500', display: '1' },
      { system: FAILURE, code: 'vitals:login_expired', display: '1' },
    ]),
  })
  const notice = page.getByRole('status').filter({ hasText: '院內資料未取得' })
  await expect(notice).toHaveText(
    '院內資料未取得：檢查驗報告－北榮回應逾時（2 次）；病人基本資料－北榮回應錯誤（HTTP 500）；生命徵象－北榮登入已過期，請重新登入北榮後再取得。請核對 HIS。',
    { timeout: 20_000 },
  )

  // A Bundle with no capture tags says nothing.
  await importBundle(page)
  await expect(page.getByRole('status').filter({ hasText: '院內資料未取得' })).toHaveCount(0)
})

test('an older capture marked partial without reasons still says data is missing', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await importBundle(page, { bundlePath: await taggedBundle(testInfo.outputPath('partial.json'), [{ system: COMPLETENESS, code: 'partial' }]) })
  await expect(page.getByRole('status').filter({ hasText: '院內資料未取得' }))
    .toHaveText('部分院內資料未取得（未記錄原因）；請核對 HIS。', { timeout: 20_000 })
})

/** Delivers the Bundle the way 雲端懷爾抓抓 does, one progressive stage at a time. */
async function progressiveImporter(page: Page) {
  const json = await fs.readFile(SYNTHETIC_BUNDLE)
  let importId: string | undefined
  let count = 0
  return async function deliver(stage: string, extra: Record<string, unknown> = {}) {
    count += 1
    await page.evaluate(({ request }) => {
      const input = document.querySelector('[data-testid="import-bundle-input"]')!
      input.setAttribute('data-medcloud-progressive-request', JSON.stringify(request))
      const w = window as Window & { receipt?: { importId: string; ok: boolean } }
      w.receipt = undefined
      window.addEventListener('mediprisma:progressive-import-settled', event => { w.receipt = (event as CustomEvent).detail }, { once: true })
    }, { request: { version: 1, requestId: `stage-${count}`, runId: 'e2e-capture-run', stage, expectedImportId: importId, ...extra } })
    await page.getByTestId('import-bundle-input').first().setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: json })
    await expect.poll(() => page.evaluate(() => (window as Window & { receipt?: { ok: boolean } }).receipt?.ok), { timeout: 30_000 }).toBe(true)
    importId = await page.evaluate(() => (window as Window & { receipt?: { importId: string } }).receipt!.importId)
  }
}

async function openForProgressiveImport(page: Page) {
  await prepareMedcloudHandoffPage(page)
  await quietGuidedTours(page)
  await page.goto('/')
  await expect(page.getByTestId('welcome-demo-card')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('import-bundle-input').first()).toBeAttached()
  return progressiveImporter(page)
}

const CLOUD_ONLY = '雲端資料可繼續使用；院內門診資料未載入。'

test('when the hospital part never loaded, the cloud extension’s reason follows the cloud-only notice and survives a reload', async ({ page }) => {
  test.setTimeout(120_000)
  const deliver = await openForProgressiveImport(page)
  await deliver('cloud')
  await deliver('cloud-only', { partial: true, reason: 'HIS_PATIENT_SELECTION_REQUIRED' })
  const notice = page.getByRole('status').filter({ hasText: CLOUD_ONLY })
  await expect(notice).toHaveText(`${CLOUD_ONLY}（北榮查不到相符的病人或有多筆，請在北榮手動選定病人後再取得）`)

  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: CLOUD_ONLY }))
    .toHaveText(`${CLOUD_ONLY}（北榮查不到相符的病人或有多筆，請在北榮手動選定病人後再取得）`, { timeout: 30_000 })
})

test('a reason code this build does not know is dropped and the import still completes', async ({ page }) => {
  test.setTimeout(120_000)
  const deliver = await openForProgressiveImport(page)
  await deliver('cloud')
  await deliver('cloud-only', { partial: true, reason: 'HIS_SOMETHING_NEW' })
  await expect(page.getByRole('status').filter({ hasText: CLOUD_ONLY })).toHaveText(CLOUD_ONLY)
})
