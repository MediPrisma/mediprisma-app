import { z } from 'zod'

// Frozen historical reader, aligned with mediprisma-fhir-server/src/contract-v2.mjs.
// Do not derive this from the current writer: future writer changes must not
// invalidate stored v2 records. A new stored format needs a separate reader.
const key = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/)
export const storedUuidV2 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

/** Normalize a copy for validation/display only; never rewrite the snapshot. */
export function storedTimestampForDisplay(value: string): string {
  return value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/(T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/, '$1:00$2')
}
export const storedTimestampV2 = z.string().refine(value =>
  z.string().datetime({ offset: true }).safeParse(storedTimestampForDisplay(value)).success &&
  !Number.isNaN(Date.parse(storedTimestampForDisplay(value))))
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)
const json: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json),
]))
const record = z.record(z.string(), json)
const interaction = z.object({
  kind: z.literal('interaction'), occurred_at: storedTimestampV2, pack_id: key,
  action: z.enum(['disease_selected', 'layout_selected', 'page_reset', 'evidence_toggled', 'manual_test_value_changed']),
  target: key.optional(), enabled: z.boolean().optional(),
}).strict()
const assessment = z.object({
  kind: z.literal('assessment'), occurred_at: storedTimestampV2, pack_id: key,
  changes: z.array(z.object({
    field_id: key, target_id: key.optional(),
    value: z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()]),
    measured_on: date.optional(),
  }).strict()).min(1).max(32),
}).strict()
const saveSchema = z.object({
  schema_version: z.literal(2), save_id: storedUuidV2,
  saved_at: storedTimestampV2, site: z.literal('vghtpe'), patient_session_id: storedUuidV2,
  patient_key_version: z.literal(1), patient_key_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  patient_identity: z.object({
    name_masked: z.string().min(2).max(120).refine(value => value.includes('○')),
    birth_year: z.string().regex(/^\d{4}$/),
    identifier_masked: z.string().regex(/^[A-Z][0-9X*＊○〇●Ｏ◯]{9}$/u)
      .refine(value => /[X*＊○〇●Ｏ◯]/u.test(value.slice(1))),
    identifier_system: z.string().min(1).max(200).regex(/national[-_]?id/i),
  }).strict(),
  pack_id: key, app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  build_revision: z.string().regex(/^(?:[a-f0-9]{7,40}|unknown)$/),
  profile: record, result: record, physician_inputs: record, physician_decisions: record,
  source_records: z.array(z.object({
    resource_type: z.string().max(40), resource_id: z.string().max(200),
    source_institution: z.string().max(200).nullable(), source_system: z.string().max(200).nullable(),
  }).strict()).max(2000),
  events: z.array(z.discriminatedUnion('kind', [interaction, assessment])).max(500),
}).strict().superRefine((save, ctx) => {
  if (!save.profile.facts || typeof save.profile.facts !== 'object' || Array.isArray(save.profile.facts) ||
      !Object.keys(save.profile.facts).length ||
      ['id', 'patient', 'birthDate', 'name'].some(field => save.profile[field] !== undefined) ||
      save.result.packId !== save.pack_id || typeof save.result.packVersion !== 'string' || !save.result.packVersion) {
    ctx.addIssue({ code: 'custom', message: 'Invalid clinical snapshot structure' })
  }
})

export function parseStoredCdssSaveV2(value: unknown): z.infer<typeof saveSchema> {
  // Check traversal bounds before invoking the recursive JSON parser.
  const stack = [{ value, depth: 0 }]
  let count = 0
  while (stack.length) {
    const item = stack.pop()!
    if (++count > 100_000 || item.depth > 64) throw new Error('cdss_history_unavailable')
    if (item.value !== null && typeof item.value === 'object') {
      const children: unknown[] = Object.values(item.value)
      if (count + stack.length + children.length > 100_000) throw new Error('cdss_history_unavailable')
      for (const child of children) stack.push({ value: child, depth: item.depth + 1 })
    }
  }
  const parsed = saveSchema.parse(value)
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 4 * 1024 * 1024)
    throw new Error('cdss_history_unavailable')
  return parsed
}
