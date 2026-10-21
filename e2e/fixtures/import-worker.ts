import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

type ImportMessage = { type?: string; phase?: string; originalBytes?: number; error?: string }
type ProbeWindow = Window & { __importWorkerMessages?: ImportMessage[] }

/** Observe native Worker messages; never replace conversion or suppress fallback. */
export async function observeImportWorkers(context: BrowserContext) {
  await context.addInitScript(() => {
    const host = window as ProbeWindow
    host.__importWorkerMessages = []
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }) => {
          host.__importWorkerMessages!.push({ type: data?.type, phase: data?.phase,
            originalBytes: data?.result?.originalFhir instanceof Blob ? data.result.originalFhir.size : undefined,
            error: typeof data?.error === 'string' ? data.error : undefined })
        })
      }
    }
  })
}

export async function expectImportWorker(page: Page, info: TestInfo, stage: string, expectedBytes?: number) {
  const messages = await page.evaluate(() => (window as ProbeWindow).__importWorkerMessages ?? [])
  await info.attach(`${stage}-import-worker`, { body: Buffer.from(JSON.stringify(messages, null, 2)), contentType: 'application/json' })
  // A successful terminology Worker has no originalFhir Blob and cannot satisfy this.
  const successes = messages.filter(message => message.type === 'success' && typeof message.originalBytes === 'number')
  expect(successes).toHaveLength(1)
  expect(successes[0].originalBytes).toBeGreaterThan(0)
  if (expectedBytes !== undefined) expect(successes[0].originalBytes).toBe(expectedBytes)
  expect(messages.filter(message => message.type === 'unavailable' && message.error?.startsWith('Local conversion worker'))).toEqual([])
  expect(messages.filter(message => message.type === 'progress').map(message => message.phase))
    .toEqual(expect.arrayContaining(['ready', 'parsed', 'converted', 'enriched']))
}
