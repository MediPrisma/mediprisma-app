import { readFileSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/test'
import { signInCdssAccount, stubCdssAccount } from '../fixtures/cdss-account'
import { importBundle, openFeaturePanel, SYNTHETIC_BUNDLE } from '../fixtures/import'

test.use({ initializeFirebaseFirestore: true })

async function turnOnBeta(page: Page) {
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: '設定', exact: true }).click()
  await page.getByRole('tab', { name: '顯示與關於', exact: true }).click()
  const beta = page.getByRole('switch', { name: '開啟 Beta 功能', exact: true })
  if (!(await beta.isChecked())) await beta.click()
  await page.getByRole('tab', { name: /個人化照護指引/ }).click()
}

async function openCdss(page: Page) {
  await page.goto('/?site=vghtpe&visit=book')
  await openFeaturePanel(page)
  if (!(await page.getByTestId('cdss-visit-book').isVisible())) await page.getByRole('tab', { name: /個人化照護指引/ }).click()
  await expect(page.getByTestId('cdss-save-record')).toBeVisible()
}

// Use a server built with NEXT_PUBLIC_CDSS_ADMISSION=firebase.
// Responses are intercepted locally; no FHIR server or real patient data is used.
test('the weight a saved CDSS record holds is brought in when the chart is opened again (#622)', async ({ page, context }, info) => {
  test.skip(process.env.NEXT_PUBLIC_CDSS_ADMISSION !== 'firebase', 'Requires the explicit Firebase admission test profile')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await stubCdssAccount(context)
  const fixture = JSON.parse(readFileSync(SYNTHETIC_BUNDLE, 'utf8'))
  const patient = fixture.entry.find((entry: { resource: { resourceType: string } }) => entry.resource.resourceType === 'Patient').resource
  patient.identifier = [{ system: 'https://synthetic.invalid/national-id', value: 'A123XXXXXX' }]
  const bundlePath = info.outputPath('synthetic-bundle.json')
  writeFileSync(bundlePath, JSON.stringify(fixture))
  await page.addInitScript(() => localStorage.setItem('medical-note-locale', 'zh-TW'))

  // What the store holds: nothing at first, then the record this chart saves.
  let saved: (Record<string, unknown> & { save_id: string; pack_id: string; saved_at: string; physician_inputs: Record<string, unknown>; result: Record<string, unknown> }) | undefined
  const index = () => ({ saveId: saved!.save_id, documentId: '1', patientId: '2', receivedAt: new Date().toISOString(), packId: saved!.pack_id, versionId: '1' })
  await page.route('**/cdss/v1/saves', async route => {
    saved = route.request().postDataJSON()
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'stored', save_id: saved!.save_id }) })
  })
  await page.route('**/cdss/v1/history', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ records: saved ? [index()] : [], hasMore: false }) }))
  await page.route('**/cdss/v1/history/read', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...index(), savedAt: saved!.saved_at, save: saved }) }))

  await page.goto('/')
  await signInCdssAccount(page)
  await importBundle(page, { bundlePath })
  await turnOnBeta(page)
  await openCdss(page)
  await page.getByTestId('cdss-save-record').click()
  await expect.poll(() => saved?.save_id).toBeTruthy()

  // The record as it would be had a weight been entered at that visit, 30 days ago, under earlier rules:
  // the rest of such a record is for viewing only, and its weight still comes in.
  const measuredOn = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  saved!.result = { ...saved!.result, packVersion: '0.0.0-earlier' }
  saved!.physician_inputs = { ...saved!.physician_inputs,
    clinicVitals: { entries: { bodyWeight: { value: 57, measuredOn, modifiedAt: `${measuredOn}T02:00:00.000Z` } }, signAnswers: {} } }

  // The next time the chart is opened.
  await openCdss(page)
  await expect(page.getByText(`已帶入上次儲存的體重 57 kg（${measuredOn} 量測）。`)).toBeVisible({ timeout: 30_000 })
})
