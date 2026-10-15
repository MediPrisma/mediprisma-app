import { test, expect } from '../fixtures/test'
import { importBundle, openChatInput, chatPanel, SYNTHETIC_BUNDLE } from '../fixtures/import'
import { mockAiStream, STREAM_PROBE_MARKER } from '../fixtures/mock-stream'
import { collectorEventV5Schema, collectorEventV6Schema } from '../../src/shared/contracts/collector-event'
import type { Page } from '@playwright/test'

// Real browser/app, synthetic chart and AI; collector HTTP is intercepted.
// This is not a claim that the hospital TLS/private-network path is validated.

type TestPermission = PermissionState | 'unsupported'
type PermissionTestWindow = Window & { __collectorPermission: TestPermission }

async function setUpPermission(page: Page, state: TestPermission) {
  await page.addInitScript((initialState) => {
    const testWindow = window as PermissionTestWindow
    testWindow.__collectorPermission = initialState
    const query = navigator.permissions.query.bind(navigator.permissions)
    navigator.permissions.query = async (descriptor: PermissionDescriptor) => {
      if (!['local-network', 'loopback-network', 'local-network-access'].includes(descriptor.name)) return query(descriptor)
      if (testWindow.__collectorPermission === 'unsupported') throw new TypeError('unsupported permission')
      return { get state() { return testWindow.__collectorPermission } } as PermissionStatus
    }
  }, state)
}

test('site gate and offline collector leave chat operational, with no clinical text in telemetry', async ({ page }) => {
  test.setTimeout(90_000)
  await setUpPermission(page, 'granted')
  const payloads: unknown[] = []
  let offline = false
  await page.route('**/collector/v1/events', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': 'http://localhost:3001',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
      } })
      return
    }
    payloads.push(route.request().postDataJSON())
    if (offline) await route.abort('connectionrefused')
    else await route.fulfill({ status: 201, contentType: 'application/json',
      headers: { 'access-control-allow-origin': 'http://localhost:3001' }, body: '{}' })
  })
  await mockAiStream(page, { model: 'gpt-5.4-nano', markdown: 'SYNTHETIC-COLLECTOR-ANSWER', delayMs: 2,
    replies: [
      { includes: 'OTHER-SITE', markdown: 'SYNTHETIC-OTHER-SITE-ANSWER' },
      { includes: 'SECOND-PRIVATE-PROMPT', markdown: 'SYNTHETIC-OFFLINE-ANSWER' },
    ],
  })
  await importBundle(page, { bundlePath: SYNTHETIC_BUNDLE })
  const textarea = await openChatInput(page)
  await page.waitForFunction(() => Boolean(window.mediprismaCollector))
  expect(await page.evaluate(() => window.mediprismaCollector!.status().enabled)).toBe(false)

  await page.evaluate(() => history.replaceState({}, '', '/?site=vghtpe'))
  expect(await page.evaluate(() => window.mediprismaCollector!.status().enabled)).toBe(true)
  await textarea.fill(`SYNTHETIC-PRIVATE-PROMPT ${STREAM_PROBE_MARKER}`)
  await page.getByRole('button', { name: '傳送', exact: true }).click()
  await expect(chatPanel(page).locator('.prose').last()).toContainText('SYNTHETIC-COLLECTOR-ANSWER', { timeout: 25_000 })
  await expect.poll(() => payloads.length).toBeGreaterThan(0)
  for (const payload of payloads) {
    expect(collectorEventV5Schema.safeParse(payload).success || collectorEventV6Schema.safeParse(payload).success).toBe(true)
    expect(JSON.stringify(payload)).not.toMatch(/SYNTHETIC-PRIVATE-PROMPT|SYNTHETIC-COLLECTOR-ANSWER|王小明|patientId|operationKey/)
  }

  offline = true
  const beforeOffline = payloads.length
  await textarea.fill(`SECOND-PRIVATE-PROMPT ${STREAM_PROBE_MARKER}`)
  await page.getByRole('button', { name: '傳送', exact: true }).click()
  await expect.poll(() => payloads.length).toBeGreaterThan(beforeOffline)
  await expect(chatPanel(page).locator('.prose').last()).toContainText('SYNTHETIC-OFFLINE-ANSWER')
  await expect(page.getByRole('button', { name: '傳送', exact: true })).toBeVisible()

  await page.evaluate(() => history.replaceState({}, '', '/?site=hmc'))
  const beforeOtherSite = payloads.length
  await textarea.fill(`OTHER-SITE ${STREAM_PROBE_MARKER}`)
  await page.getByRole('button', { name: '傳送', exact: true }).click()
  await expect(chatPanel(page).locator('.prose').last()).toContainText('SYNTHETIC-OTHER-SITE-ANSWER')
  await expect(page.getByRole('button', { name: '傳送', exact: true })).toBeVisible()
  expect(payloads.length).toBe(beforeOtherSite)
  expect(await page.evaluate(() => window.mediprismaCollector!.status().enabled)).toBe(false)
})

