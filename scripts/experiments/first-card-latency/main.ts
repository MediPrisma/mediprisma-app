// Time-to-first-section experiment for the two-lane 醫療摘要 generation.
//
// What it answers: how long a clinician waits before the overview card can be
// painted, and how much of that wait the fast lane removes. It builds BOTH
// lanes with the same use-case code the app runs, streams them concurrently
// against an OpenAI-compatible endpoint, and reports the baseline (the single
// batch the app used before the split) beside them.
//
// Usage:
//   FIRST_CARD_BASE_URL=http://localhost:11434/v1 \
//   FIRST_CARD_MODEL=qwen2.5:1.5b \
//   npx tsx scripts/experiments/first-card-latency/main.ts
//
// Env:
//   FIRST_CARD_BASE_URL  OpenAI-compatible base URL (default http://localhost:11434/v1)
//   FIRST_CARD_MODEL     upstream model id       (default qwen2.5:1.5b)
//   FIRST_CARD_API_KEY   optional bearer token
//   FIRST_CARD_LOCALE    zh-TW | en              (default zh-TW)
//   FIRST_CARD_SKIP_BASELINE=1  measure only the two lanes
//   FIRST_CARD_SEQUENTIAL=1     run the two lanes one after another. Use this
//                          on a SINGLE-SLOT endpoint (a default local Ollama
//                          serves one request at a time): there the concurrent
//                          numbers only measure the queue. Per-lane prompt
//                          size, time to first token and time to first block
//                          stay valid; the wall-clock saving does not.
//   FIRST_CARD_FAST_BUDGET fast-lane snapshot budget in tokens (default: the
//                          app's OVERVIEW_SNAPSHOT_TOKEN_BUDGET). Lower it to
//                          exercise the trimming ladder on a small chart.
//   FIRST_CARD_BUNDLE      absolute path to a FHIR Bundle JSON to measure
//                          instead of the demo. The reference clock is pinned
//                          to that bundle's newest record date, so "current
//                          medication" and the snapshot's windows are judged
//                          the way the chart itself is dated rather than by
//                          today's wall clock. A large chart may need
//                          NODE_OPTIONS=--max-old-space-size=8192.
//   FIRST_CARD_MAX_TOKENS  per-lane completion cap (default 4000)
//   FIRST_CARD_DEADLINE_MS per-lane wall-clock cap (default 900000)
//
// The baseline runs ALONE first, then the two lanes run concurrently: two
// requests sharing one GPU is the condition the app actually creates, and
// timing the baseline against that contention would flatter the split.
//
// The demo bundle is the default; FIRST_CARD_BUNDLE points at another chart
// (a synthetic one, for the heavy-chart measurements). Nothing is written back.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const BASE_URL = (process.env.FIRST_CARD_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '')
const MODEL = process.env.FIRST_CARD_MODEL || 'qwen2.5:1.5b'
const API_KEY = process.env.FIRST_CARD_API_KEY || ''
const LOCALE: 'zh-TW' | 'en' = process.env.FIRST_CARD_LOCALE === 'en' ? 'en' : 'zh-TW'
const SKIP_BASELINE = process.env.FIRST_CARD_SKIP_BASELINE === '1'
const SEQUENTIAL = process.env.FIRST_CARD_SEQUENTIAL === '1'
// Small models can loop instead of closing their last block. Both caps exist
// so a degenerate completion cannot hang the measurement; neither changes the
// numbers that matter, which are all reached before the cap.
const FAST_BUDGET = process.env.FIRST_CARD_FAST_BUDGET
  ? Number(process.env.FIRST_CARD_FAST_BUDGET)
  : undefined
const MAX_TOKENS = Number(process.env.FIRST_CARD_MAX_TOKENS || 4000)
const BUNDLE_PATH = process.env.FIRST_CARD_BUNDLE || ''
const DEADLINE_MS = Number(process.env.FIRST_CARD_DEADLINE_MS || 900_000)

interface AiMessage { role: string; content: string }

interface LaneSpec {
  id: string
  /** Turn provider-side hidden reasoning off for this lane only. */
  thinkingOff?: boolean
  messages: AiMessage[]
  promptTokens: number
  /** Returns true once the streamed text holds this lane's first complete
   *  card block — the moment the app would publish a section. */
  hasFirstBlock: (text: string) => boolean
  /** Validates the overview block, when this lane carries it. */
  parsesOverview?: (text: string) => boolean
}

