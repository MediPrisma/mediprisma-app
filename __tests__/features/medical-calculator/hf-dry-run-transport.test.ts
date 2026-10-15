/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
import { buildMedcloudHfInput } from '@/src/core/hf-risk/medcloud-input'
import { requestHfDryRun, hfGatewayUrl } from '@/src/infrastructure/hf-risk/dry-run-client'
import { createHfDryRunHandler, type HfGatewayRequest, type HfGatewayReply } from '@/integrations/hf-gateway/dry-run-handler'
const input = () => buildMedcloudHfInput(hfMedcloudFixture(), { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' }, { today: '2026-10-04', uuid: randomUUID })
const outcome = { resourceType: 'OperationOutcome', issue: [{ severity: 'information', code: 'informational', details: { text: 'Synthetic validation' } }] }
function reply() {
  const output = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> }
  const response: HfGatewayReply = {
    code(status) { output.status = status; return this },
    header(name, value) { output.headers[name] = value; return this },
    send(body) { output.body = body; return body },
  }
  return { response, output }
}
function request(): HfGatewayRequest {
  const prepared = input()
  return { body: prepared.bundle, query: { claim: prepared.claim, indexDate: prepared.indexDate, dryRun: 'true' },
    headers: { 'x-request-id': randomUUID(), authorization: 'Bearer SYNTHETIC-CALLER-TOKEN' } }
}
describe('HF dry-run Gateway integration', () => {
  it('forces dryRun and uses server-held upstream credentials while returning only input issues', async () => {
    const fetchFn = jest.fn(async () => new Response(JSON.stringify({ ...outcome, extension: [{ valueString: 'UNRELATED-UPSTREAM-DATA' }] }), { status: 200 }))
    const authorize = jest.fn(async () => true)
    const handler = createHfDryRunHandler({ upstreamOrigin: 'http://127.0.0.1:8088', upstreamToken: 'SYNTHETIC-MODEL-TOKEN', authorize, fetch: fetchFn })
    const req = request()
    const rep = reply()
    await handler(req, rep.response)
    const [url, options] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/fhir/$hf-risk-v2')
    expect(url.searchParams.get('dryRun')).toBe('true')
    expect(options.headers).toMatchObject({ Authorization: 'Bearer SYNTHETIC-MODEL-TOKEN', 'X-Request-ID': req.headers['x-request-id'] })
    expect(JSON.stringify(options)).not.toContain('SYNTHETIC-CALLER-TOKEN')
    expect(rep.output.status).toBe(200)
    expect(rep.output.body).toEqual(outcome)
  })
  it.each([false, 'throw'])('fails closed when authorization is %s', async mode => {
    const fetchFn = jest.fn()
    const handler = createHfDryRunHandler({ upstreamOrigin: 'http://127.0.0.1:8088', upstreamToken: 'TEST', authorize: async () => { if (mode === 'throw') throw new Error('secret'); return false }, fetch: fetchFn })
    const rep = reply()
    await handler(request(), rep.response)
    expect(rep.output.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(JSON.stringify(rep.output.body)).not.toContain('secret')
  })
  it.each([
    { dryRun: 'false' }, { dryRun: ['true', 'false'] }, { claim: 'P2_ADM_mortality_1m' }, { upstream: 'https://attacker.invalid' }, { indexDate: '2026-02-30' },
  ])('rejects unsupported or ambiguous parameters %j', async change => {
    const fetchFn = jest.fn()
    const handler = createHfDryRunHandler({ upstreamOrigin: 'http://127.0.0.1:8088', upstreamToken: 'TEST', authorize: async () => true, fetch: fetchFn })
    const req = request()
    req.query = { ...(req.query as object), ...change }
    const rep = reply()
    await handler(req, rep.response)
    expect(rep.output.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('rejects arbitrary clinical payloads before contacting the model service', async () => {
    const fetchFn = jest.fn()
    const handler = createHfDryRunHandler({ upstreamOrigin: 'http://127.0.0.1:8088', upstreamToken: 'TEST', authorize: async () => true, fetch: fetchFn })
    const req = request()
    ;(req.body as any).entry[0].resource.identifier = [{ value: 'PRIVATE-ID' }]
    const rep = reply()
    await handler(req, rep.response)
    expect(rep.output.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('passes a valid 422 refusal and discards a scoring response, redirects and upstream failures', async () => {
    for (const [status, body, expected] of [
      [422, { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'required' }] }, 422],
      [200, { ...outcome, extension: [{ valueString: 'probabilityDecimal' }] }, 502],
      [200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'RiskAssessment' } }] }, 502],
      [302, outcome, 502], [401, outcome, 502], [503, outcome, 502],
    ] as const) {
      const handler = createHfDryRunHandler({ upstreamOrigin: 'http://127.0.0.1:8088', upstreamToken: 'TEST', authorize: async () => true, fetch: async () => new Response(JSON.stringify(body), { status }) })
      const rep = reply()
      await handler(request(), rep.response)
      expect(rep.output.status).toBe(expected)
    }
  })
})
describe('HF browser transport', () => {
  it('uses HTTPS, no credentials/cache/referrer/redirect fallback and sends only the projected input', async () => {
    const fetchFn = jest.fn(async () => new Response(JSON.stringify(outcome), { status: 200 }))
    const prepared = input()
    prepared.excludedLabs = [{ row: 5, name: 'LOCAL-ONLY-EXCLUDED-LAB', codes: ['LOCAL-ONLY-CODE'], reason: 'lab-unmapped' }]
    const result = await requestHfDryRun(prepared, { origin: 'https://hf-gateway.test', token: 'SYNTHETIC', signal: new AbortController().signal, requestId: randomUUID(), fetch: fetchFn })
    expect(result.verdict).toBe('accepted')
    const [url, options] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/hf/v1/dry-run?claim=P1_CD_mortality_1m')
    expect(url).toContain('dryRun=true')
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
    expect(options.body).not.toMatch(/FAKE-ID|PRIVATE|synthetic-patient|excludedLabs|LOCAL-ONLY/)
  })
  it.each(['http://10.121.12.179:8088', 'https://user:password@hf.test', 'https://hf.test/path', 'https://hf.test?token=bad'])('rejects unsafe or ambiguous origin %s', origin => {
    expect(() => hfGatewayUrl(origin)).toThrow()
  })
  it('does not send an already cancelled request', async () => {
    const fetchFn = jest.fn()
    const abort = new AbortController()
    abort.abort()
    await expect(requestHfDryRun(input(), { origin: 'https://hf.test', token: 'TEST', signal: abort.signal, fetch: fetchFn })).rejects.toThrow('request-aborted')
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('rejects authentication failures and unexpected scoring answers', async () => {
    for (const [status, body] of [[401, outcome], [200, { ...outcome, probabilityDecimal: 0.2 }]] as const) {
      await expect(requestHfDryRun(input(), { origin: 'https://hf.test', token: 'TEST', signal: new AbortController().signal,
        fetch: async () => new Response(JSON.stringify(body), { status }) })).rejects.toThrow()
    }
  })
})

it('intranet transport omits bearer tokens and preserves service provenance', async () => {
  const requestId = randomUUID()
  const fetchFn = jest.fn(async () => new Response(JSON.stringify(outcome), { status: 200, headers: { 'x-request-id': requestId, 'x-samd-adapter-version': '0.1.0' } }))
  const result = await requestHfDryRun(input(), { origin: 'https://hf.test', authPolicy: 'intranet', token: 'MUST-NOT-SEND', signal: new AbortController().signal, requestId, fetch: fetchFn })
  const [, options] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(options.headers).not.toHaveProperty('Authorization')
  expect(JSON.stringify(options)).not.toContain('MUST-NOT-SEND')
  expect(result).toMatchObject({ verdict: 'accepted', requestId, adapterVersion: '0.1.0' })
  expect(result.checkedAt).toBeDefined()
})
it('default Firebase transport rejects a missing token before any request', async () => {
  const fetchFn = jest.fn()
  await expect(requestHfDryRun(input(), { origin: 'https://hf.test', signal: new AbortController().signal, fetch: fetchFn })).rejects.toThrow('input-invalid')
  expect(fetchFn).not.toHaveBeenCalled()
})

it('synthetic preview relay is explicit, development-only and fixed to the approved endpoint', async () => {
  const previousMode = process.env.NODE_ENV
  try {
    process.env.NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY = 'synthetic'
    Object.assign(process.env, { NODE_ENV: 'production' })
    const fetchFn = jest.fn(async () => new Response(JSON.stringify(outcome), { status: 200 }))
    const options = { origin: 'https://samd.mediprisma.tw', authPolicy: 'intranet' as const, signal: new AbortController().signal, fetch: fetchFn }
    await expect(requestHfDryRun(input(), options)).rejects.toThrow('gateway-config')
    expect(fetchFn).not.toHaveBeenCalled()
    Object.assign(process.env, { NODE_ENV: 'development' })
    await requestHfDryRun(input(), options)
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain('/__hf-local-preview/hf/v1/dry-run?')
    await expect(requestHfDryRun(input(), { ...options, origin: 'https://other.test' })).rejects.toThrow('gateway-config')
    await expect(requestHfDryRun(input(), { ...options, authPolicy: 'firebase', token: 'TEST' })).rejects.toThrow('gateway-config')
  } finally {
    Object.assign(process.env, { NODE_ENV: previousMode })
    delete process.env.NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY
  }
})

it('rejects identity-shaped department and case-type codes at the server boundary', async () => {
  const { validateHfTransportBundle } = await import('@/src/core/hf-risk/transport-bundle')
  for (const field of ['serviceType','type']) {
    const prepared=input()
    const encounter=prepared.bundle.entry.find((e: any) => e.resource.resourceType === 'Encounter').resource
    const concept={coding:[{system:'https://fhir.vghtpe.gov.tw/ig/hf-risk/CodeSystem/' + (field==='type' ? 'nhi-case-type' : 'nhi-func-type'),code:'A123456789'}]}
    encounter[field]=field==='type' ? [concept] : concept
    expect(validateHfTransportBundle(prepared.bundle,prepared.indexDate)).toBe(false)
  }
})
it('does not display a mismatched response Request ID', async () => {
  const fetchFn=jest.fn(async () => new Response(JSON.stringify(outcome),{status:200,headers:{'x-request-id':randomUUID()}}))
  const result=await requestHfDryRun(input(),{origin:'https://hf.test',authPolicy:'intranet',signal:new AbortController().signal,requestId:randomUUID(),fetch:fetchFn})
  expect(result.requestId).toBeUndefined()
})
it('rejects changed clinical content before using the synthetic preview relay', async () => {
  const previousMode=process.env.NODE_ENV
  try {
    Object.assign(process.env,{NODE_ENV:'development',NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY:'synthetic'})
    const prepared=input()
    prepared.bundle.entry.find((e: any) => e.resource.resourceType==='Patient').resource.birthDate='1961-03-02'
    const fetchFn=jest.fn()
    await expect(requestHfDryRun(prepared,{origin:'https://samd.mediprisma.tw',authPolicy:'intranet',signal:new AbortController().signal,fetch:fetchFn})).rejects.toThrow('preview-fixture-required')
    expect(fetchFn).not.toHaveBeenCalled()
  } finally { Object.assign(process.env,{NODE_ENV:previousMode}); delete process.env.NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY }
})
