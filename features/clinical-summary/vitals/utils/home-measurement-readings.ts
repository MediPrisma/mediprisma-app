// Whether the home-measurement service holds readings for a 病歷號 (or, before
// the hospital's records give one, a name and birth date), asked from
// the doctor's browser with their own sign-in (both apps share the Firebase
// project). The service is reachable only on the hospital network, so anything
// short of an answer is "unknown" and must not read as "no readings".
//
// With an answer comes the service's 722 summary (its patient page heading),
// shown on the vitals card as home readings only: it never joins the
// Observations the decision rules read.
import { HEALTH_APP_ORIGIN, type HomeLookupQuery } from './home-measurement-link'

export type HomeReadings = 'some' | 'none' | 'unknown'

/** The 722 week the service computed; dates are yyyy-MM-dd. */
export interface HomeBp {
  start: string
  end: string
  systolic: number
  diastolic: number
  heartRate: number | null
  days: number
  /** Morning and bedtime sessions in the week (722 asks for 14). */
  sessions: number
  /** Enough days and sessions for the rule. */
  sufficient: boolean
  /** Every day the week depends on was fetched from the vendor. */
  dataComplete: boolean
}

export interface HomeLookup {
  readings: HomeReadings
  bp: HomeBp | null
}

const UNKNOWN: HomeLookup = { readings: 'unknown', bp: null }

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)

function homeBpOf(x: unknown): HomeBp | null {
  if (!x || typeof x !== 'object') return null
  const b = x as Record<string, unknown>
  if (!isDay(b.start) || !isDay(b.end) || !isNumber(b.systolic) || !isNumber(b.diastolic) || !isNumber(b.days) || !isNumber(b.sessions)) return null
  return {
    start: b.start, end: b.end, systolic: b.systolic, diastolic: b.diastolic,
    heartRate: isNumber(b.heartRate) ? b.heartRate : null,
    days: b.days, sessions: b.sessions, sufficient: b.sufficient === true, dataComplete: b.dataComplete !== false,
  }
}

export async function fetchHomeReadings(
  query: HomeLookupQuery,
  getToken: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): Promise<HomeLookup> {
  try {
    const token = await getToken()
    if (!token) return UNKNOWN
    const res = await fetchImpl(`${HEALTH_APP_ORIGIN}/api/patient-lookup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return UNKNOWN
    const { matches } = await res.json() as { matches?: { readingDays?: unknown; homeBp?: unknown }[] }
    if (!Array.isArray(matches)) return UNKNOWN
    // Not on any clinic list kept there: the service has nothing to show either.
    if (matches.length === 0) return { readings: 'none', bp: null }
    // By name: several people share it, so none of them can be said to be this patient.
    if (matches.length > 1 && !('chart' in query)) return UNKNOWN
    const days = matches[0]?.readingDays
    if (typeof days !== 'number') return UNKNOWN
    return { readings: days > 0 ? 'some' : 'none', bp: days > 0 ? homeBpOf(matches[0]?.homeBp) : null }
  } catch {
    return UNKNOWN
  }
}

export async function currentIdToken(): Promise<string | null> {
  const { auth } = await import('@/src/shared/config/firebase.config')
  return (await auth?.currentUser?.getIdToken()) ?? null
}
