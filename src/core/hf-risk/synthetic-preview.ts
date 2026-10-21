import type { FhirRecord } from './contract'
// Fixed fingerprints of the repository HF test fixture and the generated 66-year-old synthetic HF case.
// These are fixture hashes, not patient identifiers. UUIDs are normalized; all clinical values remain pinned.
const FIXTURES = new Set(['14a050fa09f5f0007401c9b6015da2c662134e2437cec227ceb974b0204eb34e', 'db94c264ce821dd5643d7dca3a2a431310e8852bced45b4ce405eb2a523ce590'])
export async function isHfSyntheticPreview(bundle: FhirRecord): Promise<boolean> {
  const identifiers = new Map<string, string>()
  bundle.entry.forEach((entry: FhirRecord, i: number) => {
    identifiers.set(entry.resource.id, 'resource-' + i)
    identifiers.set(entry.fullUrl, 'urn:uuid:resource-' + i)
  })
  const clean = (value: any): any => typeof value === 'string' ? (identifiers.get(value) ?? value)
    : Array.isArray(value) ? value.map(clean)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, clean(value[key])])) : value
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(clean(bundle))))
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return FIXTURES.has(hash)
}
