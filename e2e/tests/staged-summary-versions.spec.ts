import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { mockAiStream, getChatCallCount } from '../fixtures/mock-stream'
import { prepareMedcloudHandoffPage } from '../fixtures/medcloud-handoff'

const block = (id: string, body: unknown) => `<<<MEDIPRISMA_MODULE:${id}>>>${JSON.stringify(body)}<<<END_MEDIPRISMA_MODULE:${id}>>>`
const reply = [block('overview', { headline: '測試病人的雲端與院內摘要', medicationEducation: [] }),
  block('problems', { problems: [] }), block('safety', { scannedCount: 0, alerts: [] }),
  block('reports', { groups: [], unremarkable: [] })].join('\n')

test('keeps cloud summary visible across a complete hospital import and restores version selection', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await prepareMedcloudHandoffPage(page)
  await mockAiStream(page, { model: 'gemini-3.1-flash-lite', markdown: reply, chunkSize: 20, delayMs: 25 })

  await page.goto('/dev/summary-versions/flow')
  await expect(page.getByTestId('import-bundle-input').first()).toBeAttached({ timeout: 90_000 })
  const deliver = await createImporter(page)
  await deliver('cloud', 1)
  const picker = page.getByRole('button', { name: '雲端', exact: true })
  await expect(picker).toBeVisible({ timeout: 40_000 })
  const hospital = page.getByRole('button', { name: '含院內資料', exact: true })
  const cloudCalls = await getChatCallCount(page)
  expect(cloudCalls).toBeGreaterThan(0)
  await deliver('hospital-visits', 2)
  await expect(picker).toHaveAttribute('aria-pressed', 'true')
  expect(await getChatCallCount(page)).toBe(cloudCalls)
  await deliver('hospital', 3)
  await expect(page.getByRole('status', { name: '新版產生中' })).toBeVisible()
  await expect(picker).toHaveAttribute('aria-pressed', 'true')
  await expect(hospital).toBeEnabled({ timeout: 40_000 })
  await expect(page.getByRole('status', { name: '新版產生中' })).toHaveCount(0)
  await expect(picker).toHaveAttribute('aria-pressed', 'true')
  const finalCalls = await getChatCallCount(page)
  expect(finalCalls).toBeGreaterThan(cloudCalls)
  await hospital.click()
  await expect(hospital).toHaveAttribute('aria-pressed', 'true')
  await picker.click()
  expect(await getChatCallCount(page)).toBe(finalCalls)
  await page.screenshot({ path: testInfo.outputPath('summary-versions-local-full.png') })
  await page.reload()
  await expect(picker).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 })
  await expect(hospital).toBeEnabled()
  expect(await getChatCallCount(page)).toBe(0)
})

async function createImporter(page: Page) {
  const bundle = JSON.parse(await readFile(path.join(__dirname, '../fixtures/medcloud-no-reports-bundle.json'), 'utf8'))
  let importId: string | undefined
  return async function deliver(stage: string, count: number) {
    const next = structuredClone(bundle)
    // Each accepted snapshot really changes the clinical input.
    next.entry.push({ resource: { resourceType: 'Observation', id: `hospital-lab-${count}`, status: 'final',
      code: { text: `院內檢驗 ${count}` }, effectiveDateTime: '2026-10-20', valueQuantity: { value: count, unit: 'mg/dL' } } })
    await page.evaluate(({ stage, expectedImportId, count }) => {
      const input = document.querySelector('[data-testid="import-bundle-input"]')!
      input.setAttribute('data-medcloud-progressive-request', JSON.stringify({ version: 1, requestId: `stage-${count}`, runId: 'e2e-summary-run', stage, expectedImportId }))
      const w = window as Window & { receipt?: { importId: string; ok: boolean } }
      w.receipt = undefined
      window.addEventListener('mediprisma:progressive-import-settled', event => { w.receipt = (event as CustomEvent).detail }, { once: true })
    }, { stage, expectedImportId: importId, count })
    await page.getByTestId('import-bundle-input').first().setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(next)) })
    await expect.poll(() => page.evaluate(() => (window as Window & { receipt?: { ok: boolean } }).receipt?.ok)).toBe(true)
    importId = await page.evaluate(() => (window as Window & { receipt?: { importId: string } }).receipt!.importId)
  }
}


