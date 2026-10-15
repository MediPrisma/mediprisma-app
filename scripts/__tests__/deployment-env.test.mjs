import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkDeploymentEnv } from '../deployment-env.mjs'

const hospital = {
  MEDIPRISMA_DEPLOYMENT_PROFILE: 'hospital',
  NEXT_PUBLIC_CDSS_ADMISSION: 'firebase',
  NEXT_PUBLIC_CDSS_API_ORIGIN: 'https://fhir.hospital.test',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'synthetic-project',
}
const check = (extra = {}) => checkDeploymentEnv({ ...hospital, ...extra })

test('opt-in leaves local, OAuth and existing builds unrestricted', () => {
  for (const admission of ['', 'oauth2', 'intranet-pilot']) {
    assert.deepEqual(checkDeploymentEnv({ NEXT_PUBLIC_CDSS_ADMISSION: admission, NEXT_PUBLIC_CDSS_API_ORIGIN: 'http://127.0.0.1:8098' }),
      { enabled: false, errors: [], notes: [] })
  }
  assert.ok(check({ MEDIPRISMA_DEPLOYMENT_PROFILE: 'hosptial' }).errors.length)
})

test('FHIR-only and separately configured Collector/report services pass', () => {
  assert.deepEqual(check().errors, [])
  assert.deepEqual(check({ NEXT_PUBLIC_COLLECTOR_ORIGIN: 'https://collector.hospital.test:8787/',
    NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL: 'https://collector.hospital.test/collector/v1/lab-reports' }).errors, [])
})

test('unconfigured services are allowed and localhost fallback is explicit', () => {
  const result = checkDeploymentEnv({ MEDIPRISMA_DEPLOYMENT_PROFILE: 'hospital' })
  assert.deepEqual(result.errors, [])
  assert.match(result.notes.join('\n'), /blank does not disable/)
  assert.match(result.notes.join('\n'), /institution will not be contacted/)
  assert.deepEqual(check({ NEXT_PUBLIC_CDSS_ADMISSION: '', NEXT_PUBLIC_CDSS_API_ORIGIN: '',
    NEXT_PUBLIC_COLLECTOR_ORIGIN: 'https://collector.hospital.test' }).errors, [])
})

test('requires both explicit Firebase admission and FHIR origin when FHIR is configured', () => {
  for (const admission of ['', 'intranet-pilot', 'oauth2', 'Firebase', 'firebase ']) {
    assert.match(check({ NEXT_PUBLIC_CDSS_ADMISSION: admission }).errors.join('\n'), /explicitly be firebase/)
  }
  assert.match(check({ NEXT_PUBLIC_CDSS_API_ORIGIN: '' }).errors.join('\n'), /required when FHIR admission/)
})

for (const key of ['NEXT_PUBLIC_CDSS_API_ORIGIN', 'NEXT_PUBLIC_COLLECTOR_ORIGIN', 'NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL']) {
  test(`${key} rejects unsafe URL forms without printing values`, () => {
    for (const value of ['not-a-url', '//fhir.hospital.test', 'http://fhir.hospital.test',
      'https://secret-user:secret-password@fhir.hospital.test/receive', 'https://fhir.hospital.test?secret-token',
      'https://fhir.hospital.test#secret-token', 'https://fhir.hospital.test?', 'https://fhir.hospital.test#',
      ' https://fhir.hospital.test', 'https://fhir.hospital.test\\receive', 'https://local host/receive']) {
      const result = check({ [key]: value })
      assert.ok(result.errors.length, `${key}: ${value}`)
      assert.doesNotMatch(JSON.stringify(result), /secret-user|secret-password|secret-token/)
    }
  })
  test(`${key} rejects loopback, unspecified and placeholder destinations`, () => {
    for (const host of ['localhost', 'localhost.', 'api.localhost', '127.0.0.1', '127.1', '[::1]', '[::]', '[::ffff:127.0.0.1]', '[::ffff:0.0.0.0]', '0.0.0.0', 'example.com', 'host.example.org', 'host.invalid', 'host.invalid.']) {
      assert.ok(check({ [key]: `https://${host}/` }).errors.length, host)
    }
  })
}