interface LaneResult {
  id: string
  promptTokens: number
  firstTokenMs: number | null
  firstBlockMs: number | null
  totalMs: number
  overviewParsed: boolean | null
  chars: number
  /** Hidden reasoning streamed before/around the answer (OpenRouter `delta.reasoning`). */
  reasoningChars: number
  firstReasoningMs: number | null
  finishReason: string | null
  text: string
  /** The lane hit a cap rather than finishing on its own. */
  truncated?: boolean
  error?: string
}

/** Optional provider reasoning budget. OpenRouter reads `reasoning.effort`;
 *  OpenAI-compatible servers read `reasoning_effort`. Left unset, the model
 *  thinks with its own default — the experiment never disables thinking. */
const REASONING_EFFORT = process.env.FIRST_CARD_REASONING_EFFORT
/** Fast-lane-only variants under test. `FIRST_CARD_FAST_THINKING=off` turns
 *  hidden reasoning off for the overview lane alone (the full lane keeps the
 *  model default); `FIRST_CARD_FAST_BRIEF_THINK=1` appends a one-line request
 *  for short reasoning to the overview lane's system message instead. */
const FAST_THINKING_OFF = process.env.FIRST_CARD_FAST_THINKING === 'off'
const FAST_BRIEF_THINK = process.env.FIRST_CARD_FAST_BRIEF_THINK === '1'
const BRIEF_THINK_LINE = 'Reasoning budget: this block is an extraction task — keep any hidden reasoning to a few lines, then write the block.'

const seconds = (ms: number | null) => (ms === null ? '   n/a' : `${(ms / 1000).toFixed(1)}s`.padStart(6))

