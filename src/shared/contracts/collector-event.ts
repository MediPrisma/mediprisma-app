// Canonical wire contracts v2-v11, the hospital-capture event, plus the separate consented AI report. Generate the APP copy with scripts/sync-collector-contract.mjs.
// Event schemas permit metadata only. The separate AI report explicitly contains clinical text.
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
  'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-3.1-pro-preview',
  'claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5',
  'custom', 'unknown', 'whisper-1', 'provider-managed',
  // The hospital-managed endpoint profile names this model; any user-defined endpoint stays 'custom'.
  'tvghbrain3.5',
  // 北榮院內 Azure 的 Luna；醫析以固定代號回報，不讀端點回傳的自由字串。
  'gpt-6-luna',
])
// D089: model 不再限於上面的清單。另接受符合格式的模型名稱，包括新增的內建模型，以及使用者自訂端點設定的模型名稱。
// 格式：英數字開頭，只含英數字與 . _ : / -，最長 64 字，且不含 "://"。中文、空白、@、網址與錯誤訊息都不會通過；
// 不符合時 sender 改送 'custom'（自訂端點）或 'unknown'，不能直接送出原字串。上面的清單用於監看頁的中文名稱與單價。
export const COLLECTOR_MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/
export const isCollectorModelName = (value: string) => COLLECTOR_MODEL_NAME_PATTERN.test(value) && !value.includes('://')
export const collectorModelNameSchema = z.string().refine(isCollectorModelName, 'Model name is outside the allowed format')
const elapsed = z.number().int().min(0).max(86_400_000)
const collectorEventBaseSchema = z.object({
  schema_version: z.literal(2), event_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }), site: z.literal('vghtpe'),
  feature: featureSchema,
  provider: z.enum(['openai', 'gemini', 'anthropic', 'custom', 'perplexity', 'unknown']),
  model: collectorModelNameSchema,
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

// v7: random correlation IDs and measurements only. Never a patient/cache key,
// prompt, endpoint URL, exception message, model output, or parser excerpt.
export const summaryAttemptSchema = z.object({
  run_id: z.string().uuid(), request_id: z.string().uuid(),
  attempt: z.number().int().min(1).max(10000),
  lane: z.enum(['fast', 'full', 'batch', 'reports']),
  output_chars: resourceCountSchema,
  last_chunk_ms: elapsed.nullable(),
  parse_state: z.enum(['empty', 'incomplete', 'invalid', 'valid', 'unknown']),
}).strict()
export type SummaryAttempt = z.infer<typeof summaryAttemptSchema>
export const collectorEventV7Schema = collectorEventV4BaseSchema.extend({
  schema_version: z.literal(7),
  diagnostics: collectorEventV4BaseSchema.shape.diagnostics.extend({
    summary_attempt: summaryAttemptSchema,
  }).strict(),
}).strict().superRefine((e, ctx) => {
  validateOutcome(e, ctx)
  if (e.feature !== 'summary' || e.sample_kind !== 'request' ||
      (e.diagnostics.summary_attempt.last_chunk_ms ?? 0) > e.latency_ms)
    ctx.addIssue({ code: 'custom', message: 'Invalid summary attempt' })
})
export type CollectorEventV7 = z.infer<typeof collectorEventV7Schema>

