import path from 'node:path'
import fs from 'node:fs'
import { test, expect } from '../fixtures/test'
import { importBundle, openFeaturePanel, openLeftTab } from '../fixtures/import'

const bundlePath = path.join(__dirname, '../fixtures/hospital-cdss-bundle.json')

async function openCdss(page: import('@playwright/test').Page) {
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: '設定', exact: true }).click()
  await page.getByRole('tab', { name: '顯示與關於', exact: true }).click()
  const beta = page.getByRole('switch', { name: '開啟 Beta 功能', exact: true })
  if (!(await beta.isChecked())) await beta.click()
  await page.getByRole('tab', { name: /個人化照護指引/ }).click()
  await expect(page.getByTestId('cdss-disease-switch')).toBeVisible()
  await page.getByRole('button', { name: '三區塊', exact: true }).click()
}

async function openMedicationSafety(page: import('@playwright/test').Page) {
  await page.locator('summary').filter({ has: page.getByRole('heading', { name: /^治療/ }) }).click()
  await page.getByTestId('cdss-section-module-heart-failure-medication-safety').locator('summary').first().click()
}

test('hospital ingredients reach CDSS with provenance and unknown use instead of a false negative', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await importBundle(page, { bundlePath })
  await openCdss(page)
  await page.getByTestId('cdss-hospital-medication-review').click()
  const review = page.getByRole('dialog', { name: '院內用藥核對' })
  await expect(review).toContainText('3 筆院內處方，目前使用待確認')
  await expect(review.getByText('Diclofenac sodium', { exact: true })).toBeVisible()
  await expect(review.getByText('Furosemide', { exact: true })).toBeVisible()
  await expect(review.getByText('Unlisted tablet', { exact: true })).toBeVisible()
  await expect(review.getByRole('link', { name: '對照來源' })).toHaveAttribute('href', /licId=01044041/)
  await expect(review.getByTestId('cdss-hospital-medication-evidence')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await openMedicationSafety(page)
  const row = page.getByTestId('cdss-evidence-row-hf-harm:nsaid')
  await expect(row).toContainText('目前使用待確認：Diclofenac sodium')
  await expect(row).not.toContainText('目前處方未見')
  await expect(page.getByTestId('cdss-section-module-heart-failure-medication-safety')).toContainText('優先安全處理')
  await page.screenshot({ path: test.info().outputPath('hospital-cdss-pending.png') })
})

test('a confirmed medication statement activates the existing ingredient rule after re-import; pending sources reflow', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await importBundle(page, { bundlePath })
  await openCdss(page)
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  const resource = bundle.entry.find((entry: { resource: { id: string } }) => entry.resource.id === 'fictional-meitifen').resource
  resource.resourceType = 'MedicationStatement'
  resource.effectiveDateTime = '2026-09-30'
  delete resource.dispenseRequest
  delete resource.authoredOn
  await page.getByTestId('import-bundle-input').first().setInputFiles({ name: 'fictional-confirmed-medication.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) })
  await expect(page.getByRole('button', { name: '用藥核對 2 筆院內處方' })).toBeVisible()
  await openMedicationSafety(page)
  await expect(page.getByTestId('cdss-evidence-row-hf-harm:nsaid')).toContainText('Diclofenac sodium')
  await expect(page.getByTestId('cdss-evidence-row-hf-harm:nsaid')).not.toContainText('目前使用待確認')
  await expect(page.getByTestId('cdss-section-module-heart-failure-medication-safety')).toContainText('優先安全處理')
  const review = page.getByRole('dialog', { name: '院內用藥核對' })
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await openFeaturePanel(page)
    await page.getByRole('tab', { name: /個人化照護指引/ }).click()
    await page.getByTestId('cdss-hospital-medication-review').click()
    await expect(review).toBeVisible()
    expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`hospital-cdss-${width}.png`) })
    await page.keyboard.press('Escape')
  }
})

type SyntheticReviewResource = {
  resourceType: string
  id: string
  code?: { coding?: Array<{ code?: string }> }
  valueQuantity?: { value: number; unit?: string }
  [key: string]: unknown
}