async function streamLane(lane: LaneSpec): Promise<LaneResult> {
  const startedAt = performance.now()
  let firstTokenMs: number | null = null
  let firstBlockMs: number | null = null
  let text = ''
  let reasoningChars = 0
  let firstReasoningMs: number | null = null
  let finishReason: string | null = null
  let truncated = false
  const controller = new AbortController()
  const deadline = setTimeout(() => { truncated = true; controller.abort() }, DEADLINE_MS)

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        // Mirrors the app's custom-endpoint transport options.
        temperature: 0,
        max_tokens: MAX_TOKENS,
        ...(REASONING_EFFORT
          ? { reasoning: { effort: REASONING_EFFORT }, reasoning_effort: REASONING_EFFORT }
          : {}),
        ...(lane.thinkingOff
          ? { reasoning: { enabled: false }, chat_template_kwargs: { enable_thinking: false } }
          : {}),
        messages: lane.messages,
      }),
    })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const payload = line.trim()
        if (!payload.startsWith('data:')) continue
        const data = payload.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let delta = ''
        try {
          const choice = JSON.parse(data)?.choices?.[0]
          const reasoning = choice?.delta?.reasoning
          if (typeof reasoning === 'string' && reasoning) {
            reasoningChars += reasoning.length
            if (firstReasoningMs === null) firstReasoningMs = performance.now() - startedAt
          }
          if (choice?.finish_reason) finishReason = String(choice.finish_reason)
          delta = choice?.delta?.content ?? ''
        } catch { continue }
        if (!delta) continue
        if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt
        text += delta
        if (firstBlockMs === null && lane.hasFirstBlock(text)) {
          firstBlockMs = performance.now() - startedAt
        }
      }
    }
  } catch (error) {
    if (!truncated) {
      return {
        id: lane.id,
        promptTokens: lane.promptTokens,
        firstTokenMs,
        firstBlockMs,
        totalMs: performance.now() - startedAt,
        overviewParsed: lane.parsesOverview ? false : null,
        chars: text.length,
        reasoningChars,
        firstReasoningMs,
        finishReason,
        text,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  } finally {
    clearTimeout(deadline)
  }

  // A block whose end marker arrives in the final chunk still counts.
  if (firstBlockMs === null && lane.hasFirstBlock(text)) firstBlockMs = performance.now() - startedAt
  return {
    id: lane.id,
    promptTokens: lane.promptTokens,
    firstTokenMs,
    firstBlockMs,
    totalMs: performance.now() - startedAt,
    overviewParsed: lane.parsesOverview ? lane.parsesOverview(text) : null,
    chars: text.length,
    reasoningChars,
    firstReasoningMs,
    finishReason,
    text,
    truncated: truncated || undefined,
  }
}

/** The newest clinical date the chart itself carries, as epoch ms. */
function newestRecordMsOf(collection: Record<string, any[] | undefined>): number {
  const dates: string[] = []
  const push = (value?: string) => { if (value && value.length >= 10) dates.push(value.slice(0, 10)) }
  for (const encounter of collection.encounters ?? []) push(encounter?.period?.start)
  for (const medication of collection.medications ?? []) push(medication?.authoredOn)
  for (const observation of collection.observations ?? []) push(observation?.effectiveDateTime)
  for (const report of collection.diagnosticReports ?? []) push(report?.effectiveDateTime ?? report?.issued)
  const newest = dates.reduce((max, date) => (date > max ? date : max), '')
  const parsed = newest ? Date.parse(`${newest}T23:59:59Z`) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

async function main() {
  const { LocalBundleService } = await import(path.join(ROOT, 'src/infrastructure/fhir/services/local-bundle.service.ts'))
  const { enrichBundleWithNhiDrugTerminology } = await import(path.join(ROOT, 'src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service.ts'))
  const {
    generateMedicalSummaryUseCase,
    getSourceCatalog,
    buildLongitudinalInvestigationContext,
  } = await import(path.join(ROOT, 'src/core/use-cases/medical-summary/generate-medical-summary.use-case.ts'))
  const { buildOverviewSnapshot, OVERVIEW_SNAPSHOT_TOKEN_BUDGET } =
    await import(path.join(ROOT, 'src/core/use-cases/medical-summary/overview-snapshot.ts'))
  const { registeredMedicalSummaryCards, MEDICAL_SUMMARY_CARD_REGISTRY } =
    await import(path.join(ROOT, 'src/core/use-cases/medical-summary/medical-summary-card-registry.ts'))
  const { GenerateClinicalContextUseCase } =
    await import(path.join(ROOT, 'src/core/use-cases/clinical-context/generate-clinical-context.use-case.ts'))
  const { scopeClinicalDataForAi } = await import(path.join(ROOT, 'src/core/utils/ai-clinical-scope.utils.ts'))
  const { listClinicalDocuments, resolveSelectedDocuments, formatDocumentsSection } =
    await import(path.join(ROOT, 'src/core/utils/clinical-documents.utils.ts'))
  const { DEFAULT_DATA_FILTERS, DEFAULT_DATA_SELECTION, ALL_DATA_FILTERS, ALL_DATA_SELECTION, DEFAULT_DOCUMENT_MODE } =
    await import(path.join(ROOT, 'src/shared/constants/data-selection.constants.ts'))
  const { DEMO_DATA_AS_OF_MS } = await import(path.join(ROOT, 'src/shared/constants/demo-data.constants.ts'))
  const { estimateMessagesTokens, estimateTokens } =
    await import(path.join(ROOT, 'src/shared/utils/token-estimator.ts'))

  // ---- 1. bundle → the app's own default AI scope --------------------------
  const bundlePath = BUNDLE_PATH || path.join(ROOT, 'public/demo/demo-bundle.json')
  /** `FIRST_CARD_SCOPE=all` sends the all-time selection: the only way to stress
   *  the snapshot's own caps, since the default scope already trims a chart. */
  const useAllScope = process.env.FIRST_CARD_SCOPE === 'all'
  const SELECTION = useAllScope ? ALL_DATA_SELECTION : DEFAULT_DATA_SELECTION
  const FILTERS = useAllScope ? ALL_DATA_FILTERS : DEFAULT_DATA_FILTERS
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  const enriched = await enrichBundleWithNhiDrugTerminology(bundle)
  const { patient, collection } = await LocalBundleService.parse(enriched.bundle)
  // Pin the clock to the chart's own newest record. Judging an archived or
  // synthetic chart by the wall clock silently empties "current medication"
  // and every recency window — the demo constant does exactly this for the
  // demo bundle, and an external chart needs the same treatment.
  const newestRecordMs = BUNDLE_PATH
    ? newestRecordMsOf(collection)
    : DEMO_DATA_AS_OF_MS
  const documents = listClinicalDocuments(collection)
  const selectedDocuments = resolveSelectedDocuments(documents, useAllScope ? 'all' : DEFAULT_DOCUMENT_MODE, [])
  const includedDocumentIds = selectedDocuments.map((document: { id: string }) => document.id)
  const scopedClinicalData = scopeClinicalDataForAi(
    collection,
    SELECTION,
    FILTERS,
    includedDocumentIds,
    newestRecordMs,
  )
  const catalog = getSourceCatalog(scopedClinicalData, LOCALE)

  // ---- 2. clinical context, through the core use-case + shared formatters --
  const contextUseCase = new GenerateClinicalContextUseCase()
  const sections = contextUseCase.execute(patient, scopedClinicalData, {
    selection: SELECTION,
    filters: FILTERS,
  })
  const documentsSection = formatDocumentsSection(selectedDocuments)
  const formatted = contextUseCase.formatSections(
    documentsSection ? [...sections, documentsSection] : sections,
  )
  const longitudinal = buildLongitudinalInvestigationContext(scopedClinicalData, catalog)
  const clinicalContext = [formatted, longitudinal].filter(Boolean).join('\n\n')

  const promptInput = {
    clinicalContext,
    piiLiterals: [],
    catalog,
    locale: LOCALE,
    audience: 'medical' as const,
    harnessProfile: 'local-small' as const,
  }

  // ---- 3. both lanes, built by the real use-case ---------------------------
  const allCards = registeredMedicalSummaryCards(promptInput)
  const overviewCard = MEDICAL_SUMMARY_CARD_REGISTRY.overview
  const fullLaneCards = allCards.filter((card: { id: string }) => card.id !== 'overview')
  const snapshot = buildOverviewSnapshot(
    { clinicalData: scopedClinicalData, catalog, patient },
    {
      nowMs: newestRecordMs,
      locale: LOCALE,
      ...(FAST_BUDGET === undefined ? {} : { tokenBudget: FAST_BUDGET }),
    },
  )
  const fastInput = {
    ...promptInput,
    clinicalContext: snapshot.clinicalContext,
    catalog: snapshot.catalog,
    singleLanguageContract: true,
  }

  const fastMessages = generateMedicalSummaryUseCase.buildRegisteredCardBatchMessages(
    fastInput,
    [overviewCard.buildBatchInstruction(fastInput)],
    ['overview'],
  )
  const fullMessages = generateMedicalSummaryUseCase.buildRegisteredCardBatchMessages(
    promptInput,
    fullLaneCards.map((card: any) => card.buildBatchInstruction(promptInput)),
    fullLaneCards.map((card: any) => card.id).filter((id: string) => id !== 'safety'),
  )
  const baselineMessages = generateMedicalSummaryUseCase.buildRegisteredCardBatchMessages(
    promptInput,
    allCards.map((card: any) => card.buildBatchInstruction(promptInput)),
  )

  const overviewParses = (text: string) =>
    Boolean(generateMedicalSummaryUseCase.parseBatchModuleResult('overview', text))

  const fastLaneMessages = FAST_BRIEF_THINK
    ? fastMessages.map((message: AiMessage, index: number) => index === 0 && message.role === 'system'
        ? { ...message, content: `${message.content}\n\n${BRIEF_THINK_LINE}` }
        : message)
    : fastMessages
  const fastLane: LaneSpec = {
    id: FAST_THINKING_OFF ? 'fast(overview,no-think)' : FAST_BRIEF_THINK ? 'fast(overview,brief)' : 'fast(overview)',
    thinkingOff: FAST_THINKING_OFF,
    messages: fastLaneMessages,
    promptTokens: estimateMessagesTokens(fastLaneMessages),
    hasFirstBlock: (text) => overviewCard.hasCompleteBatchBlock(text),
    parsesOverview: overviewParses,
  }
  const fullLane: LaneSpec = {
    id: 'full(rest)',
    messages: fullMessages,
    promptTokens: estimateMessagesTokens(fullMessages),
    hasFirstBlock: (text) => fullLaneCards.some((card: any) => card.hasCompleteBatchBlock(text)),
  }
  const baselineLane: LaneSpec = {
    id: 'baseline(one batch)',
    messages: baselineMessages,
    promptTokens: estimateMessagesTokens(baselineMessages),
    // The baseline's "first section" is the overview block inside the one big
    // batch — exactly what the clinician used to wait for.
    hasFirstBlock: (text) => overviewCard.hasCompleteBatchBlock(text),
    parsesOverview: overviewParses,
  }

  console.log(`endpoint      ${BASE_URL}`)
  console.log(`model         ${MODEL}`)
  console.log(`locale        ${LOCALE}`)
  console.log(`caps          max_tokens=${MAX_TOKENS} deadline=${DEADLINE_MS}ms per lane`)
  console.log(`bundle        ${bundlePath}`)
  console.log(`as-of         ${new Date(newestRecordMs).toISOString().slice(0, 10)} (newest record; the reference clock)`)
  console.log(`catalog       ${catalog.length} sources (fast lane cites ${snapshot.catalog.length})`)
  console.log(`context       ${estimateTokens(clinicalContext)} est. tokens (fast-lane snapshot ${snapshot.estimatedTokens}, budget ${FAST_BUDGET ?? OVERVIEW_SNAPSHOT_TOKEN_BUDGET})`)
  console.log('')
  console.log('overview snapshot   tokens  kept  dropped')
  for (const section of snapshot.sections) {
    console.log([
      section.id.padEnd(18),
      String(section.tokens).padStart(6),
      String(section.kept).padStart(6),
      String(section.dropped).padStart(9),
    ].join(''))
  }
  console.log([
    'TOTAL'.padEnd(18),
    String(snapshot.estimatedTokens).padStart(6),
  ].join(''))
  console.log('')

  // The number the on-prem target is written against: everything the fast lane
  // sends, instructions and source list included. The ceiling is ~10 000
  // tokens — the on-prem table in docs/FHIR-context-stability-optimization.txt
  // measures ~10.7 s for a ~5K request and ~23.8 s for ~13K, so ~10K is the
  // largest request that still interpolates under the 20 s requirement with
  // thinking off. The evidence budget below is 8 000 of that; the remaining
  // ~2K is the overview instructions plus the source list.
  console.log(`fast request  ${estimateMessagesTokens(fastMessages)} est. tokens (on-prem ceiling ≈ 10 000)`)
  console.log('')

  if (process.env.FIRST_CARD_DUMP) {
    fs.writeFileSync(process.env.FIRST_CARD_DUMP, JSON.stringify({ fast: fastLaneMessages, full: fullMessages }, null, 2))
    console.log(`dumped lane messages to ${process.env.FIRST_CARD_DUMP}`)
    return
  }
  const results: LaneResult[] = []
  if (!SKIP_BASELINE) {
    console.log('running baseline alone…')
    results.push(await streamLane(baselineLane))
  }
  console.log(SEQUENTIAL
    ? 'running the two lanes sequentially (single-slot endpoint)…'
    : 'running the two lanes concurrently…')
  const laneResults = SEQUENTIAL
    ? [await streamLane(fastLane), await streamLane(fullLane)]
    : await Promise.all([streamLane(fastLane), streamLane(fullLane)])
  results.push(...laneResults)

  console.log('')
  console.log(`caps          reasoning_effort=${REASONING_EFFORT ?? '(model default)'}`)
  console.log('lane                      prompt-tok    ttft  first-block   total  overview  think-chars  finish')
  for (const result of results) {
    console.log([
      result.id.padEnd(25),
      String(result.promptTokens).padStart(10),
      seconds(result.firstTokenMs),
      seconds(result.firstBlockMs).padStart(12),
      seconds(result.totalMs).padStart(7),
      result.overviewParsed === null ? '       -' : result.overviewParsed ? '      ok' : '  FAILED',
      String(result.reasoningChars).padStart(13),
      `  ${result.finishReason ?? '-'}`,
      result.truncated ? '  (hit cap)' : '',
      result.error ? `  ERROR: ${result.error}` : '',
    ].join(''))
  }

  const showOverview = (label: string, text: string) => {
    const parsed = generateMedicalSummaryUseCase.parseBatchModuleResult('overview', text) as
      { headline?: string } | null
    if (!parsed) return
    console.log('')
    console.log(`--- overview from ${label} ---`)
    console.log(`headline: ${parsed.headline ?? ''}`)
  }
  for (const result of results) if (result.overviewParsed) showOverview(result.id, result.text)

  const fast = laneResults[0]
  const full = laneResults[1]
  const firstCardMs = fast.firstBlockMs
  const totalMs = SEQUENTIAL
    ? fast.totalMs + full.totalMs
    : Math.max(fast.totalMs, full.totalMs)
  console.log('')
  console.log(
    `first-card=${firstCardMs === null ? 'n/a' : (firstCardMs / 1000).toFixed(1)}s ` +
    `total=${(totalMs / 1000).toFixed(1)}s ` +
    `prompt-tokens=${fast.promptTokens + full.promptTokens}`,
  )
  if (fast.overviewParsed === false) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
