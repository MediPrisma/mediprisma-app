const DAY_MS = 86400000

/** This Taiwan clinical application presents medication dates in Taipei. */
export function medicationClinicalTimestamp(value: string): number {
  return Date.parse(value.length === 10 ? `${value}T00:00:00+08:00`
    : /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : value + '+08:00')
}

export function medicationClinicalDay(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  const stamp = typeof value === 'number' ? value : medicationClinicalTimestamp(value)
  const date = new Date(stamp + 8 * 3600000)
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    ? date.toISOString().slice(0, 10) : undefined
}
export function medicationSupplyEndDay(start: string | undefined, days: number | undefined): string | undefined {
  const match = start?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match || !days || !Number.isInteger(days) || days < 1) return undefined
  const [, y, m, d] = match
  const end = new Date(Date.UTC(+y, +m - 1, +d + days - 1))
  return Number.isFinite(end.getTime()) && end.getUTCFullYear() >= 1 && end.getUTCFullYear() <= 9999
    ? end.toISOString().slice(0, 10) : undefined
}

/** Inclusive calendar days of the documented/estimated supply, not adherence. */
export function medicationSupplyDaysRemaining(end: string, nowMs: number): number | undefined {
  const day = medicationClinicalDay(end)
  if (!day) return undefined
  const today = Date.parse(`${medicationClinicalDay(nowMs)}T00:00:00Z`)
  const difference = Math.round((Date.parse(`${day}T00:00:00Z`) - today) / DAY_MS)
  if (end.length > 10 && medicationClinicalTimestamp(end) < nowMs && difference >= 0) return 0
  return difference >= 0 ? difference + 1 : difference
}
