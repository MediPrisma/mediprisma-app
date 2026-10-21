import { detectHfIntranet } from '@/src/infrastructure/hf-risk/intranet-discovery'

const catalogue = { schemaVersion: 1, models: [{ id: 'hf', inputContract: 'hf-medcloud-projection-v1', operations: ['dry-run', 'predict'], claims: ['P1_CD_mortality_1m', 'P1_CD_mortality_3m'] }] }
const originalFetch = global.fetch
beforeEach(() => { global.fetch = jest.fn() })
afterEach(() => { global.fetch = originalFetch })
function reply(status: number, body: unknown, contentType = 'application/json') {
  jest.mocked(fetch).mockResolvedValue({ status, headers: { get: () => contentType }, text: async () => JSON.stringify(body) } as unknown as Response)
}
it('discovers access using the authorized model catalogue without patient data or credentials', async () => {
  reply(200, catalogue)
  const signal = new AbortController().signal
  expect(await detectHfIntranet('https://samd.test', signal)).toBe(true)
  expect(fetch).toHaveBeenCalledWith('https://samd.test/samd/v1/models', expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal }))
  expect(jest.mocked(fetch).mock.calls[0][1]).not.toHaveProperty('body')
})
it.each([403, 429, 500])('fails closed on HTTP %s', async status => {
  reply(status, catalogue)
  expect(await detectHfIntranet('https://samd.test', new AbortController().signal)).toBe(false)
})
it.each([{ status: 'ok' }, { schemaVersion: 1, models: [] }, { schemaVersion: 2, models: catalogue.models }])('rejects unverified catalogues and health replies', async body => {
  reply(200, body)
  expect(await detectHfIntranet('https://samd.test', new AbortController().signal)).toBe(false)
})
it('rejects non-HTTPS configuration and does not probe it', async () => {
  expect(await detectHfIntranet('http://samd.test', new AbortController().signal)).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})
it('fails closed on an unreachable or aborted service', async () => {
  jest.mocked(fetch).mockRejectedValue(new Error('synthetic network failure'))
  expect(await detectHfIntranet('https://samd.test', new AbortController().signal)).toBe(false)
})
