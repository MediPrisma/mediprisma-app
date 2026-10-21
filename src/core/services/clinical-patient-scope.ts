import type { ClinicalSourceNode } from './clinical-source-graph'

const trimBase = (value: string) => value.replace(/\/+$/, '')

function patientIdFrom(value: string): string | undefined {
  if (/^urn:/i.test(value)) return undefined
  const decode = (id: string) => {
    try { return decodeURIComponent(id) } catch { return undefined }
  }
  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/Patient\/([^/]+)(?:\/_history\/[^/]+)?\/?$/i)
    return match ? decode(match[1]) : undefined
  } catch {
    const match = value.match(/^Patient\/([^/]+)(?:\/_history\/[^/]+)?\/?$/i)
    if (match) return decode(match[1])
    return /^[A-Za-z0-9.-]{1,64}$/.test(value) ? value : undefined
  }
}

function absoluteBase(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!/^https?:$/i.test(url.protocol)) return undefined
    const path = url.pathname.replace(/\/Patient\/[^/]+(?:\/_history\/[^/]+)?\/?$/i, '')
    return trimBase(`${url.origin}${path}`)
  } catch { return undefined }
}

const patientIndexByGraph = new WeakMap<readonly ClinicalSourceNode[], Map<string, readonly ClinicalSourceNode[]>>()
const containedPatientIndexByGraph = new WeakMap<readonly ClinicalSourceNode[], Map<string, Map<string, readonly ClinicalSourceNode[]>>>()

function patientsBySource(graphNodes: readonly ClinicalSourceNode[], sourceId: string): readonly ClinicalSourceNode[] {
  let index = patientIndexByGraph.get(graphNodes)
  if (!index) {
    const building = new Map<string, ClinicalSourceNode[]>()
    for (const candidate of graphNodes) {
      if (candidate.resource.resourceType !== 'Patient') continue
      const patients = building.get(candidate.sourceId) ?? []
      patients.push(candidate)
      building.set(candidate.sourceId, patients)
    }
    index = building
    patientIndexByGraph.set(graphNodes, index)
  }
  return index.get(sourceId) ?? []
}

function containedPatientsByParentAndId(
  graphNodes: readonly ClinicalSourceNode[],
  parentKey: string,
  id: string,
): readonly ClinicalSourceNode[] {
  let index = containedPatientIndexByGraph.get(graphNodes)
  if (!index) {
    const building = new Map<string, Map<string, ClinicalSourceNode[]>>()
    for (const candidate of graphNodes) {
      if (!candidate.isContained || !candidate.parentKey || candidate.resource.resourceType !== 'Patient' || !candidate.resource.id) continue
      let byId = building.get(candidate.parentKey)
      if (!byId) {
        byId = new Map<string, ClinicalSourceNode[]>()
        building.set(candidate.parentKey, byId)
      }
      const patients = byId.get(candidate.resource.id) ?? []
      patients.push(candidate)
      byId.set(candidate.resource.id, patients)
    }
    index = building
    containedPatientIndexByGraph.set(graphNodes, index)
  }
  return index.get(parentKey)?.get(id) ?? []
}

/** Classify patient-scope exclusions without treating local or opaque ids as global identities. */
export type ClinicalSourceNodePatientExclusionReason = 'foreign-patient-reference' | 'unresolved-patient-reference'

