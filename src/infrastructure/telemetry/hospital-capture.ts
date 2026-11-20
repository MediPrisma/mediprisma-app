'use client'

import { hospitalCaptureCategorySchema, hospitalCaptureEncounterClassSchema, hospitalCaptureEventSchema, hospitalCaptureResourceTypeSchema, hospitalCaptureFailureKindSchema, hospitalUnavailableReasonSchema, type HospitalCaptureEvent } from '@/src/shared/contracts/collector-event'
import { captureCollectorAuth } from './collector-auth'
import { collectorAppSurface, collectorNetworkPermission, configuredEndpoint, isCollectorSite } from './collector'

// 北榮懷爾抓抓 tags the Bundle it delivers with why parts of the capture failed
// (category:kind[:HTTP status], display = count) and its version. 雲端懷爾抓抓 keeps
// those tags when it merges the hospital supplement. Only these bounded codes, counts per
// resource type and the chart number the extension tagged (D084, in-hospital Collector only)
// leave the browser; no resource content, name, national ID, date or free text does.
const FAILURE_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-failure'
const HOSPITAL_VERSION_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/extension-version'
const COMPLETENESS_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-completeness'
// D083/D084 (owner decision 2026-11-12): the in-hospital Collector keeps the chart number so a
// capture with a problem can be traced to its patient; the capture time is the extension's own.
const CHART_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-chart-no'
const DURATION_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-duration-ms'
// D091: HIS requests the extension itself sent for this capture (not the chart page's own requests).
const REQUESTS_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-request-count'
// D093: how a capture made in the clinic used the record the outpatient assistant holds (one closed code), and
// name:whole-number measures: how long each part took and how much each side held.
const STORED_RECORD_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-stored-record'
const MEASURE_SYSTEM = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-measure'
const STAGES = { prelude_ms: 'prelude', record_read_ms: 'record_read', record_wait_ms: 'record_wait', capture_ms: 'capture', merge_ms: 'merge' } as const
const RECORD_SIZES = ['held_resources', 'newer_resources', 'since_days'] as const
const CHART_NO = /^[0-9A-Za-z-]{1,16}$/
const ENCOUNTER_CLASS: Record<string, 'outpatient' | 'inpatient' | 'emergency'> = { AMB: 'outpatient', IMP: 'inpatient', EMER: 'emergency' }
const MEDCLOUD_VERSION_SYSTEM = 'https://cloud-wildcatch.invalid/fhir/CodeSystem/extension-version'
const HOSPITAL_LOCAL_SOURCE = 'ehr-fhir-bridge/extension-local'
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/
const REQUEST_TIMEOUT_MS = 5_000

/** Progressive stages that end a hospital capture; intermediate stages are not reported. */
export type HospitalCaptureStage = 'hospital' | 'hospital-reports-failed' | 'hospital-empty' | 'cloud-only'
export type Tag = { system?: unknown; code?: unknown; display?: unknown }

export interface HospitalCaptureSummary {
  path: HospitalCaptureEvent['path']
  outcome: HospitalCaptureEvent['outcome']
  failures: HospitalCaptureEvent['failures']
  hospitalVersion?: string
  medcloudVersion?: string
  hospitalResources: number
  chartNo?: string
  durationMs?: number
  requestCount?: number
  storedRecord?: NonNullable<HospitalCaptureEvent['stored_record']>
  stageMs?: NonNullable<HospitalCaptureEvent['stage_ms']>
  resourceCounts?: NonNullable<HospitalCaptureEvent['resource_counts']>
  encounterCounts?: NonNullable<HospitalCaptureEvent['encounter_counts']>
}

const singleCode = (tags: Tag[], system: string) => {
  const matches = tags.filter(tag => tag.system === system)
  return matches.length === 1 && typeof matches[0].code === 'string' ? matches[0].code : undefined
}

export function failureFromTag(tag: Tag): HospitalCaptureEvent['failures'][number] | null {
  if (tag.system !== FAILURE_SYSTEM || typeof tag.code !== 'string' || typeof tag.display !== 'string') return null
  const [category, kind, status, extra] = tag.code.split(':')
  const count = /^[1-9]\d{0,4}$/.test(tag.display) ? Number(tag.display) : NaN
  const parsedCategory = hospitalCaptureCategorySchema.safeParse(category), parsedKind = hospitalCaptureFailureKindSchema.safeParse(kind)
  if (extra !== undefined || !parsedCategory.success || !parsedKind.success || !Number.isInteger(count)) return null
  if (status === undefined) return { category: parsedCategory.data, kind: parsedKind.data, count }
  return /^[1-5]\d\d$/.test(status) ? { category: parsedCategory.data, kind: parsedKind.data, status: Number(status), count } : null
}

