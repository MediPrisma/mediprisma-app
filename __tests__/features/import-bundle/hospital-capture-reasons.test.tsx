import { act, render, screen } from '@testing-library/react'
import { HospitalCaptureReasons } from '@/features/import-bundle/components/HospitalCaptureReasons'
import { rememberLocalBundleCapture } from '@/src/infrastructure/fhir/services/local-bundle-capture'

let mockLocale = 'zh-TW'
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: mockLocale }) }))

const FAILURE = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-failure'
const COMPLETENESS = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-completeness'
const bundle = (tags: object[]) => ({ resourceType: 'Bundle', meta: { tag: tags }, entry: [] })

beforeEach(() => { mockLocale = 'zh-TW'; act(() => rememberLocalBundleCapture(null)) })

test('names each missing category with its reason, HTTP status and count', () => {
  render(<HospitalCaptureReasons />)
  expect(screen.queryByRole('status')).toBeNull()
  act(() => rememberLocalBundleCapture(bundle([
    { system: COMPLETENESS, code: 'partial' },
    { system: FAILURE, code: 'reports:timeout', display: '2' },
    { system: FAILURE, code: 'patient:http_error:500', display: '1' },
    { system: FAILURE, code: 'vitals:login_or_network', display: '1' },
  ])))
  expect(screen.getByRole('status')).toHaveTextContent(
    '院內資料未取得：檢查驗報告－北榮回應逾時（2 次）；病人基本資料－北榮回應錯誤（HTTP 500）；生命徵象－北榮登入可能過期或網路中斷。請核對 HIS。')
})

test('older partial captures without reasons still say data is missing; complete or non-hospital bundles show nothing', () => {
  render(<HospitalCaptureReasons />)
  act(() => rememberLocalBundleCapture(bundle([{ system: COMPLETENESS, code: 'partial' }])))
  expect(screen.getByRole('status')).toHaveTextContent('部分院內資料未取得（未記錄原因）；請核對 HIS。')
  act(() => rememberLocalBundleCapture(bundle([{ system: 'urn:oid:vgh.capture.mode', code: 'outpatient' }])))
  expect(screen.queryByRole('status')).toBeNull()
  act(() => rememberLocalBundleCapture(bundle([{ system: FAILURE, code: 'TEST-1:timeout', display: '1' }])))
  expect(screen.queryByRole('status')).toBeNull()
})

test('English wording', () => {
  mockLocale = 'en'
  render(<HospitalCaptureReasons />)
  act(() => rememberLocalBundleCapture(bundle([{ system: FAILURE, code: 'medications:his_busy:503', display: '3' }])))
  expect(screen.getByRole('status')).toHaveTextContent('Hospital records not captured: medications: HIS busy (HTTP 503, 3 times). Check HIS.')
})
