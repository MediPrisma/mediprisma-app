import type { HfDryRunClaim } from './contract'

export interface HfRequestDiagnostic {
  requestId: string
  operation: 'dry-run' | 'predict'
  claim: HfDryRunClaim
  indexDate: string
  startedAt: string
  elapsedMs: number
  stage: 'prepare' | 'connect' | 'response' | 'parse'
  httpStatus: number | null
  errorCode: string | null
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

export const HF_FAILURE_MESSAGES: Record<string, [string, string]> = {
  'gateway-network': ['瀏覽器未取得服務回應。可能是院內網路、網站的區域網路權限或跨來源連線受阻；尚不能判定為病歷資料錯誤。', 'The browser received no service response. Check the hospital network and browser local-network access; this does not establish an input-data error.'],
  'request-timeout': ['等候服務超過 15 秒，已停止等待。請稍後重試；若重複發生，回報本次診斷。', 'The service did not finish within 15 seconds. Retry later or report the diagnostics if this persists.'],
  'request-aborted': ['本次請求已中止，尚未確認預測完成。請重新執行。', 'The request was cancelled before completion was confirmed. Run it again.'],
  'gateway-input-rejected': ['院內服務拒絕輸入格式（HTTP 400）。請回報本次診斷，核對整理後資料與服務契約。', 'The service rejected the input format (HTTP 400). Report the diagnostics to compare the prepared data with the service contract.'],
  'gateway-not-found': ['找不到 HF 服務路由（HTTP 404）。請回報本次診斷，由管理者確認部署版本。', 'The HF service route was not found (HTTP 404). Report the diagnostics so the deployment can be checked.'],
  'gateway-content-type': ['服務不接受本次資料格式（HTTP 415）。請回報本次診斷。', 'The service rejected the request content type (HTTP 415). Report the diagnostics.'],
  'gateway-rate-limited': ['服務暫時限制請求量（HTTP 429）。請稍後重試。', 'The service is rate limiting requests (HTTP 429). Retry later.'],
  'gateway-upstream-timeout': ['院內入口等候上游模型逾時（HTTP 504）。請稍後重試或回報本次診斷。', 'The gateway timed out waiting for the model (HTTP 504). Retry later or report the diagnostics.'],
  'gateway-unavailable': ['院內服務或上游模型未能完成請求。這不等同於資料不符合評分條件；請查看 HTTP 狀態並回報本次診斷。', 'The service or upstream model could not complete the request. This is not an eligibility refusal; check the HTTP status and report the diagnostics.'],
  'response-empty': ['服務沒有傳回內容，無法確認結果。請回報本次診斷。', 'The service returned no response body. Report the diagnostics.'],
  'response-interrupted': ['服務回應在接收途中中斷，未取得完整結果。請重試或回報本次診斷。', 'The response was interrupted before it completed. Retry or report the diagnostics.'],
  'invalid-json-response': ['服務回應不是有效的 JSON，未採用此結果。請回報本次診斷。', 'The response was not valid JSON and was discarded. Report the diagnostics.'],
}

export function hfDiagnosticStage(stage: HfRequestDiagnostic['stage'], en: boolean): string {
  return ({ prepare: ['整理送出資料', 'Preparing input'], connect: ['連接院內服務', 'Connecting'], response: ['接收服務回應', 'Receiving response'], parse: ['驗證回應格式', 'Validating response'] } as const)[stage][en ? 1 : 0]
}