const singleVersion = (tags: Tag[], system: string) => {
  const matches = tags.filter(tag => tag.system === system)
  return matches.length === 1 && typeof matches[0].code === 'string' && VERSION.test(matches[0].code) ? matches[0].code : undefined
}

/** The measures the extension tagged, by name; a name tagged twice or a malformed one is left out. */
function measuresOf(tags: Tag[]): Map<string, number> {
  const seen = new Map<string, number[]>()
  for (const tag of tags) {
    const match = tag.system === MEASURE_SYSTEM && typeof tag.code === 'string' ? /^([a-z_]{1,24}):(0|[1-9]\d{0,6})$/.exec(tag.code) : null
    if (match) seen.set(match[1], [...(seen.get(match[1]) ?? []), Number(match[2])])
  }
  return new Map([...seen].filter(([, values]) => values.length === 1).map(([name, values]) => [name, values[0]]))
}

/** What the tags say of the stored record and of each part's time, each only when the Collector's contract takes it. */
function stagesOf(tags: Tag[]): Pick<HospitalCaptureSummary, 'storedRecord' | 'stageMs'> {
  const measures = measuresOf(tags)
  const shape = hospitalCaptureEventSchema.shape
  const outcome = singleCode(tags, STORED_RECORD_SYSTEM)
  const sizes = Object.fromEntries(RECORD_SIZES.filter(name => measures.has(name)).map(name => [name, measures.get(name)]))
  const stored = outcome === undefined ? undefined : [{ outcome, ...sizes }, { outcome }].map(value => shape.stored_record.safeParse(value)).find(parsed => parsed.success)?.data
  const stages = Object.fromEntries(Object.entries(STAGES).filter(([tag]) => measures.has(tag) && measures.get(tag)! <= 3_600_000).map(([tag, name]) => [name, measures.get(tag)]))
  const stageMs = Object.keys(stages).length ? shape.stage_ms.safeParse(stages).data : undefined
  return { ...(stored ? { storedRecord: stored } : {}), ...(stageMs ? { stageMs } : {}) }
}

/** Null when this import is not the end of a 北榮 capture (manual files, cloud-only stages, demo data). */
export function summarizeHospitalCapture(bundle: unknown, stage?: string): HospitalCaptureSummary | null {
  const b = bundle as { meta?: { source?: unknown; tag?: unknown }; entry?: unknown } | null
  const tags: Tag[] = Array.isArray(b?.meta?.tag) ? b!.meta!.tag.filter((t: unknown): t is Tag => !!t && typeof t === 'object') : []
  const entries: Array<{ resource?: { resourceType?: unknown; meta?: { tag?: unknown } } }> = Array.isArray(b?.entry) ? b!.entry : []
  const oneClick = stage === undefined && b?.meta?.source === HOSPITAL_LOCAL_SOURCE
  if (!oneClick && !['hospital', 'hospital-reports-failed', 'hospital-empty', 'cloud-only'].includes(stage ?? '')) return null
  const failures = tags.map(failureFromTag).filter(f => f !== null).slice(0, 40)
  const hospitalEntries = oneClick
    ? entries.filter(e => e?.resource?.resourceType && e.resource.resourceType !== 'Patient')
    : entries.filter(e => Array.isArray(e?.resource?.meta?.tag) && e.resource.meta.tag.some((t: Tag) =>
      t?.system === 'urn:wildcatch:source' && t.code === 'vghtpe-outpatient-supplement'))
  const hospitalResources = hospitalEntries.length
  // zod 4 records over an enum need every key; the Collector does not show the zeros.
  const resourceCounts = Object.fromEntries(hospitalCaptureResourceTypeSchema.options.map(k => [k, 0])) as NonNullable<HospitalCaptureSummary['resourceCounts']>
  const encounterCounts = Object.fromEntries(hospitalCaptureEncounterClassSchema.options.map(k => [k, 0])) as NonNullable<HospitalCaptureSummary['encounterCounts']>
  for (const e of hospitalEntries) {
    const resource = e.resource as { resourceType?: unknown; class?: { code?: unknown } }
    const type = hospitalCaptureResourceTypeSchema.safeParse(resource.resourceType).success ? resource.resourceType as keyof typeof resourceCounts : 'other'
    resourceCounts[type] += 1
    if (resource.resourceType === 'Encounter') {
      const cls = ENCOUNTER_CLASS[String(resource.class?.code ?? '')] ?? 'other'
      encounterCounts[cls] += 1
    }
  }
  const chart = singleCode(tags, CHART_SYSTEM)
  const duration = Number(singleCode(tags, DURATION_SYSTEM))
  const requests = singleCode(tags, REQUESTS_SYSTEM)
  const incomplete = failures.length > 0 || tags.some(t => t.system === COMPLETENESS_SYSTEM && t.code === 'partial')
  const outcome: HospitalCaptureEvent['outcome'] = stage === 'cloud-only' ? 'failed'
    : stage === 'hospital-reports-failed' || incomplete ? 'partial'
    : stage === 'hospital-empty' || hospitalResources === 0 ? 'empty' : 'complete'
  return { path: oneClick ? 'one_click' : 'medcloud_relay', outcome, failures: outcome === 'complete' ? [] : failures,
    hospitalVersion: singleVersion(tags, HOSPITAL_VERSION_SYSTEM), medcloudVersion: singleVersion(tags, MEDCLOUD_VERSION_SYSTEM), hospitalResources,
    ...(chart && CHART_NO.test(chart) ? { chartNo: chart } : {}),
    ...(Number.isInteger(duration) && duration >= 0 && duration <= 3_600_000 ? { durationMs: duration } : {}),
    ...(typeof requests === 'string' && /^\d{1,5}$/.test(requests) ? { requestCount: Number(requests) } : {}),
    ...stagesOf(tags),
    ...(hospitalResources ? { resourceCounts, encounterCounts } : {}) }
}

