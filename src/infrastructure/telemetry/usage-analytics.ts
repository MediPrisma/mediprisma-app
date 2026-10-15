// Usage analytics adapter (Firebase Analytics / GA4).
//
// This is the ONLY module in the app that may import `firebase/analytics`.
// Everything else calls `trackEvent` / `setUserProps`, so swapping GA4 for a
// different sink later (e.g. a Firestore counter if a hospital blocks GA)
// touches this file alone.
//
// Zero PHI by construction. The allowlist below is a hard boundary, not a
// convention: event names, parameter keys, enum parameter values, and value
// types are all checked at runtime, and anything unrecognised drops the whole
// call. Even if a future caller accidentally passes prompt text, a copied
// report, or a patient identifier, it cannot reach the network — the key is
// not on the list, and free-text values are capped at 64 characters.
//
// Never sends: Firebase uid (`setUserId` is never called), the page URL
// (`send_page_view` is off because SMART launch URLs carry `iss` and OAuth
// `code`), Google Signals, or ad-personalization signals.
//
// See docs/USAGE-ANALYTICS-PLAN-2026-09-03.md and docs/SECURITY.md.
'use client'

import type { Analytics } from 'firebase/analytics'

// ============================================================================
// ALLOWLIST — the privacy boundary
// ============================================================================

/**
 * Hostnames that may report usage. Deliberately a single exported constant:
 * localhost / E2E / preview builds must never pollute the production
 * property, and a temporary local-debug entry should be obvious in a diff.
 */
export const ANALYTICS_HOSTNAME_ALLOWLIST: readonly string[] = [
  'mediprisma.tw',
  'voho0000.github.io',
]

export type AnalyticsArea =
  | 'left'
  | 'right'
  | 'reports'
  | 'cumulative'
  | 'meds'
  | 'summary'

export type AnalyticsTrigger = 'user' | 'auto'

/** Which guided tour. `custom-summary` is the right tour's deep-dive kind. */
export type AnalyticsTour = 'left' | 'right' | 'custom-summary'

/** Where the 「AI 翻譯解讀」 entry point was pressed. */
export type ReportInterpretHost = 'report-row' | 'document-card' | 'document-dialog'

/** How this session got its patient data. Coarse by design — never the `iss`,
 *  the import id, or any part of the URL beyond the `?site=` marker. */
export type LaunchSource = 'medcloud2' | 'smart' | 'demo' | 'import' | 'none'
export type LaunchSite = 'vghtpe' | 'unknown'

/** Which AI feature made the call. */
export type AiSurface =
  | 'summary'
  | 'safety'
  | 'med_recon'
  | 'insights'
  | 'report_interp'
  | 'chat'

/** How the call ended. `aborted` is a user stop, never a failure. */
export type AiOutcome =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'aborted'
  | 'context_overflow'
  | 'quota'
  | 'parse_failed'

/** Coarse latency band. The raw duration is never sent. */
export type DurationBucket = 'lt5' | '5to15' | '15to45' | 'gt45'

/** Which AI surface a citation was followed from. */
export type SourceNavOrigin = 'summary' | 'safety' | 'chat' | 'unknown'

/**
 * How big the loaded chart is, in resources. Rides on `ai_result` and nowhere
 * else: the volume of a patient's record is only recorded when it is actually
 * handed to a model (owner decision, 2026-09-04), so merely opening a chart
 * measures nothing.
 *
 * It is the missing half of every reliability question — a summary timeout
 * means one thing on a 200-resource chart and something else entirely on a
 * 20,000-resource one.
 *
 * EXACT counts, not buckets (same decision): these numbers grow every time the
 * patient is seen, so they are a moving quantity rather than a stable property
 * of anyone, and the shape of the real distribution is the whole point.
 *
 * Totals ONLY. Which resources, whose, from when, and what they say are all
 * outside this event — a count cannot be inverted back into a chart.
 */
