import { test, expect } from '@playwright/test'
import { importBundle } from '../fixtures/import'
import { mockAiStream, STREAM_PROBE_MARKER } from '../fixtures/mock-stream'

/**
 * Full Firebase chain against the Auth + Firestore emulators.
 *
 * This is the regression net for the class of bugs the audit memory records as
 * the most painful and previously untestable: the anonymous-session / proxy-auth
 * wiring (e.g. the iOS "proxy AI dead — tokenless 401" race). It proves that:
 *   1. the app establishes an anonymous Firebase session (emulator),
 *   2. getProxyIdToken obtains an ID token from it, and
 *   3. the proxy-fetch interceptor attaches it as `Authorization: Bearer <jwt>`.
 *
 * The AI provider itself is still mocked (no keys / no cost); only the
 * Firebase auth path is real (emulated).
 */
test.describe('Firebase chain (auth + firestore emulators)', () => {
  test('anonymous session mints a token the proxy call carries as Bearer', async ({ page }) => {
    await mockAiStream(page, { model: 'gemini-3.1-flash-lite' })

    // Capture the Authorization header the app puts on proxy POSTs. Registered
    // AFTER mockAiStream so this wrapper is the OUTERMOST fetch and sees the call.
    await page.addInitScript(() => {
      const PROXY = /e2e-proxy\.test|cloudfunctions\.net|run\.app/
      const inner = window.fetch.bind(window)
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        try {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
          if (PROXY.test(url)) {
            let auth: string | null = null
            if (init?.headers) auth = new Headers(init.headers).get('authorization')
            if (!auth && input instanceof Request) auth = input.headers.get('authorization')
            if (auth) (window as unknown as { __proxyAuth?: string }).__proxyAuth = auth
          }
        } catch {
          /* ignore */
        }
        return inner(input as RequestInfo, init)
      }
    })

    await importBundle(page)

    const textarea = page.getByPlaceholder(/輸入/).first()
    await expect(textarea).toBeVisible()
    await textarea.click()
    await textarea.fill(`測試授權 ${STREAM_PROBE_MARKER}`)
    await page.getByRole('button', { name: '傳送' }).click()

    // A reply only renders if the proxy call succeeded; the interceptor THROWS
    // when no ID token is available, so a rendered reply already implies the
    // anonymous session + token were obtained.
    await expect(page.locator('.prose').last()).toContainText('追蹤計畫', { timeout: 25_000 })

    const auth = await page.evaluate(
      () => (window as unknown as { __proxyAuth?: string }).__proxyAuth,
    )
    expect(auth, 'proxy call should carry an Authorization header').toBeTruthy()
    // Bearer <jwt>: header.payload.signature — the Auth emulator signs with
    // alg:none, so the signature segment is empty (header.payload.).
    expect(auth as string).toMatch(/^Bearer\s+[\w-]+\.[\w-]+\./)

    // Decode the JWT payload and confirm it is a real anonymous Firebase token
    // for the emulator project — proves the whole auth chain, not just that
    // *some* header was attached.
    const payloadB64 = (auth as string).replace(/^Bearer\s+/, '').split('.')[1]
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    expect(payload.firebase?.sign_in_provider).toBe('anonymous')
    expect(payload.aud).toBe('demo-mediprisma')
    expect(payload.user_id).toBeTruthy()
  })
})
