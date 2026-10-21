'use client'

/** Capture a current caller without creating/signing in an account. Watch identity changes for stale input results. */
export async function captureHfCallerAuth(): Promise<{
  getToken: () => Promise<string | null>
  onIdentityChanged: (callback: () => void) => () => void
} | null> {
  try {
    const { auth } = await import('@/src/shared/config/firebase.config')
    if (!auth) return null
    await auth.authStateReady()
    const user = auth.currentUser
    if (!user) return null
    return {
      getToken: async () => {
        try {
          if (auth.currentUser !== user) return null
          const token = await user.getIdToken()
          return auth.currentUser === user ? token : null
        } catch { return null }
      },
      onIdentityChanged: callback => auth.onAuthStateChanged(current => {
        if (current !== user) callback()
      }),
    }
  } catch { return null }
}