export interface PatientResourceCounts {
  /** Every clinical resource the chart holds (vitals excluded — they are the
   *  vital-signs subset of `obs_count`, not extra resources). */
  resource_count: number
  obs_count: number
  /** MedicationRequest AND MedicationStatement: the app merges the two into
   *  one medication list, so they are counted the way they are used. */
  med_count: number
  doc_count: number
  encounter_count: number
  report_count: number
}

/**
 * How much of that chart actually reached the model, after Data Selection and
 * every context-fitting tier. Sent beside the loaded totals on the SAME
 * `ai_result`, and the pairing is the whole point: `resource_count` says how
 * big the patient was, `fed_*` says how much survived context engineering, and
 * only the two together answer "did we trim enough, and do failures cluster at
 * a particular fed size".
 *
 * Same rules as the loaded totals: exact non-negative integers, each one
 * independently optional, totals only, never an identifier.
 *
 * Counted over exactly the same collection set as `PatientResourceCounts`, so
 * the two are directly comparable: `resource_count - fed_resource_count` is
 * the number of resources Data Selection and context fitting dropped, and the
 * same subtraction works field by field.
 */
export interface FedResourceCounts {
  fed_resource_count: number
  fed_obs_count: number
  fed_med_count: number
  fed_doc_count: number
  fed_encounter_count: number
  fed_report_count: number
}

export interface UsageEventParams {
  /** A layer's active page became visible (includes the layer's default page). */
  view_open: { area: AnalyticsArea; id: string; trigger: AnalyticsTrigger }
  /** A clinical chat turn was submitted. Never carries the prompt itself. */
  chat_send: {
    source: 'typed' | 'chip'
    has_image: boolean
    model_id: string
    agent_mode: boolean
  }
  /** EMR hand-off copy button. Never carries the copied text. */
  handoff_copy: { mode: 'all' | 'labs' | 'reports' | 'custom' | 'overview_meds' | 'meds_tab' }
  /** A guided tour was started (auto-offer and help menu are not yet split). */
  tour_start: { tour: AnalyticsTour }
  /** A guided tour closed. `step` is the step id it closed on. `tour_outcome`
   *  rather than `outcome` so it never shares a GA4 custom dimension with
   *  `ai_result.outcome`, whose value space is completely different. */
  tour_end: { tour: AnalyticsTour; tour_outcome: 'finish' | 'abandon'; step: string }
  /** 「AI 翻譯解讀」 was asked for. Never carries the report or its translation. */
  report_interpret: { host: ReportInterpretHost; action: 'open' | 'regenerate' }
  /**
   * One per page load. The same two values also go out as user properties, but
   * those are set asynchronously and GA's automatic `session_start` normally
   * beats them — so "how many times was this launch route opened" is only
   * answerable from an explicit event carrying the values itself.
   */
  app_launch: {
    launch_source: LaunchSource
    site: LaunchSite
    /** Launcher-supplied workstation / clinic-room code, or `unknown`. Free
     *  string (the codes are a hospital's own vocabulary), never a person. */
    workstation: string
  }
  /**
   * One per AI call, success or failure. This is the reliability signal — how
   * often a model actually answers, and how long it takes — so the outcome
   * vocabulary distinguishes the failures we can act on (quota, context
   * overflow, timeout, unparseable reply) from a plain error and from a user
   * pressing stop. Never carries the prompt, the answer, or the raw duration.
   */
  ai_result: {
    surface: AiSurface
    outcome: AiOutcome
    model_id: string
    duration_bucket: DurationBucket
    /** Same banding, applied to the time until the surface showed its FIRST
     *  section. Only progressive surfaces can measure it; the rest omit it.
     *  Bucketed for the same reason as `duration_bucket`: a raw millisecond
     *  timing never leaves the app. */
    first_card_bucket?: DurationBucket
    /** Estimated tokens of clinical context sent with this call. Optional:
     *  surfaces that have no estimate at the reporting point omit it rather
     *  than reporting a misleading 0. Size only — never the text. */
    context_tokens?: number
  } & Partial<PatientResourceCounts> & Partial<FedResourceCounts>
  /** A cited source was followed into the chart. `target_type` is a FHIR
   *  resourceType (`Observation`, `MedicationRequest`…) — never an id. */
  source_nav: { target_type: string; from: SourceNavOrigin }
  /** A 醫療摘要 block was copied. Never carries the copied text. */
  summary_copy: { block: 'hero' | 'custom_module' }
}

