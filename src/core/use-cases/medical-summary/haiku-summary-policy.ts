import type { AiMessage } from '@/src/core/entities/ai.entity'
import type { MedicalSummaryCardId } from '@/src/core/entities/medical-summary.entity'

/**
 * How 標準摘要 is asked of Claude Haiku 5.5 (measured 2026-11-24 on the
 * 雲端病歷 demo patient, ~106k input tokens per narrative request).
 *
 * One batch of overview + problems + safety without hidden thinking finished
 * in 19 s but paired medicines with the wrong problems and broke the safety
 * rules; adaptive thinking on that batch needed 56-82 s before any text.
 * Asking for each card in its own request lets each get what it needs:
 *
 * - overview: on screen in 3-8 s. Alone it romanized hospital names in 8 of
 *   10 runs, and across the earlier wordings 5 of 33 headlines turned
 *   隅角開放性青光眼 into "angle-closure"; with this check, neither in 10 runs.
 * - problems: at low effort Haiku never thinks for this card, and at medium
 *   it spent 20,000 tokens thinking and wrote nothing. A short visible
 *   worksheet before the card (medicine -> condition, problem -> test) costs
 *   ~1 s and removed the cross-problem medicine pairings; ~12-16 s in all.
 * - safety: adaptive thinking at low effort, with the instruction to test
 *   every candidate against its rule. Four of four runs thought, took
 *   19-30 s and returned rule-conforming alerts; without thinking the same
 *   request invented renal and duplicate alerts.
 */
const HAIKU_MODEL_ID = 'claude-haiku-5-5'

const OVERVIEW_CHECK = `FINAL CHECK FOR THE OVERVIEW CARD.
Diagnoses: translate each one from the record's own Chinese wording, character by character, before you write it. A subtype, side or stage (開放性 is open, 閉鎖性 is closed) must say what the record says; when you are not certain of one, name the condition without it.
Organizations: write a name only by copying it character for character from the record, never romanized or translated; when that does not fit, say "several hospitals and clinics". A pharmacy is not a place of care, so do not name one.
The headline is a list of problem names and how care is split, nothing else. Before returning it, delete every number, unit, test name, trend word and medicine name from it.`

const PROBLEMS_CHECK = `FINAL STEP FOR THE PROBLEMS CARD. First write a worksheet between the lines <<<WORKSHEET>>> and <<<END_WORKSHEET>>>; the app discards it, so keep it terse. Then output the card.
Worksheet part 1, one line per distinct medicine supplied in the last 6 months (use the key of its latest fill): M-key | ingredient | the one condition this ingredient treats in this patient, or "unclear". Decide from the ingredient and its ATC subgroup alone. Sharing a visit, a hospital or a dispensing day with a diagnosis is not a reason.
Worksheet part 2, one line per problem you will list: condition | E/D/L keys that establish it | the test that measures this condition with its O/L keys, or "none in record".
The card must agree with the worksheet: a medicine appears in "medicationSources" only under the condition named on its own worksheet line, and never when that line says "unclear"; a condition named on a medicine line but backed by no diagnosis becomes a medication-based problem when the class points to one condition. One row per condition: merge a lab-only finding into the coded diagnosis it belongs to.
In the card, "label" is the plain condition name with the certainty the record supports: no ICD codes, dates, values or treatment notes, and no qualifier the record does not state. "metric" quotes only the test from the worksheet line, values oldest to newest, without dates. "managedBy" is a hospital or clinic copied from the record, never a pharmacy; when only a pharmacy dispensed the medicines, omit "managedBy" and "managedByRef". Count the visits in "basis" from the encounters you cite.`

const SAFETY_CHECK = `FINAL CHECK FOR THE SAFETY CARD. Before writing, think through every candidate alert across renal dosing, bleeding or antithrombotics, critical labs, duplicate therapy, allergy, anticholinergic burden and monitoring, and test each one against the rule above that governs it; keep only the candidates whose rule the record fully meets. Source keys go only in "sources", never inside "title", "detail", "evidence" or "recommendation". Severity follows the rules above: duplicate, monitoring and anticholinergic-burden alerts are never "high". Return the safety module with valid JSON and its exact end marker.`

const REPORTS_CHECK = `FINAL CHECK: Preserve negation, examination dates and uncertainty exactly as each report states them. Do not add "new", "worsening", "progressive" or "old" unless the quoted report supports that comparison or timing, and never move an older finding to the latest examination.`

const LANE_CHECKS: Record<MedicalSummaryCardId, string> = {
  overview: OVERVIEW_CHECK,
  problems: PROBLEMS_CHECK,
  safety: SAFETY_CHECK,
  reports: REPORTS_CHECK,
}

const BATCH_CONTRACT = 'BATCH CARD OUTPUT CONTRACT: '

export function usesHaikuSummaryLanes(modelId: string): boolean {
  return modelId === HAIKU_MODEL_ID
}

/** The shared system rules describe every section. A one-card request says
 *  which card it is for, then ends on that card's own check. */
export function withHaikuSummaryLanePolicy(
  messages: AiMessage[],
  modelId: string,
  cardIds: readonly MedicalSummaryCardId[],
): AiMessage[] {
  if (!usesHaikuSummaryLanes(modelId) || cardIds.length !== 1) return messages
  const [cardId] = cardIds
  const scope = `${BATCH_CONTRACT}This request covers ONLY the ${cardId} card. ` +
    'The contracts above for other sections are context only; output no other module. '
  return messages.map((message) => message.role === 'system'
    ? { ...message, content: message.content.replace(BATCH_CONTRACT, scope) }
    : { ...message, content: `${message.content}\n\n${LANE_CHECKS[cardId]}` })
}

/** Only the safety card thinks; its thinking shares the output ceiling. */
export function haikuSummaryLaneOptions(
  modelId: string,
  cardIds: readonly MedicalSummaryCardId[],
): { claudeThinking?: 'adaptive'; maxTokens?: number } {
  return usesHaikuSummaryLanes(modelId) && cardIds.length === 1 && cardIds[0] === 'safety'
    ? { claudeThinking: 'adaptive', maxTokens: 16_000 }
    : {}
}
