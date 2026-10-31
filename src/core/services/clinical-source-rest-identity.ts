import type { ClinicalSourceNode } from './clinical-source-graph'

/** A missing search-entry fullUrl can be recovered only from the captured
 * authenticated REST base and a top-level resource id. Explicit URLs/URNs and
 * contained/audit scopes remain authoritative and are never guessed equivalent. */
export function clinicalSourceRestIdentity(node: ClinicalSourceNode): string | null {
  if (node.fullUrl) return node.fullUrl
  if (node.isContained || node.embeddedIn || !node.restBase || !node.resource.id) return null
  try {
    const url = new URL(node.restBase)
    if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash) return null
  } catch { return null }
  return `${node.restBase.replace(/\/+$/, '')}/${node.resource.resourceType}/${node.resource.id}`
}
