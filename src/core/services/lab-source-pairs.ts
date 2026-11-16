import type { ClinicalSourceNode, ClinicalSourceGraph } from './clinical-source-graph'
import { clinicalSourceResourcesEqual } from './clinical-source-graph'
import { isMedcloudSource, isVghtpeSource } from '@/src/shared/utils/clinical-source-identity'
import { taipeiDay, utcDay } from '@/src/core/utils/calendar-day'

type Resource = Record<string, any>
const aliases: Record<string, string> = { FSH: '83098-4', E2: '83096-8' }
const supported = new Set(['83098-4', '83096-8', '24108-3'])
const hospitals = new Set(['臺北榮總', '台北榮總', '臺北榮民總醫院', '台北榮民總醫院'])
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function analyte(resource: Resource): string | undefined {
  const loinc = [...new Set<string>((resource.code?.coding ?? []).filter((c: any) => c.system === 'http://loinc.org').map((c: any) => c.code))]
  if (loinc.length) return loinc.length === 1 && supported.has(loinc[0]) ? loinc[0] : undefined
  if (!isVghtpeSource(resource)) return undefined
  const local = [...new Set<string>((resource.code?.coding ?? []).filter((c: any) => ['urn:oid:his.lab.code', 'urn:oid:vgh.lab.abbrev'].includes(c.system))
    .map((c: any) => aliases[text(c.code).toUpperCase()]).filter(Boolean))]
  return local.length === 1 ? local[0] : undefined
}
function day(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const instant = Date.parse(value)
    return Number.isFinite(instant) && utcDay(instant) === value ? value : undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined
  const instant = Date.parse(value)
  return Number.isFinite(instant) ? taipeiDay(instant) : undefined
}
function unit(resource: Resource): string {
  const q = resource.valueQuantity
  if (q?.system && q.system !== 'http://unitsofmeasure.org') return ''
  const value = text(q?.code || q?.unit)
  return value === 'mIU/mL' ? 'm[iU]/mL' : value
}
function compatible(hospital: Resource, cloud: Resource): boolean {
  if (hospital.status !== 'final' || cloud.status !== 'final') return false
  if ([hospital, cloud].some(r => r.component?.length || r.hasMember?.length || r.dataAbsentReason || r.effectivePeriod || r.modifierExtension?.length)) return false
  const a = hospital.valueQuantity, b = cloud.valueQuantity
  if (typeof a?.value !== 'number' || !Number.isFinite(a.value) || a.value !== b?.value || !unit(hospital) || unit(hospital) !== unit(cloud)
    || (a.comparator || '') !== (b.comparator || '')) return false
  const hTime = hospital.effectiveDateTime, cTime = cloud.effectiveDateTime
  if (hTime.includes('T') && cTime.includes('T') && Date.parse(hTime) !== Date.parse(cTime)) return false
  const specimen = (r: Resource) => text(r.specimen?.display).toUpperCase()
  const hSpecimen = specimen(hospital), cSpecimen = specimen(cloud)
  if (!['SERUM', 'SERUM_RG', 'SERUM R', '血清'].includes(hSpecimen) || !['BLOOD', 'SERUM', '血液', '血清'].includes(cSpecimen)) return false
  // Missing cloud metadata may be supplemented by the hospital result, but
  // two explicit, conflicting assertions are never folded together.
  for (const field of ['interpretation', 'referenceRange', 'method', 'bodySite']) {
    if (hospital[field] && cloud[field] && !clinicalSourceResourcesEqual(hospital[field], cloud[field])) return false
  }
  if (hospital.issued && cloud.issued && Date.parse(hospital.issued) !== Date.parse(cloud.issued)) return false
  for (const id of hospital.identifier ?? []) {
    const others = (cloud.identifier ?? []).filter((other: any) => id.system && other.system === id.system && other.value)
    if (others.length && !others.some((other: any) => other.value === id.value)) return false
  }
  return true
}

/** App display policy for the three assays from cloud draft #35. Count all
 * same-day candidates BEFORE comparing values, so multiple collections never
 * become a unique match just because only one happens to have an equal value.
 * Returned aliases leave every original resource in the immutable source graph. */
export function findLabSourcePairs(nodes: readonly ClinicalSourceNode[], graph: ClinicalSourceGraph): Map<string, string> {
  const graphNodes = new Map(graph.nodes.map(node => [node.key, node]))
  const edges = new Map(graph.references.map(edge => [edge.origin.key + '|' + edge.path, edge]))
  const buckets = new Map<string, { hospital: ClinicalSourceNode[]; cloud: ClinicalSourceNode[] }>()
  for (const node of nodes) {
    const r = node.resource as Resource
    if (r.resourceType !== 'Observation' || node.isContained || node.embeddedIn) continue
    if (!Array.isArray(r.code?.coding) || r.code.coding.some((c: any) => !c) || !Array.isArray(r.performer) || r.performer.some((p: any) => !p || typeof p !== 'object')
      || (r.meta?.tag !== undefined && (!Array.isArray(r.meta.tag) || r.meta.tag.some((t: any) => !t)))
      || (r.identifier !== undefined && (!Array.isArray(r.identifier) || r.identifier.some((id: any) => !id)))) continue
    const hospital = isVghtpeSource(r), cloud = isMedcloudSource(r)
    if (hospital === cloud) continue
    const code = analyte(r), date = day(r.effectiveDateTime)
    const subject = edges.get(node.key + '|subject')
    if (!code || !date || subject?.status !== 'resolved' || subject.targetKeys.length !== 1) continue
    const patient = graphNodes.get(subject.targetKeys[0])
    if (patient?.resource.resourceType !== 'Patient') continue
    const performers: string[] = (r.performer ?? []).map((p: any, index: number) => {
      if (!p.reference) return text(p.display)
      const edge = edges.get(node.key + `|performer[${index}]`)
      const actor = edge?.status === 'resolved' && edge.targetKeys.length === 1 ? graphNodes.get(edge.targetKeys[0])?.resource : undefined
      return actor?.resourceType === 'Organization' ? text(actor.name) : ''
    })
    if (!performers.length || performers.some(name => !hospitals.has(name))) continue
    const key = JSON.stringify([node.patientScope, subject.targetKeys[0], date, code])
    const bucket = buckets.get(key) ?? { hospital: [], cloud: [] }
    bucket[hospital ? 'hospital' : 'cloud'].push(node)
    buckets.set(key, bucket)
  }
  const pairs = new Map<string, string>()
  for (const { hospital, cloud } of buckets.values()) {
    if (hospital.length === 1 && cloud.length === 1 && compatible(hospital[0].resource, cloud[0].resource)) pairs.set(cloud[0].key, hospital[0].key)
  }
  return pairs
}
