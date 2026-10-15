// Canonical wire contracts v2-v6. Generate the APP copy with scripts/sync-collector-contract.mjs.
// Only declared metadata; no arbitrary objects, URLs, messages or clinical text.
import { z } from 'zod'

export const resourceBucketSchema = z.enum(['0', '1-10', '11-50', '51-200', '201-1000', '1000+'])
export const resourceBucketsSchema = z.object({
  total: resourceBucketSchema.optional(), encounters: resourceBucketSchema.optional(),
  medications: resourceBucketSchema.optional(), observations: resourceBucketSchema.optional(),
  reports: resourceBucketSchema.optional(), documents: resourceBucketSchema.optional(),
}).strict()
export const featureSchema = z.enum([
  'summary', 'safety', 'med_recon', 'insights', 'report_interp', 'chat',
  'transcription', 'literature', 'nhi_lipid', 'ips_inference', 'chat_followup',
  'prompt_example', 'ai_other',
])
export const errorClassSchema = z.enum([
  'error', 'timeout', 'aborted', 'context_overflow', 'quota', 'parse_failed',
  'network', 'authentication', 'rate_limited', 'upstream', 'validation_failed',
])
export const collectorModelSchema = z.enum([
  'gpt-5.4-nano', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol',
  'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.1-pro-preview',
  'claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
  'custom', 'unknown', 'whisper-1', 'provider-managed',
])
const elapsed = z.number().int().min(0).max(86_400_000)
const collectorEventBaseSchema = z.object({
  schema_version: z.literal(2), event_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }), site: z.literal('vghtpe'),
  feature: featureSchema,
  provider: z.enum(['openai', 'gemini', 'anthropic', 'custom', 'perplexity', 'unknown']),
  model: collectorModelSchema,
  model_source: z.enum(['configured', 'reported', 'unreported']),
  sample_kind: z.enum(['feature', 'request']),
  latency_ms: elapsed,
  status: z.enum(['completed', 'error', 'aborted']),
  error_class: errorClassSchema.nullable(),
  // v2: transport completion can be true even when later parsing fails.
  response_complete: z.boolean().nullable(),
  app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  build_revision: z.string().regex(/^(?:[a-f0-9]{7,40}|unknown)$/),
  diagnostics: z.object({
    phase: z.enum(['request', 'stream', 'parse', 'validation', 'unknown']),
    mode: z.enum(['standard', 'agent', 'query', 'stream', 'audio', 'search', 'structured']),
    loaded: resourceBucketsSchema.optional(),
    prepared: resourceBucketsSchema.optional(),
    prepared_count_basis: z.literal('structured_input_upper_bound').optional(),
    context_tokens_bucket: z.enum(['0', '1-2000', '2001-8000', '8001-32000', '32001-128000', '128000+']).optional(),
    first_chunk_ms: elapsed.optional(),
    http_status: z.number().int().min(100).max(599).optional(),
    context_trimmed: z.boolean().optional(),
  }).strict(),
}).strict()
function validateOutcome(e: {
  status: string; error_class: string | null; latency_ms: number;
  diagnostics: { first_chunk_ms?: number; prepared?: unknown; prepared_count_basis?: string };
}, ctx: z.RefinementCtx) {
  if ((e.status === 'completed' && e.error_class !== null) || (e.status !== 'completed' && e.error_class === null)) {
    ctx.addIssue({ code: 'custom', message: 'Outcome and error classification disagree' })
  }
  if (e.diagnostics.first_chunk_ms !== undefined && e.diagnostics.first_chunk_ms > e.latency_ms) {
    ctx.addIssue({ code: 'custom', message: 'First chunk exceeds total duration' })
  }
  if (Boolean(e.diagnostics.prepared) !== Boolean(e.diagnostics.prepared_count_basis)) {
    ctx.addIssue({ code: 'custom', message: 'Prepared counts require their measurement basis' })
  }
}
export const collectorEventV2Schema = collectorEventBaseSchema.superRefine(validateOutcome)
export type CollectorEventV2 = z.infer<typeof collectorEventV2Schema>

// Identity and network/room attribution are SERVER-owned, never accepted here.
export const collectorEventV3Schema = collectorEventBaseSchema.extend({
  schema_version: z.literal(3),
  browser_id: z.string().uuid(),
  browser_id_scope: z.enum(['persistent', 'page']),
}).strict().superRefine(validateOutcome)
export type CollectorEventV3 = z.infer<typeof collectorEventV3Schema>