for (const permission of ['prompt', 'denied', 'unsupported'] as const) {
  test(`permission ${permission} sends no collector request, keeps chat working, and resumes after a grant`, async ({ page }) => {
    test.setTimeout(90_000)
    await setUpPermission(page, permission)
    const payloads: unknown[] = []
    const collectorRequests: string[] = []
    // Catch both events and accidental health/discovery probes, without ever
    // touching the real laptop collector. Permission states are test doubles.
    await page.route('http://127.0.0.1:8787/**', async (route) => {
      collectorRequests.push(route.request().url())
      if (route.request().method() !== 'OPTIONS') payloads.push(route.request().postDataJSON())
      await route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : 201,
        headers: { 'access-control-allow-origin': 'http://localhost:3001',
          'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' },
        body: '' })
    })
    await mockAiStream(page, { model: 'gpt-5.4-nano', markdown: 'SYNTHETIC-PERMISSION-ANSWER', delayMs: 2 })
    await importBundle(page, { bundlePath: SYNTHETIC_BUNDLE })
    const textarea = await openChatInput(page)
    await page.waitForFunction(() => Boolean(window.mediprismaCollector))
    await page.evaluate(() => history.replaceState({}, '', '/?site=vghtpe'))
    const before = await page.evaluate(() => window.mediprismaCollector!.status().dropped)
    await textarea.fill(`SYNTHETIC-PRIVATE-PROMPT ${STREAM_PROBE_MARKER}`)
    await page.getByRole('button', { name: '傳送', exact: true }).click()
    await expect(chatPanel(page).locator('.prose').last()).toContainText('SYNTHETIC-PERMISSION-ANSWER', { timeout: 25_000 })
    await expect.poll(() => page.evaluate(() => window.mediprismaCollector!.status().dropped)).toBeGreaterThan(before)
    await expect.poll(() => page.evaluate(() => window.mediprismaCollector!.status().in_flight)).toBe(0)
    expect(collectorRequests).toEqual([])
    expect(await page.evaluate(() => window.mediprismaCollector!.status().cooling_down)).toBe(false)

    // Simulate a later user/admin grant. No app enable switch or page reload.
    await page.evaluate(() => { (window as PermissionTestWindow).__collectorPermission = 'granted' })
    expect(collectorRequests).toEqual([]) // Granting permission does not replay old events.
    await textarea.fill(`SYNTHETIC-NEW-PROMPT ${STREAM_PROBE_MARKER}`)
    await page.getByRole('button', { name: '傳送', exact: true }).click()
    await expect.poll(() => payloads.length).toBeGreaterThan(0)
    await expect(chatPanel(page).locator('.prose').last()).toContainText('SYNTHETIC-PERMISSION-ANSWER')
    await expect(page.getByRole('button', { name: '傳送', exact: true })).toBeVisible()
    for (const payload of payloads) {
      expect(collectorEventV5Schema.safeParse(payload).success || collectorEventV6Schema.safeParse(payload).success).toBe(true)
      expect(JSON.stringify(payload)).not.toMatch(/SYNTHETIC-PRIVATE-PROMPT|SYNTHETIC-NEW-PROMPT|SYNTHETIC-PERMISSION-ANSWER|王小明/)
    }
  })
}
