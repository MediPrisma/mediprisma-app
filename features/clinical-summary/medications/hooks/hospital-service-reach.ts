// Whether this browser can reach the hospital interaction service. A public
// page cannot see that it is on the hospital network; reaching the service is
// the one reliable sign, so the 安全 tab can appear even when the patient has
// fewer than two drugs to check or only cloud (NHI) medications.
import { DDI_CHECK_AVAILABLE } from '@/src/shared/config/optional-capabilities'
import { localNetworkPermission } from '@/src/shared/utils/local-network-permission'

/** The hospital interaction service, or '' when this build has no check: no
 *  service configured, or the check package not installed. */
export function ddiServiceOrigin(): string {
  return DDI_CHECK_AVAILABLE ? process.env.NEXT_PUBLIC_DDI_SERVICE_ORIGIN ?? '' : ''
}

const TIMEOUT_MS = 8000
const PERMISSION_PROMPT_TIMEOUT_MS = 60_000

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
