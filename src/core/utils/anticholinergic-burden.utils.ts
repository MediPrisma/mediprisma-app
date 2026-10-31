// The anticholinergic medicines a patient is taking, counted by the app so a
// small model does not have to. 開藥注意 raises an anticholinergic alert by
// the AGS Beers 2023 rules — two or more anticholinergics together (Table 5),
// or one strong anticholinergic with dementia, cognitive impairment, delirium,
// or LUTS/BPH in a man (Table 3), plus urinary retention in anyone — and never
// for one medicine otherwise (owner, 2026-10-05). An alert that does not meet
// them is labelled 待核對, never removed.

import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'
import { anticholinergicLineLabel, showsAnticholinergic } from './medicine-profile.utils'

/** "Supplied together": a fill whose supply reached into the 90 days before
 *  the reference date. */
export const ANTICHOLINERGIC_WINDOW_DAYS = 90

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface CurrentAnticholinergic {
  /** "oxybutynin", from the medication class. */
  ingredient: string
  /** The newest fill. */
  entry: SummarySourceCatalogEntry
}

/** The reference date the counts use: the given one, else the newest record. */
export const anticholinergicReferenceDate = (catalog: readonly SummarySourceCatalogEntry[], referenceDate?: string) =>
  referenceDate ?? catalog.map((entry) => entry.date ?? '').filter(Boolean).sort().at(-1)

/** Whether a fill was dispensed by the reference date and its supply reached
 *  the 90 days before it. */
function suppliedInWindow(entry: SummarySourceCatalogEntry, reference: string | undefined): boolean {
  const referenceMs = reference ? Date.parse(reference) : Number.NaN
  if (!reference || Number.isNaN(referenceMs) || !entry.date || entry.date > reference) return false
  const from = isoDay(referenceMs - ANTICHOLINERGIC_WINDOW_DAYS * 86_400_000)
  return (entry.supplyEnd ?? entry.date) >= from
}

/**
 * The class a SOURCE LIST line prints beside a medicine: its medicationClass,
 * plus "anticholinergic ACB 3" only for a fill supplied in the 90 days before
 * the reference date. A stopped medicine keeps its mechanism but not the
 * label: printed on a fill that had run out months before, the label led a
 * small model to raise an anticholinergic alert for a medicine the patient
 * was no longer taking (2026-10-05).
 */
export function medicationClassOnLine(entry: SummarySourceCatalogEntry, reference: string | undefined): string | undefined {
  const label = entry.medicine?.anticholinergic
  const anticholinergic = showsAnticholinergic(label) && suppliedInWindow(entry, reference)
    ? anticholinergicLineLabel(label!)
    : ''
  return [entry.medicationClass ?? '', anticholinergic].filter(Boolean).join(' · ') || undefined
}

/**
 * The anticholinergic medicines (ACB 2–3, Beers strong, or an antimuscarinic
 * mechanism) whose supply reached the 90 days before the reference date, one
 * per ingredient. ACB 1 ("possible") medicines are not counted, as on the
 * SOURCE LIST lines.
 */
export function currentAnticholinergicMedicines(
  catalog: readonly SummarySourceCatalogEntry[],
  referenceDate?: string,
): CurrentAnticholinergic[] {
  const reference = anticholinergicReferenceDate(catalog, referenceDate)
  const newest = new Map<string, SummarySourceCatalogEntry>()
  for (const entry of catalog) {
    if (!entry.resourceType.startsWith('Medication') || !showsAnticholinergic(entry.medicine?.anticholinergic)) continue
    if (!suppliedInWindow(entry, reference)) continue
    const ingredient = entry.medicationClass?.split(' · ')[0]?.trim() || entry.display
    const current = newest.get(ingredient)
    if (!current || (entry.date ?? '') > (current.date ?? '')) newest.set(ingredient, entry)
  }
  return [...newest].map(([ingredient, entry]) => ({ ingredient, entry }))
}