export type UsageEventName = keyof UsageEventParams

export type UserPropName =
  | 'launch_source'
  | 'site'
  | 'audience'
  | 'auth_kind'
  | 'app_version'
  | 'auto_summary'
  | 'locale'
  | 'key_mode'
  | 'workstation'
  | 'browser_id'

export type UserProps = Partial<Record<UserPropName, string>>

/** event name -> allowed parameter keys */
const EVENT_PARAM_KEYS: Record<UsageEventName, readonly string[]> = {
  view_open: ['area', 'id', 'trigger'],
  chat_send: ['source', 'has_image', 'model_id', 'agent_mode'],
  handoff_copy: ['mode'],
  tour_start: ['tour'],
  tour_end: ['tour', 'tour_outcome', 'step'],
  report_interpret: ['host', 'action'],
  app_launch: ['launch_source', 'site', 'workstation'],
  ai_result: [
    'surface',
    'outcome',
    'model_id',
    'duration_bucket',
    'first_card_bucket',
    'context_tokens',
    'resource_count',
    'obs_count',
    'med_count',
    'doc_count',
    'encounter_count',
    'report_count',
    'fed_resource_count',
    'fed_obs_count',
    'fed_med_count',
    'fed_doc_count',
    'fed_encounter_count',
    'fed_report_count',
  ],
  source_nav: ['target_type', 'from'],
  summary_copy: ['block'],
}

/**
 * Parameters that must be a non-negative integer. These are the only numeric
 * parameters we send, and they are sent EXACT rather than bucketed, so the
 * type check is the whole guarantee: a float, a negative, a NaN/Infinity, or
 * anything non-numeric means the caller measured something other than a count,
 * and the event is dropped rather than sent as a number nobody can interpret.
 *
 * Register every new count here as well as in EVENT_PARAM_KEYS — an unlisted
 * numeric key would fall through to the generic "any finite number" branch.
 */
const COUNT_PARAM_KEYS: readonly string[] = [
  'resource_count',
  'obs_count',
  'med_count',
  'doc_count',
  'encounter_count',
  'report_count',
  'fed_resource_count',
  'fed_obs_count',
  'fed_med_count',
  'fed_doc_count',
  'fed_encounter_count',
  'fed_report_count',
  'context_tokens',
]

/**
 * Parameters whose value space is closed. Keys absent from this map (`id`,
 * `model_id`) are free strings, still capped at 64 characters.
 */
const ENUM_PARAM_VALUES: Record<string, readonly string[]> = {
  area: ['left', 'right', 'reports', 'cumulative', 'meds', 'summary'],
  trigger: ['user', 'auto'],
  source: ['typed', 'chip'],
  mode: ['all', 'labs', 'reports'],
  tour: ['left', 'right', 'custom-summary'],
  tour_outcome: ['finish', 'abandon'],
  host: ['report-row', 'document-card', 'document-dialog'],
  action: ['open', 'regenerate'],
  // Also constrains the identically-named USER properties — same value space,
  // and validateValue is shared by both paths.
  launch_source: ['medcloud2', 'smart', 'demo', 'import', 'none'],
  site: ['vghtpe', 'unknown'],
  surface: ['summary', 'safety', 'med_recon', 'insights', 'report_interp', 'chat'],
  outcome: ['ok', 'error', 'timeout', 'aborted', 'context_overflow', 'quota', 'parse_failed'],
  duration_bucket: ['lt5', '5to15', '15to45', 'gt45'],
  first_card_bucket: ['lt5', '5to15', '15to45', 'gt45'],
  from: ['summary', 'safety', 'chat', 'unknown'],
  block: ['hero', 'custom_module'],
  // Preference user properties (validateValue is shared by both paths).
  auto_summary: ['on', 'off'],
  locale: ['zh-TW', 'en'],
  key_mode: ['own', 'proxy'],
}

