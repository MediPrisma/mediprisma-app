'use client'

import { z } from 'zod'
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import { isCollectorSite } from '@/src/application/telemetry/collector'
import { captureFhirRequestAuth } from './fhir-auth'
import { parseStoredCdssSaveV2, storedTimestampV2, storedUuidV2 } from '@/src/shared/contracts/cdss-stored-save-v2'
import { cdssPatientIdentity } from './patient-identity'
import { cdssEndpoint } from './cdss-gateway'

const index = z.object({ saveId: storedUuidV2,
  documentId: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/), patientId: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/),
  receivedAt: z.string().datetime({ offset: true }), packId: z.string().min(1).max(80),
  versionId: z.string().max(64).nullable() }).strict()
const list = z.object({ records: z.array(index).max(10), hasMore: z.boolean() }).strict()
const record = index.extend({ savedAt: storedTimestampV2, save: z.unknown().transform(parseStoredCdssSaveV2) })
export type CdssHistoryList = z.infer<typeof list>
export type CdssHistoryRecord = z.infer<typeof record>

async function request(patient: PatientEntity, path: string, saveId: string | undefined, signal: AbortSignal, ownerUid?: string) {
  const url = cdssEndpoint(path)
  if (!url || !isCollectorSite()) throw new Error('cdss_history_unavailable')
  const auth = await captureFhirRequestAuth(ownerUid)
  const identity = await cdssPatientIdentity(patient)
  const key = { site: 'vghtpe' as const, patient_key_version: 1 as const, patient_key_sha256: identity.patient_key_sha256 }
  const token = await auth.getToken()
  if (signal.aborted || !isCollectorSite() || !auth.isCurrent()) throw new Error('cdss_site_changed')
  const response = await fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...key, ...(saveId ? { save_id: saveId } : {}) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: 'omit',
    referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
  })
  if (response.status !== 200) throw new Error('cdss_history_unavailable')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('cdss_history_unavailable')
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > 5 * 1024 * 1024) throw new Error('cdss_history_unavailable')
      chunks.push(item.value)
    }
  } finally { await reader.cancel() }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  if (signal.aborted || !isCollectorSite() || !auth.isCurrent()) throw new Error('cdss_site_changed')
  return { data: JSON.parse(new TextDecoder().decode(body)), key }
}

export async function listCdssHistory(patient: PatientEntity, signal: AbortSignal, ownerUid?: string): Promise<CdssHistoryList> {
  return list.parse((await request(patient, '/cdss/v1/history', undefined, signal, ownerUid)).data)
}
const deleted = z.object({ status: z.literal('deleted'), save_id: storedUuidV2 }).strict()
/**
 * Retracts one of the signed-in clinician's own snapshots. The server marks it
 * entered-in-error and keeps it with its audit trail; it leaves the history
 * list and can no longer be read or carried forward.
 */
export async function deleteCdssHistory(patient: PatientEntity, saveId: string, signal: AbortSignal, ownerUid?: string): Promise<void> {
  const { data } = await request(patient, '/cdss/v1/history/delete', saveId, signal, ownerUid)
  if (deleted.parse(data).save_id !== saveId) throw new Error('cdss_history_unavailable')
}
export async function readCdssHistory(patient: PatientEntity, saveId: string, signal: AbortSignal, ownerUid?: string): Promise<CdssHistoryRecord> {
  const { data, key } = await request(patient, '/cdss/v1/history/read', saveId, signal, ownerUid)
  const parsed = record.parse(data)
  if (parsed.saveId !== saveId || parsed.save.save_id !== saveId || parsed.save.site !== key.site ||
      parsed.save.patient_key_version !== key.patient_key_version || parsed.save.patient_key_sha256 !== key.patient_key_sha256 ||
      parsed.packId !== parsed.save.pack_id || parsed.savedAt !== parsed.save.saved_at) throw new Error('cdss_history_unavailable')
  return parsed
}
