import { z } from 'zod'
import { parseStoredCdssSaveV2 } from './cdss-stored-save-v2'

// Frozen historical reader for schema_version 3, aligned with
// mediprisma-fhir-server/src/contract-v3.mjs: the v2 snapshot plus an optional
// HIS medical record number. The v2 reader stays unchanged.
const mrn = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/)

type StoredV2 = ReturnType<typeof parseStoredCdssSaveV2>
export type StoredCdssSave = Omit<StoredV2, 'schema_version' | 'patient_identity'> & {
  schema_version: 2 | 3
  patient_identity: StoredV2['patient_identity'] & { mrn?: string }
}

export function parseStoredCdssSaveV3(value: unknown): StoredCdssSave {
  const save = value as { schema_version?: unknown; patient_identity?: unknown } | null
  if (save?.schema_version !== 3 || !save.patient_identity || typeof save.patient_identity !== 'object')
    throw new Error('cdss_history_unavailable')
  const { mrn: rawMrn, ...identity } = save.patient_identity as Record<string, unknown>
  if (rawMrn !== undefined && !mrn.safeParse(rawMrn).success) throw new Error('cdss_history_unavailable')
  const parsed = parseStoredCdssSaveV2({ ...save, schema_version: 2, patient_identity: identity })
  return { ...parsed, schema_version: 3,
    patient_identity: { ...parsed.patient_identity, ...(rawMrn === undefined ? {} : { mrn: rawMrn as string }) } }
}

export function parseStoredCdssSave(value: unknown): StoredCdssSave {
  return (value as { schema_version?: unknown } | null)?.schema_version === 3
    ? parseStoredCdssSaveV3(value) : parseStoredCdssSaveV2(value)
}