const USER_PROP_KEYS: readonly string[] = [
  'launch_source',
  'site',
  'audience',
  'auth_kind',
  'app_version',
  'auto_summary',
  'locale',
  'key_mode',
  // Free string, deliberately NOT in ENUM_PARAM_VALUES: the codes are each
  // hospital's own vocabulary. The 64-character cap still applies, and the
  // launch parser has already validated the shape.
  'workstation',
  // Listed so an explicit re-set is not rejected, but no caller should need
  // it: the adapter sets this one itself (see getOrCreateBrowserId).
  'browser_id',
]

const MAX_STRING_LENGTH = 64
const MAX_QUEUE_LENGTH = 50

type ParamValue = string | number | boolean

// ============================================================================
// Per-browser id
// ============================================================================
//
// WHAT IT IS: 32 random hex characters, generated once and kept in
// localStorage, sent as the `browser_id` user property so every event from
// this browser profile carries the same value. It answers "how many distinct
// machines / clinic browsers are actually using this", which no other property
// can — `workstation` only exists on launcher-supplied URLs, and a GA session
// cannot be joined across days.
//
// WHAT IT IS NOT: not derived from anything. Not the Firebase uid (never
// sent), not an account, not a person, not a patient, not a fingerprint of the
// device. It is a random number whose only meaning is "the same browser as
// last time".
//
// WHY THE ADAPTER SETS IT, not a caller: it must be attached to the analytics
// instance BEFORE the first queued event flushes, or early events land without
// it. It is therefore written straight after initializeAnalytics and ahead of
// flush(), bypassing the queue entirely — ordering is the whole point.
//
// WHY localStorage rather than GA's own client_id: inside the hospital the app
// runs in an iframe under the HIS origin, where GA's cookie is third-party and
// can be dropped or reset on every load. Under Chrome's storage partitioning,
// localStorage is keyed by top-site + origin, which is stable for a given
// clinic workstation.
//
// KNOWN LIMITS, deliberately accepted: clearing site data (or a private
// window, or a locked-down profile that blocks storage) produces a new id and
// inflates the machine count; a shared roaming Windows profile makes several
// physical machines look like one. Read it as an order of magnitude, not a
// census.

export const BROWSER_ID_STORAGE_KEY = 'mediprisma.analytics.browser_id'

const BROWSER_ID_PATTERN = /^[0-9a-f]{32}$/

function generateBrowserId(): string | null {
  const webCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    webCrypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID().replace(/-/g, '')
  }
  // No CSPRNG: report without an id rather than inventing a weak one.
  return null
}

/**
 * Exported for tests only — production callers must not set `browser_id`
 * themselves. Returns null whenever storage or randomness is unavailable
 * (private mode, blocked site data); reporting then simply carries no id.
 */
export function getOrCreateBrowserId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(BROWSER_ID_STORAGE_KEY)
    if (stored && BROWSER_ID_PATTERN.test(stored)) return stored
  } catch {
    // Storage unreadable — fall through and try to mint one; the write below
    // will fail the same way and we end up returning null.
  }
  const generated = generateBrowserId()
  if (!generated) return null
  try {
    window.localStorage.setItem(BROWSER_ID_STORAGE_KEY, generated)
  } catch {
    // Cannot persist, so the id would differ on every load — that is noise,
    // not a signal. Report nothing rather than a per-load pseudo-machine.
    return null
  }
  return generated
}

// ============================================================================
// Enable gate
// ============================================================================

let enabledCache: boolean | undefined

function computeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (!process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) return false
  // The E2E emulator run must never reach the real property.
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATOR) return false
  let hostname = ''
  try {
    hostname = window.location.hostname
  } catch {
    return false
  }
  return ANALYTICS_HOSTNAME_ALLOWLIST.includes(hostname)
}

