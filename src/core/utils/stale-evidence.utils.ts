// 「依據資料已逾 1 年」(owner decision 2026-10-03): an alert whose every cited
// record is more than a year older than the reference date is labelled, never
// dropped or rewritten. The cloud record keeps a year of visits; a check-up
// reading years old can still reach the model, and a model may read it as
// current ("Hypertension uncontrolled" on a 2022 BP).

const DAY_MS = 86_400_000

/** The Taipei calendar day of an instant. */
const taipeiDay = (ms: number): string => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10)

/**
 * The newest cited date when every cited record is dated and that newest one
 * is more than a year before the reference date; otherwise undefined. An
 * undated record (a diagnosis, an unresolved key) means the age cannot be
 * stated, so nothing is labelled.
 */
export function staleEvidenceDate(
  dates: ReadonlyArray<string | undefined>,
  referenceMs: number,
): string | undefined {
  if (dates.length === 0 || !Number.isFinite(referenceMs)) return undefined
  if (dates.some((date) => !date || !/^\d{4}-\d{2}-\d{2}/.test(date))) return undefined
  const newest = dates.map((date) => date!.slice(0, 10)).sort().at(-1)!
  return newest < taipeiDay(referenceMs - 365 * DAY_MS) ? newest : undefined
}
