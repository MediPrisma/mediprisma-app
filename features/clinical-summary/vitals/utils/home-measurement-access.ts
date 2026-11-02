// Who sees the home-readings button while the service is in its pilot: the
// accounts the service itself lets in. Stored as SHA-256 of the lower-cased
// email, so a colleague's address is not published in this public bundle.
import type { User } from '@/src/application/providers/auth.provider'

const PILOT_ACCOUNT_SHA256 = new Set([
  // Dr. Cheng (鄭醫師)
  '3eabb4fce9695ea098f36c880cad6996a1b8af04c8b6db7299a424932a78d142',
])

export async function isHomeMeasurementPilotUser(user: User | null): Promise<boolean> {
  const email = user?.emailVerified ? user.email?.trim().toLowerCase() : ''
  if (!email || !globalThis.crypto?.subtle) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return PILOT_ACCOUNT_SHA256.has(hex)
}