function isEnabled(): boolean {
  if (enabledCache === undefined) enabledCache = computeEnabled()
  return enabledCache
}

function warn(message: string): void {
  // Dev-only: on production this would be noise for a clinician's console.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[usage-analytics] ${message}`)
  }
}

// ============================================================================
// Validation
// ============================================================================

function validateValue(key: string, value: unknown): ParamValue | undefined {
  const allowedValues = ENUM_PARAM_VALUES[key]
  if (allowedValues) {
    if (typeof value !== 'string' || !allowedValues.includes(value)) return undefined
    return value
  }
  if (COUNT_PARAM_KEYS.includes(key)) {
    if (typeof value !== 'number') return undefined
    if (!Number.isInteger(value)) return undefined
    return value >= 0 ? value : undefined
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.length > MAX_STRING_LENGTH) return undefined
  return value
}

/** Returns the sanitized params, or `undefined` when the event must be dropped. */
function validateEvent(
  name: string,
  params: Record<string, unknown>,
): Record<string, ParamValue> | undefined {
  const allowedKeys = EVENT_PARAM_KEYS[name as UsageEventName]
  if (!allowedKeys) {
    warn(`dropped unknown event "${name}"`)
    return undefined
  }
  const out: Record<string, ParamValue> = {}
  for (const [key, raw] of Object.entries(params ?? {})) {
    if (!allowedKeys.includes(key)) {
      warn(`dropped event "${name}": unknown param "${key}"`)
      return undefined
    }
    // An OPTIONAL param the caller spread in as `undefined` is an absent
    // param, not a bad one — dropping the whole event over it would lose real
    // data to a spread, and `undefined` cannot carry anything sensitive.
    if (raw === undefined) continue
    const value = validateValue(key, raw)
    if (value === undefined) {
      warn(`dropped event "${name}": invalid value for "${key}"`)
      return undefined
    }
    out[key] = value
  }
  return out
}

/**
 * Whole-call drop (not per-key filtering) on any violation: a user property is
 * long-lived on the GA profile, so a partially-understood payload is exactly
 * the case where failing closed is worth losing the good keys too.
 */
function validateUserProps(props: Record<string, unknown>): Record<string, ParamValue> | undefined {
  const out: Record<string, ParamValue> = {}
  for (const [key, raw] of Object.entries(props ?? {})) {
    if (!USER_PROP_KEYS.includes(key)) {
      warn(`dropped user properties: unknown key "${key}"`)
      return undefined
    }
    const value = validateValue(key, raw)
    if (value === undefined) {
      warn(`dropped user properties: invalid value for "${key}"`)
      return undefined
    }
    out[key] = value
  }
  return out
}

// ============================================================================
// Lazy SDK load + queue
// ============================================================================

type QueuedItem =
  | { kind: 'event'; name: string; params: Record<string, ParamValue> }
  | { kind: 'props'; props: Record<string, ParamValue> }

const queue: QueuedItem[] = []
let analytics: Analytics | null = null
let logEventImpl: typeof import('firebase/analytics').logEvent | null = null
let setUserPropertiesImpl: typeof import('firebase/analytics').setUserProperties | null = null
let loadStarted = false

function scheduleLoad(): void {
  if (loadStarted) return
  loadStarted = true
  const run = () => {
    void loadSdk()
  }
  // The analytics chunk must not compete with the first paint or with the
  // clinical data fetch. Idle time only; 2s timer where rIC is unavailable.
  const idle = (window as Window & {
    requestIdleCallback?: (cb: () => void) => number
  }).requestIdleCallback
  if (typeof idle === 'function') idle(run)
  else window.setTimeout(run, 2000)
}

