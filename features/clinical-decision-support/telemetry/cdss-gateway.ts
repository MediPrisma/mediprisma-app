'use client'

import type { CdssPatientProfile, CdssResult } from '@voho0000/personalized-care'
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import { cdssAssessmentSchema, cdssGatewaySaveSchema, cdssInteractionSchema, type CdssAssessmentChange, type CdssGatewayEvent, type CdssSource } from '@/src/shared/contracts/cdss-gateway-event'
import { isCollectorSite } from '@/src/application/telemetry/collector'
import { captureFhirRequestAuth } from './fhir-auth'
import { buildPatientNamePatterns, buildPatientTextLiterals, scrubFreeText } from '@/src/shared/utils/pii-text-scrub'
import { cdssPatientIdentity } from './patient-identity'

type EventBody =
  | { kind: 'interaction'; action: Extract<CdssGatewayEvent, { kind: 'interaction' }>['action']; target?: string; enabled?: boolean }
  | { kind: 'assessment'; changes: CdssAssessmentChange[] }

const MAX_EVENTS = 500
const MAX_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 15000
const pending = new Map<string, CdssGatewayEvent[]>()
const patientSessions = new Map<string, string>()
const retryable = new Map<string, { content: string; saveId: string; savedAt: string }>()
const active = new Set<AbortController>()

export function cdssEndpoint(path = '/cdss/v1/saves'): string | null {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_CDSS_API_ORIGIN || 'http://127.0.0.1:8098')
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return null
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) return null
    return `${origin.origin}${path}`
  } catch { return null }
}

function sessionFor(patientId: string): string {
  let session = patientSessions.get(patientId)
  if (!session) {
    session = crypto.randomUUID()
    patientSessions.set(patientId, session)
  }
  return session
}

/** Records local UI actions only. Network traffic begins in saveCdssSnapshot. */
export function recordCdssEvent(patientId: string, packId: string, body: EventBody): void {
  if (!patientId || !isCollectorSite()) return
  const candidate = {
    ...body, pack_id: packId, occurred_at: new Date().toISOString(),
  }
  const parsed = body.kind === 'assessment'
    ? cdssAssessmentSchema.safeParse(candidate)
    : cdssInteractionSchema.safeParse(candidate)
  if (!parsed.success) return
  const event = parsed.data
  const events = pending.get(patientId) ?? []
  if (events.length >= MAX_EVENTS) events.shift()
  events.push(event)
  pending.set(patientId, events)
}

export function cdssGatewayStatus() {
  return { enabled: isCollectorSite() && cdssEndpoint() !== null,
    pending_events: [...pending.values()].reduce((sum, events) => sum + events.length, 0),
    saving: active.size > 0 }
}

function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('cdss_site_changed'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    work.then(value => { signal.removeEventListener('abort', cancel); resolve(value) },
      error => { signal.removeEventListener('abort', cancel); reject(error) })
  })
}

