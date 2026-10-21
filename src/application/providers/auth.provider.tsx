// Authentication Provider with Firebase
'use client'

import { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { 
  signInWithPopup,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  type User as FirebaseUser
} from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { useConnectivityStore } from '@/src/application/stores/connectivity.store'
import { auth, db } from '@/src/shared/config/firebase.config'
import { QUOTA_CONFIG } from '@/src/shared/config/quota.config'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { clearSessionKey } from '@/src/shared/utils/crypto.utils'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { clearSmartSession } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { purgeAiResultCaches } from '@/src/infrastructure/cache/encrypted-session-cache'
import { notifyBundleChanged } from '@/src/shared/utils/reset-on-bundle-change'
import { serializeLocalBundleMutation } from '@/src/infrastructure/fhir/services/local-bundle-mutation-queue'

import { setUserProps, trackEvent } from '@/src/application/telemetry/usage-analytics'
import {
  detectLaunchSource,
  detectSite,
  detectWorkstation,
} from '@/src/application/telemetry/launch-context'
import { useAppVersion } from '@/src/shared/hooks/use-app-version.hook'
import { syncBetaFeaturesForAccount } from '@/src/application/services/beta-features-sync'
import { syncOutpatientPrefsForAccount } from '@/src/application/services/outpatient-prefs-sync'
export interface User {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
}

export interface AuthContextType {
  user: User | null
  /**
   * True when the active Firebase session is anonymous (a not-signed-in
   * visitor on the free tier). `user` is deliberately null in this case so
   * every login-gated feature (cloud history, prompt sharing, settings sync)
   * stays gated — only the proxy quota is opened up. Check this when you need
   * "is there a usable proxy token", not `user`.
   */
  isAnonymous: boolean
  /**
   * uid of the active anonymous session, or null when there is none (no session
   * yet, or a real account is signed in). Exposed because a not-signed-in
   * visitor still needs a stable key for per-browser preferences such as the
   * Beta switch; it is never an identity and must not be treated as one.
   */
  anonymousUid: string | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  dailyUsage: number
  /** Daily chat limit for the active tier (smaller for anonymous visitors) */
  dailyLimit: number
  /** Per-service usage read from the same daily doc the Functions meter */
  perplexityUsage: number
  whisperUsage: number
  /** Per-service limits for the active tier (smaller for anonymous visitors) */
  perplexityLimit: number
  whisperLimit: number
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Helper: Convert Firebase User to our User type
const convertFirebaseUser = (firebaseUser: FirebaseUser): User => ({
  uid: firebaseUser.uid,
  email: firebaseUser.email,
  displayName: firebaseUser.displayName,
  photoURL: firebaseUser.photoURL,
  emailVerified: firebaseUser.emailVerified,
})

// Helper: Get today's date string (YYYY-MM-DD)
const getTodayString = () => new Date().toISOString().split('T')[0]

// Usage analytics: one `app_launch` per PAGE LOAD, not per Firebase session.
// A module-level flag (rather than the uid ref below) is what makes that true:
// the uid ref resets on sign-out and would re-fire on the next sign-in.
//
// Known gap, deliberately not engineered around: if no Firebase user ever
// materialises (anonymous sign-in disabled and nobody signed in), this load
// reports no `app_launch`. Every production route in scope has a session.
let launchReported = false

// Helper: Detect if user is on mobile device
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [isAnonymous, setIsAnonymous] = useState(false)
  // uid of the active Firebase session (real OR anonymous) — drives the usage
  // listener. `user.uid` can't be used because it's null for anonymous.
  const [activeUid, setActiveUid] = useState<string | null>(null)
  // Firebase initializes only in the browser. Use the same pending state on
  // the server and first client render so auth-dependent text can hydrate.
  const [loading, setLoading] = useState(true)
  const [dailyUsage, setDailyUsage] = useState(0)
  const [perplexityUsage, setPerplexityUsage] = useState(0)
  const [whisperUsage, setWhisperUsage] = useState(0)

  // Anonymous visitors get a smaller free allowance; these are display-only,
  // the Functions enforce the real numbers (must mirror ANON_LIMITS).
  const dailyLimit = isAnonymous ? QUOTA_CONFIG.ANON_DAILY_LIMIT : QUOTA_CONFIG.DAILY_LIMIT
  // Usage analytics: user properties are set once per Firebase session, keyed
  // on the uid so a sign-in / sign-out cycle re-reports. The uid ITSELF is
  // never sent — it is only the change detector.
  const reportedUidRef = useRef<string | null>(null)
  const appVersion = useAppVersion()
  const perplexityLimit = isAnonymous ? QUOTA_CONFIG.ANON_PERPLEXITY_LIMIT : QUOTA_CONFIG.PERPLEXITY_DAILY_LIMIT
  const whisperLimit = isAnonymous ? QUOTA_CONFIG.ANON_WHISPER_LIMIT : QUOTA_CONFIG.WHISPER_DAILY_LIMIT

  // Handle redirect result on mount (for mobile Google sign-in)
  useEffect(() => {
    const firebaseAuth = auth
    if (!firebaseAuth) return
    
    const handleRedirect = async () => {
      try {
        // 不 log URL（redirect 期間可能含 auth code）與 email/UID — 共用工作站的 console 會留存。
        // Persistence is selected synchronously in firebase.config.ts; changing
        // it again here would create a second storage write during page startup.
        const result = await getRedirectResult(firebaseAuth)
        if (result) {
          // User successfully signed in via redirect
          // onAuthStateChanged will handle the rest
          console.log('[Auth] Redirect sign-in successful')
        }
      } catch (error: any) {
        console.error('[Auth] Redirect sign-in error:', error.code, error.message)
      }
    }
    
    handleRedirect()
  }, [])

  // Firebase Auth state listener
  useEffect(() => {
    const firebaseAuth = auth
    if (!firebaseAuth) {
      // No configured Auth still needs to finish initialization after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (firebaseUser && reportedUidRef.current !== firebaseUser.uid) {
        reportedUidRef.current = firebaseUser.uid
        void detectLaunchSource().then((launchSource) => {
          const site = detectSite()
          const workstation = detectWorkstation()
          // The event carries the values itself, so counting launches never
          // depends on the user properties having landed first.
          if (!launchReported) {
            launchReported = true
            trackEvent('app_launch', { launch_source: launchSource, site, workstation })
          }
          setUserProps({
            auth_kind: firebaseUser.isAnonymous ? 'anon' : 'google',
            launch_source: launchSource,
            site,
            workstation,
          })
        })
      }
      if (firebaseUser && !firebaseUser.isAnonymous) {
        // Real signed-in account
        setIsAnonymous(false)
        setActiveUid(firebaseUser.uid)
        setUser(convertFirebaseUser(firebaseUser))

        // Create user document if it doesn't exist (with error handling)
        if (db) {
          try {
            const userRef = doc(db, 'users', firebaseUser.uid)
            const userDoc = await getDoc(userRef)
            if (!userDoc.exists()) {
              await setDoc(userRef, {
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL,
                createdAt: new Date().toISOString(),
              }, { merge: true })
            }
          } catch {
            // Silently handle errors (offline, permissions, etc.)
          }
        }
      } else if (firebaseUser) {
        // Anonymous visitor (free tier). Keep `user` null so login-gated
        // features stay gated; only the proxy token + small quota are enabled.
        // No user document is created — the uid is disposable.
        setIsAnonymous(true)
        setActiveUid(firebaseUser.uid)
        setUser(null)
      } else {
        // No Firebase session at all → mint an anonymous one so the built-in
        // free model works without an explicit login. This fires
        // onAuthStateChanged again with the anonymous user (handled above).
        setUser(null)
        setIsAnonymous(false)
        setActiveUid(null)
        setDailyUsage(0)
        setPerplexityUsage(0)
        setWhisperUsage(0)
        signInAnonymously(firebaseAuth).catch((error: { code?: string }) => {
          // auth/operation-not-allowed = Anonymous sign-in not enabled in the
          // Firebase Console (Authentication → Sign-in method). The app still
          // works with a user's own API key; the free proxy just won't.
          console.warn('[Auth] Anonymous sign-in unavailable:', error?.code)
        })
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  // Keep preference sync independent of how many surfaces read the Beta hook.
  const signedInUid = user?.uid
  useEffect(() => {
    if (!signedInUid) return
    return syncBetaFeaturesForAccount(signedInUid)
  }, [signedInUid])

  // 門診偏好 (自訂 labs, copy formats) follow the account the same way.
  // Anonymous and guest settings are never synced: they stay in this browser.
  useEffect(() => {
    if (!signedInUid) return
    return syncOutpatientPrefsForAccount(signedInUid)
  }, [signedInUid])

  // Reported separately from the sign-in properties: the version is fetched
  // from /version.json at runtime (same source as the version chip) and can
  // resolve before or after the auth listener fires.
  useEffect(() => {
    if (appVersion) setUserProps({ app_version: appVersion })
  }, [appVersion])

  // Real-time usage listener — keyed on the active Firebase uid so it covers
  // anonymous visitors too (they meter against the same daily doc shape).
  useEffect(() => {
    if (!activeUid || !db) return

    const today = getTodayString()
    const usageRef = doc(db, 'users', activeUid, 'usage', today)

    const unsubscribe = onSnapshot(
      usageRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        useConnectivityStore.getState().setFirestoreConnection(
          snapshot.metadata.fromCache ? 'cache' : 'server',
        )
        if (snapshot.exists()) {
          const data = snapshot.data()
          setDailyUsage(data.count || 0)
          setPerplexityUsage(data.perplexityCount || 0)
        reportedUidRef.current = null
          setWhisperUsage(data.whisperCount || 0)
        } else {
          setDailyUsage(0)
          setPerplexityUsage(0)
          setWhisperUsage(0)
        }
      },
      () => {
        useConnectivityStore.getState().setFirestoreConnection('unavailable')
      }
    )

    return () => unsubscribe()
  }, [activeUid])

  // Sign in with Google
  const signInWithGoogle = async () => {
    if (!auth) throw new Error('Firebase not initialized')
    
    setLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      

      // Add custom parameters to improve popup behavior
      provider.setCustomParameters({
        prompt: 'select_account',
        // Ensure popup closes after authentication
        display: 'popup'
      })
      
      const isMobile = isMobileDevice()
      console.log('[Auth] Starting Google sign-in, isMobile:', isMobile)
      console.log('[Auth] Using signInWithPopup')
      
      // Set persistence before sign-in
      await setPersistence(auth, browserLocalPersistence)
      
      await signInWithPopup(auth, provider)
      console.log('[Auth] Sign-in successful')
      setLoading(false)
    } catch (error: any) {
      console.error('[Auth] Google sign-in error:', error)
      console.error('[Auth] Error code:', error.code)
      console.error('[Auth] Error message:', error.message)
      
      // If popup was blocked or closed, provide helpful message
      if (error.code === 'auth/popup-closed-by-user') {
        console.log('[Auth] User closed the popup')
      } else if (error.code === 'auth/popup-blocked') {
        console.log('[Auth] Popup was blocked by browser')
      }
      
      setLoading(false)
      throw error
    }
  }

  // Sign in with Email
  const signInWithEmail = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase not initialized')
    
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      // User state will be updated by onAuthStateChanged listener
    } finally {
      setLoading(false)
    }
  }

  // Sign up with Email
  const signUpWithEmail = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase not initialized')
    
    setLoading(true)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)
      // Send email verification
      await sendEmailVerification(userCredential.user)
      // User state will be updated by onAuthStateChanged listener
    } finally {
      setLoading(false)
    }
  }

  // Sign out
  const signOut = async () => {
    if (!auth) throw new Error('Firebase not initialized')

    setLoading(true)
    try {
      await firebaseSignOut(auth)
      // User state will be updated by onAuthStateChanged listener

      // Shared-workstation hygiene: logout also wipes locally stored LLM API
      // keys and the obfuscation key so the next user can't reuse them
      useAiConfigStore.getState().clearAllKeys()
      clearSessionKey()

      // …and the previous PATIENT's data, not just the doctor's keys. Two
      // separate sources have to go: the live SMART session (fhirclient's
      // cached access token, still valid for its full lifetime — without this
      // the chart stays readable and keeps fetching after "logout") and the
      // imported bundle (IndexedDB ciphertext + sessionStorage AES key +
      // stored images + demo flag) plus cached AI results.
      clearSmartSession()

      await serializeLocalBundleMutation(async () => {
        const importId = LocalBundleService.getActiveImportId()
        await LocalBundleService.clear()
        purgeAiResultCaches(importId)
        // Same signal an import/clear dispatches — resets in-memory AI-result
        // stores and lets every useImportBundle instance drop its state.
        notifyBundleChanged()
        // Drop the React-Query-cached chart so the UI stops showing the
        // previous patient immediately, not just after a reload.
        await queryClient.invalidateQueries()
      })
    } finally {
      setLoading(false)
    }
  }

  // Reset password
  const resetPassword = async (email: string) => {
    if (!auth) throw new Error('Firebase not initialized')
    
    await sendPasswordResetEmail(auth, email)
  }

  const value: AuthContextType = {
    user,
    isAnonymous,
    anonymousUid: isAnonymous ? activeUid : null,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    resetPassword,
    dailyUsage,
    dailyLimit,
    perplexityUsage,
    whisperUsage,
    perplexityLimit,
    whisperLimit,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
