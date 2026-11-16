import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dateVersion, resolveAppVersion, writeVersionFile } from '../app-version.mjs'

const epoch = iso => Date.parse(iso) / 1000
const collectorFormat = /^\d+\.\d+\.\d+$/

test('uses the Taipei calendar date of the commit', () => {
  assert.equal(dateVersion(epoch('2026-11-11T03:00:00Z')), '2026.11.11')
  // 16:30 UTC is already the next day in Taipei.
  assert.equal(dateVersion(epoch('2026-11-04T16:30:00Z')), '2026.11.5')
  assert.equal(dateVersion(epoch('2026-12-31T16:00:00Z')), '2027.1.1')
})

test('fits the Collector app_version format, without leading zeros', () => {
  const version = dateVersion(epoch('2027-01-05T03:00:00Z'))
  assert.equal(version, '2027.1.5')
  assert.match(version, collectorFormat)
})

test('falls back to package.json when there is no commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'app-version-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.51.1' }))
    assert.equal(resolveAppVersion(root, null), '0.51.1')
    assert.equal(resolveAppVersion(root, epoch('2026-11-11T03:00:00Z')), '2026.11.11')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writes public/version.json for the running app', () => {
  const root = mkdtempSync(join(tmpdir(), 'app-version-'))
  try {
    mkdirSync(join(root, 'public'))
    writeVersionFile(root, '2026.11.11')
    writeVersionFile(root, '2026.11.11')
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'public', 'version.json'), 'utf8')), { version: '2026.11.11' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
