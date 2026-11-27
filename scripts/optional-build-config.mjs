import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { detectOptionalPackages } from './optional-package-state.mjs'

export function optionalBuildConfig(root, options = {}) {
  const state = options.state ?? detectOptionalPackages(root)
  const sdkImport = options.sdkImport ?? (existsSync(join(root, 'vendor/nhi-fhir-bridge-sdk-json/browser.js')) && existsSync(join(root, 'vendor/nhi-fhir-bridge-sdk-json/browser.d.ts')))
  /** @type {Record<string, string>} */
  const aliases = {}
  const excluded = []
  const fallback = (name, file) => { aliases[name] = `./src/optional/${file}` }
  if (!state.labs) {
    for (const subpath of ['', '/canonical', '/display']) {
      fallback(`@voho0000/clinical-lab-normalization${subpath}`, 'lab-normalize.ts')
    }
    fallback('@voho0000/clinical-lab-normalization/interpretation', 'lab-interpretation.ts')
  }
  if (!state.fhir) {
    fallback('@voho0000/personalized-care-fhir', 'fhir-helpers.ts')
    fallback('@voho0000/personalized-care-fhir/report-text', 'report-text.ts')
  }
  if (!state.care) {
    fallback('@/features/clinical-decision-support/LiveFeature', 'unavailable-cdss.tsx')
    fallback('@/features/clinical-decision-support/guideline-packs/registry', 'care-registry.ts')
    for (const preview of ['app/dev/af/preview', 'app/dev/cdss-scenarios/view/view', 'app/dev-nhi-table1/ReviewClient', 'app/dev-nhi-table1/pipeline/PipelineReview']) {
      fallback(`@/${preview}`, 'unavailable-cdss.tsx')
    }
    excluded.push('features/clinical-decision-support/**', 'app/dev/af/preview.tsx', 'app/dev/cdss-scenarios/view/view.tsx',
      'app/dev-nhi-table1/ReviewClient.tsx', 'app/dev-nhi-table1/pipeline/**')
  }
  if (!state.education) {
    fallback('@/features/personalized-education/module', 'education-module.ts')
    fallback('@/features/personalized-education/LiveFeature', 'unavailable-education.tsx')
    excluded.push('features/personalized-education/**')
  }
  // Without the check package the interaction check is off (see
  // assertConfiguredPackages); the stand-in only lets the app compile.
  if (!state.ddi) fallback('@mediprisma/vghtpe-ddi-check', 'ddi-check.ts')
  if (!sdkImport) fallback('@/vendor/nhi-fhir-bridge-sdk-json/browser.js', 'sdk-json.ts')
  return { aliases, excluded, env: {
    NEXT_PUBLIC_CDSS_AVAILABLE: String(state.care),
    NEXT_PUBLIC_SDK_IMPORT_AVAILABLE: String(sdkImport),
    NEXT_PUBLIC_DDI_CHECK_AVAILABLE: String(state.ddi),
  } }
}

/** A build configured for a private feature must have its package: never
 *  ship the feature silently switched off. */
export function assertConfiguredPackages(config, env = process.env) {
  if (env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN && config.env.NEXT_PUBLIC_DDI_CHECK_AVAILABLE !== 'true') {
    throw new Error(
      'NEXT_PUBLIC_DDI_SERVICE_ORIGIN is set, but @mediprisma/vghtpe-ddi-check is not installed, ' +
      'so this build would have no drug-interaction check. Install with a NODE_AUTH_TOKEN that can ' +
      'read @mediprisma packages on GitHub Packages (read:packages), e.g. ' +
      'NODE_AUTH_TOKEN="$(gh auth token)" npm ci, or unset NEXT_PUBLIC_DDI_SERVICE_ORIGIN.',
    )
  }
}

export function writeOptionalBuildTsconfig(root, config) {
  if (!Object.keys(config.aliases).length) return 'tsconfig.build.json'
  const base = JSON.parse(readFileSync(join(root, 'tsconfig.build.json'), 'utf8'))
  const file = 'tsconfig.optional.generated.json'
  const content = JSON.stringify({
    extends: './tsconfig.build.json',
    compilerOptions: { paths: {
      '@/*': ['./*'],
      ...Object.fromEntries(Object.entries(config.aliases).map(([name, file]) => [name, [file]])),
    } },
    exclude: [...base.exclude, ...config.excluded],
  }, null, 2) + '\n'
  const target = resolve(root, file)
  let current
  try { current = readFileSync(target, 'utf8') } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (current !== content) {
    // Replace the directory entry atomically instead of following a target
    // symlink or letting Next.js read a partially written configuration.
    const temporary = join(root, `.tsconfig.optional.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, content, { flag: 'wx' })
      renameSync(temporary, target)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  return file
}
