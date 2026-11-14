import fs from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { importBundle, SYNTHETIC_BUNDLE } from '../fixtures/import'

// 上次門診 with two physicians' visits and the reports that followed them.
// Covers #451 (physician filter, all physicians by default), #474 (orders with
// no report yet) and #485 (every physician's reports since the clinician's own
// last visit). Fictional data throughout.
const HOSPITAL_META = { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }
const PATIENT = { reference: 'Patient/test-patient-1' }
const OWN = '陳怡君'
const OTHER = '林志明'

const visit = (id: string, date: string, physician: string, department: string) => ({
  resourceType: 'Encounter', id, meta: HOSPITAL_META, status: 'finished',
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
  subject: PATIENT, period: { start: `${date}T09:00:00+08:00` },
  serviceType: { text: department }, participant: [{ individual: { display: physician } }],
  serviceProvider: { display: '臺北榮總' },
})

const lab = (id: string, loinc: string, text: string, value: number, unit: string, date: string, encounter: string) => ({
  resourceType: 'Observation', id, meta: HOSPITAL_META, status: 'final', subject: PATIENT,
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { coding: [{ system: 'http://loinc.org', code: loinc, display: text }], text },
  valueQuantity: { value, unit }, effectiveDateTime: `${date}T09:40:00+08:00`,
  encounter: { reference: `Encounter/${encounter}` },
})

