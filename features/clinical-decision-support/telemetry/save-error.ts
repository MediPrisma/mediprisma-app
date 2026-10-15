/** Diagnostic metadata only: never retain a payload, token, or server response body. */
export class CdssSaveError extends Error {
  constructor(message: string, readonly stage: string, readonly status?: number) {
    super(message)
    this.name = 'CdssSaveError'
  }
}

const help: Record<string, [string, string]> = {
  cdss_auth_unavailable: ['登入授權無法取得，請重新登入後再試。', 'Sign in again and retry.'],
  cdss_site_changed: ['儲存期間帳號或頁面已變更，請確認後重試。', 'The account or page changed. Check and retry.'],
  cdss_save_timeout: ['儲存超過 15 秒，結果尚未確認；請先查看紀錄。', 'Save timed out after 15 seconds. Check records before retrying.'],
  cdss_prepare_timeout: ['送出前準備超過 15 秒，資料尚未送出；請確認登入後重試。', 'Preparation timed out after 15 seconds. Nothing was sent; check sign-in and retry.'],
  cdss_network_unavailable: ['無法取得儲存服務回應，請確認網路與瀏覽器連線限制；重試前請先查看紀錄。', 'No response from storage. Check network and browser restrictions; check records before retrying.'],
  cdss_save_interrupted: ['送出後帳號或頁面已變更，儲存結果未確認；請回到原帳號與病人查看紀錄後再重試。', 'The account or page changed after sending. Return to the original account and patient and check records before retrying.'],
  cdss_payload_invalid: ['儲存資料格式檢查失敗，請提供此錯誤代碼給維護人員。', 'Snapshot validation failed. Report this code to support.'],
  cdss_payload_too_large: ['儲存資料超過 4 MB 限制。', 'Snapshot exceeds the 4 MB limit.'],
  cdss_gateway_unconfirmed: ['服務回覆無法確認儲存結果，請先查看紀錄。', 'The receipt could not be confirmed. Check records first.'],
  cdss_gateway_rejected: ['儲存服務拒絕請求，請提供 HTTP 狀態給維護人員。', 'Storage rejected the request. Report the HTTP status.'],
  cdss_site_unavailable: ['目前頁面不支援此儲存服務。', 'Storage is unavailable on this page.'],
  cdss_endpoint_unavailable: ['儲存服務網址設定無效。', 'Storage endpoint configuration is invalid.'],
  cdss_crypto_unavailable: ['瀏覽器無法使用安全識別功能，請確認以 HTTPS 開啟。', 'Secure identity is unavailable. Open the app over HTTPS.'],
}

export function cdssSaveOutcomeUncertain(failure: unknown): boolean {
  return failure instanceof Error && ['cdss_save_timeout', 'cdss_network_unavailable', 'cdss_gateway_unconfirmed', 'cdss_save_interrupted'].includes(failure.message)
}

export function cdssSaveErrorDescription(failure: unknown, english: boolean): string {
  const code = failure instanceof Error && Object.hasOwn(help, failure.message) ? failure.message : 'cdss_save_unknown'
  let message = help[code]?.[english ? 1 : 0] ?? (english ? 'Unexpected save failure. Report this code.' : '發生未分類儲存錯誤，請提供此代碼給維護人員。')
  const status = failure instanceof CdssSaveError ? failure.status : undefined
  if (status === 401 || status === 403) message = english ? 'Authorization or access was denied. Check login and access permissions.' : '登入授權或存取權限被拒絕，請確認登入、帳號與網路存取權限。'
  if (status === 400) message = english ? 'The server rejected the snapshot format.' : '伺服器拒收資料格式，請提供此代碼給維護人員。'
  if (status === 503) message = english ? 'FHIR storage is temporarily unavailable.' : 'FHIR 儲存服務暫時無法使用。'
  return `${message} [${code}${failure instanceof CdssSaveError ? `; stage=${failure.stage}` : ''}${status !== undefined ? `; HTTP ${status}` : ''}]`
}