/**
 * "ANTICHOLINERGIC MEDICINES SUPPLIED IN THE 90 DAYS BEFORE 2026-10-05:
 * oxybutynin [M1] ACB 3; imipramine [M23] ACB 3 (2 medicines)." Undefined
 * when there are none: a "none" line printed for every patient kept the topic
 * in front of the model, and alerts leaned toward it (owner, 2026-10-05). An
 * alert raised without the line is labelled 待核對 in the app.
 */
export function anticholinergicMedicinesLine(
  catalog: readonly SummarySourceCatalogEntry[],
  referenceDate?: string,
): string | undefined {
  const reference = anticholinergicReferenceDate(catalog, referenceDate)
  if (!reference || Number.isNaN(Date.parse(reference))) return undefined
  const heading = `ANTICHOLINERGIC MEDICINES SUPPLIED IN THE ${ANTICHOLINERGIC_WINDOW_DAYS} DAYS BEFORE ${reference}:`
  const medicines = currentAnticholinergicMedicines(catalog, reference)
  if (medicines.length === 0) return undefined
  const items = medicines.map(({ ingredient, entry }) => `${ingredient} [${entry.key}] ${entry.medicine!.anticholinergic}`)
  return `${heading} ${items.join('; ')} (${medicines.length} ${medicines.length === 1 ? 'medicine' : 'medicines'}).`
}

const ANTICHOLINERGIC_CLAIM = /anti-?cholinergic|anti-?muscarinic|抗膽鹼|抗毒蕈鹼/i
// A condition one strong anticholinergic is an alert with (Beers 2023 Table
// 3, and urinary retention in anyone). BPH and urinary symptoms by name:
// prostate cancer is not Table 3's condition.
const QUALIFYING_CONDITION =
  /dementia|cognitive (impairment|decline|disorder|dysfunction)|delirium|confusion|\bBPH\b|prostatic hyperplasia|enlarged prostate|\bLUTS\b|lower urinary tract symptoms?|urinary (retention|symptoms?|hesitancy)|retention of urine|失智|認知(障礙|功能|退化)|譫妄|攝護腺(肥大|增生)|前列腺(肥大|增生)|下泌尿道症狀|尿滯留|排尿困難|解尿困難/i
// "no urinary retention", "without dementia": the condition is absent.
const NEGATION = /\b(no|not|without|denies|denied|negative for|absence of|rule[sd]? out|free of)\b|無|沒有|未見|否認|排除/i

/** A clause names a qualifying condition, and no negation stands just before
 *  it ("do not use in a patient with dementia" still names dementia). */
function namesQualifyingCondition(text: string): boolean {
  return text.split(/[.;,。；，、]|\bbut\b|\band\b/i).some((clause) => {
    const match = QUALIFYING_CONDITION.exec(clause)
    return match !== null && !NEGATION.test(clause.slice(Math.max(0, match.index - 16), match.index))
  })
}

/** Why an anticholinergic alert does not meet the alert rules, if it does not. */
export type AnticholinergicAlertReview = 'none-supplied' | 'one-without-condition'

/**
 * Judged against the count the app made: none supplied in the window, or one
 * with no qualifying condition in the alert or in the patient's problem list.
 * The problem list counts: an alert for a patient whose list holds urinary
 * retention was labelled "names no condition" although the condition was
 * there (2026-10-05). Age is not checked here. Undefined for an alert that is
 * not about anticholinergics, or that meets the rules.
 */
export function reviewAnticholinergicAlert(
  alert: { title: string; detail: string },
  currentCount: number,
  problemLabels: readonly string[] = [],
): AnticholinergicAlertReview | undefined {
  const text = `${alert.title} ${alert.detail}`
  if (!ANTICHOLINERGIC_CLAIM.test(text)) return undefined
  if (currentCount === 0) return 'none-supplied'
  if (currentCount === 1 && !namesQualifyingCondition([text, ...problemLabels].join('; '))) return 'one-without-condition'
  return undefined
}
