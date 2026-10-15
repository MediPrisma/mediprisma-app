// Proactive Safety Alerts — the FIXED, structured shape the AI must return so
// the UI can render固定卡片 instead of free-text. Pure AI generation (the model
// reasons over the clinical context) but constrained to this schema; we Zod-
// validate the parsed JSON so a malformed response is rejected, not rendered.
import { z } from 'zod'
import { clampLine } from '@/src/core/utils/clamp-line.utils'

export const SAFETY_SEVERITIES = ['high', 'medium', 'low'] as const
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number]

export const SAFETY_CATEGORIES = [
  'renal',
  'bleeding',
  'critical-lab',
  'duplicate',
  'allergy',
  'monitoring',
  'other',
] as const
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number]

// Lenient on category (the model may emit something off-list → coerce to
// 'other') but strict on severity (drives the badge colour).
// Size caps CLAMP (slice/truncate) instead of rejecting — verbose models
// (Claude Haiku) exceed them with good content, and one oversize field must
// not void a whole safety scan (see medical-summary.entity.ts, 2026-07).
// Clamp at a clause boundary with an ellipsis, never mid-word.
const trimTo = (max: number) => (s: string) => clampLine(s.trim(), max)
export const SafetyAlertSchema = z.object({
  severity: z.enum(SAFETY_SEVERITIES),
  title: z.string().min(1).transform(trimTo(80)),
  detail: z.string().min(1).transform(trimTo(400)),
  evidence: z.array(z.string()).optional().default([]).transform((a) => a.slice(0, 10)),
  // Source-list keys (e.g. "L3", "M2") for the bundle records this alert is
  // based on — resolved app-side to clickable citations that navigate the left
  // panel to the raw FHIR resource (parity with the summary/decision cards).
  sources: z.array(z.string()).optional().default([]).transform((a) => a.slice(0, 10)),
  category: z.string().optional(),
  recommendation: z.string().transform(trimTo(400)).optional(),
})
export type SafetyAlertInput = z.infer<typeof SafetyAlertSchema>

export const SafetyScanResultSchema = z.object({
  scannedCount: z.number().int().nonnegative().optional().default(0),
  // Runaway guard only — the prompt has no alert quota (an empty array is a
  // valid result), so the clamp sits well above any genuine scan.
  alerts: z.array(SafetyAlertSchema).default([]).transform((a) => a.slice(0, 30)),
})
export type SafetyScanResultInput = z.infer<typeof SafetyScanResultSchema>

/** A validated alert with a stable id + normalised category for the UI. */
export interface SafetyAlert extends SafetyAlertInput {
  id: string
  category: SafetyCategory
  /** Existing D# resources whose document text does not support a procedure
   *  asserted by this alert. The UI keeps them visible but marks them amber. */
  unsupportedSourceKeys?: string[]
  /** Cited medicines the alert calls anticholinergic although their listed
   *  mechanism and burden say otherwise. Shown as 待核對, never removed. */
  propertyReviewKeys?: string[]
}

export interface SafetyScanResult {
  /** App-authored provenance used to restore model-specific scan versions.
   * Legacy caches may omit it; bundled demo results identify Flash-Lite
   * explicitly so they cannot masquerade as another selected model. */
  generation?: SafetyScanGeneration
  scannedCount: number
  alerts: SafetyAlert[]
}

export type SafetyScanGeneration = {
  source: 'live'
  modelId: string
  modelName: string
  generatedAt: number
} | {
  source: 'pre-generated'
  modelId: string
  modelName: string
}

export function normaliseCategory(raw?: string): SafetyCategory {
  const c = (raw ?? '').toLowerCase().trim()
  return (SAFETY_CATEGORIES as readonly string[]).includes(c) ? (c as SafetyCategory) : 'other'
}

/** Sort rank so the UI can order high → medium → low deterministically,
 *  independent of the order the model happened to emit. */
export const SEVERITY_RANK: Record<SafetySeverity, number> = { high: 0, medium: 1, low: 2 }

/** Count alerts by severity — drives the section-nav breakdown and tiering. */
export function countBySeverity(alerts: SafetyAlert[]): Record<SafetySeverity, number> {
  const counts: Record<SafetySeverity, number> = { high: 0, medium: 0, low: 0 }
  for (const a of alerts) counts[a.severity] += 1
  return counts
}
