import { MEDCLOUD_PROVIDER_SYSTEM, type FhirRecord } from './contract'
export type HfRecordSource = 'medcloud' | 'health-bank' | 'tvgh-ehr'
/** Format provenance only; caller authorization is independently verified by the service. */
export function hfRecordSource(bundle: FhirRecord): HfRecordSource {
  if (bundle.meta?.source === 'https://medcloud2.nhi.gov.tw/' || (bundle.meta?.tag ?? []).some((tag: FhirRecord) => tag.code === 'MEDCLOUD')) return 'medcloud'
  if ((bundle.meta?.tag ?? []).some((tag: FhirRecord) => tag.system === 'https://github.com/voho0000/NHI-FHIR-BRIDGE/bridge-version')) return 'health-bank'
  if (bundle.meta?.source === 'ehr-fhir-bridge/extension-local') return 'tvgh-ehr'
  throw new Error('source-unsupported')
}
/** Normalize hospital display references in a private copy. Scope IDs are internal
 * grouping keys, never official provider codes. Clinical codings stay unchanged. */
export function normalizeHfRecordSource(input: FhirRecord): { bundle: FhirRecord; source: HfRecordSource } {
  const source = hfRecordSource(input)
  if (source === 'medcloud') return { bundle: input, source }
  const bundle: FhirRecord = { ...input, entry: input.entry.filter((entry: FhirRecord) => entry?.resource && typeof entry.resource === 'object').map((entry: FhirRecord) => ({ ...entry, resource: { ...entry.resource } })) }
  const organizations = new Map<string, FhirRecord>()
  const existingIds = new Set(bundle.entry.map((entry: FhirRecord) => entry.resource?.id))
  const knownTvgh = new Set(['臺北榮民總醫院', '台北榮民總醫院', '臺北榮總', '台北榮總', '北榮'])
  const hospitalRef = (display: unknown): FhirRecord | undefined => {
    if (typeof display !== 'string' || !display.trim()) return
    const name = display.trim()
    const scope = knownTvgh.has(name) ? '臺北榮民總醫院' : name
    if (!organizations.has(scope)) {
      let id = 'hf-source-hospital-' + organizations.size
      while (existingIds.has(id)) id += '-local'
      existingIds.add(id)
      organizations.set(scope, { resourceType: 'Organization', id, name: scope,
        identifier: [{ system: MEDCLOUD_PROVIDER_SYSTEM, value: 'bridge-hospital:' + organizations.size }] })
    }
    return { reference: 'Organization/' + organizations.get(scope)!.id }
  }
  for (const { resource } of bundle.entry) {
    if (!resource) continue
    if (resource.resourceType === 'Encounter') {
      if (!resource.serviceProvider && source === 'tvgh-ehr' && resource.meta?.source === 'ehr-fhir-bridge/scraper') {
        resource.serviceProvider = hospitalRef('臺北榮民總醫院')
      } else if (resource.serviceProvider?.display && !resource.serviceProvider.reference) {
        resource.serviceProvider = hospitalRef(resource.serviceProvider.display)
      }
    }
    if (['Observation', 'Procedure'].includes(resource.resourceType)) {
      if (!resource.performer && source === 'tvgh-ehr' && resource.meta?.source === 'ehr-fhir-bridge/scraper') resource.performer = [hospitalRef('臺北榮民總醫院')]
      resource.performer = (resource.performer ?? []).map((performer: FhirRecord) => {
        const actor = performer.actor ?? performer
        if (actor.reference || !actor.display) return performer
        const ref = hospitalRef(actor.display)
        return performer.actor ? { ...performer, actor: ref } : ref
      })
    }
    // EHR de-identification replaces the actual birth day with Jan 1.
    if (source === 'tvgh-ehr' && resource.resourceType === 'Patient'
      && (resource.name ?? []).some((name: FhirRecord) => [name.text, name.family, ...(Array.isArray(name.given) ? name.given : [])].some(value => typeof value === 'string' && /^DEID-/.test(value)))) delete resource.birthDate
  }
  bundle.entry.push(...[...organizations.values()].map(resource => ({ resource })))
  return { bundle, source }
}
