import { awaitReportStep } from '@/src/application/telemetry/summary-report'
it('auth waits are bounded by cancellation even when authentication never settles', async () => {
  const controller = new AbortController()
  const pending = awaitReportStep(new Promise<string>(()=>{}),controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow('report_cancelled')
})
