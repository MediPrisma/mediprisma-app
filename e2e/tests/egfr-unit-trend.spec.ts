import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'
import { readFileSync, writeFileSync } from 'node:fs'

test('eGFR charts comparable values and keeps an unrecognized unit in history', async ({ page }, testInfo) => {
  const bundle = JSON.parse(readFileSync(SYNTHETIC_BUNDLE, 'utf8'))
  bundle.entry = bundle.entry.filter((entry: { resource: { resourceType: string } }) => entry.resource.resourceType === 'Patient')
  for (const [index, unit] of ['mL/min/1.73m2', 'mL/min/1.73m²', 'eGFR(MDRD)'].entries()) {
    bundle.entry.push({ resource: {
      resourceType: 'Observation', id: `synthetic-egfr-${index}`, status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { text: 'eGFR' }, subject: { reference: 'Patient/test-patient-1' },
      effectiveDateTime: `2026-01-0${index + 1}`, valueQuantity: { value: 70 - index * 5, unit },
    } })
  }
  const bundlePath = testInfo.outputPath('synthetic-egfr.json')
  writeFileSync(bundlePath, JSON.stringify(bundle))
  await importBundle(page, { bundlePath })
  await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
  await page.getByRole('button', { name: /^查看 eGFR 趨勢$/ }).click()
  const detail = page.getByTestId('cumulative-trend-detail')
  await expect(detail.getByRole('img', { name: /檢驗趨勢圖/ })).toBeVisible()
  await expect(detail.getByRole('status')).toContainText('1 筆 eGFR 結果的單位無法確認')
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const functionButton = page.getByRole('button', { name: '功能', exact: true })
    if (await functionButton.isVisible()) await functionButton.click()
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('status')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`egfr-${width}.png`) })
  }
  await expect(detail).toContainText('單位無法確認，未納入曲線')
  await expect(detail).toContainText('eGFR(MDRD)')
})
