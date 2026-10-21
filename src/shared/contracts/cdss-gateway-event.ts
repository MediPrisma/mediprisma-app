import { z } from 'zod'

const key = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/)
const answer = z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()])

export const cdssInteractionSchema = z.object({
  kind: z.literal('interaction'),
  occurred_at: z.string().datetime({ offset: true }),
  pack_id: key,
  action: z.enum(['disease_selected', 'layout_selected', 'page_reset', 'evidence_toggled', 'manual_test_value_changed']),
  target: key.optional(),
  enabled: z.boolean().optional(),
}).strict()

export const cdssAssessmentSchema = z.object({
  kind: z.literal('assessment'),
  occurred_at: z.string().datetime({ offset: true }),
  pack_id: key,
  changes: z.array(z.object({
    field_id: key,
    target_id: key.optional(),
    value: answer,
    measured_on: z.iso.date().optional(),
  }).strict()).min(1).max(32),
}).strict()

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValue), z.record(z.string(), jsonValue),
]))

export const cdssSourceSchema = z.object({
  resource_type: z.string().max(40),
  resource_id: z.string().max(200),
  source_institution: z.string().max(200).nullable(),
  source_system: z.string().max(200).nullable(),
}).strict()

/** One clinician-triggered save of the current CDSS inputs and assessment. */
export const cdssGatewaySaveSchema = z.object({
  schema_version: z.literal(2),
  save_id: z.string().uuid(),
  saved_at: z.string().datetime({ offset: true }),
  site: z.literal('vghtpe'),
  patient_session_id: z.string().uuid(),
  patient_key_version: z.literal(1),
  patient_key_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  patient_identity: z.object({
    name_masked: z.string().min(2).max(120).refine((value) => value.includes('○')),
    birth_year: z.string().regex(/^\d{4}$/),
    identifier_masked: z.string().regex(/^[A-Z][0-9X*＊○〇●Ｏ◯]{9}$/u)
      .refine((value) => /[X*＊○〇●Ｏ◯]/u.test(value.slice(1))),
    identifier_system: z.string().min(1).max(200),
  }).strict(),
  pack_id: key,
  app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  build_revision: z.string().regex(/^(?:[a-f0-9]{7,40}|unknown)$/),
  profile: z.record(z.string(), jsonValue),
  result: z.record(z.string(), jsonValue),
  physician_inputs: z.record(z.string(), jsonValue),
  physician_decisions: z.record(z.string(), jsonValue),
  source_records: z.array(cdssSourceSchema).max(2000),
  events: z.array(z.discriminatedUnion('kind', [cdssInteractionSchema, cdssAssessmentSchema])).max(500),
}).strict()

export type CdssGatewaySave = z.infer<typeof cdssGatewaySaveSchema>
export type CdssGatewayEvent = CdssGatewaySave['events'][number]
export type CdssAssessmentChange = z.infer<typeof cdssAssessmentSchema>['changes'][number]
export type CdssSource = z.infer<typeof cdssSourceSchema>
