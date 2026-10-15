// Pre-generated AI snapshots for the DEMO bundle (示範資料, demo-patient-1).
//
// Why: the demo bundle is frozen, so its AI output is effectively a constant —
// re-generating it for every first-time visitor burns AI calls per visit (and
// the visitor's free-tier quota) to recompute a known answer, and exposes the
// first impression to transient model failures. These snapshots are REAL
// AI-authored raw outputs (same schema the live models produce), written
// against the catalog keys that buildSourceCatalog() derives from
// public/demo/demo-bundle.json.
//
// Provenance (refreshed 2026-10-05): 初診快覽 — overview, problems, 開藥注意 and,
// for clinicians, 影像與病理重點 — generated in the app with Gemini 3.8 Flash
// through the free-tier proxy, one run per locale × audience, over the scope
// the 初診 defaults give the demo (the record is small, so all of it). Each was
// the best of two or three runs, read for missed problems, wrong facts and
// repetition. Two medicines the model attached to a problem they do not treat
// were removed (artificial tears under glaucoma; acetaminophen under BPH);
// nothing else was edited. Assembled by scripts/assemble-demo-snapshots.ts,
// which also records each cited key's FHIR resource (`sourceResourceIds`).
// The clinical-insight snapshots are older (Gemini 3 Flash Preview, 2026-09-04).
// Live patients still use the model-generated path.
//
// They deliberately store the RAW pre-parse shape, NOT the finalized result:
// the hooks feed them through the exact same parse → finalize/verify pipeline
// as a live reply, so citation resolution, verification marking and navigation
// stay honest. If the demo bundle ever changes, stale citations surface as
// amber "unverified" sources — the visible signal to regenerate this file (run
// scripts/validate-demo-snapshots.ts).
//
// Scope guards (enforced by the hooks): demo patient + supported locale + no
// cached result. A retained model preference never causes an automatic live call;
// pressing 重新產生 explicitly still runs the selected model.
import type {
  MedicalSummaryAiResult,
  MedicalSummaryGeneration,
  SummarySourceCatalogEntry,
} from '@/src/core/entities/medical-summary.entity'
import type {
  SafetyScanGeneration,
  SafetyScanResultInput,
} from '@/src/core/entities/safety-alert.entity'
import snapshotDataJson from './demo-ai-snapshots.data.json'

export const DEMO_PATIENT_ID = 'demo-patient-1'

export const DEMO_MEDICAL_SUMMARY_GENERATION = {
  source: 'pre-generated',
  modelId: 'gemini-3.8-flash',
  modelName: 'Gemini 3.8 Flash',
} as const satisfies MedicalSummaryGeneration

export const DEMO_SAFETY_SCAN_GENERATION = {
  source: 'pre-generated',
  modelId: 'gemini-3.8-flash',
  modelName: 'Gemini 3.8 Flash',
} as const satisfies SafetyScanGeneration

export const DEMO_CLINICAL_INSIGHT_GENERATION = {
  source: 'pre-generated',
  modelId: 'gemini-3-flash-preview',
  modelName: 'Gemini 3 Flash Preview',
  provider: 'gemini',
} as const

type Audience = 'medical' | 'patient'
type SnapshotLocale = 'en' | 'zh-TW'
type LocalizedAudienceSnapshots<T> =
  Record<SnapshotLocale, Record<Audience, T>> &
  Record<Audience, T>

interface DemoSnapshotData {
  /** Each cited key → the FHIR resource it named when the snapshot was made. */
  sourceResourceIds: Record<string, string>
  medicalSummary: Record<SnapshotLocale, Record<Audience, MedicalSummaryAiResult>>
  clinicalInsights: Record<SnapshotLocale, Record<Audience, Record<string, { prompt: string; text: string }>>>
  safetyScan: Record<SnapshotLocale, Record<Audience, SafetyScanResultInput>>
}

const snapshotData = snapshotDataJson as unknown as DemoSnapshotData

