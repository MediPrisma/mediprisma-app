// DocumentEntry — unified view-model that abstracts the two FHIR resources
// the document-summary card can surface:
//
//   1. FHIR Composition (e.g. IPS bundles): structured, multi-section, the
//      section.text.div XHTML carries the human-readable narrative.
//   2. FHIR DocumentReference (e.g. 健保存摺 discharge summaries via bridge
//      v0.17.0+): a self-contained attachment — typically text/html — held
//      verbatim in attachment.data (base64) or fetched from attachment.url.
//
// Both flow into DocumentSummaryCard which dispatches to the right renderer
// based on `sourceKind`. The card itself is source-agnostic so adding a
// third source later (e.g. a referral letter as DocumentReference) needs no
// card-level change.
import type { CompositionEntity } from '@/src/core/entities/clinical-data.entity'

export interface DocumentEntry {
  /** Stable id for React keys; falls back to a synthesised string when the
   *  source resource has no id. */
  id: string
  /** ISO date used for sort + display. Sort is newest-first. */
  date: string
  /** Pretty type label e.g. '出院病摘', 'IPS 國際病人摘要'. Falls back to the
   *  source's own title fields if no LOINC mapping applies. */
  typeLabel: string
  /** LOINC code for type.coding, when present. */
  typeCode: string | null
  /** Which underlying FHIR resource this entry came from. Drives renderer. */
  sourceKind: 'composition' | 'documentReference'
  /** True when this is an IPS-profiled Composition — surfaces an IPS badge. */
  isIps: boolean
  /** True when this is a 出院病摘 (LOINC 18842-5) — surfaces a discharge badge.
   *  Recognised on both Composition.type AND DocumentReference.type. */
  isDischargeSummary: boolean
  /** Institution / 機構, when discoverable. For DocumentReference this comes
   *  from attachment.title (bridge encodes it as "出院病摘 — 長庚嘉義 …"). */
  institution?: string
  outpatient?: { department?: string; physician?: string }
  /** Date range (e.g. hospitalisation period for a discharge summary). */
  period?: { start?: string; end?: string }
  /** Free-form subtitle (e.g. the bridge-formatted attachment.title). */
  subtitle?: string
  /** Linked visit's primary diagnosis. Outpatient notes resolve the rank-one
   *  Encounter.diagnosis Condition; inpatient summaries retain reasonCode. */
  primaryDiagnosis?: {
    /** Localised display text (e.g. '咳血' for zh-TW, 'Hemoptysis' for en). */
    text: string
    /** ICD-10 code, when present — useful for tooltips / debugging. */
    code?: string
  }

  // ── Renderer payload — exactly one of these is populated. ─────────────
  /** Original Composition resource (when sourceKind === 'composition'). */
  composition?: CompositionEntity
  /** Self-contained HTML attachment (when sourceKind === 'documentReference').
   *  Held in raw form here; sanitisation happens inside the renderer on demand
   *  so we don't pay the DOMPurify cost for documents the user never expands. */
  attachment?: {
    contentType?: string
    /** Base64-encoded body (no `data:` prefix in bridge output). */
    data?: string
    url?: string
    title?: string
    size?: number
  }
  /** Encounter reference (e.g. 'Encounter/xxx') for future jump-to-visit. */
  encounterRef?: string
}