async function loadSdk(): Promise<void> {
  try {
    // Both imports are dynamic on purpose. This module is imported by
    // providers and leaf components all over the tree; a static
    // `firebase.config` import would pull the (side-effectful) Firebase Auth /
    // Firestore initialization into every one of those module graphs.
    const [mod, { app }] = await Promise.all([
      import('firebase/analytics'),
      import('@/src/shared/config/firebase.config'),
    ])
    if (!app || !(await mod.isSupported())) {
      queue.length = 0
      return
    }
    analytics = mod.initializeAnalytics(app, {
      config: {
        // URL carries SMART `iss` / OAuth `code` — never auto-report it.
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    })
    logEventImpl = mod.logEvent
    setUserPropertiesImpl = mod.setUserProperties
    // Straight onto the instance, ahead of flush(): every queued event must
    // already carry it. Deliberately not routed through setUserProps/the queue.
    const browserId = getOrCreateBrowserId()
    if (browserId) {
      try {
        mod.setUserProperties(analytics, { browser_id: browserId })
      } catch {
        // An id is a nice-to-have; never let it stop the flush.
      }
    }
    flush()
  } catch {
    // Blocked by an ad blocker, offline, or already initialized elsewhere.
    // Analytics is never allowed to break the app: drop what we have.
    analytics = null
    queue.length = 0
  }
}

function dispatch(item: QueuedItem): void {
  if (!analytics) return
  try {
    if (item.kind === 'event') logEventImpl?.(analytics, item.name, item.params)
    else setUserPropertiesImpl?.(analytics, item.props)
  } catch {
    // Reporting must never throw into a clinical code path.
  }
}

function flush(): void {
  while (queue.length > 0) {
    const item = queue.shift()
    if (item) dispatch(item)
  }
}

function enqueue(item: QueuedItem): void {
  if (analytics) {
    dispatch(item)
    return
  }
  // Cap: a runaway caller must not grow an unbounded array while the SDK is
  // still loading (or permanently unavailable behind an ad blocker).
  if (queue.length >= MAX_QUEUE_LENGTH) return
  queue.push(item)
  scheduleLoad()
}

// ============================================================================
// Public API
// ============================================================================

export function trackEvent<K extends UsageEventName>(
  name: K,
  params: UsageEventParams[K],
): void {
  if (!isEnabled()) return
  const validated = validateEvent(name, params as Record<string, unknown>)
  if (!validated) return
  enqueue({ kind: 'event', name, params: validated })
}

export function setUserProps(props: UserProps): void {
  if (!isEnabled()) return
  const validated = validateUserProps(props as Record<string, unknown>)
  if (!validated) return
  enqueue({ kind: 'props', props: validated })
}

// ============================================================================
// User-vs-auto trigger
// ============================================================================
//
// `view_open` is observed from an effect on the layer's active state so that
// default pages are counted, not only clicks. The effect cannot tell WHY the
// state changed, so a manual handler sets a one-shot flag immediately before
// its setState; the effect that runs next consumes it. Programmatic changes
// (tour steps, citation navigation, resets) never set it and are therefore
// reported as `auto`.
//
// The flag is PER AREA, not global. React commits child effects before parent
// effects, so clicking the left 報告 tab for the first time mounts ReportsCard
// and runs its `reports` effect BEFORE LeftPanelLayout's `left` effect — a
// single shared flag would be consumed by the child and attribute the click to
// the wrong layer (reports=user, left=auto, exactly backwards).

const pendingUserTriggers = new Set<AnalyticsArea>()

/**
 * Mark the NEXT `view_open` in `area` as user-initiated. Callers must only
 * mark on an actual change of value: a mark with no view to consume it lingers
 * and mislabels the next view in that area. Radix `<Tabs onValueChange>` gives
 * this for free (it does not fire for an unchanged value); hand-rolled
 * buttons and menu items have to compare themselves.
 */
export function markUserTrigger(area: AnalyticsArea): void {
  pendingUserTriggers.add(area)
}

export function consumeTrigger(area: AnalyticsArea): AnalyticsTrigger {
  if (!pendingUserTriggers.delete(area)) return 'auto'
  return 'user'
}
