// Whether this browser can reach the hospital interaction service. A public
// page cannot see that it is on the hospital network; reaching the service is
// the one reliable sign, so the 安全 tab can appear even when the patient has
// fewer than two drugs to check or only cloud (NHI) medications.
import { localNetworkPermission } from '@/src/shared/utils/local-network-permission'

const SEEN_KEY = 'mediprisma.ddi.serviceReachedAt'
const SEEN_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 8000
const PERMISSION_PROMPT_TIMEOUT_MS = 60_000

/** Remember that this browser reached the service, so the next patient's tab
 *  can show while its check is still running. */
export function markServiceReached(now = Date.now()) {
  try { window.localStorage.setItem(SEEN_KEY, String(now)) } catch { /* storage off: no memory */ }
}

/** Reached within the last 7 days; a laptop taken home stops showing it. */
export function reachedServiceRecently(now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(SEEN_KEY))
    return at > 0 && at <= now && now - at < SEEN_MS
  } catch { return false }
}

const reachedOrigins = new Set<string>()

/**
 * One fixed, synthetic request: no patient data leaves the browser. Any HTTP
 * answer means the service is reachable. Never asks again after a success on
 * this page; a failure is asked again on the next patient or retry.
 */
export async function probeService(origin: string, signal: AbortSignal): Promise<boolean> {
  if (reachedOrigins.has(origin)) return true
  const permission = await localNetworkPermission(origin)
  if (permission?.state === 'denied' || signal.aborted) return false
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort)
  const timer = setTimeout(abort, permission?.state === 'prompt' ? PERMISSION_PROMPT_TIMEOUT_MS : TIMEOUT_MS)
  try {
    await fetch(`${origin}/api/ddi-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medications: [{ drugName: 'acetaminophen' }] }),
      signal: controller.signal,
    })
    reachedOrigins.add(origin)
    markServiceReached()
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

/** Tests only. */
export function resetServiceReach() { reachedOrigins.clear() }
