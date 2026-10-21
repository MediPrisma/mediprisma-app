import { type BrowserContext } from '@playwright/test'

/**
 * Keep the suite off the real Firebase project.
 *
 * The app mints an anonymous session on any load without one — that is what
 * makes the free proxy tier work — so every E2E test was calling
 * `accounts:signUp` against the PRODUCTION project. Two consequences, both
 * bad: each run littered the project with disposable anonymous accounts, and
 * once the sign-up rate limit tripped, every AI spec failed together with
 * `TOO_MANY_ATTEMPTS_TRY_LATER` and stayed failing until the quota reset.
 * That is why chat specs would time out waiting for a 傳送 button that never
 * enabled — `canUseChat` needs `apiKeyAvailable || user || isAnonymous`, and
 * with sign-in refused none of the three held.
 *
 * The chain the suite actually exercises is client-side: anonymous session →
 * ID token → proxy call, and the proxy call is already mocked. So the session
 * is served locally instead. Tests that need the REAL chain run against the
 * Auth emulator via playwright.emulated.config.ts.
 */

const ANON_UID = 'e2e-anonymous-uid'
const PROJECT_ID = 'e2e-mediprisma'
const TOKEN_TTL_SECONDS = 3600

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * A structurally valid unsigned JWT. The Firebase SDK parses the payload for
 * `exp`/`auth_time`/`sub` and would throw on anything it cannot decode; it
 * does not verify the signature client-side, and the only consumer of the
 * token — the AI proxy — is mocked.
 */
function anonymousIdToken(): string {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = { alg: 'none', kid: 'e2e', typ: 'JWT' }
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: issuedAt,
    user_id: ANON_UID,
    sub: ANON_UID,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
    firebase: { identities: {}, sign_in_provider: 'anonymous' },
  }
  return `${base64url(header)}.${base64url(payload)}.e2e-not-a-real-signature`
}

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/**
 * Route-level, so it covers every page the context opens — including ones a
 * spec creates itself — and applies before the app's first request.
 */
export async function stubFirebaseAnonymousAuth(context: BrowserContext, options: { initializeFirestore?: boolean } = {}) {
  // Run before any app script. Leaving Firestore uninitialized is important:
  // aborting its WebChannel request still makes the SDK retry forever, which
  // floods every tour run with expected-but-noisy transport errors.
  await context.addInitScript((disableFirestore: boolean) => {
    ;(window as Window & {
      __MEDIPRISMA_E2E_DISABLE_FIRESTORE__?: boolean
    }).__MEDIPRISMA_E2E_DISABLE_FIRESTORE__ = disableFirestore
  }, !options.initializeFirestore)

  await context.route('**/identitytoolkit.googleapis.com/**', async (route) => {
    const url = route.request().url()

    if (url.includes('accounts:signUp')) {
      await route.fulfill(json({
        kind: 'identitytoolkit#SignupNewUserResponse',
        idToken: anonymousIdToken(),
        refreshToken: 'e2e-refresh-token',
        expiresIn: String(TOKEN_TTL_SECONDS),
        localId: ANON_UID,
      }))
      return
    }

    if (url.includes('accounts:lookup')) {
      const nowMs = String(Date.now())
      await route.fulfill(json({
        kind: 'identitytoolkit#GetAccountInfoResponse',
        users: [{
          localId: ANON_UID,
          createdAt: nowMs,
          lastLoginAt: nowMs,
          lastRefreshAt: new Date().toISOString(),
          providerUserInfo: [],
          validSince: '0',
        }],
      }))
      return
    }

    // Any other identity call (a real sign-in, a link) is not something this
    // suite should reach. Fail it loudly rather than let it hit production.
    await route.abort('blockedbyclient')
  })

  // Long runs would otherwise refresh the token for real.
  await context.route('**/securetoken.googleapis.com/**', async (route) => {
    await route.fulfill(json({
      access_token: anonymousIdToken(),
      id_token: anonymousIdToken(),
      refresh_token: 'e2e-refresh-token',
      expires_in: String(TOKEN_TTL_SECONDS),
      token_type: 'Bearer',
      user_id: ANON_UID,
      project_id: PROJECT_ID,
    }))
  })

  // Fail closed if a future refactor bypasses the pre-navigation guard above.
  // firebase-isolation.spec.ts asserts that this route is never reached.
  await context.route('**/firestore.googleapis.com/**', async (route) => {
    await route.abort('blockedbyclient')
  })
}
