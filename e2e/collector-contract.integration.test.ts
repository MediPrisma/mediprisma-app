import { fork, type ChildProcess } from 'node:child_process'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { beginCollectorObservation, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { mockCollectorPermission } from '../__tests__/helpers/collector-permissions'

const mockCapture = jest.fn()
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({ captureCollectorAuth: () => mockCapture() }))
type Receiver = { origin: string; token: string; admin: string }
let child: ChildProcess, receiver: Receiver
let permission: ReturnType<typeof mockCollectorPermission>
function http(url: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('Synthetic loopback only')
  return new Promise<{ status: number; data: any }>((yes, no) => {
    const req = request(target, { method, headers }, res => {
      let text = ''; res.on('data', chunk => { text += chunk }); res.on('end', () => {
        try { yes({ status: res.statusCode!, data: JSON.parse(text) }) } catch (error) { no(error) }
      })
    })
    req.on('error', no); req.setTimeout(5000, () => req.destroy(new Error('Synthetic request timeout')))
    req.end(body)
  })
}
beforeAll(async () => {
  if (!process.env.COLLECTOR_GATEWAY_CHECKOUT) throw new Error('Explicit compiled Gateway checkout required')
  child = fork(resolve('scripts/collector-integration-receiver.mjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  receiver = await new Promise<Receiver>((yes, no) => {
    const timeout = setTimeout(() => no(new Error('Receiver startup deadline')), 15000)
    child.once('message', message => { clearTimeout(timeout); yes(message as Receiver) })
    child.once('exit', code => { clearTimeout(timeout); no(new Error('Receiver exited: ' + code)) })
    child.once('error', error => { clearTimeout(timeout); no(error) })
  })
  process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN = receiver.origin
  permission = mockCollectorPermission()
  window.history.replaceState({}, '', '/?site=vghtpe')
  mockCapture.mockResolvedValue({ getToken: async () => receiver.token })
}, 20000)
afterAll(async () => {
  cancelCollectorRequests(); permission?.restore()
  delete process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN
  if (child?.connected) await new Promise<void>(yes => {
    const timeout = setTimeout(() => { child.kill(); yes() }, 5000)
    child.once('exit', () => { clearTimeout(timeout); yes() }); child.send('close')
  })
})
test('actual sender over loopback persists one operation, supports v5 and rejects extra sensitive fields', async () => {
  const posts: Array<Promise<{ status: number; data: any }>> = []
  jest.mocked(fetch).mockImplementation((url, options) => {
    const pending = http(String(url), options!.method, { ...options!.headers as Record<string, string>, origin: 'http://localhost' }, options!.body as string)
    posts.push(pending)
    return pending.then(response => ({ status: response.status } as Response))
  })
  const parent = beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'feature', mode: 'structured', counts: { encounter_count: 23, med_count: 47 } })
  const detail = () => beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'stream', operation: parent.operation })
  detail().finish({ outcome: 'timeout', phase: 'stream', responseComplete: false })
  detail().finish({ outcome: 'ok', phase: 'stream', responseComplete: true })
  parent.finish({ outcome: 'ok', phase: 'parse', summaryCards: { succeeded: 6, failed: 0 } })
  for (let i = 0; i < 100 && !posts.length; i++) await new Promise(yes => setTimeout(yes, 10))
  expect(posts).toHaveLength(1)
  expect((await posts[0]).status).toBe(201)
  const auth = { authorization: receiver.admin }
  const listing = await http(receiver.origin + '/admin/api/events', 'GET', auth)
  expect(listing.data.events).toHaveLength(1)
  const stored = await http(receiver.origin + '/admin/api/events/' + listing.data.events[0].event_id, 'GET', auth)
  expect(stored.data.diagnostics.loaded).toMatchObject({ encounters: 23, medications: 47 })
  expect(stored.data.diagnostics.requests.details.map((d: any) => d.status)).toEqual(['error', 'completed'])
  const event = JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)
  const headers = { authorization: 'Bearer ' + receiver.token, 'content-type': 'application/json' }
  expect((await http(receiver.origin + '/collector/v1/events', 'POST', headers, JSON.stringify(event))).data.duplicate).toBe(true)
  const legacy = { ...event, event_id: '00000000-0000-4000-8000-000000000001', schema_version: 5, diagnostics: { ...event.diagnostics } }
  delete legacy.diagnostics.requests
  expect((await http(receiver.origin + '/collector/v1/events', 'POST', headers, JSON.stringify(legacy))).status).toBe(201)
  expect((await http(receiver.origin + '/collector/v1/events', 'POST', headers, JSON.stringify({ ...event, patient_id: 'SYNTHETIC-FORBIDDEN' }))).status).toBe(400)
  expect((await http(receiver.origin + '/admin/api/summary', 'GET', auth)).data.today_count).toBe(2)
}, 20000)
