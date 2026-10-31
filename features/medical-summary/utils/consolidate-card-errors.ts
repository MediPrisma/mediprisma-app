import { MEDICAL_SUMMARY_CARD_IDS } from "@/src/core/entities/medical-summary.entity"
import type { GenerationErrorItem } from "../components/GenerationErrorBanner"

/** Consolidate only when every standard card has the same displayed error.
 *  `totalCards` is how many cards this audience is asked for (the patient
 *  version never requests 影像與病理重點). */
export function consolidateCardErrors(
  failedCards: GenerationErrorItem[],
  summaryLabel: string,
  totalCards: number = MEDICAL_SUMMARY_CARD_IDS.length,
): GenerationErrorItem[] {
  if (
    failedCards.length === totalCards &&
    new Set(failedCards.map((item) => item.message)).size === 1
  ) {
    return [{ label: summaryLabel, message: failedCards[0].message }]
  }
  return failedCards
}
