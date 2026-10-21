import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel, openLeftTab } from '../fixtures/import'
import { stubFirebaseAnonymousAuth } from '../fixtures/firebase-auth'
import { createMergedFhirFixture, type RawBundle, type SourceImage } from '../fixtures/merged-fhir'
import { expectImportWorker, observeImportWorkers } from '../fixtures/import-worker'
import { quietGuidedTours } from '../fixtures/guided-tour'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const parse = (bytes: Buffer): RawBundle => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
const activeImport = (page: Page) => page.evaluate(() => sessionStorage.getItem('fhir_bundle_override'))

test('progressive snapshots replace one patient chart and preserve late terminal warnings', async ({ page }, info) => {
  test.setTimeout(120_000)
  await quietGuidedTours(page)
  await page.addInitScript(() => {
    localStorage.setItem('medical-note-locale', 'zh-TW')
    localStorage.setItem('medical-note-audience', 'medical')
    localStorage.setItem('medical-note-audience-selected', '1')
    localStorage.setItem('medical-note-onboarding-v1', '1')
    const host = window as Window & { progressiveReceipts?: Record<string, unknown>[] }
    host.progressiveReceipts = []
    window.addEventListener('mediprisma:progressive-import-settled', event => {
      host.progressiveReceipts!.push((event as CustomEvent).detail)
    })
  })
  await page.goto(process.env.E2E_APP_PATH || '/')
  await expect(page.getByTestId('welcome-demo-card')).toBeVisible()
  const input = page.getByTestId('import-bundle-input').first()
  await expect(input).toHaveAttribute('data-medcloud-progressive', '1')
  const patient = { resourceType: 'Patient', id: 'progressive-patient', name: [{ text: '合成分階段病人' }] }
  const visit = { resourceType: 'Encounter', id: 'progressive-visit', status: 'finished', class: { code: 'AMB' }, subject: { reference: 'Patient/progressive-patient' } }
  const soap = { resourceType: 'DocumentReference', id: 'progressive-soap', status: 'current', subject: { reference: 'Patient/progressive-patient' },
    content: [{ attachment: { contentType: 'text/plain', data: Buffer.from('S: synthetic progressive SOAP').toString('base64') } }] }
  const result = { resourceType: 'Observation', id: 'progressive-result', status: 'final', code: { text: '合成檢驗' }, subject: { reference: 'Patient/progressive-patient' }, valueQuantity: { value: 100, unit: 'mg/dL' } }
  let revision = 0
  const send = async (stage: string, resources: Record<string, unknown>[], expectedImportId?: string) => {
    const requestId = `progressive-request-${++revision}`
    await input.evaluate((element, request) => element.setAttribute('data-medcloud-progressive-request', JSON.stringify(request)), {
      version: 1, requestId, runId: 'progressive-run', stage, ...(expectedImportId ? { expectedImportId } : {}),
    })
    await input.setInputFiles({ name: 'synthetic-progressive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: resources.map(resource => ({ resource })) })) })
    await page.waitForFunction(id => (window as Window & { progressiveReceipts?: Record<string, unknown>[] }).progressiveReceipts?.some(receipt => receipt.requestId === id), requestId)
    return page.evaluate(id => (window as Window & { progressiveReceipts?: Record<string, unknown>[] }).progressiveReceipts!.find(receipt => receipt.requestId === id)!, requestId)
  }
  const cloud = await send('cloud', [patient])
  expect(cloud.ok).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: '雲端資料已載入' })).toBeVisible()
  const visits = await send('hospital-visits', [patient, visit, soap], cloud.importId as string)
  expect(visits.ok).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: '檢查驗報告擷取中' })).toBeVisible()
  await openLeftTab(page, /^文件$/)
  await expect(page.getByText('S: synthetic progressive SOAP', { exact: true }).first()).toBeVisible()
  await info.attach('soap-visible-before-reports', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  const finalResources = [patient, visit, soap, result]
  const final = await send('hospital', finalResources, visits.importId as string)
  expect(final.ok).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: '已載入院內門診資料' })).toBeVisible()
  expect((await send('hospital', finalResources, visits.importId as string)).ok).toBe(false)
  await openDownloads(page)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下載原始 FHIR', exact: true }).click()
  const filename = info.outputPath('progressive-final.json')
  await (await pending).saveAs(filename)
  const exported = parse(await fs.readFile(filename))
  expect(exported.entry.map(entry => entry.resource)).toEqual(finalResources)
  expect(new Set(exported.entry.map(entry => `${entry.resource.resourceType}/${entry.resource.id}`)).size).toBe(finalResources.length)
  await page.evaluate(() => {
    const previous = Storage.prototype.setItem, marker = sessionStorage.getItem('fhir_bundle_override')
    ;(window as Window & { restoreStorage?: () => void }).restoreStorage = () => { Storage.prototype.setItem = previous }
    Storage.prototype.setItem = function (name, value) {
      if (this === sessionStorage && name === 'fhir_bundle_override' && value !== marker) throw new DOMException('synthetic quota', 'QuotaExceededError')
      return previous.call(this, name, value)
    }
  })
  expect((await send('hospital', finalResources, final.importId as string)).ok).toBe(false)
  await page.evaluate(() => (window as Window & { restoreStorage?: () => void }).restoreStorage!())
  expect((await send('hospital', [{ ...patient, id: 'other-patient' }], final.importId as string)).ok).toBe(false)
  await page.evaluate(importId => window.postMessage({ source: 'medcloud2-extension', type: 'medcloud:outpatient-status', version: 1,
    runId: 'progressive-run', importId, phase: 'patient-changed' }, location.origin), visits.importId)
  await expect(page.getByRole('alert').filter({ hasText: '畫面仍為先前病人資料' })).toBeVisible()
  await info.attach('late-patient-change-warning', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  await page.reload()
  await expect(page.getByText('合成分階段病人', { exact: true }).first()).toBeAttached()
  await expect(page.getByRole('alert').filter({ hasText: '畫面仍為先前病人資料' })).toBeVisible()
  expect(await activeImport(page)).toBe(`import:${final.importId}`)
  await openDownloads(page)
  const restoredDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下載原始 FHIR', exact: true }).click()
  const restored = info.outputPath('progressive-after-quota-reload.json')
  await (await restoredDownload).saveAs(restored)
  expect(parse(await fs.readFile(restored)).entry.map(entry => entry.resource)).toEqual(finalResources)
})

