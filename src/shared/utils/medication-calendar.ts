const DAY_MS = 86400000
export function medicationSupplyEndDay(start: string | undefined, days: number | undefined): string | undefined {
  const match = start?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match || !days || !Number.isInteger(days) || days < 1) return undefined
  const [, y, m, d] = match
  return new Date(Date.UTC(+y, +m - 1, +d + days - 1)).toISOString().slice(0, 10)
}

/** Inclusive calendar days of the documented/estimated supply, not adherence. */
export function medicationSupplyDaysRemaining(end: string, nowMs: number): number | undefined {
  const day = end.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!day) return undefined
  const now = new Date(nowMs)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const difference = Math.round((Date.parse(`${day}T00:00:00Z`) - today) / DAY_MS)
  return difference >= 0 ? difference + 1 : difference
}