test('a failed hospital summary retains cloud content and exposes retry', async ({ page }) => {
  test.setTimeout(90_000)
  await prepareMedcloudHandoffPage(page)
  await mockAiStream(page, { model: 'gemini-3.1-flash-lite', markdown: reply })
  await page.goto('/dev/summary-versions/flow')
  const deliver = await createImporter(page)
  await expect(page.getByTestId('import-bundle-input').first()).toBeAttached()
  await deliver('cloud', 1)
  const cloud = page.getByRole('button', { name: '雲端', exact: true })
  await expect(cloud).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    const original = window.fetch
    const w = window as Window & { restoreAi?: () => void }
    w.restoreAi = () => { window.fetch = original }
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('e2e-proxy.test')) return new Response(JSON.stringify({ error: { message: 'Synthetic upstream failure' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      return original(input, init)
    }
  })
  await deliver('hospital', 2)
  await expect(page.getByRole('button', { name: '重試', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(cloud).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('測試病人的雲端與院內摘要', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '含院內資料', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as Window & { restoreAi?: () => void }).restoreAi?.())
  await page.getByRole('button', { name: '重試', exact: true }).click()
  await expect(page.getByRole('button', { name: '含院內資料', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect(cloud).toHaveAttribute('aria-pressed', 'true')
})

test('Stop cancels a cloud run and does not start its queued hospital replacement', async ({ page }) => {
  test.setTimeout(60_000)
  await prepareMedcloudHandoffPage(page)
  await mockAiStream(page, { model: 'gemini-3.1-flash-lite', markdown: reply, chunkSize: 5, delayMs: 80 })
  await page.goto('/dev/summary-versions/flow')
  const deliver = await createImporter(page)
  await expect(page.getByTestId('import-bundle-input').first()).toBeAttached()
  await deliver('cloud', 1)
  await expect.poll(() => getChatCallCount(page)).toBeGreaterThan(0)
  await deliver('hospital', 2)
  await page.getByRole('button', { name: '終止', exact: true }).click()
  const stoppedCalls = await getChatCallCount(page)
  await expect(page.getByRole('button', { name: '終止', exact: true })).toHaveCount(0)
  // A second event-loop turn after the aborted promise settles must not bill
  // the final snapshot that had been queued behind it.
  await page.waitForTimeout(1200)
  expect(await getChatCallCount(page)).toBe(stoppedCalls)
})


test('Stop during manual regeneration also clears the already queued hospital summary', async ({ page }) => {
  test.setTimeout(90_000)
  await prepareMedcloudHandoffPage(page)
  await mockAiStream(page, { model: 'gemini-3.1-flash-lite', markdown: reply, chunkSize: 10, delayMs: 60 })
  await page.goto('/dev/summary-versions/flow')
  const deliver = await createImporter(page)
  await expect(page.getByTestId('import-bundle-input').first()).toBeAttached()
  await deliver('cloud', 1)
  await expect(page.getByRole('button', { name: '雲端', exact: true })).toBeVisible({ timeout: 40_000 })
  await page.getByRole('button', { name: '重新產生', exact: true }).click()
  await expect(page.getByRole('button', { name: '終止', exact: true })).toBeVisible()
  await deliver('hospital', 2)
  await page.getByRole('button', { name: '終止', exact: true }).click()
  const stoppedCalls = await getChatCallCount(page)
  await expect(page.getByRole('button', { name: '終止', exact: true })).toHaveCount(0)
  await page.waitForTimeout(1200)
  expect(await getChatCallCount(page)).toBe(stoppedCalls)
  await expect(page.getByRole('button', { name: '雲端', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('a completed version opens its saved source text after a hospital supplement', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await prepareMedcloudHandoffPage(page)
  const citedReply = [block('overview', { headline: '合成病人的用藥摘要', medicationEducation: [{ name: 'Amlodipine', benefit: '控制血壓', attention: '追蹤血壓', sources: ['M1'] }] }),
    block('problems', { problems: [{ label: '高血壓', basis: '降壓藥物', kind: 'medication', sources: ['M1'] }] }), block('safety', { scannedCount: 0, alerts: [] }), block('reports', { groups: [], unremarkable: [] })].join('\n')
  await mockAiStream(page, { model: 'gemini-3.1-flash-lite', markdown: citedReply })
  await page.goto('/dev/summary-versions/flow')
  const deliver = await createImporter(page)
  await expect(page.getByTestId('import-bundle-input').first()).toBeAttached()
  await deliver('cloud', 1)
  await expect(page.getByRole('button', { name: '雲端', exact: true })).toBeVisible({ timeout: 40_000 })
  await deliver('hospital', 2)
  await expect(page.getByRole('button', { name: '含院內資料', exact: true })).toBeEnabled({ timeout: 40_000 })
  await page.locator('[data-source-link="direct"]').first().click()
  await expect(page.getByRole('dialog')).toContainText('Amlodipine')
  await expect(page.getByRole('dialog')).not.toContainText('此版本未保存來源內文')
  await page.screenshot({ path: testInfo.outputPath('saved-summary-source.png') })
  await page.evaluate(() => {
    const importId = (window as Window & { receipt?: { importId: string } }).receipt!.importId
    window.postMessage({ source: 'medcloud2-extension', type: 'medcloud:outpatient-status', version: 1,
      runId: 'e2e-summary-run', importId, phase: 'privacy-stale' }, location.origin)
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '雲端', exact: true })).toHaveCount(0)
})

