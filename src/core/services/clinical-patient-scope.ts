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

/**
 * Return false only for an explicit patient contradiction. Unknown URNs,
 * missing references, and absolute references whose base cannot be established
 * stay eligible so this helper never invents a cross-base reference.
 */
export function isClinicalSourceNodePatientEligible(
  node: ClinicalSourceNode,
  graphNodes: readonly ClinicalSourceNode[],
): boolean {
  const resource = node.resource as Record<string, unknown>
  const references = [resource.subject, resource.patient]
    .map((value) => value && typeof value === 'object' ? (value as Record<string, unknown>).reference : undefined)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (references.length === 0 && node.resource.resourceType !== 'Patient') return true

  const sameSourcePatients = graphNodes.filter(candidate => candidate.sourceId === node.sourceId && candidate.resource.resourceType === 'Patient')
  const expectedIds = new Set<string>()
  const expectedUrls = new Set<string>()
  const scopeId = patientIdFrom(node.patientScope)
  if (scopeId) expectedIds.add(scopeId)
  if (/^(?:https?:\/\/|urn:)/i.test(node.patientScope)) expectedUrls.add(node.patientScope)
  for (const patient of sameSourcePatients) {
    const inScope = patient.patientScope === node.patientScope
    if (inScope && patient.fullUrl && (patient.fullUrl === node.patientScope || !scopeId || patient.resource.id === scopeId)) {
      expectedUrls.add(patient.fullUrl)
      if (patient.resource.id) expectedIds.add(patient.resource.id)
    }
    if (patient.fullUrl && patient.fullUrl === node.patientScope) {
      expectedUrls.add(patient.fullUrl)
      if (patient.resource.id) expectedIds.add(patient.resource.id)
    }
  }

  if (node.resource.resourceType === 'Patient') {
    if (node.resource.id && expectedIds.size > 0 && !expectedIds.has(node.resource.id)) return false
    if (node.fullUrl && expectedUrls.size > 0 && !expectedUrls.has(node.fullUrl)
      && !(node.resource.id && expectedIds.has(node.resource.id))) return false
  }

  const knownBases = new Set<string>()
  if (node.restBase) knownBases.add(trimBase(node.restBase))
  for (const value of expectedUrls) {
    const base = absoluteBase(value)
    if (base) knownBases.add(base)
  }
  for (const reference of references) {
    if (/^urn:/i.test(reference)) {
      if (expectedUrls.has(reference)) continue
      const knownPatient = sameSourcePatients.find(patient => patient.fullUrl === reference)
      if (knownPatient && !expectedUrls.has(reference)
        && !(knownPatient.resource.id && expectedIds.has(knownPatient.resource.id))) return false
      continue
    }
    const id = patientIdFrom(reference)
    if (!id) continue
    if (/^https?:\/\//i.test(reference)) {
      const base = absoluteBase(reference)
      if (!base || knownBases.size === 0) continue
      // With a known server base, an absolute reference to a different base is
      // an explicit boundary crossing even when the Patient id happens to match.
      if (![...knownBases].includes(base)) return false
    }
    if (expectedIds.size > 0 && !expectedIds.has(id)) return false
  }
  return true
}