// What the hospital bridge delivers for an order HIS has no request or report for yet.
const awaitingOrder = (id: string, text: string, encounter: string, appointment: boolean) => ({
  resourceType: 'ServiceRequest', id, status: 'active', intent: 'order', subject: PATIENT,
  meta: { tag: [...HOSPITAL_META.tag, { system: 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/order-report-state', code: 'awaiting-report' }] },
  code: { text }, encounter: { reference: `Encounter/${encounter}` },
  ...(appointment ? { orderDetail: [{ text: '頻次: APPOINT' }] } : {}),
})

// Newest first: another physician after the clinician's own last visit, the
// own last visit, another physician before it, an older own visit.
async function twoPhysicianBundle(outputPath: string) {
  const bundle = JSON.parse(await fs.readFile(SYNTHETIC_BUNDLE, 'utf8'))
  const resources = [
    visit('v-own-old', '2026-07-10', OWN, '心臟內科'),
    visit('v-other-before', '2026-08-20', OTHER, '腎臟科'),
    visit('v-own-last', '2026-09-05', OWN, '心臟內科'),
    visit('v-other-after', '2026-10-09', OTHER, '腎臟科'),
    lab('cr-old', '2160-0', 'Creatinine', 1.1, 'mg/dL', '2026-07-10', 'v-own-old'),
    lab('ferritin', '2276-4', 'Ferritin', 45, 'ng/mL', '2026-08-20', 'v-other-before'),
    lab('cr', '2160-0', 'Creatinine', 1.26, 'mg/dL', '2026-09-05', 'v-own-last'),
    lab('bnp', '33762-6', 'NT-proBNP', 612, 'pg/mL', '2026-10-09', 'v-other-after'),
    awaitingOrder('so-echo', 'Echocardiography', 'v-other-after', true),
  ]
  bundle.entry.push(...resources.map((resource) => ({ resource })))
  await fs.writeFile(outputPath, JSON.stringify(bundle))
  return outputPath
}

/** The clinician's own name, saved the way the settings picker saves it. */
async function presetClinicianName(page: Page, name: string) {
  await page.addInitScript((clinicianName) => {
    const prefs = { clinicianName }
    localStorage.setItem('mediprisma-outpatient-prefs', JSON.stringify({
      state: { byUser: { 'e2e-anonymous-uid': prefs, guest: prefs }, syncMeta: {} },
      version: 1,
    }))
  }, name)
}

async function openLastOutpatient(page: Page, bundlePath: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importBundle(page, { bundlePath })
  const tab = page.getByRole('tab', { name: '上次門診' })
  await expect(tab).toBeVisible({ timeout: 20_000 })
  await tab.click()
  const card = page.getByTestId('last-outpatient')
  await expect(card).toBeVisible({ timeout: 20_000 })
  return card
}

const row = (card: ReturnType<Page['getByTestId']>, text: string | RegExp) =>
  card.getByRole('table').getByRole('row').filter({ hasText: text })

test('every physician is listed by default, and picking one narrows the visits and their results together', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const card = await openLastOutpatient(page, await twoPhysicianBundle(testInfo.outputPath('bundle.json')))
  const visits = card.getByRole('group', { name: '院內門診' }).getByRole('button')
  const filter = card.getByRole('combobox', { name: '依醫師篩選門診' })

  // #451: all physicians, opened on the newest visit.
  await expect(filter).toContainText('全部醫師')
  await expect(visits).toHaveCount(4)
  await expect(visits.and(page.locator('[aria-pressed="true"]'))).toContainText('2026/10/09')
  await expect(row(card, 'NT-proBNP')).toContainText('612')

  // #474: an order written at that visit with no report yet is listed.
  const awaiting = card.getByTestId('last-outpatient-awaiting')
  await expect(awaiting).toContainText('已開立，尚無報告')
  await expect(awaiting.getByRole('listitem').filter({ hasText: 'Echocardiography' })).toContainText('已預約')

  // #451: one physician narrows the list and opens that list's newest visit.
  await filter.click()
  await page.getByRole('option', { name: new RegExp(OWN) }).click()
  await expect(filter).toContainText(OWN)
  await expect(visits).toHaveCount(2)
  await expect(visits.filter({ hasText: '2026/10/09' })).toHaveCount(0)
  await expect(visits.and(page.locator('[aria-pressed="true"]'))).toContainText('2026/09/05')
  await expect(row(card, 'CREA')).toContainText('1.26')
  await expect(row(card, 'NT-proBNP')).toHaveCount(0)
  await expect(awaiting).toHaveCount(0)

  await card.getByRole('button', { name: '清除醫師篩選' }).click()
  await expect(filter).toContainText('全部醫師')
  await expect(visits).toHaveCount(4)
})

test('with the clinician named, every physician’s results since their own last visit are gathered, none from before', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await presetClinicianName(page, OWN)
  const card = await openLastOutpatient(page, await twoPhysicianBundle(testInfo.outputPath('bundle.json')))
  const visits = card.getByRole('group', { name: '院內門診' }).getByRole('button')
  const scope = card.getByRole('group', { name: '顯示範圍' })

  // #485: opens on the own last visit, gathering it and every later visit.
  await expect(visits.and(page.locator('[aria-pressed="true"]'))).toContainText('2026/09/05')
  await expect(scope.getByRole('button', { name: '這次之後・全部' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByText('合併 2 次門診')).toBeVisible()
  await expect(row(card, 'CREA')).toContainText('1.26')
  await expect(row(card, 'NT-proBNP')).toContainText('612')
  // Another physician's result from before the own visit is not gathered.
  await expect(row(card, /ferritin/i)).toHaveCount(0)
  // The later visit's order with no report yet comes along, named by its visit.
  await expect(card.getByTestId('last-outpatient-awaiting').getByRole('listitem').filter({ hasText: 'Echocardiography' })).toContainText('10/09')

  // Only the clinician's own orders from that visit on.
  await scope.getByRole('button', { name: '這次之後・自己' }).click()
  await expect(row(card, 'CREA')).toContainText('1.26')
  await expect(row(card, 'NT-proBNP')).toHaveCount(0)

  // The other physician's earlier visit still opens on its own.
  await visits.filter({ hasText: '2026/08/20' }).click()
  await expect(row(card, /ferritin/i)).toContainText('45')
  await expect(row(card, 'CREA')).toHaveCount(0)
})