function reviewScenario(kind: 'mra' | 'oac') {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as { entry: Array<{ resource: SyntheticReviewResource }> }
  bundle.entry = bundle.entry.filter(({ resource }) => resource.resourceType !== 'MedicationRequest' && resource.resourceType !== 'MedicationStatement')
  const patient = bundle.entry.find(({ resource }) => resource.resourceType === 'Patient')!.resource
  const subject = { reference: `Patient/${patient.id}` }
  if (kind === 'oac') {
    patient.birthDate = '1947-01-01'
    patient.gender = 'male'
    for (const code of ['I48.91', 'I10', 'E11.9']) bundle.entry.push({ resource: {
      resourceType: 'Condition', id: `fictional-review-${code}`, subject,
      clinicalStatus: { coding: [{ code: 'active' }] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
    } })
  }
  const potassium = bundle.entry.find(({ resource }) => resource.resourceType === 'Observation' && resource.code?.coding?.some(({ code }) => code === '2823-3'))!.resource
  potassium.valueQuantity!.value = kind === 'mra' ? 6.1 : 4.3
  const name = kind === 'mra' ? 'Spironolactone tab 25 mg' : 'Apixaban (Eliquis) FC tab 5 mg'
  bundle.entry.push({ resource: {
    resourceType: 'MedicationRequest', id: `fictional-review-${kind}`, subject,
    status: 'active', authoredOn: '2026-09-25',
    medicationCodeableConcept: { text: name, coding: [{ system: 'urn:oid:vgh.medication.generic', display: name }] },
    dosageInstruction: kind === 'oac' ? [{
      timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } },
      doseAndRate: [{ doseQuantity: { value: 5, unit: 'mg' } }],
    }] : [],
  } })
  return bundle
}

test('an unconfirmed hospital MRA prescription retains the severe-hyperkalemia safety card after re-import', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await importBundle(page, { bundlePath })
  await openCdss(page)
  await page.getByTestId('import-bundle-input').first().setInputFiles({
    name: 'fictional-mra-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(reviewScenario('mra'))),
  })
  await expect(page.getByRole('button', { name: '用藥核對 1 筆院內處方' })).toBeVisible()
  await page.locator('summary').filter({ has: page.getByRole('heading', { name: /^治療/ }) }).click()
  const safety = page.getByTestId('cdss-section-module-heart-failure-mra-safety')
  await expect(safety).toContainText('優先安全處理')
  await expect(safety).toContainText('暫停或減量 MRA')
  await expect(safety).toContainText('6.1 mmol/L')
  await safety.locator('summary').first().click()
  await expect(safety.getByText('院內處方：Spironolactone tab 25 mg；目前使用待確認', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 900 })
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: /個人化照護指引/ }).click()
  await expect(safety).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('hospital-mra-safety-390.png') })
})

test('a recent hospital apixaban order reaches AF reconciliation without an absent-anticoagulant conclusion', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T04:00:00Z'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await importBundle(page, { bundlePath })
  await openCdss(page)
  await page.getByTestId('import-bundle-input').first().setInputFiles({
    name: 'fictional-af-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(reviewScenario('oac'))),
  })
  await expect(page.getByRole('button', { name: '用藥核對 1 筆院內處方' })).toBeVisible()
  await page.getByTestId('cdss-disease-switch-atrial-fibrillation-cdss').click()
  await expect(page.getByTestId('cdss-af-visit-flow')).toBeVisible()
  await page.getByTestId('cdss-af-treatment').getByRole('button').first().click()
  const anticoagulation = page.getByTestId('cdss-af-action-af-anticoagulation-concordance')
  await expect(anticoagulation).toContainText('核對目前用藥')
  await expect(anticoagulation).not.toContainText('目前未使用口服抗凝')
  await anticoagulation.getByRole('button').first().click()
  const row = page.getByTestId('cdss-evidence-row-af-medication:oac')
  await expect(row).toContainText('目前使用待確認')
  await expect(row).toContainText('Apixaban')
  await expect(row).not.toContainText('未使用')
  await page.screenshot({ path: test.info().outputPath('hospital-af-oac-review.png') })
})

test('Conlifu copies without medication knowledge use a hospital row and a toolbar review with a named product',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await page.setViewportSize({width:1440,height:1000})
  await importBundle(page,{bundlePath:path.join(__dirname,'../fixtures/topical-source-comparison.json')})
  const panel=await openLeftTab(page,/^用藥$/)
  await expect(panel.locator('[data-medication-list-surface] li')).toHaveCount(1)
  await expect(panel.getByText('Conlifu * oint 2% 5 g',{exact:true})).toBeVisible()
  await panel.getByRole('button',{name:'院內：查看來源紀錄'}).click()
  const sources=page.getByRole('dialog',{name:'來源紀錄'})
  await expect(sources.getByText(/^CONLIFU OINTMENT 2[%％]$/)).toBeVisible()
  await page.keyboard.press('Escape')
  await openCdss(page)
  const feature=page.getByTestId('live-clinical-decision-support')
  const trigger=feature.locator('header').getByRole('button',{name:'用藥核對 1 筆院內處方'})
  await expect(trigger).toBeVisible()
  await expect(page.getByRole('dialog',{name:'院內用藥核對'})).not.toBeVisible()
  await trigger.click()
  const review=page.getByRole('dialog',{name:'院內用藥核對'})
  await expect(review.getByText('Conlifu * oint 2% 5 g',{exact:true})).toBeVisible()
  await expect(review.getByTestId('cdss-hospital-medication-evidence')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

