import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_PACKAGES = ['personalization-sdk', 'clinical-lab-normalization', 'personalized-care', 'personalized-care-fhir']
const REQUIRED_PACKS = ['heart-failure-cdss', 'hyperlipidemia-cdss', 'atrial-fibrillation-cdss', 'chronic-coronary-disease-cdss']
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

/** Verify the packages npm ci actually installed and record their release provenance. */
export async function hmcPublishedBuildInfo(root, { appSha, token, fetchMetadata = fetch } = {}) {
  assert.match(appSha ?? '', /^[a-f0-9]{40}$/, 'APP_SHA must identify the app commit being built')
  const [manifest, lock] = await Promise.all([readJson(join(root, 'package.json')), readJson(join(root, 'package-lock.json'))])
  const require = createRequire(join(root, 'package.json'))
  const packageVersions = {}
  const lockedPackages = {}
  for (const suffix of REQUIRED_PACKAGES) {
    const name = `@voho0000/${suffix}`
    const declared = manifest.dependencies?.[name] ?? manifest.optionalDependencies?.[name]
    assert.match(declared ?? '', /^\d+\.\d+\.\d+$/, `${name} must use an exact released version`)
    const locked = lock.packages?.[`node_modules/${name}`]
    const installed = await readJson(join(root, 'node_modules', name, 'package.json'))
    assert.equal(locked?.version, declared, `${name} lockfile does not match package.json`)
    assert.equal(installed.version, declared, `${name} installed version does not match the lockfile`)
    packageVersions[name] = declared
    lockedPackages[name] = locked
  }

  const care = require('@voho0000/personalized-care')
  assert.equal(typeof care.setLocaleLayer, 'function', 'Published care must export setLocaleLayer')
  for (const id of REQUIRED_PACKS) {
    assert.ok(care.CARE_PACKS?.some(pack => pack.id === id), `Published care is missing ${id}`)
  }
  assert.ok(care.getEnabledKnowledgePacks().some(pack => pack.metadata('zh-TW').id === 'taiwan-nhi-lipid-2026'), 'Published care must retain Taiwan lipid evidence')
  const fhirRequire = createRequire(join(root, 'node_modules/@voho0000/personalized-care-fhir/package.json'))
  assert.equal(fhirRequire.resolve('@voho0000/personalized-care'), require.resolve('@voho0000/personalized-care'), 'FHIR and host must resolve the same care package')
  require('@voho0000/personalized-care-fhir')

  // npm tarballs omit gitHead. Query the exact releases, never the moving latest tag.
  const packageRevisions = Object.fromEntries(await Promise.all(['personalized-care', 'personalized-care-fhir'].map(async suffix => {
    const name = `@voho0000/${suffix}`
    const version = packageVersions[name]
    const response = await fetchMetadata(`https://npm.pkg.github.com/${encodeURIComponent(name)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    assert.ok(response.ok, `${name} release metadata unavailable (HTTP ${response.status})`)
    const metadata = (await response.json()).versions?.[version]
    assert.equal(metadata?.version, version, `${name} release metadata does not name ${version}`)
    assert.equal(metadata.dist?.integrity, lockedPackages[name].integrity, `${name} release integrity does not match the lockfile`)
    assert.match(metadata.gitHead ?? '', /^[a-f0-9]{40}$/, `${name} release has no source commit`)
    return [name, metadata.gitHead]
  })))

  return {
    preview: 'HMC', appRef: 'pilot/hmc', appSha,
    rulesSource: 'published-packages', personalizationRef: 'published-packages',
    // Retained for the publisher; packageRevisions records both releases if they differ.
    personalizationSha: packageRevisions['@voho0000/personalized-care'],
    packageRevisions, packageVersions, builtAt: new Date().toISOString(),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  const token = process.env.NODE_AUTH_TOKEN
  delete process.env.NODE_AUTH_TOKEN
  const info = await hmcPublishedBuildInfo(root, { appSha: process.env.APP_SHA, token })
  await mkdir(join(root, 'public'), { recursive: true })
  await writeFile(join(root, 'public/hmc-build.json'), `${JSON.stringify(info, null, 2)}\n`)
  console.log(JSON.stringify(info, null, 2))
}