export async function saveCdssSnapshot(input: {
  /** Expected UI account; never serialized or accepted as server authorization. */
  ownerUid?: string
  patient: PatientEntity
  packId: string
  profile: CdssPatientProfile
  result: CdssResult
  physicianInputs: Record<string, unknown>
  physicianDecisions: Record<string, unknown>
  sourceRecords: CdssSource[]
}): Promise<void> {
  const patientId = input.patient.id
  if (!patientId || !isCollectorSite()) throw new Error('cdss_site_unavailable')
  const url = cdssEndpoint()
  if (!url) throw new Error('cdss_endpoint_unavailable')
  const controller = new AbortController()
  active.add(controller)
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // Freeze the click-time snapshot BEFORE asynchronous identity preparation.
    const events = [...(pending.get(patientId) ?? [])]
    const piiLiterals = buildPatientTextLiterals(input.patient)
    const piiNamePatterns = buildPatientNamePatterns(input.patient)
    const { id: _patientId, ...profileWithoutPatientId } = input.profile
    const payload = {
      site: 'vghtpe', patient_session_id: sessionFor(patientId), pack_id: input.packId,
      app_version: process.env.NEXT_PUBLIC_COLLECTOR_APP_VERSION || '0.0.0',
      build_revision: process.env.NEXT_PUBLIC_COLLECTOR_BUILD_REVISION || 'unknown',
      profile: profileWithoutPatientId, result: input.result,
      physician_inputs: input.physicianInputs, physician_decisions: input.physicianDecisions,
      source_records: input.sourceRecords, events,
    }
    // Scope machine fields to their schema objects; a narrative field named
    // 'action' or 'id' inside physician input must still receive name masking.
    const machineFields = new WeakMap<object, Set<string>>()
    machineFields.set(payload, new Set(['site', 'patient_session_id', 'pack_id', 'app_version', 'build_revision']))
    machineFields.set(input.result, new Set(['packId', 'packVersion']))
    for (const event of events) {
      machineFields.set(event, new Set(['kind', 'occurred_at', 'pack_id', 'action', 'target']))
      if (event.kind === 'assessment') for (const change of event.changes) {
        machineFields.set(change, new Set(['field_id', 'target_id', 'measured_on']))
      }
    }
    for (const source of input.sourceRecords) machineFields.set(source, new Set(['resource_type', 'resource_id']))
    const content = JSON.parse(JSON.stringify(payload, function (this: object, key, value: unknown) {
      if (typeof value !== 'string') return value
      const holder = this as { resourceType?: string; resource_type?: string }
      if (value === patientId && (key === 'patientId' || key === 'patient_id' ||
        (holder.resourceType === 'Patient' && (key === 'resourceId' || key === 'id')) ||
        (holder.resource_type === 'Patient' && key === 'resource_id'))) return '[redacted]'
      if (value === `Patient/${patientId}`) return 'Patient/[redacted]'
      // Name wildcards apply to narrative content, not machine keys/enums.
      const structural = machineFields.get(this)?.has(key) ||
        (Boolean(holder.resourceType || holder.resource_type) &&
          ['resourceType', 'resource_type', 'resourceId', 'resource_id', 'id'].includes(key))
      return scrubFreeText(value, piiLiterals, structural ? [] : piiNamePatterns)
    }))
    const [auth, identity] = await cancellable(Promise.all([
      captureFhirRequestAuth(input.ownerUid), cdssPatientIdentity(input.patient),
    ]), controller.signal)
    if (!isCollectorSite() || controller.signal.aborted || !auth.isCurrent()) throw new Error('cdss_site_changed')
    const signature = JSON.stringify({ ...identity, ...content })
    const retryKey = `${auth.uid}:${patientId}`
    const previous = retryable.get(retryKey)
    const receipt = previous?.content === signature
      ? previous : { content: signature, saveId: crypto.randomUUID(), savedAt: new Date().toISOString() }
    const parsed = cdssGatewaySaveSchema.parse({ schema_version: 2, save_id: receipt.saveId,
      saved_at: receipt.savedAt, ...identity, ...content })
    const body = JSON.stringify(parsed)
    if (new TextEncoder().encode(body).length > MAX_BYTES) throw new Error('cdss_payload_too_large')
    retryable.set(retryKey, receipt)
    const token = await cancellable(auth.getToken(), controller.signal)
    if (!isCollectorSite() || controller.signal.aborted || !auth.isCurrent()) throw new Error('cdss_site_changed')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body, signal: controller.signal,
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    })
    if (response.status !== 201) throw new Error('cdss_gateway_rejected')
    const ack = await response.json() as { status?: string; save_id?: string }
    if (!isCollectorSite() || controller.signal.aborted || !auth.isCurrent()) throw new Error('cdss_site_changed')
    if (ack.status !== 'stored' || ack.save_id !== parsed.save_id) throw new Error('cdss_gateway_unconfirmed')
    const current = pending.get(patientId) ?? []
    const saved = new Set(events)
    pending.set(patientId, current.filter((event) => !saved.has(event)))
    retryable.delete(retryKey)
  } finally {
    clearTimeout(timer)
    active.delete(controller)
  }
}

export function cancelCdssGatewayRequests(): void {
  for (const controller of active) controller.abort()
  active.clear()
  pending.clear()
  patientSessions.clear()
  retryable.clear()
}

declare global {
  interface Window {
    mediprismaCdssGateway?: { status: typeof cdssGatewayStatus }
  }
}

if (typeof window !== 'undefined') {
  window.mediprismaCdssGateway = Object.freeze({ status: cdssGatewayStatus })
  window.addEventListener('pagehide', cancelCdssGatewayRequests)
}
