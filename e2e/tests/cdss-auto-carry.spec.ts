import { readFileSync, writeFileSync } from 'node:fs'
import { test, expect } from '../fixtures/test'
import { signInCdssAccount, stubCdssAccount } from '../fixtures/cdss-account'
import { importBundle, openFeaturePanel, SYNTHETIC_BUNDLE } from '../fixtures/import'

test.use({ initializeFirebaseFirestore: true })

// Use a server built with NEXT_PUBLIC_CDSS_ADMISSION=firebase.
// Responses are intercepted locally; no FHIR server or real patient data is used.
test('opening the guidance brings in the last saved record by itself and says so', async ({ page, context }, info) => {
  test.skip(process.env.NEXT_PUBLIC_CDSS_ADMISSION !== 'firebase', 'Requires the explicit Firebase admission test profile')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await stubCdssAccount(context)
  const fixture = JSON.parse(readFileSync(SYNTHETIC_BUNDLE, 'utf8'))
  const patient = fixture.entry.find((entry: { resource: { resourceType: string } }) => entry.resource.resourceType === 'Patient').resource
  patient.identifier = [{ system: 'https://synthetic.invalid/national-id', value: 'A123XXXXXX' }]
  const bundlePath = info.outputPath('synthetic-bundle.json')
  writeFileSync(bundlePath, JSON.stringify(fixture))
  await page.addInitScript(() => localStorage.setItem('medical-note-locale', 'zh-TW'))

  // The saved record, handed back as the server would: exactly what the screen saved.
  let saved: (Record<string, unknown> & { save_id: string; saved_at: string; pack_id: string }) | null = null
  let reads = 0
  await page.route('**/cdss/v1/saves', async route => {
    const body = route.request().postDataJSON()
    saved = body
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'stored', save_id: body.save_id }) })
  })
  const row = () => ({ saveId: saved!.save_id, documentId: '1', patientId: '2', receivedAt: new Date().toISOString(), packId: saved!.pack_id, versionId: '1' })
  await page.route('**/cdss/v1/history', async route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ records: saved ? [row()] : [], hasMore: false }) }))
  await page.route('**/cdss/v1/history/read', async route => { reads += 1; await route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...row(), savedAt: saved!.saved_at, save: saved }) }) })

  await page.goto('/')
  await signInCdssAccount(page)
  await importBundle(page, { bundlePath })
  await openFeaturePanel(page)
  await page.getByRole('tab', { name: '設定', exact: true }).click()
  await page.getByRole('tab', { name: '顯示與關於', exact: true }).click()
  const beta = page.getByRole('switch', { name: '開啟 Beta 功能', exact: true })
  if (!(await beta.isChecked())) await beta.click()
  const open = async () => {
    await page.goto('/?site=vghtpe&visit=book')
    await openFeaturePanel(page)
    if (!(await page.getByTestId('cdss-visit-book').isVisible())) await page.getByRole('tab', { name: /個人化照護指引/ }).click()
    await expect(page.getByTestId('cdss-visit-book')).toBeVisible()
  }
  await open()
  // No record yet: nothing is brought in and nothing is announced.
  await expect(page.getByTestId('cdss-save-record')).toBeEnabled()
  await expect(page.getByTestId('cdss-carried-notice')).toHaveCount(0)
  // This visit's answers: the type, and the NYHA grade.
  const grades = page.getByRole('group', { name: 'NYHA 分級' })
  const nyha = grades.locator('xpath=../..')
  const gradeTwo = grades.getByRole('button', { name: /^II /, exact: false })
  await page.getByRole('button', { name: 'HFrEF', exact: true }).first().click()
  await gradeTwo.click()
  // Examination findings: leg oedema present, no rales.
  const sign = (name: string) => page.getByRole('group', { name: new RegExp(`^${name}`) })
  await sign('下肢水腫').getByRole('button', { name: '有', exact: true }).click()
  await sign('肺部囉音').getByRole('button', { name: '無', exact: true }).click()
  await expect(gradeTwo).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('cdss-save-record').click()
  await expect(page.getByText('CDSS 紀錄已儲存。')).toBeVisible()
  expect(reads).toBe(0)

  // The next visit: this browser no longer holds the answers, only the saved record does.
  await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('cdss-')).forEach(key => localStorage.removeItem(key)))
  await open()
  await expect(page.getByText(/已自動帶入您 .* 儲存的紀錄，共 \d+ 項。/)).toBeVisible()
  await expect(page.getByText('帶入的答案都標示「帶入 · 日期」，請核對；不適用的可直接改答。')).toBeVisible()
  await expect(page.getByTestId('cdss-carried-notice')).toContainText('已自動帶入')
  expect(reads).toBe(1)
  await page.waitForTimeout(800) // the announcement has finished sliding in
  await page.screenshot({ path: info.outputPath('auto-carried.png') })
  // The announcement leaves by itself; what stays is the note beside the records button.
  await expect(page.getByText(/已自動帶入您 .* 儲存的紀錄/)).toBeHidden({ timeout: 20_000 })
  await expect(page.getByTestId('cdss-carried-notice')).toHaveText(/已自動帶入 .* 紀錄，請核對/)
  await page.screenshot({ path: info.outputPath('auto-carried-notice.png') })
  // The answers are chosen again, each saying which record it came from.
  await expect(gradeTwo).toHaveAttribute('aria-pressed', 'true')
  await expect(nyha.locator('[data-carried-from]')).toHaveText(/^帶入 · \d{2}\/\d{2}$/)
  await expect(sign('下肢水腫').getByRole('button', { name: '有', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sign('肺部囉音').getByRole('button', { name: '無', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(sign('下肢水腫')).toHaveAccessibleName(/帶入 · \d{2}\/\d{2}$/)
  await nyha.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('auto-carried-answers.png') })

  // The same record is not brought in twice in this tab.
  await open()
  await expect(page.getByTestId('cdss-save-record')).toBeEnabled()
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('cdss-carried-notice')).toHaveCount(0)
  expect(reads).toBe(1)
})
