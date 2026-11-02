// Whether the home-measurement service holds readings for a 病歷號, asked from
// the doctor's browser with their own sign-in (both apps share the Firebase
// project). The service is reachable only on the hospital network, so anything
// short of an answer is "unknown" and must not read as "no readings".
import { HEALTH_APP_ORIGIN } from './home-measurement-link'

export type HomeReadings = 'some' | 'none' | 'unknown'

export async function fetchHomeReadings(
  chart: string,
  getToken: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): Promise<HomeReadings> {
  try {
    const token = await getToken()
    if (!token) return 'unknown'
    const res = await fetchImpl(`${HEALTH_APP_ORIGIN}/api/patient-lookup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chart }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return 'unknown'
    const { matches } = await res.json() as { matches?: { readingDays?: unknown }[] }
    if (!Array.isArray(matches)) return 'unknown'
    // Not on any clinic list kept there: the service has nothing to show either.
    if (matches.length === 0) return 'none'
    const days = matches[0]?.readingDays
    if (typeof days !== 'number') return 'unknown'
    return days > 0 ? 'some' : 'none'
  } catch {
    return 'unknown'
  }
}

export async function currentIdToken(): Promise<string | null> {
  const { auth } = await import('@/src/shared/config/firebase.config')
  return (await auth?.currentUser?.getIdToken()) ?? null
}