// Snapshot citations are authored against the demo catalog the model saw,
// whose short keys are deterministic only while the selected AI scope is
// unchanged. A narrower scope or a small-context model may legitimately number
// the same FHIR resources differently. Resource ids are the stable bridge that
// lets the bundled snapshot keep pointing at the same evidence in either view.
export const DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY: Readonly<Record<string, string>> =
  snapshotData.sourceResourceIds

/** Citation fields of the raw module shapes: key lists ("sources",
 *  "basisSources", "metricSources", "medicationSources", reports'
 *  "unremarkable") and single keys ("source", "ref", "managedByRef"). */
const isKeyListField = (field?: string) =>
  field === 'sources' || field === 'unremarkable' || /Sources$/.test(field ?? '')
const isKeyField = (field?: string) =>
  field === 'source' || field === 'ref' || /Ref$/.test(field ?? '')

/** Re-key only citation fields; narrative/evidence text remains untouched. */
export function remapDemoSnapshotSourceKeys<T>(
  snapshot: T,
  catalog: SummarySourceCatalogEntry[],
): T {
  const currentKeyByResourceId = new Map(
    catalog.map((source) => [source.resourceId, source.key]),
  )
  // A pinned resource missing from this catalog must not fall back to its
  // old key: after records are added, that key names a different resource.
  // An unresolvable key surfaces as an unverified citation instead.
  const remapKey = (key: string) => {
    const resourceId = DEMO_SNAPSHOT_RESOURCE_ID_BY_KEY[key]
    if (!resourceId) return key
    return currentKeyByResourceId.get(resourceId) ?? `stale:${key}`
  }
  const visit = (value: unknown, field?: string): unknown => {
    if (Array.isArray(value)) {
      return isKeyListField(field)
        ? value.map((item) => typeof item === 'string' ? remapKey(item) : item)
        : value.map((item) => visit(item))
    }
    if (!value || typeof value !== 'object') {
      return isKeyField(field) && typeof value === 'string'
        ? remapKey(value)
        : value
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, visit(item, key)]),
    )
  }
  return visit(snapshot) as T
}

const demoMedicalSummarySnapshotsZhTw = snapshotData.medicalSummary['zh-TW']
const demoMedicalSummarySnapshotsEn = snapshotData.medicalSummary.en

export const demoMedicalSummarySnapshots: LocalizedAudienceSnapshots<MedicalSummaryAiResult> = {
  'zh-TW': demoMedicalSummarySnapshotsZhTw,
  en: demoMedicalSummarySnapshotsEn,
  medical: demoMedicalSummarySnapshotsZhTw.medical,
  patient: demoMedicalSummarySnapshotsZhTw.patient,
}

const demoClinicalInsightSnapshotsZhTw = snapshotData.clinicalInsights['zh-TW']
const demoClinicalInsightSnapshotsEn = snapshotData.clinicalInsights.en

export const demoClinicalInsightSnapshots: LocalizedAudienceSnapshots<Record<string, { prompt: string; text: string }>> = {
  'zh-TW': demoClinicalInsightSnapshotsZhTw,
  en: demoClinicalInsightSnapshotsEn,
  medical: demoClinicalInsightSnapshotsZhTw.medical,
  patient: demoClinicalInsightSnapshotsZhTw.patient,
}

export function getDemoClinicalInsightSnapshot(
  patientId: string,
  audience: Audience,
  locale: SnapshotLocale,
  panelId: string,
) {
  return patientId === DEMO_PATIENT_ID
    ? demoClinicalInsightSnapshots[locale][audience][panelId]
    : undefined
}

const demoSafetyScanSnapshotsZhTw = snapshotData.safetyScan['zh-TW']
const demoSafetyScanSnapshotsEn = snapshotData.safetyScan.en

export const demoSafetyScanSnapshots: LocalizedAudienceSnapshots<SafetyScanResultInput> = {
  'zh-TW': demoSafetyScanSnapshotsZhTw,
  en: demoSafetyScanSnapshotsEn,
  medical: demoSafetyScanSnapshotsZhTw.medical,
  patient: demoSafetyScanSnapshotsZhTw.patient,
}
