import { hfGatewayUrl } from './dry-run-client'

/** No patient data or credentials; the intranet ingress verifies the source network. */
export async function detectHfIntranet(origin: string, signal: AbortSignal): Promise<boolean> {
  try {
    hfGatewayUrl(origin)
    const response = await fetch(new URL('/samd/v1/models', origin).href, {
      method: 'GET', signal, credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' },
    })
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) return false
    const text = await response.text()
    if (text.length > 8192) return false
    const value = JSON.parse(text)
    return value?.schemaVersion === 1 && Array.isArray(value.models) && value.models.some((model: { id?: unknown; inputContract?: unknown; operations?: unknown; claims?: unknown }) =>
      model?.id === 'hf' && model.inputContract === 'hf-medcloud-projection-v1' && Array.isArray(model.operations) && model.operations.includes('dry-run') &&
      Array.isArray(model.claims) && model.claims.includes('P1_CD_mortality_1m') && model.claims.includes('P1_CD_mortality_3m'))
  } catch { return false }
}
