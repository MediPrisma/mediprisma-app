/**
 * Calendar days (YYYY-MM-DD) from instants.
 *
 * `toISOString().slice(0, 10)` reads the day in UTC. That is the right day
 * only for an instant that was itself built in UTC: a date-only string, or
 * `Date.UTC` arithmetic. For a clock reading or a record's timestamp it is the
 * day before for anything earlier than 08:00 in Taiwan. The two helpers below
 * make the caller say which one it means.
 */

const TAIPEI_OFFSET_MS = 8 * 3_600_000

/** The UTC day of an instant. Only for instants built in UTC. */
export function utcDay(instant: number | Date): string {
  return new Date(instant).toISOString().slice(0, 10)
}

/** The day in Taiwan, where these records are written and read. */
export function taipeiDay(instant: number | Date): string {
  return utcDay(new Date(instant).getTime() + TAIPEI_OFFSET_MS)
}
