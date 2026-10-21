export interface FhirSourceResource {
  resourceType: string
  id?: string
  [key: string]: unknown
}

export interface ClinicalSourceCapture {
  sourceId: string
  patientScope: string
  generation: string
  restBase?: string
  resources: readonly (FhirSourceResource | { resource: FhirSourceResource; fullUrl?: string })[]
}

export interface ClinicalSourceNode {
  readonly key: string
  readonly resource: Readonly<FhirSourceResource>
  readonly sourceId: string
  readonly patientScope: string
  readonly generation: string
  readonly restBase?: string
  readonly fullUrl?: string
  readonly isContained?: boolean
  readonly parentKey?: string
  readonly occurrences: number
}

export type ClinicalSourceReferenceStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'display-only'

export interface ClinicalSourceReference {
  readonly origin: ClinicalSourceNode
  readonly path: string
  readonly reference?: string
  readonly display?: string
  readonly status: ClinicalSourceReferenceStatus
  readonly targetKeys: readonly string[]
}

export interface ClinicalSourceGraph {
  readonly nodes: readonly ClinicalSourceNode[]
  readonly references: readonly ClinicalSourceReference[]
}

const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
}

const cloneAndFreeze = <T>(value: T): T => {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze)) as T
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneAndFreeze(child)
    return Object.freeze(copy) as T
  }
  return value
}

const normalizeBase = (base?: string): string | undefined => base?.replace(/\/+$/, '')

const deriveRestBase = (fullUrl?: string): string | undefined => {
  if (!fullUrl || !/^https?:\/\//i.test(fullUrl)) return undefined
  try {
    const url = new URL(fullUrl)
    const path = url.pathname.replace(/\/_history\/[^/]+\/?$/, '').replace(/\/(?:[^/]+)\/[^/]+\/?$/, '')
    return normalizeBase(`${url.origin}${path}`)
  } catch { return undefined }
}

const withoutVersion = (url: string): string => url.replace(/\/_history\/[^/]+\/?$/, '')

const referencesIn = (value: unknown, path = ''): Array<{ path: string; reference?: string; display?: string; identifierOnly?: boolean }> => {
  if (!value || typeof value !== 'object') return []
  const found: Array<{ path: string; reference?: string; display?: string; identifierOnly?: boolean }> = []
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const lastPathPart = path.split('.').pop()?.replace(/\[\d+\]$/, '') ?? ''
    const displayReferenceFields = /^(subject|encounter|performer|requester|author|custodian|patient|actor|target|source|destination|recipient|result|specimen|device|reasonReference|medicationReference|supportingInfo|context|partOf|derivedFrom|hasMember|basedOn|focus|generalPractitioner|managingOrganization|organization|serviceProvider|location|careTeam|insurance|payor)$/i
    if (typeof record.reference === 'string' || (record.type === 'Reference' && typeof record.display === 'string') || (displayReferenceFields.test(lastPathPart) && (typeof record.display === 'string' || (record.identifier && typeof record.identifier === 'object')))) {
      found.push({ path, reference: typeof record.reference === 'string' ? record.reference : undefined, display: typeof record.display === 'string' ? record.display : undefined, identifierOnly: Boolean(record.identifier && typeof record.identifier === 'object' && typeof record.reference !== 'string') })
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'contained' || (child && typeof child === 'object' && !Array.isArray(child) && typeof (child as Record<string, unknown>).resourceType === 'string')) continue
      found.push(...referencesIn(child, path ? `${path}.${key}` : key))
    }
  } else {
    value.forEach((child, index) => found.push(...referencesIn(child, `${path}[${index}]`)))
  }
  return found
}

