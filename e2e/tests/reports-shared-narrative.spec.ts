import fs from 'node:fs/promises'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

const sharedText = 'DOPPLER & ECHOCARDIOGRAPHIC REPORT:\nSynthetic shared narrative.\nConclusion: Normal LV systolic function, EF = 65%.\nNo pericardial effusion.'
const clinicianTitle = 'Echocardiography (including Doppler)'

test('shared report retains both procedure sources and a single readable narrative', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  const procedures = [
    ['18005C', '超音波心臟圖(包括單面、雙面)'],
    ['18007C', '杜卜勒氏彩色心臟血流圖'],
  ]
  bundle.entry.push(...procedures.map(([code, display], index) => ({ resource: {
    resourceType: 'DiagnosticReport', id: `shared-echo-${index}`, status: 'final',
    code: { text: display, coding: [{ system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code, display }] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'CUS' }] }],
    subject: { reference: 'Patient/test-patient-1' },
    encounter: { reference: 'Encounter/enc-1' },
    effectiveDateTime: '2026-06-03T09:00:00+08:00',
    performer: [{ display: '台北測試醫院' }], conclusion: sharedText,
  } })))
  const fixturePath = testInfo.outputPath('synthetic-shared-reports.json')
  await fs.mkdir(testInfo.outputDir, { recursive: true })
  await fs.writeFile(fixturePath, JSON.stringify(bundle))
  await importBundle(page, { bundlePath: fixturePath })
  await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
  await page.getByRole('tab').filter({ hasText: /^全部/ }).first().click()
  const search = page.getByPlaceholder(/搜尋/)
  await search.fill('Synthetic shared narrative')

  await expect(page.getByText(clinicianTitle, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText(/顯示 1 \/ 共/)).toBeVisible()
  const row = page.locator('[data-tour="report-tour-row"]').filter({ visible: true })
  await expect(row).toHaveCount(1)
  const header = row.locator('[role="button"][aria-expanded]').first()
  const expandedBeforeCopy = await header.getAttribute('aria-expanded')
  await row.getByRole('button', { name: '複製報告標題', exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(clinicianTitle)
  await expect(header).toHaveAttribute('aria-expanded', expandedBeforeCopy!)
  if (expandedBeforeCopy !== 'true') await row.getByText(clinicianTitle, { exact: true }).click()
  await expect(row.getByRole('button', { name: '複製報告全文', exact: true })).toHaveCount(1)
  await expect(row.getByTestId('shared-report-summary')).toHaveCount(0)
  const sources = row.getByTestId('shared-report-sources')
  await sources.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(sources).toHaveAttribute('open', '')
  await expect(sources.getByRole('listitem')).toHaveCount(2)
  await expect(sources).toContainText('18005C')
  await expect(sources).toContainText('18007C')
  await expect(sources).toContainText('shared-echo-0')
  await expect(sources).toContainText('shared-echo-1')

  for (const query of ['18005C', '18007C', '杜卜勒氏彩色心臟血流圖']) {
    await search.fill(query)
    await expect(row).toHaveCount(1)
    await expect(page.getByText(/顯示 1 \/ 共/)).toBeVisible()
  }
  await search.fill('Synthetic shared narrative')
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect(sources.locator('summary')).toBeVisible()
    // Responsive hooks update after the viewport event, so check settled layout.
    await expect.poll(() => row.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath(`shared-report-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '使用身份' }).click()
  await page.getByRole('menuitem', { name: '民眾', exact: true }).click()
  const patientTitle = '心臟超音波（含杜卜勒血流）'
  await expect(row.getByText(patientTitle, { exact: true })).toBeVisible()
  await row.getByRole('button', { name: '複製報告標題', exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(patientTitle)
  await expect(row).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('shared-report-patient.png'), fullPage: true })
})
