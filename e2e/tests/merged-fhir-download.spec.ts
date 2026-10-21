import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel, openLeftTab } from '../fixtures/import'
import { stubFirebaseAnonymousAuth } from '../fixtures/firebase-auth'
import { createMergedFhirFixture, type RawBundle, type SourceImage } from '../fixtures/merged-fhir'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const parse = (bytes: Buffer): RawBundle => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))

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

test('merged cloud and hospital originals and every embedded image survive download and clean-context reimport', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const { bundle, original, images } = createMergedFhirFixture()
  const source = info.outputPath('merged-source.json')
  await fs.writeFile(source, original)
  expect(original.length).toBeGreaterThan(4 * 1024 * 1024)
  expect(images).toHaveLength(4)
  expect(images.map(image => image.source)).toEqual(['cloud', 'cloud', 'hospital', 'hospital'])
  expect(new Set(images.map(image => image.data)).size).toBe(images.length)
  const evidence: Array<{ stage: string; bytes: number; sha256: string; cloudResources: number; hospitalResources: number; images: number }> = []
  const verifyDownload = async (target: Page, stage: string) => {
    await openDownloads(target)
    const button = target.getByRole('button', { name: '下載原始 FHIR', exact: true })
    await expect(button).toBeEnabled()
    const pending = target.waitForEvent('download')
    await button.click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/^FHIR_original_\d{8}\.json$/)
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
    const restored = await clean.newPage()
    await importBundle(restored, { bundlePath: downloaded })
    await expect(restored.getByText('整併測試病人').first()).toBeAttached()
    await verifyClinicalData(restored)
    await verifyImages(restored, images, 'clean-reimport', info)
    const secondDownload = await verifyDownload(restored, 'clean-reimport-download')
    await restored.reload()
    await verifyImages(restored, images, 'clean-reimport-reload', info)
    await verifyDownload(restored, 'clean-reimport-reload-download')
    // Repeat using an actual download from the new context, not the fixture.
    await importBundle(restored, { bundlePath: secondDownload })
    await verifyClinicalData(restored)
    await verifyImages(restored, images, 'second-reimport', info)
    await verifyDownload(restored, 'second-reimport-download')
    await info.attach('restored-download-panel', { body: await restored.screenshot({ fullPage: true }), contentType: 'image/png' })
  } finally {
    await clean.close()
  }
  await info.attach('merged-roundtrip-evidence', {
    body: Buffer.from(JSON.stringify({ source: { bytes: original.length, sha256: sha256(original) }, copies: evidence }, null, 2)),
    contentType: 'application/json',
  })
})
