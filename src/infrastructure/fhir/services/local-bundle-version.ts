// Only the bounded, non-clinical version is retained, scoped to this tab's active Bundle.
const SYSTEM = 'https://cloud-wildcatch.invalid/fhir/CodeSystem/extension-version'
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/
let activeVersion: string | undefined

export function rememberLocalBundleVersion(bundle: unknown): void {
  activeVersion = undefined
  const tags = (bundle as { meta?: { tag?: unknown } } | null)?.meta?.tag
  if (!Array.isArray(tags)) return
  const matches = tags.filter(tag => tag?.system === SYSTEM)
  if (matches.length === 1 && typeof matches[0].code === 'string' && VERSION.test(matches[0].code))
    activeVersion = matches[0].code
}

export function readLocalBundleVersion(): string | undefined { return activeVersion }
