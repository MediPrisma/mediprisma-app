import { createRequire } from 'node:module'
import { join } from 'node:path'

// Resolve actual entrypoints, rather than checking a directory that may be
// empty after an optional package failed to install.
export function detectOptionalPackages(root, resolveModule) {
  const resolve = resolveModule ?? createRequire(join(root, 'package.json')).resolve
  const available = (entries) => entries.every((entry) => {
    try { resolve(entry); return true } catch { return false }
  })
  const sdk = available(['@voho0000/personalization-sdk'])
  const labs = available([
    '@voho0000/clinical-lab-normalization/canonical',
    '@voho0000/clinical-lab-normalization/display',
    '@voho0000/clinical-lab-normalization/interpretation',
  ])
  const careRules = sdk && available(['@voho0000/personalized-care', '@voho0000/personalized-care/registry'])
  const fhir = careRules && labs && available(['@voho0000/personalized-care-fhir'])
  return {
    labs,
    care: fhir,
    education: sdk && labs && available(['@voho0000/personalized-education']),
    fhir,
  }
}
