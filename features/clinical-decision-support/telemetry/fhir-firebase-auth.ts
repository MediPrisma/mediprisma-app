'use client'

export type FhirFirebaseSession = { uid: string; isCurrent: () => boolean; getToken: () => Promise<string | null> }

/** Bind to the existing real account before preparing patient data or obtaining a token. */
export async function captureFhirFirebaseAuth(expectedUid?: string): Promise<FhirFirebaseSession | null> {
  try {
    const { auth } = await import('@/src/shared/config/firebase.config')
    if (!auth) return null
    const user = auth.currentUser
    if (!user || user.isAnonymous || (expectedUid !== undefined && user.uid !== expectedUid)) return null
    const isCurrent = () => auth.currentUser === user && !user.isAnonymous
    await auth.authStateReady()
    if (!isCurrent()) return null
    return { uid: user.uid, isCurrent, getToken: async () => {
      try {
        if (!isCurrent()) return null
        const token = await user.getIdToken()
        return isCurrent() && token ? token : null
      } catch { return null }
    } }
  } catch { return null }
}
