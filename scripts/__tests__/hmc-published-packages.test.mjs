import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hmcPublishedBuildInfo } from '../hmc-published-packages.mjs'

const APP_SHA = 'a'.repeat(40)
const RULES_SHA = 'b'.repeat(40)
const versions = { 'personalization-sdk': '1.0.0', 'clinical-lab-normalization': '1.1.1', 'personalized-care': '2.20.0', 'personalized-care-fhir': '1.12.0' }
const packIds = ['heart-failure-cdss', 'hyperlipidemia-cdss', 'atrial-fibrillation-cdss', 'chronic-coronary-disease-cdss']

async function fixture(t, { installedCare = '2.20.0', declaredCare = '2.20.0', listedPacks = packIds, localeExport = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hmc-published-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = { optionalDependencies: {} }
  const lock = { packages: {} }
  for (const [suffix, version] of Object.entries(versions)) {
    const name = `@voho0000/${suffix}`
    manifest.optionalDependencies[name] = suffix === 'personalized-care' ? declaredCare : version
    lock.packages[`node_modules/${name}`] = { version, integrity: `sha512-${suffix}` }
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: suffix === 'personalized-care' ? installedCare : version, main: 'index.cjs' }))
    await writeFile(join(dir, 'index.cjs'), suffix === 'personalized-care'
      ? `module.exports = { ${localeExport ? 'setLocaleLayer() {},' : ''} CARE_PACKS: ${JSON.stringify(listedPacks.map(id => ({ id })))}, getEnabledKnowledgePacks: () => [{ metadata: () => ({ id: 'taiwan-nhi-lipid-2026' }) }] }`
      : 'module.exports = {}')
  }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock))
  return root
}

function metadataFetch({ corruptIntegrity = false, missingRevision = false } = {}) {
  return async (url, options) => {
    assert.equal(new URL(url).hostname, 'npm.pkg.github.com')
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    const name = decodeURIComponent(new URL(url).pathname.slice(1))
    const suffix = name.split('/')[1]
    const version = versions[suffix]
    return { ok: true, status: 200, json: async () => ({ versions: { [version]: {
      version, gitHead: missingRevision ? undefined : RULES_SHA,
      dist: { integrity: corruptIntegrity ? 'wrong' : `sha512-${suffix}` },
    } } }) }
  }
}

test('records exact installed releases and their source commits for the existing publisher', async t => {
  const root = await fixture(t)
  const info = await hmcPublishedBuildInfo(root, { appSha: APP_SHA, token: 'test-token', fetchMetadata: metadataFetch() })
  assert.equal(info.appSha, APP_SHA)
  assert.equal(info.rulesSource, 'published-packages')
  assert.equal(info.personalizationSha, RULES_SHA)
  assert.deepEqual(info.packageVersions, Object.fromEntries(Object.entries(versions).map(([name, version]) => [`@voho0000/${name}`, version])))
  assert.equal(info.packageRevisions['@voho0000/personalized-care-fhir'], RULES_SHA)
  assert.ok(!JSON.stringify(info).includes('test-token'))
})

for (const [name, options, message] of [
  ['stale installed overlay', { installedCare: '2.18.0' }, /installed version/],
  ['floating latest dependency', { declaredCare: 'latest' }, /exact released version/],
  ['missing CAD pack', { listedPacks: packIds.slice(0, 3) }, /missing chronic-coronary/],
  ['missing host API', { localeExport: false }, /setLocaleLayer/],
]) {
  test(`rejects ${name} before publishing`, async t => {
    const root = await fixture(t, options)
    await assert.rejects(hmcPublishedBuildInfo(root, { appSha: APP_SHA, token: 'test-token', fetchMetadata: metadataFetch() }), message)
  })
}

test('rejects release provenance that does not match the locked artifact', async t => {
  const root = await fixture(t)
  await assert.rejects(hmcPublishedBuildInfo(root, { appSha: APP_SHA, token: 'test-token', fetchMetadata: metadataFetch({ corruptIntegrity: true }) }), /release integrity/)
  await assert.rejects(hmcPublishedBuildInfo(root, { appSha: APP_SHA, token: 'test-token', fetchMetadata: metadataFetch({ missingRevision: true }) }), /source commit/)
})

test('fails clearly when the registry is unavailable', async t => {
  const root = await fixture(t)
  await assert.rejects(hmcPublishedBuildInfo(root, { appSha: APP_SHA, fetchMetadata: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
})
