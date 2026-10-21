'use client'

import type * as OAuth from 'oauth4webapi'
import { captureFhirFirebaseAuth } from './fhir-firebase-auth'

const scopes = ['mediprisma.fhir.read', 'mediprisma.fhir.write']
const listeners = new Set<() => void>()
let access: { token: string; until: number; uid: string } | null = null
let expiry: ReturnType<typeof setTimeout> | null = null
let login: AbortController | null = null
const notify = () => { for (const listener of listeners) listener() }
export const subscribeFhirAuth = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const fhirAuthStatus = (uid?: string) => access !== null && access.until > Date.now() && (uid === undefined || access.uid === uid)
export const fhirOAuthEnabled = () => process.env.NEXT_PUBLIC_CDSS_ADMISSION === 'oauth2'

export function disconnectFhir(): void {
  login?.abort(); login = null; access = null
  if (expiry) clearTimeout(expiry)
  expiry = null; notify()
}

export async function captureFhirRequestAuth(expectedUid?: string) {
  if (!['firebase', 'intranet', 'intranet-pilot', 'oauth2'].includes(process.env.NEXT_PUBLIC_CDSS_ADMISSION ?? '')) throw new Error('cdss_auth_unavailable')
  const session = await captureFhirFirebaseAuth(expectedUid)
  if (!session) throw new Error('cdss_auth_unavailable')
  const grant = access
  const oauth = fhirOAuthEnabled()
  if (oauth && (!grant || grant.uid !== session.uid || !fhirAuthStatus())) throw new Error('cdss_auth_unavailable')
  const isCurrent = () => session.isCurrent() && (!oauth || (access === grant && fhirAuthStatus()))
  return { uid: session.uid, isCurrent, getToken: async () => {
    if (!isCurrent()) throw new Error('cdss_auth_unavailable')
    // The unauthenticated listener is reserved for local synthetic testing.
    const token = oauth ? grant!.token : process.env.NEXT_PUBLIC_CDSS_ADMISSION === 'intranet-pilot' ? null : await session.getToken()
    if (!isCurrent() || (!token && process.env.NEXT_PUBLIC_CDSS_ADMISSION !== 'intranet-pilot')) throw new Error('cdss_auth_unavailable')
    return token
  } }
}

export async function fhirAccessToken(): Promise<string | null> {
  return (await captureFhirRequestAuth()).getToken()
}

function secureUrl(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password || url.hash || url.search ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))))
    throw new Error('cdss_auth_unavailable')
  return url
}

/** Popup keeps the current patient and assessment in place. No persistent token/verifier storage. */
export async function authorizeFhir(expectedUid?: string): Promise<void> {
  if (!fhirOAuthEnabled() || login) throw new Error('cdss_auth_unavailable')
  disconnectFhir()
  const controller = new AbortController(); login = controller
  const popup = window.open('about:blank', `mediprisma-fhir-authorization-${crypto.randomUUID()}`, 'popup,width=520,height=700')
  if (!popup) { login = null; throw new Error('cdss_auth_popup_unavailable') }
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const account = await captureFhirFirebaseAuth(expectedUid)
    if (!account) throw new Error('cdss_auth_unavailable')
    const oauth = await import('oauth4webapi')
    const issuer = secureUrl(process.env.NEXT_PUBLIC_FHIR_OAUTH_ISSUER || '')
    const clientId = process.env.NEXT_PUBLIC_FHIR_OAUTH_CLIENT_ID || ''
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(clientId)) throw new Error('cdss_auth_unavailable')
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
    if (basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath)) throw new Error('cdss_auth_unavailable')
    const redirectUri = `${window.location.origin}${basePath}/fhir-auth/callback`
    const transport = { [oauth.allowInsecureRequests]: issuer.protocol === 'http:', signal: controller.signal,
      [oauth.customFetch]: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init,
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }) }
    const metadata = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, transport))
    if (metadata.issuer !== issuer.href || metadata.code_challenge_methods_supported?.includes('S256') !== true ||
        metadata.authorization_response_iss_parameter_supported !== true) throw new Error('cdss_auth_unavailable')
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint])
      if (!endpoint || secureUrl(endpoint).origin !== issuer.origin) throw new Error('cdss_auth_unavailable')
    const client: OAuth.Client = { client_id: clientId }
    const verifier = oauth.generateRandomCodeVerifier(), state = oauth.generateRandomState()
    const authorization = new URL(metadata.authorization_endpoint!)
    for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: scopes.join(' '), state, code_challenge_method: 'S256', code_challenge: await oauth.calculatePKCECodeChallenge(verifier) }))
      authorization.searchParams.set(key, value)
    if (controller.signal.aborted) throw new Error('cdss_auth_unavailable')
    const callback = new Promise<URL>((resolve, reject) => {
      const cleanup = () => { window.removeEventListener('message', receive); controller.signal.removeEventListener('abort', abort); clearInterval(closed) }
      const abort = () => { cleanup(); reject(new Error('cdss_auth_unavailable')) }
      const receive = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'mediprisma-fhir-callback' ||
            typeof event.data.url !== 'string' || event.data.url.length > 8192) return
        try {
          const url = new URL(event.data.url)
          if (`${url.origin}${url.pathname}` !== redirectUri || url.hash) throw new Error()
          cleanup(); resolve(url)
        } catch { abort() }
      }
      const closed = setInterval(() => { if (popup.closed) abort() }, 1000)
      window.addEventListener('message', receive); controller.signal.addEventListener('abort', abort, { once: true })
      popup.location.href = authorization.href
    })
    const params = oauth.validateAuthResponse(metadata, client, await callback, state)
    const started = Date.now()
    const response = await oauth.authorizationCodeGrantRequest(metadata, client, oauth.None(), params, redirectUri, verifier, transport)
    const result = await oauth.processAuthorizationCodeResponse(metadata, client, response)
    if (controller.signal.aborted || result.token_type !== 'bearer' || typeof result.access_token !== 'string' ||
        !/^[A-Za-z0-9._~-]{1,16384}$/.test(result.access_token) || !Number.isInteger(result.expires_in) ||
        result.expires_in! < 60 || result.expires_in! > 300 ||
        (result.scope !== undefined && scopes.some(scope => !result.scope!.split(' ').includes(scope)))) throw new Error('cdss_auth_unavailable')
    if (!account.isCurrent()) throw new Error('cdss_auth_unavailable')
    access = { token: result.access_token, until: started + (result.expires_in! - 30) * 1000, uid: account.uid }
    if (!fhirAuthStatus()) throw new Error('cdss_auth_unavailable')
    expiry = setTimeout(disconnectFhir, Math.max(0, access.until - Date.now())); notify()
  } catch { if (login === controller) { access = null; notify() }; throw new Error('cdss_auth_unavailable') }
  finally { clearTimeout(timer); popup.close(); if (login === controller) login = null }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', disconnectFhir)
