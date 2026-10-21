/** Integration module for the intranet Gateway. No listener, secrets, DB or deployment side effects.
 * Authentication AND HF clinical caller authorization must be supplied by the host.
 */
import { HF_DRY_RUN_CLAIMS, HF_MAX_BYTES, fhirDay, taipeiToday, parseHfDryRunResponse } from '../../src/core/hf-risk/contract'
import { validateHfTransportBundle } from '../../src/core/hf-risk/transport-bundle'

export interface HfGatewayRequest { body: unknown; query: unknown; headers: Record<string, string | string[] | undefined> }
export interface HfGatewayReply {
  code(status: number): HfGatewayReply
  header(name: string, value: string): HfGatewayReply
  send(body: unknown): unknown
}
interface Options {
  upstreamOrigin: string
  upstreamToken: string
  /** Verify the signed caller identity AND its permission to submit HF inputs. Never just check that a token exists. */
  authorize: (request: HfGatewayRequest) => Promise<boolean>
  fetch?: typeof fetch
}
const outcome = (code: string) => ({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code }] })
export function createHfDryRunHandler(options: Options) {
  const origin = new URL(options.upstreamOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== '/' || !options.upstreamToken || typeof options.authorize !== 'function') throw new Error('HF gateway configuration invalid')
  const upstream = new URL('/fhir/$hf-risk-v2', origin)
  let inFlight = 0
  return async (request: HfGatewayRequest, reply: HfGatewayReply): Promise<unknown> => {
    reply.header('Cache-Control', 'no-store').header('Content-Type', 'application/fhir+json')
    const id = request.headers['x-request-id']
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return reply.code(400).send(outcome('invalid'))
    reply.header('X-Request-ID', id)
    let authorized = false
    try { authorized = await options.authorize(request) } catch { /* Fail closed; never include token/auth failure details. */ }
    if (!authorized) return reply.code(403).send(outcome('forbidden'))
    const query = request.query as Record<string, unknown> | null
    if (!query || Object.keys(query).some(key => !['claim', 'indexDate', 'dryRun'].includes(key))
      || query.dryRun !== 'true' || !HF_DRY_RUN_CLAIMS.includes(query.claim as any)
      || typeof query.indexDate !== 'string' || fhirDay(query.indexDate) !== query.indexDate || query.indexDate > taipeiToday()
      || !validateHfTransportBundle(request.body, query.indexDate)) return reply.code(400).send(outcome('invalid'))
    const body = JSON.stringify(request.body)
    if (Buffer.byteLength(body) > HF_MAX_BYTES) return reply.code(413).send(outcome('too-costly'))
    if (inFlight >= 8) return reply.code(429).send(outcome('throttled'))
    const url = new URL(upstream)
    url.searchParams.set('claim', query.claim as string)
    url.searchParams.set('indexDate', query.indexDate)
    // Forced at the server boundary: clients cannot opt into scoring.
    url.searchParams.set('dryRun', 'true')
    inFlight++
    try {
      const response = await (options.fetch ?? fetch)(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json',
          Authorization: 'Bearer ' + options.upstreamToken, 'X-Request-ID': id }, body,
      })
      if (![200, 422].includes(response.status)) return reply.code(502).send(outcome('transient'))
      // Bounded read, including chunked upstream responses.
      if (!response.body) return reply.code(502).send(outcome('invalid'))
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > HF_MAX_BYTES) { await reader.cancel(); return reply.code(502).send(outcome('too-costly')) }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const parsed = parseHfDryRunResponse(response.status, result)
      // Only checked input issues are returned. Drop arbitrary upstream extensions and payloads.
      return reply.code(response.status).send({ resourceType: 'OperationOutcome',
        issue: parsed.issues.map(issue => ({ severity: issue.severity, code: issue.code, details: { text: issue.text } })) })
    } catch {
      return reply.code(502).send(outcome('transient'))
    } finally { inFlight-- }
  }
}