export function buildClinicalSourceGraph(captures: readonly ClinicalSourceCapture[]): ClinicalSourceGraph {
  const staged: Array<Omit<ClinicalSourceNode, 'key' | 'occurrences' | 'parentKey'> & { canonical: string; fingerprint: string; base?: string; identity: string; parentIdentity?: string; occurrences: number }> = []
  const digest = (text: string): string => {
    // Portable deterministic 64-bit FNV-1a pair; canonical equality below makes
    // this digest collision-safe while avoiding a Node-only crypto dependency.
    let a = 0x811c9dc5
    let b = 0x9e3779b9
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      a = Math.imul(a ^ code, 0x01000193) >>> 0
      b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0
    }
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
  }
  const add = (capture: ClinicalSourceCapture, resource: FhirSourceResource, fullUrl?: string, parentIdentity?: string, occurrenceSlot = ''): string => {
    const canonical = stable(resource)
    const base = normalizeBase(capture.restBase)
    const hasReliableIdentity = Boolean(resource.id || fullUrl)
    const identity = stable([capture.sourceId, capture.patientScope, capture.generation, base ?? '', fullUrl ?? '', parentIdentity ?? '', hasReliableIdentity ? '' : occurrenceSlot, canonical])
    const fingerprint = digest(identity)
    const existing = staged.find((item) => item.fingerprint === fingerprint && item.identity === identity)
    if (existing) existing.occurrences++
    else staged.push({ resource: cloneAndFreeze(resource), sourceId: capture.sourceId, patientScope: capture.patientScope, generation: capture.generation, ...(base ? { restBase: base } : {}), ...(fullUrl ? { fullUrl } : {}), ...(parentIdentity ? { isContained: true } : {}), canonical, fingerprint, identity, ...(parentIdentity ? { parentIdentity } : {}), base, occurrences: 1 })
    const item = existing ?? staged[staged.length - 1]
    if (Array.isArray(resource.contained)) for (const [index, child] of resource.contained.entries()) {
      if (child && typeof child === 'object' && !Array.isArray(child)) add(capture, child as FhirSourceResource, undefined, identity, `${occurrenceSlot}/contained/${index}`)
    }
    return item.identity
  }

  const seenCaptures = new Set<string>()
  for (const capture of captures) {
    const captureIdentity = stable([capture.sourceId, capture.patientScope, capture.generation, normalizeBase(capture.restBase) ?? '', capture.resources.map((entry) => {
      const wrapped = 'resource' in entry && entry.resource && typeof entry.resource === 'object'
      return wrapped ? [entry.fullUrl ?? '', entry.resource] : ['', entry]
    })])
    if (seenCaptures.has(captureIdentity)) continue
    seenCaptures.add(captureIdentity)
    for (const [captureIndex, entry] of capture.resources.entries()) {
    const wrapped = 'resource' in entry && entry.resource && typeof entry.resource === 'object'
    const resource = (wrapped ? entry.resource : entry) as FhirSourceResource
    const fullUrl = wrapped && typeof entry.fullUrl === 'string' ? entry.fullUrl : undefined
    add(capture, resource, fullUrl, undefined, `${captureIdentity}/${captureIndex}`)
    // Bundle entries are explicit primary resources. Other nested resource-shaped
    // objects (including provenance snapshots in extensions) remain embedded data.
    if (resource.resourceType === 'Bundle' && Array.isArray(resource.entry)) {
      for (const [entryIndex, bundleEntry] of resource.entry.entries()) {
        if (!bundleEntry || typeof bundleEntry !== 'object') continue
        const item = bundleEntry as Record<string, unknown>
        if (item.resource && typeof item.resource === 'object' && !Array.isArray(item.resource)) {
          add(capture, item.resource as FhirSourceResource, typeof item.fullUrl === 'string' ? item.fullUrl : undefined, undefined, `${captureIdentity}/${captureIndex}/bundle/${entryIndex}`)
        }
      }
    }
  }
  }

  const nodes: ClinicalSourceNode[] = []
  const keysByIdentity = new Map<string, string>()
  const fingerprintIdentities = new Map<string, string[]>()
  const baseByKey = new Map<string, string | undefined>()
  for (const item of staged) {
    let key = `fhir:${item.fingerprint}`
    const collided = fingerprintIdentities.get(item.fingerprint) ?? []
    const index = collided.indexOf(item.identity)
    if (index >= 0) continue
    if (collided.length) key += `:${collided.length}`
    collided.push(item.identity)
    fingerprintIdentities.set(item.fingerprint, collided)
    keysByIdentity.set(item.identity, key)
    baseByKey.set(key, item.base ?? deriveRestBase(item.fullUrl))
    nodes.push(Object.freeze({ key, resource: item.resource, sourceId: item.sourceId, patientScope: item.patientScope, generation: item.generation, ...(item.restBase ? { restBase: item.restBase } : {}), ...(item.fullUrl ? { fullUrl: item.fullUrl } : {}), ...(item.isContained ? { isContained: true, parentKey: keysByIdentity.get(item.parentIdentity!) } : {}), occurrences: item.occurrences }))
  }

  const refs: ClinicalSourceReference[] = []
  for (const origin of nodes) {
    for (const ref of referencesIn(origin.resource)) {
      if (!ref.reference) {
        if (ref.identifierOnly) refs.push(Object.freeze({ origin, path: ref.path, status: 'unresolved', targetKeys: Object.freeze([]) }))
        else if (ref.display) refs.push(Object.freeze({ origin, path: ref.path, display: ref.display, status: 'display-only', targetKeys: Object.freeze([]) }))
        continue
      }
      const scoped = nodes.filter((node) => node.sourceId === origin.sourceId && node.patientScope === origin.patientScope)
      let candidates: ClinicalSourceNode[] = []
      const raw = ref.reference
      if (raw.startsWith('#')) {
        const parentKey = origin.isContained ? origin.parentKey : origin.key
        candidates = scoped.filter((node) => node.isContained && node.parentKey === parentKey && node.resource.id === raw.slice(1))
      } else {
        let normalized = raw
        const matchingBases = [...new Set(scoped.map((node) => baseByKey.get(node.key) ?? deriveRestBase(node.fullUrl)).filter((base): base is string => Boolean(base && raw.startsWith(`${base}/`))))].sort((a, b) => b.length - a.length)
        if (matchingBases.length) normalized = raw.slice(matchingBases[0].length + 1)
        else if (/^https?:\/\//i.test(raw)) {
          try { normalized = new URL(raw).pathname.replace(/^\//, '') } catch { normalized = raw }
        }
        const versionMatch = normalized.match(/\/_history\/([^/]+)\/?$/)
        normalized = normalized.replace(/^\//, '').replace(/\/_history\/[^/]+\/?$/, '')
        const exact = scoped.filter((node) => node.fullUrl && withoutVersion(node.fullUrl) === withoutVersion(raw) && (!versionMatch || (node.resource.meta as Record<string, unknown> | undefined)?.versionId === versionMatch[1]))
        const isAbsolute = /^https?:\/\//i.test(raw)
        candidates = exact.length ? exact : (isAbsolute && matchingBases.length === 0) ? [] : scoped.filter((node) => !node.isContained && `${node.resource.resourceType}/${node.resource.id}` === normalized && (!versionMatch || (node.resource.meta as Record<string, unknown> | undefined)?.versionId === versionMatch[1]))
      }
      const distinct = [...new Map(candidates.map((n) => [n.key, n])).values()].sort((a, b) => a.key.localeCompare(b.key))
      const status: ClinicalSourceReferenceStatus = distinct.length === 1 ? 'resolved' : distinct.length > 1 ? 'ambiguous' : 'unresolved'
      refs.push(Object.freeze({ origin, path: ref.path, reference: raw, ...(ref.display ? { display: ref.display } : {}), status, targetKeys: Object.freeze(distinct.map((n) => n.key)) }))
    }
  }
  refs.sort((a, b) => a.origin.key.localeCompare(b.origin.key) || a.path.localeCompare(b.path) || (a.reference ?? '').localeCompare(b.reference ?? ''))
  return Object.freeze({ nodes: Object.freeze(nodes), references: Object.freeze(refs) })
}
