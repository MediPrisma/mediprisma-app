import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, symlinkSync, lstatSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const wrapper = resolve('scripts/npm-with-github-packages.mjs')

test('all GitHub Packages dependencies are optional in both manifests', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
    assert.equal(pkg.dependencies[name], undefined)
    assert.equal(lock.packages[''].optionalDependencies[name], version)
    assert.equal(lock.packages[`node_modules/${name}`].optional, true)
  }
  assert.equal(Object.keys(pkg.optionalDependencies).length, 5)
})

test('missing GitHub CLI login does not block npm; supplied tokens bypass gh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optional-install-'))
  try {
    const npm = join(dir, 'npm')
    const gh = join(dir, 'gh')
    writeFileSync(npm, '#!/bin/sh\n[ "$NODE_AUTH_TOKEN" = "test-only-token" ] && exit 7\nexit 0\n')
    writeFileSync(gh, '#!/bin/sh\nexit 1\n')
    chmodSync(npm, 0o755)
    chmodSync(gh, 0o755)
    const env = { ...process.env, PATH: dir, NODE_AUTH_TOKEN: '' }
    const publicInstall = spawnSync(process.execPath, [wrapper, 'ci'], { env, encoding: 'utf8' })
    assert.equal(publicInstall.status, 0, publicInstall.stderr)
    assert.match(publicInstall.stdout, /Installing public dependencies/)
    const withToken = spawnSync(process.execPath, [wrapper, 'ci'], {
      env: { ...env, NODE_AUTH_TOKEN: 'test-only-token' }, encoding: 'utf8',
    })
    assert.equal(withToken.status, 7)
    assert.doesNotMatch(withToken.stdout + withToken.stderr, /test-only-token/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('availability checks entrypoints and transitive requirements', async () => {
  const { detectOptionalPackages } = await import('../optional-package-state.mjs')
  const root = process.cwd()
  const none = () => { throw new Error('unavailable') }
  assert.deepEqual(detectOptionalPackages(root, none), { labs: false, care: false, education: false, fhir: false })
  const all = (entry) => entry
  assert.deepEqual(detectOptionalPackages(root, all), { labs: true, care: true, education: true, fhir: true })
  const withoutCare = (entry) => {
    if (entry.startsWith('@voho0000/personalized-care')) throw new Error('unavailable')
    return entry
  }
  assert.deepEqual(detectOptionalPackages(root, withoutCare), { labs: true, care: false, education: true, fhir: false })
  const withoutLabExport = (entry) => {
    if (entry.endsWith('/interpretation')) throw new Error('incomplete package')
    return entry
  }
  assert.deepEqual(detectOptionalPackages(root, withoutLabExport), { labs: false, care: false, education: false, fhir: false })
})

test('full builds use the real modules; absent CDSS and SDK are independent', async () => {
  const { optionalBuildConfig } = await import('../optional-build-config.mjs')
  const all = { labs: true, care: true, education: true, fhir: true }
  const complete = optionalBuildConfig(process.cwd(), { state: all, sdkImport: true })
  assert.deepEqual(complete.aliases, {})
  assert.equal(complete.env.NEXT_PUBLIC_CDSS_AVAILABLE, 'true')
  assert.equal(complete.env.NEXT_PUBLIC_SDK_IMPORT_AVAILABLE, 'true')
  const noCdss = optionalBuildConfig(process.cwd(), { state: { ...all, care: false, fhir: false }, sdkImport: true })
  assert.equal(noCdss.env.NEXT_PUBLIC_CDSS_AVAILABLE, 'false')
  assert.equal(noCdss.env.NEXT_PUBLIC_SDK_IMPORT_AVAILABLE, 'true')
  assert.equal(noCdss.aliases['@/features/personalized-education/LiveFeature'], undefined)
  assert.equal(noCdss.aliases['@voho0000/clinical-lab-normalization/canonical'], undefined)
  const noSdk = optionalBuildConfig(process.cwd(), { state: all, sdkImport: false })
  assert.equal(noSdk.env.NEXT_PUBLIC_CDSS_AVAILABLE, 'true')
  assert.equal(noSdk.env.NEXT_PUBLIC_SDK_IMPORT_AVAILABLE, 'false')
  assert.equal(noSdk.aliases['@/vendor/nhi-fhir-bridge-sdk-json/browser.js'], './src/optional/sdk-json.ts')
})

test('generated type config replaces a symlink without modifying its target', { skip: process.platform === 'win32' }, async () => {
  const { optionalBuildConfig, writeOptionalBuildTsconfig } = await import('../optional-build-config.mjs')
  const root = mkdtempSync(join(tmpdir(), 'optional-tsconfig-'))
  try {
    writeFileSync(join(root, 'tsconfig.build.json'), JSON.stringify({ exclude: ['node_modules'] }))
    const protectedFile = join(root, 'keep.txt')
    writeFileSync(protectedFile, 'keep this content')
    const target = join(root, 'tsconfig.optional.generated.json')
    symlinkSync(protectedFile, target)
    const config = optionalBuildConfig(root, {
      state: { labs: false, care: false, education: false, fhir: false }, sdkImport: false,
    })
    assert.equal(writeOptionalBuildTsconfig(root, config), 'tsconfig.optional.generated.json')
    assert.equal(readFileSync(protectedFile, 'utf8'), 'keep this content')
    const generated = JSON.parse(readFileSync(target, 'utf8'))
    assert.equal(lstatSync(target).isSymbolicLink(), false)
    assert.deepEqual(generated.compilerOptions.paths['@/vendor/nhi-fhir-bridge-sdk-json/browser.js'], ['./src/optional/sdk-json.ts'])
    assert.equal(readdirSync(root).some(name => name.endsWith('.tmp')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
