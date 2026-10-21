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
  readonly contentHash: string
  readonly restBase?: string
  readonly fullUrl?: string
  readonly isContained?: boolean
  readonly parentKey?: string
  readonly embeddedIn?: string
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

export const clinicalSourceResourcesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => clinicalSourceResourcesEqual(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && clinicalSourceResourcesEqual(leftRecord[key], rightRecord[key]))
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

const equivalenceKey = (node: ClinicalSourceNode, base: string | undefined, contentHash: string): string => {
  const version = (node.resource.meta as Record<string, unknown> | undefined)?.versionId ?? ''
  const logicalIdentity = node.resource.id
    ? [node.resource.resourceType, node.resource.id]
    : [node.fullUrl ?? '', node.resource.resourceType]
  return stable([node.sourceId, node.patientScope, base ?? '', logicalIdentity, version, contentHash])
}

const referencesIn = (value: unknown, path = ''): Array<{ path: string; reference?: string; display?: string; identifierOnly?: boolean }> => {
  if (!value || typeof value !== 'object') return []
  const found: Array<{ path: string; reference?: string; display?: string; identifierOnly?: boolean }> = []
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const lastPathPart = path.split('.').pop()?.replace(/\[\d+\]$/, '') ?? ''
    const displayReferenceFields = /^(subject|encounter|performer|requester|author|custodian|patient|actor|target|source|destination|recipient|result|specimen|device|reasonReference|medicationReference|supportingInfo|context|partOf|derivedFrom|hasMember|basedOn|focus|generalPractitioner|managingOrganization|organization|serviceProvider|location|careTeam|insurance|payor|what|who|individual|valueReference)$/i
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
  type Staged = Omit<ClinicalSourceNode, 'key' | 'occurrences' | 'parentKey' | 'embeddedIn'> & { fingerprint: string; contentHash: string; base?: string; identity: string; metadata: string; parentIdentity?: string; embeddedIdentity?: string; occurrences: number }
  const staged: Staged[] = []
  const stagedByFingerprint = new Map<string, Staged[]>()
  const digest = (text: string): string => {
    // Portable deterministic 64-bit FNV-1a pair for compact metadata fingerprints.
    let a = 0x811c9dc5
    let b = 0x9e3779b9
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      a = Math.imul(a ^ code, 0x01000193) >>> 0
      b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0
    }
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
  }
  const contentDigest = (value: unknown): string => {
    // Stream fields directly into the digest so large inline attachments never
    // need a second, canonical JSON string in memory. Equality checks handle collisions.
    let a = 0x811c9dc5
    let b = 0x9e3779b9
    const feed = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        a = Math.imul(a ^ code, 0x01000193) >>> 0
        b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0
      }
    }
    const visit = (item: unknown): void => {
      if (item === null) { feed('null;'); return }
      if (typeof item === 'string') { feed(`s${item.length}:`); feed(item); return }
      if (typeof item !== 'object') { feed(`${typeof item}:${String(item)};`); return }
      if (Array.isArray(item)) {
        feed('[')
        for (const child of item) visit(child)
        feed(']')
        return
      }
      const record = item as Record<string, unknown>
      feed('{')
      for (const key of Object.keys(record).sort()) { visit(key); visit(record[key]) }
      feed('}')
    }
    visit(value)
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
  }
  const add = (capture: ClinicalSourceCapture, resource: FhirSourceResource, fullUrl?: string, parentIdentity?: string, occurrenceSlot = '', embeddedIdentity?: string, precomputedContentHash?: string): Staged => {
    const resourceHash = precomputedContentHash ?? contentDigest(resource)
    const base = normalizeBase(capture.restBase)
    const hasReliableIdentity = Boolean(resource.id || fullUrl)
    const metadata = stable([capture.sourceId, capture.patientScope, capture.generation, base ?? '', fullUrl ?? '', parentIdentity ?? '', embeddedIdentity ?? '', hasReliableIdentity ? '' : occurrenceSlot])
    const fingerprint = digest(`${metadata}|${resourceHash}`)
    const bucket = stagedByFingerprint.get(fingerprint) ?? []
    const existing = bucket.find((item) => item.metadata === metadata && item.contentHash === resourceHash && clinicalSourceResourcesEqual(item.resource, resource))
    if (existing) existing.occurrences++
    else {
      const identityBase = `${metadata}|${resourceHash}`
      const identity = bucket.some((item) => item.identity === identityBase) ? `${identityBase}#${bucket.length}` : identityBase
      const item: Staged = { resource: cloneAndFreeze(resource), sourceId: capture.sourceId, patientScope: capture.patientScope, generation: capture.generation, ...(base ? { restBase: base } : {}), ...(fullUrl ? { fullUrl } : {}), ...(parentIdentity ? { isContained: true } : {}), contentHash: resourceHash, fingerprint, identity, metadata, ...(parentIdentity ? { parentIdentity } : {}), ...(embeddedIdentity ? { embeddedIdentity } : {}), base, occurrences: 1 }
      bucket.push(item)
      stagedByFingerprint.set(fingerprint, bucket)
      staged.push(item)
    }
    const item = existing ?? bucket[bucket.length - 1]
    if (Array.isArray(resource.contained)) for (const [index, child] of resource.contained.entries()) {
      if (child && typeof child === 'object' && !Array.isArray(child)) add(capture, child as FhirSourceResource, undefined, item.identity, `${occurrenceSlot}/contained/${index}`, embeddedIdentity, undefined)
    }
    return item
  }

  type ReplayEntry = { resource: Readonly<FhirSourceResource>; fullUrl?: string; contentHash: string }
  type ReplayCapture = { metadata: string; entries: ReplayEntry[] }
  const seenCaptures = new Map<string, ReplayCapture[]>()
  for (const capture of captures) {
    const metadata = stable([capture.sourceId, capture.patientScope, capture.generation, normalizeBase(capture.restBase) ?? ''])
    const prepared = capture.resources.map((entry) => {
      const wrapped = 'resource' in entry && entry.resource && typeof entry.resource === 'object'
      const resource = (wrapped ? entry.resource : entry) as FhirSourceResource
      return { resource, fullUrl: wrapped && typeof entry.fullUrl === 'string' ? entry.fullUrl : undefined, contentHash: contentDigest(resource) }
    })
    const captureSignature = digest(stable([metadata, prepared.map((entry) => [entry.fullUrl ?? '', entry.contentHash])]))
    const priorCaptures = seenCaptures.get(captureSignature) ?? []
    const replayed = priorCaptures.some((prior) => prior.metadata === metadata && prior.entries.length === prepared.length && prior.entries.every((entry, index) => entry.fullUrl === prepared[index].fullUrl && entry.contentHash === prepared[index].contentHash && clinicalSourceResourcesEqual(entry.resource, prepared[index].resource)))
    if (replayed) continue
    const captureIdentity = priorCaptures.length ? `${captureSignature}:${priorCaptures.length}` : captureSignature
    const replayEntries: ReplayEntry[] = []
    for (const [captureIndex, entry] of prepared.entries()) {
      const root = add(capture, entry.resource, entry.fullUrl, undefined, `${captureIdentity}/${captureIndex}`, undefined, entry.contentHash)
      replayEntries.push({ resource: root.resource, fullUrl: entry.fullUrl, contentHash: entry.contentHash })
      addBundleEntries(capture, root.resource, root, `${captureIdentity}/${captureIndex}`)
    }
    priorCaptures.push({ metadata, entries: replayEntries })
    seenCaptures.set(captureSignature, priorCaptures)
  }

  function addBundleEntries(capture: ClinicalSourceCapture, bundle: FhirSourceResource, parent: Staged, slot: string): void {
    if (bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) return
    for (const [entryIndex, bundleEntry] of bundle.entry.entries()) {
      if (!bundleEntry || typeof bundleEntry !== 'object') continue
      const item = bundleEntry as Record<string, unknown>
      if (!item.resource || typeof item.resource !== 'object' || Array.isArray(item.resource)) continue
      const child = item.resource as FhirSourceResource
      const childNode = add(capture, child, typeof item.fullUrl === 'string' ? item.fullUrl : undefined, undefined, `${slot}/bundle/${entryIndex}`, parent.identity)
      addBundleEntries(capture, childNode.resource, childNode, `${slot}/bundle/${entryIndex}`)
    }
  }

  const nodes: ClinicalSourceNode[] = []
  const keysByIdentity = new Map<string, string>()
  const fingerprintIdentities = new Map<string, string[]>()
  const baseByKey = new Map<string, string | undefined>()
  const contentHashByKey = new Map<string, string>()
  const nodeByKey = new Map<string, ClinicalSourceNode>()
  const logicalIndex = new Map<string, ClinicalSourceNode[]>()
  const fullUrlIndex = new Map<string, ClinicalSourceNode[]>()
  const containedIndex = new Map<string, ClinicalSourceNode[]>()
  const scopeKey = (sourceId: string, patientScope: string): string => stable([sourceId, patientScope])
  const referenceContext = (node: ClinicalSourceNode): string => node.resource.resourceType === 'Bundle' ? node.key : node.embeddedIn ?? ''
  const indexKey = (scope: string, context: string, base: string | undefined, value: string): string => `${scope}|${context}|${base ?? ''}|${value}`
  const addToIndex = (index: Map<string, ClinicalSourceNode[]>, key: string, node: ClinicalSourceNode) => {
    const list = index.get(key)
    if (list) list.push(node)
    else index.set(key, [node])
  }
  for (const item of staged) {
    let key = `fhir:${item.fingerprint}`
    const collided = fingerprintIdentities.get(item.fingerprint) ?? []
    const index = collided.indexOf(item.identity)
    if (index >= 0) continue
    if (collided.length) key += `:${collided.length}`
    collided.push(item.identity)
    fingerprintIdentities.set(item.fingerprint, collided)
    keysByIdentity.set(item.identity, key)
    baseByKey.set(key, deriveRestBase(item.fullUrl) ?? item.base)
    contentHashByKey.set(key, item.contentHash)
    const node = Object.freeze({ key, resource: item.resource, sourceId: item.sourceId, patientScope: item.patientScope, generation: item.generation, contentHash: item.contentHash, ...(item.restBase ? { restBase: item.restBase } : {}), ...(item.fullUrl ? { fullUrl: item.fullUrl } : {}), ...(item.isContained ? { isContained: true, parentKey: keysByIdentity.get(item.parentIdentity!) } : {}), ...(item.embeddedIdentity ? { embeddedIn: keysByIdentity.get(item.embeddedIdentity) } : {}), occurrences: item.occurrences })
    nodes.push(node)
    nodeByKey.set(key, node)
    const scope = scopeKey(node.sourceId, node.patientScope)
    const context = referenceContext(node)
    if (node.fullUrl) addToIndex(fullUrlIndex, `${scope}|${context}|${withoutVersion(node.fullUrl)}`, node)
    if (node.isContained && node.parentKey) addToIndex(containedIndex, `${node.parentKey}|${String(node.resource.id ?? '')}`, node)
    else addToIndex(logicalIndex, indexKey(scope, context, baseByKey.get(key), `${node.resource.resourceType}/${String(node.resource.id ?? '')}`), node)
  }

  const refs: ClinicalSourceReference[] = []
  for (const origin of nodes) {
    for (const ref of referencesIn(origin.resource)) {
      if (!ref.reference) {
        if (ref.identifierOnly) refs.push(Object.freeze({ origin, path: ref.path, status: 'unresolved', targetKeys: Object.freeze([]) }))
        else if (ref.display) refs.push(Object.freeze({ origin, path: ref.path, display: ref.display, status: 'display-only', targetKeys: Object.freeze([]) }))
        continue
      }
      const scope = scopeKey(origin.sourceId, origin.patientScope)
      const context = referenceContext(origin)
      let candidates: ClinicalSourceNode[] = []
      const raw = ref.reference
      if (raw.startsWith('#')) {
        const parentKey = origin.isContained ? origin.parentKey : origin.key
        candidates = parentKey ? containedIndex.get(`${parentKey}|${raw.slice(1)}`) ?? [] : []
      } else {
        const originNode = origin.isContained && origin.parentKey ? nodeByKey.get(origin.parentKey) ?? origin : origin
        const originBase = baseByKey.get(originNode.key) ?? originNode.restBase ?? deriveRestBase(originNode.fullUrl)
        const isAbsolute = /^https?:\/\//i.test(raw)
        let normalized = raw
        let expectedBase = originBase
        if (isAbsolute) {
          try {
            const url = new URL(raw)
            expectedBase = deriveRestBase(raw)
            const basePath = expectedBase ? new URL(expectedBase).pathname.replace(/\/+$/, '') : ''
            normalized = url.pathname.slice(basePath.length).replace(/^\/+/, '')
          } catch { normalized = '' }
        }
        const versionMatch = normalized.match(/\/_history\/([^/]+)\/?$/)
        normalized = normalized.replace(/^\//, '').replace(/\/_history\/[^/]+\/?$/, '')
        const exact = (fullUrlIndex.get(`${scope}|${context}|${withoutVersion(raw)}`) ?? []).filter((node) => !versionMatch || (node.resource.meta as Record<string, unknown> | undefined)?.versionId === versionMatch[1])
        const logical = logicalIndex.get(indexKey(scope, context, expectedBase, normalized)) ?? []
        candidates = exact.length ? exact : (isAbsolute && !expectedBase) ? [] : logical.filter((node) => !versionMatch || (node.resource.meta as Record<string, unknown> | undefined)?.versionId === versionMatch[1])
      }
      const distinct = [...new Map(candidates.map((n) => [n.key, n])).values()].sort((a, b) => a.key.localeCompare(b.key))
      const classes: ClinicalSourceNode[][] = []
      for (const candidate of distinct) {
        const candidateBase = baseByKey.get(candidate.key) ?? candidate.restBase ?? deriveRestBase(candidate.fullUrl)
        const candidateKey = equivalenceKey(candidate, candidateBase, contentHashByKey.get(candidate.key) ?? contentDigest(candidate.resource))
        const existing = classes.find((group) => {
          const representative = group[0]
          const representativeBase = baseByKey.get(representative.key) ?? representative.restBase ?? deriveRestBase(representative.fullUrl)
          return equivalenceKey(representative, representativeBase, contentHashByKey.get(representative.key) ?? contentDigest(representative.resource)) === candidateKey && clinicalSourceResourcesEqual(representative.resource, candidate.resource)
        })
        if (existing) existing.push(candidate)
        else classes.push([candidate])
      }
      const status: ClinicalSourceReferenceStatus = classes.length === 1 && distinct.length > 0 ? 'resolved' : distinct.length > 0 ? 'ambiguous' : 'unresolved'
      refs.push(Object.freeze({ origin, path: ref.path, reference: raw, ...(ref.display ? { display: ref.display } : {}), status, targetKeys: Object.freeze(distinct.map((n) => n.key)) }))
    }
  }
  refs.sort((a, b) => a.origin.key.localeCompare(b.origin.key) || a.path.localeCompare(b.path) || (a.reference ?? '').localeCompare(b.reference ?? ''))
  return Object.freeze({ nodes: Object.freeze(nodes), references: Object.freeze(refs) })
}

