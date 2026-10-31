import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'
import { readFileSync, writeFileSync } from 'node:fs'

test('eGFR charts its comparable group and retains a formula-labelled singleton', async ({ page }, testInfo) => {
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
  await expect(detail.getByRole('status')).toContainText('不跨組連線')
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const functionButton = page.getByRole('button', { name: '功能', exact: true })
    if (await functionButton.isVisible()) await functionButton.click()
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('status')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`egfr-${width}.png`) })
  }
  await expect(detail).toContainText('其他單位／檢體組，未納入目前曲線')
  await expect(detail).toContainText('eGFR(MDRD)')
  await detail.getByRole('combobox', { name: '繪圖單位／檢體' }).selectOption({ label: 'eGFR(MDRD) · 1 筆精確數值' })
  await expect(detail).toContainText('至少需要兩筆')
  await expect(detail.getByRole('img', { name: /檢驗趨勢圖/ })).toHaveCount(0)
})

test('non-eGFR unit groups switch chart, latest value and delta without losing history', async ({ page }, testInfo) => {
  const bundle = JSON.parse(readFileSync(SYNTHETIC_BUNDLE, 'utf8'))
  bundle.entry = bundle.entry.filter((entry: { resource: { resourceType: string } }) => entry.resource.resourceType === 'Patient')
  const results: Array<[number, string]> = [[1, 'mg/dL'], [1.2, 'mg/dL'], [90, 'µmol/L'], [95, 'µmol/L'], [3, 'source label']]
  results.forEach(([value, unit], index) => bundle.entry.push({ resource: {
    resourceType: 'Observation', id: `synthetic-creatinine-${index}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: 'Creatinine' }, subject: { reference: 'Patient/test-patient-1' },
    effectiveDateTime: `2026-01-0${index + 1}`, valueQuantity: { value, unit },
  } }))
  const bundlePath = testInfo.outputPath('synthetic-unit-groups.json')
  writeFileSync(bundlePath, JSON.stringify(bundle))
  await importBundle(page, { bundlePath })
  await page.getByRole('tab').filter({ hasText: '報告' }).first().click()
  await page.getByRole('button', { name: /^查看 (CREA|Creatinine) 趨勢$/ }).click()
  const detail = page.getByTestId('cumulative-trend-detail')
  const picker = detail.getByRole('combobox', { name: '繪圖單位／檢體' })
  await expect(detail.getByText('+5', { exact: true })).toBeVisible()
  await picker.selectOption({ label: 'mg/dL · 2 筆精確數值' })
  await expect(detail.getByText('+0.2', { exact: true })).toBeVisible()
  await expect(detail.getByRole('img', { name: /檢驗趨勢圖/ })).toBeVisible()
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const functionButton = page.getByRole('button', { name: '功能', exact: true })
    if (await functionButton.isVisible()) await functionButton.click()
    await expect(picker).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`unit-groups-${width}.png`) })
  }
  await picker.selectOption({ label: 'source label · 1 筆精確數值' })
  await expect(detail).toContainText('至少需要兩筆')
  await expect(detail.getByText('較前次', { exact: true })).toHaveCount(0)
  await expect(detail).toContainText('5 筆')
})