export function getClinicalSourceNodePatientExclusionReason(
  node: ClinicalSourceNode,
  graphNodes: readonly ClinicalSourceNode[],
): ClinicalSourceNodePatientExclusionReason | undefined {
  const resource = node.resource as Record<string, unknown>
  const referenceFields = ['subject', 'patient'] as const
  const references = referenceFields.flatMap(field => {
    const value = resource[field]
    const reference = value && typeof value === 'object' ? (value as Record<string, unknown>).reference : undefined
    return typeof reference === 'string' && reference.length > 0 ? [{ field, reference }] : []
  })
  if (references.length === 0 && node.resource.resourceType !== 'Patient') return undefined

  // A contained Patient's id is local to its parent resource. A uniquely
  // resolved #id therefore proves that the reference points to a Patient,
  // but does not prove that Patient is the authenticated SMART patient.
  // Quarantine it as scope-unresolved rather than guessing from the local id.
  const containedParentKey = node.isContained ? node.parentKey : node.key
  if (containedParentKey) {
    for (const { reference } of references) {
      if (!reference.startsWith('#')) continue
      const candidates = containedPatientsByParentAndId(graphNodes, containedParentKey, reference.slice(1))
      if (candidates.length === 1) return 'unresolved-patient-reference'
    }
  }

  const sameSourcePatients = patientsBySource(graphNodes, node.sourceId)
  const expectedIds = new Set<string>()
  const expectedUrls = new Set<string>()
  const scopeId = patientIdFrom(node.patientScope)
  if (scopeId) expectedIds.add(scopeId)
  if (/^(?:https?:\/\/|urn:)/i.test(node.patientScope)) expectedUrls.add(node.patientScope)
  const authenticatedBase = node.restBase ? absoluteBase(node.restBase) ?? trimBase(node.restBase) : undefined
  const patientUrlIsTrusted = (patient: ClinicalSourceNode): boolean => {
    if (!patient.fullUrl || !authenticatedBase) return true
    const base = absoluteBase(patient.fullUrl)
    // URNs are opaque identifiers and can be linked to the requested patient
    // through the response, but an absolute URL from another server cannot.
    return !base || base === authenticatedBase
  }
  for (const patient of sameSourcePatients) {
    // Only top-level Patients can establish identity aliases for the active
    // patient. Nested history/audit Patients remain available below to mark a
    // reference as unresolved, but never authorize it.
    if (patient.isContained || patient.embeddedIn) continue
    const inScope = patient.patientScope === node.patientScope
    if (inScope && patient.fullUrl && patientUrlIsTrusted(patient)
      && (patient.fullUrl === node.patientScope || (!!scopeId && patient.resource.id === scopeId))) {
      expectedUrls.add(patient.fullUrl)
      if (patient.resource.id) expectedIds.add(patient.resource.id)
    }
    if (patient.fullUrl && patient.fullUrl === node.patientScope && patientUrlIsTrusted(patient)) {
      expectedUrls.add(patient.fullUrl)
      if (patient.resource.id) expectedIds.add(patient.resource.id)
    }
  }

  if (node.resource.resourceType === 'Patient') {
    if (node.fullUrl && authenticatedBase) {
      const base = absoluteBase(node.fullUrl)
      if (base && base !== authenticatedBase) return 'foreign-patient-reference'
    }
    if (node.resource.id && expectedIds.size > 0 && !expectedIds.has(node.resource.id)) return 'foreign-patient-reference'
    if (node.fullUrl && expectedUrls.size > 0 && !expectedUrls.has(node.fullUrl)
      && !(node.resource.id && expectedIds.has(node.resource.id))) return 'foreign-patient-reference'
  }

  const knownBases = new Set<string>()
  if (authenticatedBase) {
    // The authenticated REST base is authoritative; response Patient URLs
    // must never expand the set of trusted servers.
    knownBases.add(authenticatedBase)
  } else {
    for (const value of expectedUrls) {
      const base = absoluteBase(value)
      if (base) knownBases.add(base)
    }
  }
  for (const { reference } of references) {
    if (/^urn:/i.test(reference)) {
      if (expectedUrls.has(reference)) continue
      const knownPatients = sameSourcePatients.filter(patient => patient.fullUrl === reference)
      if (knownPatients.length > 0) {
        const auditPatient = knownPatients.some(patient => patient.isContained || patient.embeddedIn)
        if (auditPatient) return 'unresolved-patient-reference'
        const knownPatient = knownPatients.find(patient => !patient.isContained && !patient.embeddedIn)
        if (knownPatient && !expectedUrls.has(reference)) {
          if (!patientUrlIsTrusted(knownPatient)) return 'foreign-patient-reference'
          if (knownPatient.resource.id && expectedIds.size > 0 && !expectedIds.has(knownPatient.resource.id)) return 'foreign-patient-reference'
          return 'unresolved-patient-reference'
        }
      }
      continue
    }
    const id = patientIdFrom(reference)
    if (!id) continue
    if (/^https?:\/\//i.test(reference)) {
      const base = absoluteBase(reference)
      if (!base || knownBases.size === 0) {
        if (expectedIds.size === 0) return 'unresolved-patient-reference'
        continue
      }
      // A base mismatch does not prove that the Patient id belongs to someone
      // else (reverse proxies commonly expose internal and public bases). Only
      // a conflicting known Patient id is foreign; otherwise quarantine it as
      // unresolved until the server identity can be established.
      if (![...knownBases].includes(base)) {
        return expectedIds.size > 0 && !expectedIds.has(id)
          ? 'foreign-patient-reference'
          : 'unresolved-patient-reference'
      }
    }
    if (expectedIds.size === 0) return 'unresolved-patient-reference'
    if (expectedIds.size > 0 && !expectedIds.has(id)) return 'foreign-patient-reference'
  }
  return undefined
}

export function isClinicalSourceNodePatientEligible(
  node: ClinicalSourceNode,
  graphNodes: readonly ClinicalSourceNode[],
): boolean {
  return getClinicalSourceNodePatientExclusionReason(node, graphNodes) === undefined
}
