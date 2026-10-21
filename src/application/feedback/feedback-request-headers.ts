import { getAppCheckToken } from "@/src/infrastructure/ai/utils/app-check"
import { getProxyAuthHeaders } from "@/src/infrastructure/ai/utils/proxy-auth"

/**
 * Only the Firebase ID token, for a receiver outside Firebase (the hospital
 * Gateway of a lab-data report): the App Check token and the proxy key are
 * Firebase's and are not handed to anyone else.
 */
export async function getIdTokenRequestHeaders(): Promise<Record<string, string>> {
  return { "Content-Type": "application/json", ...await getProxyAuthHeaders() }
}

/** Build the authenticated headers used by the production feedback Function. */
export async function getFeedbackRequestHeaders(): Promise<Record<string, string>> {
  const [authHeaders, appCheckToken] = await Promise.all([
    getProxyAuthHeaders(),
    getAppCheckToken(),
  ])
  const clientKey = process.env.NEXT_PUBLIC_PROXY_KEY || ""

  return {
    "Content-Type": "application/json",
    ...(clientKey && { "x-proxy-key": clientKey }),
    ...authHeaders,
    ...(appCheckToken && { "X-Firebase-AppCheck": appCheckToken }),
  }
}