function bucket(n: number): HospitalCaptureEvent['hospital_resources'] {
  return n === 0 ? '0' : n <= 10 ? '1-10' : n <= 50 ? '11-50' : n <= 200 ? '51-200' : n <= 1000 ? '201-1000' : '1000+'
}

/** Fire-and-forget; the clinical import never waits on or fails because of this. */
export function reportHospitalCapture(bundle: unknown, stage?: string, reason?: string): void {
  try {
    if (!isCollectorSite()) return
    const summary = summarizeHospitalCapture(bundle, stage)
    const base = configuredEndpoint()
    if (!summary || !base) return
    const event = hospitalCaptureEventSchema.safeParse({
      schema_version: 1, event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), site: 'vghtpe',
      app_surface: collectorAppSurface(),
      app_version: process.env.NEXT_PUBLIC_COLLECTOR_APP_VERSION || '0.0.0',
      build_revision: process.env.NEXT_PUBLIC_COLLECTOR_BUILD_REVISION || 'unknown',
      path: summary.path, outcome: summary.outcome, failures: summary.failures,
      ...(summary.hospitalVersion ? { hospital_extension_version: summary.hospitalVersion } : {}),
      ...(summary.medcloudVersion ? { medcloud_extension_version: summary.medcloudVersion } : {}),
      hospital_resources: bucket(summary.hospitalResources),
      ...(summary.chartNo ? { chart_no: summary.chartNo } : {}),
      ...(summary.durationMs !== undefined ? { duration_ms: summary.durationMs } : {}),
      ...(summary.requestCount !== undefined ? { request_count: summary.requestCount } : {}),
      ...(summary.storedRecord ? { stored_record: summary.storedRecord } : {}),
      ...(summary.stageMs ? { stage_ms: summary.stageMs } : {}),
      ...(summary.resourceCounts ? { resource_counts: summary.resourceCounts, encounter_counts: summary.encounterCounts } : {}),
      // Only a cloud-only end carries 雲端懷爾抓抓's closed reason code; anything else is dropped.
      ...(stage === 'cloud-only' && summary.outcome === 'failed' && hospitalUnavailableReasonSchema.safeParse(reason).success
        ? { unavailable_reason: reason } : {}),
    })
    if (!event.success) return
    const endpoint = base.replace(/\/collector\/v1\/events$/, '/collector/v1/capture-events')
    void (async () => {
      const permission = await collectorNetworkPermission(endpoint)
      if (permission?.state !== 'granted') return
      const token = await (await captureCollectorAuth())?.getToken()
      if (!token || permission.state !== 'granted' || !isCollectorSite()) return
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(event.data), signal: controller.signal, credentials: 'omit',
          referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
        })
        void response.body?.cancel().catch(() => {})
      } finally { clearTimeout(timer) }
    })().catch(() => {})
  } catch { /* Telemetry must never affect the import. */ }
}
