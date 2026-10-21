import { reconcileClinicalSources, type ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import type { ClinicalSourceCapture } from '@/src/core/services/clinical-source-graph'

export interface ClinicalSourceSession {
  readonly sourceId: string
  readonly restBase?: string
  revoked: boolean
  generation: number
  readonly captures: Map<string, ClinicalSourceCapture>
  readonly successfulResponses: Map<string, any>
  readonly results: Map<string, { generation: number; result: ClinicalReconciliationResult }>
}
const sessions = new WeakMap<object, Map<string, ClinicalSourceSession>>()
const bindings = new WeakMap<object, ClinicalSourceSession>()
const ownerClients = new WeakMap<object, object>()
let sequence = 0
const revokedClinicalSource = reconcileClinicalSources([])

/** Sessions are keyed by the actual authenticated client, then its server base.
 * Weak keys release all captures when an old authenticated client is discarded. */
export function clinicalSourceSession(client: object, restBase?: string, owner?: object): ClinicalSourceSession {
  if (owner && ownerClients.get(owner) && ownerClients.get(owner) !== client) purgeClinicalSourceSession(owner)
  let servers = sessions.get(client)
  if (!servers) { servers = new Map(); sessions.set(client, servers) }
  const base = restBase?.replace(/\/+$/, '')
  let session = servers.get(base ?? '')
  if (!session) {
    session = { sourceId: `smart-session-${++sequence}`, restBase: base, revoked: false, generation: 0, captures: new Map(), successfulResponses: new Map(), results: new Map() }
    servers.set(base ?? '', session)
  }
  if (owner) { ownerClients.set(owner, client); bindings.set(owner, session) }
  return session
}
export function purgeClinicalSourceSession(owner: object): void {
  const client = ownerClients.get(owner)
  for (const session of client ? sessions.get(client)?.values() ?? [] : []) {
    session.revoked = true
    session.captures.clear()
    session.successfulResponses.clear()
    session.results.clear()
    session.generation++
  }
  if (client) sessions.delete(client)
  bindings.delete(owner)
  ownerClients.delete(owner)
}
export function forgetClinicalSourceSession(owner: object): void { purgeClinicalSourceSession(owner) }
export function knownClinicalSourceSession(owner: object): ClinicalSourceSession | undefined { return bindings.get(owner) }

export function captureClinicalSource(session: ClinicalSourceSession, queryKey: string, patientScope: string, resources: ClinicalSourceCapture['resources']): ClinicalReconciliationResult {
  if (session.revoked) throw new Error('FHIR session changed during query')
  const capture: ClinicalSourceCapture = {
    sourceId: session.sourceId, restBase: session.restBase, patientScope,
    generation: String(++session.generation), resources: mutableClinicalProjection(resources),
  }
  session.captures.set(JSON.stringify([patientScope, queryKey]), capture)
  return reconcileClinicalSources([capture])
}
export function readClinicalSource(session: ClinicalSourceSession, patientScope: string): ClinicalReconciliationResult {
  if (session.revoked) return revokedClinicalSource
  const cached = session.results.get(patientScope)
  if (cached?.generation === session.generation) return cached.result
  const result = reconcileClinicalSources([...session.captures.values()].filter(capture => capture.patientScope === patientScope))
  session.results.set(patientScope, { generation: session.generation, result })
  return result
}

export function clearClinicalSourceQuery(session: ClinicalSourceSession, queryKey: string): void {
  for (const [key, capture] of session.captures) {
    const [, capturedQuery] = JSON.parse(key)
    if (capturedQuery === queryKey) captureClinicalSource(session, queryKey, capture.patientScope, [])
  }
}

/** Mapper projections may be mutable; the source graph remains immutable. */
export function mutableClinicalProjection<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => mutableClinicalProjection(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mutableClinicalProjection(item)])) as T
  }
  return value
}

export function invalidateClinicalSource(session: ClinicalSourceSession, queryKey: string, patientScope: string): void {
  session.successfulResponses.delete(queryKey)
  session.captures.delete(JSON.stringify([patientScope, queryKey]))
  session.generation++
}
