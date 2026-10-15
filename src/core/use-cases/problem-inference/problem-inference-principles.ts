// Shared problem-list inference semantics (問題清單推論原則).
//
// Single source of truth for HOW an active problem list is inferred from
// Taiwan NHI 健康存摺 data. Referenced by BOTH structured-AI consumers:
//   - the Medical Summary "problems" card prompt
//     (src/core/use-cases/medical-summary/generate-medical-summary.use-case.ts)
//   - the IPS-export problem-list inference prompt
//     (features/ips-export/utils/inference-engine.ts)
//
// Each consumer keeps its OWN evidence input (full clinical context vs the IPS
// evidence digest) and its OWN text-only output contract (SummaryProblemSchema
// vs ProblemRawSchema — neither generates diagnosis codes); only this
// inference-principles text is shared, so the two features reason about problems
// the same way.

/**
 * The core synthesis rule. Deliberately starts lowercase ("infer …") so each
 * prompt can supply its own framing prefix (e.g. `For "problems", …`).
 */
export const PROBLEM_INFERENCE_SYNTHESIS_RULE =
  'infer the patient\'s ACTIVE problem list by SYNTHESISING across ALL data — not just claim diagnosis codes: ' +
  'coded diagnoses, ABNORMAL LAB patterns (e.g. repeatedly low Hb → 貧血), DISPENSED MEDICATIONS that imply a condition ' +
  '(when the medicine\'s class points to one condition, e.g. antiglaucoma drops → glaucoma or ocular hypertension, thyroid hormone → hypothyroidism; a class with several uses only together with other evidence), care plans, and discharge summaries.'
