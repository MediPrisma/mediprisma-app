import fs from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

// A 北榮 in-house report and the copy 北榮 uploads to the NHI cloud are one
// report: #460 pairs cardiac reports by the request number the cloud copy
// quotes in its header, #462 pairs radiology titles the matcher used to give
// up on. Fictional data throughout.
const PATIENT = { reference: 'Patient/test-patient-1' }
const HOSPITAL_META = { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }
const CLOUD_META = { source: 'https://medcloud2.nhi.gov.tw/' }
const RAD = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]
const MARKER = 'Synthpair'

const hospitalCardiac = (id: string, title: string, requestNo: string, conclusion: string) => ({
  resourceType: 'DiagnosticReport', id, status: 'final', subject: PATIENT, meta: HOSPITAL_META,
  code: { text: title, coding: [{ system: 'urn:oid:his.report.code', code: title }] },
  identifier: [{ system: 'urn:oid:vgh.report.request', value: requestNo }],
  effectiveDateTime: '2026-05-07T09:48:00+08:00', performer: [{ display: 'DOC0001A 王測試' }], conclusion,
})

// The cloud copy quotes the request number in its header, with its own title, date and spacing.
const cloudCardiac = (id: string, title: string, code: string, requestNo: string, body: string) => ({
  resourceType: 'DiagnosticReport', id, status: 'final', subject: PATIENT, meta: CLOUD_META,
  code: { text: title, coding: [{ system: 'https://example.test/nhi-order', code }] },
  effectiveDateTime: '2026-05-15', performer: [{ display: '臺北榮總' }],
  conclusion: `正式報告\n\n 申請序號 / 工作號： ${requestNo}/ 開立時間： 2026/04/30 09:55\n\n 開醫囑者： DOC0001A 王測試\n\n ${body}`,
})

const RAD_BODY = `> ${MARKER} radiograph: no definite fracture line is noted in this fictional study.\n> Mild degenerative change, regular follow up is suggested.`
const hospitalRadiograph = (id: string, title: string, header: string) => ({
  resourceType: 'DiagnosticReport', id, status: 'final', subject: PATIENT, meta: HOSPITAL_META, category: RAD,
  code: { text: title, coding: [{ system: 'urn:oid:vgh.order', code: '15000000' }] },
  effectiveDateTime: '2026-06-24T10:00:00+08:00',
  conclusion: `${header}\n Date Of Examination:2026/06/24 10:00:00\n Date Of RCP:2026/06/24\n\n ${RAD_BODY}`,
})
const cloudRadiograph = (id: string, title: string, code: string) => ({
  resourceType: 'DiagnosticReport', id, status: 'final', subject: PATIENT, meta: CLOUD_META, category: RAD,
  code: { text: title, coding: [{ system: 'https://example.test/order', code, display: title }] },
  effectiveDateTime: '2026-06-24', performer: [{ display: '臺北榮總' }], conclusion: RAD_BODY,
})

async function pairingBundle(outputPath: string) {
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  const resources = [
    // #460: same request number → one row.
    hospitalCardiac('vgh-tmx', 'TREADMILL EXERCISE/GRADED EXERCI', 'TEST001',
      `3. STAGE:\nSPEED/GRADE(NPH/%)  MINUTES  BLOOD PRESSURE\n(1.7/10)  ( 3' 0'' )  ( 140 / 70 )\nCONCLUSION: ${MARKER} treadmill negative`),
    cloudCardiac('nhi-tmx', '運動心電圖 ;(Treadmill exercise test)', '18019C', 'TEST001',
      `SPEED/GRADE(NPH/%) MINUTES BLOOD PRESSURE (1.7/10) ( 3' 0'' ) ( 140 / 70 ) ${MARKER} treadmill`),
    // #460: different request numbers → two rows, however alike the text.
    hospitalCardiac('vgh-holter', "24HRS.HOLTER'S SCAN", 'TEST003', `*Basic rhythm:\n${MARKER} holter sinus rhythm.`),
    cloudCardiac('nhi-holter', "24小時連續性心電圖記錄檢查 ;(24hrs. Holter's scan)", '18008B', 'TEST999', `*Basic rhythm: ${MARKER} holter sinus rhythm.`),
    // #462: a 北榮 radiograph title with no modality pairs with its cloud copy.
    hospitalRadiograph('vgh-pelvis', 'PELVIS & RT HIP LAT-----THR', 'PELVIS & RT HIP LAT ----- THR'),
    cloudRadiograph('nhi-pelvis', '骨盆及髖關節檢查（包括各種角度與部位之檢查） ;(View of pelvis and hip joint (including each side))', '32023C'),
  ]
  bundle.entry.push(...resources.map((resource) => ({ resource })))
  await fs.writeFile(outputPath, JSON.stringify(bundle))
  return outputPath
}

function reportRows(page: Page) {
  return page.getByRole('tabpanel', { name: /^全部/ })
    .locator('[data-tour="report-tour-row"], [data-slot="accordion-item"]').filter({ visible: true })
}

async function sourcesOf(row: ReturnType<Page['locator']>) {
  const header = row.locator('[aria-expanded]').first()
  if (await header.getAttribute('aria-expanded') !== 'true') await header.press('Enter')
  const sources = row.getByTestId('shared-report-sources')
  await sources.locator('summary').click()
  return sources
}

test('a 北榮 report and its NHI cloud copy are one row when the request number matches, two when it does not', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importBundle(page, { bundlePath: await pairingBundle(testInfo.outputPath('bundle.json')) })
  await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
  await page.getByRole('tab').filter({ hasText: /^全部/ }).first().click()
  await page.getByPlaceholder(/搜尋/).fill(MARKER)

  const rows = reportRows(page)
  // Treadmill pair + pelvis pair + holter kept as two.
  await expect(rows).toHaveCount(4)

  // #460: one row under the in-house title, both sources kept.
  const treadmill = rows.filter({ hasText: /TREADMILL EXERCISE/ })
  await expect(treadmill).toHaveCount(1)
  // The cloud copy is not a row of its own.
  await expect(rows.filter({ hasText: '運動心電圖' })).toHaveCount(0)
  const treadmillSources = await sourcesOf(treadmill)
  await expect(treadmillSources.locator('li')).toHaveCount(2)
  await expect(treadmillSources).toContainText('TREADMILL EXERCISE/GRADED EXERCI')
  await expect(treadmillSources).toContainText('運動心電圖')

  // #460: a different request number stays apart.
  await expect(rows.filter({ hasText: /24HRS\.HOLTER'S SCAN/ })).toHaveCount(1)
  await expect(rows.filter({ hasText: '24小時連續性心電圖記錄檢查' })).toHaveCount(1)

  // #462: the radiograph pairs despite the title words the matcher once rejected.
  const pelvis = rows.filter({ hasText: 'PELVIS & RT HIP' })
  await expect(pelvis).toHaveCount(1)
  const pelvisSources = await sourcesOf(pelvis)
  await expect(pelvisSources.locator('li')).toHaveCount(2)
  await expect(pelvisSources).toContainText('骨盆及髖關節檢查')
})
