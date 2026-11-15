import { getProxyIdToken } from '../utils/proxy-auth'

export const INTRANET_LUNA_ID = 'gpt-6-luna'

export function intranetMaxRetries(model: string | { modelId: string }): 0 | undefined {
  return (typeof model === 'string' ? model : model.modelId) === INTRANET_LUNA_ID ? 0 : undefined
}

export function intranetGatewayAvailable(href = typeof window === 'undefined' ? '' : window.location.href): boolean {
  if (!process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN) return false
  try {
    const url = new URL(href)
    return ['/app', '/app-staging', '/app-hmc'].some(path => url.pathname === path || url.pathname.startsWith(`${path}/`)) &&
      url.searchParams.getAll('site').length === 1 && url.searchParams.get('site') === 'vghtpe'
  } catch { return false }
}

/** Firebase authenticates the user; only the hospital VM holds the Azure key.
 * No retry/fallback: a lost response may already have incurred a charge. */
/** The HMC preview hands a 北榮 launch to the intranet Luna instead of
 * tvghbrain (owner, 2026-11-11). Every other workspace keeps tvghbrain. */
export function intranetLunaIsLaunchDefault(href: string): boolean {
  if (!intranetGatewayAvailable(href)) return false
  const { pathname } = new URL(href)
  return pathname === '/app-hmc' || pathname.startsWith('/app-hmc/')
}

export function createIntranetFetch(
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  const base = new URL(origin)
  if (base.protocol !== 'https:' || base.origin !== origin || base.username || base.password) {
    throw new Error('院內 AI 入口設定錯誤')
  }
  return async (input, init) => {
    if (!intranetGatewayAvailable()) throw new Error('院內 GPT 僅供北榮院內入口使用')
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
    const url = new URL(request?.url ?? String(input))
    if (url.origin !== base.origin || url.pathname !== '/v1/responses' || url.search || url.hash) {
      throw new Error('院內 AI 請求路徑不符')
    }
    const token = await getProxyIdToken()
    if (!token) throw new Error('請先登入或等待訪客登入完成')
    // SDK headers, including its dummy key, never reach the server.
    const headers = new Headers({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
    return fetchImpl(url, {
      ...init,
      method: init?.method ?? request?.method ?? 'POST',
      body: init?.body ?? (request ? await request.text() : undefined),
      signal: init?.signal ?? request?.signal,
      headers, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    })
  }
}