test('origin fields reject endpoint paths; reports require their own endpoint', () => {
  for (const key of ['NEXT_PUBLIC_CDSS_API_ORIGIN', 'NEXT_PUBLIC_COLLECTOR_ORIGIN']) {
    assert.match(check({ [key]: 'https://services.hospital.test/collector/v1/events' }).errors.join('\n'), /origin only/)
  }
  for (const path of ['/', '/collector/v1/events', '/collector/v1/events/', '/cdss/v1/saves']) {
    assert.ok(check({ NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL: `https://services.hospital.test${path}` }).errors.length)
  }
})

test('permits IP SAN hosts, internal names, ports and verified shared-origin reverse proxies', () => {
  for (const origin of ['https://10.20.30.40', 'https://[fd00::123]:443', 'https://fhir-internal:9443', 'https://services.hospital.test']) {
    assert.deepEqual(check({ NEXT_PUBLIC_CDSS_API_ORIGIN: origin, NEXT_PUBLIC_COLLECTOR_ORIGIN: origin,
      NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL: `${origin}/custom/report-receiver` }).errors, [])
  }
})

test('Firebase project is required for configured services, but public Firebase config is allowed', () => {
  assert.ok(check({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: ' ' }).errors.length)
  assert.deepEqual(check({ NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic-public-config' }).errors, [])
  assert.ok(check({ NEXT_PUBLIC_FIREBASE_EMULATOR: '1' }).errors.length)
  assert.ok(check({ NEXT_PUBLIC_APPCHECK_DEBUG: 'synthetic-debug-value' }).errors.length)
})

test('private collaborator lists and credentials never belong in NEXT_PUBLIC variables', () => {
  for (const key of ['NEXT_PUBLIC_FHIR_FIREBASE_ALLOWED_UIDS', 'NEXT_PUBLIC_CDSS_COLLABORATOR_UIDS',
    'NEXT_PUBLIC_COLLECTOR_INGEST_TOKEN', 'NEXT_PUBLIC_FHIR_CLIENT_SECRET', 'NEXT_PUBLIC_FHIR_PRIVATE_KEY',
    'NEXT_PUBLIC_COLLECTOR_ADMIN_PASSWORD', 'NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON']) {
    const result = check({ [key]: 'synthetic-do-not-print' })
    assert.ok(result.errors.length, key)
    assert.doesNotMatch(JSON.stringify(result), /synthetic-do-not-print/)
  }
  assert.deepEqual(check({ FHIR_FIREBASE_ALLOWED_UIDS: 'synthetic-private-uid' }).errors, [])
})

test('hospital profile rejects likely misnamed service settings without exposing keys or values', () => {
  for (const key of ['NEXT_PUBLIC_INSTITUTION_LAB_REPORT_URL', 'NEXT_PUBLIC_COLLECTOR_URL',
    'NEXT_PUBLIC_COLLECTOR_API_ORIGIN', 'NEXT_PUBLIC_API_CDSS_ORIGIN', 'NEXT_PUBLIC_ADMISSION_CDSS']) {
    const result = check({ [key]: 'synthetic-secret-value' })
    assert.match(result.errors.join('\n'), /Unrecognized public service setting/)
    assert.ok(!JSON.stringify(result).includes(key))
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-value/)
    assert.deepEqual(checkDeploymentEnv({ [key]: 'anything' }).errors, [])
  }
  assert.deepEqual(check({ NEXT_PUBLIC_INSTITUTION_LAB_REPORT_URL: '',
    NEXT_PUBLIC_COLLECTOR_TIMEOUT_MS: '5000', NEXT_PUBLIC_LAB_DATA_REPORT_URL: 'https://team.hospital.test/submit' }).errors, [])
})

// Real @next/env, isolated env files and child processes. No network or services.
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'deployment-preflight-'))
  try {
    mkdirSync(join(dir, 'scripts'))
    for (const file of ['deployment-env.mjs', 'check-deployment-env.mjs', 'build-mediprisma.mjs']) {
      copyFileSync(resolve('scripts', file), join(dir, 'scripts', file))
    }
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'junction')
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith('NEXT_PUBLIC_') && !key.startsWith('MEDIPRISMA_') && key !== '__NEXT_PROCESSED_ENV'))
    env.NODE_ENV = 'production'
    const exec = (file = 'check-deployment-env.mjs', extra = {}) => spawnSync(process.execPath, [join(dir, 'scripts', file)],
      { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' })
    run({ dir, exec })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('CLI follows Next production env precedence and variable expansion', () => fixture(({ dir, exec }) => {
  writeFileSync(join(dir, '.env'), 'MEDIPRISMA_DEPLOYMENT_PROFILE=hospital\nNEXT_PUBLIC_FIREBASE_PROJECT_ID=synthetic-project\nNEXT_PUBLIC_CDSS_ADMISSION=firebase\nNEXT_PUBLIC_CDSS_API_ORIGIN=http://bad-host\n')
  writeFileSync(join(dir, '.env.production'), 'NEXT_PUBLIC_CDSS_API_ORIGIN=http://still-bad\n')
  writeFileSync(join(dir, '.env.local'), 'NEXT_PUBLIC_CDSS_API_ORIGIN=http://local-bad\n')
  writeFileSync(join(dir, '.env.production.local'), 'SYNTHETIC_HOST=fhir.hospital.test\nNEXT_PUBLIC_CDSS_API_ORIGIN=https://$SYNTHETIC_HOST\n')
  const good = exec()
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /syntax passed/)
  const bad = exec(undefined, { NEXT_PUBLIC_CDSS_API_ORIGIN: 'http://shell-wins' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /requires HTTPS/)
  assert.doesNotMatch(bad.stdout + bad.stderr, /shell-wins/)
}))

test('CLI with no profile is silent and does not restrict local test endpoints', () => fixture(({ dir, exec }) => {
  writeFileSync(join(dir, '.env.production.local'), 'NEXT_PUBLIC_CDSS_API_ORIGIN=http://127.0.0.1:8098\nNEXT_PUBLIC_CDSS_ADMISSION=intranet-pilot\n')
  const result = exec()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout + result.stderr, '')
}))

test('unreadable env file preserves opt-out behavior but fails an explicitly selected profile', (t) => fixture(({ dir, exec }) => {
  const envFile = join(dir, '.env')
  writeFileSync(envFile, 'SYNTHETIC_PRIVATE_VALUE=must-not-be-printed\n')
  chmodSync(envFile, 0)
  try {
    try {
      readFileSync(envFile)
      t.skip('This account/platform can still read mode-000 files; permission repro unavailable')
      return
    } catch { /* Permission failure is the condition under test. */ }
    const optOut = exec()
    assert.equal(optOut.status, 0, optOut.stderr)
    assert.equal(optOut.stdout + optOut.stderr, '')
    const optIn = exec(undefined, hospital)
    assert.equal(optIn.status, 1)
    assert.match(optIn.stderr, /Could not read a build env file/)
    assert.doesNotMatch(optIn.stdout + optIn.stderr, /must-not-be-printed|SYNTHETIC_PRIVATE_VALUE/)
  } finally { chmodSync(envFile, 0o600) }
}))

test('CLI rejects the documented institution URL word-order trap', () => fixture(({ exec }) => {
  const result = exec(undefined, { ...hospital, NEXT_PUBLIC_INSTITUTION_LAB_REPORT_URL: 'https://gw.hospital.test/collector/v1/lab-reports' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unrecognized public service setting/)
  assert.doesNotMatch(result.stdout, /syntax passed/)
}))

test('failed build preflight exits before moving API files or invoking Next', () => fixture(({ dir, exec }) => {
  mkdirSync(join(dir, 'app', 'api'), { recursive: true })
  writeFileSync(join(dir, 'app', 'api', 'sentinel'), 'unchanged')
  writeFileSync(join(dir, '.env.production.local'), 'MEDIPRISMA_DEPLOYMENT_PROFILE=hospital\nNEXT_PUBLIC_CDSS_ADMISSION=firebase\n')
  const result = exec('build-mediprisma.mjs')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /CDSS_API_ORIGIN is required/)
  assert.doesNotMatch(result.stdout, /stashing|building static export/)
  assert.equal(readFileSync(join(dir, 'app', 'api', 'sentinel'), 'utf8'), 'unchanged')
  assert.equal(existsSync(join(dir, '.api-stash-mediprisma-build')), false)
}))
