import type { HfDryRunClaim } from './contract'
import type { AiReport } from '@/src/shared/contracts/collector-event'

export interface HfRequestDiagnostic {
  requestId: string
  operation: 'dry-run' | 'predict'
  claim: HfDryRunClaim
  indexDate: string
  startedAt: string
  elapsedMs: number
  stage: 'prepare' | 'connect' | 'response' | 'parse'
  httpStatus: number | null
  errorCode: HfErrorCode | null
  verdict: 'accepted' | 'refused' | 'scored' | null
  requestBytes: number
  responseBytes: number
  responseType: 'json' | 'fhir+json' | 'other' | 'missing'
  responseIdMatched: boolean | null
  adapterVersion?: string
}

/** Volatile, per-request snapshot. Never sent by automatic telemetry. */
export interface HfDiagnosticRecord {
  diagnostic: HfRequestDiagnostic
  /** Only the validated model projection, exactly as serialized for this request. */
  inputJson: string | null
}

export const HF_REQUEST_ERRORS = {
  'internal-error': { message: ['準備請求時發生未預期錯誤，尚無法確認原因。請回報本次診斷。', 'An unexpected error occurred while preparing the request. Report the diagnostics to identify its cause.'], outcome: 'error' },
  'input-invalid': { message: ['輸入資料不符合模型契約，請核對資料', 'Inputs do not match the model contract; review the data'], outcome: 'validation_failed' },
  'input-too-large': { message: ['整理後資料超過 2 MiB，無法送出', 'Prepared data exceeds the 2 MiB limit'], outcome: 'validation_failed' },
  'gateway-config': { message: ['院內 HF 檢查服務尚未設定', 'Intranet HF validation service is not configured'], outcome: 'error' },
  'preview-fixture-required': { message: ['本機中繼僅接受指定合成病例，這份資料未送出', 'Local relay accepts only pinned synthetic cases; this data was not sent'], outcome: 'validation_failed' },
  'response-too-large': { message: ['服務回應超過大小限制，已丟棄', 'Oversized service response discarded'], outcome: 'upstream' },
  'gateway-unauthorized': { message: ['尚未登入或未取得 HF 服務授權', 'Sign-in or HF service authorization required'], outcome: 'authentication' },
  'invalid-prediction-response': { message: ['預測回應不符合模型契約，已丟棄', 'Prediction response does not match the model contract; discarded'], outcome: 'parse_failed' },
  'invalid-dry-run-response': { message: ['服務回應不符合輸入檢查格式，已丟棄', 'Invalid input-validation response discarded'], outcome: 'parse_failed' },
  'gateway-network': { message: ['瀏覽器未取得服務回應。可能是院內網路、網站的區域網路權限或跨來源連線受阻；尚不能判定為病歷資料錯誤。', 'The browser received no service response. Check the hospital network and browser local-network access; this does not establish an input-data error.'], outcome: 'network' },
  'request-timeout': { message: ['等候服務超過 15 秒，已停止等待。請稍後重試；若重複發生，回報本次診斷。', 'The service did not finish within 15 seconds. Retry later or report the diagnostics if this persists.'], outcome: 'timeout' },
  'request-aborted': { message: ['本次請求已中止，尚未確認預測完成。請重新執行。', 'The request was cancelled before completion was confirmed. Run it again.'], outcome: 'aborted' },
  'gateway-input-rejected': { message: ['院內服務拒絕輸入格式（HTTP 400）。請回報本次診斷，核對整理後資料與服務契約。', 'The service rejected the input format (HTTP 400). Report the diagnostics to compare the prepared data with the service contract.'], outcome: 'validation_failed' },
  'gateway-not-found': { message: ['找不到 HF 服務路由（HTTP 404）。請回報本次診斷，由管理者確認部署版本。', 'The HF service route was not found (HTTP 404). Report the diagnostics so the deployment can be checked.'], outcome: 'upstream' },
  'gateway-content-type': { message: ['服務不接受本次資料格式（HTTP 415）。請回報本次診斷。', 'The service rejected the request content type (HTTP 415). Report the diagnostics.'], outcome: 'validation_failed' },
  'gateway-payload-too-large': { message: ['院內入口拒絕接收這份資料（HTTP 413），可能是入口大小限制。請回報本次診斷；不代表資料超過前端的 2 MiB 上限。', 'The gateway rejected the payload (HTTP 413), possibly because of its own size limit. Report the diagnostics; the frontend 2 MiB limit was not exceeded.'], outcome: 'upstream' },
  'gateway-rate-limited': { message: ['服務暫時限制請求量（HTTP 429）。請稍後重試。', 'The service is rate limiting requests (HTTP 429). Retry later.'], outcome: 'rate_limited' },
  'gateway-upstream-timeout': { message: ['院內入口等候上游模型逾時（HTTP 504）。請稍後重試或回報本次診斷。', 'The gateway timed out waiting for the model (HTTP 504). Retry later or report the diagnostics.'], outcome: 'upstream' },
  'gateway-unavailable': { message: ['院內服務或上游模型未能完成請求。這不等同於資料不符合評分條件；請查看 HTTP 狀態並回報本次診斷。', 'The service or upstream model could not complete the request. This is not an eligibility refusal; check the HTTP status and report the diagnostics.'], outcome: 'upstream' },
  'response-empty': { message: ['服務沒有傳回內容，無法確認結果。請回報本次診斷。', 'The service returned no response body. Report the diagnostics.'], outcome: 'upstream' },
  'response-interrupted': { message: ['服務回應在接收途中中斷，未取得完整結果。請重試或回報本次診斷。', 'The response was interrupted before it completed. Retry or report the diagnostics.'], outcome: 'network' },
  'invalid-json-response': { message: ['服務回應不是有效的 JSON，未採用此結果。請回報本次診斷。', 'The response was not valid JSON and was discarded. Report the diagnostics.'], outcome: 'parse_failed' },
} as const satisfies Record<string, { message: readonly [string, string]; outcome: AiReport['executions'][number]['outcome'] }>

export type HfErrorCode = keyof typeof HF_REQUEST_ERRORS
export const isHfErrorCode = (code: string): code is HfErrorCode => Object.hasOwn(HF_REQUEST_ERRORS, code)
export const hfFailureMessage = (code: string) => isHfErrorCode(code) ? HF_REQUEST_ERRORS[code].message : undefined

export function hfDiagnosticStage(stage: HfRequestDiagnostic['stage'], en: boolean): string {
  return ({ prepare: ['整理送出資料', 'Preparing input'], connect: ['連接院內服務', 'Connecting'], response: ['接收服務回應', 'Receiving response'], parse: ['驗證回應格式', 'Validating response'] } as const)[stage][en ? 1 : 0]
}
