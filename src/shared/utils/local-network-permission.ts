// Chrome asks before a public page may reach a private-network address (Local
// Network Access). The collector and the hospital interaction check both need
// to know where that consent stands without triggering the prompt themselves.

/** Read existing browser consent only. Never probe the network to request it. */
export async function localNetworkPermission(endpoint: string): Promise<PermissionStatus | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
    const host = new URL(endpoint).hostname
    const name = ['localhost', '127.0.0.1', '[::1]'].includes(host) ? 'loopback-network' : 'local-network'
    try {
      // Chromium 145+ splits local and loopback permissions; lib.dom may lag it.
      return await navigator.permissions.query({ name: name as PermissionName })
    } catch (error) {
      // Older Chromium only knows the combined descriptor. Never override a
      // returned prompt/denied state with a different permission's grant.
      if (!(error instanceof TypeError)) return null
      return await navigator.permissions.query({ name: 'local-network-access' as PermissionName })
    }
  } catch { return null }
}
