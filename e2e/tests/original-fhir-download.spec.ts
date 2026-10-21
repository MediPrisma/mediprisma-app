import fs from 'node:fs/promises'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

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
    code: { text: 'Synthetic image' }, subject: { reference: 'Patient/patient-synthetic-001' },
    presentedForm: [{ contentType: 'image/png', title: 'Original image', data:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
  } })
  const original = JSON.stringify(bundle, null, 2) + '\n'
  const source = testInfo.outputPath('source.json')
  await fs.writeFile(source, original)
  await importBundle(page, { bundlePath: source })

  const openDownloads = async () => {
    // On phones the feature switcher exposes the right-hand panel first.
    const featureSwitcher = page.getByRole('button', { name: /^功能$/ })
    if (await featureSwitcher.isVisible()) await featureSwitcher.click()
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
  await page.screenshot({ path: testInfo.outputPath('original-fhir-download.png'), fullPage: true })
})
