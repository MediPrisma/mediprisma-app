import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'
import { NHI_VIEWER_REQUEST_EXTENSION_URL } from '../../features/clinical-summary/reports/utils/nhi-viewer-request'

const before = process.env.IMAGING_BEFORE === '1'
const marker = 'Synthetic imaging comparison'
const cases = [
  ['SONOGRAM- BREAST', '乳房超音波', '19014C', `BI-RADS category 2. ${marker}: Simple bilateral breast cysts with no suspicious solid mass or architectural distortion. Annual imaging follow-up is recommended.`],
  ['SONO- HEPATOBILIARY SYSTEM', 'Ultrasonography, other', '19005C', `${marker}: Mild liver steatosis. A 3 mm gallbladder polyp is unchanged. No biliary dilatation or ascites. The visualized pancreas and spleen are unremarkable.`],
  ['CHEST AP VIEW', '胸腔檢查 (Chest view)', '32001C', `${marker}: Central line tip projects over the superior vena cava. Heart size is normal. No focal consolidation, pneumothorax or pleural effusion. Bones show no acute change.`],
  ['CT/SCAN- CHEST', '電腦斷層造影－有造影劑 (Computed tomography)', '33072B', `${marker}: A 4 mm left upper lobe nodule is unchanged. No enlarged mediastinal lymph node or pleural effusion. Repeat imaging in twelve months is recommended.`],
]
const url = 'https://medvpnimg.nhi.gov.tw/ZFP?synthetic=1'

test('imaging copies retain all sources and open the correct NHI viewer', async ({ page, context }, testInfo) => {
  test.setTimeout(180_000)
  await context.route('https://medvpnimg.nhi.gov.tw/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic NHI viewer</h1>' }))
  await page.addInitScript((viewerUrl) => {
    const target = window as Window & { __viewerRequests: any[] }
    target.__viewerRequests = []
    window.addEventListener('message', event => {
      if (event.source !== window || event.data?.type !== 'MEDIPRISMA_NHI_VIEWER_OPEN_REQUEST') return
      target.__viewerRequests.push(event.data)
      window.open(viewerUrl, '_blank')
      window.postMessage({ source: 'medcloud2-extension', type: 'MEDIPRISMA_NHI_VIEWER_OPEN_RESULT', version: 1, requestId: event.data.requestId, ok: true }, window.location.origin)
    })
  }, url)
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  // Keep the established patient/encounters, replacing reports with synthetic comparisons.
  bundle.entry = bundle.entry.filter((entry: any) => !['DiagnosticReport', 'Observation', 'ImagingStudy'].includes(entry.resource?.resourceType))
  for (const [index, [hospitalTitle, cloudTitle, code, body]] of cases.entries()) {
    const common = { resourceType: 'DiagnosticReport', status: 'final', subject: { reference: 'Patient/test-patient-1' }, effectiveDateTime: '2026-06-24', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }] }
    const header = index === 1 ? 'SONOGRAM, HEPATOBILIARY SYSTEM Date Of Examination:2026/06/24 14:13:10 Date Of RCP:2026/06/24 ' : index === 2 ? 'CHEST AP VIEW Date Of Examination:2026/06/24 11:29:54 Date Of RCP:2026/06/24 ' : ''
    const footer = index === 0 ? ' Reported By Example(License #:TEST) On:2026/06/25(10:30:00),(by Example)At:TEST01ACR BI-RADS 2' : index === 3 ? ' Reported By Example(LicenseRD#:TEST) On:2026/06/24(16:00:00),(by Example)At:TEST01Positive Rate Evaluation 2' : ''
    bundle.entry.push({ resource: { ...common, id: `hospital-imaging-${index}`, meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }, code: { text: hospitalTitle }, performer: [{ display: 'DOC00000 Example' }], conclusion: header + body + footer } })
    bundle.entry.push({ resource: { ...common, id: `cloud-imaging-${index}`, meta: { source: 'https://medcloud2.nhi.gov.tw/' }, code: { text: cloudTitle, coding: [{ system: 'https://example.test/order', code }] }, performer: [{ display: '臺北榮總' }], conclusion: body,
      extension: [{ url: NHI_VIEWER_REQUEST_EXTENSION_URL, extension: [
        { url: 'version', valueInteger: 1 }, { url: 'proc-id', valueCode: 'IMUE0130' }, { url: 'patient-context-hash', valueString: 'b'.repeat(64) }, { url: 'ipl-case-seq-no', valueString: `SYNTHETIC-${index}` },
      ] }],
    } })
  }
  const fixture = testInfo.outputPath('synthetic-imaging.json')
  await fs.mkdir(testInfo.outputDir, { recursive: true })
  await fs.writeFile(fixture, JSON.stringify(bundle))
  await importBundle(page, { bundlePath: fixture })
  await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
  await page.getByRole('tab').filter({ hasText: /^全部/ }).first().click()
  await page.getByPlaceholder(/搜尋/).fill(marker)
  const rows = page.locator('[data-tour="report-tour-row"]').filter({ visible: true })
  await expect(rows).toHaveCount(before ? 8 : 4)
  // Capture the same explicit state on both revisions, independently of the
  // app's responsive/default expansion preferences.
  for (const header of await rows.locator('[role="button"][aria-expanded]').all()) {
    if (await header.getAttribute('aria-expanded') === 'true') await header.press('Enter')
  }
  const output = process.env.IMAGING_EVIDENCE_DIR || testInfo.outputDir
  await fs.mkdir(output, { recursive: true })
  for (const width of [1440, 1024, 768, 430, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if (!before) {
      const source = rows.first().locator('[aria-label^="臺北榮總"]').first()
      const date = await rows.first().getByText('2026/6/24', { exact: true }).first().boundingBox()
      const textRight = await source.locator('span').evaluateAll(spans => Math.max(...spans.map(span => {
        const rect = span.getBoundingClientRect()
        return rect.width ? rect.right : 0
      })))
      expect(date).not.toBeNull()
      expect(textRight).toBeLessThanOrEqual(date!.x + 1)
    }
    await page.screenshot({ path: path.join(output, `${before ? 'before' : 'after'}-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  if (!before) {
    const first = rows.filter({ hasText: 'SONOGRAM- BREAST' })
    const header = first.locator('[role="button"][aria-expanded]').first()
    if (await header.getAttribute('aria-expanded') !== 'true') await header.press('Enter')
    const sources = first.getByTestId('shared-report-sources')
    await sources.locator('summary').click()
    await expect(sources).toContainText('hospital-imaging-0')
    await expect(sources).toContainText('cloud-imaging-0')
    await expect(sources).toContainText('Reported By Example')
    await page.screenshot({ path: path.join(output, 'after-sources.png'), fullPage: true })
    const popupPromise = context.waitForEvent('page')
    await first.getByRole('button', { name: /開啟.*健保影像|DICOM Viewer/ }).first().click()
    const popup = await popupPromise
    await expect(popup.getByRole('heading', { name: 'Synthetic NHI viewer' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__viewerRequests.length)).toBe(1)
    const request = await page.evaluate(() => (window as any).__viewerRequests[0])
    expect(request.descriptor.iplCaseSeqNo).toBe('SYNTHETIC-0')
    expect(request.patientContextHash).toBe('b'.repeat(64))
    await fs.writeFile(path.join(output, 'viewer-result.json'), JSON.stringify({ request, popupUrl: popup.url(), simulatedBridge: true }, null, 2))
    await popup.screenshot({ path: path.join(output, 'after-viewer.png') })
  }
})
