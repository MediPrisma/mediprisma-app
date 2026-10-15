import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// A compiled Gateway checkout is required; every HTTP response is synthetic.
// No production host, authentication, database or clinical chart is contacted.
if (process.argv.length !== 3) throw new Error('Usage: node scripts/verify-collector-operation-ui.mjs <Gateway checkout>')
const { dashboardHtml, dashboardCss, dashboardJs } = await import(pathToFileURL(resolve(process.argv[2], 'dist/collector-dashboard.js')).href)
const screenshots = mkdtempSync(join(tmpdir(), 'collector-operation-ui-synthetic-'))
const event = { schema_version: 6, received_at: '2026-10-07T01:00:00Z', feature: 'summary', sample_kind: 'feature',
  latency_ms: 1000, status: 'completed', error_class: null, model: 'custom', app_version: '0.51.0',
  build_revision: 'abcdef12', browser_id: 'synthetic-browser', receipt: { source_ip: '192.0.2.10' },
  diagnostics: { loaded: { encounters: 23, medications: 47 }, requests: { count: 3, omitted: 1, details: [
    { model: 'custom', mode: 'stream', status: 'error', error_class: 'timeout', latency_ms: 500, response_complete: false },
    { model: 'custom', mode: 'stream', status: 'completed', error_class: null, latency_ms: 400, first_chunk_ms: 100, response_complete: true },
  ] } } }
let events = [event], failing = false
const errors = []
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/admin') return route.fulfill({ contentType: 'text/html', body: dashboardHtml })
    if (path === '/admin/dashboard.css') return route.fulfill({ contentType: 'text/css', body: dashboardCss })
    if (path === '/admin/dashboard.js') return route.fulfill({ contentType: 'application/javascript', body: dashboardJs })
    if (failing) return route.fulfill({ status: 503, body: '{}' })
    const summary = { today_count: events.length, day: '2026-10-07', last_received_at: event.received_at, retention_days: 0,
      sample: { rows: events.length, complete: true, feature: events.length, request: 0, legacy: 0, error: 0, aborted: 0, unreadable: 0 } }
    const health = { status: 'ok', persistence_failure_count: 0, protection: { rate: { rejected_requests: 0 },
      limits: { maxStorageBytes: 10737418240, minFreeBytes: 21474836480 },
      capacity: { status: 'ok', storage_bytes: 65536, free_bytes: 214748364800 } } }
    const value = path === '/admin/api/summary' ? summary : path === '/admin/api/storage-health' ? health : { events, unreadable_events: [] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
  })
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('http://collector-ui.synthetic.invalid/admin')
    await page.waitForFunction(() => document.querySelector('#today')?.textContent === '1')
    assert.equal(await page.locator('#events tr').count(), 1)
    const toggle = page.locator('summary')
    await toggle.focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('details')?.open)
    const details = await page.locator('details').innerText()
    assert.match(details, /timeout/)
    assert.match(details, /完成/)
    assert.match(details, /另 1 次/)
    assert.match(await page.locator('#events').innerText(), /就診：23/)
    assert.match(await page.locator('#events').innerText(), /用藥：47/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.ok((await toggle.boundingBox()).height >= 44)
    await page.screenshot({ path: join(screenshots, width + '.png'), fullPage: true })
  }
  await page.setViewportSize({ width: 844, height: 390 })
  await page.screenshot({ path: join(screenshots, 'landscape.png'), fullPage: true })
  // Historical unlinked rows stay separate even if timestamp/model match.
  const { requests: _requests, ...diagnostics } = event.diagnostics
  events = [{ ...event, schema_version: 5, diagnostics }, { ...event, schema_version: 5, sample_kind: 'request', diagnostics }]
  await page.getByRole('button', { name: '重新整理' }).click()
  await page.waitForFunction(() => document.querySelector('#today')?.textContent === '2')
  assert.equal(await page.locator('#events tr').count(), 2)
  assert.equal(await page.locator('details').count(), 0)
  events = [{ ...event, diagnostics: { ...event.diagnostics, requests: { count: 1, omitted: 0,
    details: [{ ...event.diagnostics.requests.details[0], model: '<img src=x onerror=alert(1)>', status: 'incomplete', response_complete: null }] } } }]
  await page.getByRole('button', { name: '重新整理' }).click()
  await page.waitForFunction(() => document.querySelector('#today')?.textContent === '1')
  assert.equal(await page.locator('#events img').count(), 0)
  assert.match(await page.locator('#events').textContent(), /終態未觀察到/)
  events = []
  await page.getByRole('button', { name: '重新整理' }).click()
  await page.waitForFunction(() => document.querySelector('#today')?.textContent === '0')
  assert.match(await page.locator('#events').innerText(), /尚無可讀紀錄/)
  failing = true
  await page.getByRole('button', { name: '重新整理' }).click()
  await page.waitForFunction(() => document.querySelector('#state')?.textContent === '狀態未知')
  assert.deepEqual(errors, [])
  console.log('Synthetic browser checks passed: one row, keyboard details, exact counts, legacy rows, literal text, empty/error, 6 widths and landscape. Screenshots: ' + screenshots)
} finally { await browser.close() }