async function openDownloads(page: Page) {
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: '複製', exact: true }).click()
  await page.getByRole('tab', { name: '下載檔案', exact: true }).click()
}

async function verifyClinicalData(page: Page) {
  await openLeftTab(page, /^病人資訊$/)
  const conditions = page.getByTestId('problem-list-card')
  for (const source of ['cloud', 'hospital']) {
    await expect(conditions.getByText(`${source} 原始診斷`, { exact: true })).toBeVisible()
  }
  await openLeftTab(page, /^用藥/)
  const medications = page.locator('[data-medication-list-surface="grouped"]').first()
  for (const source of ['cloud', 'hospital']) {
    await expect(medications.getByText(`${source} 原始處方`, { exact: true })).toBeVisible()
  }
}

async function verifyImages(page: Page, images: SourceImage[], stage: string, info: TestInfo) {
  await openLeftTab(page, /^報告$/)
  await page.getByRole('tab').filter({ hasText: /^影像/ }).first().click()
  for (const title of [...new Set(images.map(image => image.reportTitle))]) {
    const expected = images.filter(image => image.reportTitle === title)
    const row = page.getByRole('heading').filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await row.getByRole('button', { name: '查看影像', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('img')).toHaveCount(expected.length)
    for (const image of expected) {
      const rendered = dialog.getByRole('img', { name: image.title, exact: true })
      await rendered.scrollIntoViewIfNeeded()
      await expect.poll(() => rendered.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
        .toEqual([image.width, image.height])
      const actual = await rendered.evaluate(async (element: HTMLImageElement) => {
        const response = await fetch(element.src)
        const bytes = new Uint8Array(await response.arrayBuffer())
        return { contentType: response.headers.get('content-type'), data: btoa(String.fromCharCode(...bytes)) }
      })
      expect(actual.contentType).toBe(image.contentType)
      expect(actual.data).toBe(image.data)
    }
    await info.attach(`${stage}-${expected[0].source}-images`, { body: await dialog.screenshot(), contentType: 'image/png' })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  }
}

test('merged cloud and hospital originals and every embedded image survive download and clean-context reimport', async ({ page, browser, requireImportWorker }, info) => {
  test.setTimeout(180_000)
  const { bundle, original, images } = createMergedFhirFixture(process.env.E2E_IMPORT_FIXTURE_TIMESTAMP)
  const source = info.outputPath('merged-source.json')
  await fs.writeFile(source, original)
  expect(original.length).toBeGreaterThan(4 * 1024 * 1024)
  expect(images).toHaveLength(4)
  expect(images.map(image => image.source)).toEqual(['cloud', 'cloud', 'hospital', 'hospital'])
  expect([...new Set(images.map(image => image.contentType))].sort())
    .toEqual(['image/jpeg', 'image/png', 'image/svg+xml'])
  expect(new Set(images.map(image => image.data)).size).toBe(images.length)
  const evidence: Array<{ stage: string; bytes: number; sha256: string; cloudResources: number; hospitalResources: number; images: number }> = []
  const verifyDownload = async (target: Page, stage: string) => {
    await openDownloads(target)
    const button = target.getByRole('button', { name: '下載原始 FHIR', exact: true })
    await expect(button).toBeEnabled()
    const pending = target.waitForEvent('download')
    await button.click()
    const download = await pending
    await info.attach(`${stage}-filename`, { contentType: 'text/plain', body: download.suggestedFilename() })
    expect(download.suggestedFilename()).toMatch(/^FHIR_original_整併測試病人_A123456789_\d{8}\.json$/)
    const path = info.outputPath(`${stage}.json`)
    await download.saveAs(path)
    const bytes = await fs.readFile(path)
    // Compare bytes, not reserialized JSON: this covers unknown fields and BOM too.
    expect(bytes.equals(original)).toBe(true)
    expect(sha256(bytes)).toBe(sha256(original))
    const restored = parse(bytes)
    expect(restored).toEqual(bundle)
    expect(restored.entry.map(entry => entry.fullUrl)).toEqual(bundle.entry.map(entry => entry.fullUrl))
    const counts = { cloud: 0, hospital: 0 }
    for (const source of ['cloud', 'hospital'] as const) {
      const entries = restored.entry.filter(entry => entry.resource.id.startsWith(`${source}-`))
      const originals = bundle.entry.filter(entry => entry.resource.id.startsWith(`${source}-`))
      expect(entries).toEqual(originals)
      expect(entries.map(entry => entry.resource.resourceType).sort()).toEqual([
        'Binary', 'Condition', 'DiagnosticReport', 'DocumentReference', 'Encounter',
        'MedicationRequest', 'Observation', 'Organization',
      ])
      const report = entries.find(entry => entry.resource.resourceType === 'DiagnosticReport')!.resource
      expect(report.presentedForm).toEqual(images.filter(image => image.source === source)
        .map(({ contentType, title, data }) => ({ contentType, title, data })))
      counts[source] = entries.length
    }
    evidence.push({ stage, bytes: bytes.length, sha256: sha256(bytes), cloudResources: counts.cloud, hospitalResources: counts.hospital, images: images.length })
    return path
  }

  await importBundle(page, { bundlePath: source })
  await info.attach('initial-import-workspace', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  if (requireImportWorker) await expectImportWorker(page, info, 'initial', original.length)
  const originalImport = await activeImport(page)
  expect(originalImport).toMatch(/^import:.+/)
  await expect(page.getByText('整併測試病人').first()).toBeAttached()
  await verifyClinicalData(page)
  await verifyImages(page, images, 'first-import', info)
  const downloaded = await verifyDownload(page, 'first-download')
  await page.reload()
  await verifyImages(page, images, 'original-reload', info)
  await verifyDownload(page, 'download-after-reload')

  // A separate browser context has no original IndexedDB, session key, or images.
  const clean = await browser.newContext({
    locale: 'zh-TW', baseURL: new URL(page.url()).origin, viewport: page.viewportSize(),
  })
  try {
    await stubFirebaseAnonymousAuth(clean)
    if (requireImportWorker) await observeImportWorkers(clean)
    const restored = await clean.newPage()
    await restored.goto(process.env.E2E_APP_PATH || '/')
    expect(await activeImport(restored)).toBeNull()
    await importBundle(restored, { bundlePath: downloaded })
    if (requireImportWorker) await expectImportWorker(restored, info, 'clean-reimport', original.length)
    const firstReimport = await activeImport(restored)
    expect(firstReimport).toMatch(/^import:.+/)
    expect(firstReimport).not.toBe(originalImport)
    await expect(restored.getByText('整併測試病人').first()).toBeAttached()
    await verifyClinicalData(restored)
    await verifyImages(restored, images, 'clean-reimport', info)
    const secondDownload = await verifyDownload(restored, 'clean-reimport-download')
    await restored.reload()
    await verifyImages(restored, images, 'clean-reimport-reload', info)
    await verifyDownload(restored, 'clean-reimport-reload-download')
    // Repeat using an actual download from the new context, not the fixture.
    await importBundle(restored, { bundlePath: secondDownload })
    if (requireImportWorker) await expectImportWorker(restored, info, 'second-reimport', original.length)
    const secondReimport = await activeImport(restored)
    expect(secondReimport).toMatch(/^import:.+/)
    expect(secondReimport).not.toBe(firstReimport)
    await verifyClinicalData(restored)
    await verifyImages(restored, images, 'second-reimport', info)
    await verifyDownload(restored, 'second-reimport-download')
    await restored.reload()
    await verifyClinicalData(restored)
    await verifyImages(restored, images, 'second-reimport-reload', info)
    await verifyDownload(restored, 'second-reimport-reload-download')
    await info.attach('restored-download-panel', { body: await restored.screenshot({ fullPage: true }), contentType: 'image/png' })
  } finally {
    await clean.close()
  }
  await info.attach('merged-roundtrip-evidence', {
    body: Buffer.from(JSON.stringify({ source: { bytes: original.length, sha256: sha256(original) }, copies: evidence }, null, 2)),
    contentType: 'application/json',
  })
})