// v8: a v6 summary operation that names its run. summary_run_id equals the random
// summary_attempt.run_id of the same run's v7 requests; never patient or cache derived.
export const collectorEventV8Schema = collectorEventV4BaseSchema.extend({
  schema_version: z.literal(8),
  diagnostics: collectorEventV4BaseSchema.shape.diagnostics.extend({
    summary_cards: summaryCardCountsSchema.optional(),
    requests: operationRequestsSchema.optional(),
    summary_run_id: z.string().uuid(),
  }).strict(),
}).strict().superRefine((e, ctx) => {
  // Reuse every v6 invariant rather than maintaining another copy.
  const { summary_run_id, ...diagnostics } = e.diagnostics
  const legacy = collectorEventV6Schema.safeParse({ ...e, schema_version: 6, diagnostics })
  if (!legacy.success)
    for (const issue of legacy.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  if (e.feature !== 'summary' || e.sample_kind !== 'feature')
    ctx.addIssue({ code: 'custom', message: 'Only summary operation events name a summary run' })
})
export type CollectorEventV8 = z.infer<typeof collectorEventV8Schema>

// v9: a custom summary (insights) request names its template, so the admin page can tell which
// template failed. The title is user-typed free text, sent as-is by explicit owner decision
// (D071); control characters are rejected and both fields are length-bounded.
// Rejects every Unicode control character (C0, DEL and C1), bidi controls and any unpaired surrogate.
const noControl = (value: string) => !/\p{Cc}/u.test(value) &&
  !/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(value) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
export const summaryTemplateSchema = z.object({
  id: z.string().min(1).max(128).refine(noControl, 'Template id contains control characters'),
  title: z.string().min(1).max(200).refine(noControl, 'Template title contains control characters'),
}).strict()
export type SummaryTemplate = z.infer<typeof summaryTemplateSchema>
export const collectorEventV9Schema = collectorEventV4BaseSchema.extend({
  schema_version: z.literal(9),
  diagnostics: collectorEventV4BaseSchema.shape.diagnostics.extend({
    template: summaryTemplateSchema,
  }).strict(),
}).strict().superRefine((e, ctx) => {
  validateOutcome(e, ctx)
  if (e.feature !== 'insights' || e.sample_kind !== 'request')
    ctx.addIssue({ code: 'custom', message: 'Only custom summary requests name a template' })
})
export type CollectorEventV9 = z.infer<typeof collectorEventV9Schema>

// v10 adds the client-claimed application surface to every new event while
// preserving each prior event shape. This is attribution metadata, not an
// authenticated source of truth; old v1-v9 rows remain readable as unknown.
export const collectorAppSurfaceSchema = z.enum(['app', 'app-hmc', 'other'])
export type CollectorAppSurface = z.infer<typeof collectorAppSurfaceSchema>
const collectorEventV10BaseSchema = collectorEventV4BaseSchema.extend({
  schema_version: z.literal(10),
  app_surface: collectorAppSurfaceSchema,
  medcloud_extension_version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/).optional(),
  diagnostics: collectorEventV4BaseSchema.shape.diagnostics.extend({
    summary_cards: summaryCardCountsSchema.optional(),
    requests: operationRequestsSchema.optional(),
    summary_attempt: summaryAttemptSchema.optional(),
    summary_run_id: z.string().uuid().optional(),
    template: summaryTemplateSchema.optional(),
  }).strict(),
}).strict()
export const collectorEventV10Schema = collectorEventV10BaseSchema.superRefine((e, ctx) => {
  validateOutcome(e, ctx)
  const { app_surface: _surface, medcloud_extension_version: _extensionVersion, ...base } = e
  const { summary_attempt, summary_run_id, template, ...diagnostics } = e.diagnostics
  const checkLegacy = (schema: z.ZodTypeAny, version: number, legacyDiagnostics: Record<string, unknown>) => {
    const parsed = schema.safeParse({ ...base, schema_version: version, diagnostics: legacyDiagnostics })
    if (!parsed.success)
      for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
  if (summary_attempt) {
    if (summary_run_id || template || e.sample_kind !== 'request')
      ctx.addIssue({ code: 'custom', message: 'Summary attempts cannot be combined with other versioned diagnostics' })
    checkLegacy(collectorEventV7Schema, 7, { ...diagnostics, summary_attempt })
  } else if (template) {
    if (summary_run_id) ctx.addIssue({ code: 'custom', message: 'Template requests cannot name a summary run' })
    checkLegacy(collectorEventV9Schema, 9, { ...diagnostics, template })
  } else if (summary_run_id) {
    checkLegacy(collectorEventV8Schema, 8, { ...diagnostics, summary_run_id })
  } else if (e.sample_kind === 'feature') {
    checkLegacy(collectorEventV6Schema, 6, diagnostics)
  } else {
    checkLegacy(collectorEventV5Schema, 5, diagnostics)
  }
})
export type CollectorEventV10 = z.infer<typeof collectorEventV10Schema>

// v11: the token counts the AI provider reported for one request. Exact numbers, never an
// estimate; a side the provider did not report is left out, and an event without any is unchanged.
export const tokenUsageSchema = z.object({
  input_tokens: resourceCountSchema.optional(), output_tokens: resourceCountSchema.optional(),
}).strict().refine(u => u.input_tokens !== undefined || u.output_tokens !== undefined, 'Token usage needs at least one count')
export type TokenUsage = z.infer<typeof tokenUsageSchema>
const collectorRequestV11Schema = requestBaseSchema.extend({ usage: tokenUsageSchema.optional() }).strict()
export type CollectorRequestV11 = z.infer<typeof collectorRequestV11Schema>
export const collectorEventV11Schema = collectorEventV10BaseSchema.extend({
  schema_version: z.literal(11),
  diagnostics: collectorEventV10BaseSchema.shape.diagnostics.extend({
    usage: tokenUsageSchema.optional(),
    requests: z.object({
      count: resourceCountSchema, omitted: resourceCountSchema,
      details: z.array(collectorRequestV11Schema).max(MAX_COLLECTOR_REQUEST_DETAILS),
    }).strict().optional(),
  }).strict(),
}).strict().superRefine((e, ctx) => {
  // Reuse every v10 invariant rather than maintaining another copy.
  const { usage: _usage, requests, ...diagnostics } = e.diagnostics
  const legacy = collectorEventV10Schema.safeParse({ ...e, schema_version: 10, diagnostics: { ...diagnostics,
    ...(requests ? { requests: { ...requests, details: requests.details.map(({ usage: _requestUsage, ...request }) => request) } } : {}) } })
  if (!legacy.success)
    for (const issue of legacy.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})
export type CollectorEventV11 = z.infer<typeof collectorEventV11Schema>

// v12 (D094): why a request failed, stopped or was cancelled, and how much context was cut.
// Closed sets, buckets and one random request ID only: never an error message, response body,
// endpoint URL, prompt or answer. Every field is optional; an event without any is a v11 event.
export const gatewayErrorCodeSchema = z.enum([
  // The codes mediprisma-ai-gateway answers with in error.code; anything else is 'other'.
  'origin_denied', 'authentication_required', 'invalid_token', 'authentication_unavailable', 'access_denied',
  'request_too_large', 'request_failed', 'route_not_found', 'invalid_request', 'invalid_output_limit',
  'provider_not_configured', 'unsupported_billable_input', 'rate_limited', 'monthly_budget_exhausted',
  'budget_unavailable', 'provider_error', 'invalid_provider_response',
  // D095: the two codes the first list missed. provider_unavailable is the gateway failing to reach the model at all.
  'provider_unavailable', 'unsupported_api_for_model', 'other',
])
export const finishReasonSchema = z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'error', 'other', 'unreported'])
export const abortReasonSchema = z.enum(['user_cancel', 'patient_switch', 'superseded', 'navigation', 'timeout', 'unknown'])
const contextTokensBucketSchema = collectorEventBaseSchema.shape.diagnostics.shape.context_tokens_bucket.unwrap()
export const contextTrimSchema = z.object({
  before: contextTokensBucketSchema, after: contextTokensBucketSchema,
  categories: z.array(z.enum(['encounters', 'medications', 'observations', 'reports', 'documents'])).max(5)
    .refine(list => new Set(list).size === list.length, 'Trimmed categories are listed once'),
}).strict()
const failureDiagnosticsShape = {
  gateway_error_code: gatewayErrorCodeSchema.optional(),
  upstream_attempted: z.boolean().optional(),
  gateway_request_id: z.string().uuid().optional(),
  finish_reason: finishReasonSchema.optional(),
  abort_reason: abortReasonSchema.optional(),
}
type FailureDiagnostics = { gateway_error_code?: string; upstream_attempted?: boolean; abort_reason?: string }
function validateFailureDiagnostics(status: string, errorClass: string | null, d: FailureDiagnostics, ctx: z.RefinementCtx) {
  if (status === 'completed' && (d.gateway_error_code !== undefined || d.abort_reason !== undefined))
    ctx.addIssue({ code: 'custom', message: 'A completed request has no gateway error or abort reason' })
  if (d.abort_reason !== undefined && status !== 'aborted' && errorClass !== 'timeout')
    ctx.addIssue({ code: 'custom', message: 'Only an aborted or timed-out request has an abort reason' })
}
const collectorRequestV12Schema = requestBaseSchema.extend({ usage: tokenUsageSchema.optional(), ...failureDiagnosticsShape }).strict()
export type CollectorRequestV12 = z.infer<typeof collectorRequestV12Schema>
export const collectorEventV12Schema = collectorEventV10BaseSchema.extend({
  schema_version: z.literal(12),
  diagnostics: collectorEventV10BaseSchema.shape.diagnostics.extend({
    usage: tokenUsageSchema.optional(),
    ...failureDiagnosticsShape,
    context_trim: contextTrimSchema.optional(),
    requests: z.object({
      count: resourceCountSchema, omitted: resourceCountSchema,
      details: z.array(collectorRequestV12Schema).max(MAX_COLLECTOR_REQUEST_DETAILS),
    }).strict().optional(),
  }).strict(),
}).strict().superRefine((e, ctx) => {
  // Reuse every v11 invariant rather than maintaining another copy.
  const strip = <T extends Record<string, unknown>>(value: T) => {
    const { gateway_error_code: _code, upstream_attempted: _attempted, gateway_request_id: _id, finish_reason: _finish, abort_reason: _abort, ...rest } = value
    return rest
  }
  const { context_trim, requests, ...diagnostics } = e.diagnostics
  const legacy = collectorEventV11Schema.safeParse({ ...e, schema_version: 11, diagnostics: { ...strip(diagnostics),
    ...(requests ? { requests: { ...requests, details: requests.details.map(strip) } } : {}) } })
  if (!legacy.success)
    for (const issue of legacy.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  validateFailureDiagnostics(e.status, e.error_class, e.diagnostics, ctx)
  requests?.details.forEach(request => validateFailureDiagnostics(request.status, request.error_class, request, ctx))
  if (context_trim && e.diagnostics.context_trimmed !== true)
    ctx.addIssue({ code: 'custom', path: ['diagnostics', 'context_trim'], message: 'Trim details need a trimmed context' })
})
export type CollectorEventV12 = z.infer<typeof collectorEventV12Schema>

// Hospital-capture outcome: MediPrisma relays what 北榮懷爾抓抓 tagged on the Bundle it
// delivered (category, failure kind, HTTP status, count). Its own endpoint and table,
// never accepted by /events. From D084 it may carry the hospital chart number, the only
// patient identifier here; still no names, national IDs, dates, URLs or free text.
export const hospitalCaptureCategorySchema = z.enum([
  'patient', 'allergies', 'vitals', 'conditions', 'encounters', 'orders', 'admissions', 'emergency',
  'operations', 'medications', 'reports', 'discharge_summaries', 'implants', 'chemotherapy', 'careplans', 'other',
])
// login_or_network: extensions before D080 could not tell an expired HIS login from a lost
// connection. Newer ones report login_expired (HIS redirected) or network (no response) instead.
// D090: visit_limit and order_unmatched are not fetch failures. They name why a capture that
// fetched every page is still incomplete (older visits left out by the visit cap; orders
// whose report coverage could not be confirmed), so a partial capture always has a reason.
export const hospitalCaptureFailureKindSchema = z.enum([
  'timeout', 'his_busy', 'http_error', 'parse_failed', 'login_or_network', 'login_expired', 'network',
  'visit_limit', 'order_unmatched', 'unknown',
])
// Why no hospital data reached the app (outcome failed only). 雲端懷爾抓抓 maps the
// 北榮懷爾抓抓 peer error (or its own timeout/validation failure) to this closed set.
export const hospitalUnavailableReasonSchema = z.enum([
  'HIS_LOGIN_REQUIRED', 'HIS_BUSY', 'HIS_SESSION_BLOCKED', 'PATIENT_HIS_MISMATCH', 'OUTPATIENT_CAPTURE_FAILED', 'HIS_TIMEOUT', 'INVALID_HIS_RESULT',
  'HIS_PATIENT_SELECTION_REQUIRED',
])
// How much the capture delivered (D083): exact counts per FHIR resource type of the hospital
// resources that reached the app, and encounters by class. A type outside the list counts as other.
export const hospitalCaptureResourceTypeSchema = z.enum([
  'Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'MedicationRequest', 'MedicationStatement', 'MedicationAdministration',
  'Procedure', 'AllergyIntolerance', 'DocumentReference', 'ServiceRequest', 'CarePlan', 'Device', 'Immunization', 'Composition', 'ImagingStudy', 'other',
])
export const hospitalCaptureEncounterClassSchema = z.enum(['outpatient', 'inpatient', 'emergency', 'other'])
const captureCount = z.number().int().min(0).max(99_999)
const captureStageMs = z.number().int().min(0).max(3_600_000)
const extensionVersion = z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/)
export const hospitalCaptureEventSchema = z.object({
  schema_version: z.literal(1), event_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }), site: z.literal('vghtpe'),
  app_surface: collectorAppSurfaceSchema,
  app_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  build_revision: z.string().regex(/^(?:[a-f0-9]{7,40}|unknown)$/),
  // one_click: 北榮懷爾抓抓 imported directly; medcloud_relay: via 雲端懷爾抓抓 progressive import;
  // clinic_prep (D091): the outpatient assistant preparing a clinic ahead of time, one patient per event.
  path: z.enum(['one_click', 'medcloud_relay', 'clinic_prep']),
  // empty = the capture finished without hospital resources; failed = no hospital data reached the app.
  outcome: z.enum(['complete', 'partial', 'empty', 'failed']),
  unavailable_reason: hospitalUnavailableReasonSchema.optional(),
  hospital_extension_version: extensionVersion.optional(),
  medcloud_extension_version: extensionVersion.optional(),
  hospital_resources: resourceBucketSchema.optional(),
  resource_counts: z.record(hospitalCaptureResourceTypeSchema, captureCount).optional(),
  encounter_counts: z.record(hospitalCaptureEncounterClassSchema, captureCount).optional(),
  // 北榮 chart number (histno) of the captured patient. The collector is in-hospital and admin-only.
  chart_no: z.string().regex(/^[0-9A-Za-z-]{1,16}$/).optional(),
  // Capture time as 北榮懷爾抓抓 measured it (start of the capture to the bundle being ready), at most one hour.
  duration_ms: z.number().int().min(0).max(3_600_000).optional(),
  // HIS requests 北榮懷爾抓抓 itself sent for this capture (D091). Not the requests the chart
  // page sends on its own when the assistant opens it in a tab.
  request_count: captureCount.optional(),
  // D093: a capture made in the clinic may build on the record the outpatient assistant already holds.
  // outcome: used = that record with what is newer laid over it; none = the assistant had no usable record;
  // timeout = it did not arrive in time; failed = reading it failed; unusable = it arrived but could not be
  // built on (not the same patient, too old to add to, or HIS could not say what is newer).
  // held_resources: resources in the held record; newer_resources: resources read from HIS to lay over it;
  // since_days: how many days back that reading started.
  stored_record: z.object({
    outcome: z.enum(['used', 'none', 'timeout', 'failed', 'unusable']),
    held_resources: captureCount.optional(), newer_resources: captureCount.optional(),
    since_days: z.number().int().min(0).max(400).optional(),
  }).strict().optional(),
  // D093: how long each part took, as 北榮懷爾抓抓 measured it. prelude = finding the patient, opening the chart,
  // the access audit and the identity check; record_read = reading the held record from the assistant;
  // record_wait = how long the capture stood waiting for that record; capture = reading HIS; merge = joining the two.
  stage_ms: z.object({
    prelude: captureStageMs.optional(), record_read: captureStageMs.optional(), record_wait: captureStageMs.optional(),
    capture: captureStageMs.optional(), merge: captureStageMs.optional(),
  }).strict().optional(),
  failures: z.array(z.object({
    category: hospitalCaptureCategorySchema, kind: hospitalCaptureFailureKindSchema,
    status: z.number().int().min(100).max(599).optional(), count: z.number().int().min(1).max(99_999),
  }).strict()).max(40),
}).strict().superRefine((e, ctx) => {
  if (e.outcome === 'complete' && e.failures.length) ctx.addIssue({ code: 'custom', path: ['failures'], message: 'A complete capture has no failures' })
  if (e.unavailable_reason && e.outcome !== 'failed') ctx.addIssue({ code: 'custom', path: ['unavailable_reason'], message: 'Only a failed capture has an unavailable reason' })
})
export type HospitalCaptureEvent = z.infer<typeof hospitalCaptureEventSchema>

// Separate, explicitly consented sensitive-content endpoint; never accepted by
// /events. Prompt includes the clinical context actually sent to the model.
export const AI_REPORT_MAX_BODY_BYTES = 8 * 1024 * 1024
export const aiReportSchema = z.object({
  schema_version: z.literal(1), submission_id: z.string().uuid(),
  consent: z.literal(true), created_at: z.string().datetime(),
  executions: z.array(z.object({
    timestamp: z.string().datetime(), status: z.enum(['completed', 'error', 'aborted']),
    // Optional for existing v1 records; new senders always populate this.
    outcome: errorClassSchema.nullable().optional(),
    technical: summaryAttemptSchema,
    prompt: z.string().max(2_000_000), output: z.string().max(2_000_000),
  }).strict()).min(1).max(256),
}).strict()
export type AiReport = z.infer<typeof aiReportSchema>
