import { clinicalSourceResourcesEqual } from './clinical-source-graph'
import type { ClinicalSourceGraph, ClinicalSourceNode } from './clinical-source-graph'

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function digest(value: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

function baseIdentity(node: ClinicalSourceNode, nodes?: Map<string, ClinicalSourceNode>): string {
  const parent = nodes?.get(node.parentKey ?? node.embeddedIn ?? '')
  const stableParent = parent ? [parent.sourceId, parent.patientScope, parent.restBase ?? null, parent.fullUrl ?? null,
    parent.resource.resourceType, parent.resource.id ?? null,
    (parent.resource.meta as { versionId?: unknown } | undefined)?.versionId ?? null, parent.contentHash] : null
  return stable([
    node.sourceId, node.patientScope, node.restBase ?? null, node.fullUrl ?? null,
    node.isContained ? 'contained' : node.embeddedIn ? 'embedded' : null, stableParent, node.resource.resourceType,
    node.resource.id ?? null,
    (node.resource.meta as { versionId?: unknown } | undefined)?.versionId ?? null,
    node.contentHash,
  ])
}

interface ContextIndex {
  nodes: Map<string, ClinicalSourceNode>
  edges: Map<string, graphReferences[number][]>
  fingerprints: Map<string, string>
}
type graphReferences = ClinicalSourceGraph['references']
const contextIndexes = new WeakMap<ClinicalSourceGraph, ContextIndex>()

function indexGraph(graph: ClinicalSourceGraph): ContextIndex {
  const cached = contextIndexes.get(graph)
  if (cached) return cached
  const nodes = new Map(graph.nodes.map((item) => [item.key, item]))
  const edges = new Map<string, graphReferences[number][]>()
  for (const edge of graph.references) {
    const list = edges.get(edge.origin.key) ?? []
    edges.set(edge.origin.key, [...list, edge])
  }
  const index = { nodes, edges, fingerprints: new Map<string, string>() }
  contextIndexes.set(graph, index)
  return index
}

/**
 * Generation-independent identity for a node and its graph-resolved outgoing
 * context. Unresolved states are represented as uncertainty markers, never as
 * resolved equivalence. Hashes keep nested/cyclic closures bounded in size.
 */
export function clinicalSourceContextIdentity(graph: ClinicalSourceGraph, node: ClinicalSourceNode): string {
  const { nodes, edges, fingerprints } = indexGraph(graph)
  const visit = (current: ClinicalSourceNode, visiting: Set<string>): { value: string; cyclic: boolean } => {
    const cached = fingerprints.get(current.key)
    if (cached) return { value: cached, cyclic: false }
    const base = baseIdentity(current, nodes)
    if (visiting.has(current.key)) return { value: digest('cycle'), cyclic: true }
    visiting.add(current.key)
    let cyclic = false
    const outgoing = (edges.get(current.key) ?? []).map((edge) => {
      let targets: string[] | number
      if (edge.status === 'resolved') {
        targets = [...new Set(edge.targetKeys.map((key) => {
            const target = nodes.get(key)
            // A dangling resolved edge is malformed; retain its key so it cannot
            // silently compare equal to a complete closure.
            if (!target) return `missing:${key}`
            const child = visit(target, visiting)
            cyclic ||= child.cyclic
            return child.value
          }))].sort()
      } else targets = edge.targetKeys.length
      return [edge.path, edge.status, edge.reference ?? null, edge.display ?? null, targets]
    })
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
    visiting.delete(current.key)
    const result = digest(stable([base, outgoing]))
    // A cyclic closure depends on its chosen root. Recompute those nodes
    // root-locally; acyclic descendants remain memoized for shared DAG work.
    if (!cyclic) fingerprints.set(current.key, result)
    return { value: result, cyclic }
  }
  return visit(node, new Set()).value
}

/** Structural guard used when context digests match, including digest collisions. */
export function clinicalSourceNodesEqualWithContext(
  graph: ClinicalSourceGraph,
  left: ClinicalSourceNode,
  right: ClinicalSourceNode,
): boolean {
  const { nodes, edges: resolved } = indexGraph(graph)
  const visiting = new Set<string>()
  const equal = (a: ClinicalSourceNode, b: ClinicalSourceNode): boolean => {
    if (baseIdentity(a, nodes) !== baseIdentity(b, nodes) || !clinicalSourceResourcesEqual(a.resource, b.resource)) return false
    const pair = `${a.key}\u0000${b.key}`
    if (visiting.has(pair)) return true
    visiting.add(pair)
    try {
    const edgeList = (node: ClinicalSourceNode) => (resolved.get(node.key) ?? []).slice().sort((x, y) => x.path.localeCompare(y.path))
    const aEdges = edgeList(a)
    const bEdges = edgeList(b)
    if (aEdges.length !== bEdges.length) return false
    for (let i = 0; i < aEdges.length; i++) {
      const ae = aEdges[i]
      const be = bEdges[i]
      if (ae.path !== be.path || ae.status !== be.status || ae.reference !== be.reference || ae.display !== be.display) return false
      if (ae.status !== 'resolved') {
        if (ae.targetKeys.length !== be.targetKeys.length) return false
        continue
      }
      const uniqueTargets = (keys: readonly string[]) => keys.map((key) => nodes.get(key)).filter((item): item is ClinicalSourceNode => Boolean(item))
        .filter((item, index, all) => all.findIndex((candidate) => equal(item, candidate)) === index)
      const at = uniqueTargets(ae.targetKeys)
      const bt = uniqueTargets(be.targetKeys)
      if (at.length !== bt.length) return false
      const unmatched = [...bt]
      for (const target of at) {
        const index = unmatched.findIndex((candidate) => equal(target, candidate))
        if (index < 0) return false
        unmatched.splice(index, 1)
      }
    }
    return true
    } finally {
      visiting.delete(pair)
    }
  }
  return equal(left, right)
}
