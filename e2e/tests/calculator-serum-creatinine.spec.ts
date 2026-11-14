import fs from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

// #487: a serum input never fills from a urine row. The serum creatinine has
// no specimen field (as the hospital delivers it) and a later urine
// creatinine is marked Urine; CrCl and eGFR must still take the serum value.
// Fictional data throughout.
const PATIENT = { reference: 'Patient/test-patient-1' }

const observation = (id: string, code: Record<string, unknown>, value: number, unit: string, at: string, extra: Record<string, unknown> = {}) => ({
  resourceType: 'Observation', id, status: 'final', subject: PATIENT,
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code, valueQuantity: { value, unit }, effectiveDateTime: at, ...extra,
})

async function creatinineBundle(outputPath: string) {
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  const resources = [
    observation('serum-cr', { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }], text: 'Creatinine' }, 1.1, 'mg/dL', '2026-10-23T08:00:00+08:00'),
    observation('urine-cr', { text: 'Creatinine' }, 85, 'mg/dL', '2026-10-23T08:30:00+08:00', { specimen: { display: 'Urine' } }),
    observation('weight', { coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }], text: 'Body weight' }, 70, 'kg', '2026-10-23T08:00:00+08:00',
      { category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }] }),
  ]
  bundle.entry.push(...resources.map((resource) => ({ resource })))
  await fs.writeFile(outputPath, JSON.stringify(bundle))
  return outputPath
}

async function openCalculator(page: Page, name: RegExp) {
  await page.getByPlaceholder('搜尋計算機 / 疾病…').fill(name.source.replace(/\\/g, ''))
  await page.getByRole('button', { name }).first().click()
}

test('CrCl and eGFR fill the serum creatinine, not a newer urine creatinine', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importBundle(page, { bundlePath: await creatinineBundle(testInfo.outputPath('bundle.json')) })
  await page.getByRole('tab', { name: '計算機' }).click()

  await openCalculator(page, /Cockcroft-Gault/)
  await expect(page.locator('#calc-scr')).toHaveValue('1.1', { timeout: 20_000 })
  await expect(page.locator('#calc-weight')).toHaveValue('70')

  await page.getByRole('button', { name: /返回|Back/ }).first().click()
  await openCalculator(page, /CKD-EPI 2021/)
  await expect(page.locator('#calc-scr')).toHaveValue('1.1', { timeout: 20_000 })
})
