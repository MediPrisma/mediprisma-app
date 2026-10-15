import { CdssSaveError, cdssSaveErrorDescription } from '@/features/clinical-decision-support/telemetry/save-error'

test.each([400, 401, 403, 409, 413, 429, 503])('preserves HTTP %s without including response text', status => {
  const description = cdssSaveErrorDescription(new CdssSaveError('cdss_gateway_rejected', 'request', status), false)
  expect(description).toContain(`HTTP ${status}`)
  expect(description).toContain('stage=request')
})

test('does not display arbitrary exception messages or patient data', () => {
  const description = cdssSaveErrorDescription(new Error('private patient data and token'), false)
  expect(description).toContain('cdss_save_unknown')
  expect(description).not.toContain('private')
})

test('timeout warns that the outcome is unconfirmed', () => {
  expect(cdssSaveErrorDescription(new CdssSaveError('cdss_save_timeout', 'request'), false)).toContain('先查看紀錄')
})