// v4 preserves exact non-negative resource counts; v2/v3 keep their historical buckets.
const resourceCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const resourceCountsSchema = z.object({
  total: resourceCountSchema.optional(), encounters: resourceCountSchema.optional(),
  medications: resourceCountSchema.optional(), observations: resourceCountSchema.optional(),
  reports: resourceCountSchema.optional(), documents: resourceCountSchema.optional(),
}).strict()
const collectorEventV4BaseSchema = collectorEventBaseSchema.extend({
  schema_version: z.literal(4),
  browser_id: z.string().uuid(),
  browser_id_scope: z.enum(['persistent', 'page']),
  diagnostics: collectorEventBaseSchema.shape.diagnostics.extend({
    loaded: resourceCountsSchema.optional(),
    prepared: resourceCountsSchema.optional(),
  }).strict(),
}).strict()
export const collectorEventV4Schema = collectorEventV4BaseSchema.superRefine(validateOutcome)
export type CollectorEventV4 = z.infer<typeof collectorEventV4Schema>

// v5: exact terminal counts for this summary run, including its internal retries.
// Retained cards from earlier runs are not counted again. No clinical content.
export const summaryCardCountsSchema = z.object({
  succeeded: z.number().int().min(0).max(6),
  failed: z.number().int().min(0).max(6),
}).strict()
export type SummaryCardCounts = z.infer<typeof summaryCardCountsSchema>
export const collectorEventV5Schema = collectorEventV4BaseSchema.extend({
  schema_version: z.literal(5),
  diagnostics: collectorEventV4BaseSchema.shape.diagnostics.extend({
    summary_cards: summaryCardCountsSchema.optional(),
  }).strict(),
}).strict().superRefine((e, ctx) => {
  validateOutcome(e, ctx)
  const cards = e.diagnostics.summary_cards
  if (!cards) return
  if (e.feature !== 'summary' || e.sample_kind !== 'feature' ||
      cards.succeeded + cards.failed < 1 || cards.succeeded + cards.failed > 6 ||
      e.status !== (cards.failed === 0 ? 'completed' : 'error')) {
    ctx.addIssue({ code: 'custom', message: 'Summary card counts and feature outcome disagree' })
  }
})
export type CollectorEventV5 = z.infer<typeof collectorEventV5Schema>

// v6: one operation contains bounded, ordered request observations. No bodies or identity.
export const MAX_COLLECTOR_REQUEST_DETAILS = 64
const requestBaseSchema = collectorEventBaseSchema.pick({
  provider: true, model: true, model_source: true, latency_ms: true,
  error_class: true, response_complete: true,
}).extend({
  status: z.enum(['completed', 'error', 'aborted', 'incomplete']),
  phase: collectorEventBaseSchema.shape.diagnostics.shape.phase,
  mode: collectorEventBaseSchema.shape.diagnostics.shape.mode,
  first_chunk_ms: elapsed.optional(),
  http_status: z.number().int().min(100).max(599).optional(),
}).strict()
export const collectorRequestSchema = requestBaseSchema.superRefine((r, ctx) => {
  if (r.status === 'incomplete') {
    if (r.error_class !== null || r.response_complete !== null)
      ctx.addIssue({ code: 'custom', message: 'Incomplete observation has no terminal outcome' })
  } else {
    validateOutcome({ ...r, diagnostics: { first_chunk_ms: r.first_chunk_ms } }, ctx)
  }
})
export type CollectorRequest = z.infer<typeof collectorRequestSchema>
const operationRequestsSchema = z.object({
  count: resourceCountSchema,
  omitted: resourceCountSchema,
  details: z.array(collectorRequestSchema).max(MAX_COLLECTOR_REQUEST_DETAILS),
}).strict().superRefine((r, ctx) => {
  if (r.count !== r.details.length + r.omitted)
    ctx.addIssue({ code: 'custom', message: 'Request count must include every retained and omitted observation' })
})
export const collectorEventV6Schema = collectorEventV4BaseSchema.extend({
  schema_version: z.literal(6),
  diagnostics: collectorEventV4BaseSchema.shape.diagnostics.extend({
    summary_cards: summaryCardCountsSchema.optional(),
    requests: operationRequestsSchema.optional(),
  }).strict(),
}).strict().superRefine((e, ctx) => {
  // Reuse every v5 invariant rather than maintaining another copy.
  const { requests, ...diagnostics } = e.diagnostics
  const legacy = collectorEventV5Schema.safeParse({ ...e, schema_version: 5, diagnostics })
  if (!legacy.success)
    for (const issue of legacy.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  if (requests && e.sample_kind !== 'feature')
    ctx.addIssue({ code: 'custom', message: 'Only operation events contain request observations' })
})
export type CollectorEventV6 = z.infer<typeof collectorEventV6Schema>
