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

test('an expired HIS login and a lost connection are named separately', () => {
  render(<HospitalCaptureReasons />)
  act(() => rememberLocalBundleCapture(bundle([
    { system: FAILURE, code: 'reports:login_expired', display: '2' },
    { system: FAILURE, code: 'medications:network', display: '1' },
  ])))
  expect(screen.getByRole('status')).toHaveTextContent(
    '院內資料未取得：檢查驗報告－北榮登入已過期，請重新登入北榮後再取得（2 次）；用藥－無法連到北榮（網路中斷或北榮沒有回應）。請核對 HIS。')
})

test('a capture cut short by the visit limit or unmatched orders names that, not a missing reason', () => {
  render(<HospitalCaptureReasons />)
  act(() => rememberLocalBundleCapture(bundle([
    { system: COMPLETENESS, code: 'partial' },
    { system: FAILURE, code: 'encounters:visit_limit', display: '21' },
    { system: FAILURE, code: 'orders:order_unmatched', display: '101' },
  ])))
  expect(screen.getByRole('status')).toHaveTextContent(
    '院內資料不完整：門診紀錄－超過門診數上限，略過較舊門診（21 次）；醫囑－無法唯一對應申請序號，報告涵蓋範圍待核對（101 筆）。請核對 HIS。')
  act(() => rememberLocalBundleCapture(bundle([
    { system: FAILURE, code: 'reports:timeout', display: '1' },
    { system: FAILURE, code: 'orders:order_unmatched', display: '1' },
  ])))
  expect(screen.getByRole('status')).toHaveTextContent(
    '院內資料未取得：檢查驗報告－北榮回應逾時；醫囑－無法唯一對應申請序號，報告涵蓋範圍待核對（1 筆）。請核對 HIS。')
})

test('English wording', () => {
  mockLocale = 'en'
  render(<HospitalCaptureReasons />)
  act(() => rememberLocalBundleCapture(bundle([{ system: FAILURE, code: 'medications:his_busy:503', display: '3' }])))
  expect(screen.getByRole('status')).toHaveTextContent('Hospital records not captured: medications: HIS busy (HTTP 503, 3 times). Check HIS.')
})

const STORED = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-stored-record'

test.each([
  ['used', '近一年院內資料取自門診助理的預看診存檔，之後的新資料另向院內系統擷取。'],
  ['none', '門診助理沒有這位病人的預看診存檔，這次全部改向院內系統擷取。'],
  ['timeout', '門診助理的預看診存檔讀取逾時，這次全部改向院內系統擷取。'],
  ['failed', '門診助理的預看診存檔讀取失敗，這次全部改向院內系統擷取。'],
  ['unusable', '門診助理的預看診存檔無法銜接新資料，這次全部改向院內系統擷取。'],
])('a capture tagged stored-record %s says so', (code, text) => {
  render(<HospitalCaptureReasons />)
  // 雲端懷爾抓抓 relays the code without its display.
  act(() => rememberLocalBundleCapture(bundle([{ system: STORED, code }])))
  expect(screen.getByRole('status')).toHaveTextContent(text)
})

test('no stored-record tag, an unknown code or the tag twice says nothing of the stored record', () => {
  render(<HospitalCaptureReasons />)
  for (const tags of [[], [{ system: STORED, code: 'skipped' }], [{ system: STORED }], [{ system: STORED, code: 'used' }, { system: STORED, code: 'none' }],
    [{ system: 'urn:oid:vgh.capture.base', code: 'assistant-record' }]]) {
    act(() => rememberLocalBundleCapture(bundle(tags)))
    expect(screen.queryByRole('status')).toBeNull()
  }
})

test('the stored-record line stands beside the missing-data line, and has English wording', () => {
  render(<HospitalCaptureReasons />)
  act(() => rememberLocalBundleCapture(bundle([{ system: FAILURE, code: 'reports:timeout', display: '1' }, { system: STORED, code: 'used' }])))
  const [missing, stored] = screen.getAllByRole('status')
  expect(missing).toHaveTextContent('院內資料未取得：檢查驗報告－北榮回應逾時。請核對 HIS。')
  expect(stored).toHaveTextContent('近一年院內資料取自門診助理的預看診存檔，之後的新資料另向院內系統擷取。')
  mockLocale = 'en'
  act(() => rememberLocalBundleCapture(bundle([{ system: STORED, code: 'none' }])))
  expect(screen.getByRole('status')).toHaveTextContent('The outpatient assistant holds no pre-visit record for this patient; this capture read everything from HIS instead.')
})
