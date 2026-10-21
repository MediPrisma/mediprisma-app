import fs from 'node:fs/promises'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel, openLeftTab, SYNTHETIC_BUNDLE } from '../fixtures/import'

test('original FHIR survives processing, reload and repeated local import', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  // Include material IPS does not export and an inline image the app externalizes.
  bundle.extension = [{ url: 'https://example.test/original', valueString: 'keep 原始內容' }]
  bundle.entry.push({ fullUrl: 'urn:uuid:original-binary', resource: {
    resourceType: 'Binary', id: 'original-binary', contentType: 'text/plain', data: 'b3JpZ2luYWw=',
  } })
  bundle.entry.push({ resource: {
    resourceType: 'DiagnosticReport', id: 'original-image', status: 'final',
    code: { text: 'Synthetic image' },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }],
    effectiveDateTime: new Date().toISOString(),
    subject: { reference: `Patient/${bundle.entry.find((entry: { resource: { resourceType: string } }) => entry.resource.resourceType === 'Patient').resource.id}` },
    presentedForm: [{ contentType: 'image/png', title: 'Original image', data:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
  } })
  const original = JSON.stringify(bundle, null, 2) + '\n'
  const source = testInfo.outputPath('source.json')
  await fs.writeFile(source, original)
  await importBundle(page, { bundlePath: source })

  const openDownloads = async () => {
    await openFeaturePanel(page)
    await page.getByRole('tab', { name: '複製', exact: true }).click()
    await page.getByRole('tab', { name: '下載檔案', exact: true }).click()
  }
  const downloadOriginal = async (filename: string) => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '下載原始 FHIR', exact: true }).click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/^FHIR_original_.*\.json$/)
    const saved = testInfo.outputPath(filename)
    await download.saveAs(saved)
    expect(await fs.readFile(saved, 'utf8')).toBe(original)
    return saved
  }

  await openDownloads()
  await expect(page.getByRole('button', { name: '下載原始 FHIR', exact: true })).toBeEnabled()
  const downloaded = await downloadOriginal('first-download.json')
  await page.reload()
  await openDownloads()
  await downloadOriginal('after-reload.json')

  // A demographic overlay updates the chart envelope, not the original source.
  await openLeftTab(page, /^病人資訊$/)
  await page.getByRole('button', { name: '補充資料', exact: true }).click()
  const profileDialog = page.getByRole('dialog', { name: '補充或更新病人基本資料' })
  await profileDialog.getByLabel('姓名', { exact: true }).fill('合成測試更新姓名')
  await profileDialog.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(profileDialog).not.toBeVisible()
  await page.reload()
  await openDownloads()
  await downloadOriginal('after-profile-edit.json')

  // A fresh tab must not inherit another tab's chart or original export.
  const otherTab = await page.context().newPage()
  await otherTab.goto('/')
  await expect(otherTab.getByTestId('welcome-demo-card')).toBeVisible()
  await otherTab.close()

  // Import the actual downloaded file through the production file input.
  await importBundle(page, { bundlePath: downloaded })
  await openDownloads()
  await downloadOriginal('second-download.json')
  await expect(page.getByText('王小明').first()).toBeAttached()
  const verifyImage = async () => {
    await openLeftTab(page, /^報告$/)
    await page.getByRole('tab').filter({ hasText: /^影像/ }).first().click()
    const imageRow = page.locator('[data-tour="report-tour-row"]').filter({ hasText: 'Synthetic image' })
    await imageRow.getByRole('button', { name: '查看影像', exact: true }).click()
    const image = page.getByRole('dialog').getByRole('img', { name: 'Original image', exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)
    expect(await image.evaluate(async (element: HTMLImageElement) => {
      const bytes = new Uint8Array(await (await fetch(element.src)).arrayBuffer())
      return btoa(String.fromCharCode(...bytes))
    })).toBe(bundle.entry.at(-1).resource.presentedForm[0].data)
    await page.keyboard.press('Escape')
  }
  await verifyImage()
  await openDownloads()
  await page.screenshot({ path: testInfo.outputPath('original-fhir-download.png'), fullPage: true })

  // Failure to persist the extra backup must never delete the chart's images.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'images' && String(key).endsWith(':original-fhir')) {
        throw new DOMException('Synthetic raw backup quota failure', 'QuotaExceededError')
      }
      return put.call(this, value, key)
    }
  })
  await importBundle(page, { bundlePath: source })
  await openDownloads()
  await downloadOriginal('quota-fallback.json')
  await page.reload()
  await openDownloads()
  await expect(page.getByRole('button', { name: '下載原始 FHIR', exact: true })).toBeDisabled()
  await expect(page.getByText(/目前沒有保留原始 FHIR 副本/)).toBeVisible()
  await verifyImage()
})
