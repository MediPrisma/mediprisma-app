import { reconcileClinicalSources, type ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import type { ClinicalSourceCapture } from '@/src/core/services/clinical-source-graph'

export interface ClinicalSourceSession {
  readonly sourceId: string
  readonly restBase?: string
  generation: number
  readonly captures: Map<string, ClinicalSourceCapture>
  readonly successfulResponses: Map<string, any>
  readonly results: Map<string, { generation: number; result: ClinicalReconciliationResult }>
}
const sessions = new WeakMap<object, Map<string, ClinicalSourceSession>>()
const bindings = new WeakMap<object, ClinicalSourceSession>()
let sequence = 0

/** Sessions are keyed by the actual authenticated client, then its server base.
 * Weak keys release all captures when an old authenticated client is discarded. */
export function clinicalSourceSession(client: object, restBase?: string, owner?: object): ClinicalSourceSession {
  let servers = sessions.get(client)
  if (!servers) { servers = new Map(); sessions.set(client, servers) }
  const base = restBase?.replace(/\/+$/, '')
  let session = servers.get(base ?? '')
  if (!session) {
    session = { sourceId: `smart-session-${++sequence}`, restBase: base, generation: 0, captures: new Map(), successfulResponses: new Map(), results: new Map() }
    servers.set(base ?? '', session)
  }
  if (owner) bindings.set(owner, session)
  return session
}
export function forgetClinicalSourceSession(owner: object): void { bindings.delete(owner) }
export function knownClinicalSourceSession(owner: object): ClinicalSourceSession | undefined { return bindings.get(owner) }

export function captureClinicalSource(session: ClinicalSourceSession, queryKey: string, patientScope: string, resources: ClinicalSourceCapture['resources']): ClinicalReconciliationResult {
  const capture: ClinicalSourceCapture = {
    sourceId: session.sourceId, restBase: session.restBase, patientScope,
    generation: String(++session.generation), resources: JSON.parse(JSON.stringify(resources)),
  }
  session.captures.set(JSON.stringify([patientScope, queryKey]), capture)
  return reconcileClinicalSources([capture])
}
export function readClinicalSource(session: ClinicalSourceSession, patientScope: string): ClinicalReconciliationResult {
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
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export function invalidateClinicalSource(session: ClinicalSourceSession, queryKey: string, patientScope: string): void {
  session.successfulResponses.delete(queryKey)
  session.captures.delete(JSON.stringify([patientScope, queryKey]))
  session.generation++
}
