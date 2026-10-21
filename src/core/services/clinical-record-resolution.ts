import type { ClinicalRecordVariant } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from './clinical-reconciliation'
import { selectClinicalSourceNodes } from './clinical-reconciliation'
import { createClinicalRecordVariants, selectClinicalModifierNodes } from './clinical-record-variants'
import type { ClinicalSourceGraph, ClinicalSourceNode, ClinicalSourceReference } from './clinical-source-graph'
import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'
import { hasMalformedClinicalModifier } from './clinical-record-variant-modifier'
import { clinicalSourceContextIdentity } from './clinical-source-context'

/** Application selection policy, independent of the immutable source evidence.
 * Only already-established same-record groups participate. Similar clinical
 * events, foreign patients and unrelated sources are never merged here. */
export interface ClinicalRecordResolution {
  variants: ReadonlyMap<string, ClinicalRecordVariant>
  preferred: ReadonlyMap<string, string>
  includes(key: string): boolean
  reference(edge: ClinicalSourceReference): ClinicalSourceReference
}
const resolutionCache = new WeakMap<ClinicalReconciliationResult, Map<string, ClinicalRecordResolution>>()

const timestamp = (value: unknown): number => {
  if (typeof value !== 'string') return -Infinity
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : -Infinity
}
const completeness = (value: unknown): number => {
  if (value == null || value === '') return 0
  if (Array.isArray(value)) return value.reduce((total, item) => total + completeness(item), 0)
  if (typeof value === 'object') return Object.entries(value).reduce((total, [key, item]) =>
    total + (['meta', 'modifierExtension', 'id'].includes(key) ? 0 : completeness(item)), 0)
  return 1
}
function rank(node: ClinicalSourceNode): number[] {
  const resource: any = node.resource
  const status = resource.status ?? (typeof resource.clinicalStatus==='string' ? resource.clinicalStatus
    : resource.clinicalStatus?.coding?.[0]?.code ?? resource.clinicalStatus?.text)
  return [isVghtpeSource(resource) ? 2 : isMedcloudSource(resource) ? 0 : 1,
    status === 'entered-in-error' || resource.verificationStatus?.coding?.some((coding: any) => coding.code === 'entered-in-error') ? 3
      : ['stopped', 'cancelled', 'not-taken', 'ended', 'completed', 'resolved', 'inactive'].includes(status) ? 2
        : status === 'on-hold' ? 1 : 0,
    ['amended', 'corrected'].includes(resource.status) ? 2 : resource.status==='final' ? 1 : 0,
    completeness(resource)]
}
function preferredNode(left: ClinicalSourceNode, right: ClinicalSourceNode, graph: ClinicalSourceGraph): ClinicalSourceNode {
  const a = rank(left), b = rank(right)
  if (a[0] !== b[0]) return a[0] > b[0] ? left : right
  const leftTime = timestamp((left.resource.meta as any)?.lastUpdated)
  const rightTime = timestamp((right.resource.meta as any)?.lastUpdated)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime > rightTime ? left : right
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? left : right
  }
  // Opaque FHIR version IDs and arrival order are not clocks. The last tie
  // break is stable content identity, so reversing an import cannot flip facts.
  if (left.contentHash !== right.contentHash) return left.contentHash < right.contentHash ? left : right
  return clinicalSourceContextIdentity(graph,left) < clinicalSourceContextIdentity(graph,right) ? left : right
}

export function createClinicalRecordResolution(source: ClinicalReconciliationResult, additionalNodeKeys: ReadonlySet<string> = new Set(), quarantineMalformed = true): ClinicalRecordResolution {
  const cacheKey = JSON.stringify([quarantineMalformed, [...additionalNodeKeys].sort()])
  const cache = resolutionCache.get(source) ?? new Map<string, ClinicalRecordResolution>()
  const cached = cache.get(cacheKey)
  if (cached) return cached
  const variants = createClinicalRecordVariants(source, { additionalNodeKeys, quarantineMalformed })
  const active = new Set([...selectClinicalSourceNodes(source), ...selectClinicalModifierNodes(source, additionalNodeKeys)].map(node => node.key))
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const groups = new Map<string, ClinicalSourceNode[]>()
  for (const [key, variant] of variants) {
    const node = nodes.get(key)
    if (!node || !active.has(key) || hasMalformedClinicalModifier(node.resource)) continue
    // A relinked/missing encounter does not turn versions into independent
    // facts. Different source record IDs/fullUrls already have distinct groups.
    const groupKey = JSON.stringify([node.sourceId, node.patientScope, node.resource.resourceType, variant.groupId])
    const group = groups.get(groupKey) ?? []
    group.push(node)
    groups.set(groupKey, group)
  }
  const preferred = new Map<string, string>()
  for (const group of groups.values()) {
    const winner = group.reduce((left,right)=>preferredNode(left,right,source.graph))
    for (const node of group) preferred.set(node.key, winner.key)
  }
  const resolution: ClinicalRecordResolution = {
    variants, preferred,
    includes: key => !preferred.has(key) || preferred.get(key) === key,
    reference: edge => {
      if (!['resolved', 'ambiguous'].includes(edge.status) || !edge.targetKeys.length) return edge
      const targets = [...new Set(edge.targetKeys.map(key => preferred.get(key) ?? key))]
      if (targets.length !== 1) return edge
      return targets[0] === edge.targetKeys[0] && edge.status === 'resolved' && edge.targetKeys.length === 1
        ? edge : { ...edge, status: 'resolved', targetKeys: targets }
    },
  }
  cache.set(cacheKey, resolution)
  resolutionCache.set(source, cache)
  return resolution
}

/** Select already-mapped rows without promoting extra source/contained data.
 * Preserve object identity on unchanged paths for shared query subscribers. */
export function selectAutomaticClinicalRecordRows<T extends object>(input: T, resolution: ClinicalRecordResolution): T {
  const origin = (row: any): string | undefined => row?.clinicalSourceNodeKey ?? row?.clinicalClaimDerivedSource?.originNodeKey
  const selectRows = (rows: any[]): any[] => {
    const selected = rows.filter(row => !origin(row) || resolution.includes(origin(row)!)).map(row => {
      let next = row
      if (row?.clinicalRecordVariant && origin(row) && resolution.variants.has(origin(row)!)) {
        const { clinicalRecordVariant: _variant, ...rest } = row
        next = rest
      }
      if (Array.isArray(row?._observations)) {
        const members = selectRows(row._observations)
        if (members !== row._observations) next = { ...next, _observations: members }
      }
      return next
    })
    return selected.length === rows.length && selected.every((row, index) => row === rows[index]) ? rows : selected
  }
  let next = input
  for (const [key, rows] of Object.entries(input)) {
    if (!Array.isArray(rows)) continue
    const selected = selectRows(rows)
    if (selected === rows) continue
    if (next === input) next = { ...input }
    ;(next as any)[key] = selected
  }
  return next
}
