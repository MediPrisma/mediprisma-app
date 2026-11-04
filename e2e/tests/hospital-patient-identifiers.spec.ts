import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixtures/test'
import { importBundle, openPatientTab } from '../fixtures/import'

test('hospital patient identifiers stay visible after real bundle import', async ({ page }, testInfo) => {
  const bundlePath = process.env.IDENTITY_BUNDLE || testInfo.outputPath('identity.json')
  if (!process.env.IDENTITY_BUNDLE) await fs.writeFile(bundlePath, JSON.stringify({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: {
    resourceType: 'Patient', id: 'synthetic-identity', name: [{ text: '測試甲' }], gender: 'male', birthDate: '1991-01-01',
    identifier: [
      { system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id', value: 'A123456789' },
      { system: 'urn:oid:his.patient.mrn', value: '7654321' },
    ],
  } }] }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importBundle(page, { bundlePath })
  await openPatientTab(page)
  if (process.env.IDENTITY_BEFORE !== '1') {
    await expect(page.getByText('A123456789', { exact: true })).toBeVisible()
    await expect(page.getByText('7654321', { exact: true })).toBeVisible()
  }
  if (process.env.IDENTITY_SHOTS) for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const patientTab = page.getByRole('tab', { name: /病人資訊/ })
    if (await patientTab.isVisible()) await patientTab.click()
    await page.screenshot({ path: path.join(process.env.IDENTITY_SHOTS, `${process.env.IDENTITY_LABEL || 'after'}-${width}.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
